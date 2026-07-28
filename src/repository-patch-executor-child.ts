import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  RepositoryFileManifestEntry,
  RepositoryPatchOperation,
} from "./repository-patch-types.js";

interface Request {
  repositoryRoot: string;
  baseCommit: string;
  patchCanonical: string;
  patchDigest: string;
  affectedPaths: string[];
  beforeManifest: RepositoryFileManifestEntry[];
  afterManifest: RepositoryFileManifestEntry[];
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safePath(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes("\\") || relative.includes("\0")) {
    throw new Error("executor_path_invalid");
  }
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || relative === ".git" || relative.startsWith(".git/")) {
    throw new Error("executor_path_escape");
  }
  return target;
}

async function main() {
  const input = await new Promise<string>((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { value += chunk; });
    process.stdin.on("end", () => resolve(value));
    process.stdin.on("error", reject);
  });
  const request = JSON.parse(input) as Request;
  if (sha256(request.patchCanonical) !== request.patchDigest) throw new Error("executor_patch_digest_mismatch");
  const operations = JSON.parse(request.patchCanonical) as RepositoryPatchOperation[];
  const approved = new Set(request.affectedPaths);
  if (operations.some((item) => !approved.has(item.path)) || operations.length !== approved.size) {
    throw new Error("executor_path_set_mismatch");
  }
  for (const before of request.beforeManifest) {
    const target = safePath(request.repositoryRoot, before.path);
    try {
      const stat = await lstat(target);
      if (!stat.isFile()) throw new Error("executor_non_regular_target");
      if (!before.exists || sha256(await readFile(target)) !== before.sha256) throw new Error("executor_before_state_drift");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !before.exists) continue;
      throw error;
    }
  }
  const attemptedAt = new Date().toISOString();
  for (const operation of operations) {
    const target = safePath(request.repositoryRoot, operation.path);
    if (operation.kind === "delete") {
      await rm(target);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.agentproof-${process.pid}.tmp`;
    await writeFile(temporary, Buffer.from(operation.contentBase64, "base64"), { flag: "wx", mode: 0o600 });
    if ((operation.mode ?? "100644") === "100755") {
      const { chmod } = await import("node:fs/promises");
      await chmod(temporary, 0o755);
    }
    await rename(temporary, target);
  }
  process.stdout.write(JSON.stringify({
    state: "executed",
    attemptedAt,
    completedAt: new Date().toISOString(),
    message: "Prepared repository patch applied within the bounded executor process.",
    executorProcessId: process.pid,
  }));
}

main().catch((error) => {
  process.stderr.write((error as Error).message);
  process.exitCode = 1;
});
