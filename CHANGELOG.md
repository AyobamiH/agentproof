# Changelog

## 0.1.0-rc.4

AgentProof `0.1.0-rc.4` is a developer prerelease for Node.js 22.5 or newer on Linux and macOS. Native Windows has not yet been validated.

- Protects `agentproof.repository_patch.v1` with exact approval binding and exactly-once execution.
- Independently verifies repository postconditions and emits cryptographically signed Receipt V2 evidence.
- Supports trusted signer fingerprints and append-only signed compensation successors.
- Provides packaged CLI and public SDK interfaces.
- Keeps development authority separate from production policy; development approvals cannot satisfy production authority.
- Assumes the authority, executor and verifier run under the same operating-system account in this prerelease and does not provide an OS-enforced privilege boundary.

This release does not add actions, production integration, dashboards, payments, marketplaces or remote routing.
