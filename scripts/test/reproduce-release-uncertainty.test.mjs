import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../reproduce-release-uncertainty.mjs", import.meta.url));
const launch = (args = []) => spawnSync(process.execPath, [runner, ...args], {
  encoding: "utf8",
  timeout: 90_000,
  maxBuffer: 4_000_000
});

test("public release uncertainty reproducer reports exactly eight fixture passes", () => {
  const result = launch();
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const report = JSON.parse(result.stdout);
  assert.equal(report.result, "PASS");
  assert.equal(report.pass, 8);
  assert.equal(report.tests, 8);
  assert.equal(report.fail, 0);
  assert.equal(report.skipped, 0);
  assert.equal(report.cases.length, 8);
  assert.equal(report.cases.every(item => item.observedInRun), true);
  assert.equal(report.productionOrExternalOutcomeVerified, false);
});

test("public release uncertainty reproducer refuses unreviewed arguments", () => {
  const result = launch(["--real-provider", "github"]);
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.result, "BLOCKED");
  assert.match(report.reason, /No arguments accepted/);
});
