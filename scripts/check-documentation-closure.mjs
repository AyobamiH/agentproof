import { access, readFile } from "node:fs/promises";

for (const file of ["README.md", "CHANGELOG.md", "docs/CURRENT-STATUS.md", "docs/ROADMAP.md", "docs/DECISION-LOG.md", "docs/protocols/donestate-lifecycle-adapter.md", "AGENTS.md"]) {
  await access(new URL(`../${file}`, import.meta.url));
}
const status = await readFile(new URL("../docs/CURRENT-STATUS.md", import.meta.url), "utf8");
if (status.includes("GitHub Release remain\n  unpublished")) throw new Error("AgentProof status still claims the GitHub prerelease is unpublished");
for (const subject of ["2ec72f15a50881104ad03d92cde133d7a2351685", "0.1.0-rc.5", "npm prerelease remains unpublished", "repository_patch.v1"]) {
  if (!status.includes(subject)) throw new Error(`current status is missing required subject: ${subject}`);
}
console.log("documentation closure: ok");
