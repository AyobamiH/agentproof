import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Ed25519SigningProvider,
  publicKeyFingerprint,
  verifySignedReceiptWithTrust,
} from "../src/index.js";
import { CanonicalOperatorHarness } from "./harness.js";

const stateRoot = await mkdtemp(path.join(tmpdir(), "agentproof-operator-demo-"));
const signer = Ed25519SigningProvider.generateForTest("agentproof-local-demo");
const harness = new CanonicalOperatorHarness({ stateRoot, signer });
await harness.initialize();

const prepared = await harness.prepare("approved-change.txt", null, "approved\n");
const replay = await harness.decide(prepared.operatorTask.id, "approved", "demo-operator");
const receipt = await harness.agentProof.receipt(prepared.transaction.transactionId);
const fingerprint = publicKeyFingerprint(await signer.publicKeyPem());
const trust = verifySignedReceiptWithTrust(receipt, {
  trustedPublicKeyFingerprints: [fingerprint],
});
const compensated = await harness.agentProof.compensate(prepared.transaction.transactionId);
let targetAbsent = false;
try {
  await access(path.join(harness.targetRoot, "approved-change.txt"));
} catch {
  targetAbsent = true;
}

console.log(JSON.stringify({
  isolation: {
    temporaryStateRoot: stateRoot,
    operatorDatabasePath: harness.operatorDatabasePath,
    agentProofDatabasePath: harness.agentProofDatabasePath,
  },
  operator: {
    originalTaskId: prepared.operatorTask.id,
    approvalStatus: replay.approval.status,
    replayTaskId: replay.replayTaskId,
    decisionId: replay.decisionId,
  },
  agentProof: {
    transactionId: prepared.transaction.transactionId,
    mutations: harness.mutationCount,
    receiptDigest: receipt.receiptDigest,
    receiptState: receipt.state,
    trust,
    compensationState: compensated.state,
    targetAbsent,
  },
}, null, 2));
