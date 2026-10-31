# Outcome assurance: evidence-led foundation (31 October 2026)

**Status:** research/acceptance design, not a runtime activation, release, security certification, new product, or expansion of AgentProof's published RC6 API.

**Decision:** Keep **AgentProof** as the action-transaction/receipt product. Keep **DoneState** as the authorised executor and reconciler; **OpsTruth** as an independent read-only verifier; **Post-Once** as a separate operational publishing system and possible later source of *sanitised* fault cases. Do not create an "Outcome Gate" service, duplicate the state machine, merge signer and executor identities, or introduce a new database/control plane to deliver the first experiment.

## 1. Problem and falsifiable thesis

An agent/tool returning success is not proof that the intended external state exists. Nor does a cryptographically valid record of what a caller *said* happened establish that the external service committed the claimed effect. A late commit, lost acknowledgement, redelivery, inconsistent read path or signer outage can produce false-success claims, duplicate actions, and unresolvable uncertainty.

**Hypothesis:** Reusing AgentProof's transaction-bound authority and receipts together with independent OpsTruth postcondition verification makes a narrow real-world consequential workflow more trustworthy than model/harness self-reporting, without silently replaying ambiguous effects. Test it against an explicit fault corpus and independent provider state. Publish failures as carefully as successes.

**What could falsify or weaken it:** No material false-success/duplicate improvement over a simple provider-native idempotency/readback baseline; excessive verifier cost or latency; inability to support genuinely independent signing; or lack of useful external adoption. Findings should change the roadmap, not create a larger product by default.

A relevant research baseline is Li, *Where Does Exactly-Once Live?* (2026), https://arxiv.org/abs/2609.29095. A model and harness cannot manufacture provider-side idempotency. In particular, no verification-only policy guarantees exactly-once outcomes for unbounded late commits. Cloudflare's own Workflows rules also require API calls inside retried steps to be idempotent: https://developers.cloudflare.com/workflows/build/rules-of-workflows/.

## 2. Existing ownership and evidence (do not duplicate)

| Ownership | Existing proof | What it does NOT establish |
| --- | --- | --- |
| AgentProof | RC6 published; local repository-patch lifecycle; signed Receipt V2; durable SQLite; 17/17 exact-source hosted disposable patch canary | Arbitrary action authority, generic distributed exactly-once, HSM custody, ten independent installs |
| DoneState | Durable objective/authority state machine, sealed snapshot and versioned independent OpsTruth handoff; historical exact-PR VERIFIED canary | Permission for arbitrary merge, deploy or release; a completed release.v1 consequence |
| OpsTruth | Read-only exact-head verification with fail-closed schema, digest and signer requirements | A replacement for issuer-controlled execution, or a general proof of every external business effect |
| Post-Once | Real publishing receipts, idempotency/ambiguity guards, bounded GET-only reconciliation | Generic AgentProof transaction semantics, automatically transferable provider credentials or publication authority |

