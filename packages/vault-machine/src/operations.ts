import { randomUUID } from "node:crypto";
import {
  VaultCertificationEvidenceSchema,
  nextUnderTestedDoor,
  type VaultDoorId,
  type VaultRestockItemState,
} from "../../vault-contracts/dist";
import { VaultMachine } from "./machine";
import { deterministicId, iso, json, parseJson } from "./util";
import { VaultError, type Clock } from "./types";

export class VaultOperationsService {
  constructor(private readonly machine: VaultMachine, private readonly clock: Clock) {}

  async startOrResumeRestock(staffSessionId: string, requestedDoorIds?: VaultDoorId[]): Promise<{ sessionId: string; expectedDoorIds: VaultDoorId[] }> {
    const actor = this.machine.staff.requireSession(staffSessionId, "RESTOCK_RUN");
    const existing = this.machine.store.maybeOne(`SELECT rs.*,ss.user_id AS actor_user_id FROM restock_session rs JOIN staff_session ss ON ss.session_id=rs.actor_session_id WHERE rs.finalized_at IS NULL ORDER BY rs.created_at DESC LIMIT 1`);
    if (existing) {
      if (existing.actor_user_id !== actor.userId && actor.role !== "ADMIN") throw new VaultError("RESTOCK_SESSION_SCOPE", "Restock belongs to a different staff identity", 403);
      if (existing.actor_session_id !== staffSessionId) {
        this.machine.store.run(`UPDATE restock_session SET actor_session_id=?,updated_at=? WHERE session_id=? AND finalized_at IS NULL`, staffSessionId, iso(this.clock.now()), existing.session_id);
        existing.actor_session_id = staffSessionId;
      }
      await this.ensureNextRestockCommand(existing, actor.userId);
      return { sessionId: String(existing.session_id), expectedDoorIds: parseJson<VaultDoorId[]>(existing.expected_door_ids_json) };
    }
    if (this.machine.store.maybeOne(`SELECT 1 FROM sale WHERE state NOT IN ('COMPLETED','PAYMENT_DECLINED','PAYMENT_CANCELLED') LIMIT 1`)) throw new VaultError("RESTOCK_PREFLIGHT_ACTIVE_SALE", "Restock cannot begin during an active sale", 409);
    const meta = this.machine.store.one(`SELECT active_config_version,automation_halted FROM machine_meta WHERE singleton=1`);
    if (!meta.active_config_version) throw new VaultError("RESTOCK_PREFLIGHT_CONFIG", "Restock requires an active configuration", 409);
    if (Number(meta.automation_halted) === 1) throw new VaultError("RESTOCK_AUTOMATION_HALTED", "Physical automation is halted", 409);
    const allEligible = this.machine.store.all(`SELECT door_id FROM door WHERE planned_product_id IS NOT NULL AND state IN ('EMPTY','COMMITTED_SOLD','SERVICE_HOLD','EXCEPTION') ORDER BY controller_channel`).map((row) => row.door_id as VaultDoorId);
    const requested = requestedDoorIds ?? allEligible;
    const eligible = new Set(allEligible);
    if (!requested.length || requested.some((doorId) => !eligible.has(doorId)) || new Set(requested).size !== requested.length) throw new VaultError("RESTOCK_DOOR_SET_INVALID", "Restock contains an ineligible or duplicate door", 409);
    const sessionId = randomUUID(); const now = iso(this.clock.now());
    this.machine.store.transaction(() => {
      this.machine.store.run(`INSERT INTO restock_session(session_id,actor_session_id,config_version,status,expected_door_ids_json,created_at,updated_at) VALUES(?,?,?,'IN_PROGRESS',?,?,?)`, sessionId, staffSessionId, meta.active_config_version, json(requested), now, now);
      for (const doorId of requested) {
        const door = this.machine.store.one(`SELECT planned_product_id FROM door WHERE door_id=?`, doorId);
        this.machine.store.run(`INSERT INTO restock_item(session_id,door_id,planned_product_id,outcome,updated_at) VALUES(?,?,?,'UNREVIEWED',?)`, sessionId, doorId, door.planned_product_id, now);
        this.machine.store.run(`UPDATE door SET state='SERVICE_HOLD',owning_restock_id=?,version=version+1 WHERE door_id=?`, sessionId, doorId);
      }
      const plannedItems = this.machine.store.all(`SELECT door_id,planned_product_id FROM restock_item WHERE session_id=? ORDER BY door_id`, sessionId).map((item) => ({ doorId: item.door_id, plannedProductId: item.planned_product_id }));
      this.machine.events.append({ type: "RESTOCK_SESSION_STARTED", actor: actor.userId, payload: { restockSessionId: sessionId, expectedDoorIds: requested, plannedItems, configVersion: meta.active_config_version } });
      this.machine.store.bumpStateVersion();
    });
    await this.ensureNextRestockCommand(this.machine.store.one(`SELECT * FROM restock_session WHERE session_id=?`, sessionId), actor.userId);
    return { sessionId, expectedDoorIds: requested };
  }

