import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import path from "node:path";
import { digest, stableJson } from "./hash.js";
import { RepositoryPatchAgentProof } from "./repository-patch-service.js";
import { publicKeyFingerprint, verifyRepositoryPatchReceiptWithTrust, type SigningProvider } from "./signer.js";
import type { Approval } from "./types.js";
import type { RepositoryPatchTransaction } from "./repository-patch-types.js";
import {
  buildReceiptPayloadV2,
  payloadDigestV2,
  signReceiptV2,
  verifyReceiptV2,
  type ReceiptVerificationV2,
  type SignedReceiptV2,
} from "./receipt-v2.js";
import {
  AgentProofPortableError,
  EXIT_CODES,
  PORTABLE_PROTOCOL_VERSION,
  REPOSITORY_PATCH_ACTION,
  type ExecutionRequestDocument,
  type PortableApprovalDecisionDocument,
  type PortableApprovalRequestDocument,
  type PreparedRepositoryPatchDocument,
  type ReceiptVerificationResultDocument,
  type RepositoryPatchRequestDocument,
  type SignedReceiptDocument,
  type TransactionStatusDocument,
} from "./portable-protocol.js";

function databasePath(stateDirectory: string): string {
  if (!stateDirectory || !path.isAbsolute(stateDirectory)) {
    throw new AgentProofPortableError("state_directory_absolute_required", "stateDirectory must be an explicit absolute path.", EXIT_CODES.invalidInput);
  }
  return path.join(stateDirectory, "agentproof-portable.sqlite");
}

function assertProtocol(value: unknown, schema: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new AgentProofPortableError("invalid_document", "Input must be a JSON object.", EXIT_CODES.invalidInput);
  }
  const item = value as Record<string, unknown>;
  if (item.schema !== schema) {
    throw new AgentProofPortableError("invalid_schema", `Expected schema ${schema}.`, EXIT_CODES.invalidInput);
  }
  if (item.schemaVersion !== PORTABLE_PROTOCOL_VERSION) {
    throw new AgentProofPortableError("unsupported_schema_version", `Unsupported schemaVersion ${String(item.schemaVersion)}.`, EXIT_CODES.invalidInput);
  }
  if (item.actionType !== REPOSITORY_PATCH_ACTION) {
    throw new AgentProofPortableError("unknown_action_type", `Unsupported actionType ${String(item.actionType)}.`, EXIT_CODES.invalidInput);
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AgentProofPortableError("operation_aborted", "Operation aborted.", EXIT_CODES.internalFailure, true);
}

function service(stateDirectory: string, signer?: SigningProvider): RepositoryPatchAgentProof {
  return new RepositoryPatchAgentProof({ databasePath: databasePath(stateDirectory), signer });
}

export function canonicalDocumentDigest(value: unknown): string {
  return digest(value);
}

export async function prepareRepositoryPatch(
  request: RepositoryPatchRequestDocument,
  options: { signal?: AbortSignal } = {},
): Promise<PreparedRepositoryPatchDocument> {
  assertProtocol(request, "agentproof.protocol.repository-patch-request");
  checkAbort(options.signal);
  if (!request.correlationId || request.action?.type !== REPOSITORY_PATCH_ACTION) {
    throw new AgentProofPortableError("invalid_request", "correlationId and repository patch action are required.", EXIT_CODES.invalidInput);
  }
  const agentProof = service(request.stateDirectory);
  let transaction = await agentProof.preflight(request.action, request.intent, request.policy, request.correlationId);
  checkAbort(options.signal);
  transaction = await agentProof.prepare(transaction.transactionId);
  if (transaction.state === "blocked" || !transaction.prepared) {
    throw new AgentProofPortableError(
      "policy_rejected", transaction.lastError ?? "Repository patch was rejected.",
      EXIT_CODES.policyRejection, false, transaction.transactionId,
    );
  }
  return {
    schema: "agentproof.protocol.prepared-repository-patch",
    schemaVersion: PORTABLE_PROTOCOL_VERSION as "1.0.0",
    actionType: REPOSITORY_PATCH_ACTION as "agentproof.repository_patch.v1",
    correlationId: request.correlationId,
    transactionId: transaction.transactionId,
    stateDirectory: request.stateDirectory,
    actionDigest: transaction.actionDigest,
    patchDigest: transaction.prepared.patchDigest,
    preparedDigest: digest(transaction.prepared),
    state: transaction.state,
  };
}

