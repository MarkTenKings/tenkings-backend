import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedHostFixture,assertIsolatedHostFixture} from '../scripts/isolated-host-fixture.mjs';

test('disabled isolated fixture does not inspect dependency paths or create resources',async()=>{
  let inspected=false;const fixture=await createIsolatedHostFixture({get pgModulePath(){inspected=true;throw Error('must remain inert');}});
  assert.equal(inspected,false);assert.deepEqual(await fixture.snapshot(),{enabled:false,classification:'DISABLED'});
  assert.deepEqual(await fixture.close(),{stopped:true,created:false});assert.throws(()=>fixture.assertReady(),{code:'ISOLATED_FIXTURE_DISABLED'});
  assert.throws(()=>assertIsolatedHostFixture(fixture),{code:'ISOLATED_HOST_FIXTURE_REQUIRED'});
});
test('isolated fixture refuses unbranded copies, external resource injections and implicit dependencies',async()=>{
  assert.throws(()=>assertIsolatedHostFixture({enabled:true,host:{},assertReady:()=>true}),{code:'ISOLATED_HOST_FIXTURE_REQUIRED'});
  for(const key of ['pool','root','directory','provider','finance','host','environment','connectionString','port']){
    await assert.rejects(createIsolatedHostFixture({enabled:true,[key]:'must-not-be-used'}),{code:'ISOLATED_FIXTURE_OPTIONS_INVALID'});
  }
  for(const args of [{},{pgModulePath:'relative',postgresBin:'/absolute'},{pgModulePath:'/absolute',postgresBin:'relative'},{pgModulePath:'/absolute',postgresBin:'/absolute',now:-1}])await assert.rejects(createIsolatedHostFixture({enabled:true,...args}),{code:'ISOLATED_FIXTURE_INPUT_REQUIRED'});
});