  recordRestockOutcome(staffSessionId: string, restockId: string, doorId: VaultDoorId, outcome: Exclude<VaultRestockItemState, "UNREVIEWED">, notes = ""): void {
    const actor = this.machine.staff.requireSession(staffSessionId, "RESTOCK_RUN");
    if (!(["FILLED", "LEFT_EMPTY", "EXCEPTION"] as const).includes(outcome)) throw new VaultError("RESTOCK_OUTCOME_INVALID", "Restock outcome must review exactly one door", 400);
    const session = this.machine.store.one(`SELECT * FROM restock_session WHERE session_id=? AND finalized_at IS NULL`, restockId);
    if (session.actor_session_id !== staffSessionId && actor.role !== "ADMIN") throw new VaultError("RESTOCK_SESSION_SCOPE", "Restock belongs to a different staff session", 403);
    const item = this.machine.store.one(`SELECT planned_product_id FROM restock_item WHERE session_id=? AND door_id=?`, restockId, doorId);
    const command = this.machine.store.maybeOne(`SELECT state FROM command_intent WHERE restock_session_id=? AND door_id=?`, restockId, doorId);
    if (!command || !["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"].includes(String(command.state))) {
      throw new VaultError("RESTOCK_COMMAND_NOT_TERMINAL", "A terminal controller receipt is required before recording the door observation", 409);
    }
    this.machine.store.transaction(() => {
      this.machine.store.run(`UPDATE restock_item SET outcome=?,notes=?,updated_at=? WHERE session_id=? AND door_id=?`, outcome, notes.slice(0, 1000), iso(this.clock.now()), restockId, doorId);
      if (outcome === "FILLED") this.machine.store.run(`UPDATE door SET state='AVAILABLE',product_id=?,owning_sale_id=NULL,owning_restock_id=NULL,version=version+1 WHERE door_id=?`, item.planned_product_id, doorId);
      else if (outcome === "LEFT_EMPTY") this.machine.store.run(`UPDATE door SET state='EMPTY',product_id=NULL,owning_sale_id=NULL,owning_restock_id=NULL,version=version+1 WHERE door_id=?`, doorId);
      else this.machine.store.run(`UPDATE door SET state='EXCEPTION',product_id=NULL,owning_restock_id=NULL,version=version+1 WHERE door_id=?`, doorId);
      this.machine.events.append({ type: "RESTOCK_DOOR_REVIEWED", actor: actor.userId, payload: { restockSessionId: restockId, doorId, outcome, notes } });
      const remaining = Number(this.machine.store.one(`SELECT COUNT(*) AS count FROM restock_item WHERE session_id=? AND outcome='UNREVIEWED'`, restockId).count);
      if (remaining === 0) this.machine.store.run(`UPDATE restock_session SET status='READY_TO_FINALIZE',updated_at=? WHERE session_id=?`, iso(this.clock.now()), restockId);
      this.machine.store.bumpStateVersion();
    });
  }

