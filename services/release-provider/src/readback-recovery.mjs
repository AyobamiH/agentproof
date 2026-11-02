import { createPublicKey, sign, verify } from "node:crypto";
import { digest, stableJson } from "../../../dist/hash.js";
import { publicKeyFingerprint } from "../../../dist/signer.js";
import { exactKeys, releaseTime, validateReleaseApproval, validateReleaseObservation }
  from "../../../dist/release-v1-contract.js";
import { demand, PublicReadbackRefusal, ReleaseRefusal } from "./identity.mjs";
import { readTarget, seedFromRequest, validateBoundSeed, policy, privateKey,
  validateCompletion, publicReleaseReadback, verifiedReceipt, strictBody, targetScope }
  from "./policy.mjs";
import { recoveryPolicy, validatePersistedRecoveryAuthority } from "./recovery.mjs";

export const READBACK_SCHEMA = "agentproof.release-readback-attestation.v1";
export const READBACK_DOMAIN = READBACK_SCHEMA + "\0";
const HEX64 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function readbackConfiguration(env) {
  const subject = readTarget(env, { recovery: true });
  const required = recoveryPolicy(env);
  demand(required && required.runId === env.READBACK_RECOVERY_RUN_ID &&
    UUID.test(env.READBACK_RECOVERY_RUN_ID) && UUID.test(env.READBACK_RECOVERY_TRANSACTION_ID) &&
    /^[1-9]\d{0,19}$/.test(env.READBACK_RECOVERY_GITHUB_RUN_ID) &&
    /^[a-f0-9]{40}$/.test(env.TRUSTED_SOURCE_SHA) && !/^0+$/.test(env.TRUSTED_SOURCE_SHA) &&
    HEX64.test(env.READBACK_RECOVERY_COMPLETION_DIGEST) &&
    HEX64.test(env.READBACK_RECOVERY_AUTHORISATION_DIGEST), "readback_recovery_unconfigured", 503);
  return { subject, runId: env.READBACK_RECOVERY_RUN_ID,
    transactionId: env.READBACK_RECOVERY_TRANSACTION_ID,
    githubRunId: env.READBACK_RECOVERY_GITHUB_RUN_ID,
    subjectDigest: digest(subject),
    recoveryAuthorisationDigest: env.READBACK_RECOVERY_AUTHORISATION_DIGEST };
}

function historicalRequest(request, env) {
  const configured = readbackConfiguration(env);
  exactKeys(request, ["stateDirectory", "transactionId", "nonce", "idempotencyKey",
    "subject", "approval"], "readback_request_shape");
  validateBoundSeed(seedFromRequest(request), configured.githubRunId, env, { recovery: true });
  demand(request.transactionId === configured.transactionId, "readback_transaction_changed");
  validateReleaseApproval(request.approval, request, policy(env, configured.subject), Date.now(), true);
  return configured;
}

function historicalCompletion(completion, request, env) {
  validateCompletion(completion, request, env, { historical: true });
  demand(digest(completion) === env.READBACK_RECOVERY_COMPLETION_DIGEST &&
    completion.recoveryAuthorisationDigest === env.READBACK_RECOVERY_AUTHORISATION_DIGEST,
    "readback_predecessor_changed");
}

export function validateReadbackObservation(observation, request, completion, env, now = Date.now()) {
  const configured = historicalRequest(request, env);
  historicalCompletion(completion, request, env);
  exactKeys(observation, ["schema", "runId", "transactionId", "requestDigest", "subjectDigest",
    "githubRunId", "workflowCommit", "completionDigest", "recoveryAuthorisationDigest",
    "observedAt", "expiresAt", "after", "readOnly", "authorityPublicKeyPem", "signatureBase64"],
  "readback_observation_shape");
  demand(observation.schema === READBACK_SCHEMA && observation.readOnly === true &&
    observation.runId === configured.runId && observation.transactionId === configured.transactionId &&
    observation.requestDigest === digest(request) && observation.subjectDigest === configured.subjectDigest &&
    observation.githubRunId === configured.githubRunId && observation.workflowCommit === env.TRUSTED_SOURCE_SHA &&
    observation.completionDigest === digest(completion) &&
    observation.recoveryAuthorisationDigest === configured.recoveryAuthorisationDigest,
    "readback_observation_binding");
  const observed = releaseTime(observation.observedAt), expires = releaseTime(observation.expiresAt);
  demand(observed >= releaseTime(completion.verifiedAt) && observed <= now + 30000 &&
    observed >= now - 300000 && expires > now && expires > observed && expires - observed <= 300000,
    "readback_observation_expired");
  validateReleaseObservation(observation.after, configured.subject, true);
  demand(stableJson(observation.after) === stableJson(completion.after), "readback_observation_changed");
  const key = createPublicKey(observation.authorityPublicKeyPem);
  const expected = env.ROLE === "approval" ? env.SIGNER_FINGERPRINT : env.AUTHORITY_FINGERPRINT;
  demand(key.asymmetricKeyType === "ed25519" &&
    publicKeyFingerprint(observation.authorityPublicKeyPem) === expected,
    "readback_observation_signer");
  const { signatureBase64, ...unsigned } = observation;
  demand(typeof signatureBase64 === "string" && /^[A-Za-z0-9+/]{86}==$/.test(signatureBase64) &&
    Buffer.from(signatureBase64, "base64").toString("base64") === signatureBase64 &&
    verify(null, Buffer.from(READBACK_DOMAIN + stableJson(unsigned)), key,
      Buffer.from(signatureBase64, "base64")), "readback_observation_signature");
  return unsigned;
}

