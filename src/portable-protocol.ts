import type { RepositoryPatchAction, RepositoryPatchPolicy, RepositoryPatchTransaction } from "./repository-patch-types.js";
import type { ReceiptVerificationV2, SignedReceiptV2 } from "./receipt-v2.js";

export const PORTABLE_PROTOCOL_VERSION = "1.0.0";
export const REPOSITORY_PATCH_ACTION = "agentproof.repository_patch.v1";

export interface RepositoryPatchRequestDocument {
  schema: "agentproof.protocol.repository-patch-request";
  schemaVersion: "1.0.0";
  actionType: typeof REPOSITORY_PATCH_ACTION;
  correlationId: string;
  stateDirectory: string;
  action: RepositoryPatchAction;
  intent: RepositoryPatchTransaction["intent"];
  policy: RepositoryPatchPolicy;
}

export interface PreparedRepositoryPatchDocument {
  schema: "agentproof.protocol.prepared-repository-patch";
  schemaVersion: "1.0.0";
  actionType: typeof REPOSITORY_PATCH_ACTION;
  correlationId: string;
  transactionId: string;
  stateDirectory: string;
  actionDigest: string;
  patchDigest: string;
  preparedDigest: string;
  state: RepositoryPatchTransaction["state"];
}

export interface PortableApprovalRequestDocument {
  schema: "agentproof.protocol.approval-request";
  schemaVersion: "1.0.0";
  actionType: typeof REPOSITORY_PATCH_ACTION;
  correlationId: string;
  transactionId: string;
  stateDirectory: string;
  preparedDigest: string;
  expiresAt: string;
  nonce: string;
  binding: Record<string, unknown>;
  requestDigest: string;
}

export interface PortableApprovalDecisionDocument {
  schema: "agentproof.protocol.approval-decision";
  schemaVersion: "1.0.0";
  actionType: typeof REPOSITORY_PATCH_ACTION;
  correlationId: string;
  transactionId: string;
  requestDigest: string;
  preparedDigest: string;
  decision: "approved" | "denied";
  authorityEnvironment: "development" | "production";
  issuer: string;
  decidedAt: string;
  expiresAt: string;
  nonce: string;
  authorityPublicKeyPem: string;
  authorityFingerprint: string;
  approvalRequest: PortableApprovalRequestDocument;
  signatureBase64: string;
}

export interface ExecutionRequestDocument {
  schema: "agentproof.protocol.execution-request";
  schemaVersion: "1.0.0";
  actionType: typeof REPOSITORY_PATCH_ACTION;
  correlationId: string;
  transactionId: string;
  stateDirectory: string;
  idempotencyKey: string;
  requiredAuthorityEnvironment: "development" | "production";
  trustedAuthorityFingerprints: string[];
  approvalDecision: PortableApprovalDecisionDocument;
}

export interface TransactionStatusDocument {
  schema: "agentproof.protocol.transaction-status";
  schemaVersion: "1.0.0";
  actionType: typeof REPOSITORY_PATCH_ACTION;
  correlationId: string;
  transactionId: string;
  state: RepositoryPatchTransaction["state"];
  receiptPersisted: boolean;
  lastError: string | null;
}

export type SignedReceiptDocument = SignedReceiptV2;
export type ReceiptVerificationResultDocument = ReceiptVerificationV2;

export interface AgentProofErrorDocument {
  schema: "agentproof.protocol.error";
  schemaVersion: "1.0.0";
  actionType: typeof REPOSITORY_PATCH_ACTION;
  correlationId: string;
  transactionId?: string;
  code: string;
  message: string;
  retryable: boolean;
}

export class AgentProofPortableError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: number,
    readonly retryable = false,
    readonly transactionId?: string,
  ) {
    super(message);
    this.name = "AgentProofPortableError";
  }
}

export const EXIT_CODES = {
  success: 0,
  invalidInput: 2,
  policyRejection: 3,
  approvalRequired: 4,
  approvalDenied: 5,
  staleOrAlteredApproval: 6,
  executionFailure: 7,
  verificationFailure: 8,
  compensationFailure: 9,
  untrustedSigner: 10,
  internalFailure: 70,
} as const;
