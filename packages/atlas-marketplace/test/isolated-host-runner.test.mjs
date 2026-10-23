import test from 'node:test';
import assert from 'node:assert/strict';
import {startIsolatedHostRunner} from '../scripts/isolated-host-runner.mjs';

test('isolated listener runner is inert unless explicitly enabled',async()=>{
  let touched=false;const options={get fixture(){touched=true;throw Error('must not touch fixture');}};
  await assert.rejects(startIsolatedHostRunner(options),{code:'ISOLATED_HOST_DISABLED'});assert.equal(touched,false);
});
test('isolated listener runner refuses unbranded host inputs and extra injection ports',async()=>{
  await assert.rejects(startIsolatedHostRunner({enabled:true,fixture:{host:{enabled:true},finance:{enabled:true}}}),{code:'ISOLATED_HOST_FIXTURE_REQUIRED'});
  for(const key of ['host','finance','existingHandlers','provider','port','clock'])await assert.rejects(startIsolatedHostRunner({enabled:true,fixture:{},[key]:{}}),{code:'ISOLATED_HOST_OPTIONS_INVALID'});
});
test('isolated listener runner rejects unbounded or inconsistent resource limits before acquiring a fixture',async()=>{
  for(const limits of [{maxLifetimeMs:0},{maxLifetimeMs:60001},{maxRequests:257},{maxConcurrent:9},{maxHeaderBytes:1},{maxHeaders:100},{maxQueryFields:33},{maxBodyBytes:16385},{maxConnections:0},{shutdownTimeoutMs:10001},{requestTimeoutMs:50,headersTimeoutMs:100},{maxConcurrent:8,maxConnections:1},{unknown:1}])await assert.rejects(startIsolatedHostRunner({enabled:true,fixture:{},limits}),{code:'ISOLATED_HOST_LIMITS_INVALID'});
});
