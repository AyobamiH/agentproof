# DoneState lifecycle adapter boundary

Status: candidate contract; no runtime action enabled

DoneState has selected three future consequential action classes for AgentProof integration:

- `agentproof.github_merge.v1` — one exact pull-request head into one exact base head;
- `agentproof.deployment.v1` — one exact immutable artifact or commit into one named environment;
- `agentproof.release.v1` — one exact tag, package artifact, provenance set, and destination.

Each action must preserve the existing five-role separation: proposer, approval authority, executor, receipt signer, and offline verifier. Approval must bind the prepared subject, effect destination, policy, expiry, nonce, and idempotency key. Execution must durably record intent before the external effect and reconcile provider state after ambiguous responses. The receipt signer may sign only after action-specific postconditions are observed. OpsTruth then independently re-observes the public or brokered subject; an AgentProof receipt alone cannot produce `VERIFIED`.

No action is added to the public CLI, SDK, schema constants, or runtime by this candidate. Activation requires a production authority/signing provider, an action-specific threat model and schema, ambiguous-effect fixtures, a DoneState adapter, an OpsTruth verification fixture, and one exact canary. Merge, deployment, and release are separate authority classes and may be enabled independently.
