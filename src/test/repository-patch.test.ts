import { execFile } from "node:child_process";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import {
  Ed25519SigningProvider,
  RepositoryPatchAgentProof,
  publicKeyFingerprint,
  verifyRepositoryPatchReceiptWithTrust,
  type Approval,
  type RepositoryPatchAction,
  type RepositoryPatchPolicy,
  type RepositoryPatchTransaction,
} from "../index.js";
import { digest } from "../hash.js";

const exec = promisify(execFile);

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), "agentproof-patch-repo-"));
  await exec("git", ["init", "-b", "main", root]);
  await exec("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  await exec("git", ["-C", root, "config", "user.name", "AgentProof Test"]);
  await writeFile(path.join(root, "a.txt"), "alpha\n");
  await writeFile(path.join(root, "delete.txt"), "delete me\n");
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", ["-C", root, "commit", "-m", "base"]);
  return root;
}

function action(root: string): RepositoryPatchAction {
  return {
    type: "agentproof.repository_patch.v1",
    repositoryRoot: root,
    operations: [
      { kind: "write", path: "a.txt", contentBase64: Buffer.from("alpha changed\n").toString("base64") },
      { kind: "write", path: "new.txt", contentBase64: Buffer.from("new\n").toString("base64"), newFile: true },
      { kind: "delete", path: "delete.txt" },
    ],
  };
}

function policy(root: string): RepositoryPatchPolicy {
  return {
    allowedRepositoryRoot: root,
    allowedTrackedPaths: ["a.txt", "delete.txt"],
    allowedNewPaths: ["new.txt"],
    maxPatchBytes: 64_000,
    maxFiles: 5,
  };
}

async function service(root: string, options: Partial<ConstructorParameters<typeof RepositoryPatchAgentProof>[0]> = {}) {
  const state = await mkdtemp(path.join(tmpdir(), "agentproof-patch-state-"));
  return new RepositoryPatchAgentProof({
    databasePath: path.join(state, "transactions.sqlite"),
    signer: Object.prototype.hasOwnProperty.call(options, "signer") ? options.signer : Ed25519SigningProvider.generateForTest(),
    evidenceProvider: async () => [{
      provider: "coding-agent-skills", command: "repo-map+secret-audit",
      status: "pass", success: true, resultDigest: "test",
    }],
    ...options,
  });
}

function approval(transaction: RepositoryPatchTransaction): Approval {
  const prepared = transaction.prepared!;
  return {
    decision: "approved", approvedBy: "test-operator", approvedAt: new Date().toISOString(),
    transactionId: transaction.transactionId, actionDigest: transaction.actionDigest,
    intentDigest: digest(transaction.intent), target: transaction.action.repositoryRoot,
    beforeSha256: digest([...prepared.beforeManifest].sort((a, b) => a.path.localeCompare(b.path))),
    proposedSha256: digest([...prepared.afterManifest].sort((a, b) => a.path.localeCompare(b.path))),
    policyVersion: transaction.policyVersion, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: `nonce-${transaction.transactionId}`, originalTaskId: "operator-task",
    operatorApprovalTaskId: "operator-task", operatorDecisionId: "decision",
    approvedFromTaskId: "operator-task", approvalDecisionDigest: "digest",
    scope: "single_transaction",
  };
}

async function prepared(root: string, instance: RepositoryPatchAgentProof, selectedAction = action(root), selectedPolicy = policy(root)) {
  let transaction = await instance.preflight(selectedAction, {
    summary: "patch repository", requestedBy: "test", acceptanceCriteria: ["verified"],
  }, selectedPolicy);
  transaction = await instance.prepare(transaction.transactionId);
  return transaction;
}

