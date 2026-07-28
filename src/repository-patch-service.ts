import { execFile, spawn } from "node:child_process";
import { cp, lstat, mkdtemp, readFile, rm, unlink, writeFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { digest, sha256, stableJson } from "./hash.js";
import {
  assertCleanRepository,
  beforeManifest,
  canonicalPatch,
  canonicalRepositoryRoot,
  isSecretBearingPath,
  manifestDigest,
  manifestEntry,
  proposedManifest,
  repositoryIdentity,
  safeRepositoryPath,
  submodulePaths,
  trackedPaths,
} from "./repository-git.js";
import {
  SubprocessRepositoryPatchExecutor,
  type RepositoryPatchExecutor,
} from "./repository-patch-executor.js";
import { RepositoryPatchStore } from "./repository-patch-store.js";
import { publicKeyFingerprint, type SigningProvider } from "./signer.js";
import type { Approval, OperatorApprovalRecord, ReadOnlyEvidence } from "./types.js";
import type {
  RepositoryPatchAction,
  RepositoryPatchPolicy,
  RepositoryPatchPrepared,
  RepositoryPatchReceiptBody,
  RepositoryPatchTransaction,
  SignedRepositoryPatchReceipt,
  VerificationCommand,
  VerificationCommandEvidence,
} from "./repository-patch-types.js";

const execFileAsync = promisify(execFile);

export interface RepositoryPatchOptions {
  databasePath: string;
  signer?: SigningProvider;
  executor?: RepositoryPatchExecutor;
  evidenceProvider?: (root: string) => Promise<ReadOnlyEvidence[]>;
  now?: () => Date;
  faults?: { afterMutation?: () => void; afterVerification?: () => void };
  compensationWriter?: (transaction: RepositoryPatchTransaction) => Promise<void>;
}

function affectedPaths(action: RepositoryPatchAction): string[] {
  return [...new Set(action.operations.map((item) => item.path))].sort();
}

function expectedDiffDigest(prepared: Pick<RepositoryPatchPrepared, "identity" | "afterManifest" | "affectedPaths">): string {
  return digest({
    baseCommit: prepared.identity.baseCommit,
    affectedPaths: prepared.affectedPaths,
    afterManifest: [...prepared.afterManifest].sort((a, b) => a.path.localeCompare(b.path)),
  });
}

function secretLikeContent(content: Buffer): boolean {
  const text = content.toString("utf8");
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{12,}|aws_secret_access_key/i.test(text);
}

async function applyOperations(root: string, action: RepositoryPatchAction): Promise<void> {
  for (const operation of action.operations) {
    const target = path.join(root, operation.path);
    if (operation.kind === "delete") {
      await unlink(target);
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(operation.contentBase64, "base64"));
      await chmod(target, (operation.mode ?? "100644") === "100755" ? 0o755 : 0o644);
    }
  }
}

