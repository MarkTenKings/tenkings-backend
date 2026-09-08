import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, statSync, statfsSync, unlinkSync, writeFileSync } from "node:fs";
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
      if (this.fd !== null) { this.release(); throw error; }
      if (!existsSync(this.path)) throw error;
      let stale = false;
      try {
        const record = JSON.parse(readFileSync(this.path, "utf8")) as { pid?: number };
        if (!Number.isInteger(record.pid) || Number(record.pid) <= 0) stale = false;
        else {
          try { process.kill(record.pid!, 0); } catch (probe) { stale = (probe as NodeJS.ErrnoException).code === "ESRCH"; }
        }
      } catch { stale = false; }
      if (stale) {
        const recoveryPath = `${this.path}.recovery`;
        let recoveryFd: number;
        try { recoveryFd = openSync(recoveryPath, "wx", 0o600); }
        catch { throw new VaultError("SERVICE_LOCK_RECOVERY_BUSY", "Another process owns writer-lock recovery; inspect a stale recovery marker before manual recovery", 503); }
        try {
          // Serialize stale-lock reclamation, then re-probe the owner. A second
          // contender must never unlink the replacement lock of the first.
          if (existsSync(this.path)) {
            const record = JSON.parse(readFileSync(this.path, "utf8")) as { pid: number };
            if (!Number.isInteger(record.pid) || record.pid <= 0) throw new VaultError("SERVICE_LOCK_INVALID", "Writer lock requires manual recovery", 503);
            try { process.kill(record.pid, 0); throw new VaultError("SERVICE_ALREADY_RUNNING", "Another Vault writer owns the service lock", 503); }
            catch (probe) { if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe; }
            unlinkSync(this.path);
          }
          this.acquire();
          return;
        } finally { closeSync(recoveryFd); unlinkSync(recoveryPath); }
      }
      throw new VaultError("SERVICE_ALREADY_RUNNING", "Another Vault machine writer owns the service lock", 503);
    }
  }

  release(): void {
    if (this.fd === null) return;
    try { const owned = fstatSync(this.fd); const current = statSync(this.path); if (owned.ino === current.ino && owned.dev === current.dev) unlinkSync(this.path); } catch { /* already released */ }
    closeSync(this.fd);
    this.fd = null;
  }
}

export class VaultStore {
  readonly db: Database.Database;
  readonly lock: ProcessLock;
  private closed = false;

