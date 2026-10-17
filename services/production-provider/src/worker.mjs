import { authenticate } from "./identity.mjs";
import { MAX_BYTES, Rejection, demand, strictJson, identityScope, decideOnce, signOnce } from "./policy.mjs";

const response = (value, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
async function readBody(request) {
  demand(request.headers.get("content-type")?.split(";")[0].trim() === "application/json", "json_required", 415);
  demand(request.body, "body_required", 400);
  const reader = request.body.getReader(), chunks = [];
  let length = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 10_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      demand(length <= MAX_BYTES, "document_too_large", 413);
      chunks.push(value);
    }
    demand(!timedOut, "body_timeout", 408);
    return strictJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof Rejection) throw error;
    throw new Rejection("invalid_json", 400);
  } finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}
export async function handle(request, env, authenticateRequest = authenticate) {
  try {
    const url = new URL(request.url);
    demand(!url.search, "query_not_supported", 400);
    if (request.method === "GET" && url.pathname === "/health") return response({
      service: "agentproof-production-provider", role: env.ROLE, enabled: env.ENABLED === "true",
      custody: "cloudflare-encrypted-worker-secret", sourceCommit: env.TRUSTED_SOURCE_SHA,
    });
    const path = env.ROLE === "approval" ? "/v1/decisions" : "/v1/sign";
    demand(request.method === "POST" && url.pathname === path, "route_not_found", 404);
    const claims = await authenticateRequest(request, env);
    const body = await readBody(request);
    const id = env.LEDGER.idFromName(identityScope(claims));
    return await env.LEDGER.get(id).fetch(new Request("https://ledger.invalid/", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, claims }),
    }));
  } catch (error) {
    return response({ error: error instanceof Rejection ? error.code : "provider_unavailable" }, error instanceof Rejection ? error.status : 503);
  }
}
export default { fetch(request, env) { return handle(request, env); } };

export class ProviderLedger {
  constructor(state, env) { this.storage = state.storage; this.env = env; }
  async fetch(request) {
    try {
      const { body, claims } = await request.json();
      const result = this.env.ROLE === "approval" ? await decideOnce(this.storage, body, claims, this.env) :
        await signOnce(this.storage, body, claims, this.env);
      return response(result);
    } catch (error) {
      return response({ error: error instanceof Rejection ? error.code : "provider_unavailable" }, error instanceof Rejection ? error.status : 503);
    }
  }
}
