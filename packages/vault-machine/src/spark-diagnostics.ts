import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";
import { VaultStore } from "./store";

/** Counts, ages and contract hashes only. This readout has no recovery authority
 * and never exports callback bodies, card fields, raw IDs or request bodies. */
export function sparkOperationalSummary(store: VaultStore, now = Date.now()) {
  const meta = store.one(`SELECT last_cloud_success_at,automation_halted,recovery_required FROM machine_meta WHERE singleton=1`);
  const table = (name: string) => Boolean(store.maybeOne(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, name));
  const count = (sql: string) => Number(store.one(sql).count);
  const cloudTime = Date.parse(String(meta.last_cloud_success_at ?? ""));
  const cloudAgeSeconds = Number.isFinite(cloudTime) && Number.isFinite(now) && cloudTime <= now ? Math.floor((now - cloudTime) / 1000) : null;
  const counts = {
    pendingOutbox: count(`SELECT COUNT(*) AS count FROM outbox WHERE acknowledged_at IS NULL`),
    unresolvedNotices: table("financial_notice_resolution") ? count(`SELECT COUNT(*) AS count FROM payment_evidence_notice n LEFT JOIN financial_notice_resolution r ON r.notice_id=n.notice_id WHERE r.notice_id IS NULL`) : count(`SELECT COUNT(*) AS count FROM payment_evidence_notice`),
    orphanNotices: count(`SELECT COUNT(*) AS count FROM payment_evidence_notice WHERE json_extract(payload_json,'$.saleId') IS NULL`),
    unknownVoids: count(`SELECT COUNT(*) AS count FROM payment_void WHERE state IN ('INTENT','UNKNOWN')`),
    externalReviews: table("payment_void_external_review") ? count(`SELECT COUNT(*) AS count FROM payment_void_external_review`) : 0,
    retiredUnstarted: table("payment_void_retirement") ? count(`SELECT COUNT(*) AS count FROM payment_void_retirement`) : 0,
  };
  const alerts: string[] = [];
  if (meta.automation_halted || meta.recovery_required) alerts.push("TECHNICAL_RECOVERY_REQUIRED");
  if (counts.unresolvedNotices) alerts.push("FINANCIAL_EVIDENCE_REVIEW_REQUIRED");
  if (counts.unknownVoids) alerts.push("VOID_OUTCOME_UNCONFIRMED");
  if (cloudAgeSeconds === null || cloudAgeSeconds > 90) alerts.push("CLOUD_SYNC_STALE");
  const pending = store.path !== ":memory:" && existsSync(join(dirname(store.path), "state-operation.pending.json"));
  if (pending) alerts.push("STATE_OPERATION_INCOMPLETE");
  let provider: { available: boolean; bindingDigest?: string; receiptCursor?: string; receiptCount?: number; unacknowledgedNotices?: number;
    transportAttemptCount?: number; unknownTransportCount?: number; lastTransportAgeSeconds?: number | null; blockedVoidCount?: number } = { available: false };
  const providers: Array<typeof provider & { stage: "SANDBOX" | "PRODUCTION" }> = [];
  const files = store.path === ":memory:" ? [] : readdirSync(dirname(store.path)).filter(name => name === `${basename(store.path)}.spark-provider.sqlite`
    || (name.startsWith(`${basename(store.path)}.spark-production-`) && /^[a-f0-9]{64}\.sqlite$/.test(name.slice(`${basename(store.path)}.spark-production-`.length)))).map(name => join(dirname(store.path),name));
  for (const file of files.slice(0,100)) {
    provider = { available: false };
    let db: Database.Database | undefined;
    try {
      if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error("invalid journal");
      db = new Database(file, { readonly: true, fileMustExist: true }); db.pragma("trusted_schema=OFF");
      const one = (sql: string) => db!.prepare(sql).get() as Record<string, unknown>;
      const binding = String(one(`SELECT binding_digest FROM spark_binding WHERE singleton=1`).binding_digest);
      const anchor = `${file}.anchor`;
      if (!/^[a-f0-9]{64}$/.test(binding) || !lstatSync(anchor).isFile() || lstatSync(anchor).isSymbolicLink() || lstatSync(anchor).size !== 64 || readFileSync(anchor, "utf8") !== binding) throw new Error("invalid anchor");
      const cursor = String(one(`SELECT cursor FROM spark_feed WHERE singleton=1`).cursor);
      if (!/^(0|[1-9][0-9]{0,18})$/.test(cursor) || BigInt(cursor) > 9223372036854775807n) throw new Error("invalid cursor");
      const last = one(`SELECT MAX(sent_at) AS last FROM spark_transport_attempt`).last;
      provider = { available: true, bindingDigest: binding, receiptCursor: cursor,
        receiptCount: Number(one(`SELECT COUNT(*) AS count FROM spark_receipt`).count),
        unacknowledgedNotices: Number(one(`SELECT COUNT(*) AS count FROM spark_notice WHERE acknowledged=0`).count),
        transportAttemptCount: Number(one(`SELECT COUNT(*) AS count FROM spark_transport_attempt`).count),
        unknownTransportCount: Number(one(`SELECT COUNT(*) AS count FROM spark_transport_attempt WHERE verdict='UNKNOWN'`).count),
        lastTransportAgeSeconds: typeof last === "number" && last <= now ? Math.floor((now - last) / 1000) : null,
        blockedVoidCount: Number(one(`SELECT COUNT(*) AS count FROM spark_void_recovery_block`).count) };
      if (provider.blockedVoidCount) alerts.push("PROVIDER_VOID_REPLAY_BLOCKED");
    } catch { alerts.push("PROVIDER_JOURNAL_UNAVAILABLE_OR_INVALID"); }
    finally { db?.close(); }
    providers.push({ ...provider, stage: file.endsWith(".spark-provider.sqlite") ? "SANDBOX" : "PRODUCTION" });
  }
  const historical = store.all(`SELECT DISTINCT binding_digest FROM sale_payment_binding WHERE provider='NAYAX_SPARK'`);
  if (store.path !== ":memory:" && historical.some(row => !providers.some(p => p.available && p.bindingDigest === row.binding_digest))) alerts.push("SPARK_PROVIDER_JOURNAL_MISSING");
  const latest = store.maybeOne(`SELECT b.binding_digest FROM sale_payment_binding b JOIN sale s ON s.sale_id=b.sale_id WHERE b.provider='NAYAX_SPARK' ORDER BY s.created_at DESC,s.sale_id DESC LIMIT 1`);
  provider = providers.find(p => p.bindingDigest === latest?.binding_digest) ?? (providers.length === 1 ? providers[0]! : { available: false });
  if (files.length > 100) alerts.push("SPARK_PROVIDER_JOURNAL_LIMIT");
  return { schemaVersion: 1, generatedAt: new Date(now).toISOString(), cloudAgeSeconds, counts, provider, providers,
    restorePending: pending, alerts, financialAdjustmentAuthority: false,
    exclusions: ["credentials", "card data", "callback bodies", "provider transaction/session IDs", "request bodies", "database files"] };
}
