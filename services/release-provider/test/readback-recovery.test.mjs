import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { digest, stableJson } from "../../../dist/hash.js";
import { publicKeyFingerprint } from "../../../dist/signer.js";
import { verifyReleaseReceiptV2 } from "../../../dist/release-v1-receipt.js";
import { decision, reservationEvidence, signCompletion, validateCompletion, policy }
  from "../src/policy.mjs";
import { recoveryPolicy } from "../src/recovery.mjs";
import { observeReadbackRecovery, signReadbackRecovery, validateReadbackObservation,
  recoveryRpc } from "../src/readback-recovery.mjs";
import { handle, ReleaseFence, ReleaseReceiptLedger } from "../src/worker.mjs";

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return { key: privateKey, pem, fingerprint: publicKeyFingerprint(pem),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
function storage(initial = {}) {
  const map = new Map(Object.entries(structuredClone(initial)));
  return { kv: { get: k => structuredClone(map.get(k)),
    put: (k, v) => map.set(k, structuredClone(v)) }, transactionSync: cb => cb() };
}
async function boundedResponse(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("readback response exceeded its test deadline")), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
function fixture(t, opts = {}) {
  const authority = keyPair(), receipt = keyPair(), handoff = keyPair();
  const now = Date.now(), old = now - 2 * 86400000, runId = randomUUID(), transactionId = randomUUID();
  const subject = { schema: "agentproof.release.subject.v1", provider: "github", owner: "AyobamiH",
    repository: "agentproof-release-canary", ownerId: 47716486, repositoryId: 1423718326,
    releaseId: 416342082, tagName: "v0.0.0-rc.2026101801", tagCommit: "a".repeat(40),
    packageAssetId: 41, packageAssetName: "canary.tgz", packageDigest: "sha256:" + "b".repeat(64),
    provenanceAssetId: 42, provenanceDigest: "sha256:" + "c".repeat(64), prerelease: true, makeLatest: false };
  const common = { ENABLED: "false", TRUSTED_SOURCE_SHA: "d".repeat(40),
    TARGET_SUBJECT_JSON: JSON.stringify(subject), RECOVERY_REQUIRED: "true", RECOVERY_RUN_ID: runId,
    RECOVERY_HANDOFF_PUBLIC_KEY_PEM: handoff.pem, RECOVERY_HANDOFF_FINGERPRINT: handoff.fingerprint,
    READBACK_RECOVERY_ENABLED: "true", READBACK_RECOVERY_RUN_ID: runId,
    READBACK_RECOVERY_TRANSACTION_ID: transactionId, READBACK_RECOVERY_GITHUB_RUN_ID: "39124373253" };
  const a = { ...common, ROLE: "approval", SIGNING_PRIVATE_KEY_PEM: authority.privatePem,
    SIGNING_PUBLIC_KEY_PEM: authority.pem, SIGNER_FINGERPRINT: authority.fingerprint,
    RECEIPT_PUBLIC_KEY_PEM: receipt.pem, RECEIPT_FINGERPRINT: receipt.fingerprint };
  const s = { ...common, ROLE: "signing", SIGNING_PRIVATE_KEY_PEM: receipt.privatePem,
    SIGNING_PUBLIC_KEY_PEM: receipt.pem, SIGNER_FINGERPRINT: receipt.fingerprint,
    AUTHORITY_PUBLIC_KEY_PEM: authority.pem, AUTHORITY_FINGERPRINT: authority.fingerprint };
  const seed = { stateDirectory: "/tmp/agentproof-release-canary-39124373253", transactionId,
    nonce: "release-canary:39124373253", idempotencyKey: "release-canary:39124373253", subject };
  const approval = decision(seed, a, old), request = { ...seed, approval };
  const reservation = reservationEvidence(seed, approval,
    { run_id: "39124373253", run_attempt: "1" }, a);
  const grantUnsigned = { schema: "donestate.release-recovery-authorisation.v1", runId,
    transactionId, subjectDigest: digest(subject), githubRunId: "39124373253", githubRunAttempt: 1,
    workflowCommit: a.TRUSTED_SOURCE_SHA, reservationDigest: digest(reservation),
    authorisationAuditDigest: "e".repeat(64), issuedAt: approval.decidedAt, expiresAt: approval.expiresAt,
    publicKeyPem: handoff.pem };
  const grant = { ...grantUnsigned, signatureBase64: sign(null,
    Buffer.from("donestate.release-recovery-authorisation.v1\0" + stableJson(grantUnsigned)),
    handoff.key).toString("base64") };
  const { owner, repository, provider, schema, makeLatest, ...subjectFields } = subject;
  const before = { ...subjectFields, schema: "agentproof.release.observation.v1",
    assetCount: 2, draft: true, publishedAt: null };
  const after = { ...before, draft: false, publishedAt: new Date(old + 2000).toISOString() };
  const record = { state: "verified", seed, approval, reservation, recoveryAuthorisation: grant,
    recoveryPolicy: recoveryPolicy(a), before, after, attemptedAt: new Date(old + 1000).toISOString(),
    verifiedAt: new Date(old + 3000).toISOString(), publicationResponse: null };
  record.completion = signCompletion(record, a);
  for (const e of [a, s]) Object.assign(e, {
    READBACK_RECOVERY_COMPLETION_DIGEST: digest(record.completion),
    READBACK_RECOVERY_AUTHORISATION_DIGEST: digest(grant) });
  const aStorage = storage({ release: record }), sStorage = storage();
  const namespace = (store, env, Class) => ({ idFromName: name => name,
    get: name => { assert.equal(name, "1423718326:416342082");
      return { fetch: req => new Class({ storage: store }, env).fetch(req) }; } });
  a.RELEASE_LEDGER = namespace(aStorage, a, ReleaseFence);
  s.RECEIPT_LEDGER = namespace(sStorage, s, ReleaseReceiptLedger);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.method, "GET"); assert.equal(init.headers.authorization, undefined);
    assert.equal(init.redirect, "manual"); assert.ok(init.signal instanceof AbortSignal);
    const path = new URL(url).pathname; calls.push(path);
    if (opts.unavailable) return new Response("secret upstream body", { status: 429,
      headers: { "retry-after": "60", "x-ratelimit-remaining": "0" } });
    let value;
    if (path.endsWith("/git/ref/tags/" + subject.tagName)) value = {
      ref: "refs/tags/" + subject.tagName, object: { type: "commit", sha: subject.tagCommit } };
    else if (path.endsWith("/releases/" + subject.releaseId)) value = {
      id: subject.releaseId, tag_name: subject.tagName, draft: false, prerelease: true,
      published_at: after.publishedAt, assets: [
        { id: subject.packageAssetId, name: subject.packageAssetName, state: "uploaded",
          digest: opts.drift ? "sha256:" + "f".repeat(64) : subject.packageDigest },
        { id: subject.provenanceAssetId, name: "provenance.json", state: "uploaded", digest: subject.provenanceDigest }] };
    else value = { id: subject.repositoryId, name: subject.repository, private: false,
      owner: { login: subject.owner, id: subject.ownerId } };
    if (opts.onRead) opts.onRead(calls.length);
    return new Response(JSON.stringify(value));
  });
  const input = { runId, transactionId, githubRunId: "39124373253", subjectDigest: digest(subject),
    recoveryAuthorisationDigest: digest(grant) };
  return { a, s, aStorage, sStorage, request, record, input, calls, now, opts };
}

