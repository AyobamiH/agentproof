import { createPublicKey, verify as verifySignature } from "node:crypto";
import { digest, stableJson } from "./hash.js";
import { publicKeyFingerprint } from "./signer.js";

export const RELEASE_V1 = "agentproof.release.v1" as const;
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
export const SUBJECT_KEYS = ["schema", "provider", "owner", "repository", "ownerId", "repositoryId", "releaseId",
  "tagName", "tagCommit", "packageAssetId", "packageAssetName", "packageDigest", "provenanceAssetId",
  "provenanceDigest", "prerelease", "makeLatest"] as const;

export interface ReleaseV1Subject {
  schema: "agentproof.release.subject.v1"; provider: "github"; owner: string; repository: string;
  ownerId: number; repositoryId: number; releaseId: number; tagName: string; tagCommit: string;
  packageAssetId: number; packageAssetName: string; packageDigest: string;
  provenanceAssetId: number; provenanceDigest: string; prerelease: true; makeLatest: false;
}
export interface ReleaseV1Observation {
  schema: "agentproof.release.observation.v1"; ownerId: number; repositoryId: number; releaseId: number;
  tagName: string; tagCommit: string; packageAssetId: number; packageAssetName: string;
  packageDigest: string; provenanceAssetId: number; provenanceDigest: string; assetCount: number;
  draft: boolean; prerelease: boolean; publishedAt: string | null;
}
export interface ReleaseV1Approval {
  schema: "agentproof.release.approval.v1"; actionType: typeof RELEASE_V1; subjectDigest: string;
  transactionId: string; nonce: string; decision: "approved" | "denied";
  environment: "production" | "development"; issuer: string; decidedAt: string; expiresAt: string;
  authorityPublicKeyPem: string; signatureBase64: string;
}
export interface ReleaseV1Policy {
  subject: ReleaseV1Subject; issuer: string; authorityFingerprints: string[];
  signerFingerprint: string; signerKeyId: string;
}
export interface ReleaseV1Request {
  stateDirectory: string; transactionId: string; nonce: string; idempotencyKey: string;
  subject: ReleaseV1Subject; approval: ReleaseV1Approval;
}
export interface ReleaseV1Provider {
  observe(subject: ReleaseV1Subject): Promise<ReleaseV1Observation>;
  publishDraft(subject: ReleaseV1Subject): Promise<void>;
}
export function releaseAssert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error("release_v1:" + code);
}
export function exactKeys(value: unknown, keys: readonly string[], code: string): asserts value is Record<string, unknown> {
  releaseAssert(value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype, code);
  releaseAssert(JSON.stringify(Object.keys(value as object).sort()) === JSON.stringify([...keys].sort()), code);
}
export function releaseTime(value: string): number {
  releaseAssert(typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), "invalid_time");
  const time = Date.parse(value);
  releaseAssert(Number.isFinite(time) && new Date(time).toISOString() === value, "invalid_time");
  return time;
}
export function validateReleaseSubject(value: unknown): asserts value is ReleaseV1Subject {
  exactKeys(value, SUBJECT_KEYS, "subject_shape");
  const v = value as unknown as ReleaseV1Subject;
  releaseAssert(v.schema === "agentproof.release.subject.v1" && v.provider === "github" &&
    v.prerelease === true && v.makeLatest === false, "subject_policy");
  releaseAssert(/^[A-Za-z0-9-]{1,39}$/.test(v.owner) && /^[A-Za-z0-9._-]{1,100}$/.test(v.repository) &&
    !v.repository.endsWith(".git"), "subject_repository");
  for (const x of [v.ownerId, v.repositoryId, v.releaseId, v.packageAssetId, v.provenanceAssetId])
    releaseAssert(Number.isSafeInteger(x) && x > 0, "subject_identifier");
  releaseAssert(v.packageAssetId !== v.provenanceAssetId, "same_asset");
  releaseAssert(/^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(v.tagName) && HEX40.test(v.tagCommit), "subject_tag");
  releaseAssert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v.packageAssetName) &&
    SHA256.test(v.packageDigest) && SHA256.test(v.provenanceDigest), "subject_artifacts");
}
export function validateReleaseObservation(value: unknown, subject: ReleaseV1Subject, published: boolean): asserts value is ReleaseV1Observation {
  exactKeys(value, ["schema", "ownerId", "repositoryId", "releaseId", "tagName", "tagCommit", "packageAssetId",
    "packageAssetName", "packageDigest", "provenanceAssetId", "provenanceDigest", "assetCount", "draft",
    "prerelease", "publishedAt"], "observation_shape");
  const v = value as unknown as ReleaseV1Observation;
  releaseAssert(v.schema === "agentproof.release.observation.v1" && v.ownerId === subject.ownerId &&
    v.repositoryId === subject.repositoryId && v.releaseId === subject.releaseId &&
    v.tagName === subject.tagName && v.tagCommit === subject.tagCommit &&
    v.packageAssetId === subject.packageAssetId && v.packageAssetName === subject.packageAssetName &&
    v.packageDigest === subject.packageDigest && v.provenanceAssetId === subject.provenanceAssetId &&
    v.provenanceDigest === subject.provenanceDigest && v.assetCount === 2 &&
    v.prerelease === true && v.draft === !published, "observation_mismatch");
  if (published) releaseTime(v.publishedAt as string);
  else releaseAssert(v.publishedAt === null, "unexpected_publication_time");
}
export function validateReleaseApproval(approval: ReleaseV1Approval, request: ReleaseV1Request,
  policy: ReleaseV1Policy, at = Date.now(), isHistorical = false): string {
  exactKeys(approval, ["schema", "actionType", "subjectDigest", "transactionId", "nonce",
    "decision", "environment", "issuer", "decidedAt", "expiresAt", "authorityPublicKeyPem", "signatureBase64"], "approval_shape");
  releaseAssert(approval.schema === "agentproof.release.approval.v1" && approval.actionType === RELEASE_V1 &&
    approval.decision === "approved" && approval.environment === "production" &&
    approval.transactionId === request.transactionId && approval.nonce === request.nonce &&
    approval.subjectDigest === digest(request.subject) && approval.issuer === policy.issuer, "approval_binding");
  const decided = releaseTime(approval.decidedAt), expires = releaseTime(approval.expiresAt);
  releaseAssert(decided <= at && expires > decided && expires - decided <= 600_000 &&
    (isHistorical || at < expires), "approval_expired_or_future");
  releaseAssert(typeof approval.signatureBase64 === "string" && /^[A-Za-z0-9+/]{86}==$/.test(approval.signatureBase64) &&
    Buffer.from(approval.signatureBase64, "base64").toString("base64") === approval.signatureBase64, "approval_signature_format");
  let fingerprint: string;
  try {
    const key = createPublicKey(approval.authorityPublicKeyPem);
    releaseAssert(key.asymmetricKeyType === "ed25519", "approval_key_type");
    fingerprint = publicKeyFingerprint(approval.authorityPublicKeyPem);
    releaseAssert(policy.authorityFingerprints.includes(fingerprint) && fingerprint !== policy.signerFingerprint, "untrusted_approval_authority");
    const { signatureBase64, ...unsigned } = approval;
    releaseAssert(verifySignature(null, Buffer.from(stableJson(unsigned)), key,
      Buffer.from(signatureBase64, "base64")), "approval_signature_invalid");
  } catch (error) {
    releaseAssert(error instanceof Error && error.message.startsWith("release_v1:") === true, "approval_signature_invalid");
    throw error;
  }
  return fingerprint;
}
export function validateReleaseRequest(request: ReleaseV1Request, policy: ReleaseV1Policy): void {
  exactKeys(request, ["stateDirectory", "transactionId", "nonce", "idempotencyKey", "subject", "approval"], "request_shape");
  validateReleaseSubject(request.subject); validateReleaseSubject(policy.subject);
  releaseAssert(digest(request.subject) === digest(policy.subject), "target_not_authorised");
  releaseAssert(typeof request.stateDirectory === "string" && request.stateDirectory.startsWith("/") &&
    !request.stateDirectory.includes("\0"), "invalid_state_root");
  releaseAssert(typeof request.transactionId === "string" && /^[a-f0-9-]{36}$/.test(request.transactionId) &&
    typeof request.nonce === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(request.nonce) &&
    typeof request.idempotencyKey === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(request.idempotencyKey), "transaction_identity");
  releaseAssert(Array.isArray(policy.authorityFingerprints) && policy.authorityFingerprints.length > 0 &&
    policy.authorityFingerprints.every(x => SHA256.test(x)) &&
    SHA256.test(policy.signerFingerprint) && typeof policy.signerKeyId === "string" &&
    policy.signerKeyId.length > 0 && policy.issuer.length > 0, "policy_invalid");
  validateReleaseApproval(request.approval, request, policy);
}
