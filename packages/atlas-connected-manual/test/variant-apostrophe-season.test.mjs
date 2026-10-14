import test from 'node:test';
import assert from 'node:assert/strict';
import {createManufacturerChecklistVariantProvider} from '../../card-catalog-evidence/src/manufacturer-checklist.mjs';
import {variantCodexChoice} from '../src/variant-codex.mjs';
import {variantChecklistListingIdentity,variantChecklistListingYears,prepareVariantListingRequest} from '../src/variant-listing-provider.mjs';
import {createVariantJobStore} from '../src/variant-job-store.mjs';
const identity={category:'SPORTS',manufacturer:'Fleer',name:'Michael Jordan',setName:'Fleer Ultra',cardNumber:'216',year:"'92-93",language:null};
test('actual Card14 literal shares source-backed Codex and ordinary request identity with canonical season',async()=>{
 const p=createManufacturerChecklistVariantProvider(),quoted=(await p.prepare(identity)).candidates[0],plain=(await p.prepare({...identity,year:'1992-93'})).candidates[0];
 assert.equal(variantCodexChoice(quoted).key,variantCodexChoice(plain).key);assert.deepEqual(quoted.source,plain.source);assert.notEqual(quoted.candidateId,plain.candidateId);
 const years=variantChecklistListingYears(identity,quoted);assert.equal(years[0],'1992-93');assert(years.includes("'92-93"));
 const request=prepareVariantListingRequest(variantChecklistListingIdentity(identity,[quoted],years[0]),{name:quoted.label,language:null});
 assert.deepEqual(request,prepareVariantListingRequest(variantChecklistListingIdentity(plain.identity,[plain],years[0]),{name:plain.label,language:null}));
 assert.throws(()=>variantChecklistListingIdentity(identity,[quoted],"'92-93"),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
 assert.equal(variantChecklistListingIdentity(identity,[quoted],"'92-93",{retainedOnly:true}).year,"'92-93");
});
test('real store revalidates quoted source season before SQL and permits historical literal only for retained probes',async()=>{
 const sentinel=Error('NO_SQL_BOUNDARY');let calls=0;
 const store=createVariantJobStore({boundary:{machineTransaction:()=>{calls++;throw sentinel;}}}),job={input:{identity,reuseJobKey:null}};
 const ordinary=prepareVariantListingRequest({...identity,year:'1992-93'},{name:'Jam Session',language:null});
 await assert.rejects(store.reserveListingSource(job,ordinary,{retainedOnly:true}),e=>e===sentinel);assert.equal(calls,1);
 const literal=prepareVariantListingRequest(identity,{name:'Jam Session',language:null});
 await assert.rejects(store.reserveListingSource(job,literal),{code:'VARIANT_LISTING_REQUEST_CHANGED'});assert.equal(calls,1);
 await assert.rejects(store.reserveListingSource(job,literal,{retainedOnly:true}),e=>e===sentinel);assert.equal(calls,2);
 for(const year of ['1993-94','2092-93'])await assert.rejects(store.reserveListingSource(job,prepareVariantListingRequest({...identity,year},ordinary.printing),{retainedOnly:true}),{code:'VARIANT_LISTING_REQUEST_CHANGED'});
 assert.equal(calls,2);assert.equal(identity.year,"'92-93");
});
