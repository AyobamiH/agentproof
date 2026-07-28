import { createPublicKey, randomUUID, verify as cryptoVerify } from "node:crypto";
import { digest, sha256, stableJson } from "./hash.js";
import { publicKeyFingerprint, type SigningProvider } from "./signer.js";
import type { Approval, ReadOnlyEvidence } from "./types.js";
import type { RepositoryFileManifestEntry, RepositoryIdentity, RepositoryPatchTransaction, RepositoryPatchVerification } from "./repository-patch-types.js";

export const RECEIPT_V2_SCHEMA = "agentproof.signed-receipt.v2";
export const RECEIPT_V2_VERSION = "2.0.0";
export const RECEIPT_V2_DOMAIN = "agentproof.signed-receipt.v2\0";
const HEX = /^[a-f0-9]{64}$/;
const FP = /^sha256:[a-f0-9]{64}$/;

export interface ApprovalBindingV2 {
  schemaId: "agentproof.approval-binding.v2"; transactionId: string; correlationId: string;
  originalTaskId: string; approvalTaskId: string; approvalDecisionId: string; approvedFromTaskId: string;
  intentDigest: string; actionDigest: string; preparedActionDigest: string;
  repositoryRoot: string; repositoryRootDigest: string; baseCommit: string;
  beforeStateDigest: string; proposedStateDigest: string; affectedPaths: string[];
  policyVersion: string; issuer: string; decision: "approved"; decidedAt: string; expiresAt: string;
  authorityEnvironment: "development" | "production"; nonce: string;
}

export interface ReceiptPayloadV2 {
  schemaId: typeof RECEIPT_V2_SCHEMA; schemaVersion: typeof RECEIPT_V2_VERSION; receiptFormatVersion: "v2";
  actionType: "agentproof.repository_patch.v1"; receiptId: string; issuedAt: string;
  transactionId: string; correlationId: string; intentDigest: string; actionDigest: string;
  preparedActionDigest: string; repositoryRoot: string; repositoryRootDigest: string;
  repositoryIdentity: RepositoryIdentity; authorityEnvironment: "development" | "production";
  policyVersion: string; approvalBinding: ApprovalBindingV2; approvalBindingDigest: string;
  approvalDecisionDigest: string; approvalAuthorityEvidence: "receipt_signer_attests_portable_authority_verified";
  beforeStateDigest: string; proposedStateDigest: string; observedStateDigest: string;
  executionState: "executed" | "partially_executed" | "failed" | null;
  verificationState: "verified" | "failed" | "uncertain" | null;
  compensationState: "compensated" | "escalation_required" | null;
  evidenceDigests: { readOnlyEvidenceDigest: string; executionEvidenceDigest: string; verificationEvidenceDigest: string; compensationEvidenceDigest: string };
  signerRole: "independent_receipt_signer"; signingPolicyId: string; predecessorPayloadDigest: string | null;
  evidence: {
    intent: RepositoryPatchTransaction["intent"]; affectedPaths: string[];
    beforeManifest: RepositoryFileManifestEntry[]; proposedManifest: RepositoryFileManifestEntry[];
    observedManifest: RepositoryFileManifestEntry[]; readOnlyEvidence: ReadOnlyEvidence[];
    execution: RepositoryPatchTransaction["execution"]; verification: RepositoryPatchVerification | null;
    compensation: RepositoryPatchTransaction["compensation"];
  };
}

export interface ReceiptProofV2 {
  algorithm: "Ed25519"; keyId: string; publicKeyPem: string; signerFingerprint: string;
  payloadDigest: string; signatureBase64: string;
}
export interface SignedReceiptV2 { payload: ReceiptPayloadV2; proof: ReceiptProofV2 }
export type VerificationReasonV2 = "trusted" | "valid_untrusted_signer" | "legacy_unbound_receipt" |
  "invalid_structure" | "unsupported_version" | "digest_mismatch" | "invalid_signature" |
  "approval_binding_inconsistent" | "policy_mismatch" | "broken_predecessor_chain";
