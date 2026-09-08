import type { KeyObject } from "node:crypto";
import {
  SignedVaultConfigSchema,
  canonicalJson,
  configDoorIds,
  configMachineProfile,
  machineProfileDigest,
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
    const profile = configMachineProfile(signed.payload);
    if (profile) for (const row of this.store.all(`SELECT payload_json FROM config_snapshot`)) {
      const prior = configMachineProfile(parseJson<VaultConfigPayload>(row.payload_json));
      if (!prior || prior.profileId !== profile.profileId) continue;
      if (prior.revision > profile.revision) throw new VaultError("PROFILE_DOWNGRADE", "Profile revision cannot regress", 409);
      if (prior.revision === profile.revision && machineProfileDigest(prior) !== machineProfileDigest(profile)) throw new VaultError("PROFILE_REVISION_CONFLICT", "Profile revision already has different content", 409);
    }
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
    if (this.store.maybeOne(`SELECT 1 FROM cart_item LIMIT 1`)) reasons.push("ACTIVE_CART");
    if (this.store.maybeOne(`SELECT 1 FROM sale WHERE state NOT IN ('COMPLETED','PAYMENT_DECLINED','PAYMENT_CANCELLED') LIMIT 1`)) reasons.push("ACTIVE_SALE");
    if (this.store.maybeOne(`SELECT 1 FROM sale WHERE payment_state NOT IN ('NOT_REQUESTED','DECLINED','CANCELLED','SETTLED') LIMIT 1`)) reasons.push("ACTIVE_PAYMENT");
    if (this.store.maybeOne(`SELECT 1 FROM command_intent WHERE completed_at IS NULL LIMIT 1`)) reasons.push("ACTIVE_COMMAND");
    if (this.store.maybeOne(`SELECT 1 FROM staff_session WHERE ended_at IS NULL LIMIT 1`)) reasons.push("ACTIVE_STAFF_SESSION");
    if (this.store.maybeOne(`SELECT 1 FROM restock_session WHERE finalized_at IS NULL LIMIT 1`)) reasons.push("ACTIVE_RESTOCK");
    if (this.store.maybeOne(`SELECT 1 FROM certification_session WHERE status IN ('ACTIVE','CRITICAL_STOP') LIMIT 1`)) reasons.push("ACTIVE_CERTIFICATION");
    return reasons;
  }

  pending(): { version: number; digest: string; profileId: string; revision: number; requiresReconfiguration: boolean } | null {
    const row = this.store.maybeOne(`SELECT c.version,c.digest,c.payload_json FROM machine_meta m JOIN config_snapshot c ON c.version=m.pending_config_version WHERE m.singleton=1`);
    if (!row) return null;
    const payload = parseJson<VaultConfigPayload>(row.payload_json); const profile = configMachineProfile(payload);
    return { version: Number(row.version), digest: String(row.digest), profileId: profile?.profileId ?? "legacy-v1", revision: profile?.revision ?? 1, requiresReconfiguration: this.requiresReconfiguration(payload) };
  }

  private requiresReconfiguration(payload: VaultConfigPayload): boolean {
    const active = this.active();
    if (!active) return Boolean(this.store.maybeOne(`SELECT 1 FROM door LIMIT 1`));
    return canonicalJson({ profile: configMachineProfile(active.payload), mapping: active.payload.doorMapping }) !== canonicalJson({ profile: configMachineProfile(payload), mapping: payload.doorMapping });
  }

  /** Only VaultMachine's freshly authenticated service operation supplies this authority. */
  activatePending(service?: { sessionId: string; userId: string; expectedVersion: number; expectedDigest: string }): { activated: boolean; version: number | null; reasons: string[] } {
    const meta = this.store.one(`SELECT pending_config_version FROM machine_meta WHERE singleton=1`);
    if (!meta.pending_config_version) return { activated: false, version: null, reasons: ["NO_PENDING_CONFIG"] };
    const pending = this.pending()!;
    if (service && (pending.version !== service.expectedVersion || pending.digest !== service.expectedDigest)) throw new VaultError("PROFILE_ACTIVATION_CHANGED", "Pending configuration changed after review", 409);
    const reasons = this.safeBoundaryReasons().filter(reason => !(service && reason === "ACTIVE_STAFF_SESSION"));
    if (reasons.length) return { activated: false, version: Number(meta.pending_config_version), reasons };
    const version = Number(meta.pending_config_version);
    const payload = parseJson<VaultConfigPayload>(this.store.one(`SELECT payload_json FROM config_snapshot WHERE version=?`, version).payload_json);
    this.validateCached(version);
    if (new Date(payload.expiresAt).getTime() <= this.clock.now().getTime()) throw new VaultError("CONFIG_EXPIRED", "Pending configuration expired before activation", 409);
    if (pending.requiresReconfiguration && !service) return { activated: false, version, reasons: ["PROFILE_RECONFIGURATION_REQUIRED"] };
    if (service) {
      if (!this.store.maybeOne(`SELECT 1 FROM staff_session WHERE session_id=? AND user_id=? AND ended_at IS NULL AND locked_at IS NULL AND role IN ('TECHNICIAN','ADMIN')`, service.sessionId, service.userId)
        || !this.store.maybeOne(`SELECT 1 FROM machine_meta WHERE singleton=1 AND service_locked=1 AND automation_halted=0 AND recovery_required=0`)) throw new VaultError("PROFILE_SERVICE_AUTHORITY_INVALID", "Profile activation requires the current Technician or Admin service session", 403);
      if (this.store.maybeOne(`SELECT 1 FROM door WHERE active=1 AND (state<>'EMPTY' OR product_id IS NOT NULL OR owning_sale_id IS NOT NULL OR owning_restock_id IS NOT NULL) LIMIT 1`)) throw new VaultError("PROFILE_RECONFIGURATION_NOT_EMPTY", "Every current compartment must be reconciled and empty before reconfiguration", 409);
    }
    const profile = configMachineProfile(payload); const profileDigest = profile ? machineProfileDigest(profile) : null;
    const previous = this.active();
    const orderedDoors = configDoorIds(payload);
    this.store.transaction(() => {
      // Cloud membership changes on heartbeat, before it accepts new-profile
      // facts. First deliver every older state-bearing fact against its old
      // membership, including the observations that emptied these compartments.
      // Freshness and authentication audits can be appended after a successful
      // flush and do not mutate that projection.
      if (pending.requiresReconfiguration && this.store.maybeOne(`SELECT 1 FROM outbox o JOIN machine_event e ON e.event_id=o.event_id WHERE o.acknowledged_at IS NULL AND e.type NOT IN ('CLOUD_FRESHNESS_PROVEN','STAFF_GRANT_IMPORTED','STAFF_AUTHENTICATED','CONFIG_STAGED') LIMIT 1`)) {
        throw new VaultError("PROFILE_CLOUD_RECONCILIATION_REQUIRED", "Wait for earlier machine activity to sync to the cloud, then retry profile activation", 409);
      }
      // Releasing only the current address index allows arbitrary explicit swaps
      // without changing or deleting a retired door or historical command.
      const priorDoors = new Map(this.store.all(`SELECT * FROM door`).map(door => [String(door.door_id), door]));
      this.store.run(`UPDATE door SET active=0`);
      for (const mapping of payload.doorMapping) {
        const existing = priorDoors.get(mapping.doorId);
        const profileDoor = profile?.doors.find(door => door.doorId === mapping.doorId);
        const endpoint = "controllerEndpointId" in mapping ? mapping.controllerEndpointId! : "legacy";
        const label = profileDoor?.label ?? mapping.doorId;
        const physicalIdentity = canonicalJson({ door: profileDoor ?? { doorId: mapping.doorId }, endpoint, channel: mapping.controllerChannel });
        if (existing && Number(existing.active) === 0 && (existing.physical_identity_json ? existing.physical_identity_json !== physicalIdentity : profile !== null || existing.controller_endpoint_id !== endpoint || existing.controller_channel !== mapping.controllerChannel || existing.door_label !== label)) throw new VaultError("RETIRED_DOOR_REBIND_FORBIDDEN", "Retired door identity cannot be rebound to a different compartment or controller address", 409);
        if (!existing) {
          this.store.run(`INSERT INTO door(door_id,controller_channel,controller_endpoint_id,mapping_version,state,planned_product_id,door_label,profile_digest,display_order,physical_identity_json) VALUES(?,?,?,?,?,?,?,?,?,?)`, mapping.doorId, mapping.controllerChannel, endpoint, String(version), "EMPTY", payload.assignments[mapping.doorId] ?? null, label, profileDigest, orderedDoors.indexOf(mapping.doorId), physicalIdentity);
        } else {
          this.store.run(`UPDATE door SET active=1,controller_channel=?,controller_endpoint_id=?,mapping_version=?,planned_product_id=?,door_label=?,profile_digest=?,display_order=?,physical_identity_json=?,version=version+1 WHERE door_id=?`, mapping.controllerChannel, endpoint, String(version), payload.assignments[mapping.doorId] ?? null, label, profileDigest, orderedDoors.indexOf(mapping.doorId), physicalIdentity, mapping.doorId);
        }
      }
      if (service) {
        this.store.run(`UPDATE staff_session SET ended_at=? WHERE session_id=?`, iso(this.clock.now()), service.sessionId);
        this.events.append({ type: "PROFILE_RECONFIGURATION_ACTIVATED", actor: service.userId, payload: { previousConfigVersion: previous?.payload.version ?? null, previousConfigDigest: previous?.digest ?? null, configVersion: version, configDigest: pending.digest, profileDigest, compartmentsEmpty: true, servicedDoorsClosed: true } });
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

  validateCached(version?: number): void {
    const row = version === undefined
      ? this.store.maybeOne(`SELECT c.* FROM machine_meta m JOIN config_snapshot c ON c.version=m.active_config_version WHERE m.singleton=1`)
      : this.store.maybeOne(`SELECT * FROM config_snapshot WHERE version=?`, version);
    if (!row) return;
    const signed = SignedVaultConfigSchema.parse(parseJson(row.signed_json));
    const key = this.pinnedKeys[signed.keyId];
    const machineId = this.store.one(`SELECT machine_id FROM machine_meta WHERE singleton=1`).machine_id;
    if (!key || !verifySignedConfig(signed, key as string) || signed.payload.machineId !== machineId
      || signed.payload.version !== Number(row.version) || signed.digest !== row.digest
      || json(signed.payload) !== json(parseJson(row.payload_json)) || compareSemver(this.appVersion, signed.payload.minimumAppVersion) < 0) {
      throw new VaultError("CACHED_CONFIG_INVALID", "Cached configuration no longer matches trusted signed authority", 503);
    }
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