export async function createApprovalRequest(
  prepared: PreparedRepositoryPatchDocument,
  options: { expiresAt: string; nonce: string; signal?: AbortSignal },
): Promise<PortableApprovalRequestDocument> {
  assertProtocol(prepared, "agentproof.protocol.prepared-repository-patch");
  checkAbort(options.signal);
  const agentProof = service(prepared.stateDirectory);
  const transaction = await agentProof.store.get(prepared.transactionId);
  if (!transaction.correlationId || transaction.correlationId !== prepared.correlationId) {
    throw new AgentProofPortableError("correlation_mismatch", "Prepared correlation does not match durable transaction state.", EXIT_CODES.staleOrAlteredApproval);
  }
  if (!transaction.prepared || digest(transaction.prepared) !== prepared.preparedDigest) {
    throw new AgentProofPortableError("prepared_action_altered", "Prepared transaction digest does not match persisted state.", EXIT_CODES.staleOrAlteredApproval);
  }
  const binding = agentProof.approvalBinding(transaction, options.expiresAt, options.nonce);
  const requestWithoutDigest = {
    schema: "agentproof.protocol.approval-request" as const,
    schemaVersion: PORTABLE_PROTOCOL_VERSION as "1.0.0",
    actionType: REPOSITORY_PATCH_ACTION as "agentproof.repository_patch.v1",
    correlationId: prepared.correlationId,
    transactionId: prepared.transactionId,
    stateDirectory: prepared.stateDirectory,
    preparedDigest: prepared.preparedDigest,
    expiresAt: options.expiresAt,
    nonce: options.nonce,
    binding,
  };
  return { ...requestWithoutDigest, requestDigest: digest(requestWithoutDigest) };
}

export interface DevelopmentKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
  fingerprint: string;
}

export function createDevelopmentKeyPair(): DevelopmentKeyPair {
  const pair = generateKeyPairSync("ed25519");
  const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { privateKeyPem, publicKeyPem, fingerprint: publicKeyFingerprint(publicKeyPem) };
}

export function createDevelopmentApprovalDecision(args: {
  request: PortableApprovalRequestDocument;
  decision: "approved" | "denied";
  issuer: string;
  privateKeyPem: string;
  developmentMode: true;
  decidedAt?: string;
}): PortableApprovalDecisionDocument {
  assertProtocol(args.request, "agentproof.protocol.approval-request");
  if (args.developmentMode !== true) {
    throw new AgentProofPortableError("development_mode_required", "Development authority requires explicit developmentMode=true.", EXIT_CODES.invalidInput);
  }
  const { requestDigest, ...requestBody } = args.request;
  if (digest(requestBody) !== requestDigest) {
    throw new AgentProofPortableError("approval_request_altered", "Approval request digest is invalid.", EXIT_CODES.staleOrAlteredApproval);
  }
  const privateKey = createPrivateKey(args.privateKeyPem);
  const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const unsigned = {
    schema: "agentproof.protocol.approval-decision" as const,
    schemaVersion: PORTABLE_PROTOCOL_VERSION as "1.0.0",
    actionType: REPOSITORY_PATCH_ACTION as "agentproof.repository_patch.v1",
    correlationId: args.request.correlationId,
    transactionId: args.request.transactionId,
    requestDigest,
    preparedDigest: args.request.preparedDigest,
    decision: args.decision,
    authorityEnvironment: "development" as const,
    issuer: args.issuer,
    decidedAt: args.decidedAt ?? new Date().toISOString(),
    expiresAt: args.request.expiresAt,
    nonce: args.request.nonce,
    authorityPublicKeyPem: publicKeyPem,
    authorityFingerprint: publicKeyFingerprint(publicKeyPem),
    approvalRequest: args.request,
  };
  return {
    ...unsigned,
    signatureBase64: cryptoSign(null, Buffer.from(stableJson(unsigned)), privateKey).toString("base64"),
  };
}

