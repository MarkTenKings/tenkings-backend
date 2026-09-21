/** Isolated test role. Only this role's assigned DB pool is instantiated. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { recordStaffInventoryV2 } from '../../../packages/database/src/cardPlatformV2';
import { acquireStaffInventoryIntakeLeaseV2, releaseStaffInventoryIntakeLeaseV2, claimStaffInventoryResearchV2, completeStaffInventoryResearchV2, failStaffInventoryResearchV2 } from '../../../packages/database/src/staffInventoryResearchV2';
import { researchStaffInventoryCard } from '../lib/server/staffInventoryResearch';
import { runStaffInventoryResearchWorker } from '../lib/server/staffInventoryResearchWorker';
import { createStaffInventoryWorkspaceHandler } from '../pages/api/v2/admin/inventory/workspace';
import { peer, mono, deferred, tracing, safeError } from './benchmark-staff-intake-split-ipc';
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const uuid = (value: string) => { const hash = sha(value); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`; };
async function main() {
  const config = JSON.parse(process.argv[2]), { protocol, role } = config;
  assert.ok(['intake', 'worker', 'observer'].includes(role));
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(process.env.TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION, '1');
  assert.equal(url.hostname, '127.0.0.1'); assert.match(url.pathname, /^\/tk_intake_(template|\d+)$/);
  assert.equal(url.pathname.slice(1), process.env.TK_BENCHMARK_OWNED_DATABASE);
  globalThis.fetch = (async () => { throw Error('External fetch forbidden in split benchmark'); }) as typeof fetch;
  const pool = role === 'intake' ? 4 : role === 'worker' ? 3 : 1;
  url.searchParams.set('application_name', `tk_bench_${role}`); url.searchParams.set('connection_limit', String(pool));
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const boot = deferred(), handlers: Record<string, (args: any) => Promise<any>> = {};
  const rpc = peer(message => { if (!process.connected) throw Error('Driver disconnected'); process.send?.(message); }, handler => process.on('message', handler), async (method, args) => { await boot.promise; assert.ok(handlers[method], `Unknown ${role} method ${method}`); return handlers[method](args); });
  const forward = (target: string, method: string, args: any = {}) => rpc.call('forward', { role: target, method, args });
  const observerQuery = (sql: string, ...values: any[]) => forward('observer', 'query', { sql, values });
  const trace = tracing(role), operations = trace.operations;
  let sequence = 0, initial: any, initialRows: any[] = [], measuring = false;
  let barrierTaken = false, barrierObserved = false, releaseRequested = false;
  const terminalReady = [deferred(), deferred()], releaseTerminals = deferred(), acquiredBarrier = deferred();
  const stop = new AbortController(), workers: Promise<void>[] = [], workerErrors: string[] = [];
  const providerCounts = { sold: 0, image: 0, model: 0, unexpected: 0 };
  const claims = { accepted: 0, denied: 0, denied_at_three_leases: 0, max_running: 0, completed: 0, failed: 0, failures_by_code: {} as Record<string, number> };
  const instrument = (tx: any, sample: any, workerBarrier = false, span: any = null) => new Proxy(tx, { get(target, key) {
    const original = Reflect.get(target, key);
    if (!['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'].includes(String(key))) return typeof original === 'function' ? original.bind(target) : original;
    return async (...args: any[]) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql ?? args[0]?.strings?.join('') ?? '';
      const queue = sql.includes('pg_advisory_xact_lock(20260911, 4202)'), began = performance.now(), started_ns = mono();
      let result;
      try { result = await original.apply(target, args); }
      finally { if (span) operations.push({ kind: 'sql_span', role, trace_id: span.trace_id, operation: span.operation, pid: span.pid, queue_lock: queue, started_ns, finished_ns: mono() }); }
      if (queue && sample) sample.queue_lock_ms += performance.now() - began;
      if (queue && workerBarrier && !barrierTaken) {
        const barrier_started_ns = mono(); barrierTaken = true; acquiredBarrier.resolve();
        const until = performance.now() + 2500;
        while (performance.now() < until) {
          const rows = await observerQuery(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'tk_bench_intake' AND wait_event = 'advisory' AND query LIKE '%4202%'`);
          if (rows[0].n > 0) { barrierObserved = true; break; } await delay(2);
        }
        operations.push({ kind: 'controlled_save_terminal_overlap', role, observed: barrierObserved, started_ns: barrier_started_ns, finished_ns: mono() });
      }
      return result;
    };
  } });
  const tracked = async <T,>(operation: string, work: (tx: any) => Promise<T>, options: any = {}, context: any = {}) => {
    const span: any = { kind: 'transaction_span', role, process_pid: process.pid, trace_id: `${role}:${++sequence}`, operation, requested_ns: mono(), ...context };
    try { return await db.$transaction(async tx => {
      span.callback_ns = mono(); span.pid_query_started_ns = mono(); span.pid = (await tx.$queryRawUnsafe<{ pid: number }[]>('SELECT pg_backend_pid() AS pid'))[0].pid;
      span.pid_query_finished_ns = mono(); span.body_started_ns = mono();
      try { return await work(instrument(tx, null, false, span)); } finally { span.body_finished_ns = mono(); }
    }, options); } finally { span.finished_ns = mono(); operations.push(span); }
  };
  const actor = 'disposable-benchmark-admin';
  const locationId = uuid('benchmark-location');
  const photoBytes = await Promise.all(['white', 'blue'].map(background => sharp({ create: { width: 1200, height: 1680, channels: 3, background } }).jpeg({ quality: 90 }).toBuffer()));
  const photoKey = (bytes: Buffer) => `inventory-photos/11111111-1111-4111-8111-111111111111/${sha(bytes)}.jpg`;
  const photos = new Map(photoBytes.map(bytes => [photoKey(bytes), bytes]));
  const description = { name: 'Fixture Runner', category: 'Sports cards', notes: 'Disposable benchmark only', photo_key: photoKey(photoBytes[0]), back_photo_key: photoKey(photoBytes[1]),
    card_details: { manufacturer: 'Fixture Cards', card_number: '007', year: '2024', set_name: 'Fixture Chrome', variant: null, card_type: 'Baseball' }, planned_sales_channel: 'eBay' };
  const add = (id: string, quantity = 1) => ({ action: 'add', request_id: uuid(id), effective_at: '2026-07-01T00:00:00.000Z', note: 'Disposable benchmark', origin: 'purchase', quantity,
    total_cost_cents: quantity * 123, cost_method: quantity === 1 ? 'documented_unit' : 'equal_card', expected_price_cents: null,
    destination: { location_id: locationId, kind: 'hq', machine_id: null, product_id: null, door_id: null }, stage: 'unprocessed', description });
  const save = (command: unknown) => db.$transaction(tx => recordStaffInventoryV2(tx, command, actor), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 });
  const count = async (client = db) => (await client.$queryRawUnsafe<any[]>('SELECT (SELECT count(*)::int FROM "InventoryWorkflowEventV2") AS events, (SELECT count(*)::int FROM "StaffInventoryResearchJobV2") AS jobs'))[0];
  const stockHash = async () => sha(JSON.stringify(await db.$queryRawUnsafe('SELECT "id", "contentHash" FROM "InventoryWorkflowEventV2" ORDER BY sequence')));

  // Provider fixture/transport below is copied byte-for-byte from the frozen child.
    // Six actual JPEG decodes per ordinary research pass; supplied provider URLs only.
    const listingBytes = await Promise.all(Array.from({ length: 6 }, (_, i) => sharp({ create: { width: 1000, height: 1400, channels: 3, background: { r: 25 + i * 30, g: 160, b: 100 } } }).jpeg({ quality: 92 }).toBuffer()));
    const items = listingBytes.map((_, i) => ({ itemId: `11111111111${i}`, url: `https://www.ebay.com/itm/11111111111${i}`, title: '2024 Fixture Cards Fixture Chrome Fixture Runner #007 Base Raw', soldPrice: '10.01', soldCurrency: 'USD', bestOfferAccepted: false,
      listingType: 'sold', endedAt: '2026-09-09', condition: 'Ungraded', thumbnailUrl: `https://i.ebayimg.com/images/g/fixture${i}/s-l400.jpg` }));
    const analysis = { identity: { status: 'unresolved', variant_name: null, suggestion: null, reason: 'No independently reviewed catalog identity.', reference_ids: [], photo_features: [] },
      target_condition: { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'Synthetic front and back depict an ungraded card.' }, refinement: null, selected_candidate_ids: [],
      comparisons: items.map(item => ({ candidate_id: `ebay:${item.itemId}`, classification: 'possible', identity_match: false, variant_match: false, visual_match: false, condition_match: true, reason: 'No reviewed variant evidence.' })) };
    const transport = (async (input: any, init?: RequestInit) => {
      const requested = String(input), signal = init?.signal ?? undefined;
      if (requested.startsWith('https://api.sold-comps.com/v1/scrape?')) {
        providerCounts.sold++;
        if (config.scenario === 'timeout') { await delay(200_000, undefined, { signal: signal ?? undefined }); throw Error('Expected actual source deadline to abort'); }
        await delay(protocol.provider_delay_ms, undefined, { signal: signal ?? undefined });
        if (config.scenario === 'rate-limit') return Response.json({ error: 'fixture rate limit' }, { status: 429, headers: { 'retry-after': '30' } });
        return Response.json({ keyword: new URL(requested).searchParams.get('keyword'), page: 1, totalItems: items.length, hasNextPage: false, items });
      }
      if (requested === 'https://api.openai.com/v1/responses') {
        providerCounts.model++; await delay(protocol.provider_delay_ms, undefined, { signal: signal ?? undefined });
        return Response.json({ model: 'gpt-6-astra', status: 'completed', error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }] });
      }
      const index = items.findIndex(item => item.thumbnailUrl === requested);
      if (index >= 0) { providerCounts.image++; await delay(protocol.provider_delay_ms, undefined, { signal: signal ?? undefined }); return new Response(new Uint8Array(listingBytes[index]), { headers: { 'content-type': 'image/jpeg' } }); }
      providerCounts.unexpected++; throw Error('Unexpected benchmark transport destination');
    }) as typeof fetch;

  const requireRole = (expected: string) => assert.equal(role, expected);
  let observerStopping = false, polling: Promise<void> | undefined, observerQueue: Promise<any> = Promise.resolve();
  const observations: any[] = [];
  const observerExecute = (sql: string, values: any[] = []) => { requireRole('observer'); const task = observerQueue.then(() => db.$queryRawUnsafe(sql, ...values)); observerQueue = task.catch(() => {}); return task; };
  let finishReceipt: any, traceActive = false, closing: Promise<boolean> | undefined;
  handlers.ready = async () => ({ role, pid: process.pid, pool, source_ref: protocol.refs[config.arm ?? 'A'] });
  handlers.clock = async () => ({ at_ns: mono(), pid: process.pid });
  handlers.query = async ({ sql, values }) => observerExecute(sql, values);
  handlers['trace-start'] = async () => {
    trace.start(); traceActive = true;
    if (role === 'observer') polling = (async () => { while (!observerStopping) {
      const started_ns = mono();
      const rows = await observerExecute(`SELECT a.pid, a.application_name, a.state, a.wait_event_type, a.wait_event, a.query_start, a.xact_start,
        CASE WHEN a.query LIKE '%4202%' THEN 'queue_lock' WHEN a.query LIKE '%InventoryWorkflowEventV2%' THEN 'journal' ELSE 'other' END AS query_kind,
        EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.locktype='advisory' AND l.classid=20260911 AND l.objid=4202 AND l.granted) AS owns_queue_lock
        FROM pg_stat_activity a WHERE a.datname=current_database() AND a.application_name IN ('tk_bench_intake','tk_bench_worker') AND a.state<>'idle' ORDER BY a.pid`);
      observations.push({ started_ns, finished_ns: mono(), rows }); await delay(10);
    } })();
    return true;
  };
  handlers.seed = async () => { requireRole('intake');
    await db.location.create({ data: { id: locationId, name: 'DISPOSABLE BENCHMARK HQ', slug: 'disposable-benchmark-hq', address: 'test only', recentRips: [], locationType: 'hq' } });
    await save(add('seed-bulk', protocol.seed_units - protocol.seed_pending - protocol.seed_completed));
    for (let i = 0; i < protocol.seed_pending + protocol.seed_completed; i++) await save(add(`seed-individual-${i}`)); return true;
  };
  const admissionClaim = () => db.$transaction(tx => claimStaffInventoryResearchV2(tx, { maxConcurrent: 2 }));
  const finishAdmission = (claim: any) => db.$transaction(tx => failStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, errorCode: 'BENCHMARK_PREFLIGHT', errorMessage: 'Synthetic untimed admission proof', retryable: false }));
  handlers['seed-terminal'] = async () => { requireRole('worker'); for (let i = 0; i < protocol.seed_completed; i++) { const claim = await admissionClaim(); assert.ok(claim); await db.$transaction(tx => failStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'Synthetic seed history', retryable: false })); } return true; };
  handlers['seed-proof'] = async () => { requireRole('intake'); const counts = await count(); assert.equal(counts.jobs, protocol.seed_pending + protocol.seed_completed); return { mode: 'seed', counts, stock_hash: await stockHash(), units: protocol.seed_units, pending: protocol.seed_pending, terminal: protocol.seed_completed, photo_hashes: photoBytes.map(sha) }; };
  handlers.preflight = async () => { requireRole('intake'); initial = await count(); initialRows = await db.$queryRawUnsafe<any[]>('SELECT "id", "contentHash" FROM "InventoryWorkflowEventV2" ORDER BY sequence');
    await assert.rejects(db.$transaction(async tx => { await recordStaffInventoryV2(tx, add('rollback-proof'), actor); throw Error('injected rollback'); }, { timeout: 30000 }), /injected rollback/); assert.deepEqual(await count(), initial);
    const retry = add('retry-proof'), results = await Promise.all([save(retry), save(retry)]); assert.deepEqual(results.map(x => x.outcome).sort(), ['RECORDED', 'REPLAY']);
    const after = await count(); assert.equal(after.jobs, initial.jobs + 1); assert.equal((await save(retry)).outcome, 'REPLAY'); assert.deepEqual(await count(), after); return true;
  };
  handlers['admission-claim'] = async () => { requireRole('worker'); return admissionClaim(); };
  handlers['admission-finish'] = async claim => { requireRole('worker'); return finishAdmission(claim); };
  handlers['admission-lease'] = async () => { requireRole('intake'); return db.$transaction(tx => acquireStaffInventoryIntakeLeaseV2(tx)); };
  handlers['admission-release'] = async ({ leaseId }) => { requireRole('intake'); return db.$transaction(tx => releaseStaffInventoryIntakeLeaseV2(tx, leaseId)); };
  handlers.lease = async context => { requireRole('intake'); const start = performance.now(); const lease = await tracked('lease', tx => acquireStaffInventoryIntakeLeaseV2(tx), { maxWait: 1000, timeout: 1500 }, context); return { ...lease, lease_ms: performance.now() - start }; };
  handlers.release = async ({ leaseId, ...context }) => { requireRole('intake'); await tracked('release_lease', tx => releaseStaffInventoryIntakeLeaseV2(tx, leaseId), { maxWait: 1000, timeout: 1500 }, context); return true; };
  handlers.save = async context => { requireRole('intake'); const { session, index, warmup } = context;
    const sample: any = { queue_lock_ms: 0, photo_verify_ms: 0, photo_wall_ms: 0, save_tx_ms: 0, save_ack_ms: 0 };
    const photoSpans: { started_ns: string; finished_ns: string }[] = [];
    const command = add(`measure-${session}-${warmup}-${index}`);
    const handler = createStaffInventoryWorkspaceHandler({
      requireAdmin: async () => ({ user: { id: actor } }) as any,
      readWorkspace: async () => { throw Error('GET outside scope'); }, signPhoto: async () => { throw Error('Signing outside scope'); },
      verifyPhoto: async key => { const start = performance.now(), started_ns = mono(), bytes = photos.get(key); assert.ok(bytes); assert.equal(key, photoKey(bytes)); const meta = await sharp(bytes).metadata(); assert.equal(meta.format, 'jpeg'); const finished_ns = mono(); sample.photo_verify_ms += performance.now() - start; photoSpans.push({ started_ns, finished_ns }); operations.push({ kind: 'photo_span', role, ...context, side: key === description.photo_key ? 'front' : 'back', started_ns, finished_ns }); return true; },
      record: async (body, admin) => {
        if (!warmup && config.scenario !== 'idle' && !releaseRequested) { releaseRequested = true; await forward('worker', 'release-terminals'); }
        const start = performance.now(); try { return await tracked('save', tx => recordStaffInventoryV2(instrument(tx, sample), body, admin), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 }, context); } finally { sample.save_tx_ms = performance.now() - start; }
      },
    });
    let code = 0, result: any;
    const response: any = { setHeader() {}, status(value: number) { code = value; return this; }, json(value: any) { result = value; return this; } };
    const started_ns = mono(), start = performance.now(); await handler({ method: 'POST', query: {}, body: command, headers: {} } as any, response); sample.save_ack_ms = performance.now() - start;
    operations.push({ kind: 'handler_span', role, ...context, started_ns, finished_ns: mono() });
    assert.equal(code, 200, JSON.stringify(result)); assert.equal(result.outcome, 'RECORDED'); assert.equal(photoSpans.length, 2);
    const first = photoSpans.reduce((v, s) => BigInt(s.started_ns) < v ? BigInt(s.started_ns) : v, BigInt(photoSpans[0].started_ns));
    const last = photoSpans.reduce((v, s) => BigInt(s.finished_ns) > v ? BigInt(s.finished_ns) : v, BigInt(photoSpans[0].finished_ns));
    sample.photo_wall_ms = Number(last - first) / 1e6;
    operations.push({ kind: 'photo_combined_span', role, ...context, started_ns: first.toString(), finished_ns: last.toString(), sum_ms: sample.photo_verify_ms, wall_ms: sample.photo_wall_ms });
    return { ...sample, outcome: result.outcome, unit_id: `staff:${command.request_id}:card:0001` };
  };
  handlers.start = async () => { requireRole('worker');
    for (let worker = 0; worker < 2; worker++) {
      let firstTerminal = true;
      const terminal = async (kind: string, fn: (tx: any) => Promise<boolean>) => { if (firstTerminal) { terminalReady[worker].resolve(); await releaseTerminals.promise; firstTerminal = false; } return tracked(kind, tx => fn(instrument(tx, null, measuring && !barrierTaken)), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 }, { worker }); };
      const deps = {
        claim: async () => { if (stop.signal.aborted) return null; const claim = await tracked('claim', tx => claimStaffInventoryResearchV2(tx, { leaseMs: 180000, maxConcurrent: 2 }), { maxWait: 5000, timeout: 15000 }, { worker });
          if (claim) { claims.accepted++; const rows = await observerQuery('SELECT count(*)::int AS n FROM "StaffInventoryResearchJobV2" WHERE status = \'running\''); claims.max_running = Math.max(claims.max_running, rows[0].n); }
          else { claims.denied++; const rows = await observerQuery('SELECT count(*)::int AS n FROM "StaffInventoryIntakeLeaseV2" WHERE "expiresAt" > clock_timestamp()'); if (rows[0].n >= 3) claims.denied_at_three_leases++; } return claim; },
        research: async (input: any, signal: AbortSignal) => { const began = performance.now(), started_ns = mono(); let outcome = 'complete';
          try { return await researchStaffInventoryCard(input, { env: { OPENAI_API_KEY: 'synthetic-no-network', SOLDCOMPS_API_KEY: 'synthetic-no-network', STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES: 'false' }, fetchImpl: transport, loadPhoto: async key => { const bytes = photos.get(key); assert.ok(bytes); return { key, sha256: sha(bytes), bytes }; }, loadReferences: async () => [] }, signal); }
          catch (error) { outcome = String((error as { code?: string }).code ?? 'unknown'); throw error; }
          finally { operations.push({ kind: 'research_duration', role, worker, started_ns, finished_ns: mono(), elapsed_ms: performance.now() - began, outcome }); } },
        complete: async (claim: any, result: any) => { const done = await terminal('complete', tx => completeStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, result })); if (done) claims.completed++; return done; },
        fail: async (claim: any, error: any) => { const done = await terminal('fail', tx => failStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, errorCode: String(error.code).toUpperCase(), errorMessage: error.message, retryable: ['provider_error', 'timeout', 'cancelled'].includes(error.code) })); if (done) { claims.failed++; claims.failures_by_code[error.code] = (claims.failures_by_code[error.code] ?? 0) + 1; } return done; },
      };
      workers.push((async () => { while (!stop.signal.aborted) { await runStaffInventoryResearchWorker(deps as any, stop.signal); if (!stop.signal.aborted) await delay(10); } })().catch(error => { workerErrors.push(safeError(error)); stop.abort(); releaseTerminals.resolve(); }));
    }
    const until = performance.now() + 5000; while (claims.accepted < 2 && performance.now() < until && !workerErrors.length) await delay(2);
    assert.equal(workerErrors.length, 0, workerErrors.join('; ')); assert.equal(claims.accepted, 2); return true;
  };
  handlers['terminals-ready'] = async () => { requireRole('worker'); await Promise.all(terminalReady.map(x => x.promise)); return true; };
  handlers['measure-start'] = async () => { requireRole('worker'); measuring = true; operations.push({ kind: 'measurement_start', role, at_ns: mono() }); return true; };
  handlers['release-terminals'] = async () => { requireRole('worker'); releaseTerminals.resolve(); await Promise.race([acquiredBarrier.promise, delay(5000).then(() => { throw Error('Worker terminal barrier not acquired'); })]); return true; };
  handlers.stop = async () => { requireRole('worker'); stop.abort(); releaseTerminals.resolve(); await Promise.all(workers); assert.equal(workerErrors.length, 0, workerErrors.join('; ')); return true; };
  handlers.verify = async ({ samples }) => { requireRole('intake'); const final = await count(); assert.equal(final.jobs, initial.jobs + 1 + samples.length);
    const jobs = await db.$queryRawUnsafe<any[]>('SELECT "unitId", count(*)::int AS n FROM "StaffInventoryResearchJobV2" GROUP BY "unitId"'), cardinality = new Map(jobs.map(x => [x.unitId, x.n])); assert.ok(samples.every((x: any) => cardinality.get(x.unit_id) === 1));
    const preserved = await db.$queryRawUnsafe<any[]>('SELECT "id", "contentHash" FROM "InventoryWorkflowEventV2" ORDER BY sequence LIMIT $1', initialRows.length); assert.deepEqual(preserved, initialRows);
    assert.ok(photoBytes.every((b, i) => photoKey(b) === [description.photo_key, description.back_photo_key][i]));
    return { before: initial, after: final, source_invariants: { one_job_per_accepted_save: true, failed_save_no_job_or_event: true, concurrent_retry_one_job: true, history_preserved: true, original_fixture_hashes_preserved: true } };
  };
  handlers['trace-finish'] = async () => { if (finishReceipt) return finishReceipt; observerStopping = true; await polling; await observerQueue;
    let observer_trace = null;
    if (role === 'observer') { const file = `${config.output}.db-observer.ndjson`; await writeFile(file, observations.map(x => JSON.stringify(x)).join('\n') + '\n', { flag: 'wx', mode: 0o600 }); observer_trace = { file, samples: observations.length }; }
    finishReceipt = { ...trace.finish(), claims, provider_counts: providerCounts, barrier_observed: barrierObserved, observer_trace }; return finishReceipt;
  };
  handlers.close = async () => closing ??= (async () => { stop.abort(); releaseTerminals.resolve(); observerStopping = true; await Promise.allSettled(workers); await polling; await observerQueue; const partial = trace.finish(); await db.$disconnect(); if (traceActive && !finishReceipt) await writeFile(`${config.output}.${role}.partial.json`, JSON.stringify({ incomplete: true, ...partial, observations: role === 'observer' ? observations : undefined, worker_errors: workerErrors }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return true; })();
  process.once('disconnect', () => { rpc.fail(Error('Driver disconnected')); void handlers.close({}).finally(() => process.exit(0)); });
  boot.resolve();
}
main().catch(error => { console.error(safeError(error)); process.exit(1); });
