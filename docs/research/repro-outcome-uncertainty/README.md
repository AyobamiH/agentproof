# A lost acknowledgement is not a verified external outcome

**Reproducible, bounded engineering exercise — 1 November 2026.** This package exercises *existing* source-only `agentproof.release.v1` fixture tests. It does not publish a release, use the GitHub API, activate a production signer, start DoneState, or imply that the separate October live release canary was accepted.

**Research question:** Can a transaction controller preserve one-attempt safety after an ambiguous provider response, yet keep the distinction between a trusted signed statement and an independently verified external outcome?

## What the demonstration is — and is not

- Source baseline: `AyobamiH/agentproof` at `d599bf512613cfa71a8ed95cc718937d63b5080a` (29 October 2026). The runner checks exact SHA-256 digests of the reviewed TypeScript test, release controller, and generated JavaScript test before executing.
- Implementation under test: [existing `ReleaseV1Controller`](../../../src/release-v1-controller.ts) + [existing release-v1 test fixtures](../../../src/test/release-v1.test.ts). No new publication logic or interoperability protocol is introduced.
- Provider: `FixtureReleaseProvider` with in-memory `published` and `publicationCalls` counters; no remote API operations. Approval and signing use disposable Ed25519 keys. State persists only in temporary local SQLite files, removed by the fixture's cleanup code.
- Positive result: eight selected assertions about one attempt, safe reconciliation, invalid authority, signer outage, replay defence, and receipt trust.
- **Crucial negative result:** even when the signature checks, the test asserts `verifiedClaims.independentOutcomeVerified === false`. An authenticated claim is not independent proof of a remote effect.
- **Not proven:** any real provider publication, production GitHub readback, multi-node atomicity, HSM custody, operator trust, long-term idempotency retention, customer usefulness, or adoption by an unrelated engineer.

The archived [17/17 protected repository-patch canary](../../evidence/hosted-production-canary-acceptance-20261017.md) is a *different supported action* (`agentproof.repository_patch.v1`). It must not be merged into this source-only release experiment's acceptance claims. The separate release publication in [GitHub Actions run 39124373253](https://github.com/AyobamiH/agentproof-release-canary/actions/runs/39124373253) remains a historical, once-executed effect with a failed independent signer readback; **do not replay it**.

## Run from a clean clone

Prerequisites: Node.js `>=22.5`, Git, an ordinary Internet connection only for cloning and downloading pinned npm dependencies. No GitHub token, Cloudflare token, database credentials, payment keys or production access required.