function validateApproval(
  transaction: RepositoryPatchTransaction,
  request: ExecutionRequestDocument,
): Approval {
  const decision = request.approvalDecision;
  assertProtocol(decision, "agentproof.protocol.approval-decision");
  assertProtocol(decision.approvalRequest, "agentproof.protocol.approval-request");
  const approvalRequest = decision.approvalRequest;
  const { requestDigest, ...requestBody } = approvalRequest;
  const reconstructedBinding = service(request.stateDirectory).approvalBinding(transaction, decision.expiresAt, decision.nonce);
  if (decision.transactionId !== transaction.transactionId ||
      decision.preparedDigest !== digest(transaction.prepared) ||
      decision.authorityEnvironment !== request.requiredAuthorityEnvironment ||
      decision.correlationId !== request.correlationId ||
      approvalRequest.transactionId !== transaction.transactionId ||
      approvalRequest.correlationId !== request.correlationId ||
      approvalRequest.preparedDigest !== digest(transaction.prepared) ||
      decision.requestDigest !== requestDigest ||
      digest(requestBody) !== requestDigest ||
      stableJson(approvalRequest.binding) !== stableJson(reconstructedBinding) ||
      approvalRequest.expiresAt !== decision.expiresAt || approvalRequest.nonce !== decision.nonce) {
    throw new AgentProofPortableError("approval_scope_mismatch", "Approval does not match transaction or required authority environment.", EXIT_CODES.staleOrAlteredApproval);
  }
  if (!request.trustedAuthorityFingerprints.includes(decision.authorityFingerprint) ||
      publicKeyFingerprint(decision.authorityPublicKeyPem) !== decision.authorityFingerprint) {
    throw new AgentProofPortableError("untrusted_approval_authority", "Approval authority is not explicitly trusted.", EXIT_CODES.staleOrAlteredApproval);
  }
  const { signatureBase64, ...unsigned } = decision;
  if (!cryptoVerify(null, Buffer.from(stableJson(unsigned)), createPublicKey(decision.authorityPublicKeyPem), Buffer.from(signatureBase64, "base64"))) {
    throw new AgentProofPortableError("approval_signature_invalid", "Approval signature is invalid.", EXIT_CODES.staleOrAlteredApproval);
  }
  if (decision.decision !== "approved") {
    throw new AgentProofPortableError("approval_denied", "Authority denied the prepared action.", EXIT_CODES.approvalDenied);
  }
  if (Date.now() >= Date.parse(decision.expiresAt)) {
    throw new AgentProofPortableError("approval_expired", "Approval has expired.", EXIT_CODES.staleOrAlteredApproval);
  }
  const prepared = transaction.prepared!;
  return {
    decision: "approved", approvedBy: decision.issuer, approvedAt: decision.decidedAt,
    transactionId: transaction.transactionId, actionDigest: transaction.actionDigest,
    intentDigest: digest(transaction.intent), target: transaction.action.repositoryRoot,
    beforeSha256: digest([...prepared.beforeManifest].sort((a, b) => a.path.localeCompare(b.path))),
    proposedSha256: digest([...prepared.afterManifest].sort((a, b) => a.path.localeCompare(b.path))),
    policyVersion: transaction.policyVersion, expiresAt: decision.expiresAt, nonce: decision.nonce,
    originalTaskId: decision.requestDigest, operatorApprovalTaskId: decision.requestDigest,
    operatorDecisionId: `approval-decision:${digest(unsigned)}`,
    approvedFromTaskId: decision.requestDigest, approvalDecisionDigest: digest(unsigned),
    authorityEnvironment: decision.authorityEnvironment,
    scope: "single_transaction",
  };
}

