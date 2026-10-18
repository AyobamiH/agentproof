import { parseJsonStrict } from "./strict-json.js";
import { releaseAssert, validateReleaseObservation, validateReleaseSubject,
  type ReleaseV1Provider, type ReleaseV1Subject, type ReleaseV1Observation } from "./release-v1-contract.js";

export interface GitHubPublicationResponse {
  status: number; requestId: string | null; body: string;
}
export interface GitHubReleaseClientOptions {
  // Host injects a short-lived token. It is not logged or persisted.
  getToken: (signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
}
function id(value: unknown, code: string): number {
  releaseAssert(Number.isSafeInteger(value) && Number(value) > 0, code);
  return Number(value);
}
/** Convert GitHub's seconds-precision UTC timestamp at the provider boundary.
 * Signed protocol timestamps remain canonical millisecond-precision UTC. */
export function canonicalGitHubPublishedAt(value: unknown): string | null {
  if (value === null) return null;
  releaseAssert(typeof value === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value),
    "github_publication_time_invalid");
  const canonical = value.includes(".") ? value : value.slice(0, -1) + ".000Z";
  const time = Date.parse(canonical);
  releaseAssert(Number.isFinite(time) && new Date(time).toISOString() === canonical,
    "github_publication_time_invalid");
  return canonical;
}
export class GitHubReleaseV1Provider implements ReleaseV1Provider {
  readonly base: string;
  // Public response evidence only: never persist the publisher credential.
  publicationResponse: GitHubPublicationResponse | null = null;
  constructor(readonly subject: ReleaseV1Subject, readonly options: GitHubReleaseClientOptions) {
    validateReleaseSubject(subject);
    releaseAssert(typeof options.getToken === "function" && Number.isInteger(options.timeoutMs ?? 15000) &&
      (options.timeoutMs ?? 15000) >= 1000 && (options.timeoutMs ?? 15000) <= 30000, "github_config");
    this.base = "https://api.github.com/repos/" + subject.owner + "/" + subject.repository;
  }
  private async api(suffix: string, method: "GET" | "PATCH" = "GET",
    body?: Record<string, unknown>): Promise<Record<string, any>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15000);
    try {
      const token = await this.options.getToken(controller.signal);
      releaseAssert(typeof token === "string" && token.length >= 8 &&
        token.length <= 4096 && /^[\x21-\x7e]+$/.test(token) && !controller.signal.aborted,
        "github_token_unavailable");
      const response = await fetch(this.base + suffix, {
        method, redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { "accept": "application/vnd.github+json", "content-type": "application/json",
          "authorization": "Bearer " + token, "x-github-api-version": "2022-11-28",
          "user-agent": "agentproof-release-provider/1.0" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      releaseAssert(Number(response.headers.get("content-length") ?? 0) < 262144, "github_response_oversized");
      const reader = response.body?.getReader();
      releaseAssert(reader, "github_empty_response");
      const chunks: Uint8Array[] = []; let total = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.byteLength;
          releaseAssert(total <= 262144 && !controller.signal.aborted, "github_response_oversized");
          chunks.push(chunk.value);
        }
      } finally { void reader.cancel().catch(() => {}); }
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      releaseAssert(response.status === 200 && !response.redirected &&
        response.headers.get("content-type")?.includes("application/json"), "github_provider_unavailable");
      parseJsonStrict(raw);
      const parsed: unknown = JSON.parse(raw);
      releaseAssert(parsed && typeof parsed === "object" && !Array.isArray(parsed), "github_invalid_json");
      if (method === "PATCH") {
        const publication = parsed as Record<string, unknown>;
        releaseAssert(publication.id === this.subject.releaseId && publication.tag_name === this.subject.tagName &&
          publication.draft === false && publication.prerelease === true, "github_publish_response_unexpected");
        this.publicationResponse = {
          status: response.status, requestId: response.headers.get("x-github-request-id"), body: raw,
        };
      }
      return parsed as Record<string, any>;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("release_v1:")) throw error;
      throw new Error("release_v1:github_provider_unavailable");
    } finally { clearTimeout(timer); controller.abort(); }
  }
  private async tagCommit(): Promise<string> {
    const first = await this.api("/git/ref/tags/" + encodeURIComponent(this.subject.tagName));
    releaseAssert(first.ref === "refs/tags/" + this.subject.tagName &&
      typeof first.object?.sha === "string", "github_tag_ref_mismatch");
    if (first.object.type === "commit") return first.object.sha;
    releaseAssert(first.object.type === "tag" && /^[a-f0-9]{40}$/.test(first.object.sha), "github_tag_type");
    const annotated = await this.api("/git/tags/" + first.object.sha);
    releaseAssert(annotated.object?.type === "commit" && typeof annotated.object?.sha === "string", "github_tag_depth");
    return annotated.object.sha;
  }
  async observe(target: ReleaseV1Subject): Promise<ReleaseV1Observation> {
    validateReleaseSubject(target);
    releaseAssert(JSON.stringify(target) === JSON.stringify(this.subject), "provider_target_changed");
    const repo = await this.api("");
    releaseAssert(id(repo.id, "github_repo_id") === target.repositoryId &&
      id(repo.owner?.id, "github_owner_id") === target.ownerId &&
      repo.name === target.repository && repo.owner.login === target.owner, "github_repository_changed");
    const commit = await this.tagCommit();
    const release = await this.api("/releases/" + target.releaseId);
    releaseAssert(release.id === target.releaseId && release.tag_name === target.tagName &&
      typeof release.draft === "boolean" && typeof release.prerelease === "boolean" &&
      Array.isArray(release.assets) && release.assets.length === 2 && typeof commit === "string", "github_release_changed");
    const asset = release.assets.find((a: Record<string, unknown>) => a.id === target.packageAssetId);
    const provenance = release.assets.find((a: Record<string, unknown>) => a.id === target.provenanceAssetId);
    releaseAssert(asset?.name === target.packageAssetName && asset.state === "uploaded" &&
      provenance?.state === "uploaded" && typeof asset.digest === "string" &&
      typeof provenance.digest === "string", "github_assets_changed");
    const observation: ReleaseV1Observation = {
      schema: "agentproof.release.observation.v1", ownerId: repo.owner.id, repositoryId: repo.id,
      releaseId: release.id, tagName: release.tag_name, tagCommit: commit,
      packageAssetId: asset.id, packageAssetName: asset.name, packageDigest: asset.digest,
      provenanceAssetId: provenance.id, provenanceDigest: provenance.digest, assetCount: release.assets.length,
      draft: release.draft, prerelease: release.prerelease, publishedAt: canonicalGitHubPublishedAt(release.published_at),
    };
    // Preserve raw observation for the coordinator to distinguish draft vs published.
    validateReleaseObservation(observation, target, !observation.draft);
    return observation;
  }
  async publishDraft(target: ReleaseV1Subject): Promise<void> {
    // Re-read before the sole PATCH. No approval/signing keys are available to this adapter.
    const current = await this.observe(target);
    validateReleaseObservation(current, target, false);
    const result = await this.api("/releases/" + target.releaseId, "PATCH",
      { draft: false, prerelease: true, make_latest: "false" });
    releaseAssert(result.id === target.releaseId && result.tag_name === target.tagName &&
      result.draft === false && result.prerelease === true, "github_publish_response_unexpected");
  }
}
