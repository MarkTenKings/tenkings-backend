import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { NayaxAdapter, NayaxSessionRequest, NayaxVendResultRequest } from "../../vault-contracts/dist";
import { DeterministicNayaxMock } from "./mock-nayax";
import { ProcessLock } from "./store";
import { VaultError } from "./types";

/** Durable simulated provider, separate from transaction authority; never connects to Nayax. */
export class DurableNayaxMock implements NayaxAdapter {
  private readonly mock = new DeterministicNayaxMock();
  private readonly database: Database.Database;
  private readonly lock: ProcessLock;
  private closed = false;

  constructor(path: string, machineId: string) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.lock = new ProcessLock(`${path}.writer.lock`); this.lock.acquire();
    let database: Database.Database | undefined;
    try {
      database = new Database(path);
      database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; CREATE TABLE IF NOT EXISTS mock_provider_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),machine_id TEXT NOT NULL,snapshot TEXT NOT NULL)");
      if (Object.values(database.prepare("PRAGMA integrity_check").get() ?? {})[0] !== "ok") throw new VaultError("MOCK_PROVIDER_INTEGRITY_FAILED", "Simulated provider state requires recovery", 503);
      const row = database.prepare("SELECT machine_id,snapshot FROM mock_provider_state WHERE singleton=1").get() as { machine_id: string; snapshot: string } | undefined;
      if (row) {
        if (row.machine_id !== machineId) throw new VaultError("MOCK_PROVIDER_MACHINE_MISMATCH", "Simulated provider belongs to another machine", 503);
        this.mock.restore(JSON.parse(row.snapshot));
      } else database.prepare("INSERT INTO mock_provider_state(singleton,machine_id,snapshot) VALUES(1,?,?)").run(machineId, JSON.stringify(this.mock.snapshot()));
      this.database = database;
    } catch (error) { database?.close(); this.lock.release(); throw error; }
  }

  capabilities() { return this.mock.capabilities(); }
  startSession(request: NayaxSessionRequest) { return this.persist(() => this.mock.startSession(request)); }
  cancelSession(providerSessionId: string, idempotencyKey: string) { return this.persist(() => this.mock.cancelSession(providerSessionId, idempotencyKey)); }
  reconcile(providerSessionId: string) { return this.persist(() => this.mock.reconcile(providerSessionId)); }
  reconcileRequest(idempotencyKey: string) { return this.persist(() => this.mock.reconcileRequest(idempotencyKey)); }
  reportVendResult(request: NayaxVendResultRequest) { return this.persist(() => this.mock.reportVendResult(request)); }
  close(): void { if (this.closed) return; this.closed = true; try { this.database.close(); } finally { this.lock.release(); } }

  private async persist<T>(operation: () => Promise<T>): Promise<T> {
    const result = await operation();
    this.database.prepare("UPDATE mock_provider_state SET snapshot=? WHERE singleton=1").run(JSON.stringify(this.mock.snapshot()));
    return result;
  }
}
