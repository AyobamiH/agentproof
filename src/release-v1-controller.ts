import { digest } from "./hash.js";
import type { SigningProvider } from "./signer.js";
import { releaseAssert, validateReleaseRequest, validateReleaseObservation,
  type ReleaseV1Policy, type ReleaseV1Provider, type ReleaseV1Request } from "./release-v1-contract.js";
import { ReleaseV1Store, type ReleaseRecord } from "./release-v1-store.js";
import { releasePayload, signReleaseReceiptV2, type ReleaseV2Receipt } from "./release-v1-receipt.js";

export interface ReleaseResult {
  state: ReleaseRecord["state"];
  receipt: ReleaseV2Receipt | null;
  providerEffectAttempted: boolean;
  requiresOperatorReview: boolean;
}
/**
 * Source-only release candidate, isolated from the proven repository-patch runtime.
 * Exactly ONE GitHub draft-publication attempt; all subsequent calls are READ-ONLY
 * reconciliation or signer-only recovery. No automatic compensation of published releases.
 */
export class ReleaseV1Controller {
  readonly store: ReleaseV1Store;
  constructor(readonly policy: ReleaseV1Policy, readonly provider: ReleaseV1Provider,
    readonly signer: SigningProvider, stateDirectory: string) {
    this.store = new ReleaseV1Store(stateDirectory);
  }
  private result(record: ReleaseRecord): ReleaseResult {
    return { state: record.state, receipt: record.receipt,
      providerEffectAttempted: record.attemptedAt !== null,
      requiresOperatorReview: record.state === "escalation_required" ||
        record.state === "intent_recorded" || record.state === "publish_attempted" };
  }
  async execute(request: ReleaseV1Request): Promise<ReleaseResult> {
    validateReleaseRequest(request, this.policy);
    releaseAssert(request.stateDirectory === this.store.filePath.slice(0, -"agentproof-release-v1.sqlite".length - 1),
      "state_root_mismatch");
    const existing = this.store.get(request.transactionId);
    if (existing) {
      releaseAssert(existing.requestDigest === digest(request), "transaction_conflict");
      return this.reconcile(request.transactionId);
    }
    const before = await this.provider.observe(request.subject);
    validateReleaseObservation(before, request.subject, false);
    const { fresh, record } = this.store.claim(request, before);
    if (!fresh) return this.reconcile(request.transactionId);
    // A second read reduces stale-preflight races. The provider also re-reads
    // immediately before PATCH; no distributed CAS or exclusivity is implied.
    try {
      const current = await this.provider.observe(request.subject);
      validateReleaseObservation(current, request.subject, false);
    } catch {
      return this.result(this.store.transition(request.transactionId, "intent_recorded",
        "escalation_required", { errorCode: "pre_effect_state_changed_or_unavailable" }));
    }
    const attemptedAt = new Date().toISOString();
    this.store.transition(request.transactionId, "intent_recorded", "publish_attempted",
      { attemptedAt, errorCode: null });
    try {
      await this.provider.publishDraft(request.subject); // exactly one mutating call
    } catch {
      // An HTTP error or lost response may conceal a successful publication.
      // Never call publishDraft again. Read-only reconciliation is the only re-entry.
    }
    return this.reconcile(request.transactionId);
  }
  async reconcile(transactionId: string): Promise<ReleaseResult> {
    let record = this.store.get(transactionId);
    releaseAssert(record, "transaction_not_found");
    if (record.state === "signed" || record.state === "escalation_required" ||
        record.state === "intent_recorded") return this.result(record);
    if (record.state === "publish_attempted") {
      try {
        const after = await this.provider.observe(record.request.subject);
        // Only a precise, already published, exact-subject readback may advance.
        validateReleaseObservation(after, record.request.subject, true);
        const verifiedAt = new Date().toISOString();
        const payload = releasePayload({ request: record.request, before: record.before,
          after, attemptedAt: record.attemptedAt!, verifiedAt,
          signingPolicyId: this.policy.signerKeyId });
        record = this.store.transition(transactionId, "publish_attempted", "verified",
          { after, verifiedAt, payload, errorCode: null });
      } catch {
        // Unavailable, still draft, wrong tag, mismatched asset or unexpected
        // release state is never an excuse to perform another publication.
        return this.result(record);
      }
    }
    if (record.state === "verified") {
      releaseAssert(record.payload && record.after, "verified_record_corrupt");
      try {
        const receipt = await signReleaseReceiptV2(record.payload, this.signer, this.policy);
        record = this.store.transition(transactionId, "verified", "signed", { receipt });
      } catch {
        // Payload remains durable for signer-only retry without another effect.
        return this.result(this.store.get(transactionId) ?? record);
      }
    }
    return this.result(record);
  }
  status(transactionId: string): ReleaseResult {
    const record = this.store.get(transactionId);
    releaseAssert(record, "transaction_not_found");
    return this.result(record);
  }
}
