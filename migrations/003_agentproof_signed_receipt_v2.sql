-- Prepared migration only. Do not apply to a live Operator database as part of RC2 validation.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agentproof_repository_patch_portable_receipts_v2 (
  receipt_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  payload_digest TEXT NOT NULL UNIQUE CHECK (length(payload_digest) = 64),
  predecessor_payload_digest TEXT CHECK (predecessor_payload_digest IS NULL OR length(predecessor_payload_digest) = 64),
  signed_receipt_json TEXT NOT NULL,
  persisted_at TEXT NOT NULL,
  UNIQUE(transaction_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_agentproof_receipt_v2_chain
  ON agentproof_repository_patch_portable_receipts_v2(transaction_id, sequence);
