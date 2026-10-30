import { recoveryPolicy, validateRecoveryGrant, validateRecordedRecoveryGrant } from "./recovery.mjs";
import { digest, stableJson } from "../../../dist/hash.js";
import { validateReleaseObservation } from "../../../dist/release-v1-contract.js";
import { authenticate, githubToken, demand, ReleaseRefusal, PublicReadbackRefusal } from "./identity.mjs";
import { strictBody, readTarget, privateKey, provider, validateSeed,
  decision, validateSignedRequest, signCompletion, validateCompletion,
  verifiedReceipt, targetScope, policy, reservationEvidence } from "./policy.mjs";

function reply(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { "content-type": "application/json",
      "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
function failure(error) {
  if (error instanceof PublicReadbackRefusal)
    return reply({ error: error.code, readback: error.readback }, error.status);
  if (error instanceof ReleaseRefusal) return reply({ error: error.code }, error.status);
  if (error instanceof Error && error.message.startsWith("release_v1:")) {
    return reply({ error: "release_policy_rejected" }, 403);
  }
  return reply({ error: "release_provider_unavailable" }, 503);
}
async function bodyOf(request) {
  demand(request.headers.get("content-type")?.split(";")[0]?.trim() === "application/json",
    "json_required", 415);
  demand(request.body, "body_required", 400);
  const chunks = []; let size = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      demand(size <= 64 * 1024, "body_too_large", 413);
      chunks.push(part.value);
    }
    return strictBody(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { void reader.cancel().catch(() => {}); }
}
export async function handle(request, env, auth = authenticate) {
  try {
    const url = new URL(request.url);
    demand(!url.search, "query_not_allowed", 400);
    if (request.method === "GET" && url.pathname === "/health") {
      return reply({ service: "agentproof-release-canary", role: env.ROLE,
        enabled: env.ENABLED === "true", custody: "cloudflare-encrypted-worker-secret",
        sourceCommit: env.TRUSTED_SOURCE_SHA, trustedWorkflowCommit: env.TRUSTED_SOURCE_SHA,
        serviceSourceCommit: env.SERVICE_SOURCE_SHA ?? null, recoveryRequired: env.RECOVERY_REQUIRED === "true", targetConfigured: !!env.TARGET_SUBJECT_JSON });
    }
    demand(env.ROLE === "approval" || env.ROLE === "signing", "role_invalid", 503);
    const paths = env.ROLE === "approval" ?
      ["/v1/prepare", "/v1/activate", "/v1/execute", "/v1/reconcile"] : ["/v1/sign"];
    demand(request.method === "POST" && paths.includes(url.pathname), "route_not_found", 404);
    const claims = await auth(request, env);
    // A receipt signer never receives the caller's release-write credential.
    demand(env.ROLE !== "signing" || !request.headers.has("x-github-token"),
      "signer_must_not_receive_publisher_token", 403);
    const token = env.ROLE === "approval" ? githubToken(request) : null;
    const body = await bodyOf(request);
    const seed = url.pathname === "/v1/prepare" ? body.seed : (
      url.pathname === "/v1/sign" ? body.request : body.request
    );
    const subject = url.pathname === "/v1/prepare" ?
      validateSeed(seed, claims, env) : validateSignedRequest(seed, claims, env,
        { historical: url.pathname !== "/v1/execute" }).subject;
    // Only the exact target gets a durable object. Each external release ID
    // has ONE permanent fence that cannot expire and reissue a publication.
    const id = (env.ROLE === "approval" ? env.RELEASE_LEDGER : env.RECEIPT_LEDGER)
      .idFromName(targetScope(subject));
    const ledger = env.ROLE === "approval" ? env.RELEASE_LEDGER : env.RECEIPT_LEDGER;
    return ledger.get(id).fetch(new Request("https://fence.internal" + url.pathname, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ body, claims, token }),
    }));
  } catch (error) { return failure(error); }
}
export default { fetch(request, env) { return handle(request, env); } };

