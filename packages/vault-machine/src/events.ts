import { randomUUID } from "node:crypto";
import { redactVaultValue } from "../../vault-contracts/dist";
import type { VaultMode } from "../../vault-contracts/dist";
import { VaultStore } from "./store";
import { digest, iso, json } from "./util";
import type { Clock, OutboxEnvelope, OutboxBatchResult } from "./types";

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
    const eventId = randomUUID();
    const sequence = Number(this.store.one(`SELECT COALESCE(MAX(sequence),0)+1 AS next FROM machine_event`).next);
    const machineId = String(this.store.one(`SELECT machine_id FROM machine_meta WHERE singleton=1`).machine_id);
    const occurredAt = iso(this.clock.now());
    const payload = redactVaultValue(input.payload ?? {}) as Record<string, unknown>;
    const envelope = {
      eventId,
      schemaVersion: 1 as const,
      machineId,
      sequence,
      type: input.type,
      mode: input.mode ?? "PRODUCTION",
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      occurredAt,
      payload,
    };
    const payloadJson = json(payload);
    const payloadDigest = digest(envelope);
    this.store.run(
      `INSERT INTO machine_event(event_id,sequence,machine_id,type,mode,correlation_id,causation_id,actor,occurred_at,payload_json,payload_digest) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      eventId, sequence, machineId, input.type, envelope.mode, input.correlationId ?? null, input.causationId ?? null, input.actor ?? null, occurredAt, payloadJson, payloadDigest,
    );
    this.store.run(
      `INSERT INTO outbox(event_id,sequence,payload_digest,payload_json,next_attempt_at) VALUES(?,?,?,?,?)`,
      eventId, sequence, payloadDigest, json(envelope), occurredAt,
    );
    return { eventId, sequence };
  }
}

export interface CloudEventSink { send(events: OutboxEnvelope[]): Promise<OutboxBatchResult> }

export class OutboxSynchronizer {
  constructor(private readonly store: VaultStore, private readonly clock: Clock, private readonly sink: CloudEventSink) {}

  pending(limit = 250): OutboxEnvelope[] {
    return this.store.all(
      `SELECT event_id,sequence,payload_digest,payload_json,attempt_count FROM outbox WHERE acknowledged_at IS NULL AND next_attempt_at<=? ORDER BY sequence LIMIT ?`,
      iso(this.clock.now()), limit,
    ).map((row) => ({
      eventId: String(row.event_id), sequence: Number(row.sequence), digest: String(row.payload_digest),
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>, attemptCount: Number(row.attempt_count),
    }));
  }

  async flush(limit = 250): Promise<{ sent: number; acknowledged: number; rejected: number }> {
    const batch = this.pending(limit);
    if (!batch.length) return { sent: 0, acknowledged: 0, rejected: 0 };
    let result: OutboxBatchResult;
    try { result = await this.sink.send(batch); }
    catch (error) {
      this.store.transaction(() => {
        for (const envelope of batch) {
          const attempts = envelope.attemptCount + 1;
          const delay = Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8));
          this.store.run(`UPDATE outbox SET attempt_count=?,next_attempt_at=?,last_response=? WHERE event_id=?`, attempts, iso(new Date(this.clock.now().getTime() + delay)), String(error).slice(0, 500), envelope.eventId);
        }
      });
      return { sent: batch.length, acknowledged: 0, rejected: batch.length };
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
        const delay = Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8));
        this.store.run(`UPDATE outbox SET attempt_count=?,next_attempt_at=?,last_response=? WHERE event_id=?`, attempts, iso(new Date(this.clock.now().getTime() + delay)), (rejected.get(envelope.eventId) ?? "UNACKNOWLEDGED").slice(0, 500), envelope.eventId);
      }
      if (acknowledged.size) this.store.run(`UPDATE machine_meta SET last_cloud_success_at=?,last_trusted_wall_at=?,last_trusted_monotonic_ms=? WHERE singleton=1`, iso(this.clock.now()), iso(this.clock.now()), this.clock.monotonicMs());
    });
    return { sent: batch.length, acknowledged: acknowledged.size, rejected: batch.length - acknowledged.size };
  }

  pressure(): { count: number; bytes: number; alert: boolean } {
    const row = this.store.one(`SELECT COUNT(*) AS count,COALESCE(SUM(length(payload_json)),0) AS bytes FROM outbox WHERE acknowledged_at IS NULL`);
    const count = Number(row.count); const bytes = Number(row.bytes);
    return { count, bytes, alert: count >= 100_000 || bytes >= 512 * 1024 * 1024 };
  }
}