async function runVerificationCommand(
  disposableRoot: string,
  command: VerificationCommand,
): Promise<VerificationCommandEvidence> {
  const started = Date.now();
  const cwd = path.join(disposableRoot, command.cwd);
  return new Promise((resolve) => {
    const child = spawn(command.executable, command.args, {
      cwd,
      shell: false,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: disposableRoot, LANG: "C", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    const append = (current: Buffer, chunk: Buffer) => {
      const combined = Buffer.concat([current, chunk]);
      if (combined.byteLength <= command.maxOutputBytes) return combined;
      truncated = true;
      return combined.subarray(0, command.maxOutputBytes);
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, command.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      stderr = append(stderr, Buffer.from(error.message));
      resolve({
        executable: command.executable, args: command.args, cwd: command.cwd,
        exitCode: null, timedOut, durationMs: Date.now() - started,
        stdoutDigest: sha256(stdout), stderrDigest: sha256(stderr),
        stdoutBytes: stdout.byteLength, stderrBytes: stderr.byteLength,
        truncated, sanitized: true,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        executable: command.executable, args: command.args, cwd: command.cwd,
        exitCode: code, timedOut, durationMs: Date.now() - started,
        stdoutDigest: sha256(stdout), stderrDigest: sha256(stderr),
        stdoutBytes: stdout.byteLength, stderrBytes: stderr.byteLength,
        truncated, sanitized: true,
      });
    });
  });
}

export class RepositoryPatchAgentProof {
  readonly store: RepositoryPatchStore;
  private readonly signer?: SigningProvider;
  private readonly executor: RepositoryPatchExecutor;
  private readonly evidenceProvider: (root: string) => Promise<ReadOnlyEvidence[]>;
  private readonly now: () => Date;
  private readonly faults?: RepositoryPatchOptions["faults"];
  private readonly compensationWriter?: RepositoryPatchOptions["compensationWriter"];

  constructor(options: RepositoryPatchOptions) {
    this.store = new RepositoryPatchStore(options.databasePath);
    this.signer = options.signer;
    this.executor = options.executor ?? new SubprocessRepositoryPatchExecutor();
    this.evidenceProvider = options.evidenceProvider ?? (async () => []);
    this.now = options.now ?? (() => new Date());
    this.faults = options.faults;
    this.compensationWriter = options.compensationWriter;
  }

  async preflight(
    action: RepositoryPatchAction,
    intent: RepositoryPatchTransaction["intent"],
    policy: RepositoryPatchPolicy,
    correlationId: string | null = null,
  ): Promise<RepositoryPatchTransaction> {
    const now = this.now().toISOString();
    const transaction: RepositoryPatchTransaction = {
      schemaVersion: "agentproof.repository-patch.transaction.v1",
      transactionId: randomUUID(), correlationId, createdAt: now, updatedAt: now,
      state: "approval_required", intent, action, policy,
      policyVersion: "agentproof.repository-patch.v1",
      actionDigest: digest(action), prepared: null, readOnlyEvidence: [],
      approval: null, idempotencyKey: null, execution: null, verification: null,
      compensation: null, beforeContents: {}, receiptPersisted: false, lastError: null,
    };
    try {
      const root = await canonicalRepositoryRoot(action.repositoryRoot);
      const allowed = await canonicalRepositoryRoot(policy.allowedRepositoryRoot);
      if (root !== allowed) throw new Error("repository_root_not_allowed");
      const declaredSubmodules = await submodulePaths(root);
      const requestedSubmodule = action.operations.find((item) => declaredSubmodules.has(item.path));
      if (requestedSubmodule) throw new Error(`submodule_path_blocked:`);
      await assertCleanRepository(root);
      const paths = affectedPaths(action);
      if (paths.length === 0 || paths.length > policy.maxFiles) throw new Error("patch_file_count_invalid");
      if (paths.some((item) => !safeRepositoryPath(item))) throw new Error("patch_path_invalid");
      const folded = paths.map((item) => item.normalize("NFC").toLocaleLowerCase("en-US"));
      if (new Set(folded).size !== folded.length) throw new Error("case_folding_path_collision");
      if (Buffer.byteLength(canonicalPatch(action.operations)) > policy.maxPatchBytes) throw new Error("patch_size_limit_exceeded");
      const tracked = await trackedPaths(root);
      const submodules = await submodulePaths(root);
      for (const operation of action.operations) {
        if (submodules.has(operation.path)) throw new Error(`submodule_path_blocked:${operation.path}`);
        if (tracked.has(operation.path)) {
          if (!policy.allowedTrackedPaths.includes(operation.path)) throw new Error(`tracked_path_not_allowed:${operation.path}`);
        } else if (operation.kind === "write" && operation.newFile === true) {
          if (!policy.allowedNewPaths.includes(operation.path)) throw new Error(`new_path_not_allowed:${operation.path}`);
        } else {
          throw new Error(`untracked_or_undeclared_path:${operation.path}`);
        }
        const target = path.join(root, operation.path);
        try {
          const stat = await lstat(target);
          if (stat.isSymbolicLink()) throw new Error(`symlink_target_blocked:${operation.path}`);
          if (!stat.isFile()) throw new Error(`non_regular_target_blocked:${operation.path}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (isSecretBearingPath(operation.path) && !(policy.allowSecretBearingPaths ?? []).includes(operation.path)) {
          throw new Error(`secret_bearing_path_blocked:${operation.path}`);
        }
        if (operation.kind === "write" && secretLikeContent(Buffer.from(operation.contentBase64, "base64"))) {
          throw new Error(`secret_bearing_content_blocked:${operation.path}`);
        }
      }
      for (const command of action.verificationCommands ?? []) {
        if (!(policy.allowedVerificationExecutables ?? []).includes(command.executable)) throw new Error("verification_executable_not_allowed");
        if (!(policy.allowedVerificationWorkingDirectories ?? ["."]).includes(command.cwd)) throw new Error("verification_cwd_not_allowed");
        if (!safeRepositoryPath(command.cwd) && command.cwd !== ".") throw new Error("verification_cwd_invalid");
        if (command.timeoutMs < 1 || command.timeoutMs > 120_000 || command.maxOutputBytes < 1 || command.maxOutputBytes > 1_048_576) {
          throw new Error("verification_limits_invalid");
        }
      }
      transaction.action = { ...action, repositoryRoot: root };
      transaction.readOnlyEvidence = await this.evidenceProvider(root);
      if (transaction.readOnlyEvidence.some((item) => !item.success)) throw new Error("read_only_evidence_incomplete");
    } catch (error) {
      transaction.state = "blocked";
      transaction.lastError = (error as Error).message;
    }
    await this.store.save(transaction);
    return transaction;
  }

  async prepare(transactionId: string): Promise<RepositoryPatchTransaction> {
    const transaction = await this.store.get(transactionId);
    if (transaction.state === "blocked") return transaction;
    try {
      const root = transaction.action.repositoryRoot;
      await assertCleanRepository(root);
      const identity = await repositoryIdentity(root);
      const tracked = await trackedPaths(root);
      const paths = affectedPaths(transaction.action);
      const before = await beforeManifest(root, paths, tracked);
      for (const entry of before.filter((item) => item.exists)) {
        transaction.beforeContents[entry.path] = {
          contentBase64: (await readFile(path.join(root, entry.path))).toString("base64"),
          mode: entry.mode,
        };
      }
      const after = proposedManifest(before, transaction.action.operations);
      const patchCanonical = canonicalPatch(transaction.action.operations);
      const preparedBase = { identity, afterManifest: after, affectedPaths: paths };
      transaction.prepared = {
        state: "prepared", identity, beforeManifest: before, afterManifest: after,
        affectedPaths: paths, patchCanonical, patchDigest: sha256(patchCanonical),
        expectedDiffDigest: expectedDiffDigest(preparedBase),
        verificationPlan: transaction.action.verificationCommands ?? [],
        verificationPlanDigest: digest(transaction.action.verificationCommands ?? []),
        compensation: "restore_before_state",
      };
      transaction.state = "prepared";
    } catch (error) {
      transaction.state = "blocked";
      transaction.lastError = (error as Error).message;
    }
    transaction.updatedAt = this.now().toISOString();
    await this.store.save(transaction);
    return transaction;
  }

  approvalBinding(transaction: RepositoryPatchTransaction, expiresAt: string, nonce: string) {
    if (!transaction.prepared) throw new Error("repository_patch_not_prepared");
    return {
      schemaVersion: "agentproof.repository-patch.approval.v1",
      transactionId: transaction.transactionId,
      intentDigest: digest(transaction.intent),
      actionDigest: transaction.actionDigest,
      target: transaction.action.repositoryRoot,
      baseCommit: transaction.prepared.identity.baseCommit,
      branch: transaction.prepared.identity.branch,
      beforeManifestDigest: manifestDigest(transaction.prepared.beforeManifest),
      proposedManifestDigest: manifestDigest(transaction.prepared.afterManifest),
      patchDigest: transaction.prepared.patchDigest,
      expectedDiffDigest: transaction.prepared.expectedDiffDigest,
      affectedPaths: transaction.prepared.affectedPaths,
      verificationPlanDigest: transaction.prepared.verificationPlanDigest,
      policyVersion: transaction.policyVersion,
      expiresAt, nonce,
    };
  }

  createOperatorApprovalRequest(transaction: RepositoryPatchTransaction, expiresAt: string, nonce = randomBytes(24).toString("base64url")) {
    const binding = this.approvalBinding(transaction, expiresAt, nonce);
    return {
      type: "build-refactor" as const,
      payload: { requiresApproval: true, agentProof: { ...binding, bindingDigest: digest(binding) } },
    };
  }

  approvalFromOperatorReplay(
    transaction: RepositoryPatchTransaction,
    record: OperatorApprovalRecord,
    replay: Record<string, unknown>,
    now = this.now(),
  ): Approval {
    if (record.status !== "approved" || !record.decidedAt || !record.decidedBy) throw new Error("operator_approval_not_approved");
    if (replay.approvedFromTaskId !== record.taskId) throw new Error("operator_approval_replay_link_invalid");
    const decisionDigest = digest({
      taskId: record.taskId, type: record.type, payload: record.payload,
      requestedAt: record.requestedAt, status: record.status,
      decidedAt: record.decidedAt, decidedBy: record.decidedBy, note: record.note ?? null,
    });
    if (replay.approvalDecisionDigest !== decisionDigest ||
        replay.approvalDecisionId !== `approval-decision:${decisionDigest}`) {
      throw new Error("operator_approval_decision_binding_invalid");
    }
    const raw = record.payload.agentProof as Record<string, unknown>;
    const binding = this.approvalBinding(transaction, String(raw.expiresAt), String(raw.nonce));
    if (raw.bindingDigest !== digest(binding) || stableJson(raw) !== stableJson({ ...binding, bindingDigest: digest(binding) })) {
      throw new Error("repository_patch_approval_binding_mismatch");
    }
    if (now.getTime() >= Date.parse(binding.expiresAt)) throw new Error("operator_approval_expired");
    return {
      decision: "approved", approvedBy: record.decidedBy, approvedAt: record.decidedAt,
      transactionId: transaction.transactionId, actionDigest: transaction.actionDigest,
      intentDigest: digest(transaction.intent), target: transaction.action.repositoryRoot,
      beforeSha256: manifestDigest(transaction.prepared!.beforeManifest),
      proposedSha256: manifestDigest(transaction.prepared!.afterManifest),
      policyVersion: transaction.policyVersion, expiresAt: binding.expiresAt, nonce: binding.nonce,
      originalTaskId: record.taskId, operatorApprovalTaskId: record.taskId,
      operatorDecisionId: `approval-decision:${decisionDigest}`,
      approvedFromTaskId: record.taskId, approvalDecisionDigest: decisionDigest,
      scope: "single_transaction",
    };
  }

  private async assertPreparedState(transaction: RepositoryPatchTransaction): Promise<void> {
    const prepared = transaction.prepared!;
    await assertCleanRepository(transaction.action.repositoryRoot);
    const identity = await repositoryIdentity(transaction.action.repositoryRoot);
    if (stableJson(identity) !== stableJson(prepared.identity)) throw new Error("repository_identity_drift");
    const tracked = await trackedPaths(transaction.action.repositoryRoot);
    const observed = await beforeManifest(transaction.action.repositoryRoot, prepared.affectedPaths, tracked);
    if (manifestDigest(observed) !== manifestDigest(prepared.beforeManifest)) throw new Error("repository_file_drift");
  }

  async execute(transactionId: string, idempotencyKey: string, approval: Approval): Promise<RepositoryPatchTransaction> {
    let transaction = await this.store.get(transactionId);
    if (!transaction.prepared) throw new Error("repository_patch_not_prepared");
    if (approval.transactionId !== transactionId || approval.actionDigest !== transaction.actionDigest ||
        approval.target !== transaction.action.repositoryRoot ||
        approval.beforeSha256 !== manifestDigest(transaction.prepared.beforeManifest) ||
        approval.proposedSha256 !== manifestDigest(transaction.prepared.afterManifest) ||
        approval.policyVersion !== transaction.policyVersion ||
        this.now().getTime() >= Date.parse(approval.expiresAt)) throw new Error("approval_invalid_or_out_of_scope");
    const claim = await this.store.claim(transactionId, idempotencyKey, approval);
    if (!claim.claimed) return claim.transaction;
    transaction = claim.transaction;
    try {
      await this.assertPreparedState(transaction);
    } catch (error) {
      transaction.state = "blocked";
      transaction.lastError = (error as Error).message;
      transaction.updatedAt = this.now().toISOString();
      await this.store.save(transaction);
      return transaction;
    }
    try {
      const result = await this.executor.apply(transaction.action.repositoryRoot, transaction.prepared!);
      this.faults?.afterMutation?.();
      transaction.execution = result;
      transaction.state = result.state;
    } catch (error) {
      if ((error as Error).message.startsWith("simulated_crash")) throw error;
      transaction.execution = {
        state: "failed", attemptedAt: transaction.updatedAt, completedAt: this.now().toISOString(),
        message: (error as Error).message,
      };
      transaction.state = "failed";
      transaction.lastError = (error as Error).message;
    }
    transaction.updatedAt = this.now().toISOString();
    await this.store.save(transaction);
    return transaction;
  }

  async verify(transactionId: string): Promise<RepositoryPatchTransaction> {
    const transaction = await this.store.get(transactionId);
    const prepared = transaction.prepared!;
    const root = transaction.action.repositoryRoot;
    const tracked = await trackedPaths(root);
    const observed = await beforeManifest(root, prepared.affectedPaths, tracked);
    const status = await execFileAsync("git", ["-C", root, "status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" });
    const observedPaths = [...new Set(status.stdout.split("\n").filter(Boolean).map((line) => line.slice(3)))].sort();
    const unexpected = observedPaths.filter((item) => !prepared.affectedPaths.includes(item));
    let identityUnchanged = false;
    try {
      identityUnchanged = stableJson(await repositoryIdentity(root)) === stableJson(prepared.identity);
    } catch {}
    const observedDiffDigest = expectedDiffDigest({
      identity: prepared.identity, afterManifest: observed, affectedPaths: prepared.affectedPaths,
    });
    const commands: VerificationCommandEvidence[] = [];
    if (identityUnchanged && unexpected.length === 0 && manifestDigest(observed) === manifestDigest(prepared.afterManifest) &&
        observedDiffDigest === prepared.expectedDiffDigest) {
      const disposable = await mkdtemp(path.join(tmpdir(), "agentproof-repository-verify-"));
      try {
        await cp(root, disposable, { recursive: true });
        for (const command of prepared.verificationPlan) commands.push(await runVerificationCommand(disposable, command));
      } finally {
        await rm(disposable, { recursive: true, force: true });
      }
    }
    const commandsPass = commands.length === prepared.verificationPlan.length &&
      commands.every((item) => item.exitCode === 0 && !item.timedOut);
    const verified = identityUnchanged && unexpected.length === 0 &&
      manifestDigest(observed) === manifestDigest(prepared.afterManifest) &&
      observedDiffDigest === prepared.expectedDiffDigest && commandsPass;
    transaction.verification = {
      state: verified ? "verified" : "failed", observedManifest: observed,
      observedPaths, observedDiffDigest, identityUnchanged,
      unexpectedUntrackedPaths: unexpected, commands,
      message: verified
        ? "Repository identity, path set, manifests, canonical diff and isolated commands verified."
        : "Repository postcondition verification failed.",
    };
    transaction.state = transaction.verification.state;
    transaction.updatedAt = this.now().toISOString();
    await this.store.save(transaction);
    this.faults?.afterVerification?.();
    return transaction;
  }

  async compensate(transactionId: string): Promise<RepositoryPatchTransaction> {
    const transaction = await this.store.get(transactionId);
    const prepared = transaction.prepared!;
    try {
      if (this.compensationWriter) await this.compensationWriter(transaction);
      else {
        for (const before of prepared.beforeManifest) {
          const target = path.join(transaction.action.repositoryRoot, before.path);
          if (!before.exists) await rm(target, { force: true });
          else {
            const snapshot = transaction.beforeContents[before.path];
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, Buffer.from(snapshot.contentBase64, "base64"));
            await chmod(target, snapshot.mode === "100755" ? 0o755 : 0o644);
          }
        }
      }
      await assertCleanRepository(transaction.action.repositoryRoot);
      const identity = await repositoryIdentity(transaction.action.repositoryRoot);
      if (stableJson(identity) !== stableJson(prepared.identity)) throw new Error("compensation_identity_mismatch");
      transaction.compensation = {
        state: "compensated", message: "Exact before-state restored and independently verified clean.",
        verifiedAt: this.now().toISOString(),
      };
      transaction.state = "compensated";
    } catch (error) {
      transaction.compensation = {
        state: "escalation_required", message: `Compensation failed: ${(error as Error).message}`,
        verifiedAt: this.now().toISOString(),
      };
      transaction.state = "escalation_required";
      transaction.lastError = (error as Error).message;
    }
    transaction.updatedAt = this.now().toISOString();
    await this.store.save(transaction);
    return transaction;
  }

  async receipt(transactionId: string, reconciliation: string[] = []): Promise<SignedRepositoryPatchReceipt> {
    const existing = await this.store.getReceipt(transactionId);
    if (existing) return existing;
    const transaction = await this.store.get(transactionId);
    if (!this.signer) {
      transaction.lastError = "signer_unavailable";
      await this.store.save(transaction);
      throw new Error("signer_unavailable");
    }
    const prepared = transaction.prepared!;
    const bodyWithoutDigest = {
      schemaVersion: "agentproof.repository-patch.receipt.v1" as const,
      transactionId, issuedAt: this.now().toISOString(), state: transaction.state,
      intent: transaction.intent, operatorAuthority: transaction.approval,
      repositoryIdentity: prepared.identity, policyVersion: transaction.policyVersion,
      patchDigest: prepared.patchDigest, expectedDiffDigest: prepared.expectedDiffDigest,
      beforeManifest: prepared.beforeManifest, afterManifest: prepared.afterManifest,
      approvedPaths: prepared.affectedPaths,
      observedPaths: transaction.verification?.observedPaths ?? [],
      verificationCommands: transaction.verification?.commands ?? [],
      execution: transaction.execution, verification: transaction.verification,
      compensation: transaction.compensation, failure: transaction.lastError, reconciliation,
    };
    const unsigned: RepositoryPatchReceiptBody = {
      ...bodyWithoutDigest, receiptDigest: digest(bodyWithoutDigest),
    };
    const publicKeyPem = await this.signer.publicKeyPem();
    const receipt: SignedRepositoryPatchReceipt = {
      ...unsigned,
      signature: {
        algorithm: "Ed25519", keyId: await this.signer.keyId(), publicKeyPem,
        signerFingerprint: publicKeyFingerprint(publicKeyPem),
        signatureBase64: (await this.signer.signCanonical(stableJson(unsigned))).toString("base64"),
      },
    };
    await this.store.saveReceipt(receipt);
    return receipt;
  }

  async reconcileIncomplete(): Promise<string[]> {
    const results: string[] = [];
    for (const transaction of await this.store.incomplete()) {
      if (transaction.state === "executing" || transaction.state === "executed" || transaction.state === "partially_executed") {
        const verified = await this.verify(transaction.transactionId);
        results.push(`${transaction.transactionId}:${transaction.state}->${verified.state}`);
        if (verified.state === "verified") {
          try { await this.receipt(transaction.transactionId, results); } catch {}
        }
      } else if (transaction.state === "verified" && !transaction.receiptPersisted) {
        try { await this.receipt(transaction.transactionId, results); } catch {}
      }
    }
    return results;
  }
}
