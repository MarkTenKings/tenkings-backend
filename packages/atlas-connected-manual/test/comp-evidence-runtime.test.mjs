import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeCompCurationRuntime } from '../src/comp-curation-runtime.mjs';
import { nativeCompRuntimeFixture as fixture, deferred } from './fixtures/comp-curation-runtime-fixture.mjs';
const policy = {version:'atlas-comp-evidence-selection-policy-v1',status:'LOCAL_PROPOSAL',method:'private-saved-sold-evidence-v1',recencyDays:null,rightsStatus:'UNRESOLVED'};

test('explicit candidate opt-in crosses signed private transport and preserves evidence-only archive read/selection/replay', async t => {
  const f = await fixture({evidenceSelection:true,archiveCompAccess:true}); t.after(()=>f.runtime.close());
  const read = await f.request(); assert.equal(read.statusCode,200); assert.deepEqual(read.body.result.policy,policy);
  const input = f.input({expectedPolicyHash:read.body.result.policyHash}), saved = await f.request(input);
  assert.equal(saved.statusCode,200); assert.equal(saved.body.result.guidance,null); assert.equal(saved.body.result.selected.length,3);
  assert.deepEqual((await f.request(input)).body,saved.body); assert.equal(f.rows.length,1);
  f.card.readers=[]; assert.equal((await f.request(input)).statusCode,404); assert.equal(f.rows.length,1);
});

test('candidate and deployed schemas cannot be auto-adopted by the opposite runtime option', async () => {
  for (const candidate of [false,true]) {
    const f = await fixture({evidenceSelection:candidate,runtimeFactory(options) {
      if(candidate) { delete options.settings.guardVersion; delete options.settings.selectionPolicy; }
      else Object.assign(options.settings,{guardVersion:'EVIDENCE_SELECTION_V1',selectionPolicy:policy});
      return createNativeCompCurationRuntime(options);
    }});
    try { assert.equal((await f.request()).statusCode,503); assert.equal(f.rows.length,0); }
    finally { await f.runtime.close(); }
  }
});

test('selection policy requires explicit candidate contract and never accepts pricing or malformed archive settings', async t => {
  const f = await fixture(); t.after(()=>f.runtime.close());
  for(const extra of [{selectionPolicy:policy},{guardVersion:'unknown'}, {guardVersion:null}, {archiveCompAccess:'true'},
    {designationReviewsEnabled:true},{designationReviewsEnabled:'true'},
    {guardVersion:'EVIDENCE_SELECTION_V1',selectionPolicy:policy,designationReviewsEnabled:true},
    {guardVersion:'EVIDENCE_SELECTION_V1',selectionPolicy:{...policy,recencyDays:90}},
    {guardVersion:'EVIDENCE_SELECTION_V1',selectionPolicy:{...policy,rightsStatus:'APPROVED'}}]) {
    const options = {...f.options,settings:{...f.options.settings,...extra}};
    assert.throws(()=>createNativeCompCurationRuntime(options));
  }
  assert.equal(f.counts.create,0); assert.equal(f.counts.auth,0);
});

test('captured candidate options and policy bytes cannot change during artifact work', async () => {
  for(const mutate of [f=>{f.options.settings.guardVersion='SQL011';},f=>{f.options.settings.archiveCompAccess=false;},
    f=>{f.options.settings.selectionPolicy.recencyDays=90;},f=>{f.options.settings.designationReviewsEnabled=true;}]) {
    const f=await fixture({evidenceSelection:true,archiveCompAccess:true}), entered=deferred(),resume=deferred();
    f.hooks.artifact=async()=>{entered.resolve();await resume.promise;};
    const pending=f.request();await entered.promise;mutate(f);resume.resolve();
    assert.equal((await pending).statusCode,503);assert.equal(f.rows.length,0);await f.runtime.close();assert.equal(f.counts.disconnect,1);
  }
});
