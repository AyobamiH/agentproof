import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  RepositoryPatchAgentProof,
  SubprocessRepositoryPatchExecutor,
  type RepositoryPatchAction,
  type RepositoryPatchPolicy,
  type RepositoryPatchTransaction,
  type SigningProvider,
} from "../src/index.js";
import { assertApprovalIfRequired } from "../../orchestrator/src/approvalGate.js";
import { decideAndEnqueueApprovalReplay } from "../../orchestrator/src/approvalReplay.js";
import { createStateStore, type StateStore } from "../../orchestrator/src/state-store.js";
import { createDefaultState } from "../../orchestrator/src/state.js";
import { admitTaskExecution, updateTaskQueueAttempt } from "../../orchestrator/src/task-admission.js";
import { TaskQueue } from "../../orchestrator/src/taskQueue.js";
import type { OrchestratorConfig, OrchestratorState, Task } from "../../orchestrator/src/types.js";

const approvalConfig = { approvalRequiredTaskTypes: ["build-refactor"] } as OrchestratorConfig;

export class RepositoryPatchOperatorHarness {
  readonly queue = new TaskQueue();
  readonly operatorStore: StateStore<OrchestratorState>;
  readonly agentProof: RepositoryPatchAgentProof;
  state = createDefaultState();
  mutationCount = 0;
  processErrors: Error[] = [];

  constructor(readonly stateRoot: string, signer?: SigningProvider) {
    this.operatorStore = createStateStore(`sqlite:${path.join(stateRoot, "operator.sqlite")}`);
    this.agentProof = new RepositoryPatchAgentProof({
      databasePath: path.join(stateRoot, "agentproof.sqlite"),
      signer,
      executor: new SubprocessRepositoryPatchExecutor(
        path.resolve(import.meta.dirname, "../dist/repository-patch-executor-child.js"),
      ),
      evidenceProvider: async () => [{
        provider: "coding-agent-skills", command: "repo-map+secret-audit",
        status: "pass", success: true, resultDigest: "local-read-only-evidence",
      }],
    });
    this.queue.setAdmissionHandler((task) => admitTaskExecution(this.state, task));
    this.queue.onProcess(async (task) => {
      try { await this.process(task); } catch (error) { this.processErrors.push(error as Error); }
    });
  }

  async initialize() {
    await mkdir(this.stateRoot, { recursive: true });
    await this.operatorStore.ensureReady();
    this.state = (await this.operatorStore.load()) ?? createDefaultState();
  }

  private async persist() {
    this.state.updatedAt = new Date().toISOString();
    await this.operatorStore.save(this.state);
  }

  private async process(task: Task) {
    const execution = this.state.taskExecutions.find((item) => item.idempotencyKey === task.idempotencyKey)!;
    updateTaskQueueAttempt(execution, task.id, "running");
    const gate = assertApprovalIfRequired(task, this.state, approvalConfig);
    if (!gate.allowed) {
      execution.status = "pending";
      updateTaskQueueAttempt(execution, task.id, "awaiting-approval");
      await this.persist();
      return;
    }
    const originalTaskId = String(task.payload.approvedFromTaskId ?? "");
    const record = this.state.approvals.find((item) => item.taskId === originalTaskId)!;
    const transactionId = String((record.payload.agentProof as Record<string, unknown>).transactionId);
    const transaction = await this.agentProof.store.get(transactionId);
    const approval = this.agentProof.approvalFromOperatorReplay(transaction, record, task.payload);
    const before = await this.agentProof.store.get(transactionId);
    let result = await this.agentProof.execute(transactionId, `operator:${task.idempotencyKey}`, approval);
    if (before.state === "prepared" && result.state !== "prepared") this.mutationCount += 1;
    if (result.state === "executed" || result.state === "partially_executed") result = await this.agentProof.verify(transactionId);
    if (result.state !== "verified") throw new Error(`repository_patch_${result.state}`);
    await this.agentProof.receipt(transactionId);
    execution.status = "success";
    execution.completedAt = new Date().toISOString();
    execution.resultSummary = `Repository patch ${transactionId} verified and signed.`;
    updateTaskQueueAttempt(execution, task.id, "success");
    await this.persist();
  }

  async prepare(
    action: RepositoryPatchAction,
    policy: RepositoryPatchPolicy,
  ): Promise<{ transaction: RepositoryPatchTransaction; task: Task }> {
    let transaction = await this.agentProof.preflight(action, {
      summary: "Apply one verified repository patch",
      requestedBy: "local-coding-agent",
      acceptanceCriteria: ["Only approved paths change", "Repository result verifies"],
    }, policy);
    transaction = await this.agentProof.prepare(transaction.transactionId);
    if (transaction.state !== "prepared") throw new Error(transaction.lastError ?? "repository_patch_not_prepared");
    const request = this.agentProof.createOperatorApprovalRequest(
      transaction, new Date(Date.now() + 60_000).toISOString(),
    );
    const task = this.queue.enqueue(request.type, {
      ...request.payload, idempotencyKey: `repository-patch-approval:${transaction.transactionId}`,
    });
    await this.wait();
    return { transaction, task };
  }

  async approve(taskId: string) {
    const result = decideAndEnqueueApprovalReplay({
      state: this.state, queue: this.queue, taskId,
      decision: "approved", actor: "local-test-operator",
    });
    await this.persist();
    await this.wait();
    return result;
  }

  async wait(timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const snapshot = this.queue.getSnapshot();
      if (!snapshot.queued.length && !snapshot.processing.length) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("repository_patch_queue_timeout");
  }
}
