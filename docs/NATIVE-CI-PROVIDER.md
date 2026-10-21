# Native CI provider migration — 21 October 2026

The repository owner explicitly authorised completing the switch to Cloudflare's native Linux builds. `governance/native-ci-provider-policy.json` is the current reviewed source policy; `native-ci-before-20261021.json` preserves the exact pre-migration ruleset. The 4 September manifests/readbacks retain historical observations and are not fresh proof of the current check provider. No historical evidence is overwritten.

## Required gate and coverage

The native required context is **Cloudflare Pages**, pinned to **Cloudflare Workers and Pages App 85455**. It is accepted only when the exact commit, immutable Pages deployment, full declared manifest jobs/commands, unchanged source inventory and native App check independently agree. The reviewed runner and manifest hashes are pinned. The source-policy tests reject spoofed providers, missing checks, changed pipelines, reduced freshness, new bypasses, removed PR protection and paid-execution authority. A skipped/cancelled/failed build is not a pass.

All non-CI rules, review-thread resolution, strict freshness, current bypass actors, signature settings and deletion/non-fast-forward protection remain unchanged. This migration does not use a bypass. AgentProof still requires its separate genuine macOS check; Pages Linux does not satisfy it.

## Execution and cost scope

Only same-repository trusted maintainer branches are eligible. Initially enable only `ci/native-pages-provider-20261021`; enable the CI project's main branch only after an exact-main hosted acceptance. These Pages projects publish sanitised static engineering receipts, with no Functions, production secrets, custom domains or customer application deployment. Use the existing Free quota; no plan upgrade, paid Actions, overage purchase or execution-container fallback is authorised. A quota refusal remains a stopped job.

## Coordinated rollout

1. Review and test this CI-only branch, then obtain a real native Pages pass on its exact head.
2. Independently verify the provider receipt and App 85455 check and compare the current ruleset to the preserved baseline immediately before applying only the required-check array.
3. Re-read effective branch rules; preserve every other rule. Merge only through the normal protected PR path when all remaining requirements are met.
4. Re-run on exact merged main before enabling automatic CI on main. Independently verify a new native check, not a manually posted green status.

Source policy, live enforcement, merge, hosted CI and production release remain separate facts. Legacy GitHub workflow files remain as historical command/reference coverage; disable superseded routine workflows only after the native gates are accepted. Do not disable or counterfeit AgentProof's separate macOS requirement. Do not merge unrelated release-recovery or reviewer-login branches as part of this CI-only change.

## Other active work

This branch starts at current main and extracts only the previously proven CI runner/manifest from the existing recovery work. It does not include that work's runtime, signing, replay/recovery, hosted login or release service modifications. It is a narrowly scoped provider migration, not a duplicate recovery PR. Other work must incorporate the new main policy before its normal strict-freshness acceptance.

Run `npm run ci:policy` and the full manifest. The policy validator does not call remote APIs or claim that a rule was applied. Provider receipts and the owner-controlled migration journal supply that evidence separately.
