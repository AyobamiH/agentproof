PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS agentproof_repository_patch_transactions (
  transaction_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  repository_root TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  approval_nonce TEXT UNIQUE,
  receipt_persisted INTEGER NOT NULL DEFAULT 0 CHECK (receipt_persisted IN (0, 1)),
  transaction_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agentproof_repository_patch_state
  ON agentproof_repository_patch_transactions(state, updated_at);
CREATE TABLE IF NOT EXISTS agentproof_repository_patch_approval_consumptions (
  nonce TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  operator_approval_task_id TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentproof_repository_patch_receipts (
  transaction_id TEXT PRIMARY KEY,
  receipt_digest TEXT NOT NULL,
  signed_receipt_json TEXT NOT NULL,
  persisted_at TEXT NOT NULL
);
