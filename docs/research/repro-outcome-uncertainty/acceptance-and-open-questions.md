# No-hindsight review: acceptance, contradictions and remaining gates

**Scope:** the AgentProof public, fixture-only lost-acknowledgement experiment and associated external discussion. This is a reusable *pre-publication checklist*, not a promise that future unknowns can be eliminated or that production adoption is established.

## Outcome contract

A reviewer must be able to distinguish:

1. **Actual work:** eight existing source-only tests execute against a pinned, unmodified `ReleaseV1Controller` and a synthetic provider.
2. **Measured result:** test counts are accurately recorded as 8 passed / 0 failed / 0 skipped. Negative source-drift checks are explicitly `BLOCKED`, not silently ignored.
3. **Trust semantics:** a cryptographically trusted receipt has `independentOutcomeVerified=false` in the fixture. The signed payload is not an independent production verifier's decision.
4. **No replay:** the original historical live GitHub release action was **not** run; no cloud production access, provider write or new durable release grant was used.
5. **Reproducibility:** clean commands, exact source hashes, machine-readable local output, known restrictions and meaningful negative controls are public.
6. **Independent scrutiny:** the owner-run fixture is separated from a future third-party reproduction, critique or real external adoption.
7. **Prior art:** standards are compared by their actual guarantee boundaries before any new format is recommended.
8. **Publishing provenance:** source branch/commit, code review, hosted CI, public link, discussion and adoption status remain separate. A PR link is not a merged release.

## Pre-publication acceptance checklist

| Gate | Acceptance evidence required | Status at 1 November 2026 |
| --- | --- | --- |
| S01: precise research claim | Question, scope and limits documented | Complete in [README](README.md) |
| S02: source pinning | Exact baseline SHA and SHA-256 digests for controller, test source and emitted JS | Implemented in `scripts/reproduce-release-uncertainty.mjs` |
| S03: actual runnable tests | Eight named tests pass, zero failures/skips; output has no hidden positive status | Local author execution `PASS 8/8`; [owner fixture result](owner-fixture-result-2026-11-01.json) |
| S04: fail-closed reproduction | A harmless source change yields exit 2 and `BLOCKED: SOURCE_DRIFT`; source restored | Observed; [negative-control result](negative-control-source-drift-2026-11-01.json) |
| S05: side-effect containment | Code path inspects synthetic `FixtureReleaseProvider`, no real GitHub publication | Reviewed against pinned test source; no operating-system network isolation claimed |
| S06: exact state semantics | Simulated mutation/reconciliation, signer trust and independent outcome flag never conflated | Covered by eight named assertions |
| S07: security / privacy | No private credentials, customer data, live token, original confidential receipts, or replayable authority published | Source and report inspection required again before every release |
| S08: standards comparison | Exact primary specs and publication states, with no invented conformance | [Comparison](standards-comparison.md) drafted; in-toto v1.2, OpenTelemetry GenAI Development, W3C PROV and HTTPAPI draft -08 cited |
| S09: independent reproducibility | Unaffiliated engineer runs a fresh clean checkout and supplies a read-only, sanitised result with exact commit | **NOT VERIFIED**. Owner-run CI or a second maintainer machine is not adoption |
| S10: code publication and hosted checks | Public PR + exact head, required CI success, authorised merge readback | Must be established on the new PR after push; local PASS is insufficient |
| S11: public and link integrity | Anonymous access to the reproduction code/docs and exact invitation from Discussion #44 | Must be checked after publication; no speculative links |
| S12: no misleading product claim | Fixture `release.v1` remains source-only; real 17/17 canary remains `repository_patch.v1` | Explicit in README; current production acceptance unchanged |
| S13: community usefulness | Reproducible contradiction, substantive critique, simpler prior art or evidence-demanded use case | **NOT VERIFIED** until a non-owner response is reviewed |
| S14: original Post-Once public gap | A safe standalone fixture for the private lock-contended vault incident, or its limit explicitly left open | **OPEN**; no private receipt or synthetic replacement is silently passed off as the original |
| S15: canonical website Git sync | Existing canonical Sites source reconciled with five posted article sources plus four discussion links | **OPEN**; public Cloudflare publication and saved handoffs are not Git merge evidence |
| S16: parent governance visibility | Proof & State README links to discussion via policy-conformant change without stale record manipulation | **OPEN**; stale product observation gate requires genuine reconciliation or scoped code review |

