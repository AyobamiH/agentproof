/**
 * Read-only public release authority snapshot. It never triggers a canary,
 * creates a release, writes a GitHub issue, updates Cloudflare, reads secrets,
 * counts synthetic installations, or treats a published asset as VERIFIED.
 */
export const SOURCES = Object.freeze({
  agentproofMain: "https://api.github.com/repos/AyobamiH/agentproof/branches/main",
  opstruthMain: "https://api.github.com/repos/AyobamiH/opstruth-chatgpt-plugin/branches/main",
  doneStateMain: "https://api.github.com/repos/AyobamiH/donestate/branches/main",
  releaseInventory: "https://api.github.com/repos/AyobamiH/agentproof-release-canary/releases?per_page=100",
  patchApproval: "https://agentproof-approval.woeinvests.workers.dev/health",
  patchReceipt: "https://agentproof-receipt.woeinvests.workers.dev/health",
  releaseApproval: "https://agentproof-release-approval.woeinvests.workers.dev/health",
  releaseSigning: "https://agentproof-release-sign.woeinvests.workers.dev/health",
  releaseVerification: "https://opstruth-release-verify.woeinvests.workers.dev/health",
  opstruthMcp: "https://mcp.opstruth.io/health",
});
const allowed = new Set(Object.values(SOURCES));
const SHA = /^[0-9a-f]{40}$/;
const ZERO = "0".repeat(40);
const MAX_BYTES = 32_768;
const TIMEOUT_MS = 8_000;

