import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { createVaultTransitSigningProvider, createProductionApprovalClient, ProductionProviderError,
  type VaultTransitSigningOptions } from "../portable-production-providers.js";
import { publicKeyFingerprint } from "../signer.js";
import { digest, stableJson } from "../hash.js";
import type { PortableApprovalRequestDocument } from "../portable-protocol.js";

// All identities below are disposable wire-conformance fixtures, never production evidence.
function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { ...pair, publicKeyPem, fingerprint: publicKeyFingerprint(publicKeyPem) };
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const isCode = (code: string) => (error: unknown) => error instanceof ProductionProviderError && error.code === code && error.message === code;
function signerOptions(key = keyPair()): VaultTransitSigningOptions {
  return { address: "https://vault.example.invalid", mountPath: "transit", keyName: "receipt", keyVersion: 3,
    keyId: "fixture/receipt/v3", publicKeyPem: key.publicKeyPem, trustedSignerFingerprint: key.fingerprint,
    getToken: async () => "disposable-fixture-token" };
}
function requestFixture(): PortableApprovalRequestDocument {
  const hash = "a".repeat(64), expiresAt = new Date(Date.now() + 60_000).toISOString();
  const unsigned = { schema: "agentproof.protocol.approval-request" as const, schemaVersion: "1.0.0" as const,
    actionType: "agentproof.repository_patch.v1" as const, correlationId: "fixture", transactionId: "transaction",
    stateDirectory: "/fixture/state", preparedDigest: hash, expiresAt, nonce: "nonce",
    binding: { schemaVersion: "agentproof.repository-patch.approval.v1", transactionId: "transaction",
      intentDigest: hash, actionDigest: hash, target: "/fixture/repo", baseCommit: "b".repeat(40), branch: "main",
      beforeManifestDigest: hash, proposedManifestDigest: hash, patchDigest: hash, expectedDiffDigest: hash,
      affectedPaths: ["a.txt"], verificationPlanDigest: hash, policyVersion: "agentproof.repository-patch.v1", expiresAt, nonce: "nonce" } };
  return { ...unsigned, requestDigest: digest(unsigned) };
}
function decisionFixture(request: PortableApprovalRequestDocument, key: ReturnType<typeof keyPair>, changes: Record<string, unknown> = {}) {
  const unsigned = { schema: "agentproof.protocol.approval-decision", schemaVersion: "1.0.0",
    actionType: "agentproof.repository_patch.v1", correlationId: request.correlationId, transactionId: request.transactionId,
    requestDigest: request.requestDigest, preparedDigest: request.preparedDigest, decision: "approved",
    authorityEnvironment: "production", issuer: "isolated-policy-service", decidedAt: new Date().toISOString(),
    expiresAt: request.expiresAt, nonce: request.nonce, authorityPublicKeyPem: key.publicKeyPem,
    authorityFingerprint: key.fingerprint, approvalRequest: request, ...changes };
  return { ...unsigned, signatureBase64: sign(null, Buffer.from(stableJson(unsigned)), key.privateKey).toString("base64") };
}
function approvalOptions(key: ReturnType<typeof keyPair>) {
  return { endpoint: "https://approval.example.invalid/decisions", expectedIssuer: "isolated-policy-service",
    trustedAuthorityFingerprints: [key.fingerprint], getToken: async () => "disposable-fixture-token" };
}

test("Vault provider is inert until signing and sends exact un-prehashed bytes with pinned version", async t => {
  const key = keyPair();
  let calls = 0, credentials = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://vault.example.invalid/v1/team/transit/sign/receipt");
    assert.equal(init.redirect, "error"); assert.equal(init.credentials, "omit");
    assert.equal(new Headers(init.headers).get("x-vault-token"), "fixture-token");
    assert.equal(new Headers(init.headers).get("x-vault-namespace"), "team");
    const body = JSON.parse(init.body as string);
    assert.deepEqual(body, { input: Buffer.from("exact\nπ\u0000bytes").toString("base64"), key_version: 3, prehashed: false });
    return json({ data: { signature: "vault:v3:" + sign(null, Buffer.from(body.input, "base64"), key.privateKey).toString("base64") } });
  });
  const options = { ...signerOptions(key), mountPath: "team/transit", namespace: "team",
    getToken: async () => { credentials++; return "fixture-token"; } };
  const provider = createVaultTransitSigningProvider(options);
  options.keyVersion = 4; options.keyId = "altered"; options.getToken = async () => "altered";
  assert.equal(await provider.keyId(), "fixture/receipt/v3"); assert.equal(await provider.publicKeyPem(), key.publicKeyPem);
  assert.equal(calls, 0); assert.equal(credentials, 0);
  assert.ok(verify(null, Buffer.from("exact\nπ\u0000bytes"), key.publicKey, await provider.signCanonical("exact\nπ\u0000bytes")));
  assert.equal(calls, 1); assert.equal(credentials, 1);
});

