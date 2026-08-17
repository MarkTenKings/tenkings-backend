import type { KeyObject } from "node:crypto";
import {
  SignedVaultConfigSchema,
  VAULT_DOOR_MAP,
  verifySignedConfig,
  type SignedVaultConfig,
  type VaultConfigPayload,
} from "../../vault-contracts/dist";
import { VaultStore } from "./store";
import { EventRepository } from "./events";
import { iso, json, parseJson } from "./util";
import { VaultError, type Clock } from "./types";

export type PublicKey = string | Buffer | KeyObject;

export class ConfigManager {
  constructor(
    private readonly store: VaultStore,
    private readonly events: EventRepository,
    private readonly clock: Clock,
    private readonly pinnedKeys: Readonly<Record<string, PublicKey>>,
    private readonly appVersion: string,
  ) {}

  stage(input: SignedVaultConfig): { pendingVersion: number } {
    const signed = SignedVaultConfigSchema.parse(input);
    const key = this.pinnedKeys[signed.keyId];
    if (!key) throw new VaultError("CONFIG_KEY_NOT_PINNED", "Configuration signing key is not pinned", 409);
    if (!verifySignedConfig(signed, key as string)) throw new VaultError("CONFIG_SIGNATURE_INVALID", "Configuration signature or digest is invalid", 409);
    const meta = this.store.one(`SELECT machine_id,active_config_version,pending_config_version FROM machine_meta WHERE singleton=1`);
    if (signed.payload.machineId !== meta.machine_id) throw new VaultError("CONFIG_MACHINE_MISMATCH", "Configuration belongs to a different machine", 409);
    if (new Date(signed.payload.expiresAt).getTime() <= this.clock.now().getTime()) throw new VaultError("CONFIG_EXPIRED", "Configuration is expired", 409);
    if (compareSemver(this.appVersion, signed.payload.minimumAppVersion) < 0) throw new VaultError("CONFIG_APP_TOO_OLD", "Application version is below configuration minimum", 409);
    const floor = Math.max(Number(meta.active_config_version ?? 0), Number(meta.pending_config_version ?? 0));
    if (signed.payload.version < floor) throw new VaultError("CONFIG_DOWNGRADE", "Configuration downgrade is forbidden", 409);
    const existing = this.store.maybeOne(`SELECT digest FROM config_snapshot WHERE version=?`, signed.payload.version);
    if (existing && existing.digest !== signed.digest) throw new VaultError("CONFIG_VERSION_CONFLICT", "Configuration version already has different content", 409);
    this.store.transaction(() => {
      this.store.run(`INSERT OR IGNORE INTO config_snapshot(version,digest,key_id,payload_json,signed_json,received_at) VALUES(?,?,?,?,?,?)`, signed.payload.version, signed.digest, signed.keyId, json(signed.payload), json(signed), iso(this.clock.now()));
      this.store.run(`UPDATE machine_meta SET pending_config_version=? WHERE singleton=1`, signed.payload.version);
      this.events.append({ type: "CONFIG_STAGED", payload: { version: signed.payload.version, digest: signed.digest, keyId: signed.keyId } });
      this.store.bumpStateVersion();
    });
    return { pendingVersion: signed.payload.version };
  }

  safeBoundaryReasons(): string[] {
    const reasons: string[] = [];
    if (this.store.maybeOne(`SELECT 1 FROM sale WHERE state NOT IN ('COMPLETED','PAYMENT_DECLINED','PAYMENT_CANCELLED') LIMIT 1`)) reasons.push("ACTIVE_SALE");
    if (this.store.maybeOne(`SELECT 1 FROM staff_session WHERE ended_at IS NULL LIMIT 1`)) reasons.push("ACTIVE_STAFF_SESSION");
    if (this.store.maybeOne(`SELECT 1 FROM restock_session WHERE finalized_at IS NULL LIMIT 1`)) reasons.push("ACTIVE_RESTOCK");
    return reasons;
  }

  activatePending(): { activated: boolean; version: number | null; reasons: string[] } {
    const meta = this.store.one(`SELECT pending_config_version FROM machine_meta WHERE singleton=1`);
    if (!meta.pending_config_version) return { activated: false, version: null, reasons: ["NO_PENDING_CONFIG"] };
    const reasons = this.safeBoundaryReasons();
    if (reasons.length) return { activated: false, version: Number(meta.pending_config_version), reasons };
    const version = Number(meta.pending_config_version);
    const payload = parseJson<VaultConfigPayload>(this.store.one(`SELECT payload_json FROM config_snapshot WHERE version=?`, version).payload_json);
    const assignmentIds = new Set(Object.keys(payload.assignments));
    if (assignmentIds.size !== 150 || VAULT_DOOR_MAP.some((door) => !assignmentIds.has(door.doorId))) throw new VaultError("CONFIG_ASSIGNMENTS_INVALID", "Configuration assignments must contain every door", 409);
    this.store.transaction(() => {
      const existingDoorCount = Number(this.store.one(`SELECT COUNT(*) AS count FROM door`).count);
      if (existingDoorCount) this.store.run(`UPDATE door SET controller_channel=controller_channel+1000`);
      for (const mapping of payload.doorMapping) {
        const existing = this.store.maybeOne(`SELECT state FROM door WHERE door_id=?`, mapping.doorId);
        if (!existing) {
          this.store.run(`INSERT INTO door(door_id,controller_channel,mapping_version,state,planned_product_id) VALUES(?,?,?,?,?)`, mapping.doorId, mapping.controllerChannel, String(version), "EMPTY", payload.assignments[mapping.doorId] ?? null);
        } else {
          this.store.run(`UPDATE door SET controller_channel=?,mapping_version=?,planned_product_id=?,version=version+1 WHERE door_id=?`, mapping.controllerChannel, String(version), payload.assignments[mapping.doorId] ?? null, mapping.doorId);
        }
      }
      this.store.run(`UPDATE config_snapshot SET activated_at=? WHERE version=?`, iso(this.clock.now()), version);
      this.store.run(`UPDATE machine_meta SET active_config_version=?,pending_config_version=NULL WHERE singleton=1`, version);
      this.events.append({ type: "CONFIG_ACTIVATED", payload: { version } });
      this.store.bumpStateVersion();
    });
    return { activated: true, version, reasons: [] };
  }

  active(): { payload: VaultConfigPayload; digest: string } | null {
    const row = this.store.maybeOne(`SELECT c.payload_json,c.digest FROM machine_meta m JOIN config_snapshot c ON c.version=m.active_config_version WHERE m.singleton=1`);
    return row ? { payload: parseJson<VaultConfigPayload>(row.payload_json), digest: String(row.digest) } : null;
  }
}

function compareSemver(left: string, right: string): number {
  const parse = (value: string): number[] => value.split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0);
  const a = parse(left); const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