Clone and pin the **exact PR-head commit SHA**, not a moving branch, from the [public reproduction PR](https://github.com/AyobamiH/agentproof/pulls). The PR head contains this runner; the audited controller and test source match the baseline identified above.

```sh
git clone https://github.com/AyobamiH/agentproof.git
cd agentproof
git fetch origin research/repro-outcome-uncertainty-20261101
git checkout --detach FETCH_HEAD
git rev-parse HEAD                  # retain this exact SHA with your report
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node scripts/reproduce-release-uncertainty.mjs > /tmp/agentproof-repro.json
node -e 'const r=require("/tmp/agentproof-repro.json"); console.log(r.result,r.pass,r.fail,r.skipped); if(r.result!=="PASS"||r.pass!==8||r.fail!==0)process.exit(1)'
```

Expected: `PASS 8 0 0`, with eight named cases and `productionOrExternalOutcomeVerified: false`. See [the original maintainer-run fixture result](owner-fixture-result-2026-11-01.json), which is **not independent adoption**. Run the command on a fresh machine/environment to generate an *independent reproduction*; do not copy or re-label the owner's JSON.

The runner explicitly refuses unknown input arguments and any drift from the three pinned source/artifact hashes. It launches only eight exact test names and forwards a minimal environment to the test process so ambient provider tokens are not passed through. This is **not** an operating-system sandbox; run third-party source only in a trusted or isolated development environment. `npm ci` accesses the npm registry; the selected fixture tests make no provider API calls by design.

## Eight cases and their measurable assertions

| Case | Existing test name (exactly selected) | Asserted behaviour | What it does *not* establish |
| --- | --- | --- | --- |
| F01 | `exact authorised release, one mutation, durable retry and independently signed V2 evidence` | One fixture publish; trusted receipt under pinned signer; repeated request and restart return same receipt; `independentOutcomeVerified=false` | That GitHub published a real release or an external verifier approved it |
| F02 | `lost successful publication response reconciles by readback without re-publication` | Fixture sets `published=true`, loses response, subsequent read-only observation settles; `publicationCalls=1` | That a real provider offers timely, accurate GET readback |
| F03 | `unavailable post-effect readback never retries the effect` | Initial `publish_attempted` with operator review; after fixture GET returns, settles without a second publish | Safe progress when the provider never reveals the outcome |
| F04 | `signer outage after verified effect recovers by signing alone` | Local signer initially rejects, later signs; publication remains one attempt | HSM availability or independent signer hardware custody |
| F05 | `wrong preconditions, altered authority or expired grant fail before publication` | Denied/expired/wrong subject/issuer/asset observations yield zero publish calls | Security against a compromised machine or independent provider policy |
| F06 | `ambiguous unsuccessful PATCH is never invoked twice on restart` | No evidence of effect leaves `publish_attempted` and one attempted write, even across a controller restart | Guaranteed eventual completion: conservative uncertainty is intentional |
| F07 | `after-effect artifact drift cannot be signed or retried` | Changed artifact digest is refused; no receipt, no replay | A remote object's long-term immutability |
| F08 | `target uniqueness also rejects a fresh nonce on a second transaction` | Durable uniqueness stops a second fixture transaction to same release target | Cross-database/global atomicity or provider-side exactly-once delivery |

A `PASS` here means **the tests passed their assertions**, not that the externally visible consequence was independently observed. A `FAIL`, `BLOCKED`, wrong count, source hash mismatch or timeout must be reported as such.

## Deliberate negative control

A second maintainer-only check appended a harmless comment to the test source in a temporary checkout. The runner exited with code 2 and `BLOCKED: SOURCE_DRIFT`; the source was then restored. See [negative-control output](negative-control-source-drift-2026-11-01.json).

The negative control tests source pinning, not network isolation or authority refusal. No third-party system was mutated. If the repository source legitimately changes, the correct response is to review, re-run and *re-pin* the fixture with new evidence—not bypass the hash guard.

## Independent reproduction challenge

Choose one and report the exact source SHA, Node version, commands, resulting JSON hash and smallest relevant redacted trace:

1. **Counterexample:** demonstrate a trace where an acknowledgement is lost and an apparently safe retry still causes a duplicate effect, despite an idempotency key.
2. **Missing provider readback:** show how the verifier should represent an effect that may have committed but cannot be independently observed.
3. **Competing design:** show how an existing in-toto/DSSE statement, OpenTelemetry trace, W3C PROV relation, and provider idempotency policy can express the same *verifiable* boundary without a new schema.
4. **Authority mismatch:** show why a signed statement under an untrusted or irrelevant identity is insufficient even if its cryptography verifies.

Discuss findings in **[Proof & State Discussion #44](https://github.com/AyobamiH/proof-and-state/discussions/44)**. The product repositories remain separate; disagreement and a credible “no new standard needed” result are useful outcomes.

## Reading and closure gates

- [Standards comparison and the minimum possible gap](standards-comparison.md)
- [Fail-closed research and publication checklist](acceptance-and-open-questions.md)
- [Fixture runner](../../../scripts/reproduce-release-uncertainty.mjs)
- [Original source-only action contract](../../actions/release-v1-candidate.md)
- [Current status](../../CURRENT-STATUS.md)
- [Existing release-signer recovery PR](https://github.com/AyobamiH/agentproof/pull/24)
- [Separate DoneState release-verification issue #193](https://github.com/AyobamiH/donestate/issues/193)

**Editorial boundary:** This is author-operated, AI-assisted technical research, not peer review. No new live effect is needed or authorised for this article.