export async function executeApprovedTransaction(
  request: ExecutionRequestDocument,
  options: { receiptSigner?: SigningProvider; signal?: AbortSignal } = {},
): Promise<SignedReceiptDocument> {
  assertProtocol(request, "agentproof.protocol.execution-request");
  checkAbort(options.signal);
  const agentProof = service(request.stateDirectory, options.receiptSigner);
  const transaction = await agentProof.store.get(request.transactionId);
  if (!transaction.correlationId || transaction.correlationId !== request.correlationId) {
    throw new AgentProofPortableError("correlation_mismatch", "Execution correlation does not match durable transaction state.", EXIT_CODES.staleOrAlteredApproval);
  }
  const approval = validateApproval(transaction, request);
  const existing = await agentProof.store.portableReceiptChain(request.transactionId);
  if (existing.length > 0 && transaction.idempotencyKey === request.idempotencyKey) return existing.at(-1)!;
  let result = await agentProof.execute(request.transactionId, request.idempotencyKey, approval);
  checkAbort(options.signal);
  if (result.state === "executed" || result.state === "partially_executed") {
    result = await agentProof.verify(request.transactionId);
  }
  if (result.state !== "verified") {
    throw new AgentProofPortableError(
      result.state === "failed" ? "verification_failed" : "execution_failed",
      result.lastError ?? `Transaction ended in ${result.state}.`,
      result.state === "failed" ? EXIT_CODES.verificationFailure : EXIT_CODES.executionFailure,
      false, result.transactionId,
    );
  }
  if (!options.receiptSigner) {
    throw new AgentProofPortableError("receipt_signer_required", "An independent receipt signer provider is required.", EXIT_CODES.internalFailure);
  }
  const current = await agentProof.store.get(request.transactionId);
  const receipt = await signReceiptV2(buildReceiptPayloadV2({
    transaction: current, correlationId: request.correlationId,
    authorityEnvironment: request.approvalDecision.authorityEnvironment,
    preparedActionDigest: digest(current.prepared), signingPolicyId: await options.receiptSigner.keyId(),
    predecessorPayloadDigest: null,
  }), options.receiptSigner);
  await agentProof.store.appendPortableReceipt(receipt);
  return receipt;
}

