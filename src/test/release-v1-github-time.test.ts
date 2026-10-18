import test from "node:test";
import assert from "node:assert/strict";
import { canonicalGitHubPublishedAt } from "../release-v1-github.js";
import { releaseTime } from "../release-v1-contract.js";
test("real GitHub seconds-precision publication time becomes canonical signed protocol time", () => {
  const raw = "2026-10-07T04:34:23Z"; // observed from GitHub release 405381381
  const result = canonicalGitHubPublishedAt(raw);
  assert.equal(result, "2026-10-07T04:34:23.000Z");
  assert.equal(releaseTime(result!), Date.parse(raw));
  assert.equal(canonicalGitHubPublishedAt("2026-10-07T04:34:23.125Z"),
    "2026-10-07T04:34:23.125Z");
  assert.equal(canonicalGitHubPublishedAt(null), null);
});
test("GitHub timestamp conversion rejects invalid dates, offsets and coercions", () => {
  for (const value of [undefined, 0, {}, "", "2026-02-30T04:34:23Z",
    "2026-10-07T04:34:23+00:00", "2026-10-07T04:34:23.1Z",
    "2026-10-07T04:34:60Z", "2026-13-07T04:34:23Z"])
    assert.throws(() => canonicalGitHubPublishedAt(value), /github_publication_time_invalid/);
});
