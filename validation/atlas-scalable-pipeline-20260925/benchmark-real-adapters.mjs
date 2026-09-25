// ROOT-ORCHESTRATED, PAID BENCHMARK. This program never accepts a production DB
// credential. All records live in an ownership-checked disposable PostgreSQL.
// Real object writes use a newly generated prefix, retained for receipt audit.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { cpus } from 'node:os';
import { createOwnedManualFixture } from '../../packages/atlas-manual-service/scripts/owned-fixture.mjs';
import { PrismaClient } from '../../frontend/atlas-app/.generated/staff-database/index.js';
import { manualGrantSQL } from '../../packages/atlas-manual-service/src/staff-auth.mjs';
import { machineGrantSQL } from '../../packages/atlas-manual-service/src/machine-auth.mjs';
import { intakeGrantSQL, ingestionGrantSQL } from '../../packages/atlas-manual-intake/src/repository.mjs';
import { connectedGrantSQL } from '../../packages/atlas-connected-manual/src/details.mjs';
import { earlyGeometryGrantSQL } from '../../packages/atlas-connected-manual/src/early-geometry-store.mjs';
import { publicationGrantSQL } from '../../packages/atlas-connected-manual/src/publication-repository.mjs';
import { defectMemoryGrantSQL } from '../../packages/atlas-defect-memory/src/repository.mjs';
import { analysisGrantSQL, analysisReceiptGrantSQL } from '../../packages/atlas-defect-analysis/src/repository.mjs';
import { batchGrantSQL } from '../../packages/atlas-batch-grading/src/repository.mjs';
import { createServingConnectedManual } from '../../frontend/atlas-app/lib/server/connected-manual-runtime.mjs';
import { retainNativeFixture, stopRetainedFixture } from './retained-fixture.mjs';
import { createAnalysisWorker } from '../../packages/atlas-connected-manual/scripts/analysis-worker.mjs';

const args = process.argv.slice(2), take = name => {
  const at = args.indexOf(name); assert(at >= 0 && args[at + 1], `Required ${name}`);
  const value = args[at + 1]; args.splice(at, 2); return value;
};
const acknowledgement = args.indexOf('--ack-live-provider-benchmark');
assert(acknowledgement >= 0, 'Explicit --ack-live-provider-benchmark required; this makes paid provider calls');
args.splice(acknowledgement, 1);
const preflightAt = args.indexOf('--preflight-only'), preflight = preflightAt >= 0;
if (preflight) args.splice(preflightAt, 1);
assert(args.includes('--postgres-bin') && !args.includes('--docker-image'), 'Paid benchmark requires retained native PostgreSQL');
const postgresBin = args[args.indexOf('--postgres-bin') + 1], pgModule = args[args.indexOf('--pg-module') + 1];
const output = take('--output'), pairPath = take('--pair-manifest'), pythonExecutable = take('--python');
assert([output, pairPath, pythonExecutable].every(path => resolve(path) === path), 'Absolute paths required');
const pairManifest = JSON.parse(await readFile(pairPath, 'utf8'));
assert(pairManifest.version === 1 && pairManifest.matchedPair === true && pairManifest.priorGeometryBothReady === true
  && pairManifest.priorAstraReceiptState === 'READY', 'Require reviewed exact matching original pair with prior geometry/analysis evidence');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const originals = {};
for (const side of ['FRONT', 'BACK']) {
  const input = pairManifest.sides[side]; assert(resolve(input.path) === input.path && /^[a-f0-9]{64}$/.test(input.sha256));
  const bytes = await readFile(input.path); assert.equal(bytes.length, input.byteCount); assert.equal(sha(bytes), input.sha256);
  originals[side] = { ...input, bytes };
}
const allowed = ['ATLAS_MANUAL_STORAGE_ENDPOINT', 'ATLAS_MANUAL_UPLOAD_ORIGIN', 'ATLAS_MANUAL_STORAGE_BUCKET', 'ATLAS_MANUAL_STORAGE_REGION',
  'ATLAS_MANUAL_STORAGE_ACCESS_KEY', 'ATLAS_MANUAL_STORAGE_SECRET_KEY', 'ATLAS_MANUAL_OPENAI_KEY', 'ATLAS_MANUAL_GOOGLE_VISION_KEY'];
