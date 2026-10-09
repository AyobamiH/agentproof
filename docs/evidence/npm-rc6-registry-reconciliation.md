# RC6 npm registry reconciliation

Observed on 9 October 2026. This record reconciles the exact GitHub RC6 release
artifact, npm staging subject, public registry bytes, clean consumer behaviour,
and the remaining authority boundary.

## Release subject

- Package: `@oneclicksystems/agentproof@0.1.0-rc.6`
- Canonical source: `AyobamiH/agentproof`
- Source and tag commit: `a0ee17a70d05bc3c339c0c15be6bb38b4517771a`
- GitHub release: `https://github.com/AyobamiH/agentproof/releases/tag/v0.1.0-rc.6`
- Release asset: `oneclicksystems-agentproof-0.1.0-rc.6.tgz`
- Asset size: `72720` bytes
- GitHub-recorded and locally verified SHA-256:
  `f9dd7eb65f5809c69584624272c0c7dc13a84209c4a2daee338dfee43f5050ca`

## Guarded staging and approval

The authenticated npm publisher was `oneclicksystems`. Before staging, the
public registry contained RC5 only and `npm stage list` returned no existing
AgentProof stages. The exact GitHub asset was submitted with tag `next` and
public access.

- Stage ID: `bc0b5c16-288d-4d3a-8099-72795479f193`
- Created: `2026-10-09T12:40:32.232Z`
- Stage SHA-1: `791a23ec91489eaf5af2c0ce9aa03ff01440bb6f`
- Stage integrity:
  `sha512-+PoO/Q2su6AreygVjMzmeVQEA/+H2/LXVHqNw+ttVh/n+7m0tl52j3JiEm3tj2fo36sJq20mzEhEsnvub8tRFA==`

After npm validation completed, the staged tarball was downloaded. Its bytes
matched the GitHub release asset exactly. The maintainer then approved that
stage through npm's proof-of-presence flow with two-factor authentication.

## Public registry readback

The registry records publication at `2026-10-09T12:47:53.005Z`.

- `next`: `0.1.0-rc.6`
- `latest`: `0.1.0-rc.5`
- Registry tarball:
  `https://registry.npmjs.org/@oneclicksystems/agentproof/-/agentproof-0.1.0-rc.6.tgz`
- Registry SHA-1: `791a23ec91489eaf5af2c0ce9aa03ff01440bb6f`
- Registry integrity:
  `sha512-+PoO/Q2su6AreygVjMzmeVQEA/+H2/LXVHqNw+ttVh/n+7m0tl52j3JiEm3tj2fo36sJq20mzEhEsnvub8tRFA==`
- File count: `84`
- Unpacked size: `340895` bytes

The registry tarball SHA-256 is
`f9dd7eb65f5809c69584624272c0c7dc13a84209c4a2daee338dfee43f5050ca`
and its bytes match the GitHub asset exactly. `npm audit signatures` verified
the registry signature for the installed package.

## Independent clean installation

A new temporary project and new npm cache installed the exact public registry
version on Node.js `v24.18.0` with npm `11.21.0`.

- installed package version: `0.1.0-rc.6`
- `agentproof --help`: passed and exposed the documented portable commands
- root SDK import: passed with 20 public exports
- `./development-authority` import: passed with 2 public exports
- exported schemas: all 9 resolved and parsed as JSON

## Trusted publisher and remaining boundary

No trusted publisher existed at inspection time. After publication, npm trust
configuration `754305a3-78a0-483b-b78d-1b2fe95b0e95` was created for GitHub
repository `AyobamiH/agentproof`, workflow `release-prerelease.yml`, with
`stage publish` permission only. It has no direct `npm publish` permission.
Future stages still require explicit maintainer inspection and 2FA approval.
No persistent npm write credential was added to GitHub or the repository; the
temporary local npm session was removed after reconciliation.

Registry availability proves distribution of this developer prerelease. It does
not establish production signing authority, a KMS/HSM signer, an OS-enforced
executor sandbox, a hosted coordinator, DoneState consequence authority, an
OpsTruth production integration, or any action beyond
`agentproof.repository_patch.v1`.
