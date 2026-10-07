import type { VaultMachine } from "./machine";

export interface MaintenanceStatus {
  schemaVersion: 1;
  maintenanceActive: boolean;
  restartAllowed: boolean;
  blockers: string[];
  localSchemaVersion: number;
  buildIdentity: { appVersion: string; sourceCommit: string };
}

/** The caller owns admission of ALL HTTP writes and runtime ticks. quiesce must
 * freeze admission synchronously, then await existing requests/ticks/adapters;
 * resume must restore admission/ticks after an unsuccessful entry. */
export interface MaintenanceLifecycle {
  quiesce: () => Promise<void>;
  resume: () => Promise<void>;
  now?: () => Date;
}

export class VaultMaintenance {
  private active = false;
  private entering: Promise<MaintenanceStatus> | null = null;
  constructor(private readonly machine: VaultMachine, private readonly lifecycle: MaintenanceLifecycle) {}

  get maintenanceActive(): boolean { return this.active; }

  async status(): Promise<MaintenanceStatus> {
    const blockers: string[] = [];
    // identity is read-only: it must never issue a pulse or reset an unknown output.
    try {
      const identity = await this.machine.controller.identity();
      if (!identity.ready || (identity.mode !== "MOCK" && (identity as { outputState?: string }).outputState !== "OFF_VERIFIED")) blockers.push("CONTROLLER_IDLE_UNVERIFIED");
    } catch { blockers.push("CONTROLLER_IDLE_UNVERIFIED"); }
    const store = this.machine.store;
    // Read persistent authority AFTER the asynchronous device observation.
    const meta = store.one("SELECT schema_version,app_version,source_commit,recovery_required,automation_halted FROM machine_meta WHERE singleton=1");
    if (Number(meta.recovery_required)) blockers.push("RECOVERY_REQUIRED");
    if (this.machine.paymentOperations.recovery.held()) blockers.push("FINANCIAL_RECOVERY_REQUIRED");
    if (Number(meta.automation_halted)) blockers.push("AUTOMATION_HALTED");
    const checks = [
      ["UNRESOLVED_PAYMENT_VOID", "SELECT 1 FROM payment_void v LEFT JOIN payment_void_external_review r ON r.action_id=v.action_id WHERE v.state IN ('INTENT','UNKNOWN') AND r.action_id IS NULL LIMIT 1"],
      ["CART_ACTIVE", "SELECT 1 FROM cart_item LIMIT 1"],
      ["NONTERMINAL_SALE", "SELECT 1 FROM sale WHERE state NOT IN ('COMPLETED','PAYMENT_DECLINED','PAYMENT_CANCELLED') LIMIT 1"],
      ["UNRESOLVED_PAYMENT", "SELECT 1 FROM sale WHERE payment_state NOT IN ('NOT_REQUESTED','DECLINED','CANCELLED','SETTLED') LIMIT 1"],
      ["PENDING_OR_UNCERTAIN_COMMAND", "SELECT 1 FROM command_intent WHERE completed_at IS NULL OR state='SENT_UNKNOWN' LIMIT 1"],
      ["RESTOCK_IN_PROGRESS", "SELECT 1 FROM restock_session WHERE finalized_at IS NULL LIMIT 1"],
      ["CERTIFICATION_IN_PROGRESS", "SELECT 1 FROM certification_session WHERE completed_at IS NULL LIMIT 1"],
    ] as const;
    for (const [code, sql] of checks) if (store.maybeOne(sql)) blockers.push(code);
    if (!store.integrityCheck().ok) blockers.push("LOCAL_INTEGRITY_FAILED");
    return { schemaVersion: 1, maintenanceActive: this.active, restartAllowed: this.active && blockers.length === 0, blockers,
      localSchemaVersion: Number(meta.schema_version), buildIdentity: { appVersion: String(meta.app_version), sourceCommit: String(meta.source_commit) } };
  }

  enter(): Promise<MaintenanceStatus> {
    if (this.entering) return this.entering;
    this.entering = this.enterOnce().finally(() => { this.entering = null; });
    return this.entering;
  }

  private async enterOnce(): Promise<MaintenanceStatus> {
    if (this.active) return this.status();
    const before = await this.status();
    if (before.blockers.length) return before; // unsafe entry has no side effects
    try {
      await this.lifecycle.quiesce();
      const drained = await this.status();
      if (drained.blockers.length) { await this.lifecycle.resume(); return drained; }
      const now = (this.lifecycle.now?.() ?? new Date()).toISOString();
      this.machine.store.transaction(() => {
        this.machine.store.run("UPDATE machine_meta SET service_locked=1,public_state_version=public_state_version+1 WHERE singleton=1");
        this.machine.store.run("UPDATE staff_session SET locked_at=COALESCE(locked_at,?),ended_at=COALESCE(ended_at,?) WHERE ended_at IS NULL", now, now);
      });
      this.active = true;
      return { ...drained, maintenanceActive: true, restartAllowed: true };
    } catch (error) {
      if (!this.active) await this.lifecycle.resume();
      throw error;
    }
  }
}
