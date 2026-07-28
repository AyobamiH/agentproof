#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  AgentProofPortableError,
  EXIT_CODES,
  PORTABLE_PROTOCOL_VERSION,
  REPOSITORY_PATCH_ACTION,
  type AgentProofErrorDocument,
  type ExecutionRequestDocument,
  type PreparedRepositoryPatchDocument,
  type RepositoryPatchRequestDocument,
  type SignedReceiptDocument,
} from "./portable-protocol.js";
import {
  compensateRepositoryPatchWithReceipt,
  createApprovalRequest,
  executeApprovedTransaction,
  getTransactionStatus,
  prepareRepositoryPatch,
  reconcileRepositoryPatch,
  signingProviderFromPrivateKeyPem,
  verifyReceipt,
} from "./portable-sdk.js";
import { parseJsonStrict } from "./strict-json.js";

const args = process.argv.slice(2);

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function inputDocument<T>(): Promise<T> {
  const input = option("--input");
  if (!input) throw new AgentProofPortableError("input_required", "--input <path|-> is required.", EXIT_CODES.invalidInput);
  const raw = input === "-"
    ? await new Promise<string>((resolve, reject) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { value += chunk; });
      process.stdin.on("end", () => resolve(value));
      process.stdin.on("error", reject);
    })
    : await readFile(input, "utf8");
  try { return parseJsonStrict(raw) as T; } catch {
    throw new AgentProofPortableError("invalid_json", "Input is not valid JSON.", EXIT_CODES.invalidInput);
  }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function help(): void {
  process.stdout.write(`agentproof portable developer preview

Commands:
  agentproof prepare repository-patch --input <path|->
  agentproof approval-request --input <prepared> --expires-at <ISO> --nonce <value>
  agentproof execute --input <execution-request> --receipt-key <private-key.pem> [--receipt-key-id <id>]
  agentproof status --input <status-query>
  agentproof reconcile --input <reconciliation-query> --receipt-key <private-key.pem> [--receipt-key-id <id>]
  agentproof verify-receipt --input <signed-receipt> --trust-fingerprint <sha256:...> [--required-authority-environment development|production]
  agentproof compensate --input <status-query> --receipt-key <private-key.pem> --trust-fingerprint <sha256:...> --authority-environment development|production

All commands are non-interactive. JSON results go to stdout; diagnostics go to stderr.
`);
}

async function main(): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args[0] === "help") {
    help();
    return;
  }
  if (args[0] === "prepare" && args[1] === "repository-patch") {
    print(await prepareRepositoryPatch(await inputDocument<RepositoryPatchRequestDocument>()));
    return;
  }
  if (args[0] === "approval-request") {
    const expiresAt = option("--expires-at");
    const nonce = option("--nonce");
    if (!expiresAt || !nonce) throw new AgentProofPortableError("approval_options_required", "--expires-at and --nonce are required.", EXIT_CODES.invalidInput);
    print(await createApprovalRequest(await inputDocument<PreparedRepositoryPatchDocument>(), { expiresAt, nonce }));
    return;
  }
  if (args[0] === "execute") {
    const keyPath = option("--receipt-key");
    if (!keyPath) throw new AgentProofPortableError("receipt_key_required", "--receipt-key is required.", EXIT_CODES.invalidInput);
    const signer = signingProviderFromPrivateKeyPem(
      option("--receipt-key-id") ?? "agentproof-development-receipt",
      await readFile(keyPath, "utf8"),
    );
    print(await executeApprovedTransaction(await inputDocument<ExecutionRequestDocument>(), { receiptSigner: signer }));
    return;
  }
  if (args[0] === "status") {
    const query = await inputDocument<{ stateDirectory: string; transactionId: string; correlationId: string }>();
    print(await getTransactionStatus(query));
    return;
  }
  if (args[0] === "reconcile") {
    const keyPath = option("--receipt-key");
    if (!keyPath) throw new AgentProofPortableError("receipt_key_required", "--receipt-key is required.", EXIT_CODES.invalidInput);
    const query = await inputDocument<{ stateDirectory: string; transactionId: string; correlationId: string; authorityEnvironment: "development" | "production" }>();
    if (query.authorityEnvironment !== "development" && query.authorityEnvironment !== "production") throw new AgentProofPortableError("authority_environment_required", "authorityEnvironment must be development or production.", EXIT_CODES.invalidInput);
    print(await reconcileRepositoryPatch(query, { receiptSigner: signingProviderFromPrivateKeyPem(option("--receipt-key-id") ?? "agentproof-development-receipt", await readFile(keyPath, "utf8")) }));
    return;
  }
  if (args[0] === "verify-receipt") {
    const fingerprint = option("--trust-fingerprint");
    if (!fingerprint) throw new AgentProofPortableError("trust_fingerprint_required", "--trust-fingerprint is required.", EXIT_CODES.invalidInput);
    const result = verifyReceipt({
      document: await inputDocument<unknown>(),
      trustedSignerFingerprints: [fingerprint],
      requiredAuthorityEnvironment: option("--required-authority-environment") as "development" | "production" | undefined,
      requiredPolicyVersion: option("--required-policy-version"),
    });
    print(result);
    if (!result.cryptographicallyValid || !result.trusted) process.exitCode = EXIT_CODES.untrustedSigner;
    return;
  }
  if (args[0] === "compensate") {
    const query = await inputDocument<{ stateDirectory: string; transactionId: string; correlationId: string }>();
    if (!query.correlationId) throw new AgentProofPortableError("correlation_required", "correlationId is required.", EXIT_CODES.invalidInput);
    const keyPath = option("--receipt-key");
    const fingerprint = option("--trust-fingerprint");
    const environment = option("--authority-environment");
    if (!keyPath || !fingerprint || (environment !== "development" && environment !== "production")) throw new AgentProofPortableError("successor_options_required", "--receipt-key, --trust-fingerprint and --authority-environment are required.", EXIT_CODES.invalidInput);
    print(await compensateRepositoryPatchWithReceipt({ ...query, authorityEnvironment: environment }, {
      receiptSigner: signingProviderFromPrivateKeyPem(option("--receipt-key-id") ?? "agentproof-development-receipt", await readFile(keyPath, "utf8")),
      trustedSignerFingerprints: [fingerprint],
    }));
    return;
  }
  throw new AgentProofPortableError("unknown_command", `Unknown command: ${args.join(" ")}`, EXIT_CODES.invalidInput);
}

main().catch((error) => {
  const portable = error instanceof AgentProofPortableError
    ? error
    : new AgentProofPortableError("internal_failure", (error as Error).message, EXIT_CODES.internalFailure);
  const document: AgentProofErrorDocument = {
    schema: "agentproof.protocol.error",
    schemaVersion: PORTABLE_PROTOCOL_VERSION,
    actionType: REPOSITORY_PATCH_ACTION,
    correlationId: "cli",
    transactionId: portable.transactionId,
    code: portable.code,
    message: portable.message,
    retryable: portable.retryable,
  };
  process.stdout.write(`${JSON.stringify(document)}\n`);
  process.stderr.write(`agentproof: ${portable.code}: ${portable.message}\n`);
  process.exitCode = portable.exitCode;
});
