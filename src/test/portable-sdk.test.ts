import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  AgentProofPortableError,
  EXIT_CODES,
  createApprovalRequest,
  executeApprovedTransaction,
  prepareRepositoryPatch,
  signingProviderFromPrivateKeyPem,
} from "../portable.js";
import {
  createDevelopmentApprovalDecision,
  createDevelopmentKeyPair,
} from "../portable-development-authority.js";
import type { ExecutionRequestDocument, RepositoryPatchRequestDocument } from "../portable-protocol.js";

const exec = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agentproof-portable-test-"));
  const repo = path.join(root, "repo");
  await exec("git", ["init", "-b", "main", repo]);
  await exec("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  await exec("git", ["-C", repo, "config", "user.name", "Portable Test"]);
  await writeFile(path.join(repo, "a.txt"), "a\n");
  await exec("git", ["-C", repo, "add", "."]);
  await exec("git", ["-C", repo, "commit", "-m", "base"]);
  const request: RepositoryPatchRequestDocument = {
    schema: "agentproof.protocol.repository-patch-request",
    schemaVersion: "1.0.0",
    actionType: "agentproof.repository_patch.v1",
    correlationId: "portable-test",
    stateDirectory: path.join(root, "state"),
    action: {
      type: "agentproof.repository_patch.v1", repositoryRoot: repo,
      operations: [{ kind: "write", path: "a.txt", contentBase64: Buffer.from("changed\n").toString("base64") }],
    },
    intent: { summary: "test", requestedBy: "test", acceptanceCriteria: ["verified"] },
    policy: { allowedRepositoryRoot: repo, allowedTrackedPaths: ["a.txt"], allowedNewPaths: [], maxPatchBytes: 1000, maxFiles: 1 },
  };
  return { root, repo, request };
}

test("rejects invalid schema, version, and action before mutation", async () => {
  const { request } = await fixture();
  for (const altered of [
    { ...request, schema: "wrong" },
    { ...request, schemaVersion: "2.0.0" },
    { ...request, actionType: "unknown.action" },
  ]) {
    await assert.rejects(
      prepareRepositoryPatch(altered as RepositoryPatchRequestDocument),
      (error: unknown) => error instanceof AgentProofPortableError &&
        error.exitCode === EXIT_CODES.invalidInput,
    );
  }
});

test("development approval cannot satisfy production policy and altered preparation fails", async () => {
  const { request } = await fixture();
  const prepared = await prepareRepositoryPatch(request);
  const approvalRequest = await createApprovalRequest(prepared, {
    expiresAt: new Date(Date.now() + 60_000).toISOString(), nonce: "portable-nonce",
  });
  const authority = createDevelopmentKeyPair();
  const signer = createDevelopmentKeyPair();
  const decision = createDevelopmentApprovalDecision({
    request: approvalRequest, decision: "approved", issuer: "dev",
    privateKeyPem: authority.privateKeyPem, developmentMode: true,
  });
  const execution: ExecutionRequestDocument = {
    schema: "agentproof.protocol.execution-request", schemaVersion: "1.0.0",
    actionType: "agentproof.repository_patch.v1", correlationId: prepared.correlationId,
    transactionId: prepared.transactionId, stateDirectory: prepared.stateDirectory,
    idempotencyKey: "portable-execute", requiredAuthorityEnvironment: "production",
    trustedAuthorityFingerprints: [authority.fingerprint], approvalDecision: decision,
  };
  await assert.rejects(
    executeApprovedTransaction(execution, {
      receiptSigner: signingProviderFromPrivateKeyPem("test", signer.privateKeyPem),
    }),
    (error: unknown) => error instanceof AgentProofPortableError &&
      error.code === "approval_scope_mismatch",
  );
  await assert.rejects(
    createApprovalRequest({ ...prepared, preparedDigest: "altered" }, {
      expiresAt: new Date(Date.now() + 60_000).toISOString(), nonce: "altered",
    }),
    /Prepared transaction digest/,
  );
});

test("denied and expired development approvals have stable exit mappings", async () => {
  for (const mode of ["denied", "expired"] as const) {
    const { request } = await fixture();
    const prepared = await prepareRepositoryPatch(request);
    const approvalRequest = await createApprovalRequest(prepared, {
      expiresAt: mode === "expired"
        ? new Date(Date.now() - 1_000).toISOString()
        : new Date(Date.now() + 60_000).toISOString(),
      nonce: `nonce-${mode}`,
    });
    const authority = createDevelopmentKeyPair();
    const signer = createDevelopmentKeyPair();
    const decision = createDevelopmentApprovalDecision({
      request: approvalRequest, decision: mode === "denied" ? "denied" : "approved",
      issuer: "dev", privateKeyPem: authority.privateKeyPem, developmentMode: true,
    });
    const execution: ExecutionRequestDocument = {
      schema: "agentproof.protocol.execution-request", schemaVersion: "1.0.0",
      actionType: "agentproof.repository_patch.v1", correlationId: prepared.correlationId,
      transactionId: prepared.transactionId, stateDirectory: prepared.stateDirectory,
      idempotencyKey: `execute-${mode}`, requiredAuthorityEnvironment: "development",
      trustedAuthorityFingerprints: [authority.fingerprint], approvalDecision: decision,
    };
    await assert.rejects(
      executeApprovedTransaction(execution, {
        receiptSigner: signingProviderFromPrivateKeyPem("test", signer.privateKeyPem),
      }),
      (error: unknown) => error instanceof AgentProofPortableError &&
        error.exitCode === (mode === "denied" ? EXIT_CODES.approvalDenied : EXIT_CODES.staleOrAlteredApproval),
    );
  }
});
