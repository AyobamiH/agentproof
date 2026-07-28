PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS operator_schema_meta (
  schema_name TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentproof_migration_runs (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentproof_transactions (
  transaction_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  target TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  approval_nonce TEXT UNIQUE,
  receipt_persisted INTEGER NOT NULL DEFAULT 0 CHECK (receipt_persisted IN (0, 1)),
  transaction_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agentproof_state ON agentproof_transactions(state, updated_at);
CREATE TABLE IF NOT EXISTS agentproof_approval_consumptions (
  nonce TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  operator_approval_task_id TEXT NOT NULL,
  binding_digest TEXT NOT NULL,
  consumed_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES agentproof_transactions(transaction_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS agentproof_receipts (
  transaction_id TEXT PRIMARY KEY,
  receipt_digest TEXT NOT NULL,
  key_id TEXT NOT NULL,
  signed_receipt_json TEXT NOT NULL,
  persisted_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES agentproof_transactions(transaction_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS agentproof_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES agentproof_transactions(transaction_id) ON DELETE RESTRICT
);