  finalizeRestock(staffSessionId: string, restockId: string, physicalCloseConfirmed: boolean): { filled: number; leftEmpty: number; exceptions: number } {
    const actor = this.machine.staff.requireSession(staffSessionId, "RESTOCK_RUN");
    if (!physicalCloseConfirmed) throw new VaultError("PHYSICAL_CLOSE_CONFIRMATION_REQUIRED", "Restock finalization requires physical-close confirmation", 409);
    const session = this.machine.store.one(`SELECT * FROM restock_session WHERE session_id=? AND finalized_at IS NULL`, restockId);
    if (session.actor_session_id !== staffSessionId && actor.role !== "ADMIN") throw new VaultError("RESTOCK_SESSION_SCOPE", "Restock belongs to a different staff session", 403);
    const counts = Object.fromEntries(this.machine.store.all(`SELECT outcome,COUNT(*) AS count FROM restock_item WHERE session_id=? GROUP BY outcome`, restockId).map((row) => [String(row.outcome), Number(row.count)]));
    if ((counts.UNREVIEWED ?? 0) !== 0) throw new VaultError("RESTOCK_REVIEW_INCOMPLETE", "Every restock door must be reviewed", 409);
    const result = { filled: counts.FILLED ?? 0, leftEmpty: counts.LEFT_EMPTY ?? 0, exceptions: counts.EXCEPTION ?? 0 };
    this.machine.store.transaction(() => {
      const now = iso(this.clock.now());
      this.machine.store.run(`UPDATE restock_session SET status='FINALIZED',physical_close_confirmed_at=?,finalized_at=?,updated_at=? WHERE session_id=?`, now, now, now, restockId);
      this.machine.events.append({ type: "RESTOCK_SESSION_FINALIZED", actor: actor.userId, payload: { restockSessionId: restockId, physicalCloseConfirmed: true, ...result } });
      this.machine.store.bumpStateVersion();
    });
    return result;
  }

  async startCertification(staffSessionId: string): Promise<{ sessionId: string; scheduledDoorId: VaultDoorId; commandId: string }> {
    const actor = this.machine.staff.requireSession(staffSessionId, "CERTIFICATION_COLLECT");
    const config = this.machine.config.active();
    if (!config) throw new VaultError("CERTIFICATION_CONFIG_MISSING", "Certification requires active config", 409);
    let session = this.machine.store.maybeOne(`SELECT * FROM certification_session WHERE status='ACTIVE' ORDER BY created_at DESC LIMIT 1`);
    if (!session) {
      const meta = this.machine.store.one(`SELECT source_commit,app_version FROM machine_meta WHERE singleton=1`);
      if (!/^[A-Za-z0-9._/-]{7,128}$/.test(String(meta.source_commit)) || meta.source_commit === "UNVERIFIED") {
        throw new VaultError("CERTIFICATION_BUILD_IDENTITY_UNVERIFIED", "Certification requires trusted service source-commit provenance", 409);
      }
      const sessionId = randomUUID(); const now = iso(this.clock.now());
      const controller = await this.machine.controller.identity(); const payment = await this.machine.payment.capabilities();
      this.machine.store.transaction(() => {
        this.machine.store.run(
          `INSERT INTO certification_session(session_id,actor_session_id,config_version,adapter_mode,status,source_commit,app_version,schema_version,controller_identity_json,payment_identity_json,retention_policy,created_at) VALUES(?,?,?,?,'ACTIVE',?,?,1,?,?,?,?)`,
          sessionId, staffSessionId, config.payload.version, payment.mode, meta.source_commit, meta.app_version, json(controller), json(payment), "SERVICE_LIFE_PLUS_3_YEARS", now,
        );
        this.machine.events.append({ type: "CERTIFICATION_SESSION_STARTED", mode: "CERTIFICATION", actor: actor.userId, payload: { certificationSessionId: sessionId, configVersion: config.payload.version, configDigest: config.digest, sourceCommit: meta.source_commit, appVersion: meta.app_version, localSchemaVersion: 1, contractVersion: 1, adapterMode: payment.mode, controllerIdentity: controller, paymentIdentity: payment, retentionPolicy: "SERVICE_LIFE_PLUS_3_YEARS" } });
        this.machine.store.bumpStateVersion();
      });
      session = this.machine.store.one(`SELECT * FROM certification_session WHERE session_id=?`, sessionId);
    } else if (session.actor_session_id !== staffSessionId) {
      this.machine.store.run(`UPDATE certification_session SET actor_session_id=? WHERE session_id=? AND status='ACTIVE'`, staffSessionId, session.session_id);
      session = this.machine.store.one(`SELECT * FROM certification_session WHERE session_id=?`, session.session_id);
    }
    return this.ensureNextCertificationCommand(session, actor.userId, config.payload.doorMapping);
  }

