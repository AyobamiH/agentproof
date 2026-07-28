# Trust model

AgentProof separates five authority roles:

1. **Proposer:** describes intent and prepares a bounded transaction; cannot approve it.
2. **Approval authority:** decides the exact prepared request, environment, issuer, expiry, and nonce; cannot mutate or sign receipts through the AgentProof executor.
3. **Executor:** applies only approved bounded mutations in a separate process; cannot manufacture authority or signed evidence.
4. **Receipt signer:** signs independently assembled verified evidence through an injected provider; is outside the mutating process.
5. **Offline verifier:** validates canonical signature/digest structure and applies its own pinned signer/authority policy without trusting the executor.

Approval is transaction-bound and single-use. Idempotency and approval consumption are enforced durably. Verification reads the resulting repository state and checks exact manifests, changed paths, refs/remotes, and bounded command evidence. False success is not evidence.

Receipt V2 signs a domain-separated canonical payload. Verified identities come only from that payload. An embedded public key demonstrates signature self-consistency, not identity; trust requires an out-of-band acceptable fingerprint. Compensation never mutates a prior receipt and instead signs a successor linked by predecessor payload digest.

The RC5 processes share one OS account, so process separation is a capability boundary rather than an OS sandbox. Production deployment requires stronger key custody and execution isolation. See [SECURITY.md](../SECURITY.md).
