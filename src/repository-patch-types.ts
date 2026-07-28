import type { Approval, ReadOnlyEvidence, ReceiptSignature } from "./types.js";

export type RepositoryPatchOperation =
  | { kind: "write"; path: string; contentBase64: string; mode?: "100644" | "100755"; newFile?: boolean }
  | { kind: "delete"; path: string };

export interface VerificationCommand {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface RepositoryPatchAction {
  type: "agentproof.repository_patch.v1";
  repositoryRoot: string;
  operations: RepositoryPatchOperation[];
  verificationCommands?: VerificationCommand[];
}

export interface RepositoryPatchPolicy {
  allowedRepositoryRoot: string;
  allowedTrackedPaths: string[];
  allowedNewPaths: string[];
  allowSecretBearingPaths?: string[];
  allowedVerificationExecutables?: string[];
  allowedVerificationWorkingDirectories?: string[];
  maxPatchBytes: number;
  maxFiles: number;
}

export interface RepositoryFileManifestEntry {
  path: string;
  mode: "100644" | "100755";
  sha256: string;
  byteLength: number;
  exists: boolean;
  tracked: boolean;
}

export interface RepositoryIdentity {
  canonicalRoot: string;
  gitDirectorySha256: string;
  baseCommit: string;
  branch: string;
  headRef: string;
  remotesDigest: string;
  refsDigest: string;
}

export interface VerificationCommandEvidence {
  executable: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdoutDigest: string;
  stderrDigest: string;
  stdoutBytes: number;
  stderrBytes: number;
  truncated: boolean;
  sanitized: true;
}

export interface RepositoryPatchPrepared {
  state: "prepared";
  identity: RepositoryIdentity;
  beforeManifest: RepositoryFileManifestEntry[];
  afterManifest: RepositoryFileManifestEntry[];
  affectedPaths: string[];
  patchCanonical: string;
  patchDigest: string;
  expectedDiffDigest: string;
  verificationPlan: VerificationCommand[];
  verificationPlanDigest: string;
  compensation: "restore_before_state";
}

export interface RepositoryPatchVerification {
  state: "verified" | "failed" | "uncertain";
  observedManifest: RepositoryFileManifestEntry[];
  observedPaths: string[];
  observedDiffDigest: string | null;
  identityUnchanged: boolean;
  unexpectedUntrackedPaths: string[];
  commands: VerificationCommandEvidence[];
  message: string;
}

export interface RepositoryPatchTransaction {
  schemaVersion: "agentproof.repository-patch.transaction.v1";
  transactionId: string;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
  state: "approval_required" | "blocked" | "prepared" | "executing" | "executed" | "partially_executed" | "verified" | "failed" | "uncertain" | "compensated" | "escalation_required";
  intent: { summary: string; requestedBy: string; acceptanceCriteria: string[] };
  action: RepositoryPatchAction;
  policy: RepositoryPatchPolicy;
  policyVersion: "agentproof.repository-patch.v1";
  actionDigest: string;
  prepared: RepositoryPatchPrepared | null;
  readOnlyEvidence: ReadOnlyEvidence[];
  approval: Approval | null;
  idempotencyKey: string | null;
  execution: { state: "executed" | "partially_executed" | "failed"; attemptedAt: string; completedAt: string; message: string; executorProcessId?: number } | null;
  verification: RepositoryPatchVerification | null;
  compensation: { state: "compensated" | "escalation_required"; message: string; verifiedAt: string } | null;
  beforeContents: Record<string, { contentBase64: string; mode: "100644" | "100755" }>;
  receiptPersisted: boolean;
  lastError: string | null;
}

export interface RepositoryPatchReceiptBody {
  schemaVersion: "agentproof.repository-patch.receipt.v1";
  transactionId: string;
  receiptDigest: string;
  issuedAt: string;
  state: RepositoryPatchTransaction["state"];
  intent: RepositoryPatchTransaction["intent"];
  operatorAuthority: Approval | null;
  repositoryIdentity: RepositoryIdentity;
  policyVersion: string;
  patchDigest: string;
  expectedDiffDigest: string;
  beforeManifest: RepositoryFileManifestEntry[];
  afterManifest: RepositoryFileManifestEntry[];
  approvedPaths: string[];
  observedPaths: string[];
  verificationCommands: VerificationCommandEvidence[];
  execution: RepositoryPatchTransaction["execution"];
  verification: RepositoryPatchVerification | null;
  compensation: RepositoryPatchTransaction["compensation"];
  failure: string | null;
  reconciliation: string[];
}

export type SignedRepositoryPatchReceipt = RepositoryPatchReceiptBody & {
  signature: ReceiptSignature & { signerFingerprint: string };
};
