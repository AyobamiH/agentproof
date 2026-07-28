# Identifier semantics

AgentProof keeps four identity domains distinct.

- `transactionId` identifies the durable transaction used by persistence,
  idempotency, reconciliation, and execution. It never substitutes for another
  identifier.
- `correlationId` identifies the originating request or workflow. It is
  mandatory at portable preparation, persisted in the transaction, and remains
  byte-for-byte unchanged through approval, execution, verification, status,
  compensation, signed successors, and offline verification. Public operations
  fail closed when caller, durable state, or signed receipts disagree.
- `receiptId` identifies one immutable signed receipt. A lifecycle successor has
  a new receipt ID and authenticates its predecessor by payload digest.
- Approval task and decision IDs identify authority records. They remain
  separate from transaction, correlation, and receipt identities.

Offline verification returns correlation only from the validated signed V2
payload. Unsigned transport metadata cannot supply or override verified claims.
