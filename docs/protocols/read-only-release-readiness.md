# Public read-only release readiness observation

**Status: source-only monitoring code (17 October 2026). No production signer, source pin, GitHub release or external user record is changed by this protocol.**

The AgentProof hosted repository-patch approval and receipt Workers use an *exact* trusted source SHA. Protected main advances whenever reviewed source merges. On 17 October, both existing Workers remained healthy and enabled on historical SHA `2ed24b95ec90f36d52132cc3f98fc9d937ade4da` while the reviewed source had advanced to `b6724b1927e26aa7284371ec7fdd974aeefcbf42`. This makes a new current-main GitHub OIDC canary fail closed until a permitted re-pin, even though the old live health endpoint still returns HTTP 200. [AgentProof #17](https://github.com/AyobamiH/agentproof/issues/17) records the required acceptance and previously refused deployment action.

The three **distinct release-v1** services are deployed with reviewed binaries but remain disabled with zero SHA, no release target or signing keys. Their disabled/401 health is an operational readiness condition, **not** independent verification or release acceptance. The existing OpsTruth public MCP still serves its own previously reviewed version and must not be conflated with the new release-specific verifier.

## Bounded observation

Run `node scripts/release-readiness.mjs --output /tmp/readiness.json` from the repository root. It performs only ten statically allowlisted public **GET** requests, uses no credential callback or GitHub write token, rejects redirects, bounds response size/time and retains only non-secret statuses, source commits, service identities and release counts. It does not call the release mutation endpoint, issue approvals, sign receipts, change Cloudflare variables, use email, or scan private repositories.

| Evidence | Meaning |
| --- | --- |
| AgentProof/DoneState/OpsTruth public main refs | Current commits observed through GitHub public branch metadata |
| Existing patch approval/receipt `/health` | Whether both live Workers still trust exact AgentProof main |
| Three release-specific `/health` endpoints | Whether source remains zero-pinned, disabled and non-authoritative |
| Disposable release inventory | Whether the selected test-only GitHub repository currently has observable releases |
| Existing OpsTruth MCP `/health` | Whether the original read-only public tool surface remains healthy |

Any API outage, rate limit, missing or malformed response is **UNPROVEN**, not empty/healthy. A non-empty GitHub release list is **RELEASES_EXIST_UNVERIFIED**, not a verified consequence. No attempt is made to count genuine outside installations from downloads or issue totals. The output permanently labels independent adoption not measured and the real release consequence NOT_VERIFIED.

`--strict` returns nonzero only for source drift, unexpected release authority activation, or incomplete public readback. Otherwise, the snapshot may still explicitly say `NO_LIVE_RELEASE` or `RELEASE_OUTCOME_NOT_VERIFIED`. A green read-only job never authorises release publication.

## Ongoing readback

[Read-only release readiness](../../.github/workflows/release-readiness.yml) is a minimally permissioned GitHub Actions job on protected-main pushes, once daily, or explicit workflow dispatch. It has `contents: read`, `persist-credentials: false`, no `id-token`, no secrets, no GitHub mutation/API POST, no Cloudflare deployment, no release permission and no production source-pin update. Dependencies use pinned GitHub Actions commits. It runs eleven injected-reader negative and observation tests, reads the public endpoints, emits a human-readable action summary and uploads a workflow-run JSON artifact for 14 days.

While #17 is unresolved, its strict job may deliberately fail with `PATCH_SOURCE_PIN_DRIFT`; this is an accurate alert, **not** an outage or evidence of failed signing. GitHub workflow emails/notifications depend on account settings. There is no external alert-delivery guarantee. This job does not repair drift automatically because Cloudflare signing source changes are authority-sensitive and the previous attempt to change that production source pin was refused by platform controls.

## Exit gates

- **Source-drift gate:** deploy the already reviewed patch Worker source to the current protected main with preserved key fingerprints and scope, then repeat the independently verified 17/17 GitHub OIDC canary. Do not redeploy with an arbitrary latest SHA or override the source-check predicate.
- **Real release gate:** select one genuinely disposable public draft release with two signed/pinned assets, then get an explicitly permitted source-pinned publisher and separate authority identities, one actual GitHub publication, immutable AgentProof receipt, independently downloaded-byte and signed OpsTruth release decision, and a DoneState run-bound terminal observation.
- **Independent-adoption gate:** ten externally independent first-install observations, separately qualified from the automated test harness; see [AgentProof #14](https://github.com/AyobamiH/agentproof/issues/14).

No readiness status may substitute for these acceptance records.
