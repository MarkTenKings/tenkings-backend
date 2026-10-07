import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { ControllerReceipt } from "../../vault-contracts/dist";
import { ProcessLock } from "./store";
import { WaveshareError } from "./waveshare-protocol";

/** Separate hardware-effect ledger. The machine still owns payment/sale authority.
 * A PENDING row and halt commit before the first possible energizing write. */
export class WaveshareCommandJournal {
  readonly durable: boolean;
  private readonly db: Database.Database;
  private readonly lock: ProcessLock;
  private closed = false;
  constructor(path: string, readonly bindingDigest: string) {
    if (!/^[a-f0-9]{64}$/.test(bindingDigest)) throw new WaveshareError("WAVESHARE_JOURNAL_BINDING_INVALID");
    this.durable = path !== ":memory:";
    if (this.durable) mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.lock = new ProcessLock(`${path}.writer.lock`);
    if (this.durable) this.lock.acquire();
    let db: Database.Database | undefined;
    try {
      db = new Database(path);
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;
        CREATE TABLE IF NOT EXISTS waveshare_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),binding_digest TEXT NOT NULL,halted INTEGER NOT NULL CHECK(halted IN (0,1)),reason TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS waveshare_command(sequence INTEGER PRIMARY KEY AUTOINCREMENT,command_id TEXT NOT NULL UNIQUE,request_digest TEXT NOT NULL,receipt TEXT);
        CREATE TABLE IF NOT EXISTS waveshare_recovery(sequence INTEGER PRIMARY KEY AUTOINCREMENT,evidence_ref TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS waveshare_sequence(singleton INTEGER PRIMARY KEY CHECK(singleton=1),value INTEGER NOT NULL);
        INSERT OR IGNORE INTO waveshare_sequence VALUES(1,0);`);
      if (Object.values(db.prepare("PRAGMA integrity_check").get() ?? {})[0] !== "ok") throw new WaveshareError("WAVESHARE_JOURNAL_INTEGRITY_FAILED");
      db.prepare("INSERT OR IGNORE INTO waveshare_state VALUES(1,?,0,'STARTUP_READBACK_REQUIRED')").run(bindingDigest);
      const state = db.prepare("SELECT binding_digest FROM waveshare_state WHERE singleton=1").get() as { binding_digest: string };
      if (state.binding_digest !== bindingDigest) throw new WaveshareError("WAVESHARE_JOURNAL_BINDING_MISMATCH");
      this.db = db;
    } catch (error) { db?.close(); this.lock.release(); throw error; }
  }
  state(): { halted: boolean; reason: string } {
    const row = this.db.prepare("SELECT halted,reason FROM waveshare_state WHERE singleton=1").get() as { halted: number; reason: string };
    return { halted: row.halted === 1, reason: row.reason };
  }
  lookup(commandId: string, requestDigest: string): ControllerReceipt | null {
    const row = this.db.prepare("SELECT sequence,request_digest,receipt FROM waveshare_command WHERE command_id=?").get(commandId) as { sequence: number; request_digest: string; receipt: string | null } | undefined;
    if (!row) return null;
    if (row.request_digest !== requestDigest) throw new WaveshareError("WAVESHARE_COMMAND_ID_CONFLICT");
    return row.receipt ? JSON.parse(row.receipt) as ControllerReceipt : { commandId, controllerSequence: row.sequence, outcome: "SENT_UNKNOWN", outputState: "UNCERTAIN", evidenceCode: "WAVESHARE_INTERRUPTED_COMMAND" };
  }
  begin(commandId: string, requestDigest: string): number {
    return this.db.transaction(() => {
      if (this.state().halted) throw new WaveshareError("WAVESHARE_OUTPUT_HALTED");
      const sequence = this.nextSequence();
      this.db.prepare("INSERT INTO waveshare_command(sequence,command_id,request_digest) VALUES(?,?,?)").run(sequence, commandId, requestDigest);
      this.halt("WAVESHARE_COMMAND_IN_FLIGHT");
      return sequence;
    })();
  }
  nextSequence(): number {
    const row = this.db.prepare("UPDATE waveshare_sequence SET value=value+1 WHERE singleton=1 AND value<9007199254740991 RETURNING value").get() as { value: number } | undefined;
    if (!row) throw new WaveshareError("WAVESHARE_SEQUENCE_EXHAUSTED");
    return row.value;
  }
  complete(receipt: ControllerReceipt): void {
    this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE waveshare_command SET receipt=? WHERE command_id=? AND sequence=? AND receipt IS NULL").run(JSON.stringify(receipt), receipt.commandId, receipt.controllerSequence);
      if (changed.changes !== 1) throw new WaveshareError("WAVESHARE_JOURNAL_COMPLETION_CONFLICT");
      if (receipt.outcome === "ACCEPTED" && receipt.outputState === "OFF_VERIFIED") this.db.prepare("UPDATE waveshare_state SET halted=0,reason='OFF_VERIFIED' WHERE singleton=1").run();
      else this.halt(receipt.evidenceCode ?? "WAVESHARE_OUTPUT_UNCERTAIN");
    })();
  }
  halt(reason: string): void { this.db.prepare("UPDATE waveshare_state SET halted=1,reason=? WHERE singleton=1").run(reason); }
  recover(evidenceRef: string): void {
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO waveshare_recovery(evidence_ref,created_at) VALUES(?,?)").run(evidenceRef, new Date().toISOString());
      // Interrupted commands retain SENT_UNKNOWN forever, even when later OFF is observed.
      this.db.prepare("UPDATE waveshare_state SET halted=0,reason='OPERATOR_RECOVERY_OFF_VERIFIED' WHERE singleton=1").run();
    })();
  }
  close(): void { if (this.closed) return; this.closed = true; try { this.db.close(); } finally { if (this.durable) this.lock.release(); } }
}
