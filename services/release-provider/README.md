# Isolated AgentProof release authority and signing

## Current recovery contract — 20 October 2026

The disposable release `416342082` was published once on 18 October. Its
permanent execution fence and signed completion remain the authority for that
effect. A signer readback refusal then prevented receipt and downstream
acceptance; the original completion's ten-minute freshness window expired.
Implementation and live acceptance are separate states, tracked in DoneState's
[`AGENTPROOF-001` ledger](https://github.com/AyobamiH/donestate/blob/main/governance/project-ledger.json).

The private `ReleaseRecovery` service entrypoint offers `observe` on the
approval Worker and `sign` on the receipt Worker. These methods recover
post-publication evidence for an already-verified, exactly pinned predecessor.
They cannot prepare, activate or execute a publication. The public HTTP routes
retain GitHub OIDC authentication, and `ENABLED=false` can remain in place while
`READBACK_RECOVERY_ENABLED=true` enables this separate capability.

Recovery configuration pins the original DoneState run, transaction, GitHub
run, completion digest and recovery-authorisation digest, alongside the existing
target, producing workflow and distinct signing keys. The authority checks the
persisted grant at its original issuance and the attempt within that grant's
lifetime. It performs fresh public GETs and signs an
`agentproof.release-readback-attestation.v1` sidecar with a five-minute expiry,
the original completion digest and an explicit `readOnly: true` claim.

The receipt signer validates that sidecar and repeats its own GETs before first
signing. It preserves the original approval, attempted/verified timestamps,
observations and completion signature. Its idempotency identity is still the
original request plus completion: refreshing the sidecar cannot create a second
receipt. Historical evidence can retrieve an existing receipt; first issuance
through the public route retains the original ten-minute policy.

DoneState owns persisted retry stages, leases, alarms, budget and settlement.
Missing original completion, changed authority or changed release content blocks
this bounded recovery; it never grants another publication attempt. Pi Durable
and PiHarness remain deferred under the recorded
[decision](../../docs/DECISION-LOG.md).

The sections below retain earlier deployment checkpoints. Source presence or a
passing fixture does not establish live receipt issuance or independent release
acceptance.

## Historical source checkpoint

Status on 17 October 2026: **source-only, disabled by default, not production accepted**. These services have no authority over the existing AgentProof repository-patch Workers.

## Isolation and permanent fencing

Approval verifies GitHub's Ed25519-independent OIDC RS256 identity under the immutable subject for AyobamiH/agentproof-release-canary, owner ID 47716486, repository ID 1423718326, main branch, protected agentproof-release-canary environment, exact reviewed workflow SHA and GitHub-hosted runner. An approval binds one exact GitHub draft release, immutable tag commit, package asset, provenance asset and metadata SHA-256 digests. A separate Ed25519 secret signs an exact production-only decision.

A SQLite-backed ReleaseFence Durable Object is named for the immutable numeric repository and release IDs. A transaction first records the unique immutable target claim. The only permitted GitHub PATCH follows a second synchronous durable state transition from reserved to attempted. Once attempted, all reentries are read-only reconciliations; expiry, process restart, changed workflow run, or lost response cannot reissue publication. There is no automatic deletion or compensation.

The receipt signer is a different Worker, Durable Object and signing key. It rejects any caller-supplied GitHub publishing token and independently checks publicly accessible GitHub repository, tag and release metadata using GET-only requests. It verifies the separately signed execution evidence and original approval before signing Release Receipt V2. AgentProof signature validity is not an OpsTruth VERIFIED decision. The OpsTruth verifier separately checks actual downloaded bytes and signed provenance.

## Default safety, tests and deployment boundary

Both committed Wrangler configurations are disabled, with zero source SHA, empty exact-target selection and no private signing key. Public trust pins are intentionally unconfigured until provider-controlled provisioning. No existing production Worker, customer target, DoneState runtime, npm release or signer is modified.

Source acceptance: run npm ci and npm run build in AgentProof root, then npm ci --ignore-scripts and npm run check and npm audit --audit-level=high in this folder. Tests prove the global target fence, one mutation, loss-of-response recovery, signature role separation, OIDC claim rejection and real HTTP adapter semantics. A deployment requires separate protected-source review, distinct encrypted keys and exact fingerprint readback.

The disposable GitHub repository was established at https://github.com/AyobamiH/agentproof-release-canary, ID 1423718326. GitHub main ruleset 25318507 and its protected deployment environment are active. This is a test-only repository containing an initial README, not evidence of a successfully published release.

Activation additionally requires a real test-only draft with exactly two independently hashed artifacts, separate provenance signing, a protected and source-pinned workflow, a scoped ephemeral publisher token held only by the executor, and a successful GitHub publication followed by a genuinely signed, independently downloaded-byte OpsTruth release decision and DoneState acceptance.

**External blocker:** A platform security check refused creating the disposable GitHub draft and also refused writing the credential-bearing canary orchestration script. Neither action was performed or bypassed. Do not claim a production release, real OpsTruth release attestation, or independent adopter from this source candidate.

## Separate deployed-source and caller-source identities

The health response retains legacy sourceCommit as the trusted GitHub workflow revision for existing disabled-state monitoring. trustedWorkflowCommit makes that meaning explicit; serviceSourceCommit separately identifies the reviewed AgentProof build revision configured by the deployment process. An unset service revision is null and cannot satisfy production acceptance. The canary checks both identities, and deployment evidence additionally records the Cloudflare version and exact source checkout. No authentication, signing or publication authority changes.


## Recovery activation configuration

Both committed release Worker configurations require recovery by default while remaining disabled.
An activation must set `RECOVERY_REQUIRED=true` on both approval and receipt-signing Workers,
and pin `RECOVERY_RUN_ID`, `RECOVERY_HANDOFF_FINGERPRINT`, and `RECOVERY_HANDOFF_PUBLIC_KEY_PEM`
to the preserved DoneState run and its unchanged handoff role. `/health` exposes `recoveryRequired`;
the protected workflow checks both roles before publication. A recovered completion's non-null
grant digest is refused by an unconfigured receipt signer. Provider tests carry recovery all the
way through separate receipt issuance and independently verify that receipt.
The signed reservation itself binds this recovery-required fence policy, so DoneState cannot
accept an ungated reservation. Never reset a target fence or replace an attempted seed.
