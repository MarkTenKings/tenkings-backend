import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { VaultStaffGrantSchema, roleMay, type VaultPermission, type VaultRole } from "../../vault-contracts/dist";
import { EventRepository } from "./events";
import { VaultStore } from "./store";
import { iso, json } from "./util";
import { VaultError, type Clock } from "./types";

const PIN_PATTERN = /^\d{6}$/;
const DEFAULT_SCRYPT = { N: 16_384, r: 8, p: 1, keyLength: 64 } as const;

export function createScryptPinVerifier(pin: string, salt = randomBytes(16)): string {
  if (!PIN_PATTERN.test(pin)) throw new VaultError("PIN_FORMAT_INVALID", "PIN must contain exactly six digits");
  const hash = scryptSync(pin, salt, DEFAULT_SCRYPT.keyLength, { N: DEFAULT_SCRYPT.N, r: DEFAULT_SCRYPT.r, p: DEFAULT_SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$v=1$N=${DEFAULT_SCRYPT.N},r=${DEFAULT_SCRYPT.r},p=${DEFAULT_SCRYPT.p},l=${DEFAULT_SCRYPT.keyLength}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyScryptPin(pin: string, verifier: string): boolean {
  if (!PIN_PATTERN.test(pin)) return false;
  const pieces = verifier.split("$");
  if (pieces.length !== 5 || pieces[0] !== "scrypt" || pieces[1] !== "v=1") return false;
  const params = Object.fromEntries((pieces[2] ?? "").split(",").map((entry) => entry.split("=")));
  const N = Number(params.N); const r = Number(params.r); const p = Number(params.p); const length = Number(params.l);
  if (N !== DEFAULT_SCRYPT.N || r !== DEFAULT_SCRYPT.r || p !== DEFAULT_SCRYPT.p || length !== DEFAULT_SCRYPT.keyLength) return false;
  let salt: Buffer; let expected: Buffer;
  try { salt = Buffer.from(pieces[3] ?? "", "base64"); expected = Buffer.from(pieces[4] ?? "", "base64"); }
  catch { return false; }
  if (salt.length < 16 || expected.length !== length) return false;
  const actual = scryptSync(pin, salt, length, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, expected);
}

export class StaffAuthService {
  constructor(private readonly store: VaultStore, private readonly events: EventRepository, private readonly clock: Clock) {}

  importGrant(input: unknown): void {
    const grant = VaultStaffGrantSchema.parse(input);
    const machineId = String(this.store.one(`SELECT machine_id FROM machine_meta WHERE singleton=1`).machine_id);
    if (grant.machineId !== machineId) throw new VaultError("GRANT_MACHINE_MISMATCH", "Staff grant belongs to a different machine", 409);
    if (grant.hashAlgorithm !== "scrypt") throw new VaultError("GRANT_HASH_UNSUPPORTED", "This build accepts only reviewed scrypt verifiers", 409);
    this.store.transaction(() => {
      this.store.run(
        `INSERT INTO staff_grant(grant_id,user_id,machine_id,role,verifier_version,verifier,hash_algorithm,hash_parameters_json,valid_from,expires_at,revoked_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(grant_id) DO UPDATE SET role=excluded.role,verifier_version=excluded.verifier_version,verifier=excluded.verifier,hash_parameters_json=excluded.hash_parameters_json,valid_from=excluded.valid_from,expires_at=excluded.expires_at,revoked_at=excluded.revoked_at`,
        grant.grantId, grant.userId, grant.machineId, grant.role, grant.verifierVersion, grant.verifier, grant.hashAlgorithm, json(grant.hashParameters), grant.validFrom, grant.expiresAt, grant.revokedAt,
      );
      this.events.append({ type: "STAFF_GRANT_IMPORTED", actor: "CLOUD", payload: { grantId: grant.grantId, userId: grant.userId, role: grant.role, verifierVersion: grant.verifierVersion, revoked: Boolean(grant.revokedAt) } });
    });
  }

  authenticate(userId: string, pin: string): { sessionId: string; userId: string; role: VaultRole; expiresAt: string } {
    const now = this.clock.now();
    const authState = this.store.maybeOne(`SELECT failure_count,blocked_until FROM staff_auth_state WHERE user_id=?`, userId);
    if (authState?.blocked_until && new Date(String(authState.blocked_until)).getTime() > now.getTime()) {
      this.auditFailure(userId, "BACKOFF_ACTIVE", false);
      throw new VaultError("STAFF_AUTH_FAILED", "Staff authentication failed", 429);
    }
    const grant = this.store.maybeOne(
      `SELECT * FROM staff_grant WHERE user_id=? AND revoked_at IS NULL AND valid_from<=? AND expires_at>? ORDER BY verifier_version DESC LIMIT 1`,
      userId, iso(now), iso(now),
    );
    const valid = grant ? verifyScryptPin(pin, String(grant.verifier)) : false;
    if (!valid) {
      const failures = Number(authState?.failure_count ?? 0) + 1;
      const delaySeconds = Math.min(900, failures <= 2 ? 0 : 2 ** Math.min(10, failures - 2));
      this.store.transaction(() => {
        this.store.run(
          `INSERT INTO staff_auth_state(user_id,failure_count,blocked_until,last_failure_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET failure_count=excluded.failure_count,blocked_until=excluded.blocked_until,last_failure_at=excluded.last_failure_at`,
          userId, failures, delaySeconds ? iso(new Date(now.getTime() + delaySeconds * 1000)) : null, iso(now),
        );
        this.auditFailure(userId, "INVALID_CREDENTIAL", true);
      });
      throw new VaultError("STAFF_AUTH_FAILED", "Staff authentication failed", 401);
    }
    const activePublic = this.store.maybeOne(`SELECT 1 FROM sale WHERE state NOT IN ('COMPLETED','PAYMENT_DECLINED','PAYMENT_CANCELLED') LIMIT 1`);
    if (activePublic) throw new VaultError("STAFF_ENTRY_UNSAFE", "Staff mode cannot begin during an active transaction", 409);
    const sessionId = randomUUID(); const expiresAt = iso(new Date(now.getTime() + 8 * 60 * 60 * 1000));
    this.store.transaction(() => {
      this.store.run(`UPDATE staff_session SET ended_at=? WHERE ended_at IS NULL`, iso(now));
      this.store.run(`INSERT INTO staff_session(session_id,grant_id,user_id,role,created_at,last_active_at,expires_at) VALUES(?,?,?,?,?,?,?)`, sessionId, grant!.grant_id, userId, grant!.role, iso(now), iso(now), expiresAt);
      this.store.run(`INSERT INTO staff_auth_state(user_id,failure_count) VALUES(?,0) ON CONFLICT(user_id) DO UPDATE SET failure_count=0,blocked_until=NULL`, userId);
      this.store.run(`UPDATE machine_meta SET service_locked=1 WHERE singleton=1`);
      this.events.append({ type: "STAFF_AUTHENTICATED", actor: userId, payload: { sessionId, role: grant!.role, grantId: grant!.grant_id } });
      this.store.bumpStateVersion();
    });
    return { sessionId, userId, role: grant!.role as VaultRole, expiresAt };
  }

  requireSession(sessionId: string, permission?: VaultPermission): { userId: string; role: VaultRole; sessionId: string } {
    const now = this.clock.now();
    const row = this.store.maybeOne(`SELECT * FROM staff_session WHERE session_id=? AND ended_at IS NULL AND expires_at>?`, sessionId, iso(now));
    if (!row || row.locked_at) throw new VaultError("STAFF_SESSION_INVALID", "Staff session is locked or expired", 401);
    const idleMs = now.getTime() - new Date(String(row.last_active_at)).getTime();
    if (idleMs >= 120_000) {
      this.lock(sessionId, "INACTIVITY");
      throw new VaultError("STAFF_SESSION_LOCKED", "Staff session locked after inactivity", 401);
    }
    const role = row.role as VaultRole;
    if (permission && !roleMay(role, permission)) throw new VaultError("STAFF_PERMISSION_DENIED", "Staff role does not permit this action", 403);
    this.store.run(`UPDATE staff_session SET last_active_at=? WHERE session_id=?`, iso(now), sessionId);
    return { sessionId, userId: String(row.user_id), role };
  }

  lock(sessionId: string, reason = "EXPLICIT"): void {
    const row = this.store.maybeOne(`SELECT user_id FROM staff_session WHERE session_id=? AND ended_at IS NULL`, sessionId);
    if (!row) return;
    this.store.transaction(() => {
      this.store.run(`UPDATE staff_session SET locked_at=COALESCE(locked_at,?) WHERE session_id=?`, iso(this.clock.now()), sessionId);
      this.store.run(`UPDATE machine_meta SET service_locked=1 WHERE singleton=1`);
      this.events.append({ type: "SERVICE_SESSION_LOCKED", actor: String(row.user_id), payload: { sessionId, reason } });
      this.store.bumpStateVersion();
    });
  }

  safeExit(sessionId: string, physicalCloseConfirmed: boolean): void {
    if (!physicalCloseConfirmed) throw new VaultError("PHYSICAL_CLOSE_CONFIRMATION_REQUIRED", "Safe exit requires serviced-doors-closed confirmation", 409);
    const actor = this.requireSession(sessionId, "RESTOCK_RUN");
    if (this.store.maybeOne(`SELECT 1 FROM restock_session WHERE finalized_at IS NULL`)) throw new VaultError("RESTOCK_NOT_FINALIZED", "Active restock must be finalized before safe exit", 409);
    if (this.store.maybeOne(`SELECT 1 FROM command_intent ci JOIN certification_session cs ON cs.session_id=ci.certification_session_id LEFT JOIN certification_evidence ce ON ce.command_id=ci.command_id WHERE cs.status='ACTIVE' AND ce.command_id IS NULL LIMIT 1`)) {
      throw new VaultError("CERTIFICATION_OBSERVATION_REQUIRED", "Current certification command requires a recorded observation before safe exit", 409);
    }
    if (this.store.maybeOne(`SELECT 1 FROM certification_session WHERE status='ACTIVE' LIMIT 1`)) {
      throw new VaultError("CERTIFICATION_NOT_SUBMITTED", "Active certification must be submitted for cloud review before safe exit", 409);
    }
    this.store.transaction(() => {
      this.store.run(`UPDATE staff_session SET ended_at=? WHERE session_id=?`, iso(this.clock.now()), sessionId);
      this.store.run(`UPDATE machine_meta SET service_locked=0 WHERE singleton=1`);
      this.events.append({ type: "SERVICE_SAFE_EXIT", actor: actor.userId, payload: { sessionId, physicalCloseConfirmed: true } });
      this.store.bumpStateVersion();
    });
  }

  private auditFailure(userId: string, reason: string, append: boolean): void {
    if (append) this.events.append({ type: "STAFF_AUTH_FAILED", payload: { userId, reason } });
  }
}
