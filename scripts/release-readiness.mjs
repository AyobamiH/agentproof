#!/usr/bin/env node
import { appendFile, writeFile } from "node:fs/promises";
import { collectReadiness, toMarkdown } from "./lib/release-readiness.mjs";

const args = process.argv.slice(2);
let output = null;
let strict = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--output" && args[i + 1]) {
    output = args[++i];
  } else if (args[i] === "--strict") {
    strict = true;
  } else {
    process.stderr.write("Usage: node scripts/release-readiness.mjs [--output path] [--strict]\n");
    process.exit(2);
  }
}
const snapshot = await collectReadiness();
const markdown = toMarkdown(snapshot);
if (output) await writeFile(output, JSON.stringify(snapshot, null, 2) + "\n", { flag: "w", mode: 0o600 });
process.stdout.write(markdown);
const githubSummary = process.env.GITHUB_STEP_SUMMARY;
if (githubSummary) await appendFile(githubSummary, markdown + "\n");
if (snapshot.overall !== "NO_LIVE_RELEASE" &&
    snapshot.overall !== "RELEASE_OUTCOME_NOT_VERIFIED") {
  // No secrets or arbitrary error bodies appear in workflow annotations.
  process.stdout.write("::warning title=AgentProof authority readiness::" + snapshot.overall + "\n");
}
if (strict && ["PATCH_SOURCE_PIN_DRIFT", "UNEXPECTED_RELEASE_AUTHORITY",
  "INCOMPLETE_READBACK"].includes(snapshot.overall)) {
  process.exitCode = 3;
}
