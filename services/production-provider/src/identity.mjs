import { createRemoteJWKSet, jwtVerify } from "jose";
import { demand } from "./policy.mjs";

const issuer = "https://token.actions.githubusercontent.com";
const keys = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks"), { timeoutDuration: 5000, cacheMaxAge: 300_000 });
export function validateClaims(claims, env) {
  demand(env.ENABLED === "true" && /^[a-f0-9]{40}$/.test(env.TRUSTED_SOURCE_SHA) && !/^0+$/.test(env.TRUSTED_SOURCE_SHA), "provider_disabled", 503);
  const expected = {
    repository: "AyobamiH/agentproof", repository_id: "1317413810", repository_owner_id: "47716486",
    actor_id: "47716486", ref: "refs/heads/main", event_name: "workflow_dispatch", runner_environment: "github-hosted",
    workflow_ref: "AyobamiH/agentproof/.github/workflows/production-provider-canary.yml@refs/heads/main",
    workflow_sha: env.TRUSTED_SOURCE_SHA, sha: env.TRUSTED_SOURCE_SHA,
    sub: "repo:AyobamiH/agentproof:environment:agentproof-production-canary",
  };
  for (const [key, value] of Object.entries(expected)) demand(claims[key] === value, "workload_rejected", 403);
  demand(/^\d{1,20}$/.test(claims.run_id) && /^\d{1,4}$/.test(claims.run_attempt), "workload_rejected");
  return { run_id: claims.run_id, run_attempt: claims.run_attempt };
}
export async function authenticate(request, env, resolver = keys) {
  const value = request.headers.get("authorization");
  demand(value?.startsWith("Bearer ") && value.length < 16_384, "authentication_required", 401);
  let payload;
  try {
    ({ payload } = await jwtVerify(value.slice(7), resolver, { issuer, audience: env.AUDIENCE,
      algorithms: ["RS256"], maxTokenAge: "10m", clockTolerance: 5, requiredClaims: ["exp", "iat", "nbf", "jti"] }));
  } catch { demand(false, "authentication_rejected", 401); }
  return validateClaims(payload, env);
}
