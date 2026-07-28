import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExecutionResult, FileExecutor } from "./types.js";

export class LocalFileExecutor implements FileExecutor {
  async replace(target: string, content: Buffer): Promise<ExecutionResult> {
    const attemptedAt = new Date().toISOString();
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.agentproof-${randomUUID()}.tmp`,
    );
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
      await rename(temporary, target);
      return {
        state: "executed",
        executor: "agentproof-local-file-executor",
        attemptedAt,
        completedAt: new Date().toISOString(),
        message: "Atomic local file replacement completed.",
        executorProcessId: process.pid,
      };
    } catch (error) {
      return {
        state: "failed",
        executor: "agentproof-local-file-executor",
        attemptedAt,
        completedAt: new Date().toISOString(),
        message: `Local file replacement failed: ${(error as Error).message}`,
      };
    }
  }
}

export class SubprocessFileExecutor implements FileExecutor {
  constructor(
    private readonly childModule = fileURLToPath(new URL("./executor-child.js", import.meta.url)),
  ) {}

  async replace(
    target: string,
    content: Buffer,
    root?: string,
    expectedSha256?: string,
  ): Promise<ExecutionResult> {
    if (!root || !expectedSha256) throw new Error("executor_authorization_context_required");
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.childModule], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { NODE_ENV: "production" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`executor_process_failed:${code}:${stderr.trim()}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as ExecutionResult);
        } catch (error) {
          reject(new Error(`executor_response_invalid:${(error as Error).message}`));
        }
      });
      child.stdin.end(JSON.stringify({
        root,
        target,
        contentBase64: content.toString("base64"),
        expectedSha256,
      }));
    });
  }
}