test("applies a multi-file patch, verifies, signs, and compensates exactly", async () => {
  const root = await repository();
  const signer = Ed25519SigningProvider.generateForTest("repository-test");
  const instance = await service(root, { databasePath: path.join(await mkdtemp(path.join(tmpdir(), "ap-")), "db.sqlite"), signer });
  const transaction = await prepared(root, instance);
  assert.equal(transaction.state, "prepared");
  const [first, duplicate] = await Promise.all([
    instance.execute(transaction.transactionId, "same-key", approval(transaction)),
    instance.execute(transaction.transactionId, "same-key", approval(transaction)),
  ]);
  assert.ok(["executed", "executing"].includes(first.state) || ["executed", "executing"].includes(duplicate.state));
  const verified = await instance.verify(transaction.transactionId);
  assert.equal(verified.state, "verified", JSON.stringify({verification: verified.verification, prepared: verified.prepared}));
  assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "alpha changed\n");
  assert.equal(await readFile(path.join(root, "new.txt"), "utf8"), "new\n");
  const receipt = await instance.receipt(transaction.transactionId);
  const trust = verifyRepositoryPatchReceiptWithTrust(receipt, {
    trustedPublicKeyFingerprints: [publicKeyFingerprint(await signer.publicKeyPem())],
  });
  assert.deepEqual({ valid: trust.cryptographicallyValid, trusted: trust.trusted }, { valid: true, trusted: true });
  const compensated = await instance.compensate(transaction.transactionId);
  assert.equal(compensated.state, "compensated");
  assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "alpha\n");
  assert.equal(await readFile(path.join(root, "delete.txt"), "utf8"), "delete me\n");
  await assert.rejects(readFile(path.join(root, "new.txt")), /ENOENT/);
});

test("rejects dirty repository and file drift before mutation", async () => {
  const dirty = await repository();
  await writeFile(path.join(dirty, "a.txt"), "dirty\n");
  const dirtyService = await service(dirty);
  const blocked = await dirtyService.preflight(action(dirty), {
    summary: "x", requestedBy: "x", acceptanceCriteria: [],
  }, policy(dirty));
  assert.equal(blocked.lastError, "dirty_repository");

  const root = await repository();
  const instance = await service(root);
  const transaction = await prepared(root, instance);
  await writeFile(path.join(root, "a.txt"), "drift\n");
  const result = await instance.execute(transaction.transactionId, "drift", approval(transaction));
  assert.equal(result.state, "blocked");
  assert.equal(result.lastError, "dirty_repository");
});

test("rejects path escape, .git, undeclared new files, and secret-bearing content", async () => {
  for (const operation of [
    { kind: "write" as const, path: "../escape", contentBase64: Buffer.from("x").toString("base64"), newFile: true },
    { kind: "write" as const, path: ".git/config", contentBase64: Buffer.from("x").toString("base64"), newFile: true },
    { kind: "write" as const, path: "undeclared.txt", contentBase64: Buffer.from("x").toString("base64"), newFile: true },
    { kind: "write" as const, path: "new.txt", contentBase64: Buffer.from("-----BEGIN PRIVATE KEY-----").toString("base64"), newFile: true },
  ]) {
    const root = await repository();
    const instance = await service(root);
    const result = await instance.preflight({
      type: "agentproof.repository_patch.v1", repositoryRoot: root, operations: [operation],
    }, { summary: "x", requestedBy: "x", acceptanceCriteria: [] }, policy(root));
    assert.equal(result.state, "blocked");
  }
});

test("rejects symlink targets", async () => {
  const root = await repository();
  await symlink("a.txt", path.join(root, "link.txt"));
  await exec("git", ["-C", root, "add", "link.txt"]);
  await exec("git", ["-C", root, "commit", "-m", "symlink"]);
  const instance = await service(root);
  const result = await instance.preflight({
    type: "agentproof.repository_patch.v1", repositoryRoot: root,
    operations: [{ kind: "write", path: "link.txt", contentBase64: Buffer.from("x").toString("base64") }],
  }, { summary: "x", requestedBy: "x", acceptanceCriteria: [] }, {
    ...policy(root), allowedTrackedPaths: ["link.txt"],
  });
  assert.match(result.lastError ?? "", /symlink_target_blocked/);
});