function sameSeed(record, seed) {
  demand(digest(record.seed) === digest(seed), "release_target_already_claimed", 409);
}
function once(storage, callback) {
  return storage.transactionSync(callback);
}
export class ReleaseFence {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.storage = ctx.storage; }
  get() { return this.storage.kv.get("release"); }
  set(record) { this.storage.kv.put("release", record); }
  async prepare(seed, claims, token) {
    validateSeed(seed, claims, this.env);
    const previous = this.get();
    if (previous) {
      sameSeed(previous, seed);
      return { state: previous.state, request: { ...previous.seed, approval: previous.approval },
        reservation: previous.state === "reserved" ? previous.reservation ?? null : null };
    }
    const before = await provider(seed.subject, token).observe(seed.subject);
    validateReleaseObservation(before, seed.subject, false);
    // The outer read can interleave; claim, nonce, target and decision are
    // committed together in one serializable Durable Object transaction.
    const record = once(this.storage, () => {
      const current = this.get();
      if (current) { sameSeed(current, seed); return current; }
      const approval = decision(seed, this.env);
      const reservation = reservationEvidence(seed, approval, claims, this.env);
      const value = { state: "reserved", seed, approval, before, reservation,
        recoveryPolicy: recoveryPolicy(this.env), recoveryAuthorisation: null,
        attemptedAt: null, verifiedAt: null, after: null, completion: null, publicationResponse: null };
      this.set(value);
      return value;
    });
    return { state: record.state, request: { ...record.seed, approval: record.approval },
      reservation: record.state === "reserved" ? record.reservation ?? null : null };
  }
  async observeAndSettle(seed, token, claims) {
    let record = this.get();
    sameSeed(record, seed);
    if (record.state === "attempted" || record.state === "verified")
      validateRecordedRecoveryGrant(record, claims, this.env);
    if (record.state === "verified") return { state: record.state, completion: record.completion, publicationResponse: record.publicationResponse ?? null };
    if (record.state !== "attempted") return { state: record.state, completion: null };
    let after;
    try {
      after = await provider(seed.subject, token).observe(seed.subject);
      validateReleaseObservation(after, seed.subject, true);
    } catch {
      return { state: "attempted", completion: null, reason: "effect_ambiguous",
        publicationResponse: this.get().publicationResponse ?? null };
    }
    const settled = once(this.storage, () => {
      const current = this.get();
      sameSeed(current, seed);
      if (current.state === "verified") return current;
      demand(current.state === "attempted" && current.attemptedAt,
        "invalid_effect_transition", 409);
      const next = { ...current, state: "verified", after,
        verifiedAt: new Date().toISOString() };
      next.completion = signCompletion(next, this.env);
      this.set(next);
      return next;
    });
    return { state: settled.state, completion: settled.completion, publicationResponse: settled.publicationResponse ?? null };
  }
  activate(request, grant, claims) {
    const {seed}=validateSignedRequest(request,claims,this.env);
    return once(this.storage,()=>{
      const record=this.get();demand(record,"approval_reservation_missing");sameSeed(record,seed);
      demand(stableJson(record.approval)===stableJson(request.approval),"approval_not_reserved");
      if(record.recoveryAuthorisation) {
        demand(digest(record.recoveryAuthorisation)===digest(grant),"recovery_grant_changed");
        return {state:record.state,recoveryAuthorisationDigest:digest(record.recoveryAuthorisation)};
      }
      demand(record.state==="reserved","recovery_after_attempt_forbidden",409);
      validateRecoveryGrant(grant,record,claims,this.env);
      this.set({...record,recoveryAuthorisation:grant});
      return {state:"reserved",recoveryAuthorisationDigest:digest(grant)};
    });
  }
  async execute(request, claims, token) {
    const { seed } = validateSignedRequest(request, claims, this.env);
    const previous = this.get();
    demand(previous, "approval_reservation_missing", 403);
    sameSeed(previous, seed);
    demand(stableJson(previous.approval) === stableJson(request.approval),
      "approval_not_reserved", 403);
    if (previous.state !== "reserved") return this.observeAndSettle(seed, token, claims);
    demand(stableJson(previous.recoveryPolicy ?? null)===stableJson(recoveryPolicy(this.env)),
      "recovery_policy_changed");
    if(previous.recoveryPolicy) {
      demand(previous.recoveryAuthorisation,"recovery_authorisation_required");
      validateRecoveryGrant(previous.recoveryAuthorisation,previous,claims,this.env);
    }
    // Verify pre-state before permanently marking the ONE allowed attempt.
    const current = await provider(seed.subject, token).observe(seed.subject);
    validateReleaseObservation(current, seed.subject, false);
    demand(stableJson(current) === stableJson(previous.before),
      "prepublication_state_changed", 409);
    // Persist the attempt before crossing the external GitHub write boundary.
    const claimed = once(this.storage, () => {
      const record = this.get();
      sameSeed(record, seed);
      if (record.state !== "reserved") return false;
      this.set({ ...record, state: "attempted", attemptedAt: new Date().toISOString() });
      return true;
    });
    if (!claimed) return this.observeAndSettle(seed, token, claims);
    const publisher = provider(seed.subject, token);
    try {
      // Exactly one GitHub PATCH in the entire lifetime of this target fence.
      await publisher.publishDraft(seed.subject);
    } catch {
      // Lost response can mean that GitHub already published the release.
      // Never mutate again; inspect provider state and settle when observable.
    } finally {
      // Preserve the exact bounded response body and request ID when received.
      // A lost response remains null, never a fabricated success response.
      if (publisher.publicationResponse) once(this.storage, () => {
        const record = this.get();
        sameSeed(record, seed);
        this.set({ ...record, publicationResponse: publisher.publicationResponse });
      });
    }
    return this.observeAndSettle(seed, token, claims);
  }
  async fetch(request) {
    try {
      const { body, claims, token } = await request.json();
      const path = new URL(request.url).pathname;
      if (path === "/v1/prepare") return reply(await this.prepare(body.seed, claims, token));
      if (path === "/v1/activate") return reply(this.activate(body.request,body.recoveryAuthorisation,claims));
      if (path === "/v1/execute") return reply(await this.execute(body.request, claims, token));
      demand(path === "/v1/reconcile", "route_not_found", 404);
      const { seed } = validateSignedRequest(body.request, claims, this.env, { historical: true });
      return reply(await this.observeAndSettle(seed, token, claims));
    } catch (error) { return failure(error); }
  }
}
export class ReleaseReceiptLedger {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.storage = ctx.storage; }
  async fetch(request) {
    try {
      const { body, claims, token } = await request.json();
      demand(new URL(request.url).pathname === "/v1/sign", "route_not_found", 404);
      const { request: signedRequest, completion } = body;
      validateSignedRequest(signedRequest, claims, this.env, { historical: true });
      validateCompletion(completion, signedRequest, this.env);
      const semantic = digest({ requestDigest: digest(signedRequest), completion: digest(completion) });
      const existing = this.storage.kv.get("receipt");
      if (existing) {
        demand(existing.semantic === semantic, "receipt_target_already_bound", 409);
        return reply({ state: "signed", receipt: existing.receipt });
      }
      // Independent signer performs an extra fresh GitHub read and never signs
      // a mere caller assertion that the release is published.
      const receipt = await verifiedReceipt({
        request: signedRequest, completion, env: this.env,
      });
      const saved = once(this.storage, () => {
        const current = this.storage.kv.get("receipt");
        if (current) {
          demand(current.semantic === semantic, "receipt_target_already_bound", 409);
          return current;
        }
        const value = { semantic, receipt };
        this.storage.kv.put("receipt", value);
        return value;
      });
      return reply({ state: "signed", receipt: saved.receipt });
    } catch (error) { return failure(error); }
  }
}
