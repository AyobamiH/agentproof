# Decision log

## 2026-07-23 — Incubate separately inside OpenClaw Operator

- **Context:** AgentProof needed Operator approval dogfooding while mutating authority had to remain separate from read-only evidence tooling.
- **Decision:** Build an inactive `agentproof/` package boundary inside Operator; leave `coding-agent-skills` unchanged and read-only.
- **Alternatives:** mutate through skills; activate directly in Operator.
- **Evidence:** local-file lifecycle and durable boundary tests.
- **Consequences:** rapid reuse, but temporary source ownership inside Operator.
- **Reconsider when:** portable action and trust boundary are independently validated. Trigger met by RC4.

## 2026-07-25 — Portable CLI and SDK boundary

- **Context:** Testers and agents must use AgentProof without Operator knowledge.
- **Decision:** expose stable ESM CLI/SDK, schemas, structured errors, explicit state roots, and a separate development-authority subpath/binary.
- **Alternatives:** Operator-only API; framework-specific adapter.
- **Evidence:** installed-consumer and Developer A/B validation.
- **Consequences:** package contracts become compatibility surface.
- **Reconsider when:** adoption evidence demonstrates a necessary compatible extension.

## 2026-07-26 — Receipt V2 redesign

- **Context:** RC1 transport fields could influence trust without being signed.
- **Decision:** strict `{ payload, proof }`, domain-separated canonical signing, payload-derived identities, explicit signer trust, and append-only successors. RC1 is permanently untrusted.
- **Alternatives:** patch individual RC1 fields; re-sign historical receipts.
- **Evidence:** adversarial matrix and RC2–RC4 tests.
- **Consequences:** incompatible but necessary trust boundary.
- **Reconsider when:** only through a new version with migration and adversarial proof.

## 2026-07-28 — Apache License 2.0

- **Context:** RC3 failed public-package readiness under a conflicting custom preview licence.
- **Decision:** licence AgentProof package-scoped source/distribution under unmodified Apache-2.0; do not license unrelated Operator directories.
- **Alternatives:** retain custom terms; repository-wide licence.
- **Evidence:** authoritative owner decision and RC4 licence validation.
- **Consequences:** clear public reuse terms without changing Operator licensing.
- **Reconsider when:** a verified legal requirement demands review.

## 2026-07-28 — Standalone repository

- **Context:** RC4 proved portability; Operator incubation had become an incorrect permanent source boundary.
- **Decision:** make `AyobamiH/agentproof` the intended canonical repository and keep npm name `@openclaw/agentproof` for RC5.
- **Alternatives:** publish from Operator monorepo; rename package during extraction.
- **Evidence:** history-preserving subtree extraction and package validation.
- **Consequences:** clearer product ownership and documentation; coordinated adapter extraction required.
- **Reconsider when:** not expected; integrations must consume public contracts.

## 2026-07-29 — Correct npm package ownership

- **Context:** publication preflight proved the authenticated publisher does not control the npm `openclaw` organization scope; a local scoped name does not confer registry ownership.
- **Decision:** reissue unpublished RC5 as `@oneclicksystems/agentproof`, the available scope owned by the authenticated npm user.
- **Alternatives:** create or join an unrelated `openclaw` npm organization; use the already-occupied unscoped `agentproof` name.
- **Evidence:** authenticated `npm whoami` as `oneclicksystems`, `403` for `openclaw` organization authority, and package-availability checks.
- **Consequences:** replace the local release commit, tarball, Operator dependency, validation kit, and hash-bound approval; preserve and invalidate the unpublished old identity.
- **Reconsider when:** package ownership moves through an explicit npm transfer or organization decision.

## 2026-07-28 — OpenClaw is an adapter and consumer

- **Context:** AgentProof must be framework-neutral without losing canonical Operator approval/replay integration.
- **Decision:** standalone owns portable core; Operator retains task/approval mapping and integration/service activation only.
- **Alternatives:** circular imports; duplicated cores.
- **Evidence:** exact-tarball package-consumer integration tests.
- **Consequences:** Operator-specific semantics remain outside the package.
- **Reconsider when:** never for framework-specific ownership; extend public interfaces deliberately.

## 2026-07-28 — Restrict new actions by adoption evidence

- **Context:** Market rationale supports a broad future layer, but RC evidence proves only repository patch.
- **Decision:** validate ten independent installations and measured changes before selecting one additional action.
- **Alternatives:** implement the original speculative multi-action list.
- **Evidence:** product research, RC limitations, and absence of external adoption data.
- **Consequences:** near-term work focuses on distribution, comprehension, and production authority.
- **Reconsider when:** repeated users request the same action with a deterministic verification contract.
