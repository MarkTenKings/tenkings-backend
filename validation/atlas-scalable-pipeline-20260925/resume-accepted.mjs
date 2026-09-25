// Root-only receipt recovery for an already retained isolated benchmark. The
// network fence forbids every provider POST; no intake/batch/geometry worker is
// started. Terminal response artifacts/receipts may be appended as accounting.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { PrismaClient } from '../../frontend/atlas-app/.generated/staff-database/index.js';
import { localAccessConfig } from '../../frontend/atlas-app/lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../../frontend/atlas-app/lib/server/access/auth.mjs';
import { StaffDatabase } from '../../frontend/atlas-app/lib/server/access/database.mjs';
import { createServingConnectedManual } from '../../frontend/atlas-app/lib/server/connected-manual-runtime.mjs';
import { readRetainedFixture, startRetainedFixture, stopRetainedFixture, assertRetainedDatabase } from './retained-fixture.mjs';

const args = process.argv.slice(2);
assert.equal(args.length, 5); assert.equal(args[0], '--ack-collect-existing-results');
assert.equal(args[1], '--context'); assert.equal(args[3], '--output');
const record = await readRetainedFixture(args[2]), output = args[4]; assert.equal(resolve(output), output);
assert(record.context.prefix.startsWith('atlas-connected-manual-v1/benchmark/'));
const keys = ['ATLAS_MANUAL_STORAGE_ENDPOINT', 'ATLAS_MANUAL_UPLOAD_ORIGIN', 'ATLAS_MANUAL_STORAGE_BUCKET', 'ATLAS_MANUAL_STORAGE_REGION',
  'ATLAS_MANUAL_STORAGE_ACCESS_KEY', 'ATLAS_MANUAL_STORAGE_SECRET_KEY', 'ATLAS_MANUAL_OPENAI_KEY', 'ATLAS_MANUAL_GOOGLE_VISION_KEY'];
let text = ''; for await (const chunk of process.stdin) { text += chunk; assert(Buffer.byteLength(text) <= 32768); }
const credentials = JSON.parse(text); text = ''; assert.deepEqual(Object.keys(credentials).sort(), [...keys].sort());
assert(keys.every(key => typeof credentials[key] === 'string' && credentials[key].length > 0 && credentials[key].length <= 4096));
await mkdir(output, { recursive: false, mode: 0o700 });
const originalFetch = globalThis.fetch, calls = [], results = [], errors = [];
globalThis.fetch = async (url, options = {}) => {
  const target = new URL(url); assert.equal(options.method, 'GET'); assert.equal(target.origin, 'https://api.openai.com');
  assert.match(target.pathname, /^\/v1\/responses\/resp_[A-Za-z0-9_-]+$/); assert.equal(target.search, '');
  const response = await originalFetch(url, options); calls.push({ method: 'GET', status: response.status, at: new Date().toISOString() }); return response;
};
let admin, staffClient, runtime, started = false;
try {
  await startRetainedFixture(record); started = true;
  admin = new PrismaClient({ datasources: { db: { url: record.adminUrl } } }); await assertRetainedDatabase(admin, record);
  const config = localAccessConfig({ databaseUrl: record.staffUrl, sessionKey: Buffer.from(record.context.sessionKey, 'base64'),
    phoneKey: Buffer.from(record.context.phoneKey, 'base64'), phones: record.context.phones });
  staffClient = new PrismaClient({ datasources: { db: { url: record.staffUrl } } });
  const auth = new DurableStaffAuth({ database: new StaffDatabase(staffClient, config), config, provider: {} });
  const env = { ...credentials, ATLAS_MANUAL_ENABLED: 'true', ATLAS_MANUAL_DATABASE_URL: record.context.manualUrl,
    ATLAS_MANUAL_STORAGE_PREFIX: record.context.prefix, ATLAS_MANUAL_PYTHON: record.context.pythonExecutable,
    ATLAS_MANUAL_DEFECT_MEMORY_ENABLED: 'true', ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED: 'true' };
  runtime = createServingConnectedManual({ env, auth, staffConfig: config, Client: PrismaClient,
    assertRequest() { throw new Error('No HTTP/browser entry point'); } });
  const [window] = await admin.$queryRawUnsafe("SELECT max((evidence::jsonb->>'pollUntil')::timestamptz) AS until FROM atlas_defect_analysis.provider_event WHERE kind='ACCEPTED'");
  const deadline = Math.max(Date.now() + 5000, window.until ? +new Date(window.until) + 5000 : 0);
  do {
    let cursor = null, count = 0;
    do {
      const page = await runtime.analysisReconciler.pending({ limit: 10, cursor }); cursor = page.nextCursor;
      for (const item of page.items) {
        results.push(await runtime.analysisReconciler.reconcile({ analysisId: item.run.analysisId })); count++;
      }
    } while (cursor);
    await writeFile(join(output, 'progress.private.json'), JSON.stringify({ calls, results }), { mode: 0o600 });
    if (count === 0) break;
    await new Promise(done => setTimeout(done, 2000));
  } while (Date.now() < deadline);
  await writeFile(join(output, 'receipts.private.json'), JSON.stringify(await admin.$queryRawUnsafe('SELECT analysis_id,kind,recorded_at,evidence::jsonb AS evidence FROM atlas_defect_analysis.receipt')), { mode: 0o600 });
} catch (error) { errors.push({ code: error.code ?? error.name }); process.exitCode = 1; }
finally {
  try { await runtime?.close(); } catch (error) { errors.push({ code: error.code ?? error.name, phase: 'RUNTIME_CLOSE' }); }
  await Promise.allSettled([staffClient?.$disconnect(), admin?.$disconnect()]);
  if (started) try { await stopRetainedFixture(record); } catch (error) { errors.push({ code: error.code ?? error.name, phase: 'DATABASE_STOP' }); }
  globalThis.fetch = originalFetch;
  await writeFile(join(output, 'result.private.json'), JSON.stringify({ status: errors.length ? 'INCOMPLETE' : 'COLLECTION_FINISHED', providerPosts: 0,
    providerGets: calls.length, calls, results, errors, dataRetainedAt: record.data }), { mode: 0o600 });
  console.log(JSON.stringify({ status: errors.length ? 'INCOMPLETE' : 'COLLECTION_FINISHED', providerPosts: 0, providerGets: calls.length, output }));
  if (errors.length) process.exitCode = 1;
}
