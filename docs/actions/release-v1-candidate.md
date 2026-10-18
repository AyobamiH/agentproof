# Release v1 — source-only candidate

**Status (17 October 2026): implemented and tested only against disposable/provider fixtures. NOT activated, deployed, published to npm, or authorised as a DoneState consequence.**

This narrowly scoped action publishes **one already-existing GitHub draft prerelease** with an exact tag, commit, two existing assets (one package and one provenance document), pinned SHA-256 metadata, immutable numeric owner/repository IDs and `make_latest:false`. It never creates a tag, uploads assets, changes repository source, merges a PR, deploys a Worker, or publishes npm packages. No arbitrary release command or generic OAuth token injection is supported.

## Explicit roles and source boundaries

- **Proposer:** supplies a preselected release subject, transaction ID, nonce and idempotency key. Subject changes after preparation are refused.
- **Approval authority:** signs `agentproof.release.approval.v1` over the exact release subject digest, transaction ID, nonce, one issuer, `production` environment and a maximum-ten-minute expiry. Only separately configured Ed25519 authority fingerprints are trusted. A development decision cannot authorise publication.
- **Execution coordinator:** stores an `intent_recorded` transaction and unique nonce/idempotency/subject in a durable SQLite ledger (`WAL`, `FULL`, `BEGIN IMMEDIATE`) before the first possible external effect. It transitions to `publish_attempted` before issuing the single allowed PATCH. A restart or an ambiguous HTTP response may **only** perform read-only GitHub GET reconciliation; it never replays the PATCH automatically.
- **GitHub publisher:** receives a short-lived externally injected credential. It re-reads the exact numeric repository/owner, tag ref, release ID, asset names, digests and draft status before one request to `PATCH /repos/{owner}/{repo}/releases/{release_id}` with exactly `draft:false`, `prerelease:true`, `make_latest:"false"`. Client endpoints are fixed to `api.github.com`, redirects are prohibited, response size/time are bounded and error bodies/tokens are not retained.
- **Receipt signer:** a separate injected Ed25519 `SigningProvider` identified by an independently configured public fingerprint and distinct from the approval authority. It signs the immutable, domain-separated release Receipt V2 payload *only after* an exact published-state readback. A signer outage leaves the result `verified` and the canonical payload durably available for signer-only recovery.
- **Offline verifier:** validates the release-specific domain `agentproof.signed-receipt.v2.release\0`, the exact subject/payload/approval binding, transaction/nonce/idempotency, independently pinned authority and signer keys, original draft state, final published state, and signature. It explicitly reports `independentOutcomeVerified:false` and `compensationState:not_supported`.

The existing `agentproof.repository_patch.v1` Receipt V2 and `verifyReceiptV2` are **unchanged**. The release receipt is its own versioned structural variant with a separate validator; consumers must not silently pass it to the repository-patch verifier or mistake cryptographic trust for completed external verification.

## Failure and side-effect contract

One semantic release target is claimed at most once per SQLite state root. The `publish_attempted` state is durable before the PATCH; if a worker crashes between recording intent and issuing the PATCH, a fresh run remains ambiguous and **does not** make a second attempt. A successful PATCH with a lost HTTP response can be reconciled by reading the exact published release. Wrong repository, wrong tag commit, changed asset/provenance metadata, extra assets, expired/wrongly signed approval, signer outage, incomplete readback, or revoked token fail closed. Wrong published state is not accepted as verification. A later operator must investigate any unresolved ambiguous effect.

Publishing an existing release is not reliably reversible. **No automatic compensation**, deletion, rollback or historical receipt mutation is permitted. If withdrawal is ever needed it must be a new, separately authorised consequential action; immutable GitHub releases may prohibit edits. This candidate is not a distributed exactly-once transaction: another authorised publisher or a different state store could race the preflight and PATCH. Production requires a one-target global lock/fencing service and exclusive scoped publisher credentials before attributing effect ownership.

GitHub asset `digest` fields are provider metadata. The current source-only candidate verifies those digests **as reported by the provider**, not by independently downloading and hashing every release asset. An external OpsTruth read lane must re-observe the released tag, provenance and downloaded artifact bytes and provide its own independently signed decision. AgentProof cannot issue DoneState `VERIFIED`.

## Acceptance and missing production gates

Source checks cover execution, one PATCH, durable replay/nonce/target uniqueness, lost response, signer outage, altered approval, invalid digest/tag, stale state and a fixed-path mocked GitHub REST client. The new schemas are `release-v1-subject`, `release-v1-approval`, and `release-v2-receipt`. They are **candidate** schemas not added to published RC6's public package API or CLI. No live publisher token, new Cloudflare release authority or signer has been configured by this source change.

Before any live canary or customer use:
1. Select one explicitly disposable **real** GitHub release subject and pre-create a sealed draft with exact two assets. Verify the actual owner/repository numeric IDs and real SHA-256 bytes/provenance independently.
2. Provision a **separate**, release-specific production approval service and Ed25519 receipt signer, keys/trust pins and durable global target fencing. **Never widen** the existing disposable repository-patch Worker policy or reuse its signing keys.
3. Restrict one GitHub-hosted source-pinned workflow and installation credential to the exact test repo, release and operation; require required CI and test denied/malformed/foreign identities, lost effect response and signer outage.
4. Run an authenticated production release publication **once**. Preserve GitHub action URL, exact release ID/tag/asset digests, signed approval/receipt, immutable evidence and read-only recovery. Do not replace a failed canary with a claimed pass.
5. Build a separate OpsTruth read-only release verifier which actually hashes the bytes and verifies provenance, signs the exact subject decision under its own key, then reconcile one isolated DoneState run to a terminal verified or honestly failed/uncertain outcome.
6. Pass independent review and staged maintainer 2FA before publishing any new npm release. A source merge does not change the immutable published RC6 package.

## Explicit non-claims

This is not a hosted production release service, HSM custody, arbitrary GitHub release publisher, npm publication permission, independent external user adoption, OS-enforced sandbox, verified DoneState release, or OpsTruth production acceptance. The existing successful [17/17 repository-patch canary](https://github.com/AyobamiH/agentproof/actions/runs/39008821740) remains a distinct, unchanged authority class.

For hosted canary acceptance, a validated HTTP 200 publication response may be retained as bounded public evidence (raw body, status and GitHub request ID). Tokens, request headers, failed or malformed response bodies are never retained. Missing successful response evidence remains null and is recovered through signed independent readback without repeating publication.
