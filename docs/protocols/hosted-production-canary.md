# Hosted production provider canary

This service authorises only the existing repository-patch capability in one disposable GitHub Actions repository. It does not authorise a DoneState merge, deployment or release. The public RC6 package is unchanged. Source-based service deployment and npm publication are separate operations.

## Account, owner and custody

The policy owner is AyobamiH (immutable GitHub user ID 47716486). Two Cloudflare Workers in account `6ddcbcb8474f1a7e460b2f0aabec0e2f` hold separate approval and receipt Ed25519 keys. Wrangler provisions private keys through stdin into encrypted Worker secrets. Private keys are never committed, written to a local key file, passed in arguments or returned in reports. Public pins live in `services/production-provider/public-trust.json` and are reviewed with source.

This is software key custody. Cloudflare account administrators and authorised deployers remain trusted and could replace service code or access bindings. Hardware protection and non-exportability are not claimed. A deployer's existing Cloudflare OAuth session is infrastructure authority; the canary receives no such credential.

## Enforced policy and roles

GitHub signs the coordinator's short-lived OIDC token. The repository has `use_immutable_subject: true` (verified against GitHub's authenticated OIDC configuration on 17 October 2026), so the exact `sub` includes immutable owner and repository IDs, not the legacy name-only subject. The services verify its RS256 signature against GitHub's fixed JWKS endpoint, issuer, service-specific audience, lifetime, owner/repository numeric IDs, actor ID, main ref, workflow path, workflow_dispatch event, hosted runner, named environment, and exact configured workflow/source commit. Disabled or unconfigured services fail closed. There are no bearer tokens stored in Actions secrets.

The immutable workflow acts as trusted coordinator. The proposer prepares one fixed intent. The external authority validates the complete request and signs a production decision. The SDK's executor child receives only PATH and NODE_ENV, without OIDC or signing credentials. The signer verifies the pinned authority decision, exact request/payload bindings and internally consistent observed evidence before signing. A separate CLI process independently checks the receipt against the configured public fingerprint. This is independent cryptographic verification, not an OpsTruth re-observation or an independent adopter.

The only permitted effect writes `after\n` over `before\n` in tracked `canary.txt`, on main, inside `/tmp/agentproof-production-canary-<run>-<attempt>/repository`. State must be in the adjacent state directory. Intent, action, paths, before/proposed manifests, empty verification command plan, expiry, nonce and correlation are checked. No user-selected command or repository is accepted. The executor has no OS-enforced sandbox; the trusted source and disposable hosted runner are explicit assumptions. This policy is unsuitable for arbitrary untrusted workloads.

## Durability and recovery

Each service uses its own SQLite Durable Object ledger, scoped to the authenticated run and attempt. An approval is durably bound to one request digest before response. Identical retries return that decision; conflicting requests fail. Signing records bind one semantic initial result and one semantic compensation. A lost response can regenerate receipt ID and issuance time, so at most eight immutable receipts for the same semantic result are accepted. Existing identical payloads return their original proof. Every compensation must reference an initial receipt already recorded by this signer.

The canary discards one real successful signing response, then reconciles verified durable SDK state without applying another mutation. It checks repeat execution while signing is unavailable, verifies the receipt offline, signs and verifies its compensation successor, and observes the restored clean repository. Receipts and approval are retained as public engineering evidence. No exactly-once network delivery or atomic cross-provider transaction is claimed.

## Deployment and rollback

1. Inspect the selected account and ensure neither service name exists. Run the full repository check and provider check.
2. From `services/production-provider`, run `node provision.mjs` once. It creates disabled Workers, separate keys and public pin configuration. An interrupted bootstrap must be inspected; never blindly overwrite an existing key.
3. Commit public configuration and code through a normal CI-green PR. No secret is included. Create the `agentproof-production-canary` GitHub environment restricted to main.
4. Build the exact merged source. Deploy both Workers using temporary configuration with `ENABLED=true` and `TRUSTED_SOURCE_SHA` set to that exact commit. The committed default remains disabled. Record the deployment version IDs and health responses.
5. Dispatch `production-provider-canary.yml` on main. Preserve its exact source SHA, run URL, artifact digest, full report and signatures. A failed run is evidence and must not be overwritten.
6. To revoke access, redeploy the exact service with `ENABLED=false` (or an all-zero source pin), then confirm authenticated requests fail. Never delete the durable ledger as a retry mechanism. Restore only the reviewed source pin after diagnosing the cause.

Any new source commit needs an explicit deployment and workload-pin update. Rotation creates a new key identity and reviewed out-of-band pins; old receipts retain their original trust history. Revoke the old key in consumers rather than rewriting old evidence. If custody is compromised, disable both services first and rotate both credentials and affected pins. There is no export/backup path in this bootstrap; recovery from a lost secret requires rotation.

## Acceptance limits

Passing this canary proves the narrow live service, GitHub identity boundary, durable replay/recovery, pinned signatures and compensation path. It gives zero independent-adoption credit. It does not prove an arbitrary production policy, a hosted coordinator product, KMS/HSM custody, or DoneState consequence authority. Those milestones retain their own evidence and activation gates.