function existingExecution(storage, env, input) {
  const { subject, ...binding } = readbackConfiguration(env);
  exactKeys(input, Object.keys(binding), "readback_resume_shape");
  demand(stableJson(input) === stableJson(binding), "readback_resume_binding");
  const record = storage.kv.get("release");
  demand(record?.state === "verified" && record.completion, "readback_execution_completion_missing", 409);
  const request = { ...record.seed, approval: record.approval };
  historicalRequest(request, env);
  historicalCompletion(record.completion, request, env);
  const grant = validatePersistedRecoveryAuthority(record, env);
  demand(digest(grant) === binding.recoveryAuthorisationDigest &&
    record.reservation.githubRunId === binding.githubRunId &&
    record.reservation.workflowCommit === env.TRUSTED_SOURCE_SHA &&
    stableJson(record.after) === stableJson(record.completion.after), "readback_stored_authority_changed");
  return { record, request, subject };
}

export async function observeReadbackRecovery(storage, env, input) {
  demand(env.ROLE === "approval", "readback_role_rejected");
  const prior = existingExecution(storage, env, input);
  // Deliberately no publisher/provider object, credential, PATCH or activation.
  const after = await publicReleaseReadback(prior.subject);
  validateReleaseObservation(after, prior.subject, true);
  demand(stableJson(after) === stableJson(prior.record.completion.after), "readback_observation_changed");
  return storage.transactionSync(() => {
    const current = existingExecution(storage, env, input);
    demand(digest(current.record.completion) === digest(prior.record.completion), "readback_predecessor_changed");
    const now = Date.now();
    const unsigned = { schema: READBACK_SCHEMA, ...input,
      requestDigest: digest(current.request), workflowCommit: env.TRUSTED_SOURCE_SHA,
      completionDigest: digest(current.record.completion), observedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 300000).toISOString(), after, readOnly: true,
      authorityPublicKeyPem: env.SIGNING_PUBLIC_KEY_PEM };
    const observation = { ...unsigned, signatureBase64: sign(null,
      Buffer.from(READBACK_DOMAIN + stableJson(unsigned)), privateKey(env).key).toString("base64") };
    validateReadbackObservation(observation, current.request, current.record.completion, env, now);
    const previous = storage.kv.get("readbackRecovery");
    storage.kv.put("readbackRecovery", { observation,
      observationCount: (previous?.observationCount ?? 0) + 1,
      firstObservedAt: previous?.firstObservedAt ?? observation.observedAt });
    return { state: "verified", request: current.request, completion: current.record.completion,
      observation, publicationResponse: current.record.publicationResponse ?? null };
  });
}

export async function signReadbackRecovery(storage, env, input) {
  demand(env.ROLE === "signing", "readback_role_rejected");
  exactKeys(input, ["request", "completion", "observation"], "readback_sign_shape");
  const { request, completion, observation } = input;
  validateReadbackObservation(observation, request, completion, env);
  // Same immutable semantic as the original public signer. A refreshed sidecar
  // cannot create another receipt identity or change its execution timestamps.
  const semantic = digest({ requestDigest: digest(request), completion: digest(completion) });
  const existing = storage.kv.get("receipt");
  if (existing) {
    demand(existing.semantic === semantic, "receipt_target_already_bound", 409);
    return { state: "signed", receipt: existing.receipt };
  }
  const receipt = await verifiedReceipt({ request, completion, env, recoveryObservation: observation });
  const saved = storage.transactionSync(() => {
    const current = storage.kv.get("receipt");
    if (current) {
      demand(current.semantic === semantic, "receipt_target_already_bound", 409);
      return current;
    }
    const value = { semantic, receipt, recoveryObservationDigest: digest(observation) };
    storage.kv.put("receipt", value);
    return value;
  });
  return { state: "signed", receipt: saved.receipt };
}

export function readbackFailure(error) {
  return { state: "BLOCKED", signed: false,
    reasonCode: error instanceof ReleaseRefusal ? error.code :
      "readback_evidence_rejected",
    status: error instanceof ReleaseRefusal ? error.status : 403,
    ...(error instanceof PublicReadbackRefusal ? { diagnostic: error.readback } : {}) };
}

// The cloudflare:workers wrapper exposes this only through a named binding.
export async function recoveryRpc(env, operation, input) {
  try {
    strictBody(JSON.stringify(input));
    const { subject } = readbackConfiguration(env);
    demand((operation === "observe" && env.ROLE === "approval") ||
      (operation === "sign" && env.ROLE === "signing"), "readback_role_rejected");
    const namespace = operation === "observe" ? env.RELEASE_LEDGER : env.RECEIPT_LEDGER;
    const stub = namespace.get(namespace.idFromName(targetScope(subject)));
    const request = new Request("https://fence.internal/internal/readback-recovery-" + operation, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
    try {
      const response = await stub.fetch(request);
      return await response.json();
    } catch { throw new ReleaseRefusal("readback_provider_unavailable", 503); }
  } catch (error) { return readbackFailure(error); }
}
