import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";

const schema = JSON.parse(await readFile(new URL("../../docs/adoption/install-record.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
export function validateRecord(record) {
  if (!validate(record)) throw new Error("invalid_adoption_record:" + validate.errors.map(e => e.instancePath + ":" + e.keyword).join(","));
  const start = Date.parse(record.startedAt), end = Date.parse(record.completedAt);
  const first = record.firstTrustedReceiptAt === null ? null : Date.parse(record.firstTrustedReceiptAt);
  if (end < start || (first !== null && (first < start || first > end))) throw new Error("invalid_observation_times");
  if ((record.outcomes.independentReceiptVerification === "PASS") !== (first !== null))
    throw new Error("receipt_time_outcome_mismatch");
  return record;
}
export function summariseRecords(records) {
  if (!Array.isArray(records) || records.length > 1000) throw new Error("bounded_record_array_required");
  const ids = new Set(), evidenceOwners = new Map(), candidates = new Map();
  let engineering = 0, independentAttempts = 0, failedAttempts = 0;
  const blockers = new Map(), requestedActions = new Map();
  for (const raw of records) {
    const r = validateRecord(raw);
    if (ids.has(r.recordId)) throw new Error("duplicate_record_id");
    ids.add(r.recordId);
    for (const evidence of r.rawEvidence) {
      const owner = evidenceOwners.get(evidence.sha256);
      if (owner && owner !== r.participantId) throw new Error("shared_evidence_requires_independence_review");
      evidenceOwners.set(evidence.sha256, r.participantId);
    }
    if (r.evidenceKind === "maintainer_engineering") { engineering++; continue; }
    independentAttempts++;
    if (Object.values(r.outcomes).includes("FAIL")) failedAttempts++;
    if (r.firstBlocker) blockers.set(r.firstBlocker, (blockers.get(r.firstBlocker) ?? 0) + 1);
    // Count distinct participants, not repeated records, for requested actions.
    if (r.nextProtectedAction) {
      if (!requestedActions.has(r.nextProtectedAction)) requestedActions.set(r.nextProtectedAction, new Set());
      requestedActions.get(r.nextProtectedAction).add(r.participantId);
    }
    const eligible = r.unfamiliarWithAgentProof && r.commandsAttempted.length > 0 &&
      ["installation","lifecycle","independentReceiptVerification","exactlyOnce","compensation"].every(k => r.outcomes[k] === "PASS") &&
      r.outcomes.criticalAmbiguity === false && Object.values(r.trustRoles).every(v => v === true);
    if (eligible && !candidates.has(r.participantId)) candidates.set(r.participantId, r);
  }
  const times = [...candidates.values()].map(r => Date.parse(r.firstTrustedReceiptAt) - Date.parse(r.startedAt)).sort((a,b) => a-b);
  const count = candidates.size;
  return {
    schema: "agentproof.adoption-summary.v1", records: records.length, engineeringRuns: engineering,
    independentAttempts, failedIndependentAttempts: failedAttempts, candidateIndependentInstallations: count,
    target: 10, remainingCandidateInstallations: Math.max(0, 10-count),
    gate: count >= 10 ? "INDEPENDENCE_REVIEW_REQUIRED" : "COLLECTING",
    independenceVerified: false, productionAuthorityProven: false,
    medianTimeToFirstReceiptMs: times.length ? (times[Math.floor((times.length-1)/2)] + times[Math.floor(times.length/2)]) / 2 : null,
    blockers: [...blockers].map(([observation, attempts]) => ({ observation, attempts })),
    requestedActions: [...requestedActions].map(([action, participants]) => ({ action, distinctParticipants: participants.size })),
    limitations: ["Records are supplied observations; evidence references and participant independence require review.",
      "Engineering runs never count toward independent adoption.", "No action or production authority is enabled by this report."],
  };
}
