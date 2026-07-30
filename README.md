# AgentProof

AgentProof lets an agent perform an authorised repository change and produce independently verifiable evidence of exactly what happened, under whose authority, with exactly-once execution and deterministic recovery.

The `0.1.0-rc.5` prerelease protects one action: `agentproof.repository_patch.v1`. It prepares an exact allowlisted patch against a clean local Git repository, binds approval to that prepared state, mutates in a separate executor process, independently verifies repository state, compensates when possible, and emits a signed Receipt V2.

Start with [Project direction](docs/PROJECT-DIRECTION.md). Security decisions live in [SECURITY.md](SECURITY.md), the trust roles in [Trust model](docs/TRUST-MODEL.md), and evidence-led priorities in the [Roadmap](docs/ROADMAP.md).

## Requirements

- Node.js 22.5 or newer
- ESM
- Git and a local filesystem
- Linux, macOS, or WSL2; native Windows is not yet validated

## Reproducible source consumption

Until a registry prerelease is published, consumers may pin the package to an
exact repository commit. The `prepare` script builds the public `dist/`
exports during Git dependency installation, so a clean consumer does not
depend on an unpublished registry tarball or a maintainer's local cache.

Use an immutable commit SHA rather than a moving branch:

```sh
npm install "github:AyobamiH/agentproof#<exact-commit-sha>"
```

This is a source-consumption path, not evidence that an npm package has been
published.

## CLI quickstart

This complete development-only example uses a disposable Git repository. It requires only this README and the packed tarball. All state, keys, and evidence stay under the temporary directory.

```sh
LAB="$(mktemp -d)"
REPO="$LAB/repository"
STATE="$LAB/state"
mkdir -p "$REPO"
git -C "$REPO" init -b main
git -C "$REPO" config user.email agentproof@example.invalid
git -C "$REPO" config user.name "AgentProof Quickstart"
printf 'before\n' > "$REPO/protected.txt"
git -C "$REPO" add protected.txt
git -C "$REPO" commit -m baseline

npm init -y
npm install /absolute/path/to/oneclicksystems-agentproof-0.1.0-rc.5.tgz
AP=./node_modules/.bin/agentproof
AUTH=./node_modules/.bin/agentproof-dev-authority

node - "$STATE" "$REPO" > "$LAB/request.json" <<'NODE'
const [stateDirectory, repositoryRoot] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  schema: "agentproof.protocol.repository-patch-request",
  schemaVersion: "1.0.0",
  actionType: "agentproof.repository_patch.v1",
  correlationId: "readme-quickstart-001",
  stateDirectory,
  action: {
    type: "agentproof.repository_patch.v1",
    repositoryRoot,
    operations: [{
      kind: "write",
      path: "protected.txt",
      contentBase64: Buffer.from("after\n").toString("base64")
    }]
  },
  intent: {
    summary: "Replace one tracked file and verify the result",
    requestedBy: "readme-quickstart",
    acceptanceCriteria: ["protected.txt contains the approved bytes"]
  },
  policy: {
    allowedRepositoryRoot: repositoryRoot,
    allowedTrackedPaths: ["protected.txt"],
    allowedNewPaths: [],
    maxPatchBytes: 1024,
    maxFiles: 1
  }
}, null, 2));
NODE

"$AP" prepare repository-patch --input "$LAB/request.json" > "$LAB/prepared.json"
EXPIRES="$(node -e 'process.stdout.write(new Date(Date.now()+600000).toISOString())')"
"$AP" approval-request --input "$LAB/prepared.json" --expires-at "$EXPIRES" --nonce readme-nonce-001 > "$LAB/approval-request.json"
"$AUTH" --development keygen --private-key-output "$LAB/authority.pem" > "$LAB/authority-key.json"
"$AUTH" --development decide --input "$LAB/approval-request.json" --private-key "$LAB/authority.pem" --decision approved --issuer readme-development-authority > "$LAB/approval.json"
"$AUTH" --development keygen --private-key-output "$LAB/receipt.pem" > "$LAB/receipt-key.json"

node - "$LAB/prepared.json" "$LAB/approval.json" "$LAB/authority-key.json" > "$LAB/execution.json" <<'NODE'
const fs = require("fs");
const [preparedPath, approvalPath, authorityPath] = process.argv.slice(2);
const prepared = JSON.parse(fs.readFileSync(preparedPath, "utf8"));
const approvalDecision = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
const authority = JSON.parse(fs.readFileSync(authorityPath, "utf8"));
process.stdout.write(JSON.stringify({
  schema: "agentproof.protocol.execution-request",
  schemaVersion: "1.0.0",
  actionType: "agentproof.repository_patch.v1",
  correlationId: prepared.correlationId,
  transactionId: prepared.transactionId,
  stateDirectory: prepared.stateDirectory,
  idempotencyKey: "readme-execution-001",
  requiredAuthorityEnvironment: "development",
  trustedAuthorityFingerprints: [authority.fingerprint],
  approvalDecision
}, null, 2));
NODE

"$AP" execute --input "$LAB/execution.json" --receipt-key "$LAB/receipt.pem" > "$LAB/receipt.json"
RECEIPT_FP="$(node -e 'const f=require(process.argv[1]);process.stdout.write(f.fingerprint)' "$LAB/receipt-key.json")"
"$AP" verify-receipt --input "$LAB/receipt.json" --trust-fingerprint "$RECEIPT_FP" --required-authority-environment development

# Exactly-once retry returns the original signed receipt.
"$AP" execute --input "$LAB/execution.json" --receipt-key "$LAB/receipt.pem" > "$LAB/receipt-retry.json"
sha256sum "$LAB/receipt.json" "$LAB/receipt-retry.json"

node - "$LAB/prepared.json" > "$LAB/status-query.json" <<'NODE'
const p = require(process.argv[2]);
process.stdout.write(JSON.stringify({
  stateDirectory: p.stateDirectory,
  transactionId: p.transactionId,
  correlationId: p.correlationId
}, null, 2));
NODE

# Compensation requires a trusted predecessor and emits a signed successor.
"$AP" compensate --input "$LAB/status-query.json" --receipt-key "$LAB/receipt.pem" --trust-fingerprint "$RECEIPT_FP" --authority-environment development > "$LAB/compensation-receipt.json"
test "$(git -C "$REPO" status --porcelain)" = ""
printf 'repository clean after compensation\n'
```

Expected evidence:

- `verify-receipt` returns `cryptographicallyValid: true` and `trusted: true`;
- the two SHA-256 values are identical, proving the retry returned the original receipt;
- compensation returns a Receipt V2 whose `predecessorPayloadDigest` binds the original receipt;
- the final Git check prints `repository clean after compensation`.

The primary CLI has no force, skip-approval, or auto-approval option. The separate development-authority binary requires explicit `--development`. Development evidence cannot satisfy production authority policy.

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
} from "@oneclicksystems/agentproof";
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
