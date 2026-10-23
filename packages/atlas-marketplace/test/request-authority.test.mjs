import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,image,buyer,staff} from './proof-fixtures.mjs';
import {createMarketplacePilot} from '../src/service.mjs';
import {withMarketplaceRequestAuthority} from '../src/request-authority.mjs';

test('private proof operations refresh the request authority before any retained image publication',async t=>{
  const f=fixture(t),bytes=await image(),prepared=await f.prepare(bytes),service=createMarketplacePilot({enabled:true,environment:'SYNTHETIC_LOCAL',store:f.store,proofIntake:f.intake});let live=true,refreshes=0;
  await assert.rejects(withMarketplaceRequestAuthority(buyer,{authorizeCommit:()=>live,refreshAuthorization:async()=>{refreshes++;live=false;return false;}},()=>service.uploadProof(buyer,{uploadId:prepared.uploadId,bytes})),{code:'SIGN_IN_REQUIRED'});
  assert.equal(refreshes,1);assert.equal(Object.keys(f.store.read().marketplaceProofObjects??{}).length,0);
  const row=f.store.read().marketplaceProofUploads[prepared.uploadId];assert.equal(f.storage.get({objectKey:row.objectKey}),null);
});
test('request actor cannot change, and retained proof requirements survive a missing-port restart',async t=>{
  const f=fixture(t),bytes=await image();await f.retain(bytes);
  const service=createMarketplacePilot({enabled:true,environment:'SYNTHETIC_LOCAL',store:f.store,proofIntake:f.intake});
  await assert.rejects(withMarketplaceRequestAuthority(buyer,{authorizeCommit:()=>true},()=>service.listProofs(staff,{orderId:'demo_order'})),{code:'SIGN_IN_REQUIRED'});
  const missing=createMarketplacePilot({enabled:true,environment:'SYNTHETIC_LOCAL',store:f.store});
  await assert.rejects(missing.reviewReturn(staff,{requestId:'demo_restarted',orderId:'demo_order',caseId:'demo_return',decision:'APPROVE',reviewRef:'demo_self_attested'}),{code:'PROOF_INTAKE_UNAVAILABLE'});
});
