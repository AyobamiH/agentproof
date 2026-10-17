import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SignJWT, importPKCS8 } from "jose";
import { publicKeyFingerprint } from "../../../dist/signer.js";
import { digest, stableJson } from "../../../dist/hash.js";
import { prepareRepositoryPatch, createApprovalRequest, executeApprovedTransaction, reconcileRepositoryPatch,
  compensateRepositoryPatchWithReceipt, verifyReceipt, getTransactionStatus } from "../../../dist/portable.js";
import { createProductionApprovalClient } from "../../../dist/portable-production-providers.js";
import { remoteReceiptSigner } from "../../../scripts/lib/production-provider-client.mjs";
import { validateClaims, authenticate } from "../src/identity.mjs";
import { handle, ProviderLedger } from "../src/worker.mjs";
import { Rejection, strictJson, decideOnce, validateRequest, INTENT, ISSUER, KEY_ID, canaryAction, canaryRoot } from "../src/policy.mjs";

const exec = promisify(execFile);
const claims = { run_id: "215000001", run_attempt: "1" };
const pin = "a".repeat(40);
function signingKey() {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { SIGNING_PRIVATE_KEY_PEM: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    SIGNING_PUBLIC_KEY_PEM: publicKeyPem, SIGNER_FINGERPRINT: publicKeyFingerprint(publicKeyPem) };
}
function storage() {
  const items = new Map(); let sequence = Promise.resolve();
  const txn = { get: async key => structuredClone(items.get(key)), put: async (key, value) => { items.set(key, structuredClone(value)); } };
  return { transaction: async fn => {
    const next = sequence.then(() => fn(txn)); sequence = next.catch(() => {}); return next;
  } };
}
function environment(role, key = signingKey()) {
  const env = { ROLE: role, ENABLED: "true", TRUSTED_SOURCE_SHA: pin, AUDIENCE: `https://${role}.example.invalid`, ...key };
  const objects = new Map();
  env.LEDGER = { idFromName: value => value, get(id) {
    if (!objects.has(id)) objects.set(id, new ProviderLedger({ storage: storage() }, env));
    return objects.get(id);
  } };
  return env;
}
function oidcClaims() {
  return { repository: "AyobamiH/agentproof", repository_id: "1317413810", repository_owner_id: "47716486",
    actor_id: "47716486", ref: "refs/heads/main", event_name: "workflow_dispatch", runner_environment: "github-hosted",
    workflow_ref: "AyobamiH/agentproof/.github/workflows/production-provider-canary.yml@refs/heads/main",
    workflow_sha: pin, sha: pin, sub: "repo:AyobamiH/agentproof:environment:agentproof-production-canary", ...claims };
}
test("workload policy rejects every changed identity boundary and disabled activation", () => {
  const env = environment("approval"), valid = oidcClaims();
  assert.deepEqual(validateClaims(valid, env), claims);
  for (const key of Object.keys(valid)) assert.throws(() => validateClaims({ ...valid, [key]: "untrusted" }, env), Rejection);
  assert.throws(() => validateClaims(valid, { ...env, ENABLED: "false" }), /provider_disabled/);
  assert.throws(() => validateClaims(valid, { ...env, TRUSTED_SOURCE_SHA: "0".repeat(40) }), /provider_disabled/);
});
test("OIDC verification rejects forged, expired, wrong-audience and wrong-issuer tokens", async () => {
  const env = environment("approval"), pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = await importPKCS8(pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "RS256");
  const issue = async changes => new SignJWT({ ...oidcClaims(), iss: "https://token.actions.githubusercontent.com", aud: env.AUDIENCE,
    iat: Math.floor(Date.now() / 1000), nbf: Math.floor(Date.now() / 1000) - 1, exp: Math.floor(Date.now() / 1000) + 120, jti: "fixture", ...changes })
    .setProtectedHeader({ alg: "RS256", kid: "fixture" }).sign(privateKey);
  const req = token => new Request("https://approval.example.invalid/v1/decisions", { headers: { Authorization: "Bearer " + token } });
  assert.deepEqual(await authenticate(req(await issue({})), env, pair.publicKey), claims);
  for (const change of [{ aud: "wrong" }, { iss: "wrong" }, { exp: 1 }, { sha: "b".repeat(40) }])
    await assert.rejects(authenticate(req(await issue(change)), env, pair.publicKey), Rejection);
  const token = await issue({});
  await assert.rejects(authenticate(req(token.slice(0, -20) + "a".repeat(20)), env, pair.publicKey), Rejection);
});
test("JSON and HTTP boundaries reject duplicates, prototype keys, oversized bodies and anonymous callers", async () => {
  for (const value of ['{"a":1,"a":2}', '{"__proto__":null}', '"' + "x".repeat(65536) + '"']) assert.throws(() => strictJson(value));
  const env = environment("approval");
  const request = new Request("https://approval.example.invalid/v1/decisions", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert.equal((await handle(request, env)).status, 401);
  const invalid = new Request("https://approval.example.invalid/v1/decisions", { method: "POST", body: '{"a":1,"a":2}', headers: { "content-type": "application/json" } });
  assert.equal((await handle(invalid, env, async () => claims)).status, 400);
});

test("hosted policy composes with SDK, persists decisions and recovers a lost response before signed compensation", async t => {
  const root = canaryRoot(claims), repositoryRoot = root + "/repository", stateDirectory = root + "/state";
  await mkdir(root); await mkdir(repositoryRoot);
  try {
    const git = args => exec("git", ["-C", repositoryRoot, ...args]);
    await git(["init", "-b", "main"]); await git(["config", "user.email", "fixture@example.invalid"]); await git(["config", "user.name", "Provider fixture"]);
    await writeFile(repositoryRoot + "/canary.txt", "before\n"); await git(["add", "canary.txt"]);
    await git(["-c", "commit.gpgsign=false", "commit", "-m", "baseline"]);
    const correlationId = `production-canary:${claims.run_id}-${claims.run_attempt}`;
    const prepared = await prepareRepositoryPatch({ schema: "agentproof.protocol.repository-patch-request", schemaVersion: "1.0.0",
      actionType: "agentproof.repository_patch.v1", correlationId, stateDirectory, action: canaryAction(claims), intent: INTENT,
      policy: { allowedRepositoryRoot: repositoryRoot, allowedTrackedPaths: ["canary.txt"], allowedNewPaths: [], maxPatchBytes: 1024, maxFiles: 1 } });
    const request = await createApprovalRequest(prepared, { expiresAt: new Date(Date.now() + 300_000).toISOString(), nonce: correlationId });
    validateRequest(request, claims);
    for (const [key, value] of [["target", "/unauthorised"], ["affectedPaths", ["other.txt"]], ["verificationPlanDigest", "a".repeat(64)]]) {
      const changed = structuredClone(request); changed.binding[key] = value;
      const { requestDigest, ...unsigned } = changed; changed.requestDigest = digest(unsigned);
      assert.throws(() => validateRequest(changed, claims), Rejection);
    }
    const authority = environment("approval"), signerEnv = environment("receipt");
    signerEnv.AUTHORITY_PUBLIC_KEY_PEM = authority.SIGNING_PUBLIC_KEY_PEM;
    signerEnv.AUTHORITY_FINGERPRINT = authority.SIGNER_FINGERPRINT;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      const env = String(url).includes("approval") ? authority : signerEnv;
      return handle(new Request(url, init), env, async () => claims);
    });
    const client = createProductionApprovalClient({ endpoint: "https://approval.example.invalid/v1/decisions", expectedIssuer: ISSUER,
      trustedAuthorityFingerprints: [authority.SIGNER_FINGERPRINT], getToken: async () => "fixture" });
    const approvalDecision = await client.requestApproval(request);
    const retries = await Promise.all([client.requestApproval(request), client.requestApproval(request)]);
    for (const retry of retries) assert.deepEqual(retry, approvalDecision);
    const altered = structuredClone(request); altered.preparedDigest = "b".repeat(64);
    const { requestDigest, ...unsigned } = altered; altered.requestDigest = digest(unsigned);
    await assert.rejects(client.requestApproval(altered), /provider_unavailable/);
    const signerOptions = { endpoint: "https://receipt.example.invalid/v1/sign", keyId: KEY_ID,
      publicKeyPem: signerEnv.SIGNING_PUBLIC_KEY_PEM, fingerprint: signerEnv.SIGNER_FINGERPRINT, approvalDecision, getToken: async () => "fixture" };
    const signer = remoteReceiptSigner(signerOptions);
    const execution = { schema: "agentproof.protocol.execution-request", schemaVersion: "1.0.0", actionType: "agentproof.repository_patch.v1",
      transactionId: prepared.transactionId, correlationId, stateDirectory, idempotencyKey: correlationId,
      requiredAuthorityEnvironment: "production", trustedAuthorityFingerprints: [authority.SIGNER_FINGERPRINT], approvalDecision };
    await assert.rejects(executeApprovedTransaction(execution, { receiptSigner: { ...signer, async signCanonical(input) {
      await signer.signCanonical(input); throw new Error("lost_response");
    } } }), /lost_response/);
    const query = { correlationId, transactionId: prepared.transactionId, stateDirectory };
    assert.equal((await getTransactionStatus(query)).state, "verified");
    const receipt = await reconcileRepositoryPatch({ ...query, authorityEnvironment: "production" }, { receiptSigner: signer });
    assert.equal(verifyReceipt({ document: receipt, trustedSignerFingerprints: [signerEnv.SIGNER_FINGERPRINT], requiredAuthorityEnvironment: "production" }).trusted, true);
    const noSign = { ...signer, signCanonical: async () => { throw new Error("must_not_sign"); } };
    assert.deepEqual(await executeApprovedTransaction(execution, { receiptSigner: noSign }), receipt);
    const successor = await compensateRepositoryPatchWithReceipt({ ...query, authorityEnvironment: "production" },
      { receiptSigner: remoteReceiptSigner({ ...signerOptions, predecessorChain: [receipt] }), trustedSignerFingerprints: [signerEnv.SIGNER_FINGERPRINT] });
    assert.equal(verifyReceipt({ document: successor, predecessorChain: [receipt], trustedSignerFingerprints: [signerEnv.SIGNER_FINGERPRINT], requiredAuthorityEnvironment: "production" }).trusted, true);
    assert.equal(await readFile(repositoryRoot + "/canary.txt", "utf8"), "before\n");
    assert.equal((await git(["status", "--porcelain"])).stdout.trim(), "");
    const forged = structuredClone(approvalDecision); forged.authorityEnvironment = "development";
    const badSigner = remoteReceiptSigner({ ...signerOptions, approvalDecision: forged });
    await assert.rejects(badSigner.signCanonical("agentproof.signed-receipt.v2\0" + stableJson(receipt.payload)), /provider_unavailable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
