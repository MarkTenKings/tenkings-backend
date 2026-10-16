import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { variantReviewSettings, variantWorkerSettings, variantWorkerEnvironment, validateVariantRuntimeConfiguration } from '../../../frontend/atlas-app/lib/server/variant-runtime-settings.mjs';
import { connectedGrantSQL } from '../src/details.mjs';
import { variantJobGrantSQL } from '../src/variant-job-store.mjs';

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

test('retired catalog configuration and table grant are absent from main and worker contracts', async () => {
 assert.deepEqual(variantReviewSettings({...env,ATLAS_MANUAL_CATALOG_ENABLED:'true',ATLAS_MANUAL_CATALOG_TOKEN:'retired-token'}),variantReviewSettings(env));
 assert.doesNotMatch(connectedGrantSQL('atlas_fixture_role'),/variant_contribution|ON ALL TABLES/);
 for(const worker of [false,true]){
  assert.doesNotMatch(variantJobGrantSQL('atlas_fixture_role',{worker}),/variant_contribution/);
  await validateVariantRuntimeConfiguration({enabled:true,worker,client:{async $queryRawUnsafe(sql){assert.doesNotMatch(sql,/variant_contribution/);return [sql.includes('to_regclass')?{installed:true}:{allowed:true}];}}});
 }
});


test('enabled variant startup binds the exact additive006 function and existing immutable retry guards',async()=>{
 const sql=await readFile(new URL('../../atlas-standalone-database/sql/006-variant-shared-label-retry.sql',import.meta.url),'utf8');
 const body=sql.split('$function$')[1],hash=createHash('sha256').update(body).digest('hex');
 for(const worker of [false,true])await validateVariantRuntimeConfiguration({enabled:true,worker,client:{async $queryRawUnsafe(query){
  if(!query.includes('to_regclass'))return [{allowed:true}];
  assert(query.includes(hash));assert.match(query,/p\.prosecdef/);assert.match(query,/search_path=pg_catalog/);
  assert.match(query,/p\.proowner=/);assert.match(query,/t\.tgname='variant_label_retry_journal' AND t\.tgenabled='O'/);
  assert.match(query,/t\.tgname='variant_job_guard' AND t\.tgenabled='O'/);
  return [{installed:true}];
 }}});
});
