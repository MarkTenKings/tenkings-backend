import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createServingCompCuration } from '../scripts/comp-runtime.mjs';
import { nativeCompRuntimeFixture, deferred } from './fixtures/comp-curation-runtime-fixture.mjs';

async function fixture() {
  let env, source, f; const dbInputs = [], storageInputs = [], commands = []; let destroyed = 0;
  class Get { constructor(input) { this.input = input; } }
  class Storage {
    constructor(input) { storageInputs.push(input); }
    async send(command, { abortSignal }) {
      assert(command instanceof Get); commands.push(command.input); abortSignal.throwIfAborted();
      const saved = f.records.get(command.input.Key); assert(saved, command.input.Key);
      return { ContentLength: saved.bytes.length, ContentType: saved.contentType,
        Metadata: { 'atlas-manual-lineage-sha256': saved.lineageSha256 }, Body: Readable.from([saved.bytes]) };
    }
    destroy() { destroyed++; }
  }
  f = await nativeCompRuntimeFixture({ runtimeFactory(options) {
    source = options;
    env = { ATLAS_STAFF_COMP_CURATION: '1', ATLAS_COMP_DATABASE_URL: options.settings.databaseUrl,
      ATLAS_COMP_DATABASE_ROLE: options.settings.role, ATLAS_COMP_SCHEMA_OWNER: options.settings.schemaOwner,
      ATLAS_COMP_SCHEMA_SHA256: options.settings.schemaSha256, ATLAS_MANUAL_SERVICE_KEY: options.settings.transportKey.toString('base64'),
      ATLAS_COMP_STORAGE_ENDPOINT: 'https://objects.invalid', ATLAS_COMP_STORAGE_REGION: 'synthetic', ATLAS_COMP_STORAGE_BUCKET: 'synthetic-comp',
      ATLAS_COMP_STORAGE_PREFIX: 'atlas-manual-artifacts/v1', ATLAS_COMP_STORAGE_ACCESS_KEY: 'comp-read-access', ATLAS_COMP_STORAGE_SECRET_KEY: 'comp-read-secret-value',
      ATLAS_MANUAL_STORAGE_ACCESS_KEY: 'different-manual', ATLAS_MANUAL_STORAGE_SECRET_KEY: 'different-manual-secret' };
    class Client { constructor(input) {
      dbInputs.push(input); return options.createClient({ databaseUrl: options.settings.databaseUrl });
    } }
    return createServingCompCuration({ env, auth: options.auth, staffConfig: options.staffConfig,
      Client, nonceStore: options.nonceStore, ObjectClient: Storage, ReadCommand: Get });
  } });
  // Replace only the test's abbreviated market reference with actual immutable
  // artifact-store output so this test crosses the real read-only byte boundary.
  const artifactHash = digest(JSON.stringify(f.preview));
  const ref = await f.artifacts.write(f.preview, { cardId: f.cardId, kind: 'MARKET_PREVIEW', sourceHash: artifactHash });
  f.market.result = canonical({ ...JSON.parse(f.market.result), ref }); f.market.result_hash = digest(f.market.result);
  return { ...f, env, source, dbInputs, storageInputs, commands, get destroyed() { return destroyed; } };
}

test('actual host maps separate lazy bounded clients through signed auth, verified artifacts and saved private receipt', async () => {
  const f = await fixture(); assert.equal(f.dbInputs.length, 0); assert.equal(f.storageInputs.length, 0);
  const read = await f.request(); assert.equal(read.statusCode, 200); assert.equal(read.body.result.availability, 'POLICY_REQUIRED');
  const decision = await f.request(f.decision('NO_SUITABLE_COMPS'));
  assert.equal(decision.statusCode, 200); assert.equal(decision.body.result.outcome, 'NO_SUITABLE_COMPS'); assert.equal(f.rows.length, 1);
  assert.equal(f.dbInputs.length, 1); const url = new URL(f.dbInputs[0].datasources.db.url);
  assert.equal(url.searchParams.get('connection_limit'), '2'); assert.equal(url.searchParams.get('pool_timeout'), '3'); assert.equal(url.searchParams.get('connect_timeout'), '5');
  assert.equal(f.storageInputs.length, 1); assert.equal(f.storageInputs[0].credentials.accessKeyId, 'comp-read-access');
  assert(f.commands.length > 0); assert(f.commands.every(command => /^atlas-manual-artifacts\/v1\/.+\/(PUBLIC_REPORT|MARKET_PREVIEW)\//.test(command.Key)));
  await f.runtime.close(); await f.runtime.close(); assert.equal(f.counts.disconnect, 1); assert.equal(f.destroyed, 1);
});

test('captured host environment drift across a real transaction wait refuses content and any private write', async () => {
  const f = await fixture(), entered = deferred(), resume = deferred();
  f.hooks.transaction = async () => { entered.resolve(); await resume.promise; };
  const pending = f.request(f.decision()); await entered.promise;
  f.env.ATLAS_COMP_STORAGE_SECRET_KEY = 'changed-secret-value'; resume.resolve();
  const reply = await pending; assert.equal(reply.statusCode, 503); assert.deepEqual(Object.keys(reply.body), ['error']); assert.equal(f.rows.length, 0);
  await f.runtime.close(); assert.equal(f.counts.disconnect, 1);
});

test('host close drains admitted work, refuses successors and leaves shared auth client intact', async () => {
  const f = await fixture(), entered = deferred(), resume = deferred();
  f.hooks.transaction = async () => { entered.resolve(); await resume.promise; };
  const pending = f.request(); await entered.promise; const closing = f.runtime.close();
  assert.equal(f.runtime.configuredForDisplay, false); assert.equal((await f.request()).statusCode, 503);
  assert.equal(f.counts.disconnect, 0); resume.resolve(); assert.equal((await pending).statusCode, 200);
  await closing; assert.equal(f.counts.disconnect, 1); assert.equal(f.destroyed, 1); assert.equal(typeof f.auth.database.transaction, 'function');
});

test('reusing grading storage credentials is refused before constructing a client', async () => {
  const f = await fixture(); await f.runtime.close();
  const env = { ...f.env, ATLAS_COMP_STORAGE_ACCESS_KEY: f.env.ATLAS_MANUAL_STORAGE_ACCESS_KEY };
  assert.throws(() => createServingCompCuration({ env, auth: f.auth, staffConfig: f.config,
    Client() { assert.fail('client must remain uncreated'); }, nonceStore: f.source.nonceStore }), { code: 'COMP_NOT_CONFIGURED' });
  assert.equal(f.dbInputs.length, 0); assert.equal(f.storageInputs.length, 0);
});
