# Current status

## Release history

- **RC1:** validation exposed a signed-receipt trust defect: important identities and authority claims were not all cryptographically bound. RC1 receipts are legacy unbound evidence and can never verify as trusted.
- **RC2:** Receipt V2 repaired the trust boundary, but independent validation was incomplete and compensation returned the transaction ID where correlation was required.
- **RC3:** correlation semantics and validation passed, but public-package preflight failed because licensing and prerelease packaging were not ready.
- **RC4:** Apache-2.0, public metadata, executable packaging, 46/46 AgentProof tests, 395/395 Operator tests, deterministic packing, and Developers A–D passed. Its publication request was unconsumed and superseded before publication by standalone productisation.
- **RC5:** standalone source is published at
  `github.com/AyobamiH/agentproof`. The npm prerelease and GitHub Release remain
  unpublished. Clean Git consumers can pin an exact repository commit; the
  package builds its public exports during that source installation.

## Supported capability

Only `agentproof.repository_patch.v1`: an allowlisted patch against an exact clean local Git repository. It does not commit, push, tag, deploy, migrate, or access remotes.

## Known limitations

The package is ESM-only and requires Node.js 22.5+, Git, and a local filesystem. Linux, macOS, and WSL2 are assumed; native Windows is unvalidated. State/signing are local. There is no production authority/KMS/HSM, OS-enforced executor sandbox, hosted coordinator, or distributed atomic commit. Explicit signer pinning is required. Development authority is not production authority.

## Active gate

Source publication is complete. Registry publication and a GitHub Release
remain separate release actions and are not implied by repository availability.
The current integration gate is a reproducible clean consumer pinned to an
exact source commit; npm `next` publication remains separately approval-bound.
