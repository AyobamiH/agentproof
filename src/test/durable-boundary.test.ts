import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { approvalFromOperatorReplay, createOperatorApprovalRequest, operatorDecisionDigest } from "../approval.js";
import { AgentProof } from "../service.js";
import { Ed25519SigningProvider, verifySignedReceiptOffline, type SigningProvider } from "../signer.js";
import { sha256 } from "../hash.js";
import type { AgentProofTransaction, ExecutionResult, FileExecutor, ReadOnlyEvidence } from "../types.js";

const evidence: ReadOnlyEvidence[] = [{
  provider: "coding-agent-skills", command: "repo-map", status: "complete",
  success: true, resultDigest: "durable-test-evidence",
}];
const intent = {
  summary: "Apply one approved exact local file change.",
  requestedBy: "durable-boundary-test",
  acceptanceCriteria: ["prepared bytes exist at the exact target"],
};

async function fixture(options: {
  executor?: FileExecutor;
  signer?: SigningProvider;
  faults?: { afterMutation?: () => void; afterVerification?: () => void };
  compensationWriter?: (transaction: AgentProofTransaction) => Promise<void>;
} = {}) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentproof-durable-project-"));
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agentproof-durable-state-"));
  await mkdir(path.join(projectRoot, "config"));
  await writeFile(path.join(projectRoot, "config", "service.json"), "before\n");
  const databasePath = path.join(stateRoot, "agentproof", "agentproof.sqlite");
  const signer = options.signer ?? Ed25519SigningProvider.generateForTest();
  const service = new AgentProof({
    databasePath, executor: options.executor, signer, faults: options.faults,
    compensationWriter: options.compensationWriter,
    evidenceProvider: async () => evidence,
  });
  const action = {
    type: "replace_file" as const,
    root: projectRoot,
    target: "config/service.json",
    content: "after\n",
  };
  const constraints = {
    allowedRoot: projectRoot,
    allowedTargets: [action.target],
    expectedBeforeSha256: sha256("before\n"),
    maxWriteBytes: 1024,
    maxSnapshotBytes: 1024,
  };
  return { projectRoot, stateRoot, databasePath, signer, service, action, constraints };
}

async function prepared(f: Awaited<ReturnType<typeof fixture>>) {
  let transaction = await f.service.preflight(f.action, intent, f.constraints);
  return f.service.prepare(transaction.transactionId);
}

function operatorApproval(transaction: AgentProofTransaction, options: {
  expiresAt?: string; taskId?: string; mutate?: (payload: Record<string, unknown>) => void;
} = {}) {
  const request = createOperatorApprovalRequest(transaction, {
    expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
  });
  options.mutate?.(request.payload.agentProof);
  const record = {
    taskId: options.taskId ?? "operator-approval-" + transaction.transactionId,
    type: request.type,
    payload: request.payload,
    requestedAt: new Date().toISOString(),
    status: "approved" as const,
    decidedAt: new Date().toISOString(),
    decidedBy: "operator-test",
  };
  return approvalFromOperatorReplay(transaction, record, { approvedFromTaskId: record.taskId, approvalDecisionDigest: operatorDecisionDigest(record), approvalDecisionId: "approval-decision:" + operatorDecisionDigest(record) });
}

class CountingExecutor implements FileExecutor {
  calls = 0;
  constructor(private readonly mode: "write" | "lie" = "write", private readonly delayMs = 0) {}
  async replace(target: string, content: Buffer): Promise<ExecutionResult> {
    this.calls += 1;
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.mode === "write") await writeFile(target, content);
    const now = new Date().toISOString();
    return { state: "executed", executor: "agentproof-local-file-executor",
      attemptedAt: now, completedAt: now, message: this.mode };
  }
}

