import test from "node:test";
import assert from "node:assert/strict";
import { collectReadiness, publicJson, SOURCES, toMarkdown } from "../lib/release-readiness.mjs";
const main = "a".repeat(40), old = "b".repeat(40), ops = "c".repeat(40), done = "d".repeat(40);
function observed(overrides = {}) {
  const data = {
    [SOURCES.agentproofMain]: { commit: { sha: main } },
    [SOURCES.opstruthMain]: { commit: { sha: ops } },
    [SOURCES.doneStateMain]: { commit: { sha: done } },
    [SOURCES.releaseInventory]: [],
    [SOURCES.patchApproval]: { service: "agentproof-production-provider", role: "approval", enabled: true, sourceCommit: old },
    [SOURCES.patchReceipt]: { service: "agentproof-production-provider", role: "receipt", enabled: true, sourceCommit: old },
    [SOURCES.releaseApproval]: { service: "agentproof-release-canary", role: "approval", enabled: false, sourceCommit: "0".repeat(40), targetConfigured: false },
    [SOURCES.releaseSigning]: { service: "agentproof-release-canary", role: "signing", enabled: false, sourceCommit: "0".repeat(40), targetConfigured: false },
    [SOURCES.releaseVerification]: { service: "opstruth-release-verifier", readOnly: true, enabled: false,
      sourceCommit: "0".repeat(40), independentSignerConfigured: false },
    [SOURCES.opstruthMcp]: { status: "ok", service: "opstruth", mode: "read-only-public-evidence", commit: "e".repeat(40), tools: 21 },
  };
  return { ...data, ...overrides };
}
const collect = (data = observed(), readCounter) => collectReadiness({
  now: new Date("2026-10-17T22:15:00.000Z"),
  getJson: async url => {
    if (readCounter) readCounter.push(url);
    if (!(url in data)) throw Error("unavailable");
    if (data[url] instanceof Error) throw data[url];
    return data[url];
  },
});
test("Detects actual production patch source drift without treating the live service as absent", async () => {
  const reads = [];
  const report = await collect(observed(), reads);
  assert.equal(report.overall, "PATCH_SOURCE_PIN_DRIFT");
  assert.equal(report.sourceCommits.agentproof, main);
  assert.equal(report.patch.approval.status, "SOURCE_PIN_DRIFT");
  assert.equal(report.patch.receipt.status, "SOURCE_PIN_DRIFT");
  assert.equal(report.patch.approval.sourceCommit, old);
  assert.equal(report.isolatedRelease.approval.status, "DISABLED_GUARDED");
  assert.equal(report.isolatedRelease.signing.status, "DISABLED_GUARDED");
  assert.equal(report.isolatedRelease.verifier.status, "DISABLED_GUARDED");
  assert.equal(report.disposableTarget.status, "NO_RELEASE");
  assert.equal(report.existingOpsTruth.status, "READ_ONLY_MCP_HEALTHY");
  assert.equal(report.externalAdoption, "NOT_MEASURED_BY_HEALTH_CHECK");
  assert.equal(report.releaseV1Outcome, "NOT_VERIFIED");
  assert.equal(report.productionEffectsAttempted, 0);
  assert.equal(reads.length, Object.values(SOURCES).length);
  assert.deepEqual([...reads].sort(), [...Object.values(SOURCES)].sort());
  const markdown = toMarkdown(report);
  assert.match(markdown, /PATCH_SOURCE_PIN_DRIFT/);
  assert.match(markdown, /No release, GitHub write/);
});
test("Aligned services still never imply a successful release outcome", async () => {
  const aligned = observed({
    [SOURCES.patchApproval]: { ...observed()[SOURCES.patchApproval], sourceCommit: main },
    [SOURCES.patchReceipt]: { ...observed()[SOURCES.patchReceipt], sourceCommit: main },
  });
  const snapshot = await collect(aligned);
  assert.equal(snapshot.overall, "NO_LIVE_RELEASE");
  assert.equal(snapshot.patch.approval.status, "SOURCE_ALIGNED");
  assert.equal(snapshot.releaseV1Outcome, "NOT_VERIFIED");
});
test("An unexpectedly enabled release signer is a higher-priority unsafe condition", async () => {
  const input = observed({
    [SOURCES.releaseSigning]: { ...observed()[SOURCES.releaseSigning], enabled: true, sourceCommit: main },
  });
  const r = await collect(input);
  assert.equal(r.overall, "UNEXPECTED_RELEASE_AUTHORITY");
  assert.equal(r.isolatedRelease.signing.status, "UNEXPECTED_ACTIVE");
});
test("An enabled verifier with an invalid or changed read-only policy never passes", async () => {
  const input = observed({
    [SOURCES.releaseVerification]: { service: "opstruth-release-verifier", readOnly: false,
      enabled: true, sourceCommit: main, independentSignerConfigured: true },
  });
  const r = await collect(input);
  assert.equal(r.overall, "UNEXPECTED_RELEASE_AUTHORITY");
  assert.equal(r.isolatedRelease.verifier.status, "UNEXPECTED_ACTIVE");
});
test("Provider errors and malformed release lists are UNPROVEN, not a fabricated empty release", async () => {
  for (const value of [new Error("github rate limit"), {}, null, "[]"]) {
    const data = observed({ [SOURCES.releaseInventory]: value });
    const r = await collect(data);
    assert.equal(r.disposableTarget.status, "UNPROVEN");
    assert.equal(r.overall, "PATCH_SOURCE_PIN_DRIFT");
  }
  const unavailable = await collect(observed({
    [SOURCES.patchApproval]: new Error("health timeout"),
    [SOURCES.patchReceipt]: new Error("health timeout"),
  }));
  assert.equal(unavailable.patch.approval.status, "UNPROVEN");
  assert.equal(unavailable.patch.receipt.status, "UNPROVEN");
  assert.equal(unavailable.overall, "INCOMPLETE_READBACK");
});
test("Observed GitHub releases cannot grant acceptance without independent signed verification", async () => {
  const withRelease = observed({
    [SOURCES.releaseInventory]: [{ id: 42, tag_name: "v0.0.1-rc.1", draft: false }],
    [SOURCES.patchApproval]: { ...observed()[SOURCES.patchApproval], sourceCommit: main },
    [SOURCES.patchReceipt]: { ...observed()[SOURCES.patchReceipt], sourceCommit: main },
  });
  const r = await collect(withRelease);
  assert.equal(r.overall, "RELEASE_OUTCOME_NOT_VERIFIED");
  assert.equal(r.disposableTarget.status, "RELEASES_EXIST_UNVERIFIED");
  assert.equal(r.doneStateTerminalReleaseOutcome, "NOT_VERIFIED");
  assert.equal(r.independentAdoptionCredit, 0);
});
test("Missing exact GitHub main source is UNPROVEN even when live services return health", async () => {
  const r = await collect(observed({
    [SOURCES.agentproofMain]: { notSha: "none" },
  }));
  assert.equal(r.sourceCommits.agentproof, null);
  assert.equal(r.patch.approval.status, "UNPROVEN");
  assert.equal(r.overall, "INCOMPLETE_READBACK");
});
test("OpsTruth public MCP tool-surface change is surfaced, not silently accepted", async () => {
  const r = await collect(observed({
    [SOURCES.opstruthMcp]: { ...observed()[SOURCES.opstruthMcp], tools: 22 },
  }));
  assert.equal(r.existingOpsTruth.status, "TOOL_SURFACE_CHANGED");
  assert.equal(r.releaseV1Outcome, "NOT_VERIFIED");
});

