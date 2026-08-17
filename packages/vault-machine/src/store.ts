import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { MIGRATIONS, LOCAL_SCHEMA_VERSION } from "./migrations";
import { digest, iso } from "./util";
import { VaultError } from "./types";

export interface StoreOptions {
  machineId: string;
  appVersion: string;
  sourceCommit?: string;
  busyTimeoutMs?: number;
  acquireProcessLock?: boolean;
}

export class ProcessLock {
  private fd: number | null = null;
  constructor(public readonly path: string) {}

  acquire(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    try {
      this.fd = openSync(this.path, "wx", 0o600);
      writeFileSync(this.fd, JSON.stringify({ pid: process.pid, startedAt: iso() }), "utf8");
    } catch (error) {
      if (!existsSync(this.path)) throw error;
      let stale = false;
      try {
        const record = JSON.parse(readFileSync(this.path, "utf8")) as { pid?: number };
        if (!Number.isInteger(record.pid)) stale = true;
        else {
          try { process.kill(record.pid!, 0); } catch { stale = true; }
        }
      } catch { stale = true; }
      if (stale) {
        unlinkSync(this.path);
        this.acquire();
        return;
      }
      throw new VaultError("SERVICE_ALREADY_RUNNING", "Another Vault machine writer owns the service lock", 503);
    }
  }

  release(): void {
    if (this.fd !== null) closeSync(this.fd);
    this.fd = null;
    try { unlinkSync(this.path); } catch { /* already released */ }
  }
}

export class VaultStore {
  readonly db: Database.Database;
  readonly lock: ProcessLock;
  private closed = false;

