import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { digest, stableJson } from "../hash.js";
import { publicKeyFingerprint } from "../signer.js";
import { signingProviderFromPrivateKeyPem } from "../portable-sdk.js";
import { ReleaseV1Controller } from "../release-v1-controller.js";
import { GitHubReleaseV1Provider } from "../release-v1-github.js";
import { verifyReleaseReceiptV2 } from "../release-v1-receipt.js";
import type { ReleaseV1Subject, ReleaseV1Policy, ReleaseV1Request, ReleaseV1Approval,
  ReleaseV1Observation, ReleaseV1Provider } from "../release-v1-contract.js";

const SHA = (x: string) => "sha256:" + x.repeat(64);
const tagCommit = "a".repeat(40);
const subject: ReleaseV1Subject = {
  schema: "agentproof.release.subject.v1", provider: "github", owner: "ExampleOwner",
  repository: "disposable-release-canary", ownerId: 47716486, repositoryId: 1317413810,
  releaseId: 981, tagName: "v1.2.3-rc.1", tagCommit,
  packageAssetId: 77, packageAssetName: "artifact.tgz", packageDigest: SHA("b"),
  provenanceAssetId: 88, provenanceDigest: SHA("c"), prerelease: true, makeLatest: false,
};
function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return { privateKeyPem, publicKeyPem, fingerprint: publicKeyFingerprint(publicKeyPem) };
}
function makeFixture(root: string) {
  const authority = keys(), receipt = keys();
  const policy: ReleaseV1Policy = { subject, issuer: "release-canary-authority",
    authorityFingerprints: [authority.fingerprint], signerFingerprint: receipt.fingerprint,
    signerKeyId: "release-v1-signing-canary" };
  const request = (overrides: Partial<ReleaseV1Approval> = {}, transactionId = randomUUID(),
    nonce = "release-nonce-" + randomUUID()) => {
    const unsigned = { schema: "agentproof.release.approval.v1" as const,
      actionType: "agentproof.release.v1" as const, subjectDigest: digest(subject), transactionId, nonce,
      decision: "approved" as const, environment: "production" as const, issuer: policy.issuer,
      decidedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      authorityPublicKeyPem: authority.publicKeyPem, ...overrides };
    const approval: ReleaseV1Approval = { ...unsigned,
      signatureBase64: sign(null, Buffer.from(stableJson(unsigned)), authority.privateKeyPem).toString("base64") };
    return { transactionId, nonce, idempotencyKey: "release-idem-" + transactionId,
      stateDirectory: root, subject, approval } as ReleaseV1Request;
  };
  const provider = new FixtureReleaseProvider();
  const signer = signingProviderFromPrivateKeyPem(policy.signerKeyId, receipt.privateKeyPem);
  return { authority, receipt, policy, request, provider, signer };
}
class FixtureReleaseProvider implements ReleaseV1Provider {
  published = false;
  publicationCalls = 0;
  lostResponse = false;
  readFailures = 0;
  wrongTag = false;
  badArtifact = false;
  async observe(_subject: ReleaseV1Subject): Promise<ReleaseV1Observation> {
    if (this.readFailures > 0) { this.readFailures--; throw Error("fixture_read_unavailable"); }
    return { schema: "agentproof.release.observation.v1", ownerId: subject.ownerId,
      repositoryId: subject.repositoryId, releaseId: subject.releaseId, tagName: subject.tagName,
      tagCommit: this.wrongTag ? "f".repeat(40) : subject.tagCommit,
      packageAssetId: subject.packageAssetId, packageAssetName: subject.packageAssetName,
      packageDigest: this.badArtifact ? SHA("d") : subject.packageDigest,
      provenanceAssetId: subject.provenanceAssetId, provenanceDigest: subject.provenanceDigest,
      assetCount: 2, draft: !this.published, prerelease: true,
      publishedAt: this.published ? new Date().toISOString() : null };
  }
  async publishDraft(): Promise<void> {
    this.publicationCalls++;
    if (this.published) throw Error("duplicate_publish");
    this.published = true;
    if (this.lostResponse) throw Error("fixture_lost_response_after_effect");
  }
}
const lab = async (fn: (root: string) => Promise<void>) => {
  const root = await mkdtemp(path.join(tmpdir(), "agentproof-release-contract-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
};

test("exact authorised release, one mutation, durable retry and independently signed V2 evidence", () =>
  lab(async root => {
    const f = makeFixture(root), action = f.request(), c = new ReleaseV1Controller(f.policy, f.provider, f.signer, root);
    const first = await c.execute(action);
    assert.equal(first.state, "signed"); assert.equal(first.providerEffectAttempted, true);
    assert.equal(first.requiresOperatorReview, false); assert.equal(f.provider.publicationCalls, 1);
    assert(first.receipt);
    const proof = verifyReleaseReceiptV2(first.receipt, f.policy);
    assert.equal(proof.trusted, true); assert.equal(proof.verifiedClaims?.independentOutcomeVerified, false);
    assert.equal(first.receipt.payload.compensationState, "not_supported");
    assert.equal((await c.execute(action)).receipt?.proof.payloadDigest, first.receipt.proof.payloadDigest);
    const restarted = new ReleaseV1Controller(f.policy, f.provider, f.signer, root);
    assert.deepEqual((await restarted.reconcile(action.transactionId)).receipt, first.receipt);
    assert.equal(f.provider.publicationCalls, 1);
    const altered = structuredClone(first.receipt);
    altered.payload.subject.packageDigest = SHA("d");
    assert.equal(verifyReleaseReceiptV2(altered, f.policy).trusted, false);
    assert.equal(verifyReleaseReceiptV2(first.receipt, { ...f.policy, signerFingerprint: SHA("d") }).trusted, false);
    assert.equal(verifyReleaseReceiptV2(first.receipt, { ...f.policy, authorityFingerprints: [SHA("d")] }).trusted, false);
    assert.equal(verifyReleaseReceiptV2(first.receipt, { ...f.policy, subject: { ...subject, releaseId: 999 } }).trusted, false);
    assert.equal(verifyReleaseReceiptV2(first.receipt, { ...f.policy, issuer: "foreign" }).trusted, false);
    const malicious = structuredClone(first.receipt) as any;
    malicious.payload.unexpected = true;
    assert.equal(verifyReleaseReceiptV2(malicious, f.policy).trusted, false);
  }));

test("lost successful publication response reconciles by readback without re-publication", () =>
  lab(async root => {
    const f = makeFixture(root);f.provider.lostResponse = true;
    const request = f.request(), c = new ReleaseV1Controller(f.policy, f.provider, f.signer, root);
    const r = await c.execute(request);
    assert.equal(r.state, "signed"); assert.equal(f.provider.publicationCalls, 1);
    assert.equal((await c.reconcile(request.transactionId)).state, "signed");
    assert.equal(f.provider.publicationCalls, 1);
  }));

test("unavailable post-effect readback never retries the effect", () =>
  lab(async root => {
    const f = makeFixture(root), request = f.request();
    const original = f.provider.publishDraft.bind(f.provider);
    f.provider.publishDraft = async () => { await original();f.provider.readFailures = 1; };
    const c = new ReleaseV1Controller(f.policy, f.provider, f.signer, root);
    const first = await c.execute(request);
    assert.equal(first.state, "publish_attempted"); assert.equal(first.requiresOperatorReview, true);
    assert.equal(f.provider.publicationCalls, 1);
    const second = await c.reconcile(request.transactionId);
    assert.equal(second.state, "signed"); assert.equal(f.provider.publicationCalls, 1);
  }));

test("signer outage after verified effect recovers by signing alone", () =>
  lab(async root => {
    const f = makeFixture(root), request = f.request();
    let signingAvailable = false, attempts = 0;
    const signer = { ...f.signer, async signCanonical(payload: string) {
      attempts++;
      if (!signingAvailable) throw Error("fixture_signer_unavailable");
      return f.signer.signCanonical(payload);
    } };
    const c = new ReleaseV1Controller(f.policy, f.provider, signer, root);
    assert.equal((await c.execute(request)).state, "verified");
    assert.equal(f.provider.publicationCalls, 1);
    signingAvailable = true;
    const restored = await c.reconcile(request.transactionId);
    assert.equal(restored.state, "signed"); assert.equal(attempts, 2);
    assert.equal(f.provider.publicationCalls, 1);
    assert.equal(verifyReleaseReceiptV2(restored.receipt, f.policy).trusted, true);
  }));

test("wrong preconditions, altered authority or expired grant fail before publication", () =>
  lab(async root => {
    const f = makeFixture(root), c = new ReleaseV1Controller(f.policy, f.provider, f.signer, root);
    const invalid = [
      f.request({ environment: "development" }),
      f.request({ decision: "denied" }),
      f.request({ issuer: "untrusted-issuer" }),
      f.request({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      { ...f.request(), subject: { ...subject, releaseId: 123 } },
    ];
    for (const x of invalid) await assert.rejects(c.execute(x as ReleaseV1Request), /release_v1:/);
    assert.equal(f.provider.publicationCalls, 0);
    f.provider.badArtifact = true;
    await assert.rejects(c.execute(f.request()), /observation_mismatch/);
    assert.equal(f.provider.publicationCalls, 0);
    f.provider.badArtifact = false; f.provider.wrongTag = true;
    await assert.rejects(c.execute(f.request()), /observation_mismatch/);
    assert.equal(f.provider.publicationCalls, 0);
    f.provider.wrongTag = false; f.provider.published = true;
    await assert.rejects(c.execute(f.request()), /observation_mismatch/);
    assert.equal(f.provider.publicationCalls, 0);
  }));

test("approval nonce is unique and idempotency is transaction-bound", () =>
  lab(async root => {
    const f = makeFixture(root), nonce = "same-nonce-across-attempts", a = f.request({}, randomUUID(), nonce);
    const c = new ReleaseV1Controller(f.policy, f.provider, f.signer, root);
    assert.equal((await c.execute(a)).state, "signed");
    // The synthetic fixture is deliberately reset to test durable nonce replay, not a real release reset.
    f.provider.published = false;
    await assert.rejects(c.execute(f.request({}, randomUUID(), nonce)));
    assert.equal(f.provider.publicationCalls, 1);
  }));

test("GH provider binds numeric owner/repository, immutable tag, two asset digests and PATCH body", async t => {
  let published = false, mutationCalls = 0, tokenCalls = 0, forbiddenPaths = 0;
  t.mock.method(globalThis, "fetch", async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    assert(url.startsWith("https://api.github.com/repos/ExampleOwner/disposable-release-canary"));
    assert.equal((init.headers as Record<string,string>).authorization, "Bearer fixture-credential");
    const path = url.split("/disposable-release-canary")[1];
    let value: Record<string, any>;
    if (path === "" && init.method === "GET") value = { id: subject.repositoryId,
      owner: { id: subject.ownerId, login: subject.owner }, name: subject.repository };
    else if (path === "/git/ref/tags/v1.2.3-rc.1") value = { ref: "refs/tags/v1.2.3-rc.1",
      object: { type: "commit", sha: subject.tagCommit } };
    else if (path === "/releases/981" && init.method === "GET") value = { id: subject.releaseId,
      tag_name: subject.tagName, draft: !published, prerelease: true,
      published_at: published ? new Date().toISOString() : null,
      assets: [{ id: subject.packageAssetId, name: subject.packageAssetName, state: "uploaded", digest: subject.packageDigest },
        { id: subject.provenanceAssetId, name: "provenance.json", state: "uploaded", digest: subject.provenanceDigest }] };
    else if (path === "/releases/981" && init.method === "PATCH") {
      mutationCalls++;assert.deepEqual(JSON.parse(init.body as string),
        { draft: false, prerelease: true, make_latest: "false" });
      published = true;value = { id: subject.releaseId, tag_name: subject.tagName, draft: false, prerelease: true };
    } else { forbiddenPaths++;throw Error("unexpected_endpoint"); }
    return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  });
  const provider = new GitHubReleaseV1Provider(subject, { getToken: async () => {
    tokenCalls++;return "fixture-credential";
  } });
  const before = await provider.observe(subject);assert.equal(before.draft, true);
  await provider.publishDraft(subject);
  const after = await provider.observe(subject);
  assert.equal(after.draft, false);assert.equal(mutationCalls, 1);assert.equal(forbiddenPaths, 0);
  assert(tokenCalls >= 8);
  await assert.rejects(provider.observe({ ...subject, releaseId: 982 }), /provider_target_changed/);
  assert.equal(mutationCalls, 1);
});

test("HTTP adapter fails closed on changed identity and denied token without publishing", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    calls++;
    return new Response(JSON.stringify({ id: subject.repositoryId + 1, owner: { id: subject.ownerId,
      login: subject.owner }, name: subject.repository }), { headers: { "content-type": "application/json" } });
  });
  const adapter = new GitHubReleaseV1Provider(subject, { getToken: async () => "fixture-credential" });
  await assert.rejects(adapter.publishDraft(subject), /github_repository_changed/);
  assert.equal(calls, 1);
  const denied = new GitHubReleaseV1Provider(subject, { getToken: async () => { throw Error("no_token"); } });
  await assert.rejects(denied.observe(subject), /github_provider_unavailable/);
  assert.equal(calls, 1);
});