test("Live fetcher rejects non-allowlisted targets before any network request", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json({}); });
  await assert.rejects(publicJson("https://attacker.example/credentials"), /unexpected_read_target/);
  assert.equal(requests, 0);
});
test("Live fetcher rejects redirects and responses beyond bounded public metadata size", async t => {
  let status = 302;
  t.mock.method(globalThis, "fetch", async () => {
    if (status === 302) return new Response("redirect", { status: 302,
      headers: { "location": "https://unknown.example/", "content-type": "application/json" } });
    return new Response(JSON.stringify({ blob: "a".repeat(33000) }), {
      status: 200, headers: { "content-type": "application/json", "content-length": "33011" } });
  });
  await assert.rejects(publicJson(SOURCES.agentproofMain), /unavailable_public_readback/);
  status = 200;
  await assert.rejects(publicJson(SOURCES.agentproofMain), /oversized_public_response/);
});
test("Premature disabled-service signing-key or target configuration is hazardous, not successful readiness", async () => {
  const r = await collect(observed({
    [SOURCES.releaseApproval]: { ...observed()[SOURCES.releaseApproval], targetConfigured: true },
    [SOURCES.releaseVerification]: { ...observed()[SOURCES.releaseVerification], independentSignerConfigured: true },
  }));
  assert.equal(r.overall, "UNEXPECTED_RELEASE_AUTHORITY");
  assert.equal(r.isolatedRelease.approval.status, "UNEXPECTED_ACTIVE");
  assert.equal(r.isolatedRelease.verifier.status, "UNEXPECTED_ACTIVE");
});