test("two-day-old completion recovers with fresh GETs, unchanged execution and idempotent receipt", async t => {
  const f = fixture(t), original = structuredClone(f.record);
  assert.throws(() => validateCompletion(f.record.completion, f.request, f.s), /execution_time_rejected/);
  const recovered = await recoveryRpc(f.a, "observe", f.input);
  assert.equal(recovered.state, "verified"); assert.deepEqual(recovered.completion, original.completion);
  assert.deepEqual(f.aStorage.kv.get("release"), original);
  assert.equal(f.calls.length, 3);
  const body = { request: recovered.request, completion: recovered.completion, observation: recovered.observation };
  const signed = await recoveryRpc(f.s, "sign", body);
  assert.equal(signed.state, "signed", JSON.stringify(signed)); assert.equal(f.calls.length, 6);
  assert.equal(signed.receipt.payload.attemptedAt, original.attemptedAt);
  assert.equal(signed.receipt.payload.verifiedAt, original.verifiedAt);
  assert.deepEqual(signed.receipt.payload.approval, original.approval);
  assert.equal(verifyReleaseReceiptV2(signed.receipt, policy(f.s, f.request.subject)).trusted, true);
  // Reconstruct both objects after a lost response. No write/re-sign occurs.
  const again = await recoveryRpc(f.a, "observe", f.input);
  const retried = await recoveryRpc(f.s, "sign", { ...body, observation: again.observation });
  assert.deepEqual(retried, signed); assert.equal(f.calls.length, 9);
  assert.equal(f.aStorage.kv.get("readbackRecovery").observationCount, 2);
});

