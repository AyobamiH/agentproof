# Current status

Lifecycle-contract implementation merge: `2ec72f15a50881104ad03d92cde133d7a2351685`

## Release history

- **RC1:** validation exposed a signed-receipt trust defect: important identities and authority claims were not all cryptographically bound. RC1 receipts are legacy unbound evidence and can never verify as trusted.
- **RC2:** Receipt V2 repaired the trust boundary, but independent validation was incomplete and compensation returned the transaction ID where correlation was required.
- **RC3:** correlation semantics and validation passed, but public-package preflight failed because licensing and prerelease packaging were not ready.
- **RC4:** Apache-2.0, public metadata, executable packaging, 46/46 AgentProof tests, 395/395 Operator tests, deterministic packing, and Developers A–D passed. Its publication request was unconsumed and superseded before publication by standalone productisation.
- **RC5 (`0.1.0-rc.5`):** standalone source, tag, GitHub prerelease, and packaged tarball are published at `github.com/AyobamiH/agentproof`. Fresh registry readback on 7 October 2026 also confirms RC5 npm publication. The registry tarball is byte-for-byte identical to the GitHub RC5 asset, its registry signature verifies, and a clean consumer completed the development repository-patch lifecycle. This correction records existing publication; it does not perform a new publication or change the RC5 tag.
- **RC6 (`0.1.0-rc.6`):** published on GitHub and npm from source commit `a0ee17a70d05bc3c339c0c15be6bb38b4517771a`. The GitHub, staged, and registry tarballs are byte-for-byte identical with SHA-256 `f9dd7eb65f5809c69584624272c0c7dc13a84209c4a2daee338dfee43f5050ca`; npm records integrity `sha512-+PoO/Q2su6AreygVjMzmeVQEA/+H2/LXVHqNw+ttVh/n+7m0tl52j3JiEm3tj2fo36sJq20mzEhEsnvub8tRFA==`. A fresh registry installation passed the CLI, SDK, development-authority export, schema, and registry-signature checks. `next` points to RC6 while `latest` remains RC5. See [RC6 registry reconciliation](evidence/npm-rc6-registry-reconciliation.md).

## Supported capability

Only `agentproof.repository_patch.v1`: an allowlisted patch against an exact clean local Git repository. It does not commit, push, tag, deploy, migrate, or access remotes.

## Known limitations

The package is ESM-only and requires Node.js 22.5+, Git, and a local filesystem. Linux, macOS, and WSL2 are assumed; native Windows is unvalidated. Published RC6 state/signing are local. The current source adds optional external-provider clients, and a narrowly scoped hosted provider canary. No general-purpose authority, KMS/HSM custody, OS-enforced executor sandbox, hosted coordinator product, or distributed atomic commit is established. Explicit signer pinning is required. Development authority is not production authority.

## Active gate

RC6's distribution gate is complete. GitHub created the exact release artifact,
an authenticated publisher staged those bytes, the maintainer approved the stage
with 2FA, npm published RC6 under `next`, and a clean registry consumer passed.
The package now trusts `AyobamiH/agentproof` workflow `release-prerelease.yml`
for `stage publish` only. The workflow has no direct publication authority, and
every future stage still requires maintainer inspection and 2FA approval.

The current integration gate is measured independent adoption and a production
authority/signing provider. DoneState has
named merge, deployment, and release receipts as future lifecycle candidates.
AgentProof has not enabled those runtime actions: production authority/signing,
action-specific threat models, deterministic provider reconciliation, OpsTruth
verification fixtures, and exact canaries remain gates. The candidate adapter
boundary is documented in `docs/protocols/donestate-lifecycle-adapter.md`.

## Adoption tooling — 13 October 2026

Source-maintainer tooling now provides a pinned RC6 clean-install acceptance runner,
a structured installation-observation schema and a fail-closed aggregation command.
The runner labels automated evidence explicitly and gives it zero independent-adoption
credit. See [collection instructions](adoption/README.md). These tools are not in the
already-published RC6 tarball; this change does not republish or move npm tags.

