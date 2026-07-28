import { readFile, stat } from "node:fs/promises";
import { sha256 } from "./hash.js";
import type { FileEvidence, VerificationResult } from "./types.js";

export async function observeFile(
  target: string,
  observer: FileEvidence["observer"],
): Promise<FileEvidence> {
  try {
    const details = await stat(target);
    if (!details.isFile()) {
      return {
        observedAt: new Date().toISOString(),
        observer,
        exists: false,
        sha256: null,
        byteLength: 0,
      };
    }
    const bytes = await readFile(target);
    return {
      observedAt: new Date().toISOString(),
      observer,
      exists: true,
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        observedAt: new Date().toISOString(),
        observer,
        exists: false,
        sha256: null,
        byteLength: 0,
      };
    }
    throw error;
  }
}

export async function verifyFile(
  target: string,
  expectedSha256: string,
): Promise<VerificationResult> {
  try {
    const observed = await observeFile(target, "agentproof-independent-verifier");
    const matches = observed.exists && observed.sha256 === expectedSha256;
    return {
      state: matches ? "verified" : "failed",
      verifier: "agentproof-independent-file-verifier",
      expectedSha256,
      observed,
      message: matches
        ? "The independently observed target bytes match the prepared postcondition."
        : "The independently observed target state does not match the prepared postcondition.",
    };
  } catch (error) {
    return {
      state: "uncertain",
      verifier: "agentproof-independent-file-verifier",
      expectedSha256,
      observed: {
        observedAt: new Date().toISOString(),
        observer: "agentproof-independent-verifier",
        exists: false,
        sha256: null,
        byteLength: 0,
      },
      message: `Independent observation failed: ${(error as Error).message}`,
    };
  }
}
