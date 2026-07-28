#!/usr/bin/env node
import { chmod, readFile, writeFile } from "node:fs/promises";
import {
  AgentProofPortableError,
  EXIT_CODES,
  PORTABLE_PROTOCOL_VERSION,
  REPOSITORY_PATCH_ACTION,
  type AgentProofErrorDocument,
  type PortableApprovalRequestDocument,
} from "./portable-protocol.js";
import { createDevelopmentApprovalDecision, createDevelopmentKeyPair } from "./portable-sdk.js";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const developmentMode = args.includes("--development");

async function readInput<T>(): Promise<T> {
  const source = option("--input");
  if (!source) throw new AgentProofPortableError("input_required", "--input is required.", EXIT_CODES.invalidInput);
  const raw = source === "-"
    ? await new Promise<string>((resolve) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { value += chunk; });
      process.stdin.on("end", () => resolve(value));
    })
    : await readFile(source, "utf8");
  return JSON.parse(raw) as T;
}

async function main() {
  if (args.includes("--help") || args.length === 0) {
    process.stdout.write(`agentproof-dev-authority --development keygen --private-key-output <path>
agentproof-dev-authority --development decide --input <approval-request|-> --private-key <path> --decision <approved|denied> --issuer <name>
`);
    return;
  }
  if (!developmentMode) throw new AgentProofPortableError("development_mode_required", "--development is required.", EXIT_CODES.invalidInput);
  if (args.includes("keygen")) {
    const output = option("--private-key-output");
    if (!output) throw new AgentProofPortableError("key_output_required", "--private-key-output is required.", EXIT_CODES.invalidInput);
    const key = createDevelopmentKeyPair();
    await writeFile(output, key.privateKeyPem, { flag: "wx", mode: 0o600 });
    await chmod(output, 0o600);
    process.stdout.write(`${JSON.stringify({
      schema: "agentproof.protocol.development-key",
      schemaVersion: PORTABLE_PROTOCOL_VERSION,
      actionType: REPOSITORY_PATCH_ACTION,
      correlationId: "development-key",
      fingerprint: key.fingerprint,
      publicKeyPem: key.publicKeyPem,
      developmentEvidence: true,
    })}\n`);
    return;
  }
  if (args.includes("decide")) {
    const keyPath = option("--private-key");
    const decision = option("--decision");
    const issuer = option("--issuer");
    if (!keyPath || !issuer || (decision !== "approved" && decision !== "denied")) {
      throw new AgentProofPortableError("decision_options_required", "--private-key, --decision and --issuer are required.", EXIT_CODES.invalidInput);
    }
    const result = createDevelopmentApprovalDecision({
      request: await readInput<PortableApprovalRequestDocument>(),
      decision, issuer, privateKeyPem: await readFile(keyPath, "utf8"),
      developmentMode: true,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new AgentProofPortableError("unknown_command", "Unknown development authority command.", EXIT_CODES.invalidInput);
}

main().catch((error) => {
  const portable = error instanceof AgentProofPortableError
    ? error
    : new AgentProofPortableError("internal_failure", (error as Error).message, EXIT_CODES.internalFailure);
  const document: AgentProofErrorDocument = {
    schema: "agentproof.protocol.error", schemaVersion: PORTABLE_PROTOCOL_VERSION,
    actionType: REPOSITORY_PATCH_ACTION, correlationId: "development-authority",
    code: portable.code, message: portable.message, retryable: portable.retryable,
  };
  process.stdout.write(`${JSON.stringify(document)}\n`);
  process.stderr.write(`agentproof-dev-authority: ${portable.code}: ${portable.message}\n`);
  process.exitCode = portable.exitCode;
});