Existing sources: [AgentProof direction](../PROJECT-DIRECTION.md), [AgentProof roadmap](../ROADMAP.md), [AgentProof architecture](../ARCHITECTURE.md), [AgentProof security](../../SECURITY.md), [AgentProof adoption](../adoption/README.md), [DoneState architecture](https://github.com/AyobamiH/donestate/blob/main/docs/ARCHITECTURE.md), [DoneState v2 contract](https://github.com/AyobamiH/donestate/blob/main/docs/VERIFICATION-CONTRACT.md), [OpsTruth CI proof](https://github.com/AyobamiH/opstruth/blob/main/docs/github-actions-proof.md), [Post-Once state](https://github.com/AyobamiH/post-once/blob/main/docs/CURRENT_STATE.md).

**Live delivery baseline checked 31 October 2026:** AgentProof main at d599bf512613cfa71a8ed95cc718937d63b5080a, merged [#26](https://github.com/AyobamiH/agentproof/pull/26) only stages the zero-spend macOS CircleCI configuration, not a macOS run or replacement of existing required checks. [AgentProof #23](https://github.com/AyobamiH/agentproof/pull/23), [#24](https://github.com/AyobamiH/agentproof/pull/24) and [#25](https://github.com/AyobamiH/agentproof/pull/25) are unmerged candidates. Do not confuse their source/tests with deployed acceptance. [DoneState #193](https://github.com/AyobamiH/donestate/issues/193) remains the real independently verified release-consequence gate. [AgentProof #14](https://github.com/AyobamiH/agentproof/issues/14) reports zero *observed qualifying* independent installations.

The disposable release in GitHub run 39124373253 was published **once** according to [PR #23](https://github.com/AyobamiH/agentproof/pull/23), but receipt-signer public readback failed. [PR #24](https://github.com/AyobamiH/agentproof/pull/24) offers a recovery candidate. **Do not publish that target again** to manufacture a green end-to-end outcome. Preserve the original publication and all predecessor failure evidence.

## 3. Claim taxonomy and security model

Do not conflate four propositions:

1. **Authorised:** an issuer explicitly allowed a bounded exact transaction under its own policy.
2. **Executed/settled:** the controller has durable evidence of its attempt and local settlement; a locally successful command is not enough.
3. **Externally verified:** an independent, pinned, read-only verifier observes the exact target state, source SHA/tag, artifact bytes/provenance and relevant postconditions.
4. **Customer-useful:** a real external user confirms the outcome solves the intended job; this is product evidence, not a cryptographic property.

A signed receipt authenticates its bound payload under an explicitly trusted signer. It does not automatically attest independent provider observation. The executor must not be the independent verifier; self-issued evidence cannot promote DoneState to VERIFIED. For a failed read, unbounded in-flight effect, stale source, wrong signer or ambiguous provider commit, preserve failure/uncertainty; never infer success.

**Guarantee language:**
- Per-transaction/per-ledger replay prevention is not global provider exactly-once.
- An at-most-one *local* publication attempt does not imply exactly one external effect.
- A provider idempotency key only gives the provider's documented guarantees; it cannot be assumed for uncooperative APIs.
- Global uniqueness would additionally require an enforced target-wide fence, stable semantic identity and appropriately exclusive external write authority.
- If the effect might still commit and no sound provider read/contract can settle it, status remains uncertain; there is no safe generic retry.
- Business attribution, payment settlement and human acceptance require separate independent evidence.

Maintain existing state names and schemas. This document proposes no new public status enum, cryptographic format, key custody, protocol version, authority, or provider credentials.

## 4. First wedge: finish the already-started release.v1 chain

**Scope:** One previously authorised, disposable GitHub draft prerelease, pinned to numeric account/repository/release ID, exact tag/commit, immutable artifact and provenance digest. No new publication target, no customer package, no new publish API action, no merge/deploy/payment action.

**Critical path, with no authority expansion:**

1. Check current main and open PR relationships. Coordinate the diagnostics already included in AgentProof #24 with #23 to avoid double-merging/duplicating work. Bring #24 up to the protected main head and meet its required checks.
2. Restore actual independent signer **GET-only** readback for the already published target. Investigate real HTTP status, audience/identity, redirects, timeouts and permissions; do not weaken non-200 rejection, source/OIDC pins, recipient scope or expiry.
3. Recover using the original immutable completion and permanent target fence. No second PATCH or rewritten history; the distinct signer may issue a receipt only after independent exact readback.
4. Implement/activate only the separately scoped OpsTruth read-only release verifier specified by DoneState #193. Verify *downloaded bytes*, not just GitHub asset metadata; verify source/tag, target, provenance and signed subject; return a pinned independent decision.
5. Have DoneState accept the matching complete verified response to its original sealed run, or retain the honest terminal/uncertain state. Never promote a release based on an AgentProof execution log or receipt alone.
6. Treat native Cloudflare Linux CI (#25) and CircleCI macOS (#26) as separate gated infrastructure work. Preserve the existing exact required-check identities and PR protection until a real replacement run and readback justify a policy change. No paid upgrades or hidden GitHub Actions fallback.

No use of production secrets, elevation, user sign-in, publishing or policy changes is authorised by this research document itself.

## 5. Deterministic fault matrix (v1)

Every case must report: scenario ID; exact source and test/harness revision; intent and semantic effect identity; authority/fence; provider write count from authoritative instrumentation; provider final state or explicit unobservability; independent verifier decision; signed receipt state; status after restart; sanitised trace and reproduction command.

| ID | Injected condition | Required property |
| --- | --- | --- |
| F01 | Valid exact authority, one successful provider effect and independent read | Verified only after exact independently observed postconditions |
| F02 | Rejected or expired approval / wrong original request | Zero provider writes; no trusted receipt |
| F03 | Lost response after provider commits | No blind second effect; GET-only settlement; retained original attempt |
| F04 | Late commit after an inconclusive early read | No claim of exactly-once from the early read; uncertainty retained |
| F05 | Redelivered event, duplicate nonce/key, repeated signed grant | Existing same-target fence is respected; no replay under a new attempt |
| F06 | Two controllers racing one semantic target | No global uniqueness claim unless the target-wide fence and credential exclusivity are actually proven |
| F07 | Effect accepted but receipt signer unavailable/503 | Provider effect preserved; signer-only recovery; no publication replay |
| F08 | Signer receives altered/wrong target or stale evidence | No trusted signature or VERIFIED promotion |
| F09 | Verifier offline, 403, stale or incomplete data | AWAITING_VERIFICATION/uncertainty, never a manufactured pass |
| F10 | GitHub asset metadata agrees but independently downloaded bytes differ | External outcome verification fails |
| F11 | Wrong account/repository ID, tag, commit, provenance or source pin | Fail closed; never accept another subject's evidence |
| F12 | CI check skipped/stale, changed identity, or protected branch drift | Not accepted as exact-head validation |
| F13 | Redirect, rate limit, 5xx or malformed provider response | Bounded, redacted diagnostics; no unsupported automatic write retry |
| F14 | Tampered signature, key fingerprint, grant or receipt chain | Offline verification must reject |
| F15 | Crash between persistent effect-intent and network dispatch | No assumed effect; no unsafe replay; explicit reconciliation |
| F16 | Revoked authority / credentials during recovery | Read-only evidence where permitted; no renewed mutation authority |

Use disposable simulated provider fixtures first. Do not deliberately publish, charge, delete or retry a live external effect to populate the matrix. Existing AgentProof tests are not reclassified as independent adoption.

**Acceptance for the first public technical demonstration:**
- All applicable F01–F16 deterministic cases have recorded positive and negative results (a failure is reported, never discarded).
- Under the supported single-target fence, measured provider mutation count stays at most one across repeated attempts, restarts and signer outages; every exception is reported, not hidden.
- Zero false VERIFIED decisions in the known-negative fixture corpus.
- Original ambiguities and previous receipts remain immutable.
- One actual provider-readback outcome and one complete independent verifier decision are retained with exact immutable source, test run, receipts and trust references.
- Security, protection and credentials are unchanged except through separately authorised, independently evidenced changes.
- A clean external developer can reproduce the read-only verifier and fixture results without access to the owner's secrets.

Report counts, confidence limitations and reproduction commands; do not claim a universal exactly-once guarantee, statistical reliability from a small sample, or production readiness outside the tested subject.

## 6. Competitor and interoperability boundaries

- **Cloudflare Workflows/Agents** already provide durable steps and recovery, while their documentation still requires idempotent third-party API effects. Reuse them only where they replace existing custom mechanics without changing authority; no new harness dependency for this milestone.
- **Obsigna / Agent Receipts** already provides signed receipts, cross-language tests and an MCP proxy. Signed activity history is a complement, not an exclusive differentiator: https://github.com/agent-receipts/obsigna.
- **OpenTelemetry GenAI** standardises observable tool/agent spans, but a caller-side trace is not proof of a remote committed effect: https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md.
- **Qwenputer/model-internal computation** is interesting research but irrelevant to the release-effect/independent-verification critical path. Avoid expensive architecture-driven detours.

The differentiator to test is a reproducible **authority -> uncertain external effect -> reconciliation -> independently checked exact outcome -> portable trusted receipt** under real faults, not novelty of cryptography, schedulers, AI frameworks or signed logs.

## 7. Evidence, delivery gates, and forecasting assumptions

The estimates below are **planning ranges**, not a promise of future execution or account/provider approval. Assumes one senior full-time engineer assisted by automation, reuse of the existing codebase, zero paid cloud upgrades, and working access to the appropriate review/CI lanes. External approval, customer recruitment and credential gates cannot be scheduled as deterministic build tasks.

| Gate | Engineering effort | Expected evidence | Must not claim yet |
| --- | --- | --- | --- |
| G0: current-state inventory, trust/contract freeze, risk register | 2–4 developer-days | Source pins, existing test baseline, mapped blockers, approved no-new-runtime scope | New product or production authority |
| G1: resolve existing release recovery and exact OpsTruth/DoneState chain | 8–18 developer-days **plus** external CI/reviewer/provider waiting | Existing real release readback, signer receipt, independent decision, final gated state | Replayed release or universal exactly-once |
| G2: fault corpus and reproducible benchmark | 5–10 developer-days | F01–F16 results; naive baseline; independent ledger; public sanitised fixtures | Independent customer demand |
| G3: external reproduction and first supported cross-harness adapter | 8–15 developer-days | Clean install, 2 harness integration results, test/proof comparison | Generic platform coverage |
| G4: adoption and bounded user pilot | 5–10 developer-days of engineering **plus** unpredictable external adoption window | #14 observations from genuinely independent users, specific useful outcome and support-cost data | Ten fictional installations or market fit |

**Calendar forecast if the current release/CI blockers can be cleared:** focused public research demonstration approximately **3–6 weeks**; credible reproducible developer alpha approximately **8–12 weeks**; bounded commercial pilot **3–6 months**. Enterprise-grade multi-provider assurance is a separate **6–12+ month** programme, not a v1 requirement. If required-check billing, provider permissions, signer trust, macOS CI or external users do not unblock, the calendar extends. Record that dependency before describing any date as a commitment.

**Stop/continue rules:** stop expansion if G1 cannot be independently proven; if G2 shows no material gain over provider-native idempotency/readback, publish the negative result and narrow the offering; do not add a second action until verified demand justifies it; defer dashboards, payment integrations, SDK sprawl and hosted fleet controls until after external adoption evidence.

## 8. Required publication/acceptance record

For each milestone retain: canonical issue and PR links; source and dependency hashes; CI identity (including provider, required-check App and exact head); runtime/source pin; objective, action and original target IDs; scope of approval; authority and verifier fingerprints (never private keys); provider write count, status and readback references; immutable receipts; independently signed verifier decision; crash/fault method; counts/denominators; redacted logs; affected versions; actual limitations; and whether a result is source-only, simulated, hosted canary, or independent external user adoption.

**Review obligation:** Treat this as an evidence-based research addition only. Do not merge this document as a claim of implementation. Follow [AGENTS.md](../../AGENTS.md) and the existing decision/roadmap/status ownership if later work changes actual product scope.