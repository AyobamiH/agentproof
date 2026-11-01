#!/usr/bin/env node
// Research-only reproduction of existing AgentProof release-v1 tests.
// No provider calls, new authority, or live release operations are implemented here.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const sourceFile = "src/test/release-v1.test.ts";
const controllerFile = "src/release-v1-controller.ts";
const compiledFile = "dist/test/release-v1.test.js";
const expected = {
  [sourceFile]: "3b4350c64b46767e9f390286b228b4e6c0048e7042e9a5ac83e986675c1dd819",
  [controllerFile]: "69d4f8446d0a0ec5ffb23ee10d51bfa5a6dadc9b91e76811318d71be391e5d37",
  [compiledFile]: "04de681b4062cdab2690bbfec2e9a8c8baacbcb9b695ea898681eac0fcd9c20e"
};
const cases = [
  {
    name: "exact authorised release, one mutation, durable retry and independently signed V2 evidence",
    expectation: "one simulated publication; trusted signature; independentOutcomeVerified=false"
  },
  {
    name: "lost successful publication response reconciles by readback without re-publication",
    expectation: "lost acknowledgement settles from fixture readback; mutation count remains one"
  },
  {
    name: "unavailable post-effect readback never retries the effect",
    expectation: "unknown first result is reconciled without another simulated publication"
  },
  {
    name: "signer outage after verified effect recovers by signing alone",
    expectation: "signer-only recovery; simulated publication count remains one"
  },
  {
    name: "wrong preconditions, altered authority or expired grant fail before publication",
    expectation: "denied, expired and altered preconditions cause no simulated publication"
  },
  {
    name: "ambiguous unsuccessful PATCH is never invoked twice on restart",
    expectation: "unobserved effect remains ambiguous and is not automatically replayed"
  },
  {
    name: "after-effect artifact drift cannot be signed or retried",
    expectation: "mismatched digest blocks a receipt and prevents another publication"
  },
  {
    name: "target uniqueness also rejects a fresh nonce on a second transaction",
    expectation: "new nonce does not authorise a second publication of the same target"
  }
];
const json = data => JSON.stringify(data, null, 2) + "\n";
const baseReport = {
  schemaVersion: 1,
  name: "agentproof.release.v1 / fixture-only outcome-uncertainty reproduction",
  purpose: "Re-execute existing reviewed unit-test scenarios; NOT a live GitHub provider experiment.",
  sourceBaselineCommit: "d599bf512613cfa71a8ed95cc718937d63b5080a",
  subject: "ExampleOwner/disposable-release-canary; ephemeral Ed25519 fixture keys",
  permittedConsequence: "local temporary fixture files and local ephemeral signatures only",
  externalProviderCallsBySelectedCases: "none by design; code-pinned fixtures, not an OS network sandbox",
  productionOrExternalOutcomeVerified: false
};
try {
  if (process.argv.slice(2).length) throw new Error("No arguments accepted. Redirect JSON stdout to a file if needed.");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 5)) throw new Error("Node.js >=22.5 is required.");
  const observed = {};
  for (const [file, reference] of Object.entries(expected)) {
    const actual = sha256(readFileSync(path.join(root, file)));
    observed[file] = actual;
    if (actual !== reference) throw new Error("SOURCE_DRIFT: " + file +
      " differs from audited baseline; inspect changes before any reproduction.");
  }
  const names = cases.map(c => c.name);
  // The eight literal test names have no regex metacharacters.
  const pattern = "^(?:" + names.join("|") + ")$";
  // Do not forward ambient API credentials to the spawned test process.
  const childEnv = {};
  for (const key of ["PATH", "HOME", "TMP", "TEMP", "TMPDIR", "LANG", "LC_ALL", "CI", "SYSTEMROOT"]) {
    if (process.env[key]) childEnv[key] = process.env[key];
  }
  const args = ["--test", "--test-reporter=tap", "--test-name-pattern=" + pattern, compiledFile];
  const result = spawnSync(process.execPath, args, {
    cwd: root, env: childEnv, encoding: "utf8", timeout: 90_000, maxBuffer: 4_000_000
  });
  const tap = result.stdout || "";
  const metrics = Object.fromEntries(["tests", "pass", "fail", "skipped", "cancelled", "todo"]
    .map(key => [key, Number(tap.match(new RegExp("^# " + key + " (\\d+)$", "m"))?.[1] ?? -1)]));
  const observedNames = [...tap.matchAll(/^# Subtest: (.+)$/gm)].map(match => match[1]);
  const pass = result.status === 0 && !result.error &&
    metrics.tests === names.length && metrics.pass === names.length &&
    metrics.fail === 0 && metrics.skipped === 0 && metrics.cancelled === 0 &&
    metrics.todo === 0 && names.every(name => observedNames.includes(name)) &&
    new Set(observedNames).size === names.length;
  const report = {
    ...baseReport,
    result: pass ? "PASS" : "FAIL",
    observedAt: new Date().toISOString(),
    nodeVersion: process.version,
    sourceHashes: observed,
    tapSha256: sha256(tap),
    testProcessExitCode: result.status,
    testProcessError: result.error?.message ?? null,
    ...metrics,
    cases: cases.map(c => ({ ...c, observedInRun: observedNames.includes(c.name) })),
    limitations: [
      "The provider is FixtureReleaseProvider, not GitHub or any production API.",
      "Temporary approval and receipt keys are generated inside the test.",
      "independentOutcomeVerified=false is asserted even for a trusted signature.",
      "These assertions do not establish universal exactly-once semantics, provider availability, real external effects or independent adoption.",
      "Source hashes guard this frozen fixture, not the operating system or dependencies."
    ]
  };
  process.stdout.write(json(report));
  if (!pass) {
    process.stderr.write("Reproduction failed; inspect TAP diagnostics (not positive acceptance):\n" +
      tap.slice(-12_000) + "\n" + (result.stderr || "") + "\n");
    process.exitCode = 1;
  }
} catch (error) {
  process.stdout.write(json({ ...baseReport, result: "BLOCKED", reason: String(error?.message || error) }));
  process.exitCode = 2;
}
