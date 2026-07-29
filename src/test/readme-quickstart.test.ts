import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const requiredQuickstartEvidence = [
  "agentproof.protocol.repository-patch-request",
  "prepare repository-patch",
  "approval-request",
  "--development keygen",
  "--development decide",
  "agentproof.protocol.execution-request",
  "trustedAuthorityFingerprints",
  "verify-receipt",
  "receipt-retry.json",
  "compensate",
  "git -C \"$REPO\" status --porcelain",
];

test("packaged README documents a complete CLI lifecycle without external workspace knowledge", async () => {
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
  const quickstart = readme.match(/## CLI quickstart([\s\S]*?)\n## SDK/)?.[1] ?? "";
  assert.ok(quickstart.includes("mktemp -d"));
  for (const evidence of requiredQuickstartEvidence) {
    assert.ok(quickstart.includes(evidence), `README quickstart is missing ${evidence}`);
  }
  assert.ok(!quickstart.includes("openclaw-operator"));
});
