# Current status

Lifecycle-contract implementation merge: `2ec72f15a50881104ad03d92cde133d7a2351685`

## Release history

- **RC1:** validation exposed a signed-receipt trust defect: important identities and authority claims were not all cryptographically bound. RC1 receipts are legacy unbound evidence and can never verify as trusted.
- **RC2:** Receipt V2 repaired the trust boundary, but independent validation was incomplete and compensation returned the transaction ID where correlation was required.
- **RC3:** correlation semantics and validation passed, but public-package preflight failed because licensing and prerelease packaging were not ready.
- **RC4:** Apache-2.0, public metadata, executable packaging, 46/46 AgentProof tests, 395/395 Operator tests, deterministic packing, and Developers A–D passed. Its publication request was unconsumed and superseded before publication by standalone productisation.
- **RC5 (`0.1.0-rc.5`):** standalone source, tag, GitHub prerelease, and packaged tarball are published at `github.com/AyobamiH/agentproof`. Fresh registry readback on 7 October 2026 also confirms RC5 npm publication. The registry tarball is byte-for-byte identical to the GitHub RC5 asset, its registry signature verifies, and a clean consumer completed the development repository-patch lifecycle. This correction records existing publication; it does not perform a new publication or change the RC5 tag.
- **RC6 (`0.1.0-rc.6`):** published on GitHub and npm from source commit `a0ee17a70d05bc3c339c0c15be6bb38b4517771a`. The GitHub, staged, and registry tarballs are byte-for-byte identical with SHA-256 `f9dd7eb65f5809c69584624272c0c7dc13a84209c4a2daee338dfee43f5050ca`; npm records integrity `sha512-+PoO/Q2su6AreygVjMzmeVQEA/+H2/LXVHqNw+ttVh/n+7m0tl52j3JiEm3tj2fo36sJq20mzEhEsnvub8tRFA==`. A fresh registry installation passed the CLI, SDK, development-authority export, schema, and registry-signature checks. `next` points to RC6 while `latest` remains RC5. See [RC6 registry reconciliation](evidence/npm-rc6-registry-reconciliation.md).

## Supported capability

Only `agentproof.repository_patch.v1`: an allowlisted patch against an exact clean local Git repository. It does not commit, push, tag, deploy, migrate, or access remotes.

## Known limitations

The package is ESM-only and requires Node.js 22.5+, Git, and a local filesystem. Linux, macOS, and WSL2 are assumed; native Windows is unvalidated. State/signing are local. There is no production authority/KMS/HSM, OS-enforced executor sandbox, hosted coordinator, or distributed atomic commit. Explicit signer pinning is required. Development authority is not production authority.

## Active gate

RC6's distribution gate is complete. GitHub created the exact release artifact,
an authenticated publisher staged those bytes, the maintainer approved the stage
with 2FA, npm published RC6 under `next`, and a clean registry consumer passed.
The package now trusts `AyobamiH/agentproof` workflow `release-prerelease.yml`
for `stage publish` only. The workflow has no direct publication authority, and
every future stage still requires maintainer inspection and 2FA approval.

The current integration gate is measured independent adoption and a production
authority/signing provider. DoneState has
named merge, deployment, and release receipts as future lifecycle candidates.
AgentProof has not enabled those runtime actions: production authority/signing,
action-specific threat models, deterministic provider reconciliation, OpsTruth
verification fixtures, and exact canaries remain gates. The candidate adapter
boundary is documented in `docs/protocols/donestate-lifecycle-adapter.md`.
