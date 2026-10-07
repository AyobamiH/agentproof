# Changelog

## 0.1.0-rc.6

RC6 preserves the proven `agentproof.repository_patch.v1` runtime and Receipt V2 trust boundary while making the standalone repository genuinely consumable and releasable.

- Adds reproducible exact-commit Git package installation through the standard `prepare` build.
- Adds repository CI, CODEOWNERS, documentation-closure checks, and canonical product vision.
- Packages the AgentProof skill and the DoneState lifecycle-adapter boundary without enabling speculative merge, deployment, or release actions.
- Adds a guarded GitHub prerelease workflow that creates the exact RC6 tag and tarball only after the full release gate passes.
- Adds a stage-only npm OIDC lane for post-bootstrap releases; CI receives no direct `npm publish` authority.
- Documents the first-package npm bootstrap separately so RC6 can be staged by the authenticated publisher, inspected, and approved with 2FA before becoming public.

RC6 does not add production authority/signing, a hosted coordinator, an OS-enforced sandbox, or a second consequential action.

## 0.1.0-rc.5

- Reissues the unpublished RC5 package under the publisher-owned npm scope `@oneclicksystems/agentproof`; the earlier local `@openclaw/agentproof` identity was never published.

- Adds a README-only executable CLI lifecycle that proves trusted receipt, exactly-once retry, and clean signed compensation in a disposable repository.

- Closed the unsigned post-receipt compensation path and exposed correlation-bound public reconciliation for interrupted executions.
- Development-authority JSON input now rejects duplicate keys.

AgentProof is now rooted in its standalone product repository. RC5 preserves the RC4 repository-patch action, public CLI/SDK, Receipt V2, authority model, state machine, schemas, fixtures, and Apache-2.0 licence.

- Makes the standalone repository the intended canonical portable-product boundary.
- Adds authoritative product-direction, architecture, trust, roadmap, status, adoption, decision, and validation-evidence documentation.
- Updates public package metadata and packaged documentation for the standalone repository.
- Keeps OpenClaw Operator as an adapter and consumer, not a source owner.

No action, production integration, trust guarantee, dashboard, payment surface, marketplace, or connector was added.

## 0.1.0-rc.4

AgentProof `0.1.0-rc.4` is a developer prerelease for Node.js 22.5 or newer on Linux and macOS. Native Windows has not yet been validated.

- Protects `agentproof.repository_patch.v1` with exact approval binding and exactly-once execution.
- Independently verifies repository postconditions and emits cryptographically signed Receipt V2 evidence.
- Supports trusted signer fingerprints and append-only signed compensation successors.
- Provides packaged CLI and public SDK interfaces.
- Keeps development authority separate from production policy; development approvals cannot satisfy production authority.
- Assumes the authority, executor and verifier run under the same operating-system account in this prerelease and does not provide an OS-enforced privilege boundary.

This release does not add actions, production integration, dashboards, payments, marketplaces or remote routing.