The existing injected signing-provider boundary now has outage/reconciliation/retry
coverage. [Production provider readiness](protocols/production-provider-readiness.md)
records the required external custody, policy, trust and canary evidence. There is
still no activated production provider or additional runtime action.

## External provider clients — 13 October 2026

The unreleased source now provides a separate `production-providers` SDK subpath:
a version-pinned Vault Transit Ed25519 signer and an external production-approval
client. Each requires explicit HTTPS configuration, short-lived credential callbacks
and independently provisioned trust pins. Returned signatures and exact request
bindings are validated locally; no approval is minted by the client.

Conformance fixtures cover trust, malformed/oversized responses, redacted failures,
deadlines, credential races and key rotation. The real signer adapter also passes
durable outage/reconciliation/idempotency coverage against a disposable mock service.
These are engineering observations, not production deployment or adoption evidence.
See [provider contract and threat boundaries](protocols/production-provider-adapters.md).

No live provider endpoint, key, service IAM or production canary is configured.
The authenticated repository inspection found no Actions secret or variable names;
the terminal had no Vault/AWS/GCP/Azure provider CLI available. Those observations
describe this task's access, not an exhaustive inventory of the owner's accounts.
RC6 publication and its immutable artifact remain unchanged. A future package version
must use the guarded staging/maintainer-2FA procedure.

## Hosted provider bootstrap — 15 October 2026

Two isolated Cloudflare Workers were originally provisioned disabled, with separate encrypted signing secrets and reviewed public pins. They were later deliberately activated for a successful exact-source production canary; the committed default configurations remain disabled and new main commits require a fresh source pin. The production-provider workflow exercises a single disposable repository patch, lost-response reconciliation, retry protection and signed compensation. See [policy, custody, deployment and rollback](protocols/hosted-production-canary.md). Live acceptance evidence will be appended after activation; bootstrap is not a successful canary. A public independent-installation issue form now accepts real observations; no participant is inferred or counted from these engineering runs. DoneState consequence actions remain separate candidates.

Two live attempts on 17 October 2026 failed before mutation because the authenticated GitHub account issues **immutable** OIDC subjects, while the initial Worker expected the legacy name-only subject. Reports, hashes, rollback status and the exact denial are preserved in [immutable-subject canary failure evidence](evidence/hosted-production-oidc-refusals-20261017.md). The immutable subject was corrected without loosening the remaining identity checks. The earlier failures remain historical evidence rather than successful live acceptance.