test("atomically admits one of two concurrent duplicate executions", async () => {
  const executor = new CountingExecutor("write", 50);
  const f = await fixture({ executor });
  const transaction = await prepared(f);
  const approval = operatorApproval(transaction);
  const results = await Promise.all([
    f.service.execute(transaction.transactionId, "concurrent-key", approval),
    f.service.execute(transaction.transactionId, "concurrent-key", approval),
  ]);
  assert.equal(executor.calls, 1);
  assert.equal(results[0].transactionId, results[1].transactionId);
  assert.equal(await readFile(path.join(f.projectRoot, f.action.target), "utf8"), "after\n");
});

test("survives process restart after preparation", async () => {
  const f = await fixture({ executor: new CountingExecutor() });
  const transaction = await prepared(f);
  const restarted = new AgentProof({ databasePath: f.databasePath, executor: new CountingExecutor(),
    signer: f.signer, evidenceProvider: async () => evidence });
  const restored = await restarted.store.get(transaction.transactionId);
  assert.equal(restored.state, "prepared");
  const executed = await restarted.execute(restored.transactionId, "restart-prepared", operatorApproval(restored));
  assert.equal(executed.state, "executed");
});

test("reconciles crash after mutation before verification", async () => {
  const executor = new CountingExecutor();
  const f = await fixture({ executor, faults: { afterMutation: () => { throw new Error("simulated_crash_after_mutation"); } } });
  const transaction = await prepared(f);
  await assert.rejects(
    f.service.execute(transaction.transactionId, "crash-after-mutation", operatorApproval(transaction)),
    /simulated_crash_after_mutation/,
  );
  assert.equal((await f.service.store.get(transaction.transactionId)).state, "executing");
  const restarted = new AgentProof({ databasePath: f.databasePath, signer: f.signer,
    evidenceProvider: async () => evidence });
  const reconciled = await restarted.reconcileIncomplete();
  assert.match(reconciled[0].action, /mutation_observed_and_verified_and_receipt_signed/);
  assert.equal((await restarted.store.get(transaction.transactionId)).state, "verified");
  assert.ok(await restarted.store.getReceipt(transaction.transactionId));
});

test("reconciles crash after verification before receipt persistence", async () => {
  const f = await fixture({ executor: new CountingExecutor(), faults: {
    afterVerification: () => { throw new Error("simulated_crash_after_verification"); },
  } });
  let transaction = await prepared(f);
  transaction = await f.service.execute(transaction.transactionId, "crash-after-verify", operatorApproval(transaction));
  await assert.rejects(f.service.verify(transaction.transactionId), /simulated_crash_after_verification/);
  assert.equal((await f.service.store.get(transaction.transactionId)).state, "verified");
  assert.equal(await f.service.store.getReceipt(transaction.transactionId), null);
  const restarted = new AgentProof({ databasePath: f.databasePath, signer: f.signer,
    evidenceProvider: async () => evidence });
  const reconciled = await restarted.reconcileIncomplete();
  assert.equal(reconciled[0].action, "receipt_signed");
  assert.ok(await restarted.store.getReceipt(transaction.transactionId));
});

test("rejects altered and expired Operator approvals", async () => {
  const f = await fixture();
  const transaction = await prepared(f);
  assert.throws(() => operatorApproval(transaction, {
    mutate: (payload) => { payload.target = path.join(f.projectRoot, "other.txt"); },
  }), /operator_approval_binding_mismatch/);
  assert.throws(() => operatorApproval(transaction, {
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  }), /operator_approval_expired/);
});

test("prevents approval replay and second execution", async () => {
  const executor = new CountingExecutor();
  const f = await fixture({ executor });
  let transaction = await prepared(f);
  const approval = operatorApproval(transaction);
  transaction = await f.service.execute(transaction.transactionId, "replay-first", approval);
  const replay = await f.service.execute(transaction.transactionId, "replay-second", approval);
  assert.equal(executor.calls, 1);
  assert.equal(replay.idempotencyKey, "replay-first");
});

