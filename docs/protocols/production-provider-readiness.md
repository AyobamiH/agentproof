# Production provider readiness

Status: external SDK adapters and a narrow hosted canary implementation in unreleased source. Separate Cloudflare approval/signing services are provisioned disabled; live activation evidence is still required.

The portable SDK already accepts a `SigningProvider` with asynchronous `keyId()`,
`publicKeyPem()` and `signCanonical(payload)`. An integration can retain signing
material outside AgentProof and return an Ed25519 signature through this boundary.
This interface does not establish key custody, a production identity, or permission
to sign. The bundled PEM and development-authority adapters remain development tools.

## Acceptance evidence required

| Boundary | Required evidence |
| --- | --- |
| Approval authority | Named production issuer and policy owner; transaction-bound signed decisions; independently configured trusted fingerprint; deny, expiry, replay and altered-binding fixtures |
| Receipt signer | Selected external Ed25519 service, non-exportable key custody where required, signer identity and public fingerprint delivered out of band, least-privilege access, documented rotation/revocation |
| Role separation | Proposer and executor cannot call approval or receipt signing services; signer receives verified evidence under an enforced service policy; deployed access-control evidence |
| Failure recovery | Timeout/unavailable/invalid-signature/key-rotation cases; durable verified state survives outage; reconciliation signs without applying a second mutation |
| Offline trust | Pin the expected fingerprint and production environment; reject a development decision, untrusted key, tampered payload and unauthenticated predecessor |
| Activation | One exact disposable production-authority canary with bounded repository/path policy, signed approval, independent result verification, authenticated compensation evidence and an owner-approved rollback procedure |

The provider must sign AgentProof's exact domain-separated Receipt V2 input, not a
reformatted JSON object. See [Receipt V2](signed-receipt-v2.md). An embedded key is
never a trust anchor. Do not turn a development approval into production authority
by changing an environment string.

`src/test/signing-provider-boundary.test.ts` exercises the concrete Vault adapter
and external approval client against disposable mock services and fixture identities: a signer outage after verified
mutation, successful reconciliation, exactly-once retry and rejection of a development
decision when production policy is required. This proves recovery mechanics only. It is not evidence
of an external service, production IAM or hardware-backed custody.

The optional [production-provider adapters](production-provider-adapters.md) now
implement pinned Vault Transit signing and external signed-approval consumption.
Their adversarial fixtures validate transport, request binding and cryptographic
responses. No live Vault or approval service is inferred from these tests.

## Unresolved external inputs

The [hosted canary contract](hosted-production-canary.md) records the selected Cloudflare account, separate software-custodied keys, public trust pins and exact GitHub workload policy. Configuration defaults to disabled. Its single disposable target does not establish a general-purpose production authority, hardware custody or permission for DoneState consequences. Production keys must never be fabricated from development fixtures.

DoneState merge, deployment and release remain separate candidates in the
[adapter boundary](donestate-lifecycle-adapter.md). Each needs its own threat model,
deterministic reconciliation, OpsTruth fixture and exact canary after adoption and
production authority gates. Wider integrations and hosted services remain later
roadmap work.
