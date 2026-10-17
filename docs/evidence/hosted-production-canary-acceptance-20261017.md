# Bounded hosted production authority canary — accepted 17 October 2026

## Exact production subject

- Repository: `AyobamiH/agentproof`; source/merge commit: `47587087565ac312b56909cf7a5d32a4d371d7c4` ([merge #12](https://github.com/AyobamiH/agentproof/pull/12)).
- [Successful GitHub Actions canary #39008214371](https://github.com/AyobamiH/agentproof/actions/runs/39008214371): `workflow_dispatch` on protected `main`; 17 of 17 checks **PASS**.
- Immutable GitHub OIDC subject pinned to `repo:AyobamiH@47716486/agentproof@1317413810:environment:agentproof-production-canary`; signature, service-specific audience, owner/actor IDs, workflow identity, protected main ref, event, hosted runner and exact source SHA enforced.
- Approval Worker deployment version: `9e7b4492-2b79-43d4-9248-30d2dfb28e94`. Receipt Worker deployment version: `973c38b7-0a3a-4692-963e-1398a51782bd`.
- Both Workers returned `enabled:true`, their respective role and exact source pin, and HTTP 401 to unauthenticated signing/approval attempts. Separate pre-provisioned Ed25519 private keys remain in Cloudflare encrypted Worker secrets; this is **software custody**, not HSM/non-exportable custody.

## Preserved proof

The GitHub Actions artifact `production-provider-canary` contains the signed exact approval and both Receipt V2 documents. Its archived JSON SHA-256 is `f60d0efab65a2c30591e125227e23bd719cb26a7d42449cd0d787cb03971b90a`.

A separate read-only verification of that downloaded artifact confirmed: initial receipt trusted under the independently configured public fingerprint; authenticated compensation successor trusted with its original predecessor; an orphan successor rejected. The test demonstrates live approval, durable approval replay, development-policy rejection before mutation, lost-signing-response reconciliation without reexecution, exactly-once effect retry, independent offline signature verification, signer authority refusal and clean restoration of a disposable repository.

Two earlier failed attempts and their rollback/deployment evidence remain unchanged in [immutable OIDC refusal history](hosted-production-oidc-refusals-20261017.md). Those failures were not overwritten or counted as passes.

## Boundaries and maintenance

This is a **single pinned GitHub Actions repository-patch canary**. Its runtime policy does not permit arbitrary repository writes, real merge/deploy/release operations, customer actions, DoneState consequence authority, or OpsTruth VERIFIED decisions. It earns zero independent installation/adoption credit. Ten actual external installations, action-specific release/deployment/merge contracts and independent outcome verification remain separate gates.

When `main` changes, the protected `workflow_sha` and source commit no longer match a prior Worker pin. The provider fails closed until separately deployed with the new reviewed main SHA, followed by a fresh authenticated canary. Historical receipt trust pins remain immutable across any re-pin. The `ENABLED=false`, zero-SHA committed configurations are the rollback authority; the service was already demonstrably disabled and restored during correction. No package was republished.