export interface ReceiptVerificationV2 {
  schema: "agentproof.protocol.receipt-verification-result"; schemaVersion: "2.0.0";
  cryptographicallyValid: boolean; trusted: boolean; signerFingerprint: string | null; reason: VerificationReasonV2;
  verifiedClaims: null | { receiptId: string; actionType: "agentproof.repository_patch.v1"; transactionId: string;
    correlationId: string; authorityEnvironment: "development" | "production"; policyVersion: string;
    executionState: ReceiptPayloadV2["executionState"]; verificationState: ReceiptPayloadV2["verificationState"];
    compensationState: ReceiptPayloadV2["compensationState"]; payloadDigest: string; predecessorPayloadDigest: string | null };
  unverifiedTransportMetadata: null; errors: string[]; warnings: string[];
}

function exact(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}:object_required`);
  const actual = Object.keys(value as object).sort(), expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(`${label}:unexpected_or_missing_fields`);
}
function string(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || value.length === 0) throw new Error(`${label}:string_required`); }
function timestamp(value: unknown, label: string): asserts value is string { string(value, label); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`${label}:timestamp_required`); }
function hex(value: unknown, label: string): asserts value is string { if (typeof value !== "string" || !HEX.test(value)) throw new Error(`${label}:digest_required`); }
function strings(value: unknown, label: string): asserts value is string[] { if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v)) throw new Error(`${label}:string_array_required`); }
function manifest(value: unknown, label: string): asserts value is RepositoryFileManifestEntry[] {
  if (!Array.isArray(value)) throw new Error(`${label}:array_required`);
  for (const item of value) {
    exact(item, ["path","mode","sha256","byteLength","exists","tracked"], `${label}.entry`);
    string(item.path, `${label}.path`); hex(item.sha256, `${label}.sha256`);
    if (!['100644','100755'].includes(String(item.mode)) || !Number.isSafeInteger(item.byteLength) || Number(item.byteLength) < 0 || typeof item.exists !== "boolean" || typeof item.tracked !== "boolean") throw new Error(`${label}:entry_invalid`);
  }
}
function evidenceObjects(p: ReceiptPayloadV2): void {
  for (const item of p.evidence.readOnlyEvidence) {
    exact(item,["provider","command","status","success","resultDigest"],"readOnlyEvidence.entry");
    if(item.provider!=="coding-agent-skills"||typeof item.success!=="boolean") throw new Error("readOnlyEvidence:entry_invalid");
    string(item.command,"readOnlyEvidence.command"); string(item.status,"readOnlyEvidence.status"); hex(item.resultDigest,"readOnlyEvidence.resultDigest");
  }
  const execution=p.evidence.execution;
  if(execution){ const keys=["state","attemptedAt","completedAt","message",...(execution.executorProcessId===undefined?[]:["executorProcessId"])]; exact(execution,keys,"execution"); if(!["executed","partially_executed","failed"].includes(execution.state)) throw new Error("execution:state_invalid"); timestamp(execution.attemptedAt,"execution.attemptedAt"); timestamp(execution.completedAt,"execution.completedAt"); string(execution.message,"execution.message"); if(execution.executorProcessId!==undefined&&!Number.isSafeInteger(execution.executorProcessId)) throw new Error("execution:pid_invalid"); }
  const verification=p.evidence.verification;
  if(verification){ exact(verification,["state","observedManifest","observedPaths","observedDiffDigest","identityUnchanged","unexpectedUntrackedPaths","commands","message"],"verification"); if(!["verified","failed","uncertain"].includes(verification.state)||typeof verification.identityUnchanged!=="boolean") throw new Error("verification:state_invalid"); manifest(verification.observedManifest,"verification.observedManifest"); strings(verification.observedPaths,"verification.observedPaths"); strings(verification.unexpectedUntrackedPaths,"verification.unexpectedUntrackedPaths"); if(verification.observedDiffDigest!==null) hex(verification.observedDiffDigest,"verification.observedDiffDigest"); string(verification.message,"verification.message"); if(!Array.isArray(verification.commands)) throw new Error("verification.commands:array_required"); for(const command of verification.commands){ exact(command,["executable","args","cwd","exitCode","timedOut","durationMs","stdoutDigest","stderrDigest","stdoutBytes","stderrBytes","truncated","sanitized"],"verification.command"); string(command.executable,"verification.command.executable"); strings(command.args,"verification.command.args"); string(command.cwd,"verification.command.cwd"); if(command.exitCode!==null&&!Number.isSafeInteger(command.exitCode)) throw new Error("verification.command.exit_invalid"); if(typeof command.timedOut!=="boolean"||typeof command.truncated!=="boolean"||command.sanitized!==true) throw new Error("verification.command.flags_invalid"); for(const k of ["durationMs","stdoutBytes","stderrBytes"] as const) if(!Number.isSafeInteger(command[k])||command[k]<0) throw new Error(`verification.command.${k}_invalid`); hex(command.stdoutDigest,"verification.command.stdoutDigest"); hex(command.stderrDigest,"verification.command.stderrDigest"); } }
  const compensation=p.evidence.compensation;
  if(compensation){ exact(compensation,["state","message","verifiedAt"],"compensation"); if(!["compensated","escalation_required"].includes(compensation.state)) throw new Error("compensation:state_invalid"); string(compensation.message,"compensation.message"); timestamp(compensation.verifiedAt,"compensation.verifiedAt"); }
}
function binding(value: unknown): asserts value is ApprovalBindingV2 {
  exact(value, ["schemaId","transactionId","correlationId","originalTaskId","approvalTaskId","approvalDecisionId","approvedFromTaskId","intentDigest","actionDigest","preparedActionDigest","repositoryRoot","repositoryRootDigest","baseCommit","beforeStateDigest","proposedStateDigest","affectedPaths","policyVersion","issuer","decision","decidedAt","expiresAt","authorityEnvironment","nonce"], "approvalBinding");
  if (value.schemaId !== "agentproof.approval-binding.v2" || value.decision !== "approved" || !["development","production"].includes(String(value.authorityEnvironment))) throw new Error("approvalBinding:constant_invalid");
  for (const k of ["transactionId","correlationId","originalTaskId","approvalTaskId","approvalDecisionId","approvedFromTaskId","repositoryRoot","baseCommit","policyVersion","issuer","nonce"]) string(value[k], `approvalBinding.${k}`);
  for (const k of ["intentDigest","actionDigest","preparedActionDigest","repositoryRootDigest","beforeStateDigest","proposedStateDigest"]) hex(value[k], `approvalBinding.${k}`);
  strings(value.affectedPaths, "approvalBinding.affectedPaths"); timestamp(value.decidedAt, "approvalBinding.decidedAt"); timestamp(value.expiresAt, "approvalBinding.expiresAt");
}

export function validateReceiptV2(value: unknown): asserts value is SignedReceiptV2 {
  exact(value, ["payload","proof"], "envelope");
  const p = value.payload;
  exact(p, ["schemaId","schemaVersion","receiptFormatVersion","actionType","receiptId","issuedAt","transactionId","correlationId","intentDigest","actionDigest","preparedActionDigest","repositoryRoot","repositoryRootDigest","repositoryIdentity","authorityEnvironment","policyVersion","approvalBinding","approvalBindingDigest","approvalDecisionDigest","approvalAuthorityEvidence","beforeStateDigest","proposedStateDigest","observedStateDigest","executionState","verificationState","compensationState","evidenceDigests","signerRole","signingPolicyId","predecessorPayloadDigest","evidence"], "payload");
  if (p.schemaId !== RECEIPT_V2_SCHEMA || p.schemaVersion !== RECEIPT_V2_VERSION || p.receiptFormatVersion !== "v2" || p.actionType !== "agentproof.repository_patch.v1" || p.signerRole !== "independent_receipt_signer" || p.approvalAuthorityEvidence !== "receipt_signer_attests_portable_authority_verified") throw new Error("payload:unsupported_constant");
  for (const k of ["receiptId","transactionId","correlationId","repositoryRoot","policyVersion","signingPolicyId"]) string(p[k], `payload.${k}`);
  timestamp(p.issuedAt, "payload.issuedAt");
  for (const k of ["intentDigest","actionDigest","preparedActionDigest","repositoryRootDigest","approvalBindingDigest","approvalDecisionDigest","beforeStateDigest","proposedStateDigest","observedStateDigest"]) hex(p[k], `payload.${k}`);
  if (p.predecessorPayloadDigest !== null) hex(p.predecessorPayloadDigest, "payload.predecessorPayloadDigest");
  if (!["development","production"].includes(String(p.authorityEnvironment))) throw new Error("payload:environment_invalid");
  if (![null,"executed","partially_executed","failed"].includes(p.executionState as never) || ![null,"verified","failed","uncertain"].includes(p.verificationState as never) || ![null,"compensated","escalation_required"].includes(p.compensationState as never)) throw new Error("payload:lifecycle_state_invalid");
  binding(p.approvalBinding);
  exact(p.repositoryIdentity, ["canonicalRoot","gitDirectorySha256","baseCommit","branch","headRef","remotesDigest","refsDigest"], "repositoryIdentity");
  for (const k of ["canonicalRoot","baseCommit","branch","headRef"]) string(p.repositoryIdentity[k], `repositoryIdentity.${k}`);
  for (const k of ["gitDirectorySha256","remotesDigest","refsDigest"]) hex(p.repositoryIdentity[k], `repositoryIdentity.${k}`);
  exact(p.evidenceDigests, ["readOnlyEvidenceDigest","executionEvidenceDigest","verificationEvidenceDigest","compensationEvidenceDigest"], "evidenceDigests"); for (const v of Object.values(p.evidenceDigests)) hex(v, "evidenceDigest");
  exact(p.evidence, ["intent","affectedPaths","beforeManifest","proposedManifest","observedManifest","readOnlyEvidence","execution","verification","compensation"], "evidence");
  exact(p.evidence.intent, ["summary","requestedBy","acceptanceCriteria"], "intent"); string(p.evidence.intent.summary,"intent.summary"); string(p.evidence.intent.requestedBy,"intent.requestedBy"); strings(p.evidence.intent.acceptanceCriteria,"intent.acceptanceCriteria"); strings(p.evidence.affectedPaths,"evidence.affectedPaths");
  manifest(p.evidence.beforeManifest,"beforeManifest"); manifest(p.evidence.proposedManifest,"proposedManifest"); manifest(p.evidence.observedManifest,"observedManifest"); if (!Array.isArray(p.evidence.readOnlyEvidence)) throw new Error("readOnlyEvidence:array_required");
  evidenceObjects(p as unknown as ReceiptPayloadV2);
  exact(value.proof,["algorithm","keyId","publicKeyPem","signerFingerprint","payloadDigest","signatureBase64"],"proof"); if (value.proof.algorithm !== "Ed25519") throw new Error("proof:algorithm_invalid"); string(value.proof.keyId,"proof.keyId"); string(value.proof.publicKeyPem,"proof.publicKeyPem"); if (typeof value.proof.signerFingerprint !== "string" || !FP.test(value.proof.signerFingerprint)) throw new Error("proof:fingerprint_invalid"); hex(value.proof.payloadDigest,"proof.payloadDigest"); if (typeof value.proof.signatureBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.proof.signatureBase64)) throw new Error("proof:signature_invalid");
}

export const signatureInputV2 = (payload: ReceiptPayloadV2): string => RECEIPT_V2_DOMAIN + stableJson(payload);
export const payloadDigestV2 = (payload: ReceiptPayloadV2): string => sha256(Buffer.from(signatureInputV2(payload), "utf8"));
export async function signReceiptV2(payload: ReceiptPayloadV2, signer: SigningProvider): Promise<SignedReceiptV2> {
  const publicKeyPem = await signer.publicKeyPem(), payloadDigest = payloadDigestV2(payload);
  const document: SignedReceiptV2 = { payload, proof: { algorithm:"Ed25519", keyId:await signer.keyId(), publicKeyPem, signerFingerprint:publicKeyFingerprint(publicKeyPem), payloadDigest, signatureBase64:(await signer.signCanonical(signatureInputV2(payload))).toString("base64") } };
  validateReceiptV2(document); return document;
}
function consistent(p: ReceiptPayloadV2): boolean {
  const b=p.approvalBinding, observed=[...p.evidence.observedManifest].sort((a,b)=>a.path.localeCompare(b.path));
  return p.approvalBindingDigest===digest(b) && b.transactionId===p.transactionId && b.correlationId===p.correlationId && b.intentDigest===p.intentDigest && b.actionDigest===p.actionDigest && b.preparedActionDigest===p.preparedActionDigest && b.repositoryRoot===p.repositoryRoot && b.repositoryRootDigest===p.repositoryRootDigest && b.baseCommit===p.repositoryIdentity.baseCommit && b.beforeStateDigest===p.beforeStateDigest && b.proposedStateDigest===p.proposedStateDigest && stableJson(b.affectedPaths)===stableJson(p.evidence.affectedPaths) && b.policyVersion===p.policyVersion && b.authorityEnvironment===p.authorityEnvironment && p.intentDigest===digest(p.evidence.intent) && p.repositoryRootDigest===sha256(p.repositoryRoot) && p.beforeStateDigest===digest([...p.evidence.beforeManifest].sort((a,b)=>a.path.localeCompare(b.path))) && p.proposedStateDigest===digest([...p.evidence.proposedManifest].sort((a,b)=>a.path.localeCompare(b.path))) && p.observedStateDigest===digest(observed) && p.executionState===(p.evidence.execution?.state??null) && p.verificationState===(p.evidence.verification?.state??null) && p.compensationState===(p.evidence.compensation?.state??null) && p.evidenceDigests.readOnlyEvidenceDigest===digest(p.evidence.readOnlyEvidence) && p.evidenceDigests.executionEvidenceDigest===digest(p.evidence.execution) && p.evidenceDigests.verificationEvidenceDigest===digest(p.evidence.verification) && p.evidenceDigests.compensationEvidenceDigest===digest(p.evidence.compensation);
}
function fail(reason:VerificationReasonV2,errors:string[],cryptographicallyValid=false,signerFingerprint:string|null=null):ReceiptVerificationV2 { return {schema:"agentproof.protocol.receipt-verification-result",schemaVersion:"2.0.0",cryptographicallyValid,trusted:false,signerFingerprint,reason,verifiedClaims:null,unverifiedTransportMetadata:null,errors,warnings:[]}; }
export function verifyReceiptV2(args:{document:unknown;trustedSignerFingerprints:string[];requiredAuthorityEnvironment?:"development"|"production";requiredPolicyVersion?:string;predecessorChain?:SignedReceiptV2[]}):ReceiptVerificationV2 {
  if (args.document && typeof args.document==="object" && "schema" in args.document && (args.document as {schema?:unknown}).schema==="agentproof.protocol.signed-receipt") return fail("legacy_unbound_receipt",["RC1 receipt envelope is not cryptographically bound."]);
  try { validateReceiptV2(args.document); } catch(error) { const m=(error as Error).message; return fail(m.includes("unsupported_constant")?"unsupported_version":"invalid_structure",[m]); }
  const d=args.document, recomputed=payloadDigestV2(d.payload); if (d.proof.payloadDigest!==recomputed) return fail("digest_mismatch",["payload_digest_mismatch"]);
  let fp:string; try { fp=publicKeyFingerprint(d.proof.publicKeyPem); if(fp!==d.proof.signerFingerprint) return fail("invalid_signature",["signer_fingerprint_mismatch"],false,fp); if(!cryptoVerify(null,Buffer.from(signatureInputV2(d.payload),"utf8"),createPublicKey(d.proof.publicKeyPem),Buffer.from(d.proof.signatureBase64,"base64"))) return fail("invalid_signature",["signature_invalid"],false,fp); } catch { return fail("invalid_signature",["verification_key_or_signature_invalid"]); }
  if(!consistent(d.payload)) return fail("approval_binding_inconsistent",["signed_payload_internal_consistency_failed"],true,fp);
  if((args.requiredAuthorityEnvironment&&d.payload.authorityEnvironment!==args.requiredAuthorityEnvironment)||(args.requiredPolicyVersion&&d.payload.policyVersion!==args.requiredPolicyVersion)) return fail("policy_mismatch",["required_policy_mismatch"],true,fp);
  const chain=args.predecessorChain??[]; if(d.payload.predecessorPayloadDigest!==null){ const previous=chain.at(-1); if(!previous||previous.proof.payloadDigest!==d.payload.predecessorPayloadDigest||previous.payload.transactionId!==d.payload.transactionId||previous.payload.correlationId!==d.payload.correlationId||!verifyReceiptV2({document:previous,trustedSignerFingerprints:args.trustedSignerFingerprints,requiredAuthorityEnvironment:args.requiredAuthorityEnvironment,requiredPolicyVersion:args.requiredPolicyVersion,predecessorChain:chain.slice(0,-1)}).trusted) return fail("broken_predecessor_chain",["authenticated_predecessor_missing_or_invalid"],true,fp); } else if(chain.length) return fail("broken_predecessor_chain",["unexpected_predecessor_chain"],true,fp);
  const trusted=args.trustedSignerFingerprints.includes(fp); return {schema:"agentproof.protocol.receipt-verification-result",schemaVersion:"2.0.0",cryptographicallyValid:true,trusted,signerFingerprint:fp,reason:trusted?"trusted":"valid_untrusted_signer",verifiedClaims:{receiptId:d.payload.receiptId,actionType:d.payload.actionType,transactionId:d.payload.transactionId,correlationId:d.payload.correlationId,authorityEnvironment:d.payload.authorityEnvironment,policyVersion:d.payload.policyVersion,executionState:d.payload.executionState,verificationState:d.payload.verificationState,compensationState:d.payload.compensationState,payloadDigest:recomputed,predecessorPayloadDigest:d.payload.predecessorPayloadDigest},unverifiedTransportMetadata:null,errors:[],warnings:[]};
}

export function approvalBindingV2(transaction:RepositoryPatchTransaction,correlationId:string,environment:"development"|"production",approval:Approval,preparedActionDigest:string):ApprovalBindingV2 {
  const p=transaction.prepared!; return {schemaId:"agentproof.approval-binding.v2",transactionId:transaction.transactionId,correlationId,originalTaskId:approval.originalTaskId,approvalTaskId:approval.operatorApprovalTaskId,approvalDecisionId:approval.operatorDecisionId,approvedFromTaskId:approval.approvedFromTaskId,intentDigest:digest(transaction.intent),actionDigest:transaction.actionDigest,preparedActionDigest,repositoryRoot:transaction.action.repositoryRoot,repositoryRootDigest:sha256(transaction.action.repositoryRoot),baseCommit:p.identity.baseCommit,beforeStateDigest:digest([...p.beforeManifest].sort((a,b)=>a.path.localeCompare(b.path))),proposedStateDigest:digest([...p.afterManifest].sort((a,b)=>a.path.localeCompare(b.path))),affectedPaths:p.affectedPaths,policyVersion:transaction.policyVersion,issuer:approval.approvedBy,decision:"approved",decidedAt:approval.approvedAt,expiresAt:approval.expiresAt,authorityEnvironment:environment,nonce:approval.nonce};
}
export function buildReceiptPayloadV2(args:{transaction:RepositoryPatchTransaction;correlationId:string;authorityEnvironment:"development"|"production";preparedActionDigest:string;signingPolicyId:string;predecessorPayloadDigest:string|null;issuedAt?:string;receiptId?:string}):ReceiptPayloadV2 {
  const t=args.transaction; if(!t.prepared||!t.approval) throw new Error("receipt_requires_prepared_approved_transaction"); if(!t.correlationId||t.correlationId!==args.correlationId) throw new Error("receipt_correlation_mismatch"); const b=approvalBindingV2(t,t.correlationId,args.authorityEnvironment,t.approval,args.preparedActionDigest), observed=t.verification?.observedManifest??[];
  return {schemaId:RECEIPT_V2_SCHEMA,schemaVersion:RECEIPT_V2_VERSION,receiptFormatVersion:"v2",actionType:"agentproof.repository_patch.v1",receiptId:args.receiptId??randomUUID(),issuedAt:args.issuedAt??new Date().toISOString(),transactionId:t.transactionId,correlationId:args.correlationId,intentDigest:digest(t.intent),actionDigest:t.actionDigest,preparedActionDigest:args.preparedActionDigest,repositoryRoot:t.action.repositoryRoot,repositoryRootDigest:sha256(t.action.repositoryRoot),repositoryIdentity:t.prepared.identity,authorityEnvironment:args.authorityEnvironment,policyVersion:t.policyVersion,approvalBinding:b,approvalBindingDigest:digest(b),approvalDecisionDigest:t.approval.approvalDecisionDigest,approvalAuthorityEvidence:"receipt_signer_attests_portable_authority_verified",beforeStateDigest:b.beforeStateDigest,proposedStateDigest:b.proposedStateDigest,observedStateDigest:digest([...observed].sort((a,b)=>a.path.localeCompare(b.path))),executionState:t.execution?.state??null,verificationState:t.verification?.state??null,compensationState:t.compensation?.state??null,evidenceDigests:{readOnlyEvidenceDigest:digest(t.readOnlyEvidence),executionEvidenceDigest:digest(t.execution),verificationEvidenceDigest:digest(t.verification),compensationEvidenceDigest:digest(t.compensation)},signerRole:"independent_receipt_signer",signingPolicyId:args.signingPolicyId,predecessorPayloadDigest:args.predecessorPayloadDigest,evidence:{intent:t.intent,affectedPaths:t.prepared.affectedPaths,beforeManifest:t.prepared.beforeManifest,proposedManifest:t.prepared.afterManifest,observedManifest:observed,readOnlyEvidence:t.readOnlyEvidence,execution:t.execution,verification:t.verification,compensation:t.compensation}};
}
