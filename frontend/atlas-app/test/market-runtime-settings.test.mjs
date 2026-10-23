import test from 'node:test';
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { manualArchiveMarketSearchSettings, manualResearchSettings, manualDealerConfigurationLoader, readDealerOfferFile } from '../lib/server/market-runtime-settings.mjs';
const directory = {version:'atlas-dealer-directory-v1',updatedAt:null,dealers:[]};
const enabled = {ATLAS_MANUAL_PRESENTATION_ENABLED:'true',ATLAS_MANUAL_MARKET_ENABLED:'true',ATLAS_MANUAL_RESEARCH_ENABLED:'true',ATLAS_MANUAL_OPENAI_KEY:'fixture-openai-key',ATLAS_MANUAL_SOLD_COMPS_API_KEY:'fixture-sold-key-long'};
test('archive search native opt-in requires its reviewed schema and existing durable acquisition configuration', () => {
  const env = { ATLAS_STAFF_ARCHIVE_COMP_SEARCH:'1', ATLAS_MANUAL_ENABLED:'true', ATLAS_MANUAL_PRESENTATION_ENABLED:'true',
    ATLAS_MANUAL_MARKET_ENABLED:'true', ATLAS_MANUAL_MARKET_AUTOMATIC_ENABLED:'true', ATLAS_ARCHIVE_MARKET_SCHEMA_SHA256:'a'.repeat(64) };
  for (const flag of [undefined, '0', 'true', true]) assert.equal(manualArchiveMarketSearchSettings({ATLAS_STAFF_ARCHIVE_COMP_SEARCH:flag}),null);
  assert.deepEqual(manualArchiveMarketSearchSettings(env), {expectedSchemaSha256:'a'.repeat(64)});
  for (const key of ['ATLAS_MANUAL_ENABLED','ATLAS_MANUAL_PRESENTATION_ENABLED','ATLAS_MANUAL_MARKET_ENABLED',
    'ATLAS_MANUAL_MARKET_AUTOMATIC_ENABLED','ATLAS_ARCHIVE_MARKET_SCHEMA_SHA256'])
    assert.throws(()=>manualArchiveMarketSearchSettings({...env,[key]:undefined}),{code:'MARKET_ARCHIVE_CONFIGURATION_INVALID'});
  for (const change of [{VERCEL:'1'},{AWS_LAMBDA_FUNCTION_NAME:'fixture'},{ATLAS_VARIANT_WORKER_ENABLED:'true'},
    {ATLAS_ARCHIVE_MARKET_SCHEMA_SHA256:'A'.repeat(64)}])
    assert.throws(()=>manualArchiveMarketSearchSettings({...env,...change}),{code:'MARKET_ARCHIVE_CONFIGURATION_INVALID'});
});
test('research stays cold and requires its presentation, provider settings without retired catalog credentials', () => {
  assert.equal(manualResearchSettings({}),null);
  assert.equal(Object.hasOwn(manualResearchSettings(enabled),'catalogToken'),false);
  for(const field of ['ATLAS_MANUAL_PRESENTATION_ENABLED','ATLAS_MANUAL_MARKET_ENABLED','ATLAS_MANUAL_OPENAI_KEY','ATLAS_MANUAL_SOLD_COMPS_API_KEY']) {
    assert.throws(()=>manualResearchSettings({...enabled,[field]:''}));
  }
  assert.deepEqual(manualResearchSettings({...enabled,ATLAS_MANUAL_CATALOG_ENABLED:'true',ATLAS_MANUAL_CATALOG_TOKEN:'a'.repeat(43)}),manualResearchSettings(enabled));
});
test('dealer configuration is cold, independently cloned and reloaded for each decision',async()=>{
  let reads=0;
  const env={ATLAS_MANUAL_PRESENTATION_ENABLED:'true',ATLAS_MANUAL_DEALER_DIRECTORY_JSON:JSON.stringify(directory),ATLAS_MANUAL_DEALER_OFFERS_PATH:'/run/atlas-dealers/offers.json'};
  const loader=manualDealerConfigurationLoader(env,{readOffers:async()=>({version:'atlas-dealer-offers-v1',offers:[],revision:++reads})});
  assert.equal(reads,0);const first=await loader();first.directory.dealers.push({id:'untrusted'});
  const second=await loader();assert.equal(second.offers.revision,2);assert.deepEqual(second.directory,directory);
  assert.equal(manualDealerConfigurationLoader({}),null);
  assert.throws(()=>manualDealerConfigurationLoader({...env,ATLAS_MANUAL_DEALER_OFFERS_PATH:'/tmp/offers.json'}),{code:'DEALER_OFFERS_CONFIGURATION_INVALID'});
});
function fileFixture({before={},after={},partial=Infinity,openError=false}={}){
  const bytes=Buffer.from(JSON.stringify({version:'atlas-dealer-offers-v1',offers:[]}));
  const stat={isFile:()=>true,uid:0,nlink:1,mode:0o100600,size:bytes.length,mtimeMs:1,ctimeMs:1,...before};let stats=0,closed=0;
  return {get closed(){return closed;},async openFile(path,flags){
    assert.equal(path,'/run/atlas-dealers/offers.json');assert.ok(flags&constants.O_NOFOLLOW);
    if(openError)throw Error('fixture denied');
    return {async stat(){return ++stats===1?stat:{...stat,...after};},async read(target,offset,length,position){const size=Math.min(length,partial,Math.max(0,bytes.length-position));bytes.copy(target,offset,position,position+size);return {bytesRead:size};},async close(){closed++;}};
  }};
}
test('offer file accepts bounded partial reads and closes its descriptor',async()=>{
  const f=fileFixture({partial:3});assert.deepEqual(await readDealerOfferFile('/run/atlas-dealers/offers.json',f),{version:'atlas-dealer-offers-v1',offers:[]});assert.equal(f.closed,1);
});
test('offer file rejects writable, unowned, linked, nonregular, oversized and changing files',async()=>{
  for(const input of [{before:{uid:501}},{before:{nlink:2}},{before:{mode:0o100622}},{before:{isFile:()=>false}},{before:{size:0}},{before:{size:512*1024+1}},{after:{mtimeMs:2}},{after:{ctimeMs:2}},{after:{mode:0o100644}},{partial:0},{openError:true}]){
    const f=fileFixture(input);await assert.rejects(readDealerOfferFile('/run/atlas-dealers/offers.json',f),{code:'DEALER_OFFERS_CONFIGURATION_INVALID'});assert.equal(f.closed,input.openError?0:1);
  }
});