let input = '';
for await (const chunk of process.stdin) { input += chunk; assert(Buffer.byteLength(input) <= 32768, 'Credential input exceeds bounded allowlist'); }
const credentials = JSON.parse(input); input = '';
assert.deepEqual(Object.keys(credentials).sort(), [...allowed].sort(), 'Only explicit storage/provider credentials may be supplied; DB/cookies are forbidden');
assert(allowed.every(key => typeof credentials[key] === 'string' && credentials[key].length > 0 && credentials[key].length <= 4096));
await mkdir(output, { recursive: false, mode: 0o700 }); await chmod(output, 0o700);
const runId = randomUUID(), prefix = `atlas-connected-manual-v1/benchmark/${runId}`;
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const network = [], observations = [], errors = [], waves = [], originalFetch = globalThis.fetch;
let fixture, connection, runtime, analysisWorker, retained, admissionStop, stopping = false;
const uploadsAbort = new AbortController();
const stopAdmission = () => {
  stopping = true; uploadsAbort.abort();
  if (!admissionStop) admissionStop = Promise.allSettled([runtime?.connected.batch.worker.stop(), runtime?.connected.ingestion.stop(), runtime?.connected.earlyGeometry.stop()]);
  return admissionStop;
};
const safeCode = error => /^[A-Z][A-Z0-9_]{0,100}$/.test(error?.code ?? '') ? error.code : String(error?.name ?? 'Error').slice(0, 80);
const shutdown = () => { void stopAdmission(); };
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
// Capture timing/count/status/allowlisted headers only. Never retain URLs,
// signed query strings, authorization headers, image/prompt bodies or keys.
globalThis.fetch = async (url, options = {}) => {
  const endpoint = new URL(typeof url === 'string' || url instanceof URL ? url : url.url);
  const kind = endpoint.hostname === 'api.openai.com' ? 'OPENAI' : endpoint.hostname === 'vision.googleapis.com' ? 'GOOGLE_OCR'
    : endpoint.origin === credentials.ATLAS_MANUAL_UPLOAD_ORIGIN ? 'ORIGINAL_PUT' : 'OTHER';
  assert(!preflight && kind !== 'OTHER', 'Unexpected global fetch destination or network in preflight');
  assert(!stopping || (kind === 'OPENAI' && (options.method ?? 'GET') === 'GET'), 'Admission is stopped');
  const event = { kind, method: options.method ?? 'GET', startedAt: new Date().toISOString() };
  if (kind === 'OPENAI' && typeof options.body === 'string') {
    const body = JSON.parse(options.body);
    event.model = body.model; event.reasoning = body.reasoning?.effort ?? null; event.serviceTier = body.service_tier ?? 'default';
    event.background = body.background ?? false; event.store = body.store ?? null;
  }
  const began = performance.now(); network.push(event);
  try {
    const response = await originalFetch(url, options); event.status = response.status;
    const rateHeaders = ['x-request-id', 'x-ratelimit-limit-requests', 'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-requests',
      'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens'];
    event.headers = Object.fromEntries(rateHeaders.map(key => [key, response.headers.get(key)]).filter(([, value]) => value !== null && value.length <= 200));
    return response;
  } catch (error) { event.error = safeCode(error); throw error; }
  finally { event.headersReceivedAt = new Date().toISOString(); event.headersElapsedMs = performance.now() - began; }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = (sql, ...parameters) => fixture.admin.$queryRawUnsafe(sql, ...parameters);
try {
  fixture = await createOwnedManualFixture(args); connection = fixture.connect();
  const role = 'atlas_fixture_paid_benchmark', password = randomBytes(24).toString('hex');
  await fixture.cluster.sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  const grants = [manualGrantSQL, machineGrantSQL, intakeGrantSQL, ingestionGrantSQL, connectedGrantSQL, earlyGeometryGrantSQL,
    publicationGrantSQL, defectMemoryGrantSQL, analysisGrantSQL, analysisReceiptGrantSQL, batchGrantSQL];
  await fixture.cluster.sql(grants.map(grant => grant(role)).join('\n'), [], fixture.database.name);
  const databaseUrl = new URL(fixture.database.adminUrl); databaseUrl.username = role; databaseUrl.password = password; databaseUrl.searchParams.set('schema', 'atlas_manual');
  const env = { ...credentials, ATLAS_MANUAL_ENABLED: 'true', ATLAS_MANUAL_DATABASE_URL: databaseUrl.href,
    ATLAS_MANUAL_STORAGE_PREFIX: prefix, ATLAS_MANUAL_PYTHON: pythonExecutable, ATLAS_MANUAL_IDENTIFICATION_ENABLED: 'true',
    ATLAS_MANUAL_DEFECT_MEMORY_ENABLED: 'true', ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED: 'true', ATLAS_MANUAL_BATCH_ENABLED: 'true',
    ATLAS_MANUAL_NATIVE_CONCURRENCY: '2', ATLAS_MANUAL_VERIFY_CONCURRENCY: '4', ATLAS_MANUAL_BATCH_CONCURRENCY: '20', ATLAS_MANUAL_ANALYSIS_CONCURRENCY: '64' };
  runtime = createServingConnectedManual({ env, auth: connection.auth, staffConfig: fixture.config, Client: PrismaClient,
    assertRequest() { throw new Error('No HTTP/browser entry point exists in this benchmark'); }, onWorkerError: error => errors.push({ at: new Date().toISOString(), code: safeCode(error) }) });
  const boot = await connection.auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
  const challenge = await connection.auth.send(cookie, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'isolated-paid-benchmark');
  const verified = await connection.auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'isolated-paid-benchmark');
  const staff = await connection.auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
  await save('scope.private.json', { runId, prefix, pairManifestSha256: sha(await readFile(pairPath)), pairRepeatedForCapacity: true,
    plannedCards: 21, plannedOriginals: 42, ownedDatabaseDirectory: fixture.cluster.directory, ownedDatabaseName: fixture.database.name,
    platform: process.platform, arch: process.arch, node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    processing: { nativeConcurrency: 2, verificationConcurrency: 4, executionConcurrency: 20, analysisConcurrency: 64 },
    limitation: 'One retained matched pair repeated for capacity. Mac→real object storage; not an iPhone uplink or production CPU benchmark. Actual quality/identity refusals remain refusals.' });
  // Freeze all 42 signed upload intents while a genuine local-fixture browser
  // session exists. Only bytes plus independent workers remain after revocation.
  const planned = [];
  for (let index = 0; index < 21; index++) {
    const created = await runtime.connected.intake.create(staff, { requestId: randomUUID(), label: `Isolated real benchmark ${index + 1}` });
    const card = { ordinal: index + 1, cardId: created.card.cardId, uploads: [] };
    for (const side of ['FRONT', 'BACK']) {
      const { upload } = await runtime.connected.intake.plan(staff, card.cardId, { requestId: randomUUID(), side, expectedVersion: 0,
        sha256: originals[side].sha256, byteCount: originals[side].byteCount });
      card.uploads.push({ side, uploadId: upload.uploadId });
    }
    planned.push(card);
  }
  const [identity] = await rows('SELECT "accessVersion" AS version FROM atlas_staff."StaffIdentity" WHERE id=$1::uuid', staff.id);
  // Signing uses an opaque server handle after browser logout. This does not
  // re-create browser/session authority or call the production application.
  const machine = runtime.boundary.machineOwner({ ownerId: staff.id, accessVersion: identity.version });
  await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffSession" SET "revokedAt"=clock_timestamp()');
  await assert.rejects(connection.auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf));
  await save('planned.private.json', planned);
  retained = await retainNativeFixture({ fixture, postgresBin, pgModule, output, context: { prefix, pythonExecutable, manualUrl: databaseUrl.href,
    sessionKey: fixture.config.sessionKey.toString('base64'), phoneKey: fixture.config.phoneKey.toString('base64'), phones: [...fixture.config.phoneByHash.values()] } });
  analysisWorker = createAnalysisWorker({ reconciler: runtime.analysisReconciler, batchSize: 10, concurrency: 4, intervalMs: 2000,
    onEvent: event => observations.push({ at: new Date().toISOString(), collector: event }) });
  if (!preflight && !stopping) {
    runtime.connected.ingestion.start(); runtime.connected.earlyGeometry.start(); runtime.connected.batch.worker.start(); analysisWorker.start();
  } else stopping = true;
  const snapshot = async () => {
    const at = new Date().toISOString();
    const jobs = await rows('SELECT card_id,state,stage,code,attempts,analysis_attempt,analysis_action_id,analysis_reserved,created_at,updated_at,evidence::jsonb AS evidence FROM atlas_manual_connected.batch_grading ORDER BY created_at,key');
    const uploads = await rows('SELECT card_id,side,verification IS NOT NULL AS verified,source IS NOT NULL AS prepared FROM atlas_manual_intake.upload ORDER BY card_id,side');
    const [pending] = await rows(`SELECT count(*)::int n FROM atlas_defect_analysis.run r
      WHERE EXISTS(SELECT 1 FROM atlas_defect_analysis.provider_event e WHERE e.analysis_id=r.id AND e.kind='ACCEPTED')
      AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.receipt p WHERE p.analysis_id=r.id AND p.kind='RESPONSE')`);
    const value = { at, jobs, uploads, acceptedUnsettled: pending.n }; observations.push(value); return value;
  };
  for (const cohort of [planned.slice(0, 1), planned.slice(1)]) {
    if (stopping) break;
    const wave = { cards: cohort.length, startedAt: new Date().toISOString(), uploadReceipts: [] }, began = performance.now(); waves.push(wave);
    // Four actual PUTs in flight; originals are never resized or re-encoded.
    const tasks = cohort.flatMap(card => card.uploads.map(upload => ({ card, upload })));
    let cursor = 0;
    const puts = await Promise.allSettled(Array.from({ length: Math.min(4, tasks.length) }, async () => {
      try { while (cursor < tasks.length && !stopping) {
        const { card, upload } = tasks[cursor++], startedAt = new Date().toISOString();
        const signed = await runtime.connected.intake.sign(machine, card.cardId, upload.uploadId);
        assert.equal(signed.state, 'UPLOAD'); assert.equal(signed.method, 'PUT');
        const response = await fetch(signed.url, { method: signed.method, headers: signed.headers, body: originals[upload.side].bytes,
          redirect: 'error', signal: AbortSignal.any([uploadsAbort.signal, AbortSignal.timeout(90000)]) });
        await response.arrayBuffer(); assert(response.ok, `Original PUT failed with status ${response.status}`);
        wave.uploadReceipts.push({ ordinal: card.ordinal, side: upload.side, startedAt, finishedAt: new Date().toISOString(), status: response.status, bytes: originals[upload.side].byteCount });
      } } catch (error) { void stopAdmission(); throw error; }
    }));
    const failedPut = puts.find(result => result.status === 'rejected'); if (failedPut) throw failedPut.reason;
    wave.allPutsFinishedAt = new Date().toISOString();
    const ids = new Set(cohort.map(card => card.cardId));
    while (!stopping && performance.now() - began < 20 * 60 * 1000) {
      const observed = await snapshot(), jobs = observed.jobs.filter(job => ids.has(job.card_id));
      if (!wave.allOriginalsVerifiedAt && observed.uploads.filter(upload => ids.has(upload.card_id) && upload.verified).length === cohort.length * 2) wave.allOriginalsVerifiedAt = observed.at;
      const terminal = jobs.filter(job => ['REVIEW', 'NEEDS_ATTENTION', 'SUPERSEDED'].includes(job.state));
      console.log(JSON.stringify({ event: 'BENCHMARK_PROGRESS', cards: cohort.length, machineReviewReady: jobs.filter(job => job.state === 'REVIEW').length,
        needsAttention: terminal.filter(job => job.state !== 'REVIEW').map(job => job.code), acceptedUnsettled: observed.acceptedUnsettled, elapsedMs: performance.now() - began }));
      await save('progress.private.json', { waves, network, observations, errors });
      if (terminal.length === cohort.length && observed.acceptedUnsettled === 0) {
        wave.finishedAt = observed.at; wave.elapsedMs = performance.now() - began; wave.states = jobs;
        wave.status = terminal.every(job => job.state === 'REVIEW') ? 'PASS' : 'NEEDS_ATTENTION'; break;
      }
      await sleep(2000);
    }
    wave.status ??= stopping ? 'INTERRUPTED' : 'DEADLINE';
    // A failed baseline is meaningful; never spend on 20 repetitions of a pair
    // whose quality or identity did not qualify through the actual pipeline.
    if (wave.status !== 'PASS') { void stopAdmission(); break; }
  }
} catch (error) {
  void stopAdmission(); errors.push({ at: new Date().toISOString(), code: safeCode(error) }); process.exitCode = 1;
 } finally {
  const failure = (phase, error) => errors.push({ at: new Date().toISOString(), phase, code: safeCode(error) });
  let originalsUnchanged = false, status = 'INCOMPLETE', stopped = false;
  try {
    // Stop admission first. Collector-only GETs continue for accepted work;
    // interrupted/uncertain effects remain durable obligations, never new POSTs.
    const drains = await stopAdmission();
    for (const drain of drains) if (drain.status === 'rejected') failure('ADMISSION_STOP', drain.reason);
    try {
      if (fixture && analysisWorker && !preflight) {
        const [window] = await rows("SELECT max((evidence::jsonb->>'pollUntil')::timestamptz) AS until FROM atlas_defect_analysis.provider_event WHERE kind='ACCEPTED'");
        const collectorUntil = Math.max(Date.now(), window.until ? +new Date(window.until) + 5000 : 0);
        while (Date.now() < collectorUntil) {
          const [pending] = await rows(`SELECT count(*)::int n FROM atlas_defect_analysis.run r
            WHERE EXISTS(SELECT 1 FROM atlas_defect_analysis.provider_event e WHERE e.analysis_id=r.id AND e.kind='ACCEPTED')
            AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.receipt p WHERE p.analysis_id=r.id AND p.kind='RESPONSE')
            AND NOT EXISTS(SELECT 1 FROM atlas_defect_analysis.receipt p WHERE p.analysis_id=r.id AND p.kind='OUTCOME'
              AND p.evidence::jsonb->>'code'='DEFECT_ANALYSIS_POLL_WINDOW_EXHAUSTED')`);
          if (pending.n === 0) break;
          console.log(JSON.stringify({ event: 'BENCHMARK_COLLECTING_ADMITTED_RESULTS', count: pending.n }));
          await sleep(2000);
        }
      }
    } catch (error) { failure('COLLECT_ADMITTED', error); }
    try { await analysisWorker?.stop(); } catch (error) { failure('COLLECTOR_STOP', error); }
    try {
      if (fixture) await save('database-evidence.private.json', {
        runs: await rows('SELECT id,card_id,action_id,state,created_at,dispatched_at FROM atlas_defect_analysis.run'),
        receipts: await rows('SELECT analysis_id,kind,recorded_at,evidence::jsonb AS evidence FROM atlas_defect_analysis.receipt'),
        providerEvents: await rows('SELECT analysis_id,kind,recorded_at,evidence::jsonb AS evidence FROM atlas_defect_analysis.provider_event'),
        identificationEffects: await rows('SELECT attempt_id,stage,event,recorded_at,evidence::jsonb AS evidence FROM atlas_manual_connected.effect'),
        jobs: await rows('SELECT card_id,state,stage,code,analysis_action_id,analysis_attempt,evidence::jsonb AS evidence FROM atlas_manual_connected.batch_grading'),
        humanApprovals: await rows('SELECT count(*)::int n FROM atlas_manual.approval'),
      });
    } catch (error) { failure('FINAL_EVIDENCE', error); }
    try {
      for (const side of ['FRONT', 'BACK']) assert.equal(sha(await readFile(originals[side].path)), originals[side].sha256);
      originalsUnchanged = true;
      if (preflight) assert.equal(network.length, 0);
    } catch (error) { failure('FINAL_ORIGINAL_CHECK', error); }
    status = preflight && errors.length === 0 ? 'PREFLIGHT_PASS'
      : waves.length === 2 && waves.every(wave => wave.status === 'PASS') && errors.length === 0 ? 'PASS' : 'INCOMPLETE';
    await save('result.private.json', { status, runId, prefix, waves, network, observations, errors,
      actualProviderPosts: network.filter(event => event.kind === 'OPENAI' && event.method === 'POST').length,
      actualOcrPosts: network.filter(event => event.kind === 'GOOGLE_OCR').length,
      sampledMaximumAcceptedUnsettled: Math.max(0, ...observations.map(row => row.acceptedUnsettled ?? 0)),
      productionDatabaseWrites: 0, originalFilesUnchanged: originalsUnchanged,
      limitation: '20 jobs are requested concurrently through the real pipeline; measured accepted concurrency and completion times determine capacity, never the configured worker count.' });
  } finally {
    // Even evidence or query failure cannot skip owned process shutdown. stop()
    // retains the ownership-marked PostgreSQL directory for exact reconciliation.
    try { await runtime?.close(); } catch (error) { failure('RUNTIME_CLOSE', error); }
    try { await connection?.close(); } catch (error) { failure('CONNECTION_CLOSE', error); }
    try {
      await fixture?.admin.$disconnect();
      if (retained) await stopRetainedFixture(retained.record);
      else await fixture?.stop(); // No provider worker can start before the retained context exists.
      stopped = true;
    } catch (error) { failure('DATABASE_STOP', error); }
    globalThis.fetch = originalFetch;
    await save('cleanup.private.json', { stopped, ownedDatabaseRetainedAt: retained?.record.data ?? null, retainedContext: retained?.path ?? null, storagePrefixRetained: prefix, errors });
  }
  console.log(JSON.stringify({ status, output, actualProviderPosts: network.filter(event => event.kind === 'OPENAI' && event.method === 'POST').length }));
  if (!['PASS', 'PREFLIGHT_PASS'].includes(status) || !stopped) process.exitCode = 1;
}
