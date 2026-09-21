/** Profiling only. Reads instrumented frozen source in an owned disposable clone. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Session } from 'node:inspector';
import { PerformanceObserver, performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { recordStaffInventoryV2 } from '../../../packages/database/src/cardPlatformV2';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const uuid = (value: string) => { const hash = sha(value); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`; };
const mono = () => process.hrtime.bigint().toString();
async function main() {
  const config = JSON.parse(process.argv[2]), protocol = config.protocol;
  assert.equal(protocol.profile_saves_per_arm, 6); assert.equal(protocol.maximum_profile_saves_total, 12);
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(process.env.TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION, '1'); assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/tk_intake_profile_[AB]$/); assert.equal(url.pathname.slice(1), process.env.TK_BENCHMARK_OWNED_DATABASE);
  url.searchParams.set('application_name', 'tk_intake_source_profile'); url.searchParams.set('connection_limit', '4');
  globalThis.fetch = (async () => { throw Error('External fetch forbidden in source profile'); }) as typeof fetch;
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const context = new AsyncLocalStorage<{ save_id: string }>();
  const spans: any[] = [], ticks: any[] = [], gc: any[] = [], samples: any[] = [], counters: Record<string, number> = {};
  const pending = new Set<number>(); let sequence = 0, hooksEnabled = false;
  const hooks = {
    begin(name: string, metadata: any = {}) { if (!hooksEnabled) return null; const token = { id: ++sequence, name, save_id: context.getStore()?.save_id ?? null, metadata, started_ns: mono(), started_perf_ms: performance.now() }; pending.add(token.id); return token; },
    end(token: any) { if (!token) return; assert.ok(pending.delete(token.id), 'Each source span closes once'); spans.push({ ...token, finished_ns: mono(), finished_perf_ms: performance.now() }); },
    count(name: string) { if (hooksEnabled) counters[name] = (counters[name] ?? 0) + 1; },
  };
  const globalProfile = globalThis as typeof globalThis & { __TK_INTAKE_SOURCE_PROFILE__?: typeof hooks };
  globalProfile.__TK_INTAKE_SOURCE_PROFILE__ = hooks;
  const sqlProxy = (tx: any) => new Proxy(tx, { get(target, key) {
    const original = Reflect.get(target, key);
    if (!['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'].includes(String(key))) return typeof original === 'function' ? original.bind(target) : original;
    return async (...args: any[]) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql ?? args[0]?.strings?.join('') ?? '';
      const token = hooks.begin('sql', { operation: String(key), query_class: sql.includes('pg_advisory_xact_lock') ? 'advisory_lock' : sql.includes('InventoryWorkflowEventV2') ? 'journal' : sql.includes('StaffInventoryResearch') ? 'research' : 'other' });
      try { return await original.apply(target, args); } finally { hooks.end(token); }
    };
  } });
  const actor = 'disposable-benchmark-admin', locationId = uuid('benchmark-location');
  const photoBytes = await Promise.all(['white', 'blue'].map(background => sharp({ create: { width: 1200, height: 1680, channels: 3, background } }).jpeg({ quality: 90 }).toBuffer()));
  const photoKey = (bytes: Buffer) => `inventory-photos/11111111-1111-4111-8111-111111111111/${sha(bytes)}.jpg`;
  const description = { name: 'Fixture Runner', category: 'Sports cards', notes: 'Disposable benchmark only', photo_key: photoKey(photoBytes[0]), back_photo_key: photoKey(photoBytes[1]), card_details: { manufacturer: 'Fixture Cards', card_number: '007', year: '2024', set_name: 'Fixture Chrome', variant: null, card_type: 'Baseball' }, planned_sales_channel: 'eBay' };
  const command = (id: string) => ({ action: 'add', request_id: uuid(id), effective_at: '2026-07-01T00:00:00.000Z', note: 'Disposable benchmark', origin: 'purchase', quantity: 1, total_cost_cents: 123, cost_method: 'documented_unit', expected_price_cents: null, destination: { location_id: locationId, kind: 'hq', machine_id: null, product_id: null, door_id: null }, stage: 'unprocessed', description });
  const count = async () => (await db.$queryRawUnsafe<any[]>('SELECT (SELECT count(*)::int FROM "InventoryWorkflowEventV2") AS events, (SELECT count(*)::int FROM "StaffInventoryResearchJobV2") AS jobs'))[0];
  const inspector = new Session(); let connected = false, profiling = false, tick: ReturnType<typeof setInterval> | undefined;
  const post = (method: string, params: any = {}) => new Promise<any>((resolve, reject) => inspector.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
  const observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) gc.push({ start_perf_ms: entry.startTime, duration_ms: entry.duration, detail: (entry as any).detail ?? null }); });
  const loop = monitorEventLoopDelay({ resolution: protocol.event_loop_tick_ms });
  let capture: any, cpuProfile: any, failure: unknown;
  try {
    const initial = await count(); assert.deepEqual(initial, { events: 1092, jobs: 272 });
    const initialRows = await db.$queryRawUnsafe<any[]>('SELECT "id", "contentHash" FROM "InventoryWorkflowEventV2" ORDER BY sequence');
    inspector.connect(); connected = true; await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: protocol.cpu_sampling_interval_us });
    observer.observe({ entryTypes: ['gc'] }); loop.enable();
    let previous = process.hrtime.bigint(); tick = setInterval(() => { const at = process.hrtime.bigint(); ticks.push({ previous_ns: previous.toString(), at_ns: at.toString(), gap_ms: Number(at - previous) / 1e6 }); previous = at; }, protocol.event_loop_tick_ms);
    await post('Profiler.start'); profiling = true; hooksEnabled = true;
    capture = { started_ns: mono(), started_perf_ms: performance.now(), cpu_before: process.cpuUsage(), process_pid: process.pid };
    let stopSaves = false;
    const outcomes = await Promise.allSettled(Array.from({ length: protocol.sessions }, (_, session) => (async () => {
      for (let index = 0; index < protocol.saves_per_session; index++) {
        if (stopSaves) break;
        const save_id = `${config.arm}:${session}:${index}`, input = command(`profile-${session}-${index}`);
        try {
          await context.run({ save_id }, async () => {
            if (stopSaves) return;
            const started_ns = mono(), start = performance.now();
            const result = await db.$transaction(tx => recordStaffInventoryV2(sqlProxy(tx), input, actor), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 });
            assert.equal(result.outcome, 'RECORDED'); samples.push({ save_id, session, index, started_ns, finished_ns: mono(), elapsed_ms: performance.now() - start, outcome: result.outcome, unit_id: `staff:${input.request_id}:card:0001` });
          });
        } catch (error) { stopSaves = true; throw error; }
      }
    })()));
    capture.finished_ns = mono(); capture.finished_perf_ms = performance.now(); capture.cpu_used = process.cpuUsage(capture.cpu_before); delete capture.cpu_before;
    hooksEnabled = false; const stopped = await post('Profiler.stop'); profiling = false; cpuProfile = stopped.profile; clearInterval(tick); loop.disable(); await nextTurn(); observer.disconnect();
    const rejected = outcomes.find(x => x.status === 'rejected'); if (rejected?.status === 'rejected') throw rejected.reason;
    assert.equal(samples.length, protocol.profile_saves_per_arm); assert.equal(pending.size, 0);
    const calls = Object.fromEntries(['recordStaffInventoryV2', 'recordInventoryWorkflowEventV2', 'readWorkflowHistoryV2', 'verify_and_parse_history_page', 'replayWorkflowEventsV2'].map(name => [name, spans.filter(s => s.name === name).length]));
    assert.equal(calls.recordStaffInventoryV2, 6); assert.equal(calls.recordInventoryWorkflowEventV2, 24); assert.equal(calls.readWorkflowHistoryV2, 30); assert.ok(calls.verify_and_parse_history_page >= 30); assert.ok(calls.replayWorkflowEventsV2 >= 30); assert.ok(counters.verifyWorkflowRowV2 > 0);
    const final = await count(); assert.equal(final.jobs, initial.jobs + 6); assert.equal(final.events, initial.events + 24);
    const preserved = await db.$queryRawUnsafe<any[]>('SELECT "id", "contentHash" FROM "InventoryWorkflowEventV2" ORDER BY sequence LIMIT $1', initialRows.length); assert.deepEqual(preserved, initialRows);
    const jobs = await db.$queryRawUnsafe<any[]>('SELECT "unitId", count(*)::int AS n FROM "StaffInventoryResearchJobV2" GROUP BY "unitId"'); const cardinality = new Map(jobs.map(x => [x.unitId, x.n])); assert.ok(samples.every(x => cardinality.get(x.unit_id) === 1));
    capture = { ...capture, initial, final, calls, verification_calls: counters.verifyWorkflowRowV2, invariants: { six_actual_saves: true, four_events_and_one_job_per_save: true, previous_history_preserved: true }, event_loop_ms: { p95: loop.percentile(95) / 1e6, max: loop.max / 1e6 } };
  } catch (error) { failure = error; }
  finally {
    hooksEnabled = false; clearInterval(tick); loop.disable();
    if (profiling) { try { cpuProfile = (await post('Profiler.stop')).profile; } catch {} }
    await nextTurn(); observer.disconnect(); if (connected) inspector.disconnect();
    delete globalProfile.__TK_INTAKE_SOURCE_PROFILE__; await db.$disconnect();
    const result = { arm: config.arm, complete: !failure, release_pass: false, capture, samples, spans, ticks, gc: gc.filter(x => !capture || x.start_perf_ms >= capture.started_perf_ms && x.start_perf_ms <= (capture.finished_perf_ms ?? Infinity)), counters, open_spans: [...pending], error: failure ? String(failure instanceof Error ? failure.message : failure).replace(/postgresql:\/\/[^\s"']+/g, '[owned-db-url]') : null };
    await writeFile(config.output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    if (cpuProfile) await writeFile(`${config.output}.cpuprofile`, JSON.stringify(cpuProfile), { mode: 0o600, flag: 'wx' });
  }
  if (failure) throw failure;
  console.log(JSON.stringify({ arm: config.arm, profiled_saves: samples.length, complete: true, release_pass: false }));
}
main().catch(error => { console.error(String(error instanceof Error ? error.message : error).replace(/postgresql:\/\/[^\s"']+/g, '[owned-db-url]')); process.exitCode = 1; });
