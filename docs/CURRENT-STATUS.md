# Current status

Lifecycle-contract implementation merge: `2ec72f15a50881104ad03d92cde133d7a2351685`

## Release history

- **RC1:** validation exposed a signed-receipt trust defect: important identities and authority claims were not all cryptographically bound. RC1 receipts are legacy unbound evidence and can never verify as trusted.
- **RC2:** Receipt V2 repaired the trust boundary, but independent validation was incomplete and compensation returned the transaction ID where correlation was required.
- **RC3:** correlation semantics and validation passed, but public-package preflight failed because licensing and prerelease packaging were not ready.
- **RC4:** Apache-2.0, public metadata, executable packaging, 46/46 AgentProof tests, 395/395 Operator tests, deterministic packing, and Developers A–D passed. Its publication request was unconsumed and superseded before publication by standalone productisation.
- **RC5 (`0.1.0-rc.5`):** standalone source, tag, and GitHub prerelease are published at
  `github.com/AyobamiH/agentproof`. The npm prerelease remains unpublished.
  Clean Git consumers can pin an exact repository commit; the
  package builds its public exports during that source installation.

## Supported capability

Only `agentproof.repository_patch.v1`: an allowlisted patch against an exact clean local Git repository. It does not commit, push, tag, deploy, migrate, or access remotes.

## Known limitations

The package is ESM-only and requires Node.js 22.5+, Git, and a local filesystem. Linux, macOS, and WSL2 are assumed; native Windows is unvalidated. State/signing are local. There is no production authority/KMS/HSM, OS-enforced executor sandbox, hosted coordinator, or distributed atomic commit. Explicit signer pinning is required. Development authority is not production authority.

## Active gate

Source, tag, and GitHub prerelease publication are complete. The npm prerelease remains unpublished.

The repository now has a stage-only GitHub OIDC release lane in
`.github/workflows/release-prerelease.yml`. It validates the exact RC5 package,
runs the full release checks, and may execute only `npm stage publish --tag next`.
It contains no direct `npm publish` command and no long-lived npm write token.
The remaining registry boundary is npm trusted-publisher configuration,
successful staging, maintainer inspection, explicit 2FA approval, and clean
public-registry/install verification. See `docs/NPM-RELEASE.md`.

The current integration gate after registry publication remains measured
independent adoption and a production authority/signing provider. DoneState has
named merge, deployment, and release receipts as future lifecycle candidates.
AgentProof has not enabled those runtime actions: production authority/signing,
action-specific threat models, deterministic provider reconciliation, OpsTruth
verification fixtures, and exact canaries remain gates. The candidate adapter
boundary is documented in `docs/protocols/donestate-lifecycle-adapter.md`.