  constructor(public readonly path: string, options: StoreOptions) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(options.machineId)) throw new VaultError("MACHINE_ID_INVALID", "Machine identity must be a UUID", 400);
    if (!Number.isSafeInteger(options.busyTimeoutMs ?? 5000) || (options.busyTimeoutMs ?? 5000) < 0 || (options.busyTimeoutMs ?? 5000) > 60_000) throw new VaultError("BUSY_TIMEOUT_INVALID", "SQLite busy timeout must be a bounded integer", 400);
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.lock = new ProcessLock(`${path}.writer.lock`);
    if (options.acquireProcessLock !== false && path !== ":memory:") this.lock.acquire();
    try { this.db = new Database(path); }
    catch (error) { this.lock.release(); throw error; }
    try {
    if (this.db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='machine_meta'`).get()) {
      const identity = this.db.prepare(`SELECT machine_id FROM machine_meta WHERE singleton=1`).get() as { machine_id?: string } | undefined;
      if (identity?.machine_id !== options.machineId) throw new VaultError("MACHINE_ID_MISMATCH", "Database belongs to a different machine", 503);
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=${options.busyTimeoutMs ?? 5000}; PRAGMA trusted_schema=OFF;`);
    this.migrate();
    this.db.prepare(`INSERT OR IGNORE INTO machine_meta(singleton,machine_id,app_version,source_commit,schema_version) VALUES(1,?,?,?,?)`)
      .run(options.machineId, options.appVersion, options.sourceCommit ?? "UNVERIFIED", LOCAL_SCHEMA_VERSION);
    const row = this.one(`SELECT machine_id FROM machine_meta WHERE singleton=1`);
    if (row.machine_id !== options.machineId) throw new VaultError("MACHINE_ID_MISMATCH", "Database belongs to a different machine", 503);
    this.db.prepare(`UPDATE machine_meta SET app_version=?, source_commit=COALESCE(?,source_commit), schema_version=? WHERE singleton=1`)
      .run(options.appVersion, options.sourceCommit ?? null, LOCAL_SCHEMA_VERSION);
    } catch (error) { this.db.close(); this.lock.release(); throw error; }
  }

  private migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migration(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)`);
    const applied = new Set(this.all(`SELECT version FROM schema_migration`).map((row) => Number(row.version)));
    if ([...applied].some(version => version > LOCAL_SCHEMA_VERSION || !MIGRATIONS.some(migration => migration.version === version))) throw new VaultError("LOCAL_SCHEMA_UNSUPPORTED", "Database schema is not supported by this application version", 503);
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      // SQLite requires FK enforcement paused outside the transaction for a
      // referenced-table rebuild. Verify the complete FK graph before commit.
      if (migration.rebuildsReferencedTables) this.db.pragma("foreign_keys=OFF");
      try {
        this.transaction(() => {
          this.db.exec(migration.sql);
          if (this.all("PRAGMA foreign_key_check").length) throw new VaultError("LOCAL_MIGRATION_INTEGRITY_FAILED", "Local migration violated retained history references", 503);
          this.db.prepare(`INSERT INTO schema_migration(version,name,applied_at) VALUES(?,?,?)`).run(migration.version, migration.name, iso());
        });
      } finally { if (migration.rebuildsReferencedTables) this.db.pragma("foreign_keys=ON"); }
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
    for (const row of this.all(`PRAGMA foreign_key_check`)) rows.push(`foreign_key_check:${String(row.table)}:${String(row.rowid)}`);
    const ok = rows.length === 1 && rows[0] === "ok";
    if (!ok) this.run(`UPDATE machine_meta SET recovery_required=1 WHERE singleton=1`);
    return { ok, rows };
  }

  pragmaSnapshot(): Record<string, unknown> {
    const value = (name: string): unknown => Object.values(this.one(`PRAGMA ${name}`))[0];
    return { journalMode: value("journal_mode"), foreignKeys: value("foreign_keys"), synchronous: value("synchronous"), busyTimeout: value("busy_timeout") };
  }

  storageStatus(): { ready: boolean; availableBytes: number | null } {
    if (this.path === ":memory:") return { ready: true, availableBytes: null };
    try {
      const stat = statfsSync(dirname(resolve(this.path)));
      const availableBytes = Number(stat.bavail) * Number(stat.bsize);
      return { ready: Number.isSafeInteger(availableBytes) && availableBytes >= 64 * 1024 * 1024, availableBytes };
    } catch { return { ready: false, availableBytes: null }; }
  }

  encryptedBackup(outputPath: string, key: Buffer): { backupId: string; path: string; ciphertextDigest: string; plaintextDigest: string } {
    if (key.length !== 32) throw new VaultError("BACKUP_KEY_INVALID", "Backup key must be exactly 32 bytes");
    if (this.path === ":memory:") throw new VaultError("BACKUP_UNSUPPORTED", "In-memory databases cannot be backed up");
    mkdirSync(dirname(resolve(outputPath)), { recursive: true });
    const temporary = `${outputPath}.${randomUUID()}.sqlite`;
    const escaped = temporary.replaceAll("'", "''");
    try {
      // VACUUM INTO accepts an existing empty file. Claim it with private
      // permissions before SQLite writes the plaintext snapshot.
      const staging = openSync(temporary, "wx", 0o600); closeSync(staging);
      this.db.exec(`VACUUM INTO '${escaped}'`);
      if (statSync(temporary).size > 256 * 1024 * 1024) throw new VaultError("BACKUP_SIZE_UNSUPPORTED", "This candidate's bounded backup implementation requires a database of at most 256 MiB", 503);
      const verification = new Database(temporary, { readonly: true, fileMustExist: true });
      try { if (String(Object.values(verification.prepare(`PRAGMA integrity_check`).get() ?? {})[0]) !== "ok" || verification.prepare("PRAGMA foreign_key_check").all().length) throw new VaultError("BACKUP_VERIFY_FAILED", "SQLite backup failed integrity verification", 503); }
      finally { verification.close(); }
      const plain = readFileSync(temporary);
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
      const envelope = Buffer.concat([Buffer.from("TKVAULT1"), nonce, cipher.getAuthTag(), ciphertext]);
      const output = openSync(outputPath, "wx", 0o600);
      try { writeFileSync(output, envelope); fsyncSync(output); } finally { closeSync(output); }
      const record = { backupId: randomUUID(), path: outputPath, ciphertextDigest: createHash("sha256").update(envelope).digest("hex"), plaintextDigest: createHash("sha256").update(plain).digest("hex") };
      this.run(`INSERT INTO backup_metadata(backup_id,path,ciphertext_digest,plaintext_digest,created_at,verified_at) VALUES(?,?,?,?,?,?)`, record.backupId, record.path, record.ciphertextDigest, record.plaintextDigest, iso(), iso());
      return record;
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }

  rotateEncryptedBackup(outputDirectory: string, key: Buffer, maxVerifiedBackups = 7): { backupId: string; path: string; ciphertextDigest: string; plaintextDigest: string } {
    if (!Number.isInteger(maxVerifiedBackups) || maxVerifiedBackups < 2 || maxVerifiedBackups > 100) throw new VaultError("BACKUP_RETENTION_INVALID", "Backup retention must keep between 2 and 100 verified copies");
    mkdirSync(outputDirectory, { recursive: true });
    const outputPath = join(outputDirectory, `vault-${this.clockSafeName()}-${randomUUID()}.tkvault`);
    const created = this.encryptedBackup(outputPath, key);
    const excess = this.all(`SELECT backup_id,path,ciphertext_digest FROM backup_metadata WHERE removed_at IS NULL ORDER BY created_at DESC,backup_id DESC`).filter(row => dirname(resolve(String(row.path))) === resolve(outputDirectory)).slice(maxVerifiedBackups);
    for (const row of excess) {
      if (existsSync(String(row.path))) {
        const size = statSync(String(row.path)).size;
        if (size > 256 * 1024 * 1024 + 36 || createHash("sha256").update(readFileSync(String(row.path))).digest("hex") !== row.ciphertext_digest) throw new VaultError("BACKUP_RETENTION_CONTENT_CHANGED", "A prior backup path has changed; preserve it for inspection", 503);
        unlinkSync(String(row.path));
      }
      this.run(`UPDATE backup_metadata SET removed_at=? WHERE backup_id=?`, iso(), row.backup_id);
    }
    return created;
  }

  private clockSafeName(): string { return iso().replace(/[:.]/g, "-"); }

  static restoreEncrypted(inputPath: string, databasePath: string, key: Buffer): void {
    if (existsSync(databasePath) || existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`) || existsSync(`${databasePath}.writer.lock`)) throw new VaultError("RESTORE_TARGET_EXISTS", "Restore requires a new database path; preserve the current database and its WAL", 409);
    if (key.length !== 32) throw new VaultError("BACKUP_KEY_INVALID", "Backup key must be exactly 32 bytes");
    if (statSync(inputPath).size > 256 * 1024 * 1024 + 36) throw new VaultError("BACKUP_SIZE_UNSUPPORTED", "Backup exceeds this candidate's bounded restore size", 503);
    const envelope = readFileSync(inputPath);
    if (envelope.subarray(0, 8).toString() !== "TKVAULT1" || envelope.length < 36) throw new VaultError("BACKUP_FORMAT_INVALID", "Backup envelope is invalid");
    const nonce = envelope.subarray(8, 20); const tag = envelope.subarray(20, 36); const ciphertext = envelope.subarray(36);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce); decipher.setAuthTag(tag);
    let plaintext: Buffer;
    try { plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]); }
    catch { throw new VaultError("BACKUP_AUTH_FAILED", "Backup authentication failed", 503); }
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    const temporary = `${databasePath}.${randomUUID()}.restore`;
    const restoreLock = new ProcessLock(`${databasePath}.writer.lock`); restoreLock.acquire();
    try {
      writeFileSync(temporary, plaintext, { mode: 0o600, flag: "wx" });
      const verification = new Database(temporary, { readonly: true, fileMustExist: true });
      try {
        if (String(Object.values(verification.prepare(`PRAGMA integrity_check`).get() ?? {})[0]) !== "ok" || verification.prepare("PRAGMA foreign_key_check").all().length) throw new VaultError("RESTORE_VERIFY_FAILED", "Restored database failed integrity verification", 503);
        const versions = verification.prepare("SELECT version FROM schema_migration ORDER BY version").all() as Array<{ version: number }>;
        if (!versions.length || versions.some((row, index) => row.version !== index + 1 || row.version > LOCAL_SCHEMA_VERSION)) throw new VaultError("RESTORE_SCHEMA_UNSUPPORTED", "Restored database schema is not supported by this application", 503);
      }
      finally { verification.close(); }
      // A same-volume hard link atomically claims a new target and cannot
      // overwrite a file created between the original preflight and this step.
      linkSync(temporary, databasePath);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); restoreLock.release(); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    this.lock.release();
  }
}
