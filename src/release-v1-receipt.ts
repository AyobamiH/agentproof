import { createPublicKey, randomUUID, verify as cryptoVerify } from "node:crypto";
import { digest, sha256, stableJson } from "./hash.js";
import { publicKeyFingerprint, type SigningProvider } from "./signer.js";
import { RELEASE_V1, exactKeys, releaseAssert, releaseTime, validateReleaseSubject, validateReleaseObservation,
  validateReleaseApproval, type ReleaseV1Subject, type ReleaseV1Observation, type ReleaseV1Approval,
  type ReleaseV1Policy, type ReleaseV1Request } from "./release-v1-contract.js";

export const RELEASE_RECEIPT_V2_DOMAIN = "agentproof.signed-receipt.v2.release\0";
export interface ReleaseV2Payload {
  schemaId: "agentproof.signed-receipt.v2"; schemaVersion: "2.0.0"; receiptFormatVersion: "v2";
  actionType: typeof RELEASE_V1; receiptId: string; issuedAt: string; transactionId: string; nonce: string; idempotencyKey: string;
  subject: ReleaseV1Subject; subjectDigest: string; approval: ReleaseV1Approval; approvalDigest: string;
  intentDigest: string; effect: "publish_exact_existing_draft_prerelease"; attemptedAt: string;
  verifiedAt: string; before: ReleaseV1Observation; after: ReleaseV1Observation;
  verificationState: "verified_provider_readback"; independentOutcomeVerified: false;
  compensationState: "not_supported"; signerRole: "independent_receipt_signer"; signingPolicyId: string;
  predecessorPayloadDigest: null;
}
export interface ReleaseV2Receipt {
  payload: ReleaseV2Payload;
  proof: { algorithm: "Ed25519"; keyId: string; publicKeyPem: string; signerFingerprint: string;
    payloadDigest: string; signatureBase64: string };
}
export function releaseSignatureInput(payload: ReleaseV2Payload): string {
  return RELEASE_RECEIPT_V2_DOMAIN + stableJson(payload);
}
export function releasePayloadDigest(payload: ReleaseV2Payload): string {
  return sha256(Buffer.from(releaseSignatureInput(payload)));
}
export async function signReleaseReceiptV2(payload: ReleaseV2Payload, provider: SigningProvider,
  policy: ReleaseV1Policy): Promise<ReleaseV2Receipt> {
  const keyId = await provider.keyId(), publicKeyPem = await provider.publicKeyPem();
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  releaseAssert(keyId === policy.signerKeyId && fingerprint === policy.signerFingerprint &&
    !policy.authorityFingerprints.includes(fingerprint), "untrusted_signer");
  const signature = await provider.signCanonical(releaseSignatureInput(payload));
  releaseAssert(Buffer.isBuffer(signature) && signature.length === 64, "signer_result_invalid");
  const document: ReleaseV2Receipt = { payload, proof: {
    algorithm: "Ed25519", keyId, publicKeyPem, signerFingerprint: fingerprint,
    payloadDigest: releasePayloadDigest(payload), signatureBase64: signature.toString("base64"),
  } };
  const checked = verifyReleaseReceiptV2(document, policy);
  releaseAssert(checked.trusted, "self_verification_failed");
  return document;
}
export function releasePayload(args: { request: ReleaseV1Request; before: ReleaseV1Observation;
  after: ReleaseV1Observation; attemptedAt: string; verifiedAt: string;
  signingPolicyId: string; receiptId?: string; issuedAt?: string }): ReleaseV2Payload {
  const { request } = args;
  return { schemaId: "agentproof.signed-receipt.v2", schemaVersion: "2.0.0",
    receiptFormatVersion: "v2", actionType: RELEASE_V1, receiptId: args.receiptId ?? randomUUID(),
    issuedAt: args.issuedAt ?? new Date().toISOString(), transactionId: request.transactionId,
    nonce: request.nonce, idempotencyKey: request.idempotencyKey, subject: request.subject, subjectDigest: digest(request.subject),
    approval: request.approval, approvalDigest: digest(request.approval),
    intentDigest: digest({ transactionId: request.transactionId, idempotencyKey: request.idempotencyKey,
      nonce: request.nonce, subjectDigest: digest(request.subject) }),
    effect: "publish_exact_existing_draft_prerelease", attemptedAt: args.attemptedAt,
    verifiedAt: args.verifiedAt, before: args.before, after: args.after,
    verificationState: "verified_provider_readback", independentOutcomeVerified: false,
    compensationState: "not_supported", signerRole: "independent_receipt_signer",
    signingPolicyId: args.signingPolicyId, predecessorPayloadDigest: null };
}
export interface ReleaseVerification {
  cryptographicallyValid: boolean; trusted: boolean; reason: string;
  signerFingerprint: string | null; verifiedClaims: null | {
    transactionId: string; subjectDigest: string; approvalIssuer: string;
    verifiedAt: string; independentOutcomeVerified: false; compensationState: "not_supported";
  };
}
const payloadKeys = ["schemaId", "schemaVersion", "receiptFormatVersion", "actionType", "receiptId",
  "issuedAt", "transactionId", "nonce", "idempotencyKey", "subject", "subjectDigest", "approval", "approvalDigest",
  "intentDigest", "effect", "attemptedAt", "verifiedAt", "before", "after", "verificationState",
  "independentOutcomeVerified", "compensationState", "signerRole", "signingPolicyId",
  "predecessorPayloadDigest"];
