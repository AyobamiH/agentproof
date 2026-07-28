import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AgentProof,
  SubprocessFileExecutor,
  approvalFromOperatorReplay,
  createOperatorApprovalRequest,
} from "../src/index.js";
import type {
  AgentProofTransaction,
  FileExecutor,
  Intent,
  SigningProvider,
  SignedEvidenceReceipt,
} from "../src/index.js";
import { assertApprovalIfRequired, cancelApproval } from "../../orchestrator/src/approvalGate.js";
import {
  decideAndEnqueueApprovalReplay,
  enqueueApprovedTaskReplay,
  type ApprovalReplayResult,
} from "../../orchestrator/src/approvalReplay.js";
import { createStateStore, type StateStore } from "../../orchestrator/src/state-store.js";
import { createDefaultState } from "../../orchestrator/src/state.js";
import { admitTaskExecution, updateTaskQueueAttempt } from "../../orchestrator/src/task-admission.js";
import { TaskQueue } from "../../orchestrator/src/taskQueue.js";
import type {
  ApprovalRecord,
  OrchestratorConfig,
  OrchestratorState,
  Task,
  TaskExecutionRecord,
} from "../../orchestrator/src/types.js";

const APPROVAL_CONFIG = {
  approvalRequiredTaskTypes: ["build-refactor"],
} as OrchestratorConfig;

export interface HarnessFaults {
  beforeReplay?: (approval: ApprovalRecord, replay: Task) => void | Promise<void>;
  afterAgentProofSuccessBeforeOperatorSave?: () => void;
}

export interface HarnessOptions {
  stateRoot: string;
  signer?: SigningProvider;
  executor?: FileExecutor;
  faults?: HarnessFaults;
  now?: () => Date;
}

export interface PreparedOperatorTransaction {
  transaction: AgentProofTransaction;
  operatorTask: Task;
  approval: ApprovalRecord;
}

export class CanonicalOperatorHarness {
  readonly operatorDatabasePath: string;
  readonly agentProofDatabasePath: string;
  readonly targetRoot: string;
  readonly operatorStore: StateStore<OrchestratorState>;
  readonly queue = new TaskQueue();
  readonly agentProof: AgentProof;
  state: OrchestratorState = createDefaultState();
  processErrors: Error[] = [];
  mutationCount = 0;
  private readonly faults?: HarnessFaults;
  private readonly now: () => Date;

  constructor(options: HarnessOptions) {
    this.operatorDatabasePath = path.join(options.stateRoot, "operator", "orchestrator.sqlite");
    this.agentProofDatabasePath = path.join(options.stateRoot, "agentproof", "transactions.sqlite");
    this.targetRoot = path.join(options.stateRoot, "targets");
    this.operatorStore = createStateStore<OrchestratorState>(`sqlite:${this.operatorDatabasePath}`);
    this.faults = options.faults;
    this.now = options.now ?? (() => new Date());
    const delegatedExecutor =
      options.executor ??
      new SubprocessFileExecutor(path.resolve(import.meta.dirname, "../dist/executor-child.js"));
    this.agentProof = new AgentProof({
      databasePath: this.agentProofDatabasePath,
      signer: options.signer,
      now: this.now,
      executor: {
        replace: async (...args) => {
          this.mutationCount += 1;
          return delegatedExecutor.replace(...args);
        },
      },
      evidenceProvider: async () => [{
        provider: "coding-agent-skills",
        command: "repository-evidence",
        status: "pass",
        success: true,
        resultDigest: "integration-harness-read-only-evidence",
      }],
    });
    this.queue.setAdmissionHandler((task) => admitTaskExecution(this.state, task));
    this.queue.onProcess(async (task) => {
      try {
        await this.processTask(task);
      } catch (error) {
        this.processErrors.push(error as Error);
        const execution = this.findExecution(task);
        if (execution) {
          execution.status = "failed";
          execution.lastError = (error as Error).message;
          execution.completedAt = this.now().toISOString();
          updateTaskQueueAttempt(execution, task.id, "failed", {
            detail: (error as Error).message,
          });
          await this.persist();
        }
      }
    });
  }

  async initialize(): Promise<void> {
    await mkdir(this.targetRoot, { recursive: true });
    await this.operatorStore.ensureReady();
    this.state = (await this.operatorStore.load()) ?? createDefaultState();
  }

  async restart(): Promise<void> {
    this.state = (await this.operatorStore.load()) ?? createDefaultState();
  }

  async persist(): Promise<void> {
    this.state.updatedAt = this.now().toISOString();
    await this.operatorStore.save(this.state);
  }

  private findExecution(task: Task): TaskExecutionRecord | undefined {
    return this.state.taskExecutions.find(
      (item) => item.idempotencyKey === task.idempotencyKey,
    );
  }

