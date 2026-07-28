# Changelog

## 0.1.0-rc.5

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