  constructor(public readonly path: string, options: StoreOptions) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.lock = new ProcessLock(`${path}.writer.lock`);
    if (options.acquireProcessLock !== false && path !== ":memory:") this.lock.acquire();
    this.db = new Database(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=${options.busyTimeoutMs ?? 5000}; PRAGMA trusted_schema=OFF;`);
    this.migrate();
    this.db.prepare(`INSERT OR IGNORE INTO machine_meta(singleton,machine_id,app_version,source_commit,schema_version) VALUES(1,?,?,?,?)`)
      .run(options.machineId, options.appVersion, options.sourceCommit ?? "UNVERIFIED", LOCAL_SCHEMA_VERSION);
    const row = this.one(`SELECT machine_id FROM machine_meta WHERE singleton=1`);
    if (row.machine_id !== options.machineId) throw new VaultError("MACHINE_ID_MISMATCH", "Database belongs to a different machine", 503);
    this.db.prepare(`UPDATE machine_meta SET app_version=?, source_commit=COALESCE(?,source_commit), schema_version=? WHERE singleton=1`)
      .run(options.appVersion, options.sourceCommit ?? null, LOCAL_SCHEMA_VERSION);
  }

  private migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migration(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)`);
    const applied = new Set(this.all(`SELECT version FROM schema_migration`).map((row) => Number(row.version)));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      this.transaction(() => {
        this.db.exec(migration.sql);
        this.db.prepare(`INSERT INTO schema_migration(version,name,applied_at) VALUES(?,?,?)`).run(migration.version, migration.name, iso());
      });
    }
  }

  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* original error wins */ }
      throw error;
    }
  }

  one(sql: string, ...params: unknown[]): Record<string, unknown> {
    const row = this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
    if (!row) throw new VaultError("LOCAL_FACT_NOT_FOUND", "Required local fact was not found", 404);
    return row;
  }

  maybeOne(sql: string, ...params: unknown[]): Record<string, unknown> | undefined { return this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined; }
  all(sql: string, ...params: unknown[]): Array<Record<string, unknown>> { return this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>; }
  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } { return this.db.prepare(sql).run(...params); }

  bumpStateVersion(): number {
    this.run(`UPDATE machine_meta SET public_state_version=public_state_version+1 WHERE singleton=1`);
    return Number(this.one(`SELECT public_state_version FROM machine_meta WHERE singleton=1`).public_state_version);
  }

  integrityCheck(): { ok: boolean; rows: string[] } {
    const rows = this.all(`PRAGMA integrity_check`).map((row) => String(Object.values(row)[0]));
    const ok = rows.length === 1 && rows[0] === "ok";
    if (!ok) this.run(`UPDATE machine_meta SET recovery_required=1 WHERE singleton=1`);
    return { ok, rows };
  }

  pragmaSnapshot(): Record<string, unknown> {
    const value = (name: string): unknown => Object.values(this.one(`PRAGMA ${name}`))[0];
    return { journalMode: value("journal_mode"), foreignKeys: value("foreign_keys"), synchronous: value("synchronous"), busyTimeout: value("busy_timeout") };
  }

  encryptedBackup(outputPath: string, key: Buffer): { backupId: string; path: string; ciphertextDigest: string; plaintextDigest: string } {
    if (key.length !== 32) throw new VaultError("BACKUP_KEY_INVALID", "Backup key must be exactly 32 bytes");
    if (this.path === ":memory:") throw new VaultError("BACKUP_UNSUPPORTED", "In-memory databases cannot be backed up");
    mkdirSync(dirname(resolve(outputPath)), { recursive: true });
    const temporary = `${outputPath}.${randomUUID()}.sqlite`;
    const escaped = temporary.replaceAll("'", "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
    const plain = readFileSync(temporary);
    const verification = new Database(temporary, { readonly: true, fileMustExist: true });
    const integrity = verification.prepare(`PRAGMA integrity_check`).get();
    verification.close();
    if (String(Object.values(integrity ?? {})[0]) !== "ok") { unlinkSync(temporary); throw new VaultError("BACKUP_VERIFY_FAILED", "SQLite backup failed integrity verification", 503); }
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const envelope = Buffer.concat([Buffer.from("TKVAULT1"), nonce, tag, ciphertext]);
    writeFileSync(outputPath, envelope, { mode: 0o600 });
    unlinkSync(temporary);
    const record = { backupId: randomUUID(), path: outputPath, ciphertextDigest: createHash("sha256").update(envelope).digest("hex"), plaintextDigest: createHash("sha256").update(plain).digest("hex") };
    this.run(`INSERT INTO backup_metadata(backup_id,path,ciphertext_digest,plaintext_digest,created_at,verified_at) VALUES(?,?,?,?,?,?)`, record.backupId, record.path, record.ciphertextDigest, record.plaintextDigest, iso(), iso());
    return record;
  }

  rotateEncryptedBackup(outputDirectory: string, key: Buffer, maxVerifiedBackups = 7): { backupId: string; path: string; ciphertextDigest: string; plaintextDigest: string } {
    if (!Number.isInteger(maxVerifiedBackups) || maxVerifiedBackups < 2 || maxVerifiedBackups > 100) throw new VaultError("BACKUP_RETENTION_INVALID", "Backup retention must keep between 2 and 100 verified copies");
    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = join(outputDirectory, `vault-${this.clockSafeName()}-${randomUUID()}.tkvault`);
    const created = this.encryptedBackup(outputPath, key);
    const excess = this.all(`SELECT backup_id,path FROM backup_metadata WHERE removed_at IS NULL ORDER BY created_at DESC,backup_id DESC`).slice(maxVerifiedBackups);
    for (const row of excess) {
      try { if (existsSync(String(row.path))) unlinkSync(String(row.path)); }
      finally { this.run(`UPDATE backup_metadata SET removed_at=? WHERE backup_id=?`, iso(), row.backup_id); }
    }
    return created;
  }

  private clockSafeName(): string { return iso().replace(/[:.]/g, "-"); }

  static restoreEncrypted(inputPath: string, databasePath: string, key: Buffer): void {
    if (key.length !== 32) throw new VaultError("BACKUP_KEY_INVALID", "Backup key must be exactly 32 bytes");
    const envelope = readFileSync(inputPath);
    if (envelope.subarray(0, 8).toString() !== "TKVAULT1" || envelope.length < 36) throw new VaultError("BACKUP_FORMAT_INVALID", "Backup envelope is invalid");
    const nonce = envelope.subarray(8, 20); const tag = envelope.subarray(20, 36); const ciphertext = envelope.subarray(36);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce); decipher.setAuthTag(tag);
    let plaintext: Buffer;
    try { plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]); }
    catch { throw new VaultError("BACKUP_AUTH_FAILED", "Backup authentication failed", 503); }
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    const temporary = `${databasePath}.${randomUUID()}.restore`;
    writeFileSync(temporary, plaintext, { mode: 0o600 });
    const verification = new Database(temporary, { readonly: true, fileMustExist: true });
    const result = verification.prepare(`PRAGMA integrity_check`).get(); verification.close();
    if (String(Object.values(result ?? {})[0]) !== "ok") { unlinkSync(temporary); throw new VaultError("RESTORE_VERIFY_FAILED", "Restored database failed integrity verification", 503); }
    if (existsSync(databasePath)) copyFileSync(databasePath, `${databasePath}.pre-restore`);
    renameSync(temporary, databasePath);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    this.lock.release();
  }
}
