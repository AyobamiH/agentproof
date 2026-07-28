import { randomBytes } from "node:crypto";
import { digest } from "./hash.js";
import type {
  AgentProofTransaction,
  Approval,
  OperatorApprovalRecord,
  OperatorApprovalRequest,
} from "./types.js";

export const AGENTPROOF_OPERATOR_TASK_TYPE = "build-refactor";

export function approvalBinding(transaction: AgentProofTransaction, expiresAt: string, nonce: string) {
  if (!transaction.prepared) throw new Error("transaction_not_prepared");
  return {
    schemaVersion: "agentproof.operator-approval.v1" as const,
    transactionId: transaction.transactionId,
    intentDigest: digest(transaction.intent),
    actionDigest: transaction.actionDigest,
    target: transaction.canonicalTarget,
    beforeSha256: transaction.prepared.before.sha256,
    proposedSha256: transaction.prepared.expectedAfterSha256,
    policyVersion: transaction.policyDecision.policyId,
    expiresAt,
    nonce,
  };
}

export function createOperatorApprovalRequest(
  transaction: AgentProofTransaction,
  options: { expiresAt: string; nonce?: string },
): OperatorApprovalRequest {
  const binding = approvalBinding(
    transaction,
    options.expiresAt,
    options.nonce ?? randomBytes(24).toString("base64url"),
  );
  return {
    type: AGENTPROOF_OPERATOR_TASK_TYPE,
    payload: {
      requiresApproval: true,
      agentProof: { ...binding, bindingDigest: digest(binding) },
    },
  };
}

export function operatorDecisionDigest(approval: OperatorApprovalRecord): string {
  return digest({
    taskId: approval.taskId,
    type: approval.type,
    payload: approval.payload,
    requestedAt: approval.requestedAt,
    status: approval.status,
    decidedAt: approval.decidedAt ?? null,
    decidedBy: approval.decidedBy ?? null,
    note: approval.note ?? null,
  });
}

export function approvalFromOperatorReplay(
  transaction: AgentProofTransaction,
  approvalRecord: OperatorApprovalRecord,
  replayPayload: Record<string, unknown>,
  now = new Date(),
): Approval {
  if (approvalRecord.status !== "approved" || !approvalRecord.decidedAt || !approvalRecord.decidedBy) {
    throw new Error("operator_approval_not_approved");
  }
  if (approvalRecord.type !== AGENTPROOF_OPERATOR_TASK_TYPE) {
    throw new Error("operator_approval_wrong_type");
  }
  if (replayPayload.approvedFromTaskId !== approvalRecord.taskId) {
    throw new Error("operator_approval_replay_link_invalid");
  }
  const decisionDigest = operatorDecisionDigest(approvalRecord);
  const decisionId = "approval-decision:" + decisionDigest;
  if (
    replayPayload.approvalDecisionDigest !== decisionDigest ||
    replayPayload.approvalDecisionId !== decisionId
  ) {
    throw new Error("operator_approval_decision_binding_invalid");
  }
  const raw = approvalRecord.payload.agentProof;
  if (!raw || typeof raw !== "object") throw new Error("operator_approval_binding_missing");
  const bound = raw as Record<string, unknown>;
  const binding = approvalBinding(
    transaction,
    String(bound.expiresAt ?? ""),
    String(bound.nonce ?? ""),
  );
  const expectedDigest = digest(binding);
  if (
    bound.bindingDigest !== expectedDigest ||
    bound.transactionId !== binding.transactionId ||
    bound.intentDigest !== binding.intentDigest ||
    bound.actionDigest !== binding.actionDigest ||
    bound.target !== binding.target ||
    bound.beforeSha256 !== binding.beforeSha256 ||
    bound.proposedSha256 !== binding.proposedSha256 ||
    bound.policyVersion !== binding.policyVersion
  ) {
    throw new Error("operator_approval_binding_mismatch");
  }
  if (!binding.nonce) throw new Error("operator_approval_nonce_missing");
  if (!Number.isFinite(Date.parse(binding.expiresAt)) || now.getTime() >= Date.parse(binding.expiresAt)) {
    throw new Error("operator_approval_expired");
  }
  return {
    decision: "approved",
    approvedBy: approvalRecord.decidedBy,
    approvedAt: approvalRecord.decidedAt,
    transactionId: binding.transactionId,
    actionDigest: binding.actionDigest,
    intentDigest: binding.intentDigest,
    target: binding.target,
    beforeSha256: binding.beforeSha256,
    proposedSha256: binding.proposedSha256,
    policyVersion: binding.policyVersion,
    expiresAt: binding.expiresAt,
    nonce: binding.nonce,
    originalTaskId: approvalRecord.taskId,
    operatorApprovalTaskId: approvalRecord.taskId,
    operatorDecisionId: decisionId,
    approvedFromTaskId: approvalRecord.taskId,
    approvalDecisionDigest: decisionDigest,
    scope: "single_transaction",
  };
}
