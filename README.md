# AgentProof local vertical slice

This package is the first mutating AgentProof boundary. It lives inside the
active OpenClaw Operator source repository so the existing orchestrator may
adopt it later, but it is not linked into the running service and it does not
inherit ToolGate authority. The durable state, authority, executor,
verifier, and signing design is documented in [Durable authority and signed-receipt
boundary](docs/durable-authority-boundary.md).

## Product rationale

The approved product direction is documented in
[AI agent market research 2026](docs/ai-agent-market-research-2026.md).
This report is documentation only. AgentProof does not load it as runtime
input, configuration, policy, transaction evidence, or application state.

The supported action is one exact, allowlisted local file replacement. Every
mutation requires a transaction-bound approval and idempotency key. The
independent verifier reads the resulting target bytes and compares their
SHA-256 hash with the prepared postcondition. Compensation either restores the
captured before-state or deletes a newly-created file. If the before-state
cannot be captured within the approved limit, the transaction is explicitly
classified as `non_compensable`.

`coding-agent-skills` remains unchanged and read-only. Preflight invokes its
existing `repo-map` and `secret-audit` JSON commands and stores only sanitized
status plus a digest of each result in the transaction evidence.

## Contract

The framework-neutral `AgentProof` class exposes:

- `preflight(action, intent, constraints)`
- `prepare(transactionId)`
- `execute(transactionId, idempotencyKey, approval)`
- `verify(transactionId)`
- `compensate(transactionId)`
- `receipt(transactionId)`

Transactions are persisted in an isolated SQLite state machine under the
canonical Operator state root. Receipts are canonical JSON signed with Ed25519 through an
injected signing provider. Receipts bind intent, exact target and
action, policy decision, scoped approval, idempotency key, before/after
evidence, independent verification, compensation status, and read-only
evidence digests.

## Repeatable local demo

From the active OpenClaw Operator repository:

```bash
npm --prefix agentproof install
npm --prefix agentproof test
npm --prefix agentproof run demo
npm --prefix agentproof run verify-receipt -- /path/to/signed-receipt.json
```

## Canonical Operator integration harness

The local harness uses temporary Operator and AgentProof SQLite databases, the
production `TaskQueue`, task-admission logic, approval gate, decision and replay
implementation, and the existing separate-process AgentProof executor. It does
not connect to a running service or live state.

Run the repeatable integration demo from the repository root:

```sh
npm --prefix agentproof run build
cd orchestrator && npx tsx ../agentproof/integration-harness/demo.ts
```

The JSON output includes the original Operator task and approval-decision
identities, exactly-one mutation count, signed-receipt trust result,
compensation state, and proof that the temporary target is absent afterward.

The demo creates only `tmp/agentproof-demo/managed.txt`, independently verifies
its bytes, compensates by deleting it, and prints the machine-readable signed receipt plus offline verification
result. Its SQLite database and generated signing key live under isolated temporary roots.
It does not restart a service, deploy, commit, push, use credentials, or mutate
any remote system.

## Verified repository patch

The first commercial coding-agent action is documented in [Verified repository patch v1](docs/repository-patch-v1.md). It remains local and disabled from the running Operator service. A production migration is prepared at `migrations/002_agentproof_repository_patch.sql` but has not been applied to any live database.

Run its temporary-repository demo with:

```sh
npm --prefix agentproof run build
cd orchestrator && npx tsx ../agentproof/integration-harness/repository-patch-demo.ts
```

## Portable CLI/SDK developer preview

Identifier meanings and the immutable correlation contract are documented in
[`docs/identifier-semantics.md`](docs/identifier-semantics.md).

Node.js 22.5 or newer is required. Version `0.1.0-rc.4` is ESM-only and
is a prerelease candidate. It exposes the package root for proposer, executor, status,
compensation and verification APIs, plus a separate
`@openclaw/agentproof/development-authority` subpath.

RC2 signed receipts use a strict V2 `{ payload, proof }` envelope. The Ed25519
signature and independently recomputed SHA-256 digest cover the domain-separated
canonical payload, which contains every verified identity, approval, action,
repository and lifecycle claim. Offline verification returns identities only
from that signed payload. RC1 receipt envelopes return
`legacy_unbound_receipt` and never `trusted: true`.

Compensation may emit an append-only successor through
`compensateRepositoryPatchWithReceipt`; it signs the predecessor payload digest
and never mutates the earlier receipt. See
[Signed receipt V2 migration](docs/receipt-v2-migration.md).

Primary CLI commands are `prepare repository-patch`, `approval-request`, `execute`, `status`, `verify-receipt`, and `compensate`. The separate development authority supports explicit `--development keygen` and `--development decide`. There is no force, skip-approval, or auto-approval option.

Stable exit codes:

| Code | Meaning |
|---:|---|
| 0 | Success |
| 2 | Invalid input/schema/command |
| 3 | Policy rejection |
| 4 | Approval required |
| 5 | Approval denied |
| 6 | Stale, altered, expired or untrusted approval |
| 7 | Execution failure |
| 8 | Verification failure |
| 9 | Compensation failure |
| 10 | Untrusted receipt signer |
| 70 | Internal failure |

Public SDK APIs are `prepareRepositoryPatch`, `createApprovalRequest`,
`executeApprovedTransaction`, `getTransactionStatus`, `verifyReceipt`,
`compensateRepositoryPatch`, `compensateRepositoryPatchWithReceipt`, canonical
V2 digest helpers, signing-provider interfaces and stable protocol/error types.
Imports have no side effects, network calls, filesystem discovery, environment
scanning, or background startup. Every execution requires an explicit absolute
state directory.

See [portable security boundaries](SECURITY.md) and the versioned schemas in `schemas/`.



## Licence

AgentProof and the files distributed in this package are licensed under the Apache License 2.0. This package-scoped licence does not change the licensing of unrelated directories in the parent OpenClaw Operator repository.
