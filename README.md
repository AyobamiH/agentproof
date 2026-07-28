# AgentProof

AgentProof lets an agent perform an authorised repository change and produce independently verifiable evidence of exactly what happened, under whose authority, with exactly-once execution and deterministic recovery.

The `0.1.0-rc.5` prerelease protects one action: `agentproof.repository_patch.v1`. It prepares an exact allowlisted patch against a clean local Git repository, binds approval to that prepared state, mutates in a separate executor process, independently verifies repository state, compensates when possible, and emits a signed Receipt V2.

Start with [Project direction](docs/PROJECT-DIRECTION.md). Security decisions live in [SECURITY.md](SECURITY.md), the trust roles in [Trust model](docs/TRUST-MODEL.md), and evidence-led priorities in the [Roadmap](docs/ROADMAP.md).

## Requirements

- Node.js 22.5 or newer
- ESM
- Git and a local filesystem
- Linux, macOS, or WSL2; native Windows is not yet validated

## CLI quickstart

```sh
npm install ./openclaw-agentproof-0.1.0-rc.5.tgz
./node_modules/.bin/agentproof --help
./node_modules/.bin/agentproof-dev-authority --help
```

The lifecycle is:

```text
prepare repository-patch → approval-request → development keygen/decide
→ execute → status/reconcile → verify-receipt → compensate
```

The primary CLI has no force, skip-approval, or auto-approval option. The separate development-authority binary requires explicit `--development`.

## SDK

Only public package exports are required:

```js
import {
  prepareRepositoryPatch,
  createApprovalRequest,
  executeApprovedTransaction,
  getTransactionStatus,
  reconcileRepositoryPatch,
  compensateRepositoryPatchWithReceipt,
  verifyReceipt,
} from "@openclaw/agentproof";
```

Every operation receives an explicit absolute state directory. `reconcileRepositoryPatch` re-observes an interrupted execution and signs only after verified state; compensation after a receipt requires an authenticated successor receipt. Imports perform no network calls, filesystem discovery, environment scanning, or background startup. See [Verified repository patch v1](docs/actions/repository-patch-v1.md) and [Signed receipt V2](docs/protocols/signed-receipt-v2.md).

## Verify a receipt offline

```sh
./node_modules/.bin/agentproof verify-receipt --input ./receipt.json --trust-fingerprint sha256:<trusted-fingerprint>
```

A valid signature is not sufficient trust. The verifier must receive an acceptable signer fingerprint out of band. It returns verified identities only from the signed payload.

## Trust boundary

Five roles remain distinct: proposer, approval authority, executor, receipt signer, and offline verifier. The executor cannot approve or sign. Development authority cannot satisfy production policy. OpenClaw Operator is the first adapter and dogfood environment; it is not AgentProof’s source or runtime boundary.

## Development warning

The included development authority is for local testing only. Its approvals are marked `development` and fail closed for transactions requiring production authority. RC5 does not provide a production KMS/HSM signer, OS sandbox, hosted authority, or service activation.

## Licence

AgentProof and the files distributed in this package are licensed under the Apache License 2.0. This package-scoped licence does not change the licensing of unrelated directories in the parent OpenClaw Operator repository.
