#!/usr/bin/env node
// Engineering acceptance only. Never counts as an independent adoption participant.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, open, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { RC6, sha256, integrity, verifyReleaseBytes, verifyRegistrySignature, publicBytes, parseOptions } from "./lib/acceptance.mjs";

const exec = promisify(execFile);
let options;
try { options = parseOptions(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exit(2); }
const output = path.resolve(options["--output"]);
const outputHandle = await open(output, "wx", 0o600); // Never replace previous evidence.
const report = {
  schema: "agentproof.engineering-acceptance.v1", evidenceKind: "maintainer_engineering",
  independentAdoptionCredit: 0, productionAuthorityProven: false,
  startedAt: new Date().toISOString(), completedAt: null,
  platform: process.platform, architecture: process.arch, node: process.version,
  artifact: null, checks: [], status: "FAIL", firstTrustedReceiptMs: null,
};
let lab;
let currentStep = "initialise";
async function check(name, fn) {
  currentStep = name;
  const start = performance.now();
  const result = await fn();
  report.checks.push({ name, status: "PASS", durationMs: Math.round(performance.now() - start) });
  return result;
}
try {
  lab = await realpath(await mkdtemp(path.join(tmpdir(), "agentproof-acceptance-")));
  const consumer = path.join(lab, "consumer");
  const repo = path.join(lab, "repository");
  await mkdir(consumer);
  const config = path.join(lab, "empty.npmrc");
  await writeFile(config, "", { mode: 0o600 });
  // Deliberately pass no inherited npm tokens, Git credentials, hooks, or Node options.
  const env = {
    PATH: process.env.PATH, LANG: "C.UTF-8", GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(lab, "empty.gitconfig"), GIT_TERMINAL_PROMPT: "0",
    npm_config_userconfig: config, npm_config_globalconfig: path.join(lab, "global.npmrc"),
    npm_config_cache: path.join(lab, "cache"), npm_config_registry: "https://registry.npmjs.org",
  };
  await writeFile(env.GIT_CONFIG_GLOBAL, "");
  await writeFile(env.npm_config_globalconfig, "");
  async function run(file, args, cwd = consumer) {
    try { return (await exec(file, args, { cwd, env, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 })).stdout; }
    catch (error) { const failure = new Error("subprocess_failed"); failure.stdout = error.stdout; failure.exitCode = error.code; throw failure; } // Kept in memory only, never copied into reports.
  }
  let bytes;
  if (options["--candidate-tarball"]) {
    bytes = await check("read_candidate", () => readFile(path.resolve(options["--candidate-tarball"])));
    report.artifact = { kind: "unpublished_source_candidate", sourceCommit: options["--source-commit"],
      sha256: sha256(bytes), integrity: integrity(bytes), registrySignature: "NOT_CHECKED" };
  } else {
    const metadata = await check("registry_metadata", async () => JSON.parse(await publicBytes("https://registry.npmjs.org/@oneclicksystems%2fagentproof/0.1.0-rc.6")));
    const keyId = await check("registry_signature", async () => verifyRegistrySignature(metadata,
      JSON.parse(await publicBytes("https://registry.npmjs.org/-/npm/v1/keys")).keys));
    bytes = await check("download_exact_release", () => publicBytes(RC6.tarball));
    await check("release_digest", async () => verifyReleaseBytes(bytes));
    report.artifact = { ...RC6, kind: "published_release", registrySignature: "PASS", registryKeyId: keyId };
  }
  const tarball = path.join(lab, "package.tgz");
  await writeFile(tarball, bytes);
  await writeFile(path.join(consumer, "package.json"), JSON.stringify({ name: "agentproof-disposable-consumer", private: true, type: "module" }));
  await check("clean_offline_install", () => run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", tarball]));
  const pkgRoot = path.join(consumer, "node_modules", "@oneclicksystems", "agentproof");
  const pkg = JSON.parse(await readFile(path.join(pkgRoot, "package.json"), "utf8"));
  await check("package_identity", async () => {
    assert.equal(pkg.name, RC6.name); assert.equal(pkg.version, RC6.version);
  });
  report.artifact.name = pkg.name; report.artifact.version = pkg.version;
  const cli = path.join(pkgRoot, "dist", "cli.js");
  const auth = path.join(pkgRoot, "dist", "dev-authority-cli.js");
  const ap = args => run(process.execPath, [cli, ...args]);
  const dev = args => run(process.execPath, [auth, "--development", ...args]);
  async function rejected(args, field, expected) {
    await assert.rejects(ap(args), error => {
      const result = JSON.parse(error.stdout);
      assert.ok(Number.isInteger(error.exitCode) && error.exitCode !== 0);
      assert.equal(result[field], expected);
      if (field === "reason") assert.equal(result.trusted, false);
      return true;
    });
  }
  const jsonFile = async (name, value) => {
    const file = path.join(lab, name + ".json");
    await writeFile(file, JSON.stringify(value), { mode: 0o600 }); return file;
  };
  await check("cli_help", async () => assert.match(await ap(["--help"]), /prepare repository-patch/));
  await check("development_cli_help", async () => assert.match(await run(process.execPath, [auth, "--help"]), /development/));
  await check("package_exports", async () => {
    const probe = `import assert from "node:assert/strict";
import fs from "node:fs";
import * as sdk from "@oneclicksystems/agentproof";
import * as dev from "@oneclicksystems/agentproof/development-authority";
for (const name of ["prepareRepositoryPatch","createApprovalRequest","executeApprovedTransaction","getTransactionStatus","reconcileRepositoryPatch","compensateRepositoryPatchWithReceipt","verifyReceipt"]) assert.equal(typeof sdk[name], "function");
assert.equal(typeof dev.createDevelopmentApprovalDecision,"function");
assert.equal(typeof dev.createDevelopmentKeyPair,"function");
for (const name of ["agent-proof-error","approval-decision","approval-request","execution-request","prepared-repository-patch","receipt-verification-result","repository-patch-request","signed-receipt","transaction-status"]) JSON.parse(fs.readFileSync(new URL(import.meta.resolve("@oneclicksystems/agentproof/schemas/"+name+".schema.json"))));
console.log(JSON.stringify({rootExports:Object.keys(sdk).length,developmentExports:Object.keys(dev).length,schemas:9}));`;
    const file = path.join(consumer, "exports.mjs"); await writeFile(file, probe);
    report.exports = JSON.parse(await run(process.execPath, [file]));
  });
  await check("disposable_repository", async () => {
    await run("git", ["init", "-b", "main", repo]);
    await run("git", ["-C", repo, "config", "user.email", "acceptance@example.invalid"]);
    await run("git", ["-C", repo, "config", "user.name", "AgentProof Acceptance"]);
    await writeFile(path.join(repo, "protected.txt"), "before\n");
    await run("git", ["-C", repo, "add", "protected.txt"]);
    await run("git", ["-C", repo, "-c", "commit.gpgsign=false", "commit", "-m", "baseline"]);
  });
  const request = {
    schema: "agentproof.protocol.repository-patch-request", schemaVersion: "1.0.0",
    actionType: "agentproof.repository_patch.v1", correlationId: "engineering-acceptance",
    stateDirectory: path.join(lab, "state"),
    action: { type: "agentproof.repository_patch.v1", repositoryRoot: repo,
      operations: [{ kind: "write", path: "protected.txt", contentBase64: Buffer.from("after\n").toString("base64") }] },
    intent: { summary: "Disposable acceptance exercise", requestedBy: "engineering-acceptance", acceptanceCriteria: ["exact approved bytes"] },
    policy: { allowedRepositoryRoot: repo, allowedTrackedPaths: ["protected.txt"], allowedNewPaths: [], maxPatchBytes: 1024, maxFiles: 1 },
  };
  const prepared = await check("prepare", async () => JSON.parse(await ap(["prepare", "repository-patch", "--input", await jsonFile("request", request)])));
  const approvalRequest = await check("approval_request", async () => JSON.parse(await ap(["approval-request", "--input", await jsonFile("prepared", prepared), "--expires-at", new Date(Date.now() + 600_000).toISOString(), "--nonce", "acceptance-nonce"])));
  const authorityKey = path.join(lab, "authority.pem"), receiptKey = path.join(lab, "receipt.pem");
  const authority = JSON.parse(await dev(["keygen", "--private-key-output", authorityKey]));
  const signer = JSON.parse(await dev(["keygen", "--private-key-output", receiptKey]));
  const approval = await check("development_approval", async () => JSON.parse(await dev(["decide", "--input", await jsonFile("approval-request", approvalRequest), "--private-key", authorityKey, "--decision", "approved", "--issuer", "acceptance-development"])));
  const execution = {
    schema: "agentproof.protocol.execution-request", schemaVersion: "1.0.0", actionType: "agentproof.repository_patch.v1",
    correlationId: prepared.correlationId, transactionId: prepared.transactionId, stateDirectory: prepared.stateDirectory,
    idempotencyKey: "acceptance-execution", requiredAuthorityEnvironment: "development",
    trustedAuthorityFingerprints: [authority.fingerprint], approvalDecision: approval,
  };
  await check("reject_development_as_production", async () => {
    const input = await jsonFile("production-rejection", { ...execution, requiredAuthorityEnvironment: "production" });
    await rejected(["execute", "--input", input, "--receipt-key", receiptKey], "code", "approval_scope_mismatch");
    assert.equal(await readFile(path.join(repo, "protected.txt"), "utf8"), "before\n");
  });
  const executionFile = await jsonFile("execution", execution);
  const rawReceipt = await check("execute", () => ap(["execute", "--input", executionFile, "--receipt-key", receiptKey]));
  const receipt = JSON.parse(rawReceipt);
  const receiptFile = await jsonFile("receipt", receipt);
  await check("independent_cli_receipt_verification", async () => {
    const result = JSON.parse(await ap(["verify-receipt", "--input", receiptFile, "--trust-fingerprint", signer.fingerprint, "--required-authority-environment", "development"]));
    assert.equal(result.trusted, true); assert.equal(result.cryptographicallyValid, true);
    assert.equal(await readFile(path.join(repo, "protected.txt"), "utf8"), "after\n");
    report.firstTrustedReceiptMs = Date.now() - Date.parse(report.startedAt);
  });
  await check("reject_untrusted_signer", () => rejected(["verify-receipt", "--input", receiptFile, "--trust-fingerprint", authority.fingerprint], "reason", "valid_untrusted_signer"));
  await check("reject_tampered_receipt", async () => {
    const tampered = structuredClone(receipt); tampered.payload.correlationId = "altered";
    await rejected(["verify-receipt", "--input", await jsonFile("tampered", tampered), "--trust-fingerprint", signer.fingerprint], "reason", "digest_mismatch");
  });
  await check("exactly_once_retry", async () => assert.equal(await ap(["execute", "--input", executionFile, "--receipt-key", receiptKey]), rawReceipt));
  const query = { stateDirectory: prepared.stateDirectory, transactionId: prepared.transactionId, correlationId: prepared.correlationId };
  await check("reconcile_without_reexecution", async () => {
    assert.deepEqual(JSON.parse(await ap(["reconcile", "--input", await jsonFile("reconciliation", { ...query, authorityEnvironment: "development" }), "--receipt-key", receiptKey])), receipt);
  });
  const successor = await check("compensate", async () => JSON.parse(await ap(["compensate", "--input", await jsonFile("query", query), "--receipt-key", receiptKey, "--trust-fingerprint", signer.fingerprint, "--authority-environment", "development"])));
  const successorFile = await jsonFile("successor", successor);
  await check("verify_authenticated_successor_chain", async () => {
    const probe = `import assert from "node:assert/strict"; import fs from "node:fs"; import {verifyReceipt} from "@oneclicksystems/agentproof";
const [successor,predecessor,fp]=process.argv.slice(2);
const document=JSON.parse(fs.readFileSync(successor)); const parent=JSON.parse(fs.readFileSync(predecessor));
assert.equal(document.payload.predecessorPayloadDigest,parent.proof.payloadDigest);
assert.equal(verifyReceipt({document,predecessorChain:[parent],trustedSignerFingerprints:[fp],requiredAuthorityEnvironment:"development"}).trusted,true);
assert.equal(verifyReceipt({document,trustedSignerFingerprints:[fp],requiredAuthorityEnvironment:"development"}).trusted,false);`;
    const file = path.join(consumer, "successor.mjs"); await writeFile(file, probe);
    await run(process.execPath, [file, successorFile, receiptFile, signer.fingerprint]);
  });
  await check("clean_compensation", async () => {
    assert.equal(await readFile(path.join(repo, "protected.txt"), "utf8"), "before\n");
    assert.equal((await run("git", ["-C", repo, "status", "--porcelain"])).trim(), "");
  });
  report.receipts = { initialPayloadDigest: receipt.proof.payloadDigest, successorPayloadDigest: successor.proof.payloadDigest,
    predecessorPayloadDigest: successor.payload.predecessorPayloadDigest, signerFingerprint: signer.fingerprint };
  report.status = "PASS";
} catch {
  report.checks.push({ name: currentStep, status: "FAIL" });
  process.exitCode = 1;
} finally {
  if (lab) {
    try { await rm(lab, { recursive: true, force: true }); report.temporaryStateRemoved = true; }
    catch { report.temporaryStateRemoved = false; report.status = "FAIL"; process.exitCode = 1; }
  }
  report.completedAt = new Date().toISOString();
  await outputHandle.writeFile(JSON.stringify(report, null, 2) + "\n");
  await outputHandle.close();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, independentAdoptionCredit: 0 }));
}
