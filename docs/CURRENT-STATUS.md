# Current status

Lifecycle-contract implementation merge: `2ec72f15a50881104ad03d92cde133d7a2351685`

## Release history

- **RC1:** validation exposed a signed-receipt trust defect: important identities and authority claims were not all cryptographically bound. RC1 receipts are legacy unbound evidence and can never verify as trusted.
- **RC2:** Receipt V2 repaired the trust boundary, but independent validation was incomplete and compensation returned the transaction ID where correlation was required.
- **RC3:** correlation semantics and validation passed, but public-package preflight failed because licensing and prerelease packaging were not ready.
- **RC4:** Apache-2.0, public metadata, executable packaging, 46/46 AgentProof tests, 395/395 Operator tests, deterministic packing, and Developers A–D passed. Its publication request was unconsumed and superseded before publication by standalone productisation.
- **RC5 (`0.1.0-rc.5`):** standalone source, tag, GitHub prerelease, and packaged tarball are published at `github.com/AyobamiH/agentproof`. It remains immutable historical prerelease evidence and was never published to npm.
- **RC6 (`0.1.0-rc.6`):** current release subject. It carries the same proven repository-patch runtime plus reproducible Git consumption, repository CI/governance, the packaged AgentProof skill, the DoneState lifecycle-adapter boundary, and guarded GitHub/npm release procedures. Merge to main creates the GitHub prerelease only after the exact RC6 release gate passes. The npm prerelease remains unpublished.

## Supported capability

Only `agentproof.repository_patch.v1`: an allowlisted patch against an exact clean local Git repository. It does not commit, push, tag, deploy, migrate, or access remotes.

## Known limitations

The package is ESM-only and requires Node.js 22.5+, Git, and a local filesystem. Linux, macOS, and WSL2 are assumed; native Windows is unvalidated. State/signing are local. There is no production authority/KMS/HSM, OS-enforced executor sandbox, hosted coordinator, or distributed atomic commit. Explicit signer pinning is required. Development authority is not production authority.

## Active gate

RC6 is the current release subject. The repository now has two release boundaries:

1. `.github/workflows/release-github-prerelease.yml` creates the exact GitHub RC6 tag and prerelease tarball only after `npm run check` passes on the merged commit.
2. `.github/workflows/release-prerelease.yml` is the stage-only OIDC lane for npm once the package exists and a package-level trusted publisher has been configured. It refuses to stage unless the release tag resolves to the exact current main commit, contains no direct `npm publish` command, and requires no long-lived npm write token.

Because `@oneclicksystems/agentproof` has never existed on npm, the first registry publication is an explicit bootstrap: stage the exact GitHub RC6 tarball from an authenticated publisher session, inspect it, approve with 2FA, verify the public registry and clean install, then configure the stage-only trusted publisher for later releases. The npm prerelease remains unpublished. See `docs/NPM-RELEASE.md`.

The current integration gate after registry publication remains measured
independent adoption and a production authority/signing provider. DoneState has
named merge, deployment, and release receipts as future lifecycle candidates.
AgentProof has not enabled those runtime actions: production authority/signing,
action-specific threat models, deterministic provider reconciliation, OpsTruth
verification fixtures, and exact canaries remain gates. The candidate adapter
boundary is documented in `docs/protocols/donestate-lifecycle-adapter.md`.
