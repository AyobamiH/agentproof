import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { digest } from "./hash.js";
import type { ReadOnlyEvidence } from "./types.js";

const execFileAsync = promisify(execFile);

interface CodingAgentResult {
  command?: string;
  status?: string;
  success?: boolean;
}

export async function collectCodingEvidence(
  cliPath: string,
  projectRoot: string,
): Promise<ReadOnlyEvidence[]> {
  const results: ReadOnlyEvidence[] = [];
  for (const command of ["repo-map", "secret-audit"]) {
    const { stdout } = await execFileAsync(
      process.execPath,
      [cliPath, command, projectRoot, "--json"],
      { maxBuffer: 5 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout) as CodingAgentResult;
    results.push({
      provider: "coding-agent-skills",
      command,
      status: parsed.status ?? "unknown",
      success: parsed.success === true,
      resultDigest: digest(parsed),
    });
  }
  return results;
}