test("Vault rejects unsafe configuration before credentials or networking", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected"); });
  const options = signerOptions();
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
  for (const change of [
    { address: "http://vault.example.invalid" }, { address: "https://user:secret@vault.example.invalid" },
    { address: "https://vault.example.invalid/path" }, { address: "https://vault.example.invalid?secret=1" },
    { mountPath: "../transit" }, { keyName: "receipt/rotate" }, { namespace: "team\r\ninjected: value" },
    { keyVersion: 0 }, { keyVersion: 1.5 }, { trustedSignerFingerprint: "sha256:" + "0".repeat(64) },
    { publicKeyPem: rsa }, { timeoutMs: 0 }, { timeoutMs: 60_001 },
  ]) assert.throws(() => createVaultTransitSigningProvider({ ...options, ...change }), isCode("provider_configuration_invalid"));
  assert.equal(calls, 0);
});

test("Vault refuses rotated, forged, noncanonical and malformed signatures", async t => {
  const key = keyPair(), other = keyPair();
  const valid = sign(null, Buffer.from("payload"), key.privateKey).toString("base64");
  const signatures = ["vault:v4:" + valid, "vault:v03:" + valid,
    "vault:v3:" + sign(null, Buffer.from("payload"), other.privateKey).toString("base64"),
    "vault:v3:" + sign(null, Buffer.from("other payload"), key.privateKey).toString("base64"),
    "vault:v3:" + valid.replace(/==$/, ""), "vault:v3:" + Buffer.alloc(32).toString("base64"), "not-a-signature"];
  let signature = signatures[0], calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return json({ data: { signature } }); });
  const provider = createVaultTransitSigningProvider(signerOptions(key));
  for (signature of signatures) await assert.rejects(provider.signCanonical("payload"), isCode("provider_signature_invalid"));
  assert.equal(calls, signatures.length); // No retry or fallback key.
  await assert.rejects(provider.signCanonical("x".repeat(524289)), isCode("provider_input_invalid"));
  assert.equal(calls, signatures.length);
});

test("HTTP errors are bounded, duplicate-safe and redact service details", async t => {
  let response: () => Response = () => new Response("fixture-secret", { status: 503 });
  t.mock.method(globalThis, "fetch", async () => response());
  const provider = createVaultTransitSigningProvider(signerOptions());
  for (const status of [301, 302, 307, 308, 401, 403, 429, 500, 503]) {
    response = () => new Response("fixture-secret", { status, headers: { location: "https://untrusted.invalid" } });
    await assert.rejects(provider.signCanonical("payload"), isCode("provider_unavailable"));
  }
  for (const body of ['{"data":{},"data":{}}', '{"__proto__":{"injected":true}}', '{', "x".repeat(1048577)]) {
    response = () => new Response(body, { headers: { "content-type": "application/json" } });
    await assert.rejects(provider.signCanonical("payload"), isCode("provider_response_invalid"));
  }
  response = () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } });
  await assert.rejects(provider.signCanonical("payload"), isCode("provider_response_invalid"));
  response = () => new Response("{}", { headers: { "content-type": "text/html" } });
  await assert.rejects(provider.signCanonical("payload"), isCode("provider_response_invalid"));
  response = () => { throw new Error("credential=fixture-secret"); };
  await assert.rejects(provider.signCanonical("payload"), isCode("provider_unavailable"));
});

test("deadline includes credential retrieval and prevents a late request", async t => {
  let calls = 0, resolveToken!: (token: string) => void, signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async () => { calls++; return json({}); });
  const provider = createVaultTransitSigningProvider({ ...signerOptions(), timeoutMs: 15,
    getToken: s => { signal = s; return new Promise(resolve => { resolveToken = resolve; }); } });
  await assert.rejects(provider.signCanonical("payload"), isCode("provider_timeout"));
  assert.equal(signal?.aborted, true);
  resolveToken("late-token"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
});