test("blocks before-state drift without consuming authority", async () => {
  const f = await fixture({ executor: new CountingExecutor() });
  const transaction = await prepared(f);
  await writeFile(path.join(f.projectRoot, f.action.target), "drifted\n");
  const result = await f.service.execute(transaction.transactionId, "drift", operatorApproval(transaction));
  assert.equal(result.state, "blocked");
  assert.equal(result.idempotencyKey, null);
  assert.equal(result.lastError, "before_state_drift_before_execution");
});

test("independent verifier catches false-success and postcondition mismatch", async () => {
  const f = await fixture({ executor: new CountingExecutor("lie") });
  let transaction = await prepared(f);
  transaction = await f.service.execute(transaction.transactionId, "false-success-durable", operatorApproval(transaction));
  assert.equal(transaction.state, "executed");
  transaction = await f.service.verify(transaction.transactionId);
  assert.equal(transaction.state, "failed");
  assert.notEqual(transaction.verification?.observed.sha256, transaction.prepared?.expectedAfterSha256);
});

test("signed receipt verifies offline and tampering fails", async () => {
  const f = await fixture({ executor: new CountingExecutor() });
  let transaction = await prepared(f);
  transaction = await f.service.execute(transaction.transactionId, "signed-receipt", operatorApproval(transaction));
  transaction = await f.service.verify(transaction.transactionId);
  const receipt = await f.service.receipt(transaction.transactionId);
  assert.equal(verifySignedReceiptOffline(receipt), true);
  const tampered = structuredClone(receipt);
  tampered.intent.summary = "tampered";
  assert.equal(verifySignedReceiptOffline(tampered), false);
});

test("keeps verified state recoverable while signer is unavailable", async () => {
  const f = await fixture({ executor: new CountingExecutor() });
  let transaction = await prepared(f);
  transaction = await f.service.execute(transaction.transactionId, "no-signer", operatorApproval(transaction));
  transaction = await f.service.verify(transaction.transactionId);
  const noSigner = new AgentProof({ databasePath: f.databasePath, evidenceProvider: async () => evidence });
  await assert.rejects(noSigner.receipt(transaction.transactionId), /signer_unavailable/);
  assert.equal((await noSigner.store.get(transaction.transactionId)).state, "verified");
  const reconciliation = await noSigner.reconcileIncomplete();
  assert.equal(reconciliation[0].action, "signer_unavailable");
});

test("classifies failed compensation as escalation required", async () => {
  const f = await fixture({ executor: new CountingExecutor(), compensationWriter: async () => {
    throw new Error("injected_compensation_failure");
  } });
  let transaction = await prepared(f);
  transaction = await f.service.execute(transaction.transactionId, "failed-compensation", operatorApproval(transaction));
  transaction = await f.service.verify(transaction.transactionId);
  transaction = await f.service.compensate(transaction.transactionId);
  assert.equal(transaction.state, "escalation_required");
  assert.match(transaction.compensation!.message, /injected_compensation_failure/);
});

test("reconciles an interrupted execution with no mutation as failed", async () => {
  const f = await fixture({ executor: new CountingExecutor() });
  const transaction = await prepared(f);
  const approval = operatorApproval(transaction);
  const claim = await f.service.store.claimExecution(transaction.transactionId, "claimed-before-crash", approval);
  assert.equal(claim.claimed, true);
  const restarted = new AgentProof({ databasePath: f.databasePath, signer: f.signer,
    evidenceProvider: async () => evidence });
  const reconciliation = await restarted.reconcileIncomplete();
  assert.equal(reconciliation[0].action, "no_mutation_observed");
  assert.equal((await restarted.store.get(transaction.transactionId)).state, "failed");
});

test("default mutation runs in a separate process without authority or signing output", async () => {
  const f = await fixture();
  let transaction = await prepared(f);
  transaction = await f.service.execute(transaction.transactionId, "subprocess", operatorApproval(transaction));
  assert.equal(transaction.state, "executed");
  assert.notEqual(transaction.execution?.executorProcessId, process.pid);
  assert.equal("approval" in (transaction.execution as unknown as Record<string, unknown>), false);
  assert.equal("signature" in (transaction.execution as unknown as Record<string, unknown>), false);
});
