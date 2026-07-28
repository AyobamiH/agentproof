import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { digest, sha256 } from "./hash.js";
import type {
  RepositoryFileManifestEntry,
  RepositoryIdentity,
  RepositoryPatchOperation,
} from "./repository-patch-types.js";

const execFileAsync = promisify(execFile);

export async function git(root: string, args: string[], timeout = 10_000): Promise<string> {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  });
  return result.stdout.trimEnd();
}

export function safeRepositoryPath(value: string): boolean {
  if (!value || path.isAbsolute(value) || value.includes("\0") || value.includes("\\")) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== "." && !normalized.startsWith("../") &&
    normalized !== ".git" && !normalized.startsWith(".git/");
}

export function isSecretBearingPath(value: string): boolean {
  const base = path.posix.basename(value).toLowerCase();
  return base === ".env" || base.startsWith(".env.") || base.endsWith(".pem") ||
    base.endsWith(".key") || base.includes("credential") || base.includes("secret");
}

export async function canonicalRepositoryRoot(root: string): Promise<string> {
  const canonical = await realpath(root);
  const top = await git(canonical, ["rev-parse", "--show-toplevel"]);
  const canonicalTop = await realpath(top);
  if (canonical !== canonicalTop) throw new Error("repository_root_must_be_git_toplevel");
  return canonical;
}

export async function repositoryIdentity(root: string): Promise<RepositoryIdentity> {
  const gitDir = await realpath(path.join(root, await git(root, ["rev-parse", "--git-dir"])));
  const baseCommit = await git(root, ["rev-parse", "HEAD"]);
  const branch = await git(root, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (!branch) throw new Error("detached_head_not_supported");
  const headRef = await git(root, ["symbolic-ref", "HEAD"]);
  const remotes = await git(root, ["remote", "-v"]);
  const refs = await git(root, ["show-ref", "--head"]);
  return {
    canonicalRoot: root,
    gitDirectorySha256: sha256(gitDir),
    baseCommit,
    branch,
    headRef,
    remotesDigest: sha256(remotes),
    refsDigest: sha256(refs),
  };
}

export async function assertCleanRepository(root: string): Promise<void> {
  if ((await git(root, ["status", "--porcelain=v1", "--untracked-files=all"])) !== "") {
    throw new Error("dirty_repository");
  }
  if ((await git(root, ["ls-files", "-u"])) !== "") throw new Error("unresolved_merge");
}

export async function trackedPaths(root: string): Promise<Set<string>> {
  const output = await git(root, ["ls-files", "-z"]);
  return new Set(output ? output.split("\0").filter(Boolean) : []);
}

export async function submodulePaths(root: string): Promise<Set<string>> {
  const output = await git(root, ["ls-files", "--stage"]);
  return new Set(output.split("\n").filter((line) => line.startsWith("160000 "))
    .map((line) => line.split("\t")[1]).filter(Boolean));
}

export async function manifestEntry(
  root: string,
  relative: string,
  tracked: boolean,
): Promise<RepositoryFileManifestEntry> {
  const target = path.join(root, relative);
  try {
    const stat = await lstat(target);
    if (!stat.isFile()) throw new Error(`non_regular_file:${relative}`);
    const content = await readFile(target);
    return {
      path: relative,
      mode: (stat.mode & 0o111) ? "100755" : "100644",
      sha256: sha256(content),
      byteLength: content.byteLength,
      exists: true,
      tracked,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: relative, mode: "100644", sha256: sha256(Buffer.alloc(0)), byteLength: 0, exists: false, tracked };
    }
    throw error;
  }
}

export async function beforeManifest(
  root: string,
  affected: string[],
  tracked: Set<string>,
): Promise<RepositoryFileManifestEntry[]> {
  return Promise.all(affected.map((item) => manifestEntry(root, item, tracked.has(item))));
}

export function proposedManifest(
  before: RepositoryFileManifestEntry[],
  operations: RepositoryPatchOperation[],
): RepositoryFileManifestEntry[] {
  const byPath = new Map(before.map((item) => [item.path, item]));
  return operations.map((operation) => {
    const previous = byPath.get(operation.path)!;
    if (operation.kind === "delete") {
      return { ...previous, exists: false, sha256: sha256(Buffer.alloc(0)), byteLength: 0 };
    }
    const content = Buffer.from(operation.contentBase64, "base64");
    return {
      path: operation.path,
      mode: operation.mode ?? previous.mode ?? "100644",
      sha256: sha256(content),
      byteLength: content.byteLength,
      exists: true,
      tracked: previous.tracked,
    };
  });
}

export function canonicalPatch(operations: RepositoryPatchOperation[]): string {
  return JSON.stringify([...operations].sort((a, b) => a.path.localeCompare(b.path))
    .map((item) => item.kind === "delete"
      ? { kind: item.kind, path: item.path }
      : { kind: item.kind, path: item.path, contentBase64: item.contentBase64, mode: item.mode ?? "100644", newFile: item.newFile === true }));
}

export function manifestDigest(entries: RepositoryFileManifestEntry[]): string {
  return digest([...entries].sort((a, b) => a.path.localeCompare(b.path)));
}

export async function canonicalObservedDiffDigest(root: string): Promise<string> {
  const diff = await git(root, ["diff", "--binary", "--no-ext-diff", "--", "."]);
  const untracked = [...await trackedPaths(root)];
  void untracked;
  return sha256(diff);
}
