# AgentProof portable preview security

## RC2 signed receipt boundary

RC1 receipts are legacy unbound documents and can never be trusted by the RC2
verifier. V2 has only `payload` and `proof`: every returned identity and policy
claim comes from the signed payload. The verifier strictly validates the
complete structure, recomputes the domain-separated payload digest, enforces
Ed25519, derives the key fingerprint, applies explicit trust and authority
policy, reconstructs approval-binding consistency, and validates authenticated
predecessor chains before returning `trusted: true`.

See `docs/receipt-v2-migration.md` for canonicalization and migration semantics.

AgentProof proves that an exact approved repository-patch document was claimed once, applied through a separate executor, independently observed, and bound into a signed receipt. It does not prove that the proposer is benevolent, that verification commands are complete, that the operating-system account is uncompromised, or that a development key is production-grade authority.

## Trust boundaries

- The proposer prepares and requests approval. It cannot approve through the primary CLI.
- The authority signs the exact request digest. Development authority requires the separate `agentproof-dev-authority --development` binary and a distinct private key.
- The executor receives bounded prepared inputs and cannot mint approvals or receipt signatures.
- The receipt signer is an injected provider with separate key possession.
- The offline verifier requires an explicitly pinned fingerprint. An embedded public key proves only signature self-consistency, not signer identity.

Development approvals carry `authorityEnvironment: development` and fail when execution requires production authority. Never describe or use the development adapter as production security.

V1 processes run under the same operating-system account, so OS-level compromise can cross process boundaries. Operator and AgentProof state reconcile deterministically; they do not use a distributed atomic commit. The package performs no network access, starts no background service, and scans no environment variables during import.

Verify receipts offline with the CLI or `verifyReceipt`, always supplying trusted signer fingerprints out of band.
