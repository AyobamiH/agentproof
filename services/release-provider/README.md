# Isolated AgentProof release authority and signing

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