test("forged, stale, wrongly bound or extended attestations fail before independent reads or signing", async t => {
  const f = fixture(t), recovered = await observeReadbackRecovery(f.aStorage, f.a, f.input);
  const { observation } = recovered, count = f.calls.length;
  const changes = [{ runId: randomUUID() }, { transactionId: randomUUID() }, { requestDigest: "a".repeat(64) },
    { completionDigest: "a".repeat(64) }, { recoveryAuthorisationDigest: "a".repeat(64) },
    { workflowCommit: "a".repeat(40) }, { readOnly: false }, { githubRunId: "88" },
    { signatureBase64: "A".repeat(86) + "==" }, { authorityPublicKeyPem: keyPair().pem },
    { observedAt: new Date(f.now - 600000).toISOString(), expiresAt: new Date(f.now - 300000).toISOString() },
    { expiresAt: new Date(f.now + 600001).toISOString() }];
  for (const change of changes) {
    await assert.rejects(signReadbackRecovery(f.sStorage, f.s,
      { request: recovered.request, completion: recovered.completion, observation: { ...observation, ...change } }));
    assert.equal(f.sStorage.kv.get("receipt"), undefined); assert.equal(f.calls.length, count);
  }
});

test("persistent predecessor drift or absent completion blocks before any provider request", async t => {
  const f = fixture(t);
  for (const change of [{ state: "attempted", completion: null },
    { recoveryAuthorisation: { ...f.record.recoveryAuthorisation, signatureBase64: "A".repeat(86) + "==" } },
    { completion: { ...f.record.completion, verifiedAt: new Date().toISOString() } }]) {
    f.aStorage.kv.put("release", { ...f.record, ...change });
    await assert.rejects(observeReadbackRecovery(f.aStorage, f.a, f.input));
    assert.equal(f.calls.length, 0);
  }
  f.aStorage.kv.put("release", f.record);
  f.a.READBACK_RECOVERY_COMPLETION_DIGEST = "a".repeat(64);
  await assert.rejects(observeReadbackRecovery(f.aStorage, f.a, f.input), /readback_predecessor_changed/);
  assert.equal(f.calls.length, 0);
});

test("transport refusal retains bounded diagnostics and reentry preserves the original proof", async t => {
  const opts = { unavailable: true }, f = fixture(t, opts);
  const failed = await recoveryRpc(f.a, "observe", f.input);
  assert.equal(failed.reasonCode, "public_readback_unavailable"); assert.equal(failed.status, 503);
  assert.deepEqual(failed.diagnostic, { endpoint: "repository", upstreamStatus: 429,
    rateLimitRemaining: 0, rateLimitReset: null, retryAfterSeconds: 60 });
  assert.ok(!JSON.stringify(failed).includes("secret"));
  assert.equal(f.aStorage.kv.get("readbackRecovery"), undefined);
  opts.unavailable = false;
  const resumed = await recoveryRpc(f.a, "observe", f.input);
  assert.equal(resumed.state, "verified"); assert.deepEqual(resumed.completion, f.record.completion);
});

test("public routes never forward the private capability and disabled recovery refuses without IO", async t => {
  const f = fixture(t);
  for (const e of [f.a, f.s]) {
    for (const path of ["/internal/readback-recovery-observe", "/internal/readback-recovery-sign"]) {
      const response = await handle(new Request("https://service.invalid" + path,
        { method: "POST", body: JSON.stringify(f.input) }), e,
      () => { throw Error("private route reached public authenticator"); });
      assert.equal(response.status, 404);
    }
    e.READBACK_RECOVERY_ENABLED = "false";
    const denied = await recoveryRpc(e, e.ROLE === "approval" ? "observe" : "sign", f.input);
    assert.equal(denied.reasonCode, "readback_recovery_disabled");
  }
  assert.equal(f.calls.length, 0);
});

test("readback drift and expiry during the separate signer GET cannot produce a receipt", async t => {
  const opts = {}, f = fixture(t, opts), recovered = await recoveryRpc(f.a, "observe", f.input);
  const body = { request: recovered.request, completion: recovered.completion, observation: recovered.observation };
  opts.drift = true;
  await assert.rejects(signReadbackRecovery(f.sStorage, f.s, body), /public_assets_changed/);
  opts.drift = false;
  opts.onRead = () => t.mock.method(Date, "now", () => f.now + 301000);
  await assert.rejects(signReadbackRecovery(f.sStorage, f.s, body), /readback_observation_expired/);
  assert.equal(f.sStorage.kv.get("receipt"), undefined);
});

