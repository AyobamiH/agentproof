export type AgentProofState =
  | "allowed"
  | "approval_required"
  | "blocked"
  | "prepared"
  | "executing"
  | "executed"
  | "partially_executed"
  | "verified"
  | "failed"
  | "uncertain"
  | "compensated"
  | "non_compensable"
  | "escalation_required";

export interface FileEvidence {
  observedAt: string;
  observer: "agentproof-preflight" | "agentproof-independent-verifier";
  exists: boolean;
  sha256: string | null;
  byteLength: number;
}

export interface ReplaceFileAction {
  type: "replace_file";
  root: string;
  target: string;
  content: string;
}

export interface ActionConstraints {
  allowedRoot: string;
  allowedTargets: string[];
  expectedBeforeSha256?: string | null;
  maxWriteBytes: number;
  maxSnapshotBytes: number;
  allowNonCompensable?: boolean;
}

export interface Intent {
  summary: string;
  requestedBy: string;
  acceptanceCriteria: string[];
}

export interface Approval {
  decision: "approved" | "rejected";
  approvedBy: string;
  approvedAt: string;
  transactionId: string;
  actionDigest: string;
  intentDigest: string;
  target: string;
  beforeSha256: string | null;
  proposedSha256: string;
  policyVersion: string;
  expiresAt: string;
  nonce: string;
  originalTaskId: string;
  operatorApprovalTaskId: string;
  operatorDecisionId: string;
  approvedFromTaskId: string;
  approvalDecisionDigest: string;
  scope: "single_transaction";
}

export interface OperatorApprovalRecord {
  taskId: string;
  type: string;
  payload: Record<string, unknown>;
  requestedAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
}

export interface OperatorApprovalRequest {
  type: "build-refactor";
  payload: {
    requiresApproval: true;
    agentProof: Record<string, unknown>;
  };
}

export interface PolicyDecision {
  state: "allowed" | "approval_required" | "blocked";
  policyId: "agentproof.local-file-change.v1";
  reasons: string[];
  decidedAt: string;
}

export interface ReadOnlyEvidence {
  provider: "coding-agent-skills";
  command: string;
  status: string;
  success: boolean;
  resultDigest: string;
}

export interface PreparedChange {
  state: "prepared";
  actionDigest: string;
  before: FileEvidence;
  expectedAfterSha256: string;
  diff: string;
  compensation: "restore_before_state" | "non_compensable";
}

export interface ExecutionResult {
  state: "executed" | "partially_executed" | "failed";
  executor: "agentproof-local-file-executor";
  attemptedAt: string;
  completedAt: string;
  message: string;
  executorProcessId?: number;
}

export interface VerificationResult {
  state: "verified" | "failed" | "uncertain";
  verifier: "agentproof-independent-file-verifier";
  expectedSha256: string;
  observed: FileEvidence;
  message: string;
}

export interface CompensationResult {
  state: "compensated" | "non_compensable" | "escalation_required";
  attemptedAt: string;
  observed: FileEvidence | null;
  message: string;
}

export interface AgentProofTransaction {
  schemaVersion: "agentproof.transaction.v2";
  transactionId: string;
  createdAt: string;
  updatedAt: string;
  state: AgentProofState;
  intent: Intent;
  action: ReplaceFileAction;
  constraints: ActionConstraints;
  canonicalTarget: string;
  actionDigest: string;
  policyDecision: PolicyDecision;
  readOnlyEvidence: ReadOnlyEvidence[];
  preflightBefore: FileEvidence;
  prepared: PreparedChange | null;
  idempotencyKey: string | null;
  approval: Approval | null;
  execution: ExecutionResult | null;
  verification: VerificationResult | null;
  compensation: CompensationResult | null;
  beforeSnapshotBase64: string | null;
  receiptPersisted: boolean;
  lastError: string | null;
}

export interface EvidenceReceipt {
  schemaVersion: "agentproof.receipt.v2";
  transactionId: string;
  receiptDigest: string;
  issuedAt: string;
  state: AgentProofState;
  intent: Intent;
  target: string;
  policyDecision: PolicyDecision;
  approval: Approval | null;
  exactAction: ReplaceFileAction;
  actionDigest: string;
  idempotencyKey: string | null;
  beforeEvidence: FileEvidence;
  afterEvidence: FileEvidence | null;
  execution: ExecutionResult | null;
  verification: VerificationResult | null;
  compensation: CompensationResult | null;
  readOnlyEvidence: ReadOnlyEvidence[];
}

export interface ReceiptSignature {
  algorithm: "Ed25519";
  keyId: string;
  publicKeyPem: string;
  signatureBase64: string;
}

export type SignedEvidenceReceipt = EvidenceReceipt & { signature: ReceiptSignature };

export interface FileExecutor {
  replace(target: string, content: Buffer, root?: string, expectedSha256?: string): Promise<ExecutionResult>;
}

export interface ReconciliationResult {
  transactionId: string;
  from: AgentProofState;
  to: AgentProofState;
  action: string;
}
