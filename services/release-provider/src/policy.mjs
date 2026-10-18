import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { digest, stableJson } from "../../../dist/hash.js";
import { publicKeyFingerprint } from "../../../dist/signer.js";
import { parseJsonStrict } from "../../../dist/strict-json.js";
import { GitHubReleaseV1Provider, canonicalGitHubPublishedAt } from "../../../dist/release-v1-github.js";
import { validateReleaseSubject, validateReleaseObservation, validateReleaseRequest,
  validateReleaseApproval, exactKeys, releaseAssert } from "../../../dist/release-v1-contract.js";
import { releasePayload, signReleaseReceiptV2 } from "../../../dist/release-v1-receipt.js";
import { demand, ReleaseRefusal } from "./identity.mjs";

export const AUTHORITY_ISSUER = "agentproof.release-canary.authority.v1";
export const RECEIPT_KEY_ID = "agentproof.release-canary.receipts.v1";
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
export const MAX_BODY = 64 * 1024;

export function strictBody(raw) {
  demand(typeof raw === "string" && Buffer.byteLength(raw, "utf8") <= MAX_BODY,
    "body_too_large", 413);
  try {
    parseJsonStrict(raw);
    const doc = JSON.parse(raw);
    demand(doc && typeof doc === "object" && !Array.isArray(doc), "invalid_json", 400);
    return doc;
  } catch (error) {
    if (error instanceof ReleaseRefusal) throw error;
    throw new ReleaseRefusal("invalid_json", 400);
  }
}
export function readTarget(env) {
  demand(env.ENABLED === "true", "provider_disabled", 503);
  demand(typeof env.TARGET_SUBJECT_JSON === "string" &&
    env.TARGET_SUBJECT_JSON.length > 50 && env.TARGET_SUBJECT_JSON.length < 4096,
    "target_unconfigured", 503);
  let subject;
  try {
    subject = strictBody(env.TARGET_SUBJECT_JSON);
    validateReleaseSubject(subject);
  } catch { throw new ReleaseRefusal("target_unconfigured", 503); }
  demand(subject.owner === "AyobamiH" && subject.repository === "agentproof-release-canary" &&
    subject.ownerId === 47716486 && subject.repositoryId === 1423718326, "target_unconfigured", 503);
  return subject;
}
export function privateKey(env) {
  let key, pem;
  try {
    key = createPrivateKey(env.SIGNING_PRIVATE_KEY_PEM);
    pem = createPublicKey(key).export({ type: "spki", format: "pem" }).toString();
    demand(key.asymmetricKeyType === "ed25519" && pem === env.SIGNING_PUBLIC_KEY_PEM &&
      publicKeyFingerprint(pem) === env.SIGNER_FINGERPRINT,
      "signing_key_inconsistent", 503);
  } catch { throw new ReleaseRefusal("signing_key_inconsistent", 503); }
  return { key, pem };
}
export function provider(subject, githubToken) {
  return new GitHubReleaseV1Provider(subject, {
    getToken: async () => githubToken, timeoutMs: 12000,
  });
}
export function seedFromRequest(request) {
  const { approval, ...seed } = request;
  return seed;
}
export function validateSeed(seed, claims, env) {
  exactKeys(seed, ["stateDirectory", "transactionId", "nonce", "idempotencyKey", "subject"],
    "seed_shape");
  const subject = readTarget(env);
  demand(digest(seed.subject) === digest(subject), "target_not_allowed");
  const stamp = "release-canary:" + claims.run_id;
  demand(seed.stateDirectory === "/tmp/agentproof-release-canary-" + claims.run_id &&
    seed.nonce === stamp && seed.idempotencyKey === stamp &&
    typeof seed.transactionId === "string" &&
    /^[0-9a-f-]{36}$/.test(seed.transactionId), "run_identity_rejected");
  return subject;
}
export function policy(env, subject) {
  const signerFingerprint = env.ROLE === "approval" ?
    env.RECEIPT_FINGERPRINT : env.SIGNER_FINGERPRINT;
  return {
    subject, issuer: AUTHORITY_ISSUER,
    authorityFingerprints: [env.ROLE === "approval" ?
      env.SIGNER_FINGERPRINT : env.AUTHORITY_FINGERPRINT],
    signerFingerprint, signerKeyId: RECEIPT_KEY_ID,
  };
}
export function decision(seed, env, now = Date.now()) {
  const { key, pem } = privateKey(env);
  const unsigned = {
    schema: "agentproof.release.approval.v1", actionType: "agentproof.release.v1",
    subjectDigest: digest(seed.subject), transactionId: seed.transactionId,
    nonce: seed.nonce, decision: "approved", environment: "production",
    issuer: AUTHORITY_ISSUER, decidedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 300_000).toISOString(),
    authorityPublicKeyPem: pem,
  };
  return { ...unsigned,
    signatureBase64: sign(null, Buffer.from(stableJson(unsigned)), key).toString("base64") };
}
export function validateSignedRequest(request, claims, env, { historical = false } = {}) {
  exactKeys(request, ["stateDirectory", "transactionId", "nonce", "idempotencyKey",
    "subject", "approval"], "release_request");
  const seed = seedFromRequest(request);
  const subject = validateSeed(seed, claims, env);
  if (historical) {
    validateReleaseApproval(request.approval, request, policy(env, subject), Date.now(), true);
  } else {
    validateReleaseRequest(request, policy(env, subject));
  }
  return { seed, subject };
}
export function completionUnsigned(record, env) {
  return {
    schema: "agentproof.release-canary.execution-evidence.v1",
    sourceCommit: env.TRUSTED_SOURCE_SHA,
    transactionId: record.seed.transactionId,
    requestDigest: digest(record.seed),
    subjectDigest: digest(record.seed.subject),
    attemptedAt: record.attemptedAt, verifiedAt: record.verifiedAt,
    before: record.before, after: record.after,
    recoveryAuthorisationDigest: record.recoveryAuthorisation ? digest(record.recoveryAuthorisation) : null,
  };
}
export function signCompletion(record, env) {
  const raw = completionUnsigned(record, env);
  return { ...raw,
    signatureBase64: sign(null, Buffer.from(stableJson(raw)), privateKey(env).key).toString("base64") };
}
export function validateCompletion(completion, request, env) {
  exactKeys(completion, ["schema", "sourceCommit", "transactionId", "requestDigest",
    "subjectDigest", "attemptedAt", "verifiedAt", "before", "after", "recoveryAuthorisationDigest", "signatureBase64"],
  "completion_shape");
  const { signatureBase64, ...unsigned } = completion;
  demand(completion.schema === "agentproof.release-canary.execution-evidence.v1" &&
    completion.sourceCommit === env.TRUSTED_SOURCE_SHA &&
    completion.transactionId === request.transactionId &&
    completion.requestDigest === digest(seedFromRequest(request)) &&
    completion.subjectDigest === digest(request.subject),
    "invalid_execution_evidence");
  demand(env.RECOVERY_REQUIRED === "true" ? HEX64.test(completion.recoveryAuthorisationDigest) :
    completion.recoveryAuthorisationDigest === null, "recovery_completion_required");
  validateReleaseObservation(completion.before, request.subject, false);
  validateReleaseObservation(completion.after, request.subject, true);
  demand(typeof completion.attemptedAt === "string" &&
    Date.parse(completion.attemptedAt) >= Date.parse(request.approval.decidedAt) &&
    Date.parse(completion.attemptedAt) < Date.parse(request.approval.expiresAt) &&
    Date.parse(completion.verifiedAt) >= Date.parse(completion.attemptedAt) &&
    Date.parse(completion.verifiedAt) <= Date.now() + 30_000 &&
    Date.parse(completion.verifiedAt) >= Date.now() - 600_000,
    "execution_time_rejected");
  demand(typeof signatureBase64 === "string" &&
    /^[A-Za-z0-9+/]{86}==$/.test(signatureBase64) &&
    Buffer.from(signatureBase64, "base64").toString("base64") === signatureBase64 &&
    verify(null, Buffer.from(stableJson(unsigned)),
      createPublicKey(env.AUTHORITY_PUBLIC_KEY_PEM), Buffer.from(signatureBase64, "base64")) &&
    publicKeyFingerprint(env.AUTHORITY_PUBLIC_KEY_PEM) === env.AUTHORITY_FINGERPRINT,
    "execution_signature_rejected");
  return unsigned;
}
export function releaseSigner(env) {
  const { key, pem } = privateKey(env);
  return {
    keyId: async () => RECEIPT_KEY_ID,
    publicKeyPem: async () => pem,
    signCanonical: async input => sign(null, Buffer.from(input), key),
  };
}
async function anonymousGitHubJson(path) {
  const response = await fetch("https://api.github.com/repos/AyobamiH/agentproof-release-canary" + path, {
    method: "GET", redirect: "error", cache: "no-store",
    headers: { accept: "application/vnd.github+json", "user-agent": "agentproof-separate-release-signer/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  demand(response.ok && response.status === 200, "public_readback_unavailable", 503);
  const raw = await response.text();
  demand(Buffer.byteLength(raw) <= 64 * 1024, "public_readback_oversized", 503);
  return strictBody(raw);
}
export async function publicReleaseReadback(subject) {
  const repo = await anonymousGitHubJson("");
  demand(repo.id === subject.repositoryId && repo.owner?.id === subject.ownerId &&
    repo.name === subject.repository && repo.owner.login === subject.owner &&
    repo.private === false, "public_repo_identity_mismatch", 403);
  const tag = await anonymousGitHubJson("/git/ref/tags/" + subject.tagName);
  demand(tag.ref === "refs/tags/" + subject.tagName && tag.object?.type === "commit" &&
    tag.object.sha === subject.tagCommit, "public_tag_identity_mismatch", 403);
  const release = await anonymousGitHubJson("/releases/" + subject.releaseId);
  demand(release.id === subject.releaseId && release.tag_name === subject.tagName &&
    Array.isArray(release.assets) && release.assets.length === 2, "public_release_identity_mismatch", 403);
  const pkg = release.assets.find(a => a.id === subject.packageAssetId),
    provenance = release.assets.find(a => a.id === subject.provenanceAssetId);
  demand(pkg?.name === subject.packageAssetName && pkg?.state === "uploaded" &&
    pkg.digest === subject.packageDigest && provenance?.state === "uploaded" &&
    provenance.digest === subject.provenanceDigest, "public_assets_changed", 403);
  return {
    schema: "agentproof.release.observation.v1", ownerId: repo.owner.id, repositoryId: repo.id,
    releaseId: release.id, tagName: release.tag_name, tagCommit: tag.object.sha,
    packageAssetId: pkg.id, packageAssetName: pkg.name, packageDigest: pkg.digest,
    provenanceAssetId: provenance.id, provenanceDigest: provenance.digest,
    assetCount: release.assets.length, draft: release.draft,
    prerelease: release.prerelease, publishedAt: canonicalGitHubPublishedAt(release.published_at),
  };
}
export async function verifiedReceipt({ request, completion, env }) {
  validateCompletion(completion, request, env);
  // Independent read-only GitHub API with NO OAuth publisher credential.
  const now = await publicReleaseReadback(request.subject);
  validateReleaseObservation(now, request.subject, true);
  demand(stableJson(now) === stableJson(completion.after), "provider_observation_changed");
  const payload = releasePayload({
    request, before: completion.before, after: completion.after,
    attemptedAt: completion.attemptedAt, verifiedAt: completion.verifiedAt,
    signingPolicyId: RECEIPT_KEY_ID,
  });
  // AgentProof signer checks the observed GitHub result, but does not
  // pretend its own receipt is independent OpsTruth result verification.
  return signReleaseReceiptV2(payload, releaseSigner(env), policy(env, request.subject));
}
export function targetScope(subject) {
  return subject.repositoryId + ":" + subject.releaseId;
}

// A reservation proves that this exact seed won the permanent target fence.
// It is never a publication receipt and cannot attest an external outcome.
export function reservationEvidence(seed, approval, claims, env) {
  const unsigned = {
    schema: "agentproof.release-reservation.v1", state: "reserved",
    requestDigest: digest({ ...seed, approval }), subjectDigest: digest(seed.subject),
    transactionId: seed.transactionId, githubRunId: claims.run_id,
    githubRunAttempt: Number(claims.run_attempt),
    workflowCommit: env.TRUSTED_SOURCE_SHA,
    issuedAt: approval.decidedAt, expiresAt: approval.expiresAt,
    authorityPublicKeyPem: env.SIGNING_PUBLIC_KEY_PEM,
  };
  return { ...unsigned, signatureBase64: sign(null,
    Buffer.from("agentproof.release-reservation.v1\0" + stableJson(unsigned)),
    privateKey(env).key).toString("base64") };
}
