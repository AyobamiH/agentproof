# Explicit production-provider adapters

Status: unreleased SDK integration, not production activation. The published RC6
tarball does not contain this subpath. Build and pack an exact reviewed source commit
to evaluate it; a future npm version must pass the normal staged release procedure.

```ts
import {
  createVaultTransitSigningProvider,
  createProductionApprovalClient,
  ProductionProviderError,
} from "@oneclicksystems/agentproof/production-providers";
```

These optional clients connect the existing repository-patch lifecycle to explicitly
configured services. Importing them, constructing them and reading signer metadata
make no network calls. Calling `requestApproval` or `signCanonical` performs one HTTPS
POST. The primary CLI, offline verifier and root SDK keep their existing behaviour.
No provider starts a service, discovers credentials, writes credentials, creates keys,
grants permissions or introduces another action.

## Vault receipt signing

`createVaultTransitSigningProvider(options)` returns the existing `SigningProvider`.
Pass it as `receiptSigner` to execution, reconciliation and compensation. Required
options are `address` (HTTPS origin), `mountPath`, `keyName`, a positive fixed
`keyVersion`, `keyId`, `publicKeyPem`, `trustedSignerFingerprint` and `getToken`.
`namespace` is optional. `timeoutMs` defaults to 10,000 and must be 1–60,000.

Provision a dedicated, non-derived Ed25519 Transit key outside AgentProof. The
operator supplies the public SPKI PEM and its `sha256:` fingerprint through an
independent trusted channel. The adapter checks their agreement; it never trusts a
key learned from a signing response. It requests the exact UTF-8 signing input with
`prehashed: false` at `/v1/{mountPath}/sign/{keyName}`, using the fixed key version.
It rejects a different response version and verifies the returned 64-byte signature
locally against the pinned public key before the SDK can persist a receipt.

The implementation follows the [Vault Transit signing API](https://developer.hashicorp.com/vault/api-docs/secret/transit#sign-data).
Its contract tests cover the documented wire format with a disposable simulated
service; they are not evidence of a live Vault deployment or hardware custody.

`getToken(signal)` returns a short-lived Vault credential for each operation. The
adapter uses `X-Vault-Token`, and optionally `X-Vault-Namespace`. The callback should
honour cancellation and must obtain credentials through the operator's authorised
workload identity mechanism. AgentProof does not choose or configure that mechanism.
Never give the proposer or mutating executor the signer credential.

Minimum deployment controls:

- Grant only update access to the dedicated Transit signing endpoint. Keep key
  creation, export, backup, rotation, configuration and unrelated paths unavailable
  to the runtime identity. Review all attached policies, not just one policy file.
- Verify the key's export/backup settings and the actual custody mechanism separately.
  This adapter cannot prove non-exportability or HSM backing from a valid signature.
- Isolate the verified-evidence coordinator from the proposer and executor. A raw
  Transit credential can sign arbitrary input; Vault does not interpret AgentProof
  receipts or establish that postconditions were verified.
- Record the issuer, key version, fingerprint, custody owner, policy and revocation
  procedure out of band. Rotation requires an explicit new version and trust pin;
  there is no fallback to the latest key. Preserve old public keys for historical
  verification subject to the verifier's revocation policy.

## External approval decisions

`createProductionApprovalClient({ endpoint, expectedIssuer,
trustedAuthorityFingerprints, getToken, timeoutMs? })` exposes
`requestApproval(request)`. Submit the exact document returned by
`createApprovalRequest`; the response is a `PortableApprovalDecisionDocument`.

The endpoint accepts that request directly as JSON and returns the signed decision
directly as JSON with HTTP 200. Authentication uses `Authorization: Bearer <token>`.
The server must independently enforce approval policy and keep its signing identity
separate from the proposer, executor and receipt signer. The client neither makes
the policy decision nor mints a signature. A signed denial is returned as `denied`;
the existing execution boundary rejects it. There is no auto-approve option.

The request includes repository/state paths and transaction binding metadata. Send
it only to an explicitly approved endpoint. The server needs its own trusted source
of the prepared content and policy; blindly signing a caller-supplied request is
not an approval authority.

The client validates the request structure, binding and digest before sending it.
It requires the exact request in the response, the expected issuer, a production
environment, an independently pinned Ed25519 fingerprint, a valid canonical
signature and unexpired UTC timestamps. Invalid calendar dates and future decision
times are rejected; deployment clocks must be synchronised. Configuration and
request inputs are snapshotted before awaiting credentials. The SDK still reconstructs
the binding from durable state and enforces nonce consumption, correlation, authority
environment and exactly-once execution. Client verification does not replace this.

## Transport and failure contract

Both clients require HTTPS with ordinary platform certificate validation. Endpoint
credentials, query strings and fragments are forbidden. Redirects, automatic retries
and fallback signers are disabled. HTTP 200 JSON is required; malformed UTF-8,
duplicate keys, prototype keys, excessive nesting and responses over 1 MiB fail.
The deadline includes credential retrieval and streamed response reads. A credential
callback that completes after timeout cannot start a request.

`ProductionProviderError.code` is one of:

| Code | Meaning |
| --- | --- |
| `provider_configuration_invalid` | Invalid endpoint, pin, key, version or deadline |
| `provider_input_invalid` | Invalid or oversized payload/request |
| `provider_credentials_unavailable` | Credential acquisition failed or returned an invalid header value |
| `provider_timeout` | Whole-operation deadline expired |
| `provider_unavailable` | Transport failure, redirect or non-200 status |
| `provider_response_invalid` | Invalid or oversized response encoding/JSON |
| `provider_signature_invalid` | Vault signature or version failed local verification |
| `provider_approval_invalid` | Signed decision failed request, time, environment or trust checks |

Errors include no credential, endpoint, remote body or underlying exception. The
clients never log. Callers must apply the same redaction to their credential callbacks
and service telemetry. Network transport and credential callbacks run in the trusted
coordinator's process; an already compromised process remains outside this boundary.

After a signer outage following mutation, durable state remains verified without a
receipt. Reconcile the same transaction after service recovery; do not prepare or
execute a second mutation. The adapter integration test exercises this recovery and
checks that later idempotent retry returns the original receipt without re-signing.

## Activation remains separate

Before calling a deployment production, satisfy every row of
[production provider readiness](production-provider-readiness.md): independent trust
distribution, issuer policy, real custody and IAM evidence, role isolation, outage and
rotation tests, and one bounded production-authority canary with authenticated
compensation. This change supplies SDK clients and engineering fixtures. It supplies
no live provider endpoint, production credential, production key, hosted coordinator,
independent adoption participant or DoneState merge/deploy/release authority.