A checked item means its precise criterion is met, not that neighbouring work is accepted. The table preserves open gaps as tracked decisions instead of building speculative features to hide them.

## Reviewer safety and integrity gates

- No real `publishDraft`, PATCH, payment, deployment, merge or externally replayed action is needed for this reproduction.
- Require exact source/target binding and an observed provider readback before upgrading an *external* effect claim.
- If a signature verifies but the signer identity or authority is not pinned, classify the trust decision as unresolved.
- If the provider write may have happened and readback is inaccessible, preserve `unknown` and the permanent no-replay fence. **Never** turn "no GET result" into "publish again".
- Prevent accidental ambient-secret forwarding; run outside a machine with production credentials when practical. The test subprocess environment is deliberately allowlisted but this is not isolation from a compromised host.
- A contradictory artifact digest fails closure even if some independent tests are green.
- A publication or IndexNow notification receipt establishes availability/receipt only, **not** indexing, usage or community engagement.
- A customer, maintainer or unrelated developer's failure report requires a distinct evidence ID, date, environment, exact source SHA and an independent evidence check before counting as adoption.

## Next actions with named owners and re-entry conditions

| Open concern | Owner | Next safe action | Resume / closing evidence |
| --- | --- | --- | --- |
| Third-party reproducibility (`S09`) | AgentProof maintainer + external volunteer | Publish PR, link exact source/commands to Discussion #44; review external redacted result | Reproducible independent result with exact commit, command and reviewer context |
| Hosted CI and source visibility (`S10`/`S11`) | AgentProof maintainer | Check exact PR-head statuses, protected rules and anonymous GitHub links; merge only through normal authority | Provider-confirmed merge and source at exact revision |
| Original Post-Once evidence (`S14`) | Post-Once maintainer | Extract or build only sanitised lock/refusal-policy fixtures and mark the historic provider counts as owner-observed | External reproduction *of the same mechanism*, without private account operations |
| Sites Git sync (`S15`) | Website source owner | Reconcile saved source handoff with the canonical existing Sites workspace; preserve newer edits | Exact canonical Git SHA plus fresh build and publication no-regression |
| Parent Proof & State README (`S16`) | Governance maintainer | Correct stale observations from real provider readbacks, or propose scoped governance check design; do not fabricate freshness | Reviewable policy-conforming PR, generated state and normal CI |
| Standardisation/adapter idea | External reviewers + product owners | Compare existing in-toto, PROV, OTel and HTTP idempotency to at least one reproducible failure | Accepted external counterexample; otherwise **no integration** |

**Review date:** after genuine external technical feedback, or review the open questions on 8 November 2026; absence of replies is not evidence of an existing protocol gap. This file is itself a maintained accountability record, not a self-signed acceptance decision.

## Recorded execution-environment failure, not concealed

The first repository-wide `npm run check` failed because the developer host had global `commit.gpgsign=true` and an encrypted SSH signing key unavailable to temporary test repositories. That caused `ssh_askpass` failures for Git fixture commits; it was **not** presented as a product regression or a green run. The runner's eight release-v1 fixture tests had already passed independently.

A second full `npm run check` passed with Git's documented **process-local configuration override** (`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false`); global signing settings were checked before and after and remained enabled. The scoped run reported two test groups of **76 and 22 passing tests**, documentation closure, package audit, and no failed tests. See [the owner validation receipt](owner-validation-receipt-2026-11-01.json). This testing workaround is *not* permission to disable commit signing globally or waive hosted CI/review requirements.

## Publication go / no-go rule

Go live with this **bounded fixture research** only after S01–S08 and the actual PR/head/link checks are fulfilled. Do **not** wait for unrelated commercial adoption or the historical real GitHub release's signer readback. Those are separate open results. Any mismatch, stale source, secret leakage or unexpectedly mutating invocation blocks the specific publication until corrected.

This document is an author-produced review with AI assistance. Independent review remains unobserved until someone else actually performs it.
