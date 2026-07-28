import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { RepositoryPatchPrepared } from "./repository-patch-types.js";

export interface RepositoryPatchExecutionResult {
  state: "executed" | "partially_executed" | "failed";
  attemptedAt: string;
  completedAt: string;
  message: string;
  executorProcessId?: number;
}

export interface RepositoryPatchExecutor {
  apply(repositoryRoot: string, prepared: RepositoryPatchPrepared): Promise<RepositoryPatchExecutionResult>;
}

export class SubprocessRepositoryPatchExecutor implements RepositoryPatchExecutor {
  constructor(private readonly childModule = fileURLToPath(
    new URL("./repository-patch-executor-child.js", import.meta.url),
  )) {}

  async apply(repositoryRoot: string, prepared: RepositoryPatchPrepared): Promise<RepositoryPatchExecutionResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.childModule], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", NODE_ENV: "production" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (value) => { stdout += value; });
      child.stderr.on("data", (value) => { stderr += value; });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(`repository_patch_executor_failed:${stderr.trim()}`));
        try {
          resolve(JSON.parse(stdout) as RepositoryPatchExecutionResult);
        } catch (error) {
          reject(new Error(`repository_patch_executor_invalid_response:${(error as Error).message}`));
        }
      });
      child.stdin.end(JSON.stringify({
        repositoryRoot,
        baseCommit: prepared.identity.baseCommit,
        patchCanonical: prepared.patchCanonical,
        patchDigest: prepared.patchDigest,
        affectedPaths: prepared.affectedPaths,
        beforeManifest: prepared.beforeManifest,
        afterManifest: prepared.afterManifest,
      }));
    });
  }
}
