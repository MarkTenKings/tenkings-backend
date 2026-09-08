import { randomInt, randomUUID } from "node:crypto";
import { assertVaultEventPayloadBounds, redactVaultValue, VaultMachineEventSchema } from "../../vault-contracts/dist";
import type { VaultMode } from "../../vault-contracts/dist";
import { VaultStore } from "./store";
import { digest, iso, json } from "./util";
import { VaultError, type Clock, type OutboxEnvelope, type OutboxBatchResult } from "./types";

const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const BATCH_OVERHEAD_BYTES = Buffer.byteLength(JSON.stringify({ contractVersion: 1, events: [] }));

export interface EventInput {
  type: string;
  mode?: VaultMode;
  correlationId?: string;
  causationId?: string;
  actor?: string;
  payload?: Record<string, unknown>;
}

export class EventRepository {
  constructor(private readonly store: VaultStore, private readonly clock: Clock) {}

  append(input: EventInput): { eventId: string; sequence: number } {
    if (!this.store.db.inTransaction) return this.store.transaction(() => this.append(input));
    const eventId = randomUUID();
    const sequence = Number(this.store.one(`SELECT COALESCE(MAX(sequence),0)+1 AS next FROM machine_event`).next);
    const machineId = String(this.store.one(`SELECT machine_id FROM machine_meta WHERE singleton=1`).machine_id);
    const occurredAt = iso(this.clock.now());
    const payload = redactVaultValue(input.payload ?? {}) as Record<string, unknown>;
    try { assertVaultEventPayloadBounds(payload); }
    catch { throw new VaultError("EVENT_PAYLOAD_INVALID", "Event exceeds the cloud JSON bounds", 503); }
    const envelope = {
      eventId,
      schemaVersion: 1 as const,
      machineId,
      sequence,
      type: input.type,
      mode: input.mode ?? "CERTIFICATION",
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      ...(input.actor ? { actor: input.actor } : {}),
      occurredAt,
      payload,
    };
    VaultMachineEventSchema.parse(envelope);
    const envelopeJson = json(envelope);
    if (Buffer.byteLength(envelopeJson) + BATCH_OVERHEAD_BYTES > MAX_BATCH_BYTES) throw new VaultError("EVENT_TOO_LARGE", "Event exceeds the bounded cloud transport contract", 503);
    const payloadJson = json(payload);
    const payloadDigest = digest(envelope);
    this.store.run(
      `INSERT INTO machine_event(event_id,sequence,machine_id,type,mode,correlation_id,causation_id,actor,occurred_at,payload_json,payload_digest) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      eventId, sequence, machineId, input.type, envelope.mode, input.correlationId ?? null, input.causationId ?? null, input.actor ?? null, occurredAt, payloadJson, payloadDigest,
    );
    this.store.run(
      `INSERT INTO outbox(event_id,sequence,payload_digest,payload_json,next_attempt_at) VALUES(?,?,?,?,?)`,
      eventId, sequence, payloadDigest, envelopeJson, occurredAt,
    );
    return { eventId, sequence };
  }
}

export interface CloudEventSink { send(events: OutboxEnvelope[]): Promise<OutboxBatchResult> }

export class OutboxSynchronizer {
  private running: Promise<{ sent: number; acknowledged: number; rejected: number; failureCode?: string }> | null = null;
  constructor(private readonly store: VaultStore, private readonly clock: Clock, private readonly sink: CloudEventSink) {}

  pending(limit = 250): OutboxEnvelope[] {
    const rows = this.store.all(
      `SELECT event_id,sequence,payload_digest,payload_json,attempt_count,next_attempt_at FROM outbox WHERE acknowledged_at IS NULL ORDER BY sequence LIMIT ?`,
      Math.max(1, Math.min(250, Math.floor(limit))),
    );
    // A newer event must never overtake an older backed-off/quarantined event.
    const now = iso(this.clock.now());
    let bytes = BATCH_OVERHEAD_BYTES;
    const selected: typeof rows = [];
    for (const row of rows) {
      if (String(row.next_attempt_at) > now) break;
      const additional = Buffer.byteLength(String(row.payload_json)) + (selected.length ? 1 : 0);
      // Keep the exact contiguous prefix below the same UTF-8 byte limit as Next.
      if (bytes + additional > MAX_BATCH_BYTES) {
        if (!selected.length) throw new VaultError("EVENT_TOO_LARGE", "Stored event exceeds the cloud transport contract; support recovery is required", 503);
        break;
      }
      bytes += additional; selected.push(row);
    }
    return selected.map((row) => ({
      eventId: String(row.event_id), sequence: Number(row.sequence), digest: String(row.payload_digest),
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>, attemptCount: Number(row.attempt_count),
    }));
  }

  flush(limit = 250): Promise<{ sent: number; acknowledged: number; rejected: number; failureCode?: string }> {
    if (this.running) return this.running;
    this.running = this.flushOnce(limit).finally(() => { this.running = null; });
    return this.running;
  }

  private async flushOnce(limit: number): Promise<{ sent: number; acknowledged: number; rejected: number; failureCode?: string }> {
    const batch = this.pending(limit);
    if (!batch.length) return { sent: 0, acknowledged: 0, rejected: 0 };
    let result: OutboxBatchResult;
    try {
      result = await this.sink.send(batch);
      if (!Array.isArray(result?.acknowledgedEventIds) || result.acknowledgedEventIds.some((id) => typeof id !== "string") || !Array.isArray(result?.rejected) || result.rejected.some((item) => typeof item?.eventId !== "string" || typeof item?.code !== "string")) throw new Error("INVALID_RESPONSE");
      const sent = new Set(batch.map((event) => event.eventId));
      if (result.acknowledgedEventIds.some((id) => !sent.has(id)) || result.rejected.some((item) => !sent.has(item.eventId)) || new Set(result.acknowledgedEventIds).size !== result.acknowledgedEventIds.length || new Set(result.rejected.map((item) => item.eventId)).size !== result.rejected.length || result.rejected.some((item) => result.acknowledgedEventIds.includes(item.eventId))) throw new Error("INVALID_RESPONSE");
    }
    catch (error) {
      this.store.transaction(() => {
        for (const envelope of batch) {
          const attempts = envelope.attemptCount + 1;
          const delay = this.backoff(attempts);
          this.store.run(`UPDATE outbox SET attempt_count=?,next_attempt_at=?,last_response=? WHERE event_id=?`, attempts, iso(new Date(this.clock.now().getTime() + delay)), "CLOUD_DELIVERY_FAILED", envelope.eventId);
        }
      });
      return { sent: batch.length, acknowledged: 0, rejected: batch.length, failureCode: "CLOUD_DELIVERY_FAILED" };
    }
    const sentIds = new Set(batch.map((event) => event.eventId));
    const claimedAcknowledged = new Set(result.acknowledgedEventIds.filter((id) => sentIds.has(id)));
    // Ordered delivery may acknowledge only a contiguous prefix. A claimed ACK after a gap is retried.
    const acknowledged = new Set<string>();
    for (const envelope of batch) {
      if (!claimedAcknowledged.has(envelope.eventId)) break;
      acknowledged.add(envelope.eventId);
    }
    const rejected = new Map(result.rejected.filter((item) => sentIds.has(item.eventId)).map((item) => [item.eventId, item.code]));
    this.store.transaction(() => {
      for (const envelope of batch) {
        if (acknowledged.has(envelope.eventId)) {
          this.store.run(`UPDATE outbox SET acknowledged_at=?,last_response='ACK' WHERE event_id=?`, iso(this.clock.now()), envelope.eventId);
          continue;
        }
        const attempts = envelope.attemptCount + 1;
        const delay = this.backoff(attempts);
        const code = rejected.get(envelope.eventId) ?? "UNACKNOWLEDGED";
        this.store.run(`UPDATE outbox SET attempt_count=?,next_attempt_at=?,last_response=? WHERE event_id=?`, attempts, iso(new Date(this.clock.now().getTime() + delay)), /^[A-Z0-9_]{1,120}$/.test(code) ? code : "EVENT_REJECTED", envelope.eventId);
      }
    });
    return { sent: batch.length, acknowledged: acknowledged.size, rejected: batch.length - acknowledged.size };
  }

  private backoff(attempts: number): number {
    return Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8) + randomInt(0, 501));
  }

  pressure(): { count: number; bytes: number; alert: boolean } {
    const row = this.store.one(`SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(payload_json AS BLOB))),0) AS bytes FROM outbox WHERE acknowledged_at IS NULL`);
    const count = Number(row.count); const bytes = Number(row.bytes);
    return { count, bytes, alert: count >= 100_000 || bytes >= 512 * 1024 * 1024 };
  }
}
