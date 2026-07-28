import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentProof } from "../service.js";
import { digest, sha256 } from "../hash.js";
import { Ed25519SigningProvider } from "../signer.js";
import type {
  Approval,
  ExecutionResult,
  FileExecutor,
  ReadOnlyEvidence,
  ReplaceFileAction,
} from "../types.js";

const evidence: ReadOnlyEvidence[] = [
  {
    provider: "coding-agent-skills",
    command: "repo-map",
    status: "complete",
    success: true,
    resultDigest: "fixture-repo-map-digest",
  },
  {
    provider: "coding-agent-skills",
    command: "secret-audit",
    status: "complete",
    success: true,
    resultDigest: "fixture-secret-audit-digest",
  },
];

async function fixture(executor?: FileExecutor) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentproof-test-root-"));
  const storeRoot = await mkdtemp(path.join(os.tmpdir(), "agentproof-test-store-"));
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "config", "service.json"), '{"enabled":false}\n');
  const service = new AgentProof({
    databasePath: path.join(storeRoot, "agentproof.sqlite"),
    executor,
    evidenceProvider: async () => evidence,
    signer: Ed25519SigningProvider.generateForTest(),
  });
  const action: ReplaceFileAction = {
    type: "replace_file",
    root,
    target: "config/service.json",
    content: '{"enabled":true}\n',
  };
  return { root, service, action };
}

function constraints(root: string, before = sha256('{"enabled":false}\n')) {
  return {
    allowedRoot: root,
    allowedTargets: ["config/service.json"],
    expectedBeforeSha256: before,
    maxWriteBytes: 1024,
    maxSnapshotBytes: 1024,
  };
}

const intent = {
  summary: "Enable the disposable local service fixture.",
  requestedBy: "agentproof-test",
  acceptanceCriteria: ["config/service.json contains the approved exact bytes"],
};

function approve(transaction: import("../types.js").AgentProofTransaction): Approval {
  return {
    decision: "approved",
    approvedBy: "local-test-operator",
    approvedAt: new Date().toISOString(),
    transactionId: transaction.transactionId,
    actionDigest: transaction.actionDigest,
    intentDigest: digest(transaction.intent),
    target: transaction.canonicalTarget,
    beforeSha256: transaction.prepared!.before.sha256,
    proposedSha256: transaction.prepared!.expectedAfterSha256,
    policyVersion: transaction.policyDecision.policyId,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    nonce: "nonce-" + transaction.transactionId,
    originalTaskId: "approval-" + transaction.transactionId,
    operatorApprovalTaskId: "approval-" + transaction.transactionId,
    operatorDecisionId: "approval-decision-" + transaction.transactionId,
    approvedFromTaskId: "approval-" + transaction.transactionId,
    approvalDecisionDigest: "decision-digest-" + transaction.transactionId,
    scope: "single_transaction",
  };
}

test("runs the consequential file action through verification and compensation", async () => {
  const { root, service, action } = await fixture();
  let transaction = await service.preflight(action, intent, constraints(root));
  assert.equal(transaction.state, "approval_required");
  assert.deepEqual(
    transaction.readOnlyEvidence.map((item) => item.command),
    ["repo-map", "secret-audit"],
  );

  transaction = await service.prepare(transaction.transactionId);
  assert.equal(transaction.state, "prepared");
  assert.match(transaction.prepared!.diff, /\+\{"enabled":true\}/);

  transaction = await service.execute(
    transaction.transactionId,
    "e2e-idempotency-key",
    approve(transaction),
  );
  assert.equal(transaction.state, "executed");

  transaction = await service.verify(transaction.transactionId);
  assert.equal(transaction.state, "verified");
  assert.equal(
    await readFile(path.join(root, "config", "service.json"), "utf8"),
    '{"enabled":true}\n',
  );

  transaction = await service.compensate(transaction.transactionId);
  assert.equal(transaction.state, "compensated");
  assert.equal(
    await readFile(path.join(root, "config", "service.json"), "utf8"),
    '{"enabled":false}\n',
  );

  const receipt = await service.receipt(transaction.transactionId);
  assert.equal(receipt.verification?.state, "verified");
  assert.equal(receipt.compensation?.state, "compensated");
  assert.equal(receipt.idempotencyKey, "e2e-idempotency-key");
  assert.equal(receipt.receiptDigest.length, 64);
});