export async function getTransactionStatus(args: {
  stateDirectory: string;
  transactionId: string;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<TransactionStatusDocument> {
  checkAbort(args.signal);
  const transaction = await service(args.stateDirectory).store.get(args.transactionId);
  if (!transaction.correlationId || transaction.correlationId !== args.correlationId) {
    throw new AgentProofPortableError("correlation_mismatch", "Status correlation does not match durable transaction state.", EXIT_CODES.invalidInput);
  }
  return {
    schema: "agentproof.protocol.transaction-status", schemaVersion: PORTABLE_PROTOCOL_VERSION as "1.0.0",
    actionType: REPOSITORY_PATCH_ACTION as "agentproof.repository_patch.v1", correlationId: args.correlationId,
    transactionId: args.transactionId, state: transaction.state,
    receiptPersisted: transaction.receiptPersisted, lastError: transaction.lastError,
  };
}

export function verifyReceipt(args: {
  document: unknown;
  trustedSignerFingerprints: string[];
  requiredAuthorityEnvironment?: "development" | "production";
  requiredPolicyVersion?: string;
  predecessorChain?: SignedReceiptV2[];
}): ReceiptVerificationV2 {
  return verifyReceiptV2(args);
}

export async function reconcileRepositoryPatch(args: {
  stateDirectory: string;
  transactionId: string;
  correlationId: string;
  authorityEnvironment: "development" | "production";
}, options: { receiptSigner: SigningProvider; signal?: AbortSignal }): Promise<SignedReceiptV2 | TransactionStatusDocument> {
  checkAbort(options.signal);
  const agentProof = service(args.stateDirectory);
  let transaction = await agentProof.store.get(args.transactionId);
  if (!transaction.correlationId || transaction.correlationId !== args.correlationId) {
    throw new AgentProofPortableError("correlation_mismatch", "Reconciliation correlation does not match durable transaction state.", EXIT_CODES.invalidInput);
  }
  const existing = await agentProof.store.portableReceiptChain(args.transactionId);
  if (transaction.approval?.authorityEnvironment !== args.authorityEnvironment) {
    throw new AgentProofPortableError("authority_environment_mismatch", "Reconciliation authority environment does not match consumed approval.", EXIT_CODES.staleOrAlteredApproval);
  }
  if (existing.length > 0) return existing.at(-1)!;
  if (transaction.state === "executing" || transaction.state === "executed" || transaction.state === "partially_executed") {
    transaction = await agentProof.verify(args.transactionId);
  }
  checkAbort(options.signal);
  if (transaction.state !== "verified") {
    return getTransactionStatus({ stateDirectory: args.stateDirectory, transactionId: args.transactionId, correlationId: args.correlationId, signal: options.signal });
  }
  const receipt = await signReceiptV2(buildReceiptPayloadV2({
    transaction, correlationId: args.correlationId, authorityEnvironment: args.authorityEnvironment,
    preparedActionDigest: digest(transaction.prepared), signingPolicyId: await options.receiptSigner.keyId(), predecessorPayloadDigest: null,
  }), options.receiptSigner);
  await agentProof.store.appendPortableReceipt(receipt);
  return receipt;
}

export async function compensateRepositoryPatchWithReceipt(args: {
  stateDirectory: string; transactionId: string; correlationId: string;
  authorityEnvironment: "development" | "production";
}, options: { receiptSigner: SigningProvider; trustedSignerFingerprints: string[]; signal?: AbortSignal }): Promise<SignedReceiptV2> {
  checkAbort(options.signal);
  const agentProof = service(args.stateDirectory);
  const stored = await agentProof.store.get(args.transactionId);
  if (!stored.correlationId || stored.correlationId !== args.correlationId) {
    throw new AgentProofPortableError("correlation_mismatch", "Compensation correlation does not match durable transaction state.", EXIT_CODES.compensationFailure);
  }
  const chain = await agentProof.store.portableReceiptChain(args.transactionId);
  if (stored.approval?.authorityEnvironment !== args.authorityEnvironment) {
    throw new AgentProofPortableError("authority_environment_mismatch", "Compensation authority environment does not match consumed approval.", EXIT_CODES.compensationFailure);
  }
  if (chain.length === 0) throw new AgentProofPortableError("predecessor_receipt_required", "A verified predecessor receipt is required.", EXIT_CODES.compensationFailure);
  const latest = chain.at(-1)!;
  if (latest.payload.correlationId !== stored.correlationId) {
    throw new AgentProofPortableError("stored_receipt_correlation_mismatch", "Stored receipt correlation does not match durable transaction state.", EXIT_CODES.compensationFailure);
  }
  const verified = verifyReceiptV2({ document: latest, trustedSignerFingerprints: options.trustedSignerFingerprints,
    requiredAuthorityEnvironment: args.authorityEnvironment, predecessorChain: chain.slice(0, -1) });
  if (!verified.trusted) throw new AgentProofPortableError("stored_receipt_invalid", "Stored predecessor receipt is invalid or untrusted.", EXIT_CODES.compensationFailure);
  const transaction = await agentProof.compensate(args.transactionId);
  if (transaction.state !== "compensated") throw new AgentProofPortableError("compensation_failed", transaction.lastError ?? "Compensation failed.", EXIT_CODES.compensationFailure);
  const successor = await signReceiptV2(buildReceiptPayloadV2({ transaction, correlationId: args.correlationId,
    authorityEnvironment: args.authorityEnvironment, preparedActionDigest: digest(transaction.prepared),
    signingPolicyId: await options.receiptSigner.keyId(), predecessorPayloadDigest: payloadDigestV2(latest.payload),
  }), options.receiptSigner);
  await agentProof.store.appendPortableReceipt(successor);
  return successor;
}

export async function compensateRepositoryPatch(args: {
  stateDirectory: string;
  transactionId: string;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<TransactionStatusDocument> {
  checkAbort(args.signal);
  const agentProof = service(args.stateDirectory);
  const stored = await agentProof.store.get(args.transactionId);
  if (!stored.correlationId || stored.correlationId !== args.correlationId) {
    throw new AgentProofPortableError("correlation_mismatch", "Compensation correlation does not match durable transaction state.", EXIT_CODES.compensationFailure);
  }
  const chain = await agentProof.store.portableReceiptChain(args.transactionId);
  if (chain.length > 0) {
    throw new AgentProofPortableError("signed_successor_required", "A signed receipt exists; compensation must produce an authenticated successor receipt.", EXIT_CODES.compensationFailure);
  }
  const transaction = await agentProof.compensate(args.transactionId);
  if (transaction.state !== "compensated") {
    throw new AgentProofPortableError("compensation_failed", transaction.lastError ?? "Compensation failed.", EXIT_CODES.compensationFailure);
  }
  return getTransactionStatus({
    stateDirectory: args.stateDirectory, transactionId: args.transactionId,
    correlationId: args.correlationId, signal: args.signal,
  });
}

export function signingProviderFromPrivateKeyPem(
  keyId: string,
  privateKeyPem: string,
): SigningProvider {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  return {
    async keyId() { return keyId; },
    async publicKeyPem() { return publicKey.export({ type: "spki", format: "pem" }).toString(); },
    async signCanonical(payload: string) { return cryptoSign(null, Buffer.from(payload), privateKey); },
  };
}

export type { SignedReceiptV2, ReceiptVerificationV2 };