const proofKeys = ["algorithm", "keyId", "publicKeyPem", "signerFingerprint", "payloadDigest", "signatureBase64"];
export function verifyReleaseReceiptV2(document: unknown, policy: ReleaseV1Policy): ReleaseVerification {
  const fail = (reason: string, cryptoValid = false, signerFingerprint: string | null = null): ReleaseVerification =>
    ({ cryptographicallyValid: cryptoValid, trusted: false, reason, signerFingerprint, verifiedClaims: null });
  try {
    exactKeys(document, ["payload", "proof"], "receipt_shape");
    const { payload, proof } = document as unknown as ReleaseV2Receipt;
    exactKeys(payload, payloadKeys, "receipt_payload_shape");
    exactKeys(proof, proofKeys, "receipt_proof_shape");
    validateReleaseSubject(payload.subject); validateReleaseSubject(policy.subject);
    releaseAssert(payload.schemaId === "agentproof.signed-receipt.v2" &&
      payload.schemaVersion === "2.0.0" && payload.receiptFormatVersion === "v2" &&
      payload.actionType === RELEASE_V1 && payload.effect === "publish_exact_existing_draft_prerelease" &&
      payload.verificationState === "verified_provider_readback" &&
      payload.independentOutcomeVerified === false && payload.compensationState === "not_supported" &&
      payload.signerRole === "independent_receipt_signer" && payload.predecessorPayloadDigest === null &&
      payload.signingPolicyId === policy.signerKeyId, "receipt_constants");
    releaseAssert(typeof payload.receiptId === "string" && /^[a-f0-9-]{36}$/.test(payload.receiptId) &&
      typeof payload.transactionId === "string" && /^[a-f0-9-]{36}$/.test(payload.transactionId) &&
      typeof payload.nonce === "string" && payload.nonce.length >= 8 &&
      typeof payload.idempotencyKey === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(payload.idempotencyKey) &&
      payload.subjectDigest === digest(payload.subject) && payload.subjectDigest === digest(policy.subject) &&
      payload.approvalDigest === digest(payload.approval) &&
      payload.intentDigest === digest({ transactionId: payload.transactionId, idempotencyKey: payload.idempotencyKey,
        nonce: payload.nonce, subjectDigest: payload.subjectDigest }), "receipt_binding");
    const issued = releaseTime(payload.issuedAt), attempted = releaseTime(payload.attemptedAt),
      verified = releaseTime(payload.verifiedAt);
    releaseAssert(attempted <= verified && verified <= issued && verified >=
      releaseTime(payload.approval.decidedAt), "receipt_times");
    validateReleaseObservation(payload.before, payload.subject, false);
    validateReleaseObservation(payload.after, payload.subject, true);
    const request: ReleaseV1Request = { stateDirectory: "/", transactionId: payload.transactionId,
      nonce: payload.nonce, idempotencyKey: payload.idempotencyKey, subject: payload.subject,
      approval: payload.approval };
    const authority = validateReleaseApproval(payload.approval, request, policy, attempted, true);
    releaseAssert(authority !== policy.signerFingerprint &&
      /^[0-9a-f]{64}$/.test(payload.intentDigest), "receipt_approval");
    releaseAssert(proof.algorithm === "Ed25519" && proof.keyId === policy.signerKeyId &&
      proof.signerFingerprint === policy.signerFingerprint &&
      !policy.authorityFingerprints.includes(proof.signerFingerprint) &&
      proof.payloadDigest === releasePayloadDigest(payload), "receipt_proof_binding");
    const key = createPublicKey(proof.publicKeyPem);
    releaseAssert(key.asymmetricKeyType === "ed25519" &&
      publicKeyFingerprint(proof.publicKeyPem) === proof.signerFingerprint &&
      /^[A-Za-z0-9+/]{86}==$/.test(proof.signatureBase64) &&
      Buffer.from(proof.signatureBase64, "base64").toString("base64") === proof.signatureBase64, "receipt_signer_key");
    releaseAssert(cryptoVerify(null, Buffer.from(releaseSignatureInput(payload)), key,
      Buffer.from(proof.signatureBase64, "base64")), "receipt_signature_invalid");
    return { cryptographicallyValid: true, trusted: true, reason: "trusted", signerFingerprint: proof.signerFingerprint,
      verifiedClaims: { transactionId: payload.transactionId, subjectDigest: payload.subjectDigest,
        approvalIssuer: payload.approval.issuer, verifiedAt: payload.verifiedAt,
        independentOutcomeVerified: false, compensationState: "not_supported" } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "invalid_document");
  }
}
