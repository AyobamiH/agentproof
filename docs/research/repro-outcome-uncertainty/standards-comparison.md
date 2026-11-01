# Standards-first comparison: do we actually need a new evidence contract?

**Dated analysis:** 1 November 2026. **Status:** research hypothesis, not a standards proposal, new schema, implementation plan or claim of originality.

The subject is deliberately narrow: an authorised agent requested a non-idempotent provider action; the external system might have committed it; the caller lost the acknowledgement; a separate observer must decide what, if anything, can be truthfully verified. The accompanying eight-test [fixture reproduction](README.md) evaluates local behaviour with a synthetic provider. It is not a field test of the standards listed below.

## Prior art and what each component already covers

| Existing mechanism | What it can represent / establish when implemented correctly | What it does not establish by itself | Candidate reuse rather than rebuilding |
| --- | --- | --- | --- |
| **in-toto Attestation Framework v1.2 (`Statement/v1`, predicate, envelope, bundle)** | Authenticated metadata about a digest-bound subject; type-identified statements; interoperable policy consumption. The envelope handles signature verification and can use DSSE. | That the predicate's factual claim was independently observed; whether an external provider committed an effect; whether the signer had transaction authority at the moment of execution. | Represent a verification result as a *well-defined predicate* with source/subject and exact verifier trust policy, if a real interoperability use case needs it. Do not invent another envelope/signature scheme. |
| **DSSE / Sigstore Cosign verification** | Authentication and binding of signed payload bytes, signer identity when the verifier applies an appropriate key/certificate/issuer policy, plus optional transparency-log evidence. | That an external publication or payment occurred because somebody signed a sentence saying it did. A signed false statement is still signed. | Reuse for portable signing/verification if integration is actually demanded. Do not reimplement DSSE or replace AgentProof's existing Receipt V2 as an unrelated task. |
| **OpenTelemetry GenAI/tool spans** | Observability of caller-side inference/agent/tool invocation, span relationships, durations, errors and tool-call metadata. `execute_tool` is defined, with GenAI conventions still marked Development as checked. | An authoritative provider-side settlement, independent identity binding, forensic completeness after sampling or lost telemetry, or an authenticated proof-of-outcome. | Correlate an attempt/trace with evidence IDs, without treating a green span as provider commitment. Redact tool arguments and secrets by default. |
| **W3C PROV-DM / PROV-O** | A common vocabulary of entities, activities, agents, usage, generation, attribution and derivation. Relations can explain *who reported what about the causal history*. | That recorded assertions are factual or cryptographically authenticated. An asserted `wasGeneratedBy` relation is not an independent postcondition check. | Express provenance relations when exchanging evidence, not as a replacement for observations and trust decisions. |
| **IETF HTTPAPI `Idempotency-Key` Internet-Draft -08 (22 October 2026)** | A proposed header and server/client responsibilities for safe retries of non-idempotent HTTP operations, subject to each resource's published policy and fingerprint/key handling. | Universal exactly-once guarantees, server implementation, retention beyond the provider's window, or certain knowledge after unobservable effects. This was **an active draft, not an RFC**, as checked on 1 November. | Honour provider-supported idempotency semantics. Do not claim a client-supplied key works when the provider does not support it. |
| **Provider-owned read-only GET/lookup** | A bounded observation of the *provider's current reported state*, when identities, assets, digests, status, timestamps and authority are checked. | Atomicity with a previous write, freshness across eventual consistency, immutable target state, or proof when read permission is missing. | Use exact-subject readback wherever possible; preserve `unknown` when not possible. |
| **AgentProof's existing controller + signed Receipt V2** | In the tested fixture: durable intent, at-most-one simulated write attempt, subject-bound authority, signer pinning, reconciliation, and a signed claim whose `independentOutcomeVerified` flag remains false. | Independent external adoption or real provider proof for the source-only `release.v1` experiment; broad distributed exactly-once execution. | Keep its current source and trust boundaries. Compare a future portable adapter **only if** cross-project observations reveal a need. |

## Primary specifications checked

