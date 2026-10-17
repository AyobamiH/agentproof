import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { digest } from "./hash.js";
import { releaseAssert, type ReleaseV1Observation, type ReleaseV1Request } from "./release-v1-contract.js";
import type { ReleaseV2Payload, ReleaseV2Receipt } from "./release-v1-receipt.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export type ReleaseState = "intent_recorded" | "publish_attempted" | "verified" | "signed" | "escalation_required";
export interface ReleaseRecord {
  state: ReleaseState;
  request: ReleaseV1Request;
  requestDigest: string;
  createdAt: string;
  updatedAt: string;
  before: ReleaseV1Observation;
  attemptedAt: string | null;
  after: ReleaseV1Observation | null;
  verifiedAt: string | null;
  payload: ReleaseV2Payload | null;
  receipt: ReleaseV2Receipt | null;
  errorCode: string | null;
}
const schema = [
  "CREATE TABLE IF NOT EXISTS release_v1_transactions (",
  "transaction_id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE,",
  "request_digest TEXT NOT NULL, subject_digest TEXT NOT NULL UNIQUE, state TEXT NOT NULL, record_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
].join(" ");
export class ReleaseV1Store {
  readonly filePath: string;
  constructor(stateDirectory: string) {
    releaseAssert(path.isAbsolute(stateDirectory) && !stateDirectory.includes("\0"), "invalid_state_root");
    this.filePath = path.join(stateDirectory, "agentproof-release-v1.sqlite");
  }
  private open() {
    mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.filePath);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    db.exec(schema);
    return db;
  }
  get(transactionId: string): ReleaseRecord | null {
    const db = this.open();
    try {
      const row = db.prepare("SELECT record_json FROM release_v1_transactions WHERE transaction_id=?")
        .get(transactionId) as { record_json: string } | undefined;
      return row ? JSON.parse(row.record_json) as ReleaseRecord : null;
    } finally { db.close(); }
  }
  claim(request: ReleaseV1Request, before: ReleaseV1Observation): { fresh: boolean; record: ReleaseRecord } {
    const db = this.open(), requestDigest = digest(request);
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const existing = db.prepare("SELECT record_json FROM release_v1_transactions WHERE transaction_id=?")
          .get(request.transactionId) as { record_json: string } | undefined;
        if (existing) {
          const record = JSON.parse(existing.record_json) as ReleaseRecord;
          releaseAssert(record.requestDigest === requestDigest, "transaction_conflict");
          db.exec("COMMIT");
          return { fresh: false, record };
        }
        const now = new Date().toISOString();
        const record: ReleaseRecord = { state: "intent_recorded", request, requestDigest,
          createdAt: now, updatedAt: now, before, attemptedAt: null, after: null, verifiedAt: null,
          payload: null, receipt: null, errorCode: null };
        // UNIQUE constraints enforce independent nonce/idempotency identity across transactions.
        db.prepare("INSERT INTO release_v1_transactions (transaction_id,nonce,idempotency_key,request_digest,subject_digest,state,record_json,updated_at) VALUES (?,?,?,?,?,?,?,?)")
          .run(request.transactionId, request.nonce, request.idempotencyKey, requestDigest, digest(request.subject),
            record.state, JSON.stringify(record), now);
        db.exec("COMMIT");
        return { fresh: true, record };
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    } finally { db.close(); }
  }
  transition(transactionId: string, expected: ReleaseState, next: ReleaseState,
    changes: Partial<ReleaseRecord> = {}): ReleaseRecord {
    const db = this.open();
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db.prepare("SELECT record_json FROM release_v1_transactions WHERE transaction_id=?")
          .get(transactionId) as { record_json: string } | undefined;
        releaseAssert(row, "transaction_not_found");
        const previous = JSON.parse(row.record_json) as ReleaseRecord;
        releaseAssert(previous.state === expected, "stale_state_transition");
        // Security-sensitive transaction, subject and approval never change after claiming.
        for (const key of ["request", "requestDigest", "createdAt", "before", "state"] as const)
          releaseAssert(!Object.hasOwn(changes, key), "immutable_record_field");
        const record: ReleaseRecord = { ...previous, ...changes, state: next, updatedAt: new Date().toISOString() };
        const updated = db.prepare("UPDATE release_v1_transactions SET state=?,record_json=?,updated_at=? WHERE transaction_id=? AND state=?")
          .run(next, JSON.stringify(record), record.updatedAt, transactionId, expected);
        releaseAssert(updated.changes === 1, "concurrent_update");
        db.exec("COMMIT");
        return record;
      } catch (e) { db.exec("ROLLBACK"); throw e; }
    } finally { db.close(); }
  }
}
