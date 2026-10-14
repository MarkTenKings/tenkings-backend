import test from 'node:test';
import assert from 'node:assert/strict';
import {createMachineStaffBoundary} from '../../atlas-manual-service/src/machine-auth.mjs';
import {canonical,digest} from '@atlas/manual-service/contract';
import {createVariantJobStore,readRetainedVariantLabels,variantJobKey} from '../src/variant-job-store.mjs';
import {labelCatalog} from './variant-label-fixture.mjs';

// Model Prisma's elapsed transaction deadline without a slow wall-clock test.
// The real store projection and machine pre/post authorization still execute.
function fixture(projectionMs=7000){
  const catalog=labelCatalog({photos:1}),input={cardId:'catalog-card',sourceHash:digest('source'),identityHash:digest('identity'),identityRevision:1};
  const text=canonical(input),job={key:variantJobKey(input),claim_id:'claim'};
  const row={...job,card_id:input.cardId,source_hash:input.sourceHash,identity_hash:input.identityHash,identity_revision:1,
    generation:'00000000-0000-0000-0000-000000000000',input:text,input_hash:digest(text),catalog:canonical(catalog,{maxBytes:4194304}),catalog_hash:catalog.snapshotHash};
  const options=[],sqlCalls=[];let active,projected=false,enabled=true,authCalls=0;
  const tx={
    async $executeRawUnsafe(sql){sqlCalls.push(sql);return 1;},
    async $queryRawUnsafe(sql){
      sqlCalls.push(sql);
      if(sql.includes('pg_roles'))return [{unsafe:false}];
      if(sql.includes('authenticate_machine')){
        authCalls++;
        if(projected&&projectionMs>active.timeout)throw Object.assign(Error('Transaction expired'),{code:'P2028'});
        return enabled?[{id:null,name:'Worker',role:'WORKER',access_version:null,now_at:new Date()}]:[];
      }
      if(sql.startsWith('SELECT j.*'))return [row];
      assert.match(sql,/variant_catalog_cache/);
      if(sql.includes('ANY('))projected=true;
      return [];
    },
  };
  const boundary=createMachineStaffBoundary({boundary:{transaction(){assert.fail('No human transaction');}},
    auth:{config:{mode:'TEST',origin:'https://fixture.invalid',deploymentId:'fixture',releaseSha:'fixture',configHash:'fixture',phoneByHash:new Map()}},
    manualClient:{$transaction:async(work,choice)=>{active=choice;options.push(choice);projected=false;return work(tx);}}});
  return {boundary,store:createVariantJobStore({boundary}),catalog,job,options,sqlCalls,get authCalls(){return authCalls;},disable(){enabled=false;}};
}

test('retained catalog projection beyond five seconds completes only with its scoped fifteen-second budget',async()=>{
  const f=fixture();
  await assert.rejects(f.boundary.machineTransaction(null,({tx})=>readRetainedVariantLabels(tx,f.catalog)),{code:'P2028'});
  const labels=await f.store.codexReadings(f.job);
  assert.equal(labels.catalogHash,f.catalog.snapshotHash);
  assert.deepEqual(labels.readings,[]);
  assert.deepEqual(f.options,[{maxWait:3000,timeout:5000},{maxWait:3000,timeout:15000}]);
  assert.equal(f.authCalls,4,'Both transaction attempts retain pre/post authorization');
  assert(f.sqlCalls.includes("SET LOCAL lock_timeout = '1500ms'"));
  assert(f.sqlCalls.includes("SET LOCAL statement_timeout = '3000ms'"));
  assert(f.sqlCalls.includes('SET CONSTRAINTS ALL IMMEDIATE'));
  assert(await f.store.renew(f.job));
  assert.deepEqual(f.options.at(-1),{maxWait:3000,timeout:5000},'Lease renewal keeps the ordinary limit');
});

test('catalog budget remains finite and does not permit disabled machine access',async()=>{
  const slow=fixture(16000);
  await assert.rejects(slow.store.codexReadings(slow.job),{code:'P2028'});
  const disabled=fixture();disabled.disable();
  await assert.rejects(disabled.store.codexReadings(disabled.job),{code:'MANUAL_MACHINE_ACCESS_REVOKED'});
  assert(!disabled.sqlCalls.some(sql=>sql.startsWith('SELECT j.*')));
});