  recordCertificationEvidence(staffSessionId: string, input: unknown): { critical: boolean } {
    const actor = this.machine.staff.requireSession(staffSessionId, "CERTIFICATION_COLLECT");
    const evidence = VaultCertificationEvidenceSchema.parse(input);
    const session = this.machine.store.one(`SELECT status,actor_session_id FROM certification_session WHERE session_id=?`, evidence.sessionId);
    if (session.status !== "ACTIVE") throw new VaultError("CERTIFICATION_SESSION_INACTIVE", "Certification session is not active", 409);
    if (session.actor_session_id !== staffSessionId && actor.role !== "ADMIN") throw new VaultError("CERTIFICATION_SESSION_SCOPE", "Certification belongs to a different staff session", 403);
    const command = this.machine.store.maybeOne(`SELECT ci.* FROM command_intent ci LEFT JOIN certification_evidence ce ON ce.command_id=ci.command_id WHERE ci.certification_session_id=? AND ce.command_id IS NULL ORDER BY ci.created_at DESC LIMIT 1`, evidence.sessionId);
    if (!command || !["ACCEPTED", "SENT_UNKNOWN", "REJECTED", "TIMEOUT"].includes(String(command.state))) {
      throw new VaultError("CERTIFICATION_COMMAND_NOT_TERMINAL", "A terminal controller receipt is required before recording certification evidence", 409);
    }
    if (evidence.doorId !== command.door_id || evidence.expectedDoorIds.length !== 1 || evidence.expectedDoorIds[0] !== command.door_id) {
      throw new VaultError("CERTIFICATION_COMMAND_EVIDENCE_MISMATCH", "Certification evidence must describe the exact scheduled command door", 409);
    }
    const unexpected = evidence.observedDoorIds.some((doorId) => !evidence.expectedDoorIds.includes(doorId));
    const critical = evidence.outcome === "CRITICAL" || unexpected;
    this.machine.store.transaction(() => {
      this.machine.store.run(`INSERT INTO certification_evidence(evidence_id,session_id,command_id,door_id,evidence_class,outcome,expected_door_ids_json,observed_door_ids_json,notes,artifact_digest,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, evidence.evidenceId, evidence.sessionId, command.command_id, evidence.doorId ?? null, evidence.evidenceClass, critical ? "CRITICAL" : evidence.outcome, json(evidence.expectedDoorIds), json(evidence.observedDoorIds), evidence.notes, evidence.artifactDigest, evidence.observedAt);
      if (critical) {
        this.machine.store.run(`UPDATE machine_meta SET automation_halted=1,recovery_required=1 WHERE singleton=1`);
        this.machine.store.run(`UPDATE certification_session SET status='CRITICAL_STOP' WHERE session_id=?`, evidence.sessionId);
      }
      this.machine.events.append({ type: critical ? "CERTIFICATION_CRITICAL_STOP" : "CERTIFICATION_EVIDENCE_RECORDED", mode: "CERTIFICATION", actor: actor.userId, payload: { evidenceId: evidence.evidenceId, certificationSessionId: evidence.sessionId, doorId: evidence.doorId ?? null, evidenceClass: evidence.evidenceClass, outcome: critical ? "CRITICAL" : evidence.outcome, expectedDoorIds: evidence.expectedDoorIds, observedDoorIds: evidence.observedDoorIds, notes: evidence.notes, artifactDigest: evidence.artifactDigest, unexpectedDoor: unexpected } });
      this.machine.store.bumpStateVersion();
    });
    return { critical };
  }

  submitCertification(staffSessionId: string, certificationId: string, physicalCloseConfirmed: boolean): void {
    const actor = this.machine.staff.requireSession(staffSessionId, "CERTIFICATION_COLLECT");
    if (!physicalCloseConfirmed) throw new VaultError("PHYSICAL_CLOSE_CONFIRMATION_REQUIRED", "Certification submission requires physical-close confirmation", 409);
    const session = this.machine.store.one(`SELECT cs.*,ss.user_id AS actor_user_id FROM certification_session cs JOIN staff_session ss ON ss.session_id=cs.actor_session_id WHERE cs.session_id=?`, certificationId);
    if (session.status !== "ACTIVE") throw new VaultError("CERTIFICATION_SESSION_INACTIVE", "Only an active certification can be submitted", 409);
    if (session.actor_user_id !== actor.userId && actor.role !== "ADMIN") throw new VaultError("CERTIFICATION_SESSION_SCOPE", "Certification belongs to a different staff identity", 403);
    if (this.machine.store.maybeOne(`SELECT 1 FROM certification_evidence WHERE session_id=? AND outcome='CRITICAL' LIMIT 1`, certificationId)) {
      throw new VaultError("CERTIFICATION_CRITICAL_STOP", "Critical certification evidence requires independent recovery", 409);
    }
    if (this.machine.store.maybeOne(`SELECT 1 FROM command_intent ci LEFT JOIN certification_evidence ce ON ce.command_id=ci.command_id WHERE ci.certification_session_id=? AND ce.command_id IS NULL LIMIT 1`, certificationId)) {
      throw new VaultError("CERTIFICATION_OBSERVATION_REQUIRED", "Every scheduled certification command requires terminal human evidence before submission", 409);
    }
    const counts = Object.fromEntries(this.machine.store.all(`SELECT outcome,COUNT(*) AS count FROM certification_evidence WHERE session_id=? GROUP BY outcome`, certificationId).map((row) => [String(row.outcome), Number(row.count)]));
    if ((counts.PASS ?? 0) + (counts.FAIL ?? 0) === 0) throw new VaultError("CERTIFICATION_EVIDENCE_REQUIRED", "Certification submission requires recorded evidence", 409);
    this.machine.store.transaction(() => {
      const completedAt = iso(this.clock.now());
      const changed = this.machine.store.run(`UPDATE certification_session SET status='REVIEW_REQUIRED',completed_at=? WHERE session_id=? AND status='ACTIVE'`, completedAt, certificationId);
      if (changed.changes !== 1) throw new VaultError("CERTIFICATION_STATE_CONFLICT", "Certification state changed before submission", 409);
      this.machine.events.append({ type: "CERTIFICATION_SUBMITTED", mode: "CERTIFICATION", actor: actor.userId, payload: { certificationSessionId: certificationId, physicalCloseConfirmed: true, passCount: counts.PASS ?? 0, failCount: counts.FAIL ?? 0 } });
      this.machine.store.bumpStateVersion();
    });
  }

  private async ensureNextRestockCommand(session: Record<string, unknown>, actorUserId: string): Promise<void> {
    const unobserved = this.machine.store.maybeOne(`SELECT ci.command_id FROM command_intent ci JOIN restock_item ri ON ri.session_id=ci.restock_session_id AND ri.door_id=ci.door_id WHERE ci.restock_session_id=? AND ri.outcome='UNREVIEWED' LIMIT 1`, session.session_id);
    if (!unobserved) {
      const next = this.machine.store.maybeOne(`SELECT ri.door_id FROM restock_item ri LEFT JOIN command_intent ci ON ci.restock_session_id=ri.session_id AND ci.door_id=ri.door_id WHERE ri.session_id=? AND ri.outcome='UNREVIEWED' AND ci.command_id IS NULL ORDER BY ri.door_id LIMIT 1`, session.session_id);
      if (next) {
        const door = this.machine.store.one(`SELECT controller_channel,mapping_version FROM door WHERE door_id=?`, next.door_id);
        const commandId = deterministicId("restock", String(session.session_id), String(next.door_id), "1");
        this.machine.store.transaction(() => {
          this.machine.store.run(`INSERT INTO command_intent(command_id,restock_session_id,door_id,controller_channel,mapping_version,attempt,authority,state,created_at) VALUES(?,?,?,?,?,1,'RESTOCK','COMMAND_INTENT_RECORDED',?)`, commandId, session.session_id, next.door_id, door.controller_channel, door.mapping_version, iso(this.clock.now()));
          this.machine.events.append({ type: "RESTOCK_DOOR_COMMAND_COMMITTED", actor: actorUserId, payload: { restockSessionId: session.session_id, commandId, doorId: next.door_id } });
          this.machine.store.bumpStateVersion();
        });
      }
    }
    await this.machine.drainCommands();
  }

  private async ensureNextCertificationCommand(
    session: Record<string, unknown>,
    actorUserId: string,
    mapping: Array<{ doorId: VaultDoorId; controllerChannel: number }>,
  ): Promise<{ sessionId: string; scheduledDoorId: VaultDoorId; commandId: string }> {
    const unobserved = this.machine.store.maybeOne(`SELECT ci.* FROM command_intent ci LEFT JOIN certification_evidence ce ON ce.command_id=ci.command_id WHERE ci.certification_session_id=? AND ce.command_id IS NULL ORDER BY ci.created_at DESC LIMIT 1`, session.session_id);
    if (unobserved) {
      await this.machine.drainCommands();
      return { sessionId: String(session.session_id), scheduledDoorId: unobserved.door_id as VaultDoorId, commandId: String(unobserved.command_id) };
    }
    const counts = Object.fromEntries(this.machine.store.all(
      `SELECT door_id,COUNT(*) AS count FROM certification_evidence WHERE session_id=? AND outcome='PASS' AND door_id IS NOT NULL GROUP BY door_id`,
      session.session_id,
    ).map((row) => [String(row.door_id), Number(row.count)]));
    const scheduledDoorId = nextUnderTestedDoor(counts, mapping.map((entry) => entry.doorId)) as VaultDoorId;
    const selected = mapping.find((entry) => entry.doorId === scheduledDoorId)!;
    const sequence = Number(this.machine.store.one(`SELECT COUNT(*) AS count FROM command_intent WHERE certification_session_id=?`, session.session_id).count) + 1;
    const commandId = deterministicId("cert", String(session.session_id), scheduledDoorId, String(sequence));
    this.machine.store.transaction(() => {
      this.machine.store.run(`INSERT INTO command_intent(command_id,certification_session_id,door_id,controller_channel,mapping_version,attempt,authority,state,created_at) VALUES(?,?,?,?,?,1,'CERTIFICATION','COMMAND_INTENT_RECORDED',?)`, commandId, session.session_id, scheduledDoorId, selected.controllerChannel, String(session.config_version), iso(this.clock.now()));
      this.machine.events.append({ type: "CERTIFICATION_COMMAND_COMMITTED", mode: "CERTIFICATION", actor: actorUserId, payload: { certificationSessionId: session.session_id, commandId, scheduledDoorId, sequence } });
      this.machine.store.bumpStateVersion();
    });
    await this.machine.drainCommands();
    return { sessionId: String(session.session_id), scheduledDoorId, commandId };
  }
}
