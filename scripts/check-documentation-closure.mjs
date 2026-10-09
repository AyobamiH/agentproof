import { access, readFile } from "node:fs/promises";

for (const file of ["README.md", "CHANGELOG.md", "docs/CURRENT-STATUS.md", "docs/ROADMAP.md", "docs/DECISION-LOG.md", "docs/protocols/donestate-lifecycle-adapter.md", "docs/NPM-RELEASE.md", "docs/releases/0.1.0-rc.6.md", "docs/evidence/npm-rc6-registry-reconciliation.md", ".github/workflows/release-prerelease.yml", ".github/workflows/release-github-prerelease.yml", "AGENTS.md"]) {
  await access(new URL(`../${file}`, import.meta.url));
}
const status = await readFile(new URL("../docs/CURRENT-STATUS.md", import.meta.url), "utf8");
for (const staleClaim of ["GitHub Release remain\n  unpublished", "npm prerelease remains unpublished", "RC6 npm prerelease remains unpublished"]) {
  if (status.includes(staleClaim)) throw new Error(`AgentProof status contains stale release claim: ${staleClaim}`);
}
for (const subject of ["2ec72f15a50881104ad03d92cde133d7a2351685", "0.1.0-rc.6", "RC6's distribution gate is complete", "release-prerelease.yml", "stage publish", "repository_patch.v1", "npm-rc6-registry-reconciliation.md"]) {
  if (!status.includes(subject)) throw new Error(`current status is missing required subject: ${subject}`);
}
console.log("documentation closure: ok");
