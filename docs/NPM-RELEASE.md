# npm prerelease release procedure

AgentProof uses a two-step release boundary: GitHub creates the exact prerelease
artifact from the merged source, then npm publishing is staged and requires a
human maintainer to approve the exact package with 2FA.

## Current release subject

- package: `@oneclicksystems/agentproof`
- version: `0.1.0-rc.6`
- npm tag: `next`
- canonical source: `AyobamiH/agentproof`
- GitHub release tag: `v0.1.0-rc.6`
- GitHub release workflow: `.github/workflows/release-github-prerelease.yml`
- later npm OIDC workflow: `.github/workflows/release-prerelease.yml`

RC5 remains immutable historical prerelease evidence. RC6 is a new release
subject because current main contains packaged and repository-level changes that
post-date the RC5 tag.

## 1. Create the exact GitHub prerelease

Merging RC6 to `main` triggers **Publish AgentProof GitHub prerelease**. The
workflow:

1. reads the exact package version from the merged commit;
2. requires a prerelease semantic version and matching release notes;
3. runs `npm ci` and the complete `npm run check` release gate;
4. packs the exact merged source;
5. creates `v0.1.0-rc.6` at that exact commit and uploads the generated tarball;
6. does nothing if the release already exists.

The workflow has GitHub `contents: write` authority only. It has no npm
credential and cannot publish to npm.

## 2. Bootstrap the first npm package

`@oneclicksystems/agentproof` has not previously existed on npm. The first
registry release is therefore deliberately bootstrapped from an authenticated
publisher shell rather than by introducing a long-lived CI write token.

First confirm the publisher identity:

```sh
npm whoami --registry=https://registry.npmjs.org/
```

The expected publisher account is the account authorised for the
`@oneclicksystems` scope.

Download the exact GitHub release asset:

```sh
mkdir -p /tmp/agentproof-rc6
cd /tmp/agentproof-rc6

gh release download v0.1.0-rc.6 \
  --repo AyobamiH/agentproof \
  --pattern 'oneclicksystems-agentproof-0.1.0-rc.6.tgz'
```

Inspect the GitHub-recorded asset digest before staging:

```sh
gh api repos/AyobamiH/agentproof/releases/tags/v0.1.0-rc.6 \
  --jq '.assets[] | select(.name=="oneclicksystems-agentproof-0.1.0-rc.6.tgz") | {name,digest,size}'
sha256sum oneclicksystems-agentproof-0.1.0-rc.6.tgz
```

The local SHA-256 must match the `sha256:...` digest reported by GitHub.

Stage the exact tarball with the prerelease tag:

```sh
npm stage publish ./oneclicksystems-agentproof-0.1.0-rc.6.tgz \
  --tag next \
  --access public
```

Staging is not publication. Review the staged package:

```sh
npm stage list @oneclicksystems/agentproof
npm stage view <stage-id>
npm stage download <stage-id>
```

Only after the staged artifact matches the GitHub RC6 subject should the
maintainer approve it:

```sh
npm stage approve <stage-id>
```

npm requires 2FA for that approval.

## 3. Verify the public registry

After approval:

```sh
npm view @oneclicksystems/agentproof@0.1.0-rc.6 \
  version dist.integrity dist.tarball

LAB="$(mktemp -d)"
cd "$LAB"
npm init -y >/dev/null
npm install @oneclicksystems/agentproof@0.1.0-rc.6
./node_modules/.bin/agentproof --help
```

Retain the GitHub release URL, release asset digest, npm stage ID, registry
integrity/tarball metadata, and clean-install result as immutable release
evidence.

## 4. Enable stage-only OIDC for later releases

Once the package exists on npm, configure its trusted publisher with stage-only
authority:

```sh
npm trust github @oneclicksystems/agentproof \
  --file release-prerelease.yml \
  --repository AyobamiH/agentproof \
  --allow-stage-publish
```

The workflow filename is supplied without the `.github/workflows/` prefix.

For later prereleases, dispatch **Stage AgentProof prerelease to npm** on
`main` with the exact package version. The workflow fails closed unless:

- the package name and requested version match `package.json`;
- the matching `v<version>` GitHub release tag exists;
- that tag resolves to the exact current `main` commit;
- the version is not already public on npm;
- `npm ci` and `npm run check` pass.

It then executes only:

```sh
npm stage publish --tag next --access public
```

There is no `npm publish` command and no long-lived npm write token in the
workflow. A maintainer still inspects and approves each staged package with 2FA.

## Product boundaries

Publishing RC6 does not add production authority, a KMS/HSM signer, an
OS-enforced executor sandbox, a hosted coordinator, a second action type,
DoneState consequence authority, or an OpsTruth production integration. Those
remain separate product gates.
