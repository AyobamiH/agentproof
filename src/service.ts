import { lstat, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { collectCodingEvidence } from "./evidence.js";
import { SubprocessFileExecutor } from "./executor.js";
import { digest, sha256 } from "./hash.js";
import { resolveAgentProofDatabasePath } from "./state-root.js";
import { signReceipt, type SigningProvider } from "./signer.js";
import { SqliteTransactionStore } from "./store.js";
import { observeFile, verifyFile } from "./verifier.js";
import type {
  ActionConstraints,
  AgentProofTransaction,
  Approval,
  FileExecutor,
  Intent,
  ReadOnlyEvidence,
  ReconciliationResult,
  ReplaceFileAction,
  SignedEvidenceReceipt,
} from "./types.js";

interface AgentProofOptions {
  stateRoot?: string;
  databasePath?: string;
  codingAgentSkillsCli?: string;
  executor?: FileExecutor;
  signer?: SigningProvider;
  evidenceProvider?: (projectRoot: string) => Promise<ReadOnlyEvidence[]>;
  now?: () => Date;
  faults?: { afterMutation?: () => void; afterVerification?: () => void };
  compensationWriter?: (transaction: AgentProofTransaction) => Promise<void>;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function renderDiff(target: string, before: string | null, after: string): string {
  const oldLines = before === null ? [] : before.split("\n");
  const newLines = after.split("\n");
  return [
    `--- a/${target}`,
    `+++ b/${target}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
}

export class AgentProof {
  readonly store: SqliteTransactionStore;
  private readonly executor: FileExecutor;
  private readonly signer?: SigningProvider;
  private readonly evidenceProvider: (projectRoot: string) => Promise<ReadOnlyEvidence[]>;
  private readonly now: () => Date;
  private readonly faults?: AgentProofOptions["faults"];
  private readonly compensationWriter?: AgentProofOptions["compensationWriter"];

  constructor(options: AgentProofOptions) {
    this.store = new SqliteTransactionStore(
      options.databasePath ?? resolveAgentProofDatabasePath(options.stateRoot),
    );
    this.executor = options.executor ?? new SubprocessFileExecutor();
    this.signer = options.signer;
    this.now = options.now ?? (() => new Date());
    this.faults = options.faults;
    this.compensationWriter = options.compensationWriter;
    this.evidenceProvider =
      options.evidenceProvider ??
      ((projectRoot) => {
        if (!options.codingAgentSkillsCli) throw new Error("coding-agent-skills CLI path is required");
        return collectCodingEvidence(options.codingAgentSkillsCli, projectRoot);
      });
  }

  async preflight(
    action: ReplaceFileAction,
    intent: Intent,
    constraints: ActionConstraints,
  ): Promise<AgentProofTransaction> {
    const transactionId = randomUUID();
    const now = this.now().toISOString();
    const reasons: string[] = [];
    let state: "approval_required" | "blocked" = "approval_required";
    let canonicalRoot = path.resolve(action.root);
    let canonicalTarget = path.resolve(canonicalRoot, action.target);
    let readOnlyEvidence: ReadOnlyEvidence[] = [];
    let beforeSnapshotBase64: string | null = null;
    let preflightBefore = await observeFile(canonicalTarget, "agentproof-preflight");

    try {
      canonicalRoot = await realpath(action.root);
      const allowedRoot = await realpath(constraints.allowedRoot);
      canonicalTarget = path.resolve(canonicalRoot, action.target);
      if (canonicalRoot !== allowedRoot) reasons.push("action_root_not_allowed");
      if (!isWithin(canonicalRoot, canonicalTarget)) reasons.push("target_outside_root");
      if (!constraints.allowedTargets.includes(action.target)) reasons.push("target_not_allowlisted");
      if (Buffer.byteLength(action.content) > constraints.maxWriteBytes) reasons.push("write_size_limit_exceeded");
      try {
        const details = await lstat(canonicalTarget);
        if (details.isSymbolicLink()) reasons.push("symlink_target_blocked");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const before = await observeFile(canonicalTarget, "agentproof-preflight");
      preflightBefore = before;
      if (
        constraints.expectedBeforeSha256 !== undefined &&
        before.sha256 !== constraints.expectedBeforeSha256
      ) reasons.push("before_state_mismatch");
      if (before.exists) {
        const bytes = await readFile(canonicalTarget);
        if (bytes.byteLength <= constraints.maxSnapshotBytes) {
          beforeSnapshotBase64 = bytes.toString("base64");
        } else if (!constraints.allowNonCompensable) {
          reasons.push("compensation_snapshot_limit_exceeded");
        }
      }
      readOnlyEvidence = await this.evidenceProvider(canonicalRoot);
      if (readOnlyEvidence.some((item) => !item.success)) reasons.push("read_only_evidence_incomplete");
    } catch (error) {
      reasons.push(`preflight_error:${(error as Error).message}`);
    }
    if (reasons.length > 0) state = "blocked";
    else reasons.push("consequential_local_mutation_requires_operator_approval");

    const transaction: AgentProofTransaction = {
      schemaVersion: "agentproof.transaction.v2",
      transactionId,
      createdAt: now,
      updatedAt: now,
      state,
      intent,
      action,
      constraints,
      canonicalTarget,
      actionDigest: digest(action),
      policyDecision: {
        state,
        policyId: "agentproof.local-file-change.v1",
        reasons,
        decidedAt: now,
      },
      readOnlyEvidence,
      preflightBefore,
      prepared: null,
      idempotencyKey: null,
      approval: null,
      execution: null,
      verification: null,
      compensation: null,
      beforeSnapshotBase64,
      receiptPersisted: false,
      lastError: null,
    };
    await this.store.save(transaction, "preflight_completed");
    return transaction;
  }

  async prepare(transactionId: string): Promise<AgentProofTransaction> {
    const transaction = await this.store.get(transactionId);
    if (transaction.state === "blocked") return transaction;
    const before = await observeFile(transaction.canonicalTarget, "agentproof-preflight");
    if (
      before.exists !== transaction.preflightBefore.exists ||
      before.sha256 !== transaction.preflightBefore.sha256 ||
      (transaction.constraints.expectedBeforeSha256 !== undefined &&
       before.sha256 !== transaction.constraints.expectedBeforeSha256)
    ) {
      transaction.state = "blocked";
      transaction.policyDecision.state = "blocked";
      transaction.policyDecision.reasons.push("before_state_changed_since_preflight");
    } else {
      const beforeText = before.exists ? (await readFile(transaction.canonicalTarget)).toString("utf8") : null;
      transaction.prepared = {
        state: "prepared",
        actionDigest: transaction.actionDigest,
        before,
        expectedAfterSha256: sha256(transaction.action.content),
        diff: renderDiff(transaction.action.target, beforeText, transaction.action.content),
        compensation: before.exists && transaction.beforeSnapshotBase64 === null
          ? "non_compensable"
          : "restore_before_state",
      };
      transaction.state = "prepared";
    }
    transaction.updatedAt = this.now().toISOString();
    await this.store.save(transaction, "change_prepared");
    return transaction;
  }

  private validateApproval(transaction: AgentProofTransaction, approval: Approval): void {
    if (!transaction.prepared) throw new Error("transaction_not_prepared");
    if (
      approval.decision !== "approved" ||
      approval.transactionId !== transaction.transactionId ||
      approval.actionDigest !== transaction.actionDigest ||
      approval.intentDigest !== digest(transaction.intent) ||
      approval.target !== transaction.canonicalTarget ||
      approval.beforeSha256 !== transaction.prepared.before.sha256 ||
      approval.proposedSha256 !== transaction.prepared.expectedAfterSha256 ||
      approval.policyVersion !== transaction.policyDecision.policyId ||
      approval.scope !== "single_transaction"
    ) throw new Error("approval_invalid_or_out_of_scope");
    if (!approval.nonce) throw new Error("approval_nonce_missing");
    if (!Number.isFinite(Date.parse(approval.expiresAt)) || this.now().getTime() >= Date.parse(approval.expiresAt)) {
      throw new Error("approval_expired");
    }
  }

  async execute(
    transactionId: string,
    idempotencyKey: string,
    approval: Approval,
  ): Promise<AgentProofTransaction> {
    let transaction = await this.store.get(transactionId);
    this.validateApproval(transaction, approval);
    const before = await observeFile(transaction.canonicalTarget, "agentproof-preflight");
    if (
      before.exists !== transaction.prepared!.before.exists ||
      before.sha256 !== transaction.prepared!.before.sha256
    ) {
      transaction.state = "blocked";
      transaction.lastError = "before_state_drift_before_execution";
      transaction.updatedAt = this.now().toISOString();
      await this.store.save(transaction, "execution_blocked_before_state_drift");
      return transaction;
    }
    const claim = await this.store.claimExecution(transactionId, idempotencyKey, approval);
    if (!claim.claimed) return claim.transaction;
    transaction = claim.transaction;
    try {
      transaction.execution = await this.executor.replace(
        transaction.canonicalTarget,
        Buffer.from(transaction.action.content),
        path.resolve(transaction.action.root),
        transaction.prepared!.expectedAfterSha256,
      );
      this.faults?.afterMutation?.();
      transaction.state = transaction.execution.state;
      transaction.updatedAt = this.now().toISOString();
      await this.store.save(transaction, "executor_completed");
      return transaction;
    } catch (error) {
      if ((error as Error).message.startsWith("simulated_crash")) throw error;
      transaction.execution = {
        state: "failed",
        executor: "agentproof-local-file-executor",
        attemptedAt: transaction.updatedAt,
        completedAt: this.now().toISOString(),
        message: `Executor process failed: ${(error as Error).message}`,
      };
      transaction.state = "failed";
      transaction.lastError = (error as Error).message;
      transaction.updatedAt = this.now().toISOString();
      await this.store.save(transaction, "executor_failed");
      return transaction;
    }
  }

  async verify(transactionId: string): Promise<AgentProofTransaction> {
    const transaction = await this.store.get(transactionId);
    if (!transaction.prepared) throw new Error("transaction_not_prepared");
    transaction.verification = await verifyFile(
      transaction.canonicalTarget,
      transaction.prepared.expectedAfterSha256,
    );
    transaction.state = transaction.verification.state;
    transaction.updatedAt = this.now().toISOString();
    await this.store.save(transaction, "independent_verification_completed");
    this.faults?.afterVerification?.();
    return transaction;
  }

  async compensate(transactionId: string): Promise<AgentProofTransaction> {
    const transaction = await this.store.get(transactionId);
    const attemptedAt = this.now().toISOString();
    if (!transaction.prepared) throw new Error("transaction_not_prepared");
    if (transaction.prepared.compensation === "non_compensable") {
      transaction.compensation = {
        state: "non_compensable", attemptedAt, observed: null,
        message: "The captured before-state exceeded the approved snapshot limit.",
      };
      transaction.state = "non_compensable";
    } else {
      try {
        if (this.compensationWriter) {
          await this.compensationWriter(transaction);
        } else if (transaction.prepared.before.exists) {
          if (transaction.beforeSnapshotBase64 === null) throw new Error("before_snapshot_missing");
          await writeFile(transaction.canonicalTarget, Buffer.from(transaction.beforeSnapshotBase64, "base64"));
        } else {
          await unlink(transaction.canonicalTarget);
        }
        const observed = await observeFile(transaction.canonicalTarget, "agentproof-independent-verifier");
        const restored = observed.exists === transaction.prepared.before.exists &&
          observed.sha256 === transaction.prepared.before.sha256;
        transaction.compensation = {
          state: restored ? "compensated" : "escalation_required",
          attemptedAt,
          observed,
          message: restored
            ? "Independent observation confirms the before-state was restored."
            : "Compensation ran but the observed state does not match the captured before-state.",
        };
        transaction.state = transaction.compensation.state;
      } catch (error) {
        transaction.compensation = {
          state: "escalation_required", attemptedAt, observed: null,
          message: `Compensation failed: ${(error as Error).message}`,
        };
        transaction.state = "escalation_required";
      }
    }
    transaction.updatedAt = this.now().toISOString();
    await this.store.save(transaction, "compensation_completed");
    return transaction;
  }

  async receipt(transactionId: string): Promise<SignedEvidenceReceipt> {
    const existing = await this.store.getReceipt(transactionId);
    if (existing) return existing;
    const transaction = await this.store.get(transactionId);
    if (!this.signer) {
      transaction.lastError = "signer_unavailable";
      transaction.updatedAt = this.now().toISOString();
      await this.store.save(transaction, "receipt_signer_unavailable");
      throw new Error("signer_unavailable");
    }
    const issuedAt = this.now().toISOString();
    const body = {
      schemaVersion: "agentproof.receipt.v2" as const,
      transactionId,
      issuedAt,
      state: transaction.state,
      intent: transaction.intent,
      target: transaction.canonicalTarget,
      policyDecision: transaction.policyDecision,
      approval: transaction.approval,
      exactAction: transaction.action,
      actionDigest: transaction.actionDigest,
      idempotencyKey: transaction.idempotencyKey,
      beforeEvidence: transaction.preflightBefore,
      afterEvidence: transaction.verification?.observed ?? null,
      execution: transaction.execution,
      verification: transaction.verification,
      compensation: transaction.compensation,
      readOnlyEvidence: transaction.readOnlyEvidence,
    };
    const unsigned = { ...body, receiptDigest: digest(body) };
    const signed = await signReceipt(unsigned, this.signer);
    await this.store.saveReceipt(signed);
    return signed;
  }

  async reconcileIncomplete(): Promise<ReconciliationResult[]> {
    const results: ReconciliationResult[] = [];
    for (const item of await this.store.listIncomplete()) {
      const from = item.state;
      let transaction = item;
      let action = "no_action";
      if (transaction.state === "executing") {
        const observed = await observeFile(transaction.canonicalTarget, "agentproof-independent-verifier");
        if (observed.sha256 === transaction.prepared?.expectedAfterSha256) {
          transaction.execution = transaction.execution ?? {
            state: "partially_executed",
            executor: "agentproof-local-file-executor",
            attemptedAt: transaction.updatedAt,
            completedAt: this.now().toISOString(),
            message: "Mutation observed after executor interruption; executor result unavailable.",
          };
          transaction.state = "partially_executed";
          transaction.updatedAt = this.now().toISOString();
          await this.store.save(transaction, "restart_reconciled_mutation_observed");
          action = "mutation_observed";
        } else if (
          observed.exists === transaction.prepared?.before.exists &&
          observed.sha256 === transaction.prepared?.before.sha256
        ) {
          transaction.state = "failed";
          transaction.lastError = "executor_interrupted_before_mutation";
          transaction.updatedAt = this.now().toISOString();
          await this.store.save(transaction, "restart_reconciled_no_mutation");
          results.push({ transactionId: transaction.transactionId, from, to: transaction.state, action: "no_mutation_observed" });
          continue;
        } else {
          transaction.state = "uncertain";
          transaction.lastError = "executor_interrupted_ambiguous_target_state";
          transaction.updatedAt = this.now().toISOString();
          await this.store.save(transaction, "restart_reconciled_ambiguous_state");
          results.push({ transactionId: transaction.transactionId, from, to: transaction.state, action: "ambiguous_state" });
          continue;
        }
      }
      if (["executed", "partially_executed"].includes(transaction.state)) {
        transaction = await this.verify(transaction.transactionId);
        action = action === "no_action" ? "verified" : `${action}_and_verified`;
      }
      if (transaction.state === "verified" && !transaction.receiptPersisted) {
        try {
          await this.receipt(transaction.transactionId);
          transaction = await this.store.get(transaction.transactionId);
          action = action === "no_action" ? "receipt_signed" : `${action}_and_receipt_signed`;
        } catch (error) {
          action = (error as Error).message;
          transaction = await this.store.get(transaction.transactionId);
        }
      }
      results.push({ transactionId: transaction.transactionId, from, to: transaction.state, action });
    }
    return results;
  }
}