1. [in-toto Attestation Framework specification](https://github.com/in-toto/attestation/blob/main/spec/README.md) — four layers, current v1.2; [`Statement/v1` subject/predicate binding](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md); [authentication envelope](https://github.com/in-toto/attestation/blob/main/spec/v1/envelope.md). The v1 `_type` identifies a standard statement with digest-bound artifact subjects.
2. [Sigstore Cosign in-toto verification](https://docs.sigstore.dev/cosign/verifying/attestation/) and [Sigstore verification overview](https://docs.sigstore.dev/quickstart/quickstart-cosign/) — identity/signature/trust/policy; neither claims a signed predicate was inherently truthful.
3. [OpenTelemetry GenAI spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md) and [agent/tool span refinements](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md) — `execute_tool`, errors, agent and tool correlations, content-capture warnings; status **Development**.
4. [W3C PROV overview](https://www.w3.org/TR/prov-overview/) and [PROV-O namespace](https://www.w3.org/ns/prov) — PROV-DM/PROV-O W3C Recommendations; the overview itself is a 2013 Working Group Note.
5. [IETF HTTPAPI Idempotency-Key draft -08](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/) — dated 22 October 2026; **work in progress** rather than a final RFC. Check the latest draft before future publication.

These sources describe different layers and are not automatically competitors. No conformance tests against them were executed by the AgentProof fixture. An example mapping is **not** evidence that any project implements in-toto, DSSE, OpenTelemetry or PROV.

## Distinguish the states that tend to be collapsed

Consider one exact GitHub draft release target, bounded to numeric owner/repository/release IDs, tag/commit and two asset digests:

| Observation | Safest outcome label | Why |
| --- | --- | --- |
| Signed authorisation exists; no attempted effect | `AUTHORISED_ONLY` | Authority is not execution. |
| Mutation was attempted and response was lost; independent GET unavailable | `EFFECT_UNKNOWN` | Neither success nor failure can be inferred. Blind retry could duplicate the effect. |
| Provider GET returns matching target fields and published state; signer unavailable | `OBSERVED_NOT_SIGNED` | An observation exists, but a trusted signed record is not yet available. |
| Signed receipt validates, but verified outcome flag remains false | `SIGNED_CLAIM_ONLY` | Signer identity and payload integrity do not certify a separate verifier's observation. |
| Signed receipt and fresh read-only provider observation match, with pinned subject and trusted verifier | `BOUND_OBSERVATION` | Stronger scoped evidence; still limited by provider eventual consistency and policy. |
| Independent verifier explicitly evaluates the exact subject and acceptance policy | `INDEPENDENTLY_VERIFIED_IN_SCOPE` | The decision is valid only for its stated subject, time, evidence set, identities and policy. |
| Evidence contradicts the target or exact asset digests | `CONTRADICTED` | Report the mismatch; do not transform it into success via signature validity. |

**These labels are explanatory vocabulary for discussion only**, not new AgentProof states or a proposed wire schema. In the existing source, the actual `ReleaseV1Controller` states and result fields remain authoritative.

## Candidate minimal interoperability *question* (not a proposed product)

Suppose two independent agents exchange an evidence bundle. Before introducing a proprietary contract, ask whether an existing in-toto statement (subject, predicateType, predicate), signed with a trusted DSSE-compatible envelope, together with trace correlation and a separate verifiable provider readback, is sufficient.

If not, identify the **specific failed consumer decision** and missing information:

- Exact subject identity, immutable commit/artifact digests and permitted authority for the effect.
- Transaction/idempotency key, **provider-documented** uniqueness policy, retention and readback guarantees.
- Effect-intent and last known provider-attempt state, including `EFFECT_UNKNOWN`.
- Independent observer identity, trust policy, observation timestamp and exact readback evidence.
- Signer identity/key rotation and authenticated attestation envelope.
- Freshness, contradictory evidence, unavailable readback, and explicit limits of acceptance.

Treat those as comparison questions, not a schema definition. A new predicate/type should be justified by actual interoperating consumers and negative controls, **not** by the ability to render a prettier JSON example.

## Falsifiable decisions before any integration

**No-go for new common runtime/protocol:** in-toto/DSSE + OpenTelemetry + provider idempotency/readback already express the needed observation and trust decision without ambiguous statuses; the consumer can verify it independently.

**Possible go for a *small adapter* only:** at least one external engineer provides a reproducible case where independent consumers cannot reach the correct decision using existing standards and provider APIs, while a minimal documented conversion resolves that issue without new authority or a central service.

**Unresolved:** claims that require private Post-Once provider receipts or real `release.v1` signing-recovery acceptance cannot be made independently reproducible by this fixture. The separate AgentProof release target is permanently fenced and must **not** be republished just to fill that gap.

## Precise discussion challenge

What read-only observation and trust policy would you require to move from **`SIGNED_CLAIM_ONLY`** to **`INDEPENDENTLY_VERIFIED_IN_SCOPE`** after an acknowledgement is lost? Can an in-toto attestation + independently verified provider GET encode it sufficiently, or is one field/predicate materially missing? Please show a code-level counterexample, ideally one that fails closed without duplicate effects.

Reply to [Proof & State Discussion #44](https://github.com/AyobamiH/proof-and-state/discussions/44). A well-reasoned *“existing standards are sufficient; do not integrate”* is a valuable research result.