test("legacy authenticated receipt retrieval is historical but first public issuance still expires", async t => {
  const f = fixture(t), recovered = await recoveryRpc(f.a, "observe", f.input);
  f.s.ENABLED = "true";
  const req = () => new Request("https://fence.internal/v1/sign", { method: "POST",
    body: JSON.stringify({ body: { request: f.request, completion: f.record.completion },
      claims: { run_id: "39124373253", run_attempt: "1" } }) });
  const ledger = new ReleaseReceiptLedger({ storage: f.sStorage }, f.s);
  assert.equal((await ledger.fetch(req())).status, 403);
  const signed = await signReadbackRecovery(f.sStorage, f.s, {
    request: f.request, completion: f.record.completion, observation: recovered.observation });
  const count = f.calls.length, response = await ledger.fetch(req());
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), signed);
  assert.equal(f.calls.length, count);
  assert.throws(() => validateReadbackObservation(recovered.observation, f.request,
    f.record.completion, f.s, f.now + 301000), /readback_observation_expired/);
});

test("network failure retries distinctly from malformed evidence, with bounded response consumption", async t => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", async () => { throw Error("sensitive transport detail"); });
  let failed = await recoveryRpc(f.a, "observe", f.input);
  assert.equal(failed.reasonCode, "public_readback_transport_unavailable"); assert.equal(failed.status, 503);
  assert.ok(!JSON.stringify(failed).includes("sensitive"));
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { cancelled = true; },
  })));
  failed = await recoveryRpc(f.a, "observe", f.input);
  assert.equal(failed.reasonCode, "public_readback_oversized"); assert.equal(cancelled, true);
  assert.equal(f.aStorage.kv.get("readbackRecovery"), undefined);
  const bad = await recoveryRpc(f.s, "sign", { request: null, completion: null, observation: null });
  assert.equal(bad.status, 403); assert.equal(bad.reasonCode, "readback_evidence_rejected");
});

test("refused response does not wait for stalled stream cancellation", async t => {
  const f = fixture(t);
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    cancel() { cancelled = true; return new Promise(() => {}); },
  }), { status: 429, headers: { "retry-after": "60" } }));
  const failed = await boundedResponse(recoveryRpc(f.a, "observe", f.input));
  assert.equal(failed.reasonCode, "public_readback_unavailable"); assert.equal(failed.status, 503);
  assert.equal(failed.diagnostic.upstreamStatus, 429); assert.equal(cancelled, true);
  assert.deepEqual(f.aStorage.kv.get("release"), f.record);
  assert.equal(f.aStorage.kv.get("readbackRecovery"), undefined);
});

test("an already expired metadata deadline refuses before an open body read", async t => {
  const f = fixture(t);
  let cancelled = false;
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort());
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  })));
  const failed = await boundedResponse(recoveryRpc(f.a, "observe", f.input));
  assert.equal(failed.reasonCode, "public_readback_transport_unavailable"); assert.equal(failed.status, 503);
  assert.equal(cancelled, true); assert.deepEqual(f.aStorage.kv.get("release"), f.record);
  assert.equal(f.aStorage.kv.get("readbackRecovery"), undefined);
});

test("internal transport and undecodable responses retry while evidence refusals remain permanent", async t => {
  const f = fixture(t), originalNamespace = f.a.RELEASE_LEDGER;
  for (const fetch of [
    async () => { throw Error("sensitive internal transport detail"); },
    async () => new Response("sensitive malformed response"),
  ]) {
    f.a.RELEASE_LEDGER = { ...originalNamespace, get: () => ({ fetch }) };
    const failed = await recoveryRpc(f.a, "observe", f.input);
    assert.deepEqual(failed, { state: "BLOCKED", signed: false,
      reasonCode: "readback_provider_unavailable", status: 503 });
    assert.ok(!JSON.stringify(failed).includes("sensitive"));
  }
  f.a.RELEASE_LEDGER = originalNamespace;
  const refused = await recoveryRpc(f.a, "observe", { ...f.input, transactionId: randomUUID() });
  assert.deepEqual(refused, { state: "BLOCKED", signed: false,
    reasonCode: "readback_resume_binding", status: 403 });
  const malformed = await recoveryRpc(f.s, "sign", { request: null, completion: null, observation: null });
  assert.equal(malformed.status, 403); assert.equal(malformed.reasonCode, "readback_evidence_rejected");
  assert.equal(f.calls.length, 0); assert.deepEqual(f.aStorage.kv.get("release"), f.record);
  assert.equal(f.aStorage.kv.get("readbackRecovery"), undefined);
  assert.equal(f.sStorage.kv.get("receipt"), undefined);
});