test("detects false success and unexpected untracked files", async () => {
  const root = await repository();
  const instance = await service(root, {
    databasePath: path.join(await mkdtemp(path.join(tmpdir(), "ap-")), "db.sqlite"),
    signer: Ed25519SigningProvider.generateForTest(),
    executor: {
      async apply() {
        const now = new Date().toISOString();
        return { state: "executed", attemptedAt: now, completedAt: now, message: "false success" };
      },
    },
  });
  const transaction = await prepared(root, instance);
  await instance.execute(transaction.transactionId, "false", approval(transaction));
  assert.equal((await instance.verify(transaction.transactionId)).state, "failed");

  const root2 = await repository();
  const instance2 = await service(root2);
  const tx2 = await prepared(root2, instance2);
  await instance2.execute(tx2.transactionId, "unexpected", approval(tx2));
  await writeFile(path.join(root2, "surprise.txt"), "surprise");
  const result = await instance2.verify(tx2.transactionId);
  assert.equal(result.state, "failed");
  assert.deepEqual(result.verification?.unexpectedUntrackedPaths, ["surprise.txt"]);
});

test("runs verification commands in a disposable copy and stores only bounded digests", async () => {
  const root = await repository();
  const selected = action(root);
  selected.verificationCommands = [{
    executable: process.execPath,
    args: ["-e", "require('fs').writeFileSync('artifact.tmp','x'); console.log(Buffer.from('c2VjcmV0IHJhdyBvdXRwdXQ=','base64').toString())"],
    cwd: ".", timeoutMs: 5_000, maxOutputBytes: 8,
  }];
  const instance = await service(root);
  const tx = await prepared(root, instance, selected, {
    ...policy(root), allowedVerificationExecutables: [process.execPath],
    allowedVerificationWorkingDirectories: ["."],
  });
  await instance.execute(tx.transactionId, "verify-command", approval(tx));
  const result = await instance.verify(tx.transactionId);
  assert.equal(result.state, "verified");
  assert.equal(result.verification?.commands[0].truncated, true);
  await assert.rejects(readFile(path.join(root, "artifact.tmp")), /ENOENT/);
  assert.equal(JSON.stringify(result.verification?.commands[0]).includes("secret raw output"), false);
});

test("verification command failure and timeout fail verification", async () => {
  for (const args of [["-e", "process.exit(3)"], ["-e", "setTimeout(()=>{},10000)"]]) {
    const root = await repository();
    const selected = action(root);
    selected.verificationCommands = [{
      executable: process.execPath, args, cwd: ".",
      timeoutMs: args[1].includes("setTimeout") ? 50 : 5_000, maxOutputBytes: 100,
    }];
    const instance = await service(root);
    const tx = await prepared(root, instance, selected, {
      ...policy(root), allowedVerificationExecutables: [process.execPath],
      allowedVerificationWorkingDirectories: ["."],
    });
    await instance.execute(tx.transactionId, `command-${args[1]}`, approval(tx));
    assert.equal((await instance.verify(tx.transactionId)).state, "failed");
  }
});

test("untrusted and tampered receipts fail explicit trust policy", async () => {
  const root = await repository();
  const instance = await service(root);
  const tx = await prepared(root, instance);
  await instance.execute(tx.transactionId, "receipt", approval(tx));
  await instance.verify(tx.transactionId);
  const receipt = await instance.receipt(tx.transactionId);
  assert.equal(verifyRepositoryPatchReceiptWithTrust(receipt, { trustedPublicKeyFingerprints: [] }).reason, "valid_untrusted_signer");
  assert.equal(verifyRepositoryPatchReceiptWithTrust({ ...receipt, patchDigest: "tampered" }, { trustedPublicKeyFingerprints: [] }).reason, "invalid_signature");
});

test("signer and compensation failures remain explicit", async () => {
  const root = await repository();
  const instance = await service(root, {
    databasePath: path.join(await mkdtemp(path.join(tmpdir(), "ap-")), "db.sqlite"),
    signer: undefined,
    compensationWriter: async () => { throw new Error("restore failed"); },
  });
  const tx = await prepared(root, instance);
  await instance.execute(tx.transactionId, "failure", approval(tx));
  await instance.verify(tx.transactionId);
  await assert.rejects(instance.receipt(tx.transactionId), /signer_unavailable/);
  assert.equal((await instance.compensate(tx.transactionId)).state, "escalation_required");
});


