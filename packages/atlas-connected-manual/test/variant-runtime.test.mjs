import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { digest } from '@atlas/manual-service/contract';
import { variantReviewSettings, variantWorkerSettings, variantWorkerEnvironment, validateVariantRuntimeConfiguration } from '../../../frontend/atlas-app/lib/server/variant-runtime-settings.mjs';
import { createVariantSourcePhotoReader } from '../src/variant-source-photos.mjs';
import { variantBinding, variantJobGrantSQL } from '../src/variant-job-store.mjs';

const env = { ATLAS_MANUAL_ENABLED: 'true', ATLAS_MANUAL_VARIANT_REVIEW_ENABLED: 'true', ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED: 'true',
  ATLAS_MANUAL_DEFECT_MEMORY_ENABLED: 'true', ATLAS_VARIANT_WORKER_ENABLED: 'true', ATLAS_MANUAL_OPENAI_KEY: 'synthetic-config-only-key', ATLAS_VARIANT_OPENAI_KEY:'distinct-synthetic-variant-key',
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
  for (const change of [{ ATLAS_VARIANT_OPENAI_KEY:undefined }, { ATLAS_VARIANT_OPENAI_KEY:env.ATLAS_MANUAL_OPENAI_KEY }, { VERCEL: '1' }, { ATLAS_VARIANT_DATABASE_URL: env.ATLAS_MANUAL_DATABASE_URL },
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

test('main cache journaling requires INSERT without UPDATE, DELETE or TRUNCATE access', async () => {
  const grants=variantJobGrantSQL('atlas_manual_main');
  assert.match(grants,/GRANT INSERT ON atlas_manual_connected\.variant_catalog_cache TO "atlas_manual_main";/);
  assert.doesNotMatch(grants,/GRANT (?:UPDATE|DELETE|TRUNCATE).*variant_catalog_cache/);
  for(const insert of [false,true]){
    const client={async $queryRawUnsafe(sql){if(sql.includes('to_regclass'))return [{installed:true}];
      assert.match(sql,/has_table_privilege\(current_user,'atlas_manual_connected\.variant_catalog_cache','INSERT'\)/);
      return [{allowed:insert}];}};
    if(insert)await validateVariantRuntimeConfiguration({enabled:true,client});
    else await assert.rejects(validateVariantRuntimeConfiguration({enabled:true,client}),{code:'VARIANT_QUEUE_GRANTS_REQUIRED'});
  }
});

test('listing acquisition is explicitly enabled only with its worker credential', () => {
  assert.equal(variantWorkerSettings({ ...env, ATLAS_VARIANT_SOLD_COMPS_API_KEY: 'ambient-credential-ignored' }).listingApiKey, null);
  const enabled = { ...env, ATLAS_VARIANT_LISTINGS_ENABLED: 'true', ATLAS_VARIANT_SOLD_COMPS_API_KEY: 'synthetic-listing-worker-key' };
  assert.equal(variantWorkerSettings(enabled).listingApiKey, enabled.ATLAS_VARIANT_SOLD_COMPS_API_KEY);
  assert.equal(variantReviewSettings(enabled).listingApiKey, undefined, 'serving configuration does not expose the acquisition credential');
  for (const key of [undefined, '', 'too-short', 'credential\nwith-line-break']) {
    assert.throws(() => variantWorkerSettings({ ...enabled, ATLAS_VARIANT_SOLD_COMPS_API_KEY: key }),
      { code: 'VARIANT_LISTING_PROVIDER_NOT_CONFIGURED' });
  }
  const isolated = variantWorkerEnvironment(enabled, variantWorkerSettings(enabled));
  assert.equal(isolated.ATLAS_MANUAL_MARKET_AUTOMATIC_ENABLED, 'false');
  assert.equal(isolated.ATLAS_MANUAL_BATCH_ENABLED, 'false');
});

function cardFixture() { return { cardId: 'physical-card', revision: 4, draft: { identityRevision: 2,
  identity: { cardName: 'Synthetic', year: '2026', productSet: 'Fixture', cardNumber: '1', parallel: 'Reverse Holo' }, source: { sourceHash: digest('pair') } } }; }
test('worker references use only canonical generated pixels; replacing a source prevents contribution', async () => {
  const source = await sharp({ create: { width: 2200, height: 2500, channels: 3, background: '#334455' } }).png().toBuffer();
  let card = cardFixture(), reads = 0, changed = false;
  const photo = { original: { content: { sha256: digest('original') } }, workingFrame: { raster: { content: { sha256: digest(source) } } }, decodePlan: {} };
  const pair = { sourceHash: card.draft.source.sourceHash, sides: { FRONT: { photo,upload:{uploadId:'front-upload'} }, BACK: { photo,upload:{uploadId:'back-upload'} } } };
  const reader = createVariantSourcePhotoReader({ boundary: { machineOwner: x => x }, workflow: { service: { read: async () => card } },
    intake: { verifiedPair: async () => pair }, readGradingPhoto: async input => { reads++;assert.equal(input.cardId,card.cardId);assert(input.uploadId); if (changed) card = { ...card, draft: { ...card.draft, identityRevision: 3 } }; return {photo:{...photo,workingFrame:{...photo.workingFrame,schemaVersion:3,generation:{sourceFrame:photo.workingFrame}}},bytes:source}; } });
  const job = { actor_id: 'owner', access_version: 1, card_id: card.cardId, input: variantBinding(card) };
  const result = await reader(job); assert.equal(reads, 2); assert.equal(result.sourceHash, pair.sourceHash);
  for (const side of ['FRONT', 'BACK']) { const metadata = await sharp(result[side].bytes).metadata(); assert.equal(metadata.format, 'jpeg');
    assert.equal(Math.max(metadata.width, metadata.height), 2048); assert.equal(result[side].sha256, digest(result[side].bytes)); }
  assert.equal(digest(source), photo.workingFrame.raster.content.sha256, 'original source buffer stays unchanged');
  changed = true; await assert.rejects(reader(job), { code: 'VARIANT_SOURCE_STALE' });
});


test('variant generated source reader never accepts a missing cutout as uploaded-image permission',async()=>{
 const card=cardFixture(),photo={original:{content:{sha256:digest('original')}},workingFrame:{}};
 const reader=createVariantSourcePhotoReader({boundary:{machineOwner:x=>x},workflow:{service:{read:async()=>card}},intake:{verifiedPair:async()=>({sourceHash:card.draft.source.sourceHash,sides:{FRONT:{photo,upload:{uploadId:'front'}},BACK:{photo,upload:{uploadId:'back'}}}})},readGradingPhoto:async()=>null});
 await assert.rejects(reader({actor_id:'owner',access_version:1,card_id:card.cardId,input:variantBinding(card)}),{code:'VARIANT_GENERATED_PHOTO_REQUIRED'});
});
