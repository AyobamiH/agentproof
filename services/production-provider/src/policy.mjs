import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { digest, sha256, stableJson } from "../../../dist/hash.js";
import { publicKeyFingerprint } from "../../../dist/signer.js";
import { parseJsonStrict } from "../../../dist/strict-json.js";
import { signReceiptV2, verifyReceiptV2, payloadDigestV2 } from "../../../dist/receipt-v2.js";

export const MAX_BYTES = 64 * 1024;
export const ISSUER = "agentproof.production-canary.authority.v1";
export const KEY_ID = "agentproof.production-canary.receipts.v1";
export const INTENT = Object.freeze({ summary: "Production provider canary: replace one disposable tracked file",
  requestedBy: "agentproof-production-canary", acceptanceCriteria: ["canary.txt contains after followed by a newline"] });
export class Rejection extends Error {
  constructor(code, status = 403) { super(code); this.code = code; this.status = status; }
}
export const demand = (condition, code = "policy_rejected", status = 403) => {
  if (!condition) throw new Rejection(code, status);
};
export function exact(value, keys) {
  demand(value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join(" ") === keys.split(" ").sort().join(" "), "invalid_document", 400);
}
export function strictJson(raw) {
  demand(Buffer.byteLength(raw) <= MAX_BYTES, "document_too_large", 413);
  parseJsonStrict(raw);
  const value = JSON.parse(raw);
  const inspect = (v, depth = 0) => {
    demand(depth <= 32, "document_too_deep", 400);
    if (v && typeof v === "object") {
      demand(!Object.hasOwn(v, "__proto__"), "invalid_document", 400);
      for (const item of Object.values(v)) inspect(item, depth + 1);
    }
  };
  inspect(value);
  return value;
}
export function identityScope(claims) {
  return `${claims.run_id}-${claims.run_attempt}`;
}
export function canaryRoot(claims) { return `/tmp/agentproof-production-canary-${identityScope(claims)}`; }
export function canaryAction(claims) {
  return { type: "agentproof.repository_patch.v1", repositoryRoot: canaryRoot(claims) + "/repository",
    operations: [{ kind: "write", path: "canary.txt", contentBase64: Buffer.from("after\n").toString("base64") }] };
}
export function expectedManifest(content) {
  return [{ path: "canary.txt", mode: "100644", sha256: sha256(content), byteLength: Buffer.byteLength(content), exists: true, tracked: true }];
}
function validTime(value) {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function validateRequest(request, claims, { now = Date.now(), existing = false } = {}) {
  exact(request, "schema schemaVersion actionType correlationId transactionId stateDirectory preparedDigest expiresAt nonce binding requestDigest");
  const b = request.binding;
  exact(b, "schemaVersion transactionId intentDigest actionDigest target baseCommit branch beforeManifestDigest proposedManifestDigest patchDigest expectedDiffDigest affectedPaths verificationPlanDigest policyVersion expiresAt nonce");
  demand(request.schema === "agentproof.protocol.approval-request" && request.schemaVersion === "1.0.0" &&
    request.actionType === "agentproof.repository_patch.v1" && b.schemaVersion === "agentproof.repository-patch.approval.v1" &&
    b.policyVersion === "agentproof.repository-patch.v1");
  demand(/^[0-9a-f-]{36}$/.test(request.transactionId) && request.transactionId === b.transactionId);
  demand(request.correlationId === `production-canary:${identityScope(claims)}` &&
    request.nonce === `production-canary:${identityScope(claims)}` && request.nonce === b.nonce);
  demand(request.stateDirectory === canaryRoot(claims) + "/state" && b.target === canaryAction(claims).repositoryRoot &&
    b.branch === "main" && /^[0-9a-f]{40}$/.test(b.baseCommit));
  demand(stableJson(b.affectedPaths) === '["canary.txt"]' && b.intentDigest === digest(INTENT) &&
    b.actionDigest === digest(canaryAction(claims)) &&
    b.verificationPlanDigest === digest([]) &&
    b.beforeManifestDigest === digest(expectedManifest("before\n")) && b.proposedManifestDigest === digest(expectedManifest("after\n")));
  for (const value of [request.preparedDigest, request.requestDigest, b.patchDigest, b.expectedDiffDigest, b.verificationPlanDigest])
    demand(typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
  demand(validTime(request.expiresAt) && request.expiresAt === b.expiresAt && Date.parse(request.expiresAt) <= now + 600_000 &&
    Date.parse(request.expiresAt) > now - (existing ? 1_800_000 : 0), "approval_expired");
  const { requestDigest, ...unsigned } = request;
  demand(digest(unsigned) === requestDigest, "request_digest_mismatch");
  return request;
}
export function keyMaterial(env) {
  const privateKey = createPrivateKey(env.SIGNING_PRIVATE_KEY_PEM);
  const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  demand(privateKey.asymmetricKeyType === "ed25519" && publicKeyPem === env.SIGNING_PUBLIC_KEY_PEM &&
    publicKeyFingerprint(publicKeyPem) === env.SIGNER_FINGERPRINT, "key_configuration_invalid", 503);
  return { privateKey, publicKeyPem };
}
export function approvalDecision(request, env, now = Date.now()) {
  const key = keyMaterial(env);
  const unsigned = { schema: "agentproof.protocol.approval-decision", schemaVersion: "1.0.0", actionType: request.actionType,
    correlationId: request.correlationId, transactionId: request.transactionId, requestDigest: request.requestDigest,
    preparedDigest: request.preparedDigest, decision: "approved", authorityEnvironment: "production", issuer: ISSUER,
    decidedAt: new Date(now).toISOString(), expiresAt: request.expiresAt, nonce: request.nonce,
    authorityPublicKeyPem: key.publicKeyPem, authorityFingerprint: env.SIGNER_FINGERPRINT, approvalRequest: request };
  return { ...unsigned, signatureBase64: sign(null, Buffer.from(stableJson(unsigned)), key.privateKey).toString("base64") };
}
export function validateDecision(decision, claims, env, now = Date.now()) {
  exact(decision, "schema schemaVersion actionType correlationId transactionId requestDigest preparedDigest decision authorityEnvironment issuer decidedAt expiresAt nonce authorityPublicKeyPem authorityFingerprint approvalRequest signatureBase64");
  const request = validateRequest(decision.approvalRequest, claims, { now, existing: true });
  demand(decision.schema === "agentproof.protocol.approval-decision" && decision.schemaVersion === "1.0.0" &&
    decision.actionType === request.actionType && decision.authorityEnvironment === "production" &&
    decision.decision === "approved" && decision.issuer === ISSUER &&
    decision.authorityPublicKeyPem === env.AUTHORITY_PUBLIC_KEY_PEM && decision.authorityFingerprint === env.AUTHORITY_FINGERPRINT &&
    publicKeyFingerprint(decision.authorityPublicKeyPem) === env.AUTHORITY_FINGERPRINT, "authority_rejected");
  demand(validTime(decision.decidedAt) && Date.parse(decision.decidedAt) <= now &&
    Date.parse(decision.decidedAt) < Date.parse(decision.expiresAt), "authority_rejected");
  for (const field of ["correlationId", "transactionId", "requestDigest", "preparedDigest", "expiresAt", "nonce"])
    demand(decision[field] === request[field], "authority_rejected");
  const { signatureBase64, ...unsigned } = decision;
  demand(typeof signatureBase64 === "string" && /^[A-Za-z0-9+/]{86}==$/.test(signatureBase64) &&
    Buffer.from(signatureBase64, "base64").toString("base64") === signatureBase64 &&
    verify(null, Buffer.from(stableJson(unsigned)), createPublicKey(env.AUTHORITY_PUBLIC_KEY_PEM), Buffer.from(signatureBase64, "base64")), "authority_rejected");
  return { request, decisionDigest: digest(unsigned) };
}
export async function makeReceipt(body, claims, env) {
  exact(body, "payload approvalDecision predecessorChain");
  demand(Array.isArray(body.predecessorChain) && body.predecessorChain.length <= 1, "predecessor_rejected");
  const { request, decisionDigest } = validateDecision(body.approvalDecision, claims, env);
  const p = body.payload, b = p?.approvalBinding, r = request.binding;
  demand(p && b && p.signingPolicyId === KEY_ID && p.authorityEnvironment === "production" &&
    p.transactionId === request.transactionId && p.correlationId === request.correlationId &&
    p.preparedActionDigest === request.preparedDigest && p.approvalDecisionDigest === decisionDigest, "receipt_binding_rejected");
  for (const [payloadField, requestField] of [["intentDigest", "intentDigest"], ["actionDigest", "actionDigest"],
    ["repositoryRoot", "target"], ["beforeStateDigest", "beforeManifestDigest"], ["proposedStateDigest", "proposedManifestDigest"]])
    demand(p[payloadField] === r[requestField], "receipt_binding_rejected");
  demand(p.repositoryIdentity?.baseCommit === r.baseCommit && b.issuer === ISSUER && b.nonce === request.nonce &&
    b.decidedAt === body.approvalDecision.decidedAt && b.expiresAt === request.expiresAt &&
    b.approvalDecisionId === `approval-decision:${decisionDigest}` && b.approvedFromTaskId === request.requestDigest, "receipt_binding_rejected");
  demand(p.executionState === "executed" && p.verificationState === "verified" &&
    p.evidence?.verification?.identityUnchanged === true && p.evidence.verification.unexpectedUntrackedPaths.length === 0 &&
    p.evidence.verification.commands.length === 0 && p.evidence.readOnlyEvidence.length === 0 &&
    p.observedStateDigest === r.proposedManifestDigest, "unverified_result");
  demand(validTime(p.issuedAt) && Math.abs(Date.now() - Date.parse(p.issuedAt)) < 300_000 &&
    validTime(p.evidence.execution.attemptedAt) && Date.parse(p.evidence.execution.attemptedAt) >= Date.parse(b.decidedAt) &&
    Date.parse(p.evidence.execution.attemptedAt) < Date.parse(b.expiresAt), "execution_time_rejected");
  const successor = p.predecessorPayloadDigest !== null;
  demand(successor ? p.compensationState === "compensated" && body.predecessorChain.length === 1 &&
    body.predecessorChain[0].proof.payloadDigest === p.predecessorPayloadDigest :
    p.compensationState === null && body.predecessorChain.length === 0, "predecessor_rejected");
  const key = keyMaterial(env);
  const receipt = await signReceiptV2(p, { keyId: async () => KEY_ID, publicKeyPem: async () => key.publicKeyPem,
    signCanonical: async input => sign(null, Buffer.from(input), key.privateKey) });
  demand(verifyReceiptV2({ document: receipt, trustedSignerFingerprints: [env.SIGNER_FINGERPRINT],
    requiredAuthorityEnvironment: "production", predecessorChain: body.predecessorChain }).trusted, "receipt_inconsistent");
  return receipt;
}

export async function decideOnce(storage, request, claims, env) {
  validateRequest(request, claims);
  return storage.transaction(async txn => {
    const previous = await txn.get("approval");
    if (previous) {
      demand(previous.requestDigest === request.requestDigest, "run_already_bound", 409);
      return previous;
    }
    const decision = approvalDecision(request, env);
    await txn.put("approval", decision);
    return decision;
  });
}
export async function signOnce(storage, body, claims, env) {
  const receipt = await makeReceipt(body, claims, env);
  const phase = receipt.payload.predecessorPayloadDigest === null ? "initial" : "compensation";
  // Recovery may regenerate only receiptId/issuedAt after a lost signing response.
  const { receiptId, issuedAt, ...semanticPayload } = receipt.payload;
  const semanticDigest = digest(semanticPayload), payloadDigest = payloadDigestV2(receipt.payload);
  return storage.transaction(async txn => {
    const records = await txn.get(phase) ?? { semanticDigest, receipts: {} };
    demand(records.semanticDigest === semanticDigest, "conflicting_receipt", 409);
    if (phase === "compensation") {
      const initial = await txn.get("initial");
      demand(initial?.receipts[receipt.payload.predecessorPayloadDigest], "unrecorded_predecessor", 409);
    }
    if (records.receipts[payloadDigest]) return records.receipts[payloadDigest].proof;
    demand(Object.keys(records.receipts).length < 8, "recovery_budget_exhausted", 409);
    records.receipts[payloadDigest] = receipt;
    await txn.put(phase, records);
    return receipt.proof;
  });
}
