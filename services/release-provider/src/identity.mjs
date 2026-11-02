import { createRemoteJWKSet, jwtVerify } from "jose";

export class ReleaseRefusal extends Error {
  constructor(code, status = 403) { super(code); this.code = code; this.status = status; }
}
// Bounded public transport metadata; never include upstream bodies or credentials.
export class PublicReadbackRefusal extends ReleaseRefusal {
  constructor(endpoint, response) {
    super("public_readback_unavailable", 503);
    const numberHeader = name => {
      const value = response.headers.get(name);
      return typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : null;
    };
    if (!["repository", "tag", "release"].includes(endpoint)) throw new Error("readback_endpoint_invalid");
    this.readback = Object.freeze({ endpoint, upstreamStatus: response.status,
      rateLimitRemaining: numberHeader("x-ratelimit-remaining"),
      rateLimitReset: numberHeader("x-ratelimit-reset"),
      retryAfterSeconds: numberHeader("retry-after") });
  }
}
export function demand(condition, code, status = 403) {
  if (!condition) throw new ReleaseRefusal(code, status);
}
const issuer = "https://token.actions.githubusercontent.com";
const jwks = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks"), {
  timeoutDuration: 5000, cacheMaxAge: 300_000,
});
export const CANARY_REPOSITORY = "AyobamiH/agentproof-release-canary";
export const CANARY_REPOSITORY_ID = "1423718326";
export const OWNER_ID = "47716486";
export const WORKFLOW = CANARY_REPOSITORY + "/.github/workflows/release-canary.yml@refs/heads/main";
export const SUBJECT = "repo:AyobamiH@47716486/agentproof-release-canary@1423718326:environment:agentproof-release-canary";
export function validateClaims(claims, env) {
  demand(env.ENABLED === "true" && /^[0-9a-f]{40}$/.test(env.TRUSTED_SOURCE_SHA) &&
    !/^0+$/.test(env.TRUSTED_SOURCE_SHA), "provider_disabled", 503);
  const expected = {
    repository: CANARY_REPOSITORY, repository_id: CANARY_REPOSITORY_ID,
    repository_owner_id: OWNER_ID, actor_id: OWNER_ID,
    ref: "refs/heads/main", event_name: "workflow_dispatch",
    runner_environment: "github-hosted", workflow_ref: WORKFLOW,
    workflow_sha: env.TRUSTED_SOURCE_SHA, sha: env.TRUSTED_SOURCE_SHA,
    sub: SUBJECT,
  };
  for (const [name, value] of Object.entries(expected)) demand(claims[name] === value, "workload_rejected");
  demand(/^\d{1,20}$/.test(claims.run_id) && /^[1-9]\d{0,3}$/.test(claims.run_attempt),
    "workload_rejected");
  return { run_id: claims.run_id, run_attempt: claims.run_attempt };
}
export async function authenticate(request, env, resolver = jwks) {
  const header = request.headers.get("authorization");
  demand(header?.startsWith("Bearer ") && header.length < 16_384, "authentication_required", 401);
  let payload;
  try {
    ({ payload } = await jwtVerify(header.slice(7), resolver, {
      issuer, audience: env.AUDIENCE, algorithms: ["RS256"],
      maxTokenAge: "10m", clockTolerance: 5,
      requiredClaims: ["exp", "iat", "nbf", "jti"],
    }));
  } catch { throw new ReleaseRefusal("authentication_rejected", 401); }
  return validateClaims(payload, env);
}
export function githubToken(request) {
  const token = request.headers.get("x-github-token");
  demand(typeof token === "string" && token.length >= 8 && token.length <= 4096 &&
    /^[\x21-\x7e]+$/.test(token), "scoped_github_token_required", 401);
  return token;
}