  private async processTask(task: Task): Promise<void> {
    const execution = this.findExecution(task);
    if (!execution) throw new Error("operator_execution_record_missing");
    execution.status = "running";
    execution.startedAt ??= this.now().toISOString();
    updateTaskQueueAttempt(execution, task.id, "running");

    const gate = assertApprovalIfRequired(task, this.state, APPROVAL_CONFIG);
    if (!gate.allowed) {
      execution.status = "pending";
      updateTaskQueueAttempt(execution, task.id, "awaiting-approval", {
        detail: gate.reason,
      });
      await this.persist();
      return;
    }

    const sourceTaskId = String(task.payload.approvedFromTaskId ?? "");
    if (!sourceTaskId) throw new Error("agentproof_replay_link_missing");
    const approval = this.state.approvals.find((item) => item.taskId === sourceTaskId);
    if (!approval) throw new Error("operator_approval_record_missing");
    await this.faults?.beforeReplay?.(approval, task);

    const binding = approval.payload.agentProof as Record<string, unknown> | undefined;
    const transactionId = String(binding?.transactionId ?? "");
    const transaction = await this.agentProof.store.get(transactionId);
    const authority = approvalFromOperatorReplay(
      transaction,
      approval as ApprovalRecord & { status: "approved" },
      task.payload,
      this.now(),
    );
    let result = await this.agentProof.execute(
      transactionId,
      `operator:${task.idempotencyKey}`,
      authority,
    );
    if (result.state === "executed" || result.state === "partially_executed") {
      result = await this.agentProof.verify(transactionId);
    }
    if (result.state === "verified") await this.agentProof.receipt(transactionId);
    if (result.state !== "verified") throw new Error(`agentproof_${result.state}`);

    this.faults?.afterAgentProofSuccessBeforeOperatorSave?.();
    execution.status = "success";
    execution.completedAt = this.now().toISOString();
    execution.lastHandledAt = execution.completedAt;
    execution.resultSummary = `AgentProof transaction ${transactionId} independently verified and signed.`;
    updateTaskQueueAttempt(execution, task.id, "success");
    await this.persist();
  }

  async prepare(
    target: string,
    before: string | null,
    after: string,
    intent: Intent = {
      summary: "Replace one local file through AgentProof",
      requestedBy: "integration-harness",
      acceptanceCriteria: ["Target content hash matches the prepared proposal"],
    },
    expiresAt = new Date(this.now().getTime() + 60_000).toISOString(),
  ): Promise<PreparedOperatorTransaction> {
    if (before !== null) await writeFile(path.join(this.targetRoot, target), before);
    let transaction = await this.agentProof.preflight(
      { type: "replace_file", root: this.targetRoot, target, content: after },
      intent,
      {
        allowedRoot: this.targetRoot,
        allowedTargets: [target],
        maxWriteBytes: 64 * 1024,
        maxSnapshotBytes: 64 * 1024,
      },
    );
    transaction = await this.agentProof.prepare(transaction.transactionId);
    const request = createOperatorApprovalRequest(transaction, {
      expiresAt,
      nonce: `nonce-${transaction.transactionId}`,
    });
    const operatorTask = this.queue.enqueue(request.type, {
      ...request.payload,
      idempotencyKey: `agentproof-approval:${transaction.transactionId}`,
    });
    await this.waitForIdle();
    const approval = this.state.approvals.find((item) => item.taskId === operatorTask.id);
    if (!approval) throw new Error("canonical_operator_approval_not_created");
    return { transaction, operatorTask, approval };
  }

  async decide(
    taskId: string,
    decision: "approved" | "rejected",
    actor = "local-operator",
    now = this.now(),
  ): Promise<ApprovalReplayResult> {
    const result = decideAndEnqueueApprovalReplay({
      state: this.state,
      queue: this.queue,
      taskId,
      decision,
      actor,
      now,
    });
    await this.persist();
    await this.waitForIdle();
    return result;
  }

  async cancel(taskId: string, actor = "local-operator"): Promise<ApprovalReplayResult> {
    const approval = cancelApproval(this.state, taskId, actor, "cancelled by integration harness");
    const result = enqueueApprovedTaskReplay({
      state: this.state,
      queue: this.queue,
      approval,
      actor,
      now: this.now(),
    });
    await this.persist();
    return result;
  }

  replay(approval: ApprovalRecord, actor = "local-operator"): ApprovalReplayResult {
    return enqueueApprovedTaskReplay({
      state: this.state,
      queue: this.queue,
      approval,
      actor,
      now: this.now(),
    });
  }

  async waitForIdle(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = this.queue.getSnapshot();
      if (snapshot.queued.length === 0 && snapshot.processing.length === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("operator_queue_idle_timeout");
  }

  async reconcileCrossStore(transactionId: string): Promise<SignedEvidenceReceipt | null> {
    await this.restart();
    await this.agentProof.reconcileIncomplete();
    const transaction = await this.agentProof.store.get(transactionId);
    const receipt = await this.agentProof.store.getReceipt(transactionId);
    const binding = this.state.approvals.find(
      (item) =>
        (item.payload.agentProof as Record<string, unknown> | undefined)?.transactionId === transactionId,
    );
    if (!binding) return receipt;
    const replayExecution = this.state.taskExecutions.find(
      (item) => item.idempotencyKey === `approval-replay:${binding.taskId}`,
    );
    if (replayExecution && transaction.state === "verified" && receipt) {
      replayExecution.status = "success";
      replayExecution.completedAt ??= this.now().toISOString();
      replayExecution.lastHandledAt = this.now().toISOString();
      replayExecution.lastError = undefined;
      replayExecution.resultSummary =
        `Reconciled from independently verified AgentProof receipt ${receipt.receiptDigest}.`;
      await this.persist();
    }
    return receipt;
  }

  async targetText(target: string): Promise<string> {
    return readFile(path.join(this.targetRoot, target), "utf8");
  }
}
