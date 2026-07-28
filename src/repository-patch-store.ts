import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { digest } from "./hash.js";
import type { Approval } from "./types.js";
import type {
  RepositoryPatchTransaction,
  SignedRepositoryPatchReceipt,
} from "./repository-patch-types.js";
import type { SignedReceiptV2 } from "./receipt-v2.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agentproof_repository_patch_transactions (
  transaction_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  repository_root TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  approval_nonce TEXT UNIQUE,
  receipt_persisted INTEGER NOT NULL DEFAULT 0,
  transaction_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
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
CREATE TABLE IF NOT EXISTS agentproof_repository_patch_portable_receipts_v2 (
  receipt_id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  payload_digest TEXT NOT NULL UNIQUE,
  predecessor_payload_digest TEXT,
  signed_receipt_json TEXT NOT NULL,
  persisted_at TEXT NOT NULL,
  UNIQUE(transaction_id, sequence)
);`;

export class RepositoryPatchStore {
  constructor(readonly databasePath: string) {}

  private open() {
    const database = new DatabaseSync(this.databasePath);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    return database;
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    const db = this.open();
    try { db.exec(SCHEMA); } finally { db.close(); }
  }

  async save(transaction: RepositoryPatchTransaction): Promise<void> {
    await this.initialize();
    const db = this.open();
    try {
      db.prepare(`INSERT INTO agentproof_repository_patch_transactions
        (transaction_id,state,repository_root,action_digest,idempotency_key,approval_nonce,receipt_persisted,transaction_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(transaction_id) DO UPDATE SET state=excluded.state,idempotency_key=excluded.idempotency_key,
          approval_nonce=excluded.approval_nonce,receipt_persisted=excluded.receipt_persisted,
          transaction_json=excluded.transaction_json,updated_at=excluded.updated_at`)
        .run(transaction.transactionId, transaction.state, transaction.action.repositoryRoot,
          transaction.actionDigest, transaction.idempotencyKey, transaction.approval?.nonce ?? null,
          transaction.receiptPersisted ? 1 : 0, JSON.stringify(transaction),
          transaction.createdAt, transaction.updatedAt);
    } finally { db.close(); }
  }

  async get(transactionId: string): Promise<RepositoryPatchTransaction> {
    await this.initialize();
    const db = this.open();
    try {
      const row = db.prepare("SELECT transaction_json FROM agentproof_repository_patch_transactions WHERE transaction_id=?")
        .get(transactionId) as { transaction_json: string } | undefined;
      if (!row) throw new Error(`repository_patch_transaction_not_found:${transactionId}`);
      return JSON.parse(row.transaction_json) as RepositoryPatchTransaction;
    } finally { db.close(); }
  }

  async claim(transactionId: string, idempotencyKey: string, approval: Approval) {
    await this.initialize();
    const db = this.open();
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const duplicate = db.prepare("SELECT transaction_json FROM agentproof_repository_patch_transactions WHERE idempotency_key=?")
          .get(idempotencyKey) as { transaction_json: string } | undefined;
        if (duplicate) {
          db.exec("COMMIT");
          return { claimed: false, transaction: JSON.parse(duplicate.transaction_json) as RepositoryPatchTransaction };
        }
        const row = db.prepare("SELECT transaction_json FROM agentproof_repository_patch_transactions WHERE transaction_id=?")
          .get(transactionId) as { transaction_json: string } | undefined;
        if (!row) throw new Error("repository_patch_transaction_not_found");
        const transaction = JSON.parse(row.transaction_json) as RepositoryPatchTransaction;
        if (transaction.state !== "prepared") {
          db.exec("COMMIT");
          return { claimed: false, transaction };
        }
        if (db.prepare("SELECT nonce FROM agentproof_repository_patch_approval_consumptions WHERE nonce=?").get(approval.nonce)) {
          throw new Error("approval_nonce_already_consumed");
        }
        transaction.state = "executing";
        transaction.idempotencyKey = idempotencyKey;
        transaction.approval = approval;
        transaction.updatedAt = new Date().toISOString();
        db.prepare(`INSERT INTO agentproof_repository_patch_approval_consumptions
          (nonce,transaction_id,operator_approval_task_id,binding_digest,consumed_at) VALUES (?,?,?,?,?)`)
          .run(approval.nonce, transactionId, approval.operatorApprovalTaskId, digest(approval), transaction.updatedAt);
        db.prepare(`UPDATE agentproof_repository_patch_transactions SET state=?,idempotency_key=?,
          approval_nonce=?,transaction_json=?,updated_at=? WHERE transaction_id=?`)
          .run(transaction.state, idempotencyKey, approval.nonce, JSON.stringify(transaction), transaction.updatedAt, transactionId);
        db.exec("COMMIT");
        return { claimed: true, transaction };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } finally { db.close(); }
  }

  async saveReceipt(receipt: SignedRepositoryPatchReceipt): Promise<void> {
    await this.initialize();
    const db = this.open();
    try {
      db.exec("BEGIN IMMEDIATE");
      const transaction = await this.get(receipt.transactionId);
      db.prepare(`INSERT OR IGNORE INTO agentproof_repository_patch_receipts
        (transaction_id,receipt_digest,signed_receipt_json,persisted_at) VALUES (?,?,?,?)`)
        .run(receipt.transactionId, receipt.receiptDigest, JSON.stringify(receipt), new Date().toISOString());
      transaction.receiptPersisted = true;
      transaction.updatedAt = new Date().toISOString();
      db.prepare(`UPDATE agentproof_repository_patch_transactions SET receipt_persisted=1,
        transaction_json=?,updated_at=? WHERE transaction_id=?`)
        .run(JSON.stringify(transaction), transaction.updatedAt, transaction.transactionId);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    } finally { db.close(); }
  }

  async getReceipt(transactionId: string): Promise<SignedRepositoryPatchReceipt | null> {
    await this.initialize();
    const db = this.open();
    try {
      const row = db.prepare("SELECT signed_receipt_json FROM agentproof_repository_patch_receipts WHERE transaction_id=?")
        .get(transactionId) as { signed_receipt_json: string } | undefined;
      return row ? JSON.parse(row.signed_receipt_json) as SignedRepositoryPatchReceipt : null;
    } finally { db.close(); }
  }

  async appendPortableReceipt(receipt: SignedReceiptV2): Promise<void> {
    await this.initialize();
    const db = this.open();
    try {
      db.exec("BEGIN IMMEDIATE");
      const row = db.prepare("SELECT COALESCE(MAX(sequence),0) AS sequence FROM agentproof_repository_patch_portable_receipts_v2 WHERE transaction_id=?")
        .get(receipt.payload.transactionId) as { sequence: number };
      db.prepare(`INSERT INTO agentproof_repository_patch_portable_receipts_v2
        (receipt_id,transaction_id,sequence,payload_digest,predecessor_payload_digest,signed_receipt_json,persisted_at)
        VALUES (?,?,?,?,?,?,?)`).run(receipt.payload.receiptId, receipt.payload.transactionId, row.sequence + 1,
          receipt.proof.payloadDigest, receipt.payload.predecessorPayloadDigest, JSON.stringify(receipt), new Date().toISOString());
      const transactionRow = db.prepare("SELECT transaction_json FROM agentproof_repository_patch_transactions WHERE transaction_id=?")
        .get(receipt.payload.transactionId) as { transaction_json: string } | undefined;
      if (!transactionRow) throw new Error("repository_patch_transaction_not_found");
      const transaction = JSON.parse(transactionRow.transaction_json) as RepositoryPatchTransaction;
      if (!transaction.correlationId || transaction.correlationId !== receipt.payload.correlationId) {
        throw new Error("receipt_correlation_mismatch");
      }
      transaction.receiptPersisted = true;
      transaction.updatedAt = new Date().toISOString();
      db.prepare("UPDATE agentproof_repository_patch_transactions SET receipt_persisted=1,transaction_json=?,updated_at=? WHERE transaction_id=?")
        .run(JSON.stringify(transaction), transaction.updatedAt, transaction.transactionId);
      db.exec("COMMIT");
    } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
    finally { db.close(); }
  }

  async portableReceiptChain(transactionId: string): Promise<SignedReceiptV2[]> {
    await this.initialize();
    const db = this.open();
    try {
      return (db.prepare("SELECT signed_receipt_json FROM agentproof_repository_patch_portable_receipts_v2 WHERE transaction_id=? ORDER BY sequence")
        .all(transactionId) as Array<{ signed_receipt_json: string }>).map((row) => JSON.parse(row.signed_receipt_json) as SignedReceiptV2);
    } finally { db.close(); }
  }

  async incomplete(): Promise<RepositoryPatchTransaction[]> {
    await this.initialize();
    const db = this.open();
    try {
      return (db.prepare(`SELECT transaction_json FROM agentproof_repository_patch_transactions
        WHERE state IN ('executing','executed','partially_executed','verified') AND receipt_persisted=0`).all() as Array<{transaction_json:string}>)
        .map((row) => JSON.parse(row.transaction_json) as RepositoryPatchTransaction);
    } finally { db.close(); }
  }
}
