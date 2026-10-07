import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import Database from "better-sqlite3";
import type { PaymentEvidenceNotice, PaymentVoidResult, PaymentVoidRetirement } from "../../vault-contracts/dist";
import { ProcessLock } from "./store";
import { VaultError } from "./types";
import { digest } from "./util";
export interface SparkJournalSession {
    spark_id: string;
    request_key: string;
    sale_id: string;
    request_digest: string;
    total_cents: number;
    currency: string;
    phase: "AUTH_INTENT" | "AUTH_DECLINED" | "TRIGGER_INTENT" | "TRIGGER_ACK" | "NEGATIVE";
    capture: string | null;
    auth_sent_at: number;
    auth_ack_at: number | null;
    expires_at: number | null;
    trigger_body: string;
    trigger_count: number;
    last_trigger_at: number | null;
    negative_code: string | null;
    exception_code: string | null;
}
export interface SparkVoidIntent {
    action_id: string;
    spark_id: string;
    sale_id: string;
    request_digest: string;
    request_json: string;
    body: string;
    state: "INTENT" | "VOIDED" | "DECLINED" | "UNKNOWN";
    attempt_count: number;
    last_attempt_at: number | null;
    result_json: string | null;
}
/** All financial intents precede transport. Receipt ingestion and its cursor commit together. */
export class NayaxSparkJournal {
    private readonly db: Database.Database;
    private readonly lock: ProcessLock;
    private closed = false;
    constructor(path: string, readonly bindingDigest: string, allowMemory = false) {
        if (!/^[a-f0-9]{64}$/.test(bindingDigest) || (!isAbsolute(path) && !(allowMemory && path === ":memory:")))
            throw fail("CONFIG_INVALID");
        const disk = path !== ":memory:";
        const anchor = `${path}.anchor`;
        if (disk)
            mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
        this.lock = new ProcessLock(`${path}.writer.lock`);
        if (disk)
            this.lock.acquire();
        let db: Database.Database | undefined;
        try {
            if (disk && existsSync(anchor) && (!existsSync(path) || readFileSync(anchor, "utf8") !== bindingDigest))
                throw fail("ANCHOR_MISMATCH");
            db = new Database(path);
            if (disk)
                chmodSync(path, 0o600);
            db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;
        CREATE TABLE IF NOT EXISTS spark_binding(singleton INTEGER PRIMARY KEY CHECK(singleton=1),binding_digest TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS spark_session(spark_id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,sale_id TEXT NOT NULL UNIQUE,request_digest TEXT NOT NULL,total_cents INTEGER NOT NULL,currency TEXT NOT NULL,phase TEXT NOT NULL,capture TEXT);
        CREATE TABLE IF NOT EXISTS spark_void(action_id TEXT PRIMARY KEY,spark_id TEXT NOT NULL UNIQUE,sale_id TEXT NOT NULL,request_digest TEXT NOT NULL,request_json TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,attempt_count INTEGER NOT NULL DEFAULT 0,last_attempt_at INTEGER,result_json TEXT);
        CREATE TABLE IF NOT EXISTS spark_void_recovery_block(action_id TEXT PRIMARY KEY,code TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS spark_void_retirement(action_id TEXT PRIMARY KEY,action_digest TEXT NOT NULL,reason TEXT NOT NULL,proof_json TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS spark_void_retirement_immutable BEFORE UPDATE ON spark_void_retirement BEGIN SELECT RAISE(ABORT,'Spark void retirement is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS spark_void_retirement_retained BEFORE DELETE ON spark_void_retirement BEGIN SELECT RAISE(ABORT,'Spark void retirement is retained'); END;
        CREATE TABLE IF NOT EXISTS spark_receipt(receipt_id TEXT PRIMARY KEY,spark_id TEXT NOT NULL,observation TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS spark_receipt_session ON spark_receipt(spark_id);
        CREATE TABLE IF NOT EXISTS spark_feed(singleton INTEGER PRIMARY KEY CHECK(singleton=1),cursor TEXT NOT NULL);
        INSERT OR IGNORE INTO spark_feed VALUES(1,'0');
        CREATE TABLE IF NOT EXISTS spark_notice(notice_id TEXT PRIMARY KEY,notice TEXT NOT NULL,acknowledged INTEGER NOT NULL DEFAULT 0);`);
            db.exec(`CREATE TABLE IF NOT EXISTS spark_transport_attempt(operation_key TEXT NOT NULL,attempt_number INTEGER NOT NULL,kind TEXT NOT NULL,request_digest TEXT NOT NULL,sent_at INTEGER NOT NULL,verdict TEXT NOT NULL DEFAULT 'UNKNOWN',error_code INTEGER,PRIMARY KEY(operation_key,attempt_number));`);
            const columns = new Set((db.prepare("PRAGMA table_info(spark_session)").all() as {
                name: string;
            }[]).map(row => row.name));
            for (const [name, definition] of Object.entries({ auth_sent_at: "INTEGER NOT NULL DEFAULT 0", auth_ack_at: "INTEGER", expires_at: "INTEGER", trigger_body: "TEXT NOT NULL DEFAULT ''", trigger_count: "INTEGER NOT NULL DEFAULT 0", last_trigger_at: "INTEGER", negative_code: "TEXT", exception_code: "TEXT" })) {
                if (!columns.has(name))
                    db.exec(`ALTER TABLE spark_session ADD COLUMN ${name} ${definition}`);
            }
            if (Object.values(db.prepare("PRAGMA integrity_check").get() ?? {})[0] !== "ok")
                throw fail("INTEGRITY_FAILED");
            db.prepare("INSERT OR IGNORE INTO spark_binding VALUES(1,?)").run(bindingDigest);
            if ((db.prepare("SELECT binding_digest FROM spark_binding WHERE singleton=1").get() as {
                binding_digest: string;
            }).binding_digest !== bindingDigest)
                throw fail("BINDING_MISMATCH");
            if (disk && !existsSync(anchor)) {
                const fd = openSync(anchor, "wx", 0o600);
                try {
                    writeFileSync(fd, bindingDigest);
                    fsyncSync(fd);
                }
                finally {
                    closeSync(fd);
                }
                const directory = openSync(dirname(path), "r");
                try {
                    fsyncSync(directory);
                }
                finally {
                    closeSync(directory);
                }
            }
            this.db = db;
        }
        catch (error) {
            db?.close();
            if (disk)
                this.lock.release();
            throw error;
        }
    }
    bySession(id: string): SparkJournalSession | null { return (this.db.prepare("SELECT * FROM spark_session WHERE spark_id=?").get(id) as SparkJournalSession | undefined) ?? null; }
    byRequest(key: string): SparkJournalSession | null { return (this.db.prepare("SELECT * FROM spark_session WHERE request_key=?").get(key) as SparkJournalSession | undefined) ?? null; }
    sessions(): SparkJournalSession[] { return this.db.prepare("SELECT * FROM spark_session").all() as SparkJournalSession[]; }
    begin(i: Pick<SparkJournalSession, "spark_id" | "request_key" | "sale_id" | "request_digest" | "total_cents" | "currency" | "auth_sent_at" | "trigger_body">): {
        session: SparkJournalSession;
        created: boolean;
    } {
        return this.db.transaction(() => {
            const prior = this.byRequest(i.request_key) ?? this.db.prepare("SELECT * FROM spark_session WHERE sale_id=?").get(i.sale_id) as SparkJournalSession | undefined;
            if (prior) {
                if (prior.request_key !== i.request_key || prior.sale_id !== i.sale_id || prior.request_digest !== i.request_digest || prior.total_cents !== i.total_cents || prior.currency !== i.currency)
                    throw new VaultError("SPARK_START_IDEMPOTENCY_CONFLICT", "Spark purchase identity conflicts", 409);
                return { session: prior, created: false };
            }
            this.db.prepare("INSERT INTO spark_session(spark_id,request_key,sale_id,request_digest,total_cents,currency,phase,auth_sent_at,trigger_body) VALUES(?,?,?,?,?,?,'AUTH_INTENT',?,?)")
                .run(i.spark_id, i.request_key, i.sale_id, i.request_digest, i.total_cents, i.currency, i.auth_sent_at, i.trigger_body);
            return { session: this.bySession(i.spark_id)!, created: true };
        })();
    }
    authApproved(id: string, now: number): void {
        if (this.db.prepare("UPDATE spark_session SET auth_ack_at=?,expires_at=MIN(auth_sent_at+600000,?+600000) WHERE spark_id=? AND phase='AUTH_INTENT' AND auth_ack_at IS NULL").run(now, now, id).changes !== 1)
            throw fail("PHASE_CONFLICT");
    }
    triggerIntent(id: string, now: number): void {
        this.db.transaction(() => {
            if (this.db.prepare("UPDATE spark_session SET phase='TRIGGER_INTENT',trigger_count=trigger_count+1,last_trigger_at=? WHERE spark_id=? AND auth_ack_at IS NOT NULL AND capture IS NULL AND negative_code IS NULL AND exception_code IS NULL AND expires_at>? AND ? >= auth_ack_at").run(now, id, now, now).changes !== 1)
                throw fail("PHASE_CONFLICT");
            const session = this.bySession(id)!;
            this.db.prepare("INSERT INTO spark_transport_attempt(operation_key,attempt_number,kind,request_digest,sent_at) VALUES(?,?,'TRIGGER',?,?)").run(id, session.trigger_count, digest(session.trigger_body), now);
        })();
    }
    triggerOutcome(id: string, verdict: string, errorCode: number | null): void {
        this.db.prepare("UPDATE spark_transport_attempt SET verdict=?,error_code=? WHERE operation_key=? AND attempt_number=(SELECT trigger_count FROM spark_session WHERE spark_id=?)").run(verdict, errorCode, id, id);
    }
    triggerAck(id: string): void { this.db.prepare("UPDATE spark_session SET phase='TRIGGER_ACK' WHERE spark_id=? AND phase='TRIGGER_INTENT' AND capture IS NULL").run(id); }
    negative(id: string, code: string): void { this.db.prepare("UPDATE spark_session SET phase='NEGATIVE',negative_code=? WHERE spark_id=? AND capture IS NULL AND negative_code IS NULL").run(code, id); }
    exception(id: string, code: string): void { this.db.prepare("UPDATE spark_session SET exception_code=COALESCE(exception_code,?) WHERE spark_id=?").run(code, id); }
    capture(id: string, evidence: string): void {
        const session = this.bySession(id);
        if (!session || session.trigger_count < 1 || session.capture && session.capture !== evidence)
            throw fail("CAPTURE_CONFLICT");
        this.db.prepare("UPDATE spark_session SET capture=? WHERE spark_id=?").run(evidence, id);
    }
    cursor(): string { return (this.db.prepare("SELECT cursor FROM spark_feed WHERE singleton=1").get() as {
        cursor: string;
    }).cursor; }
    ingest(observations: ReadonlyArray<{
        receiptId: string;
        sparkTransactionId: string;
    }>, nextCursor?: string): void {
        this.db.transaction(() => {
            if (nextCursor != null && (!/^(0|[1-9][0-9]{0,18})$/.test(nextCursor) || BigInt(nextCursor) < BigInt(this.cursor())))
                throw fail("CURSOR_INVALID");
            for (const observation of observations) {
                const prior = this.db.prepare("SELECT observation FROM spark_receipt WHERE receipt_id=?").get(observation.receiptId) as {
                    observation: string;
                } | undefined;
                const text = JSON.stringify(observation);
                if (prior && digest(JSON.parse(prior.observation)) !== digest(observation))
                    throw fail("RECEIPT_CONFLICT");
                this.db.prepare("INSERT OR IGNORE INTO spark_receipt VALUES(?,?,?)").run(observation.receiptId, observation.sparkTransactionId, text);
            }
            if (nextCursor != null)
                this.db.prepare("UPDATE spark_feed SET cursor=? WHERE singleton=1").run(nextCursor);
        })();
    }
    observations(id: string): unknown[] { return (this.db.prepare("SELECT observation FROM spark_receipt WHERE spark_id=? ORDER BY receipt_id").all(id) as {
        observation: string;
    }[]).map(r => JSON.parse(r.observation)); }
    receiptSessions(): string[] { return (this.db.prepare("SELECT DISTINCT spark_id FROM spark_receipt").all() as {
        spark_id: string;
    }[]).map(r => r.spark_id); }
    notice(notice: PaymentEvidenceNotice): void { this.db.prepare("INSERT OR IGNORE INTO spark_notice(notice_id,notice) VALUES(?,?)").run(notice.noticeId, JSON.stringify(notice)); }
    notices(): PaymentEvidenceNotice[] { return (this.db.prepare("SELECT notice FROM spark_notice WHERE acknowledged=0 ORDER BY notice_id LIMIT 100").all() as {
        notice: string;
    }[]).map(r => JSON.parse(r.notice)); }
    acknowledge(id: string): void { this.db.prepare("UPDATE spark_notice SET acknowledged=1 WHERE notice_id=?").run(id); }
    voidByAction(id: string): SparkVoidIntent | null { return (this.db.prepare("SELECT * FROM spark_void WHERE action_id=?").get(id) as SparkVoidIntent | undefined) ?? null; }
    voids(): SparkVoidIntent[] { return this.db.prepare("SELECT * FROM spark_void").all() as SparkVoidIntent[]; }
    blockVoidRecovery(id: string, code: string): void {
        this.db.prepare("INSERT OR IGNORE INTO spark_void_recovery_block(action_id,code) VALUES(?,?)").run(id, code);
    }
    assertVoidRecoveryAllowed(id: string): void {
        if (this.db.prepare("SELECT 1 FROM spark_void_recovery_block WHERE action_id=?").get(id)) throw fail("VOID_RECOVERY_BLOCKED");
        if (this.db.prepare("SELECT 1 FROM spark_void_retirement WHERE action_id=?").get(id)) throw fail("VOID_RETIRED");
    }
    retireVoidAction(actionId: string, actionDigest: string, reason: PaymentVoidRetirement["reason"]): PaymentVoidRetirement {
        return this.db.transaction(() => {
            const existing = this.db.prepare("SELECT action_digest,reason,proof_json FROM spark_void_retirement WHERE action_id=?").get(actionId) as { action_digest: string; reason: string; proof_json: string } | undefined;
            if (existing) {
                if (existing.action_digest !== actionDigest || existing.reason !== reason) throw fail("VOID_RETIREMENT_CONFLICT");
                return JSON.parse(existing.proof_json) as PaymentVoidRetirement;
            }
            if (this.db.prepare("SELECT 1 FROM spark_void_recovery_block WHERE action_id=?").get(actionId)) throw fail("VOID_RECOVERY_BLOCKED");
            const intent = this.voidByAction(actionId);
            if (reason === "EXPIRED_UNSTARTED" && (intent || this.db.prepare("SELECT 1 FROM spark_transport_attempt WHERE operation_key=?").get(actionId))) throw fail("VOID_ALREADY_STARTED");
            if (reason === "EXTERNAL_REVIEW" && (!intent || !["INTENT", "UNKNOWN"].includes(intent.state))) throw fail("VOID_EXTERNAL_REVIEW_INVALID");
            const proof: PaymentVoidRetirement = { actionId, actionDigest, reason, proofDigest: digest({ bindingDigest: this.bindingDigest, actionId, actionDigest, reason, intent: intent ?? null }) };
            this.db.prepare("INSERT INTO spark_void_retirement VALUES(?,?,?,?)").run(actionId, actionDigest, reason, JSON.stringify(proof));
            return proof;
        })();
    }
    financialRecoveryEvidence(): { evidenceDigest: string; blockers: string[] } {
        const blocks = this.db.prepare("SELECT action_id,code FROM spark_void_recovery_block ORDER BY action_id").all();
        const facts = { sessions: this.db.prepare("SELECT * FROM spark_session ORDER BY spark_id").all(),
            receipts: this.db.prepare("SELECT * FROM spark_receipt ORDER BY receipt_id").all(),
            voids: this.db.prepare("SELECT * FROM spark_void ORDER BY action_id").all(), blocks };
        return { evidenceDigest: digest(facts), blockers: blocks.length ? ["SPARK_VOID_RECOVERY_BLOCKED"] : [] };
    }
    beginVoid(i: Pick<SparkVoidIntent, "action_id" | "spark_id" | "sale_id" | "request_digest" | "request_json" | "body">): {
        intent: SparkVoidIntent;
        created: boolean;
    } {
        return this.db.transaction(() => {
            this.assertVoidRecoveryAllowed(i.action_id);
            const prior = this.voidByAction(i.action_id) ?? this.db.prepare("SELECT * FROM spark_void WHERE spark_id=?").get(i.spark_id) as SparkVoidIntent | undefined;
            if (prior) {
                if (prior.action_id !== i.action_id || prior.request_digest !== i.request_digest || prior.body !== i.body)
                    throw fail("VOID_IDEMPOTENCY_CONFLICT");
                return { intent: prior, created: false };
            }
            this.db.prepare("INSERT INTO spark_void(action_id,spark_id,sale_id,request_digest,request_json,body,state) VALUES(?,?,?,?,?,?,'INTENT')").run(i.action_id, i.spark_id, i.sale_id, i.request_digest, i.request_json, i.body);
            return { intent: this.voidByAction(i.action_id)!, created: true };
        })();
    }
    voidAttempt(id: string, now: number): void {
        this.db.transaction(() => {
            this.assertVoidRecoveryAllowed(id);
            if (this.db.prepare("UPDATE spark_void SET attempt_count=attempt_count+1,last_attempt_at=?,state='UNKNOWN' WHERE action_id=? AND state IN ('INTENT','UNKNOWN')").run(now, id).changes !== 1)
                throw fail("VOID_PHASE_CONFLICT");
            const intent = this.voidByAction(id)!;
            this.db.prepare("INSERT INTO spark_transport_attempt(operation_key,attempt_number,kind,request_digest,sent_at) VALUES(?,?,'VOID',?,?)").run(id, intent.attempt_count, digest(intent.body), now);
        })();
    }
    voidResult(id: string, result: PaymentVoidResult): void {
        this.db.transaction(() => {
            this.db.prepare("UPDATE spark_void SET state=?,result_json=? WHERE action_id=?").run(result.state, JSON.stringify(result), id);
            this.db.prepare("UPDATE spark_transport_attempt SET verdict=?,error_code=? WHERE operation_key=? AND attempt_number=(SELECT attempt_count FROM spark_void WHERE action_id=?)").run(result.state, result.errorCode ?? null, id, id);
        })();
    }
    close(): void { if (this.closed)
        return; this.closed = true; try {
        this.db.close();
    }
    finally {
        this.lock.release();
    } }
}
function fail(code: string): VaultError { return new VaultError(`SPARK_JOURNAL_${code}`, "Spark durable payment evidence requires review", 503); }
