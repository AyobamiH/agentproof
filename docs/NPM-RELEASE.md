# npm prerelease release procedure

AgentProof uses staged npm publishing so CI can prepare an exact prerelease with
short-lived GitHub OIDC credentials while a human package maintainer retains the
final 2FA publication boundary.

## Current release subject

- package: `@oneclicksystems/agentproof`
- version: `0.1.0-rc.5`
- npm tag: `next`
- canonical source: `AyobamiH/agentproof`
- workflow: `.github/workflows/release-prerelease.yml`
- allowed CI effect: `npm stage publish` only
- direct `npm publish`: not present in the workflow
- long-lived npm publish token: not required

The GitHub prerelease and tarball already exist. npm registry publication is a
separate release boundary.

## One-time npm trusted-publisher setup

Run this while authenticated as an npm maintainer of
`@oneclicksystems/agentproof` with 2FA enabled:

```sh
npm trust github @oneclicksystems/agentproof \
  --file release-prerelease.yml \
  --repository AyobamiH/agentproof \
  --allow-stage-publish
```

The workflow filename is supplied without the `.github/workflows/` prefix.

## Stage RC5

After the trusted publisher exists, dispatch **Stage AgentProof prerelease to
npm** on `main` with:

```text
version = 0.1.0-rc.5
```

The workflow verifies the exact package name and version, refuses a version that
is already public, runs `npm ci` and the complete `npm run check` gate, then
executes:

```sh
npm stage publish --tag next --access public
```

Because RC5 is a prerelease, the explicit `next` tag is part of the staged
subject and must not be silently changed to `latest`.

## Review before publication

Do not treat a green staging workflow as publication. Inspect the staged package
using npmjs.com or an authenticated maintainer CLI:

```sh
npm stage list @oneclicksystems/agentproof
npm stage view <stage-id>
npm stage download <stage-id>
```

Compare the staged tarball with the expected RC5 package contents and retain the
stage ID plus provenance/source information.

## Publish boundary

Only after review should a maintainer explicitly approve the stage with npm 2FA:

```sh
npm stage approve <stage-id>
```

Then verify from the public registry and a clean consumer environment:

```sh
npm view @oneclicksystems/agentproof@0.1.0-rc.5 version dist.integrity dist.tarball
npm install @oneclicksystems/agentproof@0.1.0-rc.5
```

Publication is complete only when the registry serves the exact version, a clean
install works, the CLI/package exports match RC5, and the provenance/source
binding is retained as release evidence.

## Boundaries

This lane does not add production authority, a KMS/HSM signer, a hosted
coordinator, a new AgentProof action type, DoneState consequence authority, or
OpsTruth verification claims. Those remain separate product gates.