export async function publicJson(url) {
  if (!allowed.has(url)) throw new Error("unexpected_read_target");
  const response = await fetch(url, {
    method: "GET", redirect: "error", cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "accept": "application/vnd.github+json, application/json",
      "user-agent": "agentproof-readonly-release-observer/1",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok || response.status !== 200 || response.redirected ||
      !response.headers.get("content-type")?.includes("json")) {
    throw new Error("unavailable_public_readback");
  }
  const expectedLength = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(expectedLength) || expectedLength > MAX_BYTES) {
    throw new Error("oversized_public_response");
  }
  if (!response.body) throw new Error("empty_public_readback");
  const reader = response.body.getReader();
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BYTES) throw new Error("oversized_public_response");
      chunks.push(part.value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(raw);
}
const safeRead = async (getJson, url) => {
  try { return { observed: true, data: await getJson(url) }; }
  catch { return { observed: false, code: "read_unavailable" }; }
};
function publicSha(response) {
  return response.observed && typeof response.data?.commit?.sha === "string" &&
    SHA.test(response.data.commit.sha) ? response.data.commit.sha : null;
}
function patchService(response, role, mainSha) {
  if (!response.observed) return { status: "UNPROVEN", reason: "health_unavailable" };
  const v = response.data;
  if (!v || v.service !== "agentproof-production-provider" || v.role !== role ||
      typeof v.enabled !== "boolean" || !SHA.test(v.sourceCommit)) {
    return { status: "UNPROVEN", reason: "health_identity_or_schema_invalid" };
  }
  if (!v.enabled) return { status: "DISABLED", reason: "patch_authority_disabled", sourceCommit: v.sourceCommit };
  if (!mainSha) return { status: "UNPROVEN", reason: "main_sha_unavailable", sourceCommit: v.sourceCommit };
  return { status: v.sourceCommit === mainSha ? "SOURCE_ALIGNED" : "SOURCE_PIN_DRIFT",
    sourceCommit: v.sourceCommit, expectedMainSha: mainSha };
}
function releaseService(response, kind) {
  if (!response.observed) return { status: "UNPROVEN", reason: "health_unavailable" };
  const v = response.data;
  const expected = kind === "verification" ?
    v?.service === "opstruth-release-verifier" && v?.readOnly === true &&
      v?.independentSignerConfigured === false :
    v?.service === "agentproof-release-canary" &&
      v?.role === (kind === "signing" ? "signing" : "approval") &&
      v?.targetConfigured === false;
  if (!expected || typeof v.enabled !== "boolean" || !SHA.test(v.sourceCommit)) {
    // An active service, selected target, or configured signing key is a
    // safety concern even when the rest of a health response is malformed.
    const unexpected = v?.enabled === true || v?.targetConfigured === true ||
      v?.independentSignerConfigured === true;
    return { status: unexpected ? "UNEXPECTED_ACTIVE" : "UNPROVEN",
      reason: "health_identity_or_disabled_guard_invalid" };
  }
  if (v.enabled || v.sourceCommit !== ZERO) return { status: "UNEXPECTED_ACTIVE",
    reason: "release_specific_authority_was_not_approved",
    sourceCommit: v.sourceCommit };
  return { status: "DISABLED_GUARDED", sourceCommit: ZERO };
}
function inventory(response) {
  if (!response.observed) return { status: "UNPROVEN", reason: "release_inventory_unavailable" };
  if (!Array.isArray(response.data)) return { status: "UNPROVEN", reason: "inventory_schema_invalid" };
  if (response.data.length === 0) return { status: "NO_RELEASE", observedCount: 0 };
  if (!response.data.every(v => Number.isSafeInteger(v?.id) && v.id > 0 &&
      typeof v.tag_name === "string" && typeof v.draft === "boolean")) {
    return { status: "UNPROVEN", reason: "inventory_schema_invalid" };
  }
  return { status: "RELEASES_EXIST_UNVERIFIED",
    observedCount: response.data.length, maybeAdditionalPages: response.data.length === 100 };
}
function opstruthHealth(response) {
  if (!response.observed) return { status: "UNPROVEN", reason: "health_unavailable" };
  const v = response.data;
  if (v?.status !== "ok" || v?.service !== "opstruth" ||
      v?.mode !== "read-only-public-evidence" || !SHA.test(v.commit) ||
      !Number.isSafeInteger(v.tools) || v.tools < 1) {
    return { status: "UNPROVEN", reason: "health_identity_or_policy_invalid" };
  }
  return { status: v.tools === 21 ? "READ_ONLY_MCP_HEALTHY" : "TOOL_SURFACE_CHANGED",
    deployedCommit: v.commit, readOnlyTools: v.tools };
}
export async function collectReadiness({ getJson = publicJson, now = new Date() } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("invalid_snapshot_time");
  const names = Object.keys(SOURCES);
  const readbacks = await Promise.all(names.map(n => safeRead(getJson, SOURCES[n])));
  const data = Object.fromEntries(names.map((n, i) => [n, readbacks[i]]));
  const mainShas = {
    agentproof: publicSha(data.agentproofMain),
    opstruth: publicSha(data.opstruthMain),
    donestate: publicSha(data.doneStateMain),
  };
  const patch = {
    approval: patchService(data.patchApproval, "approval", mainShas.agentproof),
    receipt: patchService(data.patchReceipt, "receipt", mainShas.agentproof),
  };
  const isolatedRelease = {
    approval: releaseService(data.releaseApproval, "approval"),
    signing: releaseService(data.releaseSigning, "signing"),
    verifier: releaseService(data.releaseVerification, "verification"),
  };
  const target = inventory(data.releaseInventory);
  const opsTruth = opstruthHealth(data.opstruthMcp);
  const statuses = [...Object.values(patch), ...Object.values(isolatedRelease), target, opsTruth];
  const unexpected = statuses.some(x => x.status === "UNEXPECTED_ACTIVE");
  const unknown = statuses.some(x => x.status === "UNPROVEN") || Object.values(mainShas).some(x => !x);
  const drift = Object.values(patch).some(x => x.status === "SOURCE_PIN_DRIFT");
  const overall = unexpected ? "UNEXPECTED_RELEASE_AUTHORITY" :
    drift ? "PATCH_SOURCE_PIN_DRIFT" :
    unknown ? "INCOMPLETE_READBACK" :
    target.status === "NO_RELEASE" ? "NO_LIVE_RELEASE" :
    "RELEASE_OUTCOME_NOT_VERIFIED";
  return {
    schema: "agentproof.read-only-release-readiness.v1",
    observedAt: now.toISOString(), authorization: "none", requests: "GET-only allowlisted public endpoints",
    productionEffectsAttempted: 0, independentAdoptionCredit: 0,
    sourceCommits: mainShas,
    patch,
    isolatedRelease,
    disposableTarget: target,
    existingOpsTruth: opsTruth,
    releaseV1Outcome: "NOT_VERIFIED",
    doneStateTerminalReleaseOutcome: "NOT_VERIFIED",
    externalAdoption: "NOT_MEASURED_BY_HEALTH_CHECK",
    overall,
  };
}
export function toMarkdown(result) {
  const entries = [
    ["AgentProof main", result.sourceCommits.agentproof ?? "UNPROVEN"],
    ["Patch approval", result.patch.approval.status + (result.patch.approval.sourceCommit ? " / " + result.patch.approval.sourceCommit : "")],
    ["Patch receipt", result.patch.receipt.status + (result.patch.receipt.sourceCommit ? " / " + result.patch.receipt.sourceCommit : "")],
    ["Release approval", result.isolatedRelease.approval.status],
    ["Release signing", result.isolatedRelease.signing.status],
    ["Independent release verifier", result.isolatedRelease.verifier.status],
    ["Disposable release inventory", result.disposableTarget.status],
    ["Existing OpsTruth MCP", result.existingOpsTruth.status],
    ["Actual release verification", result.releaseV1Outcome],
    ["External installations", result.externalAdoption],
  ];
  return [
    "## AgentProof read-only authority readiness",
    "",
    "Observation: " + result.observedAt + " UTC — **" + result.overall + "**",
    "",
    "| Check | Observed status |",
    "| --- | --- |",
    ...entries.map(([a, b]) => "| " + a + " | " + b + " |"),
    "",
    "No release, GitHub write, signing key, deployment, source pin, or customer state was modified.",
    "",
    "Track source drift: https://github.com/AyobamiH/agentproof/issues/17",
    "Track release consequence: https://github.com/AyobamiH/donestate/issues/193",
    "Track independent adoption: https://github.com/AyobamiH/agentproof/issues/14",
    "",
  ].join("\n");
}
