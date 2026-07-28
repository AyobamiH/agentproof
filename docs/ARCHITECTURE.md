# Architecture

AgentProof’s portable core owns its CLI/SDK, protocol types and JSON Schemas, SQLite migrations/state, repository-patch action, compensation/reconciliation, Receipt V2 signing and verification, provider interfaces, fixtures, tests, and public documentation.

A coordinator prepares durable state, validates authority, controls transitions, independently verifies results, reconciles interruption, and asks an injected signer to create a receipt. The mutating executor is a separate Node process receiving only bounded repository/action inputs. It has no approval store, authority key, or receipt-signing interface. Offline verification requires only the receipt and explicit trust policy; it does not trust executor output.

SQLite uses WAL, full synchronous durability, foreign keys, a busy timeout, checksummed migrations, immediate transactions, and uniqueness constraints for idempotency keys, approval nonces, consumption, and receipt identities. Filesystem mutation and SQLite cannot form one distributed atomic transaction, so restart reconciliation observes target state and chooses verified, failed, or uncertain deterministically.

OpenClaw Operator owns only its task/queue adapter, canonical approval-decision/replay mapping, Operator configuration, integration tests, and any later separately approved service activation. It consumes AgentProof public exports. AgentProof imports no Operator module. The coding workflow library owns only the generic artifact-bound npm/GitHub release workflow.
