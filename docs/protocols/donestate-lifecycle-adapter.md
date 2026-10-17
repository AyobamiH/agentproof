# DoneState lifecycle adapter boundary

Status: `agentproof.release.v1` source-only transaction/receipt candidate with fixture acceptance; no DoneState runtime action, released npm package API, production release service or OpsTruth release verifier enabled

DoneState has selected three future consequential action classes for AgentProof integration:

- `agentproof.github_merge.v1` — one exact pull-request head into one exact base head;
- `agentproof.deployment.v1` — one exact immutable artifact or commit into one named environment;
- `agentproof.release.v1` — one exact tag, package artifact, provenance set, and destination.

Each action must preserve the existing five-role separation: proposer, approval authority, executor, receipt signer, and offline verifier. Approval must bind the prepared subject, effect destination, policy, expiry, nonce, and idempotency key. Execution must durably record intent before the external effect and reconcile provider state after ambiguous responses. The receipt signer may sign only after action-specific postconditions are observed. OpsTruth then independently re-observes the public or brokered subject; an AgentProof receipt alone cannot produce `VERIFIED`.

No action is added to the public CLI, SDK, schema constants, or runtime by this candidate. Activation requires a production authority/signing provider, an action-specific threat model and schema, ambiguous-effect fixtures, a DoneState adapter, an OpsTruth verification fixture, and one exact canary. Merge, deployment, and release are separate authority classes and may be enabled independently.

The [source-only release.v1 candidate](../actions/release-v1-candidate.md) is restricted to publishing an already existing GitHub draft prerelease with exactly two pinned assets. Its own release-specific Receipt V2 signature proves authorisation and provider state readback, not an independent OpsTruth decision. Production approval/signing and action-specific verifier service still require independent trust anchors, a global one-target effect fence and an exact disposable release canary. Neither the existing patch canary service nor DoneState production Worker is modified or authorised to publish releases by the source change.