test("blocks a wrong target before preparation or execution", async () => {
  const { root, service, action } = await fixture();
  action.target = "../wrong-target.txt";
  const transaction = await service.preflight(action, intent, constraints(root));
  assert.equal(transaction.state, "blocked");
  assert.ok(transaction.policyDecision.reasons.includes("target_outside_root"));
  assert.equal(transaction.execution, null);
});

test("records failed execution without claiming success", async () => {
  const failingExecutor: FileExecutor = {
    async replace(): Promise<ExecutionResult> {
      const now = new Date().toISOString();
      return {
        state: "failed",
        executor: "agentproof-local-file-executor",
        attemptedAt: now,
        completedAt: now,
        message: "Injected write failure.",
      };
    },
  };
  const { root, service, action } = await fixture(failingExecutor);
  let transaction = await service.preflight(action, intent, constraints(root));
  transaction = await service.prepare(transaction.transactionId);
  transaction = await service.execute(
    transaction.transactionId,
    "failed-execution-key",
    approve(transaction),
  );
  assert.equal(transaction.state, "failed");
  assert.equal(transaction.execution?.message, "Injected write failure.");
});

test("independent verification catches an executor false-success", async () => {
  const lyingExecutor: FileExecutor = {
    async replace(): Promise<ExecutionResult> {
      const now = new Date().toISOString();
      return {
        state: "executed",
        executor: "agentproof-local-file-executor",
        attemptedAt: now,
        completedAt: now,
        message: "Claimed success without changing the target.",
      };
    },
  };
  const { root, service, action } = await fixture(lyingExecutor);
  let transaction = await service.preflight(action, intent, constraints(root));
  transaction = await service.prepare(transaction.transactionId);
  transaction = await service.execute(
    transaction.transactionId,
    "false-success-key",
    approve(transaction),
  );
  assert.equal(transaction.state, "executed");
  transaction = await service.verify(transaction.transactionId);
  assert.equal(transaction.state, "failed");
  assert.notEqual(
    transaction.verification?.observed.sha256,
    transaction.verification?.expectedSha256,
  );
});

test("returns the original transaction for a duplicate retry", async () => {
  let calls = 0;
  const countingExecutor: FileExecutor = {
    async replace(target, content): Promise<ExecutionResult> {
      calls += 1;
      await writeFile(target, content);
      const now = new Date().toISOString();
      return {
        state: "executed",
        executor: "agentproof-local-file-executor",
        attemptedAt: now,
        completedAt: now,
        message: "Counted execution.",
      };
    },
  };
  const { root, service, action } = await fixture(countingExecutor);
  let first = await service.preflight(action, intent, constraints(root));
  first = await service.prepare(first.transactionId);
  first = await service.execute(
    first.transactionId,
    "duplicate-key",
    approve(first),
  );

  const secondAction = { ...action, content: '{"enabled":"different"}\n' };
  let second = await service.preflight(secondAction, intent, {
    ...constraints(root),
    expectedBeforeSha256: sha256('{"enabled":true}\n'),
  });
  second = await service.prepare(second.transactionId);
  second = await service.execute(
    second.transactionId,
    "duplicate-key",
    approve(second),
  );

  assert.equal(calls, 1);
  assert.equal(second.transactionId, first.transactionId);
  assert.equal(await readFile(path.join(root, "config", "service.json"), "utf8"), action.content);
});

test("honestly classifies an approved oversized before-state as non-compensable", async () => {
  const { root, service, action } = await fixture();
  const target = path.join(root, action.target);
  await writeFile(target, "large-before-state");
  let transaction = await service.preflight(action, intent, {
    ...constraints(root, sha256("large-before-state")),
    maxSnapshotBytes: 1,
    allowNonCompensable: true,
  });
  assert.equal(transaction.state, "approval_required");
  transaction = await service.prepare(transaction.transactionId);
  assert.equal(transaction.prepared?.compensation, "non_compensable");
  transaction = await service.compensate(transaction.transactionId);
  assert.equal(transaction.state, "non_compensable");
});
