import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { digest } from '@atlas/manual-service/contract';
import { variantReviewSettings, variantWorkerSettings, variantWorkerEnvironment, validateVariantRuntimeConfiguration } from '../../../frontend/atlas-app/lib/server/variant-runtime-settings.mjs';
import { createVariantSourcePhotoReader } from '../src/variant-source-photos.mjs';
import { variantBinding } from '../src/variant-job-store.mjs';
import { createVariantRecheck } from '../src/variant-recheck.mjs';
import { workspace } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';

const env = { ATLAS_MANUAL_ENABLED: 'true', ATLAS_MANUAL_VARIANT_REVIEW_ENABLED: 'true', ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED: 'true',
  ATLAS_MANUAL_DEFECT_MEMORY_ENABLED: 'true', ATLAS_VARIANT_WORKER_ENABLED: 'true', ATLAS_MANUAL_OPENAI_KEY: 'synthetic-config-only-key',
  ATLAS_MANUAL_DATABASE_URL: 'postgresql://main:password@localhost/cards?schema=atlas_manual&connection_limit=4&sslmode=require',
  ATLAS_VARIANT_DATABASE_URL: 'postgresql://variant:password@localhost/cards?schema=atlas_manual&connection_limit=1&sslmode=require' };
test('variant configuration is cold, explicit and isolates the one-connection worker role', () => {
  assert.equal(variantReviewSettings({}), null);
  assert.equal(variantWorkerSettings(env).concurrency, 1);
  const isolated = variantWorkerEnvironment({ ...env, ATLAS_MANUAL_MARKET_AUTOMATIC_ENABLED: 'true', ATLAS_MANUAL_BATCH_ENABLED: 'true' }, variantWorkerSettings(env));
  assert.equal(isolated.ATLAS_MANUAL_MARKET_AUTOMATIC_ENABLED, 'false'); assert.equal(isolated.ATLAS_MANUAL_BATCH_ENABLED, 'false');
  assert.equal(isolated.ATLAS_MANUAL_DATABASE_URL, env.ATLAS_VARIANT_DATABASE_URL);
  assert.equal(isolated.ATLAS_MANUAL_DEFECT_MEMORY_ENABLED, 'true');
  assert.equal(variantReviewSettings({ ...env, ATLAS_VARIANT_SCRYDEX_API_KEY: 'ignored-ambient-key' }).scrydex, null);
  for (const change of [{ VERCEL: '1' }, { ATLAS_VARIANT_DATABASE_URL: env.ATLAS_MANUAL_DATABASE_URL },
    { ATLAS_VARIANT_DATABASE_URL: env.ATLAS_VARIANT_DATABASE_URL.replace('connection_limit=1', 'connection_limit=2') },
    { ATLAS_VARIANT_DATABASE_URL: env.ATLAS_VARIANT_DATABASE_URL.replace('localhost', 'foreignhost') },
    { ATLAS_VARIANT_SCRYDEX_ENABLED: 'true' }]) assert.throws(() => variantWorkerSettings({ ...env, ...change }));
});
test('startup refuses absent schema and incomplete grants; disabled runtime performs no queries', async () => {
  let calls = 0; const client = { async $queryRawUnsafe() { calls++; return [{ installed: false }]; } };
  await validateVariantRuntimeConfiguration({ enabled: false, client }); assert.equal(calls, 0);
  await assert.rejects(validateVariantRuntimeConfiguration({ enabled: true, client }), { code: 'VARIANT_QUEUE_SCHEMA_REQUIRED' });
  const partial = { async $queryRawUnsafe(sql) { return sql.includes('to_regclass') ? [{ installed: true }] : [{ allowed: false }]; } };
  await assert.rejects(validateVariantRuntimeConfiguration({ enabled: true, client: partial }), { code: 'VARIANT_QUEUE_GRANTS_REQUIRED' });
});

function cardFixture() { return { cardId: 'physical-card', revision: 4, draft: { identityRevision: 2,
  identity: { cardName: 'Synthetic', year: '2026', productSet: 'Fixture', cardNumber: '1', parallel: 'Reverse Holo' }, source: { sourceHash: digest('pair') } } }; }
test('worker downsizes copies of both current photos; replacing a source during read prevents use', async () => {
  const source = await sharp({ create: { width: 2200, height: 2500, channels: 3, background: '#334455' } }).png().toBuffer();
  let card = cardFixture(), reads = 0, changed = false;
  const photo = { original: { content: { sha256: digest('original') } }, workingFrame: { raster: { content: { sha256: digest(source) } } }, decodePlan: {} };
  const pair = { sourceHash: card.draft.source.sourceHash, sides: { FRONT: { photo }, BACK: { photo } } };
  const reader = createVariantSourcePhotoReader({ boundary: { machineOwner: x => x }, workflow: { service: { read: async () => card } },
    intake: { verifiedPair: async () => pair }, storage: { readDecodedFrame: async () => { reads++; if (changed) card = { ...card, draft: { ...card.draft, identityRevision: 3 } }; return { bytes: source }; } } });
  const job = { actor_id: 'owner', access_version: 1, card_id: card.cardId, input: variantBinding(card) };
  const result = await reader(job); assert.equal(reads, 2); assert.equal(result.sourceHash, pair.sourceHash);
  for (const side of ['FRONT', 'BACK']) { const metadata = await sharp(result[side].bytes).metadata(); assert.equal(metadata.format, 'jpeg');
    assert.equal(Math.max(metadata.width, metadata.height), 2048); assert.equal(result[side].sha256, digest(result[side].bytes)); }
  assert.equal(digest(source), photo.workingFrame.raster.content.sha256, 'original source buffer stays unchanged');
  changed = true; await assert.rejects(reader(job), { code: 'VARIANT_SOURCE_STALE' });
});

test('variant recheck creates one deterministic request, resumes only PREPARED, and preserves findings', async () => {
  const card = cardFixture(), binding = variantBinding(card), state = { defects: workspace(false) }, before = structuredClone(state);
  const row = { owner_id: 'owner', access_version: 1, card_id: card.cardId, source_hash: binding.sourceHash, identity_revision: binding.identityRevision,
    identity_hash: binding.identityHash, analysis_action_id: '00000000-0000-4000-8000-000000000001', reprocess_required: true };
  let previous = null, status = null, requests = 0, resumes = 0;
  const store = { pendingRechecks: async () => [row], currentConfirmation: async () => row };
  const assistance = { repository: { find: async () => previous, status: async () => status },
    executor: { resume: async () => { resumes++; } }, analyzeMachine: async (_staff, id, input) => {
      assert.equal(id, card.cardId); assert.equal(input.actionId, row.analysis_action_id); requests++;
      previous = { analysisId: 'saved', state: 'DISPATCHED' }; status = { state: 'RUNNING' };
    } };
  const run = createVariantRecheck({ store, boundary: { machineOwner: x => x }, workflow: { service: { read: async () => card }, hydrate: async () => state }, assistance });
  await run(); await run(); assert.equal(requests, 1); assert.equal(resumes, 0);
  for (const terminal of ['READY', 'UNKNOWN', 'FAILED', 'REFUSED']) { status = { state: terminal }; await run(); }
  assert.equal(requests, 1); assert.equal(resumes, 0);
  status = { state: 'PREPARED' }; await run(); assert.equal(resumes, 1);
  assert.deepEqual(state, before);
  row.identity_hash = digest('different identity'); previous = null; await run(); assert.equal(requests, 1);
});
