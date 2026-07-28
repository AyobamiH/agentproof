# AgentProof security

AgentProof proves that an exact approved repository-patch document was claimed once, applied through a separate executor, independently observed, and bound into a signed receipt. It does not prove that the proposer is benevolent, verification commands are complete, the operating-system account is uncompromised, or a development key is production authority.

## Receipt V2

RC1 receipts are legacy unbound documents and can never be trusted by the V2 verifier. V2 has only `payload` and `proof`: every returned identity and policy claim comes from the signed payload. The verifier strictly validates the complete structure, recomputes the domain-separated payload digest, enforces Ed25519, derives the key fingerprint, applies explicit trust/authority policy, reconstructs approval-binding consistency, and validates authenticated predecessor chains before returning `trusted: true`.

See [Signed receipt V2](docs/protocols/signed-receipt-v2.md) for canonicalization and migration semantics.

## Trust boundaries

- The proposer prepares and requests approval. It cannot approve through the primary CLI.
- The authority signs the exact request digest. Development authority requires the separate `agentproof-dev-authority --development` binary and a distinct private key.
- The executor receives bounded prepared inputs and cannot mint approvals or receipt signatures.
- The receipt signer is an injected provider with separate key possession.
- The offline verifier requires an explicitly pinned fingerprint. An embedded public key proves only signature self-consistency, not signer identity.

Development approvals carry `authorityEnvironment: development` and fail when execution requires production authority. Never describe or use the development adapter as production security.

Processes run under the same operating-system account in RC5, so OS-level compromise can cross process boundaries. Filesystem mutation and SQLite cannot form a distributed atomic commit; reconciliation observes resulting state deterministically. Package code performs no network access, starts no background service, and scans no environment variables during import. User-approved verification commands are external executables and are not an operating-system network sandbox; policies must allowlist them accordingly.

The supported action rejects dirty or wrong repositories, detached heads, symlinks, submodules, path escapes, `.git` writes, undeclared changes, before-state drift, secret-bearing paths/content, altered approvals, replay, and untrusted signers. It does not commit, push, tag, deploy, or mutate remotes.

## Reporting

Do not include credentials, private keys, production data, or exploitable public details in a report. Until a public security channel is established, use the future repository’s private vulnerability-reporting mechanism after publication. Before publication, report privately to the repository owner. Do not open a public issue for an unpatched vulnerability.