test("ambiguous unsuccessful PATCH is never invoked twice on restart", () =>
  lab(async root => {
    const f = makeFixture(root), request = f.request();
    f.provider.publishDraft = async () => { f.provider.publicationCalls++; throw Error("connection_lost_before_provider_acceptance"); };
    const first = new ReleaseV1Controller(f.policy, f.provider, f.signer, root);
    assert.equal((await first.execute(request)).state, "publish_attempted");
    assert.equal(f.provider.publicationCalls, 1);
    const restarted = new ReleaseV1Controller(f.policy, f.provider, f.signer, root);
    assert.equal((await restarted.execute(request)).state, "publish_attempted");
    assert.equal((await restarted.reconcile(request.transactionId)).state, "publish_attempted");
    assert.equal(f.provider.publicationCalls, 1);
  }));

test("after-effect artifact drift cannot be signed or retried", () =>
  lab(async root => {
    const f = makeFixture(root), request = f.request();
    const publish = f.provider.publishDraft.bind(f.provider);
    f.provider.publishDraft = async () => { await publish(); f.provider.badArtifact = true; };
    const c = new ReleaseV1Controller(f.policy, f.provider, f.signer, root);
    const first = await c.execute(request);
    assert.equal(first.state, "publish_attempted");
    assert.equal(first.receipt, null);
    assert.equal(f.provider.publicationCalls, 1);
    assert.equal((await c.reconcile(request.transactionId)).state, "publish_attempted");
    assert.equal(f.provider.publicationCalls, 1);
  }));

test("target uniqueness also rejects a fresh nonce on a second transaction", () =>
  lab(async root => {
    const f = makeFixture(root), c = new ReleaseV1Controller(f.policy, f.provider, f.signer, root);
    assert.equal((await c.execute(f.request())).state, "signed");
    f.provider.published = false; // adversarial fixture only; not a supported GitHub revert
    await assert.rejects(c.execute(f.request()), /UNIQUE constraint/);
    assert.equal(f.provider.publicationCalls, 1);
  }));
