import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { digest } from "./hash.js";
import {
  AGENTPROOF_MIGRATION_ID,
  AGENTPROOF_SCHEMA_NAME,
  AGENTPROOF_SCHEMA_SQL,
  AGENTPROOF_SCHEMA_VERSION,
} from "./migrations.js";
import type { AgentProofTransaction, Approval, SignedEvidenceReceipt } from "./types.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type Database = InstanceType<typeof DatabaseSync>;

export interface ExecutionClaim {
  claimed: boolean;
  transaction: AgentProofTransaction;
}

function checksum(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class SqliteTransactionStore {
  constructor(readonly databasePath: string) {}

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    const database = this.open();
    try {
      database.exec(AGENTPROOF_SCHEMA_SQL);
      const now = new Date().toISOString();
      database.prepare(`
        INSERT INTO operator_schema_meta (schema_name, schema_version, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(schema_name) DO UPDATE SET
          schema_version = excluded.schema_version,
          updated_at = excluded.updated_at
      `).run(AGENTPROOF_SCHEMA_NAME, AGENTPROOF_SCHEMA_VERSION, now, now);
      database.prepare(`
        INSERT OR IGNORE INTO agentproof_migration_runs
          (migration_id, applied_at, checksum_sha256)
        VALUES (?, ?, ?)
      `).run(AGENTPROOF_MIGRATION_ID, now, checksum(AGENTPROOF_SCHEMA_SQL));
    } finally {
      database.close();
    }
  }

  private open(): Database {
    const database = new DatabaseSync(this.databasePath);
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
    return database;
  }

  async get(transactionId: string): Promise<AgentProofTransaction> {
    await this.initialize();
    const database = this.open();
    try {
      const row = database.prepare(
        "SELECT transaction_json FROM agentproof_transactions WHERE transaction_id = ?",
      ).get(transactionId) as { transaction_json: string } | undefined;
      if (!row) throw new Error(`transaction_not_found:${transactionId}`);
      return JSON.parse(row.transaction_json) as AgentProofTransaction;
    } finally {
      database.close();
    }
  }

  async save(transaction: AgentProofTransaction, eventType = "state_saved"): Promise<void> {
    await this.initialize();
    const database = this.open();
    try {
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = database.prepare(
          "SELECT state FROM agentproof_transactions WHERE transaction_id = ?",
        ).get(transaction.transactionId) as { state: string } | undefined;
        this.upsert(database, transaction);
        database.prepare(`
          INSERT INTO agentproof_events
            (transaction_id, from_state, to_state, event_type, detail, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          transaction.transactionId,
          current?.state ?? null,
          transaction.state,
          eventType,
          transaction.lastError,
          transaction.updatedAt,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    } finally {
      database.close();
    }
  }

  async findByIdempotencyKey(key: string): Promise<AgentProofTransaction | null> {
    await this.initialize();
    const database = this.open();
    try {
      const row = database.prepare(
        "SELECT transaction_json FROM agentproof_transactions WHERE idempotency_key = ?",
      ).get(key) as { transaction_json: string } | undefined;
      return row ? JSON.parse(row.transaction_json) as AgentProofTransaction : null;
    } finally {
      database.close();
    }
  }

  async claimExecution(
    transactionId: string,
    idempotencyKey: string,
    approval: Approval,
  ): Promise<ExecutionClaim> {
    await this.initialize();
    const database = this.open();
    try {
      database.exec("BEGIN IMMEDIATE");
      try {
        const duplicate = database.prepare(
          "SELECT transaction_json FROM agentproof_transactions WHERE idempotency_key = ?",
        ).get(idempotencyKey) as { transaction_json: string } | undefined;
        if (duplicate) {
          database.exec("COMMIT");
          return { claimed: false, transaction: JSON.parse(duplicate.transaction_json) };
        }
        const row = database.prepare(
          "SELECT transaction_json FROM agentproof_transactions WHERE transaction_id = ?",
        ).get(transactionId) as { transaction_json: string } | undefined;
        if (!row) throw new Error(`transaction_not_found:${transactionId}`);
        const transaction = JSON.parse(row.transaction_json) as AgentProofTransaction;
        if (transaction.state !== "prepared") {
          database.exec("COMMIT");
          return { claimed: false, transaction };
        }
        const nonceUsed = database.prepare(
          "SELECT transaction_id FROM agentproof_approval_consumptions WHERE nonce = ?",
        ).get(approval.nonce) as { transaction_id: string } | undefined;
        if (nonceUsed) throw new Error("approval_nonce_already_consumed");
        transaction.state = "executing";
        transaction.idempotencyKey = idempotencyKey;
        transaction.approval = approval;
        transaction.updatedAt = new Date().toISOString();
        database.prepare(`
          INSERT INTO agentproof_approval_consumptions
            (nonce, transaction_id, operator_approval_task_id, binding_digest, consumed_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          approval.nonce,
          transactionId,
          approval.operatorApprovalTaskId,
          digest(approval),
          transaction.updatedAt,
        );
        this.upsert(database, transaction);
        database.prepare(`
          INSERT INTO agentproof_events
            (transaction_id, from_state, to_state, event_type, detail, created_at)
          VALUES (?, 'prepared', 'executing', 'approval_consumed_execution_claimed', ?, ?)
        `).run(transactionId, approval.operatorApprovalTaskId, transaction.updatedAt);
        database.exec("COMMIT");
        return { claimed: true, transaction };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    } finally {
      database.close();
    }
  }

  async saveReceipt(receipt: SignedEvidenceReceipt): Promise<void> {
    await this.initialize();
    const database = this.open();
    try {
      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare(`
          INSERT INTO agentproof_receipts
            (transaction_id, receipt_digest, key_id, signed_receipt_json, persisted_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(transaction_id) DO NOTHING
        `).run(
          receipt.transactionId,
          receipt.receiptDigest,
          receipt.signature.keyId,
          JSON.stringify(receipt),
          new Date().toISOString(),
        );
        const row = database.prepare(
          "SELECT transaction_json FROM agentproof_transactions WHERE transaction_id = ?",
        ).get(receipt.transactionId) as { transaction_json: string };
        const transaction = JSON.parse(row.transaction_json) as AgentProofTransaction;
        transaction.receiptPersisted = true;
        transaction.updatedAt = new Date().toISOString();
        this.upsert(database, transaction);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    } finally {
      database.close();
    }
  }

  async getReceipt(transactionId: string): Promise<SignedEvidenceReceipt | null> {
    await this.initialize();
    const database = this.open();
    try {
      const row = database.prepare(
        "SELECT signed_receipt_json FROM agentproof_receipts WHERE transaction_id = ?",
      ).get(transactionId) as { signed_receipt_json: string } | undefined;
      return row ? JSON.parse(row.signed_receipt_json) as SignedEvidenceReceipt : null;
    } finally {
      database.close();
    }
  }

  async listIncomplete(): Promise<AgentProofTransaction[]> {
    await this.initialize();
    const database = this.open();
    try {
      const rows = database.prepare(`
        SELECT transaction_json FROM agentproof_transactions
        WHERE state IN ('executing', 'executed', 'partially_executed', 'verified')
          AND receipt_persisted = 0
        ORDER BY created_at
      `).all() as Array<{ transaction_json: string }>;
      return rows.map((row) => JSON.parse(row.transaction_json) as AgentProofTransaction);
    } finally {
      database.close();
    }
  }

  async schemaVersion(): Promise<number> {
    await this.initialize();
    const database = this.open();
    try {
      const row = database.prepare(
        "SELECT schema_version FROM operator_schema_meta WHERE schema_name = ?",
      ).get(AGENTPROOF_SCHEMA_NAME) as { schema_version: number };
      return Number(row.schema_version);
    } finally {
      database.close();
    }
  }

  private upsert(database: Database, transaction: AgentProofTransaction): void {
    database.prepare(`
      INSERT INTO agentproof_transactions
        (transaction_id, state, target, action_digest, policy_version,
         idempotency_key, approval_nonce, receipt_persisted, transaction_json,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(transaction_id) DO UPDATE SET
        state = excluded.state,
        target = excluded.target,
        action_digest = excluded.action_digest,
        policy_version = excluded.policy_version,
        idempotency_key = excluded.idempotency_key,
        approval_nonce = excluded.approval_nonce,
        receipt_persisted = excluded.receipt_persisted,
        transaction_json = excluded.transaction_json,
        updated_at = excluded.updated_at
    `).run(
      transaction.transactionId,
      transaction.state,
      transaction.canonicalTarget,
      transaction.actionDigest,
      transaction.policyDecision.policyId,
      transaction.idempotencyKey,
      transaction.approval?.nonce ?? null,
      transaction.receiptPersisted ? 1 : 0,
      JSON.stringify(transaction),
      transaction.createdAt,
      transaction.updatedAt,
    );
  }
}

export { SqliteTransactionStore as FileTransactionStore };
