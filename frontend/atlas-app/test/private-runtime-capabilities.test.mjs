import test from 'node:test';
import assert from 'node:assert/strict';
import { createServingConnectedManual } from '../lib/server/connected-manual-runtime.mjs';
import { variantWorkerEnvironment, variantWorkerSettings } from '../lib/server/variant-runtime-settings.mjs';

// Use the real composition and the worker entry point's environment adapter.
// The client models the restricted role: archive EXECUTE is absent, while
// variant schema/grants are present. No worker, auth, storage or provider runs.
const base = {
  ATLAS_MANUAL_ENABLED: 'true', ATLAS_MANUAL_VARIANT_REVIEW_ENABLED: 'true',
  ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED: 'true', ATLAS_MANUAL_DEFECT_MEMORY_ENABLED: 'true',
  ATLAS_MANUAL_LEARNING_LIFECYCLE_ENABLED: 'true',
  ATLAS_MANUAL_OPENAI_KEY: 'sk-synthetic-main-provider-key', ATLAS_VARIANT_OPENAI_KEY: 'sk-synthetic-distinct-variant-key',
  ATLAS_MANUAL_DATABASE_URL: 'postgresql://manual:fixture@db.invalid/atlas?schema=atlas_manual&connection_limit=4&sslmode=require',
  ATLAS_VARIANT_DATABASE_URL: 'postgresql://variant:fixture@db.invalid/atlas?schema=atlas_manual&connection_limit=1&sslmode=require',
  ATLAS_MANUAL_STORAGE_ENDPOINT: 'https://nyc3.digitaloceanspaces.com',
  ATLAS_MANUAL_UPLOAD_ORIGIN: 'https://fixture.nyc3.digitaloceanspaces.com',
  ATLAS_MANUAL_STORAGE_BUCKET: 'fixture', ATLAS_MANUAL_STORAGE_REGION: 'nyc3',
  ATLAS_MANUAL_STORAGE_PREFIX: 'atlas/manual/v1', ATLAS_MANUAL_PYTHON: '/fixture/python',
  ATLAS_MANUAL_STORAGE_ACCESS_KEY: 'synthetic-access', ATLAS_MANUAL_STORAGE_SECRET_KEY: 'synthetic-private-key',
};
function fixture({ worker = false, archiveInstalled = true, archiveAllowed = !worker, variantInstalled = true, variantAllowed = true } = {}) {
  const configured = { ...base, ATLAS_VARIANT_WORKER_ENABLED: String(worker) };
  const env = worker ? variantWorkerEnvironment(configured, variantWorkerSettings(configured)) : configured;
  const config = { mode: 'PRODUCTION', origin: 'https://atlasgrading.com', deploymentId: 'new-candidate.vercel.app',
    releaseSha: 'a'.repeat(40), configHash: 'b'.repeat(64), phoneByHash: new Map(),
    databaseUrl: 'postgresql://staff:fixture@db.invalid/atlas?schema=atlas_staff&sslmode=require' };
  const auth = { config, actors: new WeakMap(), authenticate() { assert.fail('Boot cannot authenticate a human'); } };
  const queries = [], clients = [];
  class Client {
    constructor(options) { this.url = options.datasources.db.url; clients.push(this); }
    async $transaction() { assert.fail('Cold construction and schema validation cannot start machine work'); }
    async $queryRawUnsafe(sql, ...values) {
      queries.push({ sql, values });
      assert.doesNotMatch(sql, /authenticate_machine|lock_control|StaffControl/);
      if (values[0] === 'atlas_manual.graded_cards(text,text,jsonb,text[],jsonb)')
        return [sql.includes('has_function_privilege') ? { allowed: archiveAllowed } : { installed: archiveInstalled }];
      if (sql.includes('atlas_manual_connected.variant_job'))
        return [sql.includes('to_regclass') ? { installed: variantInstalled } : { allowed: variantAllowed }];
      assert.fail('Unexpected startup SQL: ' + sql);
    }
    async $disconnect() { this.closed = true; }
  }
  const runtime = createServingConnectedManual({ env, auth, staffConfig: config, Client,
    assertRequest() { assert.fail('No HTTP request during boot qualification'); } });
  return { runtime, queries, clients };
}

test('actual variant environment boots without constructing or querying the human archive capability', async () => {
  const f = fixture({ worker: true });
  try {
    assert.equal(f.clients.length, 1);
    assert.equal(new URL(f.clients[0].url).username, 'variant');
    assert.equal(new URL(f.clients[0].url).searchParams.get('connection_limit'), '1');
    assert.equal(f.queries.length, 0, 'Construction is cold');
    assert.equal(f.runtime.connected.gradedCards, null);
    await f.runtime.validateConfiguration();
    assert.equal(f.queries.length, 2, 'Only the retained variant schema and grants are validated');
    assert(f.queries.every(q => !q.values.includes('atlas_manual.graded_cards(text,text,jsonb,text[],jsonb)')));
  } finally { await f.runtime.close(); }
  assert.equal(f.clients[0].closed, true);
});

test('variant startup still refuses its own missing schema or privileges', async () => {
  for (const [options, code] of [[{ variantInstalled: false }, 'VARIANT_QUEUE_SCHEMA_REQUIRED'], [{ variantAllowed: false }, 'VARIANT_QUEUE_GRANTS_REQUIRED']]) {
    const f = fixture({ worker: true, ...options });
    try { await assert.rejects(f.runtime.validateConfiguration(), { code }); }
    finally { await f.runtime.close(); }
  }
});

test('serving runtime retains the archive and refuses missing008 or absent manual EXECUTE', async () => {
  for (const [options, code] of [[{}, null], [{ archiveInstalled: false }, 'GRADED_CARDS_SCHEMA_REQUIRED'], [{ archiveAllowed: false }, 'GRADED_CARDS_GRANTS_REQUIRED']]) {
    const f = fixture(options);
    try {
      assert.equal(new URL(f.clients[0].url).username, 'manual');
      assert.equal(typeof f.runtime.connected.gradedCards.list, 'function');
      assert.equal(f.queries.length, 0);
      if (code) await assert.rejects(f.runtime.validateConfiguration(), { code });
      else await f.runtime.validateConfiguration();
    } finally { await f.runtime.close(); }
  }
});