test("rejects changed base commit after approval", async () => {
  const root = await repository();
  const instance = await service(root);
  const tx = await prepared(root, instance);
  await writeFile(path.join(root, "later.txt"), "later\n");
  await exec("git", ["-C", root, "add", "later.txt"]);
  await exec("git", ["-C", root, "commit", "-m", "changed base"]);
  const result = await instance.execute(tx.transactionId, "changed-base", approval(tx));
  assert.equal(result.state, "blocked");
  assert.equal(result.lastError, "repository_identity_drift");
});

test("rejects a gitlink submodule path", async () => {
  const root = await repository();
  const head = (await exec("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
  await exec("git", ["-C", root, "update-index", "--add", "--cacheinfo", `160000,${head},vendor`]);
  await exec("git", ["-C", root, "commit", "-m", "gitlink"]);
  const instance = await service(root);
  const result = await instance.preflight({
    type: "agentproof.repository_patch.v1", repositoryRoot: root,
    operations: [{ kind: "delete", path: "vendor" }],
  }, { summary: "x", requestedBy: "x", acceptanceCriteria: [] }, {
    ...policy(root), allowedTrackedPaths: ["vendor"],
  });
  assert.match(result.lastError ?? "", /submodule_path_blocked/);
});

test("restart reconciliation verifies a post-mutation crash without reapplying", async () => {
  const root = await repository();
  let crash = true;
  const instance = await service(root, {
    databasePath: path.join(await mkdtemp(path.join(tmpdir(), "ap-")), "db.sqlite"),
    signer: Ed25519SigningProvider.generateForTest(),
    faults: { afterMutation() { if (crash) { crash = false; throw new Error("simulated_crash_after_mutation"); } } },
  });
  const tx = await prepared(root, instance);
  await assert.rejects(instance.execute(tx.transactionId, "crash-after", approval(tx)), /simulated_crash/);
  assert.deepEqual(await instance.reconcileIncomplete(), [`${tx.transactionId}:executing->verified`]);
  assert.ok(await instance.store.getReceipt(tx.transactionId));
  assert.equal(await readFile(path.join(root, "a.txt"), "utf8"), "alpha changed\n");
});


test("reconciles crashes before mutation and during partial application without retry", async () => {
  const beforeRoot = await repository();
  const beforeService = await service(beforeRoot, {
    databasePath: path.join(await mkdtemp(path.join(tmpdir(), "ap-")), "db.sqlite"),
    signer: Ed25519SigningProvider.generateForTest(),
    executor: { async apply() { throw new Error("simulated_crash_before_mutation"); } },
  });
  const beforeTx = await prepared(beforeRoot, beforeService);
  await assert.rejects(beforeService.execute(beforeTx.transactionId, "before-crash", approval(beforeTx)), /simulated_crash/);
  assert.deepEqual(await beforeService.reconcileIncomplete(), [`${beforeTx.transactionId}:executing->failed`]);
  assert.equal(await readFile(path.join(beforeRoot, "a.txt"), "utf8"), "alpha\n");

  const partialRoot = await repository();
  const partialService = await service(partialRoot, {
    databasePath: path.join(await mkdtemp(path.join(tmpdir(), "ap-")), "db.sqlite"),
    signer: Ed25519SigningProvider.generateForTest(),
    executor: { async apply() {
      await writeFile(path.join(partialRoot, "a.txt"), "alpha changed\n");
      throw new Error("simulated_crash_partial_application");
    } },
  });
  const partialTx = await prepared(partialRoot, partialService);
  await assert.rejects(partialService.execute(partialTx.transactionId, "partial-crash", approval(partialTx)), /simulated_crash/);
  assert.deepEqual(await partialService.reconcileIncomplete(), [`${partialTx.transactionId}:executing->failed`]);
  assert.equal((await partialService.store.get(partialTx.transactionId)).state, "failed");
});