test("deadline bounds stalled response bodies and credentials never leak", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start() {} }),
    { headers: { "content-type": "application/json" } }));
  await assert.rejects(createVaultTransitSigningProvider({ ...signerOptions(), timeoutMs: 15 }).signCanonical("payload"), isCode("provider_timeout"));
  for (const getToken of [async () => { throw new Error("fixture-secret"); }, async () => "", async () => "token\r\nInjected: secret"]) {
    await assert.rejects(createVaultTransitSigningProvider({ ...signerOptions(), getToken }).signCanonical("payload"),
      isCode("provider_credentials_unavailable"));
  }
});

test("approval client binds exact request, verifies production signature and preserves signed denials", async t => {
  const key = keyPair(), request = requestFixture();
  let denied = false, calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++; assert.equal(url, "https://approval.example.invalid/decisions");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer disposable-fixture-token");
    assert.equal(init.body, stableJson(request));
    return json(decisionFixture(request, key, { decision: denied ? "denied" : "approved" }));
  });
  const client = createProductionApprovalClient(approvalOptions(key));
  assert.equal(calls, 0);
  assert.equal((await client.requestApproval(request)).decision, "approved");
  denied = true;
  assert.equal((await client.requestApproval(request)).decision, "denied");
});

test("approval client rejects development, wrong trust, altered bindings, expiry and invalid signatures", async t => {
  const key = keyPair(), request = requestFixture(), other = keyPair();
  let result: unknown;
  t.mock.method(globalThis, "fetch", async () => json(result));
  const client = createProductionApprovalClient(approvalOptions(key));
  for (const changes of [
    { authorityEnvironment: "development" }, { issuer: "other" }, { correlationId: "other" },
    { transactionId: "other" }, { requestDigest: "b".repeat(64) }, { preparedDigest: "b".repeat(64) },
    { nonce: "other" }, { decision: "maybe" }, { expiresAt: "2020-01-01T00:00:00Z" },
    { decidedAt: "not-a-date" }, { decidedAt: "2026-02-30T00:00:00Z" },
    { decidedAt: new Date(Date.now() + 60_000).toISOString() },
    { approvalRequest: { ...request, stateDirectory: "/different" } },
    { authorityFingerprint: other.fingerprint }, { authorityPublicKeyPem: other.publicKeyPem }, { unexpected: true },
  ]) {
    result = decisionFixture(request, key, changes);
    await assert.rejects(client.requestApproval(request), isCode("provider_approval_invalid"));
  }
  result = decisionFixture(request, other);
  await assert.rejects(client.requestApproval(request), isCode("provider_approval_invalid"));
  result = { ...decisionFixture(request, key), signatureBase64: Buffer.alloc(64).toString("base64") };
  await assert.rejects(client.requestApproval(request), isCode("provider_approval_invalid"));
});

test("approval input validation and trust configuration fail before networking", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return json({}); });
  const key = keyPair(), request = requestFixture(), options = approvalOptions(key);
  assert.throws(() => createProductionApprovalClient({ ...options, trustedAuthorityFingerprints: [] }), isCode("provider_configuration_invalid"));
  assert.throws(() => createProductionApprovalClient({ ...options, endpoint: "http://approval.invalid" }), isCode("provider_configuration_invalid"));
  const client = createProductionApprovalClient(options);
  for (const changes of [{ requestDigest: "b".repeat(64) }, { expiresAt: "invalid" }, { binding: {} },
    { unexpected: true }, { nonce: "" }, { expiresAt: "2020-01-01T00:00:00Z" }]) {
    await assert.rejects(client.requestApproval({ ...request, ...changes }), isCode("provider_input_invalid"));
  }
  const prototypeKey = JSON.parse(JSON.stringify(request));
  Object.defineProperty(prototypeKey.binding, "__proto__", { value: null, enumerable: true });
  await assert.rejects(client.requestApproval(prototypeKey), isCode("provider_input_invalid"));
  assert.equal(calls, 0);
});

test("approval request and trust pins are snapshotted before asynchronous credential lookup", async t => {
  const key = keyPair(), request = requestFixture(), original = structuredClone(request), options = approvalOptions(key);
  let resolveToken!: (token: string) => void;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(init.body, stableJson(original)); return json(decisionFixture(original, key));
  });
  const client = createProductionApprovalClient({ ...options, getToken: () => new Promise(resolve => { resolveToken = resolve; }) });
  const pending = client.requestApproval(request);
  request.binding.target = "/changed"; request.nonce = "changed"; options.trustedAuthorityFingerprints.length = 0;
  resolveToken("disposable-fixture-token");
  assert.equal((await pending).approvalRequest.nonce, original.nonce);
});
