import { VaultCloudClient, VaultCloudError } from "./cloud-client";
import { OutboxSynchronizer } from "./events";
import { VaultMachine } from "./machine";
import { VaultError, type Clock } from "./types";
import { iso } from "./util";

export interface VaultRuntimeOptions {
  clock: Clock;
  broadcast: () => Promise<void>;
  reportError?: (code: string) => void;
  localTickMs?: number;
  cloudTickMs?: number;
}

/** Coordinates the existing authorities. Cloud I/O never owns or blocks paid effects. */
export class VaultRuntime {
  readonly outbox: OutboxSynchronizer;
  private syncPromise: Promise<void> | null = null;
  private localPromise: Promise<void> | null = null;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private stopped = false;

  constructor(readonly machine: VaultMachine, readonly cloud: VaultCloudClient, private readonly options: VaultRuntimeOptions) {
    if (String(machine.store.one("SELECT machine_id FROM machine_meta WHERE singleton=1").machine_id) !== cloud.machineId) throw new VaultError("CLOUD_MACHINE_MISMATCH", "Cloud transport belongs to a different machine");
    this.outbox = new OutboxSynchronizer(machine.store, options.clock, cloud);
    // A persisted timestamp from a previous boot cannot prove current reachability.
    machine.store.run("UPDATE machine_meta SET last_cloud_success_at=NULL WHERE singleton=1");
  }

  start(): void {
    if (this.timers.length || this.stopped) return;
    const localMs = this.options.localTickMs ?? 1_000;
    const cloudMs = this.options.cloudTickMs ?? 15_000;
    if (!Number.isInteger(localMs) || localMs < 10 || localMs > 300_000 || !Number.isInteger(cloudMs) || cloudMs < 10 || cloudMs > 300_000) throw new VaultError("RUNTIME_INTERVAL_INVALID", "Runtime intervals must be between 10 and 300000 milliseconds");
    const runLocal = () => { void this.tickLocal().catch((error) => this.options.reportError?.(safeCode(error))); };
    const runCloud = () => { void this.synchronize().catch((error) => this.options.reportError?.(safeCode(error))); };
    this.timers = [setInterval(runLocal, localMs), setInterval(runCloud, cloudMs)];
    runLocal(); runCloud();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    await Promise.allSettled([this.localPromise, this.syncPromise]);
  }

  tickLocal(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.localPromise) return this.localPromise;
    this.localPromise = (async () => {
      await this.machine.advancePayments();
      this.machine.activatePendingConfig();
      // publicState advances idle/paid timers and staff locks even with no browser.
      await this.machine.publicState();
      await this.options.broadcast();
    })().finally(() => { this.localPromise = null; });
    return this.localPromise;
  }

  /** Called for every new checkout, in addition to the periodic synchronization. */
  async proveCheckoutReachability(): Promise<void> {
    if (this.stopped) throw new VaultError("CLOUD_UNAVAILABLE", "Cloud synchronization is stopped", 503);
    // A caller joining an older cycle still performs a new server round trip.
    if (this.syncPromise) await this.syncPromise;
    await this.synchronize();
  }

  synchronize(): Promise<void> {
    if (this.stopped) return Promise.reject(new VaultError("CLOUD_UNAVAILABLE", "Cloud synchronization is stopped", 503));
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.syncOnce().catch((error) => {
      const code = safeCode(error);
      this.machine.store.run("UPDATE machine_meta SET last_cloud_success_at=NULL WHERE singleton=1");
      this.machine.store.run("UPDATE cloud_sync_state SET last_error_code=? WHERE singleton=1", code);
      throw new VaultError(code, "Cloud synchronization is unavailable; existing transactions continue locally", 503);
    }).finally(() => { this.syncPromise = null; });
    return this.syncPromise;
  }

  private async syncOnce(): Promise<void> {
    const store = this.machine.store;
    const cached = store.maybeOne("SELECT c.digest FROM machine_meta m JOIN config_snapshot c ON c.version=COALESCE(m.pending_config_version,m.active_config_version) WHERE m.singleton=1");
    const result = await this.cloud.config(cached ? String(cached.digest) : undefined);
    if (result.config) this.machine.stageConfig(result.config);
    this.machine.activatePendingConfig();

    // Page cursors advance only after every grant is verified and durably imported.
    // A partial failure replays safely from the prior cursor, never skips revocations.
    for (let page = 0; page < 20; page += 1) {
      const cursor = Number(store.one("SELECT last_grant_version FROM cloud_sync_state WHERE singleton=1").last_grant_version);
      const response = await this.cloud.staffGrants(cursor);
      for (const grant of response.grants) this.machine.staff.importGrant(grant);
      store.run("UPDATE cloud_sync_state SET last_grant_version=? WHERE singleton=1", response.latestGrantVersion);
      if (!response.hasMore) break;
      if (page === 19) throw new VaultCloudError("CLOUD_GRANT_BACKLOG");
    }

    const state = await this.machine.publicState();
    const active = this.machine.config.active();
    const meta = store.one("SELECT app_version,schema_version,source_commit FROM machine_meta WHERE singleton=1");
    const observedAt = this.options.clock.now();
    const serverTime = await this.cloud.heartbeat({
      contractVersion: 1, appVersion: String(meta.app_version), localSchemaVersion: Number(meta.schema_version),
      ...(/^[a-f0-9]{40}$/.test(String(meta.source_commit)) ? { sourceCommit: String(meta.source_commit) } : {}),
      configVersion: active?.payload.version ?? null, configDigest: active?.digest ?? null,
      health: state.health, readinessReasons: state.readinessReasons,
      availableDoorCount: state.doors.filter((door) => door.state === "AVAILABLE").length,
      outboxPendingCount: this.outbox.pressure().count, serviceLocked: state.serviceLocked, observedAt: iso(observedAt),
    });
    if (Math.abs(serverTime.getTime() - this.options.clock.now().getTime()) > 300_000) throw new VaultCloudError("CLOUD_CLOCK_UNSAFE");
    // Staff can finish a safe reconfiguration while heartbeat is in flight.
    // Its new-profile facts must wait until another heartbeat creates that
    // membership. The following synchronous batch capture then prevents newer
    // events arriving during delivery from entering this already-captured batch.
    if (this.machine.config.active()?.digest !== active?.digest) throw new VaultCloudError("CLOUD_CONFIG_CHANGED_DURING_SYNC");
    const delivery = await this.outbox.flush();
    if (delivery.rejected) throw new VaultCloudError(delivery.failureCode ?? "CLOUD_EVENT_REJECTED");
    // A backed-off head cannot be skipped just because this cycle sent zero rows.
    if (store.maybeOne("SELECT 1 FROM outbox WHERE acknowledged_at IS NULL AND attempt_count>0 LIMIT 1")) throw new VaultCloudError("CLOUD_EVENT_BACKOFF");
    if (!result.config && !result.unchanged) throw new VaultCloudError("CLOUD_CONFIG_UNAVAILABLE");
    this.machine.markCloudContact(this.options.clock.now());
    store.run("UPDATE cloud_sync_state SET last_error_code=NULL,last_success_at=? WHERE singleton=1", iso(this.options.clock.now()));
    await this.options.broadcast();
  }
}

function safeCode(error: unknown): string {
  if ((error instanceof VaultCloudError || error instanceof VaultError) && /^[A-Z0-9_]{1,120}$/.test(error.code)) return error.code;
  return "CLOUD_SYNC_FAILED";
}
