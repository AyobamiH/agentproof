# Durable authority and signed-receipt boundary

## Status

Implemented locally. The migration is prepared in
`migrations/001_agentproof_transaction_state.sql` and has been exercised only
against temporary test and demonstration databases. It has not been applied to
the live Operator database or the established production state root.

## State placement

AgentProof resolves mutable state from `OPENCLAW_OPERATOR_STATE_DIR` and uses:

`<OPENCLAW_OPERATOR_STATE_DIR>/agentproof/agentproof.sqlite`

Callers must provide that environment variable or an explicit state root or
database path. There is no source-tree or `/tmp` production fallback. Tests and
the demo provide isolated temporary roots.

## Trust boundaries

1. The coordinator runs preflight, preparation, Operator approval adaptation,
   SQLite transitions, independent verification, reconciliation, and receipt
   assembly.
2. The executor is a separate Node process with a stripped environment. It
   receives only the approved root, canonical target, proposed bytes, and
   expected content hash. It has no approval-store or signing-provider API.
3. The signing provider remains in the coordinator/verifier boundary. The
   executor receives no signing key environment or key object.
4. Offline verification uses canonical JSON serialization plus Node's standard
   Ed25519 implementation and needs only the signed receipt.

The current operating-system user is still the filesystem security principal;
process separation is a trust and capability boundary, not yet an OS sandbox.

## Operator approval adapter

`createOperatorApprovalRequest` produces a normal Operator approval task
payload with `requiresApproval: true`. `approvalFromOperatorReplay` consumes
the canonical `ApprovalRecord` and `approvedFromTaskId` replay link.

The binding covers transaction id, intent digest, exact action digest and
canonical target, prepared before and proposed hashes, policy version, issuer,
expiry, and a single-use nonce. AgentProof consumes the nonce and transitions
`prepared -> executing` inside one `BEGIN IMMEDIATE` SQLite transaction.
The Operator record remains the authority source; AgentProof does not add a new
approval route or surface.

## SQLite model

The separate database follows Operator conventions: WAL, `synchronous=FULL`,
foreign keys, a 5-second busy timeout, `operator_schema_meta`, an explicit
migration ledger, and immediate transactions.

Tables:

- `agentproof_transactions`: durable state and canonical transaction JSON;
- `agentproof_approval_consumptions`: unique nonce and transaction binding;
- `agentproof_receipts`: one signed receipt per transaction;
- `agentproof_events`: ordered state-transition evidence;
- `agentproof_migration_runs`: migration id and checksum.

Unique constraints on idempotency key, approval nonce, transaction approval
consumption, and receipt identity enforce replay protection.

## Restart reconciliation

- `executing` plus proposed target hash: record partial executor evidence,
  independently verify, then sign and persist the receipt;
- `executing` plus unchanged before-state: fail deterministically as an
  interrupted pre-mutation execution;
- `executing` plus any third state: mark `uncertain` for escalation;
- `executed` or `partially_executed`: independently verify;
- `verified` without a receipt: retry signing and atomic receipt persistence;
- unavailable signer: retain `verified` state and retry on reconciliation.

## Offline verification

Library:

`verifySignedReceiptOffline(receipt)`

Command:

`npm --prefix agentproof run verify-receipt -- /path/to/signed-receipt.json`

The command returns exit code 0 only for a valid Ed25519 signature. The receipt
contains the public key, not private key material. Trusting that key identity is
a separate deployment policy decision.
