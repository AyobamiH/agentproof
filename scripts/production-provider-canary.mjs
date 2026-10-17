#!/usr/bin/env node
// Runs only in the exact reviewed GitHub OIDC workflow. Engineering evidence, never independent adoption.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, rm, open } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { createHash } from "node:crypto";
import { createApprovalRequest, prepareRepositoryPatch, executeApprovedTransaction, getTransactionStatus,
  reconcileRepositoryPatch, compensateRepositoryPatchWithReceipt, verifyReceipt } from "../dist/portable.js";
import { createProductionApprovalClient } from "../dist/portable-production-providers.js";
import { githubToken, remoteReceiptSigner } from "./lib/production-provider-client.mjs";

const exec = promisify(execFile), args = process.argv.slice(2);
assert.equal(args.length, 2, "usage: production-provider-canary.mjs <public-trust.json> <new-report.json>");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.GITHUB_REPOSITORY, "AyobamiH/agentproof");
assert.equal(process.env.GITHUB_REF, "refs/heads/main");
const trust = JSON.parse(await readFile(args[0], "utf8"));
const reportHandle = await open(args[1], "wx", 0o600);
const runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT;
assert.match(runId ?? "", /^\d{1,20}$/); assert.match(attempt ?? "", /^\d{1,4}$/);
const root = `/tmp/agentproof-production-canary-${runId}-${attempt}`, repo = root + "/repository", stateDirectory = root + "/state";
const correlationId = `production-canary:${runId}-${attempt}`;
const report = { schema: "agentproof.production-provider-canary.v1", status: "FAIL", startedAt: new Date().toISOString(),
  sourceCommit: process.env.GITHUB_SHA, workflowRun: `https://github.com/AyobamiH/agentproof/actions/runs/${runId}`,
  authorityScope: "one disposable repository-patch in a pinned workflow", independentAdoptionCredit: 0,
  custody: "cloudflare-encrypted-worker-secret", hardwareCustodyProven: false, checks: [] };
