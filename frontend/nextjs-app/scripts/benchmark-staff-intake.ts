/** Test-only child of benchmarkStaffIntakeDisposable.mjs. Never uses an application DB. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile, appendFile } from 'node:fs/promises';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { recordStaffInventoryV2 } from '../../../packages/database/src/cardPlatformV2';
import { acquireStaffInventoryIntakeLeaseV2, releaseStaffInventoryIntakeLeaseV2, claimStaffInventoryResearchV2,
  completeStaffInventoryResearchV2, failStaffInventoryResearchV2 } from '../../../packages/database/src/staffInventoryResearchV2';
import { researchStaffInventoryCard } from '../lib/server/staffInventoryResearch';
import { runStaffInventoryResearchWorker } from '../lib/server/staffInventoryResearchWorker';
import { createStaffInventoryWorkspaceHandler } from '../pages/api/v2/admin/inventory/workspace';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const uuid = (value: string) => { const hash = sha(value); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`; };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const monotonic = () => process.hrtime.bigint().toString();
async function observeDatabase(config: any, url: URL) {
  url.searchParams.set('application_name', 'tk_bench_observer'); url.searchParams.set('connection_limit', '1');
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const samples: any[] = []; let stopping = false, queue: Promise<any> = Promise.resolve();
  const execute = (sql: string, values: any[] = []) => { const task = queue.then(() => db.$queryRawUnsafe(sql, ...values)); queue = task.catch(() => {}); return task; };
  await db.$connect();
  const polling = (async () => {
    while (!stopping) {
      const started_ns = monotonic();
      const rows = await execute(`SELECT a.pid, a.application_name, a.state, a.wait_event_type, a.wait_event, a.query_start, a.xact_start,
        CASE WHEN a.query LIKE '%4202%' THEN 'queue_lock' WHEN a.query LIKE '%InventoryWorkflowEventV2%' THEN 'journal' ELSE 'other' END AS query_kind,
        EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND l.locktype = 'advisory' AND l.classid = 20260911 AND l.objid = 4202 AND l.granted) AS owns_queue_lock
        FROM pg_stat_activity a WHERE a.datname = current_database() AND a.application_name IN ('tk_bench_intake', 'tk_bench_worker') AND a.state <> 'idle' ORDER BY a.pid`);
      samples.push({ started_ns, finished_ns: monotonic(), rows }); await delay(config.protocol.scheduling_instrumentation.independent_observer_poll_ms);
    }
  })();
  process.on('message', async (message: any) => {
    try {
      if (message.kind === 'query') process.send?.({ id: message.id, result: await execute(message.sql, message.values) });
      else if (message.kind === 'stop') {
        stopping = true; await polling; await queue; await db.$disconnect();
        const file = `${config.output}.db-observer.ndjson`;
        await writeFile(file, samples.map(sample => JSON.stringify(sample)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
        process.send?.({ id: message.id, result: { file, samples: samples.length } }); process.disconnect?.();
      }
    } catch (error) { process.send?.({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
  });
  process.send?.({ kind: 'ready' });
  await new Promise<void>(resolve => process.once('disconnect', resolve));
}
async function remoteObserver(config: any) {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', TSX_TSCONFIG_PATH: config.observer_launch.tsconfig };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'NEXT_TELEMETRY_DISABLED', 'AWS_EC2_METADATA_DISABLED', 'DATABASE_URL', 'TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION', 'TK_BENCHMARK_OWNED_DATABASE']) if (process.env[key]) env[key] = process.env[key]!;
  const child = spawn(process.execPath, ['--import', config.observer_launch.loader, fileURLToPath(import.meta.url), JSON.stringify({ ...config, mode: 'observe' })], { env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let sequence = 0, errors = '', readySeen = false, stopPromise: Promise<any> | null = null;
  child.stderr?.on('data', bytes => { errors += bytes; });
  const ready = new Promise<void>((resolve, reject) => {
    child.on('message', (message: any) => {
      if (message.kind === 'ready') { readySeen = true; resolve(); }
      else { const waiter = pending.get(message.id); if (waiter) { pending.delete(message.id); message.error ? waiter.reject(Error(message.error)) : waiter.resolve(message.result); } }
    });
    child.once('error', reject); child.once('exit', code => { if (!readySeen || code !== 0 || pending.size) { const error = Error(`Independent observer exited (${code}): ${errors.slice(-2000)}`); reject(error); for (const waiter of pending.values()) waiter.reject(error); pending.clear(); } });
  });
  const send = (message: any) => new Promise<any>((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); child.send({ ...message, id }); });
  await ready;
  return { $queryRawUnsafe: (sql: string, ...values: any[]) => send({ kind: 'query', sql, values }),
    finish: () => stopPromise ??= send({ kind: 'stop' }), $disconnect: async () => { await (stopPromise ??= send({ kind: 'stop' })); } };
}
async function main() {
  const config = JSON.parse(process.argv[2]);
  const protocol = config.protocol;
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(process.env.TEN_KINGS_INVENTORY_DISPOSABLE_VALIDATION, '1');
  assert.equal(url.hostname, '127.0.0.1');
  assert.match(url.pathname, /^\/tk_intake_(template|\d+)$/);
  assert.equal(url.pathname.slice(1), process.env.TK_BENCHMARK_OWNED_DATABASE);
  if (config.mode === 'observe') { await observeDatabase(config, url); return; }
  // Every provider call must pass the injected tape; accidental fetch fails closed.
  globalThis.fetch = (async () => { throw Error('External fetch forbidden in disposable benchmark'); }) as typeof fetch;
  const connection = (name: string, limit: number) => { const copy = new URL(url); copy.searchParams.set('application_name', name); copy.searchParams.set('connection_limit', String(limit)); return copy.href; };
  const db = new PrismaClient({ datasources: { db: { url: connection('tk_bench_intake', 4) } } });
  const workerDb = new PrismaClient({ datasources: { db: { url: connection('tk_bench_worker', 3) } } });
  let observer: { $queryRawUnsafe: <T = any>(sql: string, ...values: any[]) => Promise<T>; $disconnect: () => Promise<void>; finish?: () => Promise<any> } = new PrismaClient({ datasources: { db: { url: connection('tk_bench_observer', 1) } } });
  const recordOutput = (value: unknown) => writeFile(config.output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
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
  const stop = new AbortController();
  const workers: Promise<void>[] = [];
  let lagTimer: ReturnType<typeof setInterval> | undefined;
  let releaseBlockedWorkers = () => {};
  try {
    if (config.mode === 'seed') {
      await db.location.create({ data: { id: locationId, name: 'DISPOSABLE BENCHMARK HQ', slug: 'disposable-benchmark-hq', address: 'test only', recentRips: [], locationType: 'hq' } });
      await save(add('seed-bulk', protocol.seed_units - protocol.seed_pending - protocol.seed_completed));
      for (let i = 0; i < protocol.seed_pending + protocol.seed_completed; i++) await save(add(`seed-individual-${i}`));
      // Equal retained terminal history, created through the actual claim/fail writer.
      for (let i = 0; i < protocol.seed_completed; i++) {
        const claim = await workerDb.$transaction(tx => claimStaffInventoryResearchV2(tx, { maxConcurrent: 2 })); assert.ok(claim);
        await workerDb.$transaction(tx => failStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, errorCode: 'PROVIDER_UNAVAILABLE', errorMessage: 'Synthetic seed history', retryable: false }));
      }
      const counts = await count(); assert.equal(counts.jobs, protocol.seed_pending + protocol.seed_completed);
      await recordOutput({ mode: 'seed', counts, stock_hash: await stockHash(), units: protocol.seed_units, pending: protocol.seed_pending, terminal: protocol.seed_completed, photo_hashes: photoBytes.map(sha) });
      console.log(JSON.stringify({ seed: 'complete', ...counts })); return;
    }
    const initial = await count();
    const initialRows = await db.$queryRawUnsafe<any[]>('SELECT "id", "contentHash" FROM "InventoryWorkflowEventV2" ORDER BY sequence');
    // Prove rollback and exact retry before timing; all subsequent blocks start identically.
    const failed = add('rollback-proof');
    await assert.rejects(db.$transaction(async tx => { await recordStaffInventoryV2(tx, failed, actor); throw Error('injected rollback'); }, { timeout: 30000 }), /injected rollback/);
    assert.deepEqual(await count(), initial);
    const retry = add('retry-proof'); const retryResults = await Promise.all([save(retry), save(retry)]);
    assert.deepEqual(retryResults.map(x => x.outcome).sort(), ['RECORDED', 'REPLAY']);
    const afterRetry = await count(); assert.equal(afterRetry.jobs, initial.jobs + 1);
    assert.equal((await save(retry)).outcome, 'REPLAY'); assert.deepEqual(await count(), afterRetry);

    // Untimed admission proof: make one slot available while three intake leases
    // are held, then release one lease and prove exactly that admission resumes.
    // The existing worker's terminal write must still succeed during the pause.
    const admissionClaims: any[] = [], admissionLeases: string[] = [];
    const claimAdmission = () => workerDb.$transaction(tx => claimStaffInventoryResearchV2(tx, { maxConcurrent: 2 }));
    const finishAdmission = (claim: any) => workerDb.$transaction(tx => failStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, errorCode: 'BENCHMARK_PREFLIGHT', errorMessage: 'Synthetic untimed admission proof', retryable: false }));
    try {
      for (let i = 0; i < 2; i++) { const claim = await claimAdmission(); assert.ok(claim); admissionClaims.push(claim); }
      for (let i = 0; i < 3; i++) admissionLeases.push((await db.$transaction(tx => acquireStaffInventoryIntakeLeaseV2(tx))).leaseId);
      assert.equal(await finishAdmission(admissionClaims[0]), true, 'Existing terminal write must finish while intake admission pauses');
      admissionClaims.shift();
      assert.equal(await claimAdmission(), null, 'Three intake leases must deny a new claim with an available worker slot');
      await db.$transaction(tx => releaseStaffInventoryIntakeLeaseV2(tx, admissionLeases[0])); admissionLeases.shift();
      const resumed = await claimAdmission(); assert.ok(resumed, 'Removing the third intake lease must resume admission'); admissionClaims.push(resumed);
    } finally {
      for (const claim of admissionClaims) await finishAdmission(claim);
      for (const leaseId of admissionLeases) await db.$transaction(tx => releaseStaffInventoryIntakeLeaseV2(tx, leaseId));
    }

    if (protocol.scheduling_diagnostic) { await observer.$disconnect(); observer = await remoteObserver(config); }
    const samples: any[] = [], operations: any[] = [];
    const providerCounts = { sold: 0, image: 0, model: 0, unexpected: 0 };
    const claims = { accepted: 0, denied: 0, denied_at_three_leases: 0, max_running: 0, completed: 0, failed: 0, failures_by_code: {} as Record<string, number> };
    const terminalReady = [deferred(), deferred()], releaseTerminals = deferred(), acquiredBarrier = deferred();
    releaseBlockedWorkers = releaseTerminals.resolve;
    let barrierTaken = false, barrierObserved = false, releaseRequested = false, measuring = false;
    const loopDelay = monitorEventLoopDelay({ resolution: 10 }); loopDelay.enable();
    const cpuBefore = process.cpuUsage(), started = performance.now();
    if (protocol.scheduling_diagnostic) {
      let previous = process.hrtime.bigint();
      lagTimer = setInterval(() => { const at = process.hrtime.bigint(); operations.push({ kind: 'event_loop_tick', previous_ns: previous.toString(), at_ns: at.toString(), gap_ms: Number(at - previous) / 1e6 }); previous = at; }, protocol.scheduling_instrumentation.event_loop_tick_ms);
    }
    const instrument = (tx: any, sample: any, workerBarrier = false, trace: any = null) => new Proxy(tx, { get(target, key) {
      const original = Reflect.get(target, key);
      if (!['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'].includes(String(key))) return typeof original === 'function' ? original.bind(target) : original;
      return async (...queryArgs: any[]) => {
        const sql = typeof queryArgs[0] === 'string' ? queryArgs[0] : queryArgs[0]?.sql ?? queryArgs[0]?.strings?.join('') ?? '';
        const isQueue = sql.includes('pg_advisory_xact_lock(20260911, 4202)');
        const began = performance.now(), started_ns = trace ? monotonic() : null;
        let result;
        try { result = await original.apply(target, queryArgs); }
        finally { if (trace) operations.push({ kind: 'sql_span', trace_id: trace.trace_id, operation: trace.operation, pid: trace.pid, queue_lock: isQueue, started_ns, finished_ns: monotonic() }); }
        if (isQueue && sample) sample.queue_lock_ms += performance.now() - began;
        if (isQueue && workerBarrier && !barrierTaken) {
          const barrier_started_ns = protocol.scheduling_diagnostic ? monotonic() : null;
          barrierTaken = true; acquiredBarrier.resolve();
          const until = performance.now() + 2500;
          while (performance.now() < until) {
            const rows = await observer.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'tk_bench_intake' AND wait_event = 'advisory' AND query LIKE '%4202%'`);
            if (rows[0].n > 0) { barrierObserved = true; break; }
            await delay(2);
          }
          operations.push({ kind: 'controlled_save_terminal_overlap', observed: barrierObserved, started_ns: barrier_started_ns, finished_ns: protocol.scheduling_diagnostic ? monotonic() : null });
        }
        return result;
      };
    } });
    let traceSequence = 0;
    const trackedTransaction = async <T,>(client: PrismaClient, operation: string, work: (tx: any) => Promise<T>, options: any = {}, context: any = {}) => {
      if (!protocol.scheduling_diagnostic) return client.$transaction(work, options);
      const trace: any = { kind: 'transaction_span', trace_id: ++traceSequence, operation, requested_ns: monotonic(), ...context };
      try { return await client.$transaction(async tx => {
        trace.callback_ns = monotonic(); trace.pid_query_started_ns = monotonic();
        trace.pid = (await tx.$queryRawUnsafe<{ pid: number }[]>('SELECT pg_backend_pid() AS pid'))[0].pid;
        trace.pid_query_finished_ns = monotonic(); trace.body_started_ns = monotonic();
        try { return await work(instrument(tx, null, false, trace)); } finally { trace.body_finished_ns = monotonic(); }
      }, options); } finally { trace.finished_ns = monotonic(); operations.push(trace); }
    };
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
    if (config.scenario !== 'idle') {
      for (let worker = 0; worker < 2; worker++) {
        let firstTerminal = true;
        const terminal = async (kind: string, fn: (tx: any) => Promise<boolean>) => {
          if (firstTerminal) { terminalReady[worker].resolve(); await releaseTerminals.promise; firstTerminal = false; }
          return trackedTransaction(workerDb, kind, tx => fn(instrument(tx, null, measuring && !barrierTaken)), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 15000 }, { worker });
        };
        const deps = {
          claim: async () => {
            if (stop.signal.aborted) return null;
            const claim = await trackedTransaction(workerDb, 'claim', tx => claimStaffInventoryResearchV2(tx, { leaseMs: 180000, maxConcurrent: 2 }), { maxWait: 5000, timeout: 15000 }, { worker });
            if (claim) { claims.accepted++; const rows = await observer.$queryRawUnsafe<any[]>('SELECT count(*)::int AS n FROM "StaffInventoryResearchJobV2" WHERE status = \'running\''); claims.max_running = Math.max(claims.max_running, rows[0].n); }
            else { claims.denied++; const rows = await observer.$queryRawUnsafe<any[]>('SELECT count(*)::int AS n FROM "StaffInventoryIntakeLeaseV2" WHERE "expiresAt" > clock_timestamp()'); if (rows[0].n >= 3) claims.denied_at_three_leases++; }
            return claim;
          },
          research: async (input: any, signal: AbortSignal) => {
            const began = performance.now(); let outcome = 'complete';
            try { return await researchStaffInventoryCard(input, { env: { OPENAI_API_KEY: 'synthetic-no-network', SOLDCOMPS_API_KEY: 'synthetic-no-network', STAFF_INVENTORY_RESEARCH_FULL_RES_IMAGES: 'false' }, fetchImpl: transport,
              loadPhoto: async key => { const bytes = photos.get(key); assert.ok(bytes); return { key, sha256: sha(bytes), bytes }; }, loadReferences: async () => [] }, signal); }
            catch (error) { outcome = String((error as { code?: string }).code ?? 'unknown'); throw error; }
            finally { operations.push({ kind: 'research_duration', worker, elapsed_ms: performance.now() - began, outcome }); }
          },
          complete: async (claim: any, result: any) => { const done = await terminal('complete', tx => completeStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, result })); if (done) claims.completed++; return done; },
          fail: async (claim: any, error: any) => { const done = await terminal('fail', tx => failStaffInventoryResearchV2(tx, { jobId: claim.jobId, leaseToken: claim.leaseToken, errorCode: String(error.code).toUpperCase(), errorMessage: error.message, retryable: ['provider_error', 'timeout', 'cancelled'].includes(error.code) })); if (done) { claims.failed++; claims.failures_by_code[error.code] = (claims.failures_by_code[error.code] ?? 0) + 1; } return done; },
        };
        workers.push((async () => { while (!stop.signal.aborted) { await runStaffInventoryResearchWorker(deps as any, stop.signal); if (!stop.signal.aborted) await delay(10); } })());
      }
      const until = performance.now() + 5000;
      while (claims.accepted < 2 && performance.now() < until) await delay(2);
      assert.equal(claims.accepted, 2, 'Two real DB claims must precede intake');
    }
    const runSession = async (session: number, warmup: boolean, amount: number) => {
      for (let index = 0; index < amount; index++) {
        const sample: any = { session, index, warmup, lease_ms: 0, queue_lock_ms: 0, photo_verify_ms: 0, save_tx_ms: 0, save_ack_ms: 0, outcome: null };
        const leaseStart = performance.now();
        const context = { session, index, warmup };
        const lease = await trackedTransaction(db, 'lease', tx => acquireStaffInventoryIntakeLeaseV2(tx), { maxWait: 1000, timeout: 1500 }, context);
        sample.lease_ms = performance.now() - leaseStart;
        // Holds the real recognition-capacity lease for a fixed transport tape interval.
        // This is not reported as recognition or camera time.
        await delay(protocol.provider_delay_ms);
        await trackedTransaction(db, 'release_lease', tx => releaseStaffInventoryIntakeLeaseV2(tx, lease.leaseId), { maxWait: 1000, timeout: 1500 }, context);
        const command = add(`measure-${session}-${warmup}-${index}`);
        const handler = createStaffInventoryWorkspaceHandler({
          requireAdmin: async () => ({ user: { id: actor } }) as any,
          readWorkspace: async () => { throw Error('GET is out of benchmark scope'); }, signPhoto: async () => { throw Error('Signing is out of scope'); },
          verifyPhoto: async key => { const start = performance.now(), bytes = photos.get(key); assert.ok(bytes); assert.equal(key, photoKey(bytes)); const meta = await sharp(bytes).metadata(); assert.equal(meta.format, 'jpeg'); sample.photo_verify_ms += performance.now() - start; return true; },
          record: async (body, admin) => {
            if (!warmup && config.scenario !== 'idle' && !releaseRequested) {
              releaseRequested = true; releaseTerminals.resolve();
              await Promise.race([acquiredBarrier.promise, delay(5000).then(() => { throw Error('Terminal barrier was not acquired'); })]);
            }
            const start = performance.now();
            try { return await trackedTransaction(db, 'save', tx => recordStaffInventoryV2(instrument(tx, sample), body, admin), { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 30000 }, context); }
            finally { sample.save_tx_ms = performance.now() - start; }
          },
        });
        let code = 0, result: any;
        const response: any = { setHeader() {}, status(value: number) { code = value; return this; }, json(value: any) { result = value; return this; } };
        const ackStart = performance.now();
        await handler({ method: 'POST', query: {}, body: command, headers: {} } as any, response);
        sample.save_ack_ms = performance.now() - ackStart;
        assert.equal(code, 200, JSON.stringify(result)); assert.equal(result.outcome, 'RECORDED'); sample.outcome = result.outcome;
        sample.unit_id = `staff:${command.request_id}:card:0001`;
        samples.push(sample);
        await appendFile(`${config.output}.samples.ndjson`, `${JSON.stringify(sample)}\n`, { mode: 0o600 });
      }
    };
    await Promise.all(Array.from({ length: config.sessions }, (_, session) => runSession(session, true, protocol.warmups)));
    if (config.scenario !== 'idle') await Promise.all(terminalReady.map(x => x.promise));
    measuring = true;
    if (protocol.scheduling_diagnostic) operations.push({ kind: 'measurement_start', at_ns: monotonic() });
    await Promise.all(Array.from({ length: config.sessions }, (_, session) => runSession(session, false, protocol.measured)));
    if (protocol.scheduling_diagnostic) operations.push({ kind: 'measurement_end', at_ns: monotonic() });
    stop.abort(); releaseTerminals.resolve(); await Promise.all(workers); loopDelay.disable(); clearInterval(lagTimer);
    const observerTrace = observer.finish ? await observer.finish() : null;
    const final = await count(); assert.equal(final.jobs, initial.jobs + 1 + samples.length);
    const jobs = await db.$queryRawUnsafe<any[]>('SELECT "unitId", count(*)::int AS n FROM "StaffInventoryResearchJobV2" GROUP BY "unitId"');
    const cardinality = new Map(jobs.map(x => [x.unitId, x.n])); assert.ok(samples.every(x => cardinality.get(x.unit_id) === 1));
    const preserved = await db.$queryRawUnsafe<any[]>('SELECT "id", "contentHash" FROM "InventoryWorkflowEventV2" ORDER BY sequence LIMIT $1', initialRows.length);
    assert.deepEqual(preserved, initialRows); assert.equal(providerCounts.unexpected, 0); assert.ok(claims.max_running <= 2);
    const hardGates = config.scenario === 'idle' || barrierObserved;
    const result = { arm: config.arm, scenario: config.scenario, sessions: config.sessions, index: config.index, samples, operations, observer_trace: observerTrace, provider_counts: providerCounts, claims,
      hard_gates_pass: hardGates, admission_preflight: { denied_at_three_leases_with_one_running_worker: true, terminal_write_during_pause: true, admitted_after_one_lease_released: true }, source_invariants: { one_job_per_accepted_save: true, failed_save_no_job_or_event: true, concurrent_retry_one_job: true, history_preserved: true, original_fixture_hashes_preserved: photoBytes.every((b, i) => photoKey(b) === [description.photo_key, description.back_photo_key][i]) },
      before: initial, after: final, elapsed_ms: performance.now() - started, cpu: process.cpuUsage(cpuBefore), rss: process.memoryUsage().rss,
      event_loop_ms: { p95: loopDelay.percentile(95) / 1e6, max: loopDelay.max / 1e6 }, unavailable_metrics: ['camera', 'photo_prepare/upload', 'recognition', 'Cost focus', 'next camera'] };
    await recordOutput(result); console.log(JSON.stringify({ block: `${config.arm}/${config.scenario}/${config.sessions}/${config.index}`, samples: samples.length, hard_gates: hardGates, claims }));
  } finally {
    clearInterval(lagTimer);
    stop.abort(); releaseBlockedWorkers();
    await Promise.allSettled(workers);
    await Promise.all([db.$disconnect(), workerDb.$disconnect(), observer.$disconnect()]);
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
