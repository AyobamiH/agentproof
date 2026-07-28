import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Ed25519SigningProvider, publicKeyFingerprint, verifyRepositoryPatchReceiptWithTrust } from "../src/index.js";
import { RepositoryPatchOperatorHarness } from "./repository-patch-harness.js";

const exec = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "agentproof-repository-demo-"));
const repository = path.join(root, "repository");
await exec("git", ["init", "-b", "main", repository]);
await exec("git", ["-C", repository, "config", "user.email", "demo@example.invalid"]);
await exec("git", ["-C", repository, "config", "user.name", "AgentProof Demo"]);
await writeFile(path.join(repository, "one.txt"), "one\n");
await writeFile(path.join(repository, "remove.txt"), "remove\n");
await exec("git", ["-C", repository, "add", "."]);
await exec("git", ["-C", repository, "commit", "-m", "temporary base"]);
const signer = Ed25519SigningProvider.generateForTest("repository-demo-key");
const harness = new RepositoryPatchOperatorHarness(path.join(root, "state"), signer);
await harness.initialize();
const prepared = await harness.prepare({
  type: "agentproof.repository_patch.v1", repositoryRoot: repository,
  operations: [
    { kind: "write", path: "one.txt", contentBase64: Buffer.from("changed\n").toString("base64") },
    { kind: "write", path: "created.txt", contentBase64: Buffer.from("created\n").toString("base64"), newFile: true },
    { kind: "delete", path: "remove.txt" },
  ],
}, {
  allowedRepositoryRoot: repository, allowedTrackedPaths: ["one.txt", "remove.txt"],
  allowedNewPaths: ["created.txt"], maxPatchBytes: 64000, maxFiles: 3,
});
const decision = await harness.approve(prepared.task.id);
const receipt = await harness.agentProof.receipt(prepared.transaction.transactionId);
const trust = verifyRepositoryPatchReceiptWithTrust(receipt, {
  trustedPublicKeyFingerprints: [publicKeyFingerprint(await signer.publicKeyPem())],
});
const compensation = await harness.agentProof.compensate(prepared.transaction.transactionId);
const status = (await exec("git", ["-C", repository, "status", "--porcelain"])).stdout;
console.log(JSON.stringify({ temporaryRoot: root, mutationCount: harness.mutationCount,
  operatorTaskId: prepared.task.id, approvalDecisionId: decision.decisionId,
  transactionId: receipt.transactionId, receiptDigest: receipt.receiptDigest,
  patchDigest: receipt.patchDigest, expectedDiffDigest: receipt.expectedDiffDigest,
  signerFingerprint: receipt.signature.signerFingerprint, trust,
  compensationState: compensation.state, repositoryCleanAfterCompensation: status === "",
}, null, 2));