let created = false;
const check = async (name, fn) => {
  report.activeCheck = name;
  const value = await fn(); report.checks.push({ name, status: "PASS" }); delete report.activeCheck; return value;
};
const token = endpoint => signal => githubToken(new URL(endpoint).origin, signal);
async function rejected(endpoint, body, getToken, expected) {
  const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { "content-type": "application/json", ...(getToken ? { Authorization: "Bearer " + await getToken(AbortSignal.timeout(15_000)) } : {}) },
    body: JSON.stringify(body) });
  assert.equal(response.status, expected);
}
try {
  for (const endpoint of [trust.approval.endpoint, trust.receipt.endpoint]) {
    await check("deployed_exact_source:" + new URL(endpoint).hostname, async () => {
      const response = await fetch(new URL("/health", endpoint), { redirect: "error", signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 200); const health = await response.json();
      assert.equal(health.enabled, true); assert.equal(health.sourceCommit, process.env.GITHUB_SHA);
    });
    await check("reject_unauthenticated:" + new URL(endpoint).hostname, () => rejected(endpoint, {}, null, 401));
  }
  await check("reject_cross_service_token", () => rejected(trust.receipt.endpoint, {}, token(trust.approval.endpoint), 401));
  await mkdir(root); created = true; await mkdir(repo);
  const gitConfig = root + "/empty.gitconfig"; await writeFile(gitConfig, "");
  const env = { PATH: process.env.PATH, LANG: "C.UTF-8", GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
  const git = argv => exec("git", ["-C", repo, ...argv], { env, timeout: 30_000 });
  await git(["init", "-b", "main"]); await git(["config", "user.name", "AgentProof Canary"]);
  await git(["config", "user.email", "canary@example.invalid"]);
  await writeFile(path.join(repo, "canary.txt"), "before\n"); await git(["add", "canary.txt"]);
  await git(["-c", "commit.gpgsign=false", "commit", "-m", "disposable baseline"]);
  const prepared = await check("prepare_exact_patch", () => prepareRepositoryPatch({
    schema: "agentproof.protocol.repository-patch-request", schemaVersion: "1.0.0", actionType: "agentproof.repository_patch.v1",
    correlationId, stateDirectory,
    action: { type: "agentproof.repository_patch.v1", repositoryRoot: repo,
      operations: [{ kind: "write", path: "canary.txt", contentBase64: Buffer.from("after\n").toString("base64") }] },
    intent: { summary: "Production provider canary: replace one disposable tracked file", requestedBy: "agentproof-production-canary",
      acceptanceCriteria: ["canary.txt contains after followed by a newline"] },
    policy: { allowedRepositoryRoot: repo, allowedTrackedPaths: ["canary.txt"], allowedNewPaths: [], maxPatchBytes: 1024, maxFiles: 1 },
  }));
  const request = await createApprovalRequest(prepared, { expiresAt: new Date(Date.now() + 300_000).toISOString(), nonce: correlationId });
  await check("reject_wrong_request", () => rejected(trust.approval.endpoint,
    { ...request, correlationId: "unapproved" }, token(trust.approval.endpoint), 403));
  const authority = createProductionApprovalClient({ endpoint: trust.approval.endpoint,
    expectedIssuer: trust.approval.issuer, trustedAuthorityFingerprints: [trust.approval.fingerprint], getToken: token(trust.approval.endpoint), timeoutMs: 30_000 });
  const approvalDecision = await check("live_production_approval", () => authority.requestApproval(request));
  await check("durable_approval_retry", async () => {
    const responses = await Promise.all([authority.requestApproval(request), authority.requestApproval(request)]);
    for (const response of responses) assert.deepEqual(response, approvalDecision);
  });
  const signerArgs = { ...trust.receipt, approvalDecision, getToken: token(trust.receipt.endpoint) };
  const signer = remoteReceiptSigner(signerArgs);
  const execution = { schema: "agentproof.protocol.execution-request", schemaVersion: "1.0.0", actionType: "agentproof.repository_patch.v1",
    correlationId, transactionId: prepared.transactionId, stateDirectory, idempotencyKey: correlationId,
    requiredAuthorityEnvironment: "production", trustedAuthorityFingerprints: [trust.approval.fingerprint], approvalDecision };
  await check("reject_development_environment_before_mutation", async () => {
    await assert.rejects(executeApprovedTransaction({ ...execution, approvalDecision: { ...approvalDecision, authorityEnvironment: "development" } }, { receiptSigner: signer }));
    assert.equal(await readFile(path.join(repo, "canary.txt"), "utf8"), "before\n");
  });
  const query = { correlationId, transactionId: prepared.transactionId, stateDirectory };
  await check("recoverable_lost_signing_response", async () => {
    const lostResponse = { ...signer, async signCanonical(input) {
      await signer.signCanonical(input);
      report.discardedResponsePayloadDigest = createHash("sha256").update(input).digest("hex");
      throw new Error("canary_discarded_response");
    } };
    await assert.rejects(executeApprovedTransaction(execution, { receiptSigner: lostResponse }), /canary_discarded_response/);
    assert.equal((await getTransactionStatus(query)).state, "verified");
    assert.equal(await readFile(path.join(repo, "canary.txt"), "utf8"), "after\n");
  });
  const receipt = await check("reconcile_without_reexecution", () => reconcileRepositoryPatch({ ...query, authorityEnvironment: "production" }, { receiptSigner: signer }));
  await check("independent_offline_cli_verification", async () => {
    const file = root + "/receipt.json"; await writeFile(file, JSON.stringify(receipt));
    const result = await exec(process.execPath, [path.resolve("dist/cli.js"), "verify-receipt", "--input", file,
      "--trust-fingerprint", trust.receipt.fingerprint, "--required-authority-environment", "production"], { env, timeout: 30_000 });
    assert.equal(JSON.parse(result.stdout).trusted, true);
  });
  await check("exactly_once_retry_without_signing", async () => {
    const unavailable = { ...signer, signCanonical: async () => { throw new Error("must_not_sign_again"); } };
    assert.deepEqual(await executeApprovedTransaction(execution, { receiptSigner: unavailable }), receipt);
  });
  await check("reject_altered_authority_at_signer", () => rejected(trust.receipt.endpoint,
    { payload: receipt.payload, approvalDecision: { ...approvalDecision, issuer: "wrong" }, predecessorChain: [] }, token(trust.receipt.endpoint), 403));
  const successor = await check("authenticated_compensation", () => compensateRepositoryPatchWithReceipt({ ...query, authorityEnvironment: "production" },
    { receiptSigner: remoteReceiptSigner({ ...signerArgs, predecessorChain: [receipt] }), trustedSignerFingerprints: [trust.receipt.fingerprint] }));
  await check("offline_successor_chain_and_restored_repository", async () => {
    assert.equal(verifyReceipt({ document: successor, predecessorChain: [receipt], trustedSignerFingerprints: [trust.receipt.fingerprint], requiredAuthorityEnvironment: "production" }).trusted, true);
    assert.equal(verifyReceipt({ document: successor, trustedSignerFingerprints: [trust.receipt.fingerprint] }).trusted, false);
    assert.equal(await readFile(path.join(repo, "canary.txt"), "utf8"), "before\n");
    assert.equal((await git(["status", "--porcelain"])).stdout.trim(), "");
  });
  report.approval = approvalDecision; report.receipts = [receipt, successor]; report.status = "PASS";
} catch (error) {
  report.failure = { code: /^[a-z_]+$/.test(error?.code ?? "") ? error.code : "canary_failed" };
  process.exitCode = 1;
} finally {
  if (created) await rm(root, { recursive: true, force: true });
  report.completedAt = new Date().toISOString();
  await reportHandle.writeFile(JSON.stringify(report, null, 2) + "\n"); await reportHandle.close();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, independentAdoptionCredit: 0, sourceCommit: report.sourceCommit }));
}
