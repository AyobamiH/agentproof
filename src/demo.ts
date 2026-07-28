import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { approvalFromOperatorReplay, createOperatorApprovalRequest, operatorDecisionDigest } from "./approval.js";
import { AgentProof } from "./service.js";
import { Ed25519SigningProvider, verifySignedReceiptOffline } from "./signer.js";

const operatorRoot = path.resolve(import.meta.dirname, "..");
const target = "tmp/agentproof-demo/managed.txt";
const isolatedStateRoot = await mkdtemp(path.join(os.tmpdir(), "agentproof-demo-state-"));
const cliPath = process.env.CODING_AGENT_SKILLS_CLI ?? "coding-agent-skills";
await mkdir(path.join(operatorRoot, "tmp", "agentproof-demo"), { recursive: true });

const agentProof = new AgentProof({
  stateRoot: isolatedStateRoot,
  codingAgentSkillsCli: cliPath,
  signer: Ed25519SigningProvider.generateForTest("agentproof-demo-test-key"),
});

let transaction = await agentProof.preflight(
  { type: "replace_file", root: operatorRoot, target,
    content: "AgentProof verified this exact local postcondition.\n" },
  { summary: "Demonstrate an approved, bounded, verifiable local coding action.",
    requestedBy: "agentproof-local-demo",
    acceptanceCriteria: [
      "Only tmp/agentproof-demo/managed.txt changes",
      "Independent verification observes the prepared content hash",
      "Compensation restores the original absence or bytes",
    ] },
  { allowedRoot: operatorRoot, allowedTargets: [target], expectedBeforeSha256: null,
    maxWriteBytes: 1024, maxSnapshotBytes: 1024 },
);
if (transaction.state !== "approval_required") throw new Error("Demo preflight failed: " + transaction.state);
transaction = await agentProof.prepare(transaction.transactionId);
const request = createOperatorApprovalRequest(transaction, {
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
const operatorApproval = {
  taskId: "operator-approval-" + transaction.transactionId,
  type: request.type,
  payload: request.payload,
  requestedAt: new Date().toISOString(),
  status: "approved" as const,
  decidedAt: new Date().toISOString(),
  decidedBy: "agentproof-local-demo-operator",
};
const approval = approvalFromOperatorReplay(transaction, operatorApproval, {
  approvedFromTaskId: operatorApproval.taskId,
  approvalDecisionDigest: operatorDecisionDigest(operatorApproval),
  approvalDecisionId: "approval-decision:" + operatorDecisionDigest(operatorApproval),
});
transaction = await agentProof.execute(transaction.transactionId, "demo-" + transaction.transactionId, approval);
transaction = await agentProof.verify(transaction.transactionId);
if (transaction.state !== "verified") throw new Error("Verification failed: " + transaction.state);
const verifiedBytes = await readFile(path.join(operatorRoot, target), "utf8");
transaction = await agentProof.compensate(transaction.transactionId);
const receipt = await agentProof.receipt(transaction.transactionId);
const receiptPath = path.join(isolatedStateRoot, "signed-receipt.json");
await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
process.stdout.write(JSON.stringify({
  lifecycle: ["approval_required", "prepared", "executing", "executed", "verified", "compensated"],
  isolatedStateRoot,
  verifiedBytes,
  offlineSignatureValid: verifySignedReceiptOffline(receipt),
  receiptPath,
  receipt,
}, null, 2) + "\n");