**Bounded live acceptance completed, 17 October 2026:** [workflow 39008214371](https://github.com/AyobamiH/agentproof/actions/runs/39008214371) passed all 17 production service checks on exact source `47587087565ac312b56909cf7a5d32a4d371d7c4`. A separate offline readback validated the initial receipt, successor chain and orphan rejection. [Acceptance evidence and exact scope](evidence/hosted-production-canary-acceptance-20261017.md). This replaces the previous "live unproven" state **only for the single disposable repository-patch canary**; arbitrary provider policy, independent external adoption and DoneState consequence actions remain unproven. Any subsequent main commit requires a deliberate service source-pin update and fresh canary.


## Release v1 source-only candidate — 17 October 2026

The [GitHub draft-prerelease transaction candidate](actions/release-v1-candidate.md) has a fixed owner/repository/release/tag/artifact/provenance subject, Ed25519-signed production-only approval, a durable SQLite effect-intent ledger, a **single** publisher PATCH, read-only reconciliation after ambiguous responses and an independently pinned release-specific Receipt V2 verifier. Source and generated schema fixtures are tested; the package version remains RC6 and the public package/CLI do not export this candidate. The source **does not** activate another Cloudflare signer, publish a real GitHub release, grant DoneState consequences or prove an OpsTruth verdict. Ten genuine independent installations remain an external-adoption gate. The existing hosted repository-patch provider remains pinned to `afaa79663e59cc55fb0213eed0f570549b5e0875`; new main source is not automatically deployed or given broader credentials.

## Permanent-release-fence source candidate — 17 October 2026

A [disabled, release-only Cloudflare provider](../services/release-provider/README.md) now implements separate OIDC-bound approval and receipt-signing Workers. A durable, target-addressed SQLite-backed Durable Object records one permanent release identity and commits the attempted state before the single permitted GitHub publication PATCH. Ambiguous or lost responses are reconciled read-only. Unlike the repository-patch signer, the new release receipt signer rejects a release-write credential and independently reads public GitHub release state. The new service has its own tests, pinned cloud build and no impact on the existing patch provider. This is not a production release or a general-purpose approval service; the committed configuration is disabled with no signing key or live target.

The selected disposable public test repository is AyobamiH/agentproof-release-canary (ID 1423718326), with main protected. It contains only a README and locally staged public test artifact bytes. The platform refused creation of the draft release and writing the workflow orchestrator; no GitHub release publication, separate production key provisioning, independent production-signed OpsTruth release decision or DoneState live transition is claimed. The live repository-patch canary remains a separate accepted capability, last 17/17 on source 2ed24b95ec90f36d52132cc3f98fc9d937ade4da.

## Public read-only release authority readiness — 17 October 2026

A separate [read-only readiness protocol](protocols/read-only-release-readiness.md) now contains an explicit public-GitHub/Cloudflare source-pin and disabled release-authority observation command, with a minimal-permission GitHub Actions workflow on main pushes and daily. The local live readback reported `PATCH_SOURCE_PIN_DRIFT`: AgentProof main `b6724b1927e26aa7284371ec7fdd974aeefcbf42` versus still-enabled existing repository-patch Workers at `2ed24b95ec90f36d52132cc3f98fc9d937ade4da`. The three separate release approval, signing and independent verifier Workers remain disabled, zero-pinned and without active release authority. The disposable GitHub repository contains no release. OpsTruth's original MCP remains read-only.

The check makes only ten allowlisted public HTTP **GET** calls, never requests tokens or changes any deployment, source pin, approval, release or signer. Public read failures are `UNPROVEN`, not success. The scheduled observation cannot publish or verify release outcomes; `AgentProof #17` remains the explicit permitted source-repin and fresh 17/17 canary gate, and `DoneState #193` remains the genuine release-to-VERIFIED gate. No independent external first-install users are inferred. This source addition does not republish RC6 or enable `release.v1`.

## GitHub release timestamp compatibility — 18 October 2026

Actual GitHub release readback (RC6 release 405381381) returns published_at as
2026-10-07T04:34:23Z. The release adapter and the independent receipt signer's
public reader now canonicalise valid GitHub seconds/milliseconds UTC values to
the protocol's millisecond UTC representation, while rejecting invalid dates,
offsets and non-string values. The signed timestamp schema is unchanged.
Regression fixtures cover this real provider format; they are not a real
release publication or OpsTruth/DoneState terminal acceptance. Existing
current-main patch acceptance is workflow 39113765551 on 39d4ea7; merging this
necessary compatibility correction requires a new exact-source re-pin and canary.

The same candidate preserves the bounded raw, validated HTTP 200 GitHub publication-response body, status and request ID in the release Durable Object and returns it during read-only reconciliation. Network loss remains explicit null evidence; it never causes a second publication attempt. Provider tests cover exact response persistence, canonical seconds-precision readback and lost-response recovery.

PR #19 independent review identified the existing no-error-body-retention contract. The follow-up records only validated HTTP 200 publication responses; failed/malformed response bodies remain unretained, with explicit null recovery evidence and a regression test.

Canary workflow PR #1 independent review identified that service build revisions and permitted caller-workflow revisions must be checked separately. The follow-up release-only health metadata exposes both, preserving the legacy sourceCommit field for guarded monitoring. Production activation remains pending; a new AgentProof merge requires another unchanged-key patch re-pin and real 17-check canary before closeout.
