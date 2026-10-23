import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhysicalEvidenceController,renderPhysicalEvidence} from '../ui/physical-evidence.mjs';

const data=role=>({runtime:'AUTHENTICATED',proofsEnabled:true,shippingTrackingEnabled:role==='STAFF',scope:{role,actorId:role.toLowerCase()},csrfToken:'isolated_csrf',orders:[{orderId:'atlas_order'}]});
const proof={uploadId:'atlas_upload',proofId:'atlas_proof',orderId:'atlas_order',purpose:'RETURN_REQUEST',status:'RETAINED',reviewStatus:'NOT_REVIEWED'};
const saved={proofs:[proof],limits:{maxObjectBytes:10485760}};
function controller(t,{role='BUYER',post,readState}={}){
  let state=data(role);const calls=[],ui={apiPath:'/account/marketplace/api',proofOrders:{atlas_order:saved}},original={fetch:globalThis.fetch,FormData:globalThis.FormData};
  globalThis.FormData=class{constructor(form){this.values=new Map(Object.entries(form.values??{}));}get(key){return this.values.get(key);}has(key){return this.values.has(key);}};
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});return {ok:true,json:async()=>options.method==='POST'?(await post?.(url,options)??{}):saved};};
  t.after(()=>Object.assign(globalThis,original));
  const instance=createPhysicalEvidenceController({getData:()=>state,ui,apiPath:ui.apiPath,render(){},readState:async()=>{await readState?.();ui.uncertain=false;},requestId:key=>'request_'+Buffer.from(key).toString('hex').slice(0,40)});
  return {ui,calls,instance,get state(){return state;},set state(value){state=value;},submit:(kind,values,extra={})=>instance.submit({dataset:{form:kind,order:'atlas_order',...extra},values}),click:(action,extra={})=>instance.click({dataset:{action,order:'atlas_order',...extra}})};
}
const posts=f=>f.calls.filter(row=>row.options.method==='POST');
test('buyer/staff evidence views escape private references, separate review from returns and expose original recovery',()=>{
  const ui={apiPath:'/account/marketplace/api',proofOrders:{atlas_order:{...saved,proofs:[proof,{...proof,proofId:null,status:'VALIDATED'}]}}};
  let html=renderPhysicalEvidence(data('BUYER'),ui);assert.match(html,/data-form="proof-upload"/);assert.match(html,/data-action="use-return-proof"/);assert.match(html,/data-action="recover-proof"/);assert.doesNotMatch(html,/proof-review|shipping-retain|parcel-estimate/);
  html=renderPhysicalEvidence(data('STAFF'),ui);assert.match(html,/data-form="proof-review"/);assert.match(html,/data-form="shipping-retain"/);assert.match(html,/data-form="parcel-estimate"/);assert.match(html,/7.25 × 4.6875 × 2.5/);assert.doesNotMatch(html,/name="weightOunces"[^>]*value="[0-9]/);
  assert.equal(renderPhysicalEvidence(data('SELLER'),ui),'');assert.equal(renderPhysicalEvidence({...data('STAFF'),runtime:'LOCAL_DEMO'},ui),'');
  const bad={...saved,proofs:[{...proof,proofId:'<script>bad</script>',purpose:'<script>bad</script>'}]};html=renderPhysicalEvidence(data('STAFF'),{...ui,proofOrders:{atlas_order:bad}});assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});
test('an interrupted original upload is read back once, never re-uploaded; explicit recovery uses the original ID',async t=>{
  let uploadCalls=0;
  const f=controller(t,{post:async url=>{if(url.endsWith('/prepare'))return {...proof,status:'PREPARED',proofId:null};if(url.includes('/upload/')){uploadCalls++;throw new Error('connection interrupted');}return proof;}});
  const file=new File([new Uint8Array([137,80,78,71])],'original.png',{type:'image/png'});
  await f.submit('proof-upload',{photo:file,purpose:'RETURN_REQUEST'});
  assert.equal(uploadCalls,1);assert.equal(posts(f).length,2);assert.ok(f.calls.some(row=>row.url.endsWith('/proofs?orderId=atlas_order')));assert.match(f.ui.notice,/no upload or shipment was repeated/);
  const prepare=JSON.parse(posts(f)[0].options.body);assert.equal(prepare.byteCount,4);assert.match(prepare.sha256,/^[a-f0-9]{64}$/);assert.equal(prepare.actor,undefined);
  assert.equal(posts(f)[1].options.headers['Content-Type'],'application/octet-stream');assert.equal(posts(f)[1].options.headers['x-atlas-csrf'],'isolated_csrf');
  await f.click('recover-proof',{upload:'atlas_upload'});assert.equal(uploadCalls,1);assert.deepEqual(JSON.parse(posts(f).at(-1).options.body),{uploadId:'atlas_upload'});
});
test('a session change while reading a file prevents old-account upload and stale private data',async t=>{
  const f=controller(t);const file={type:'image/png',size:4,async arrayBuffer(){f.state={...data('BUYER'),scope:{role:'BUYER',actorId:'different'},csrfToken:'different_csrf'};return new Uint8Array([1,2,3,4]).buffer;}};
  await f.submit('proof-upload',{photo:file,purpose:'RETURN_REQUEST'});assert.equal(posts(f).length,0);assert.equal(f.ui.uncertain,true);assert.match(f.ui.notice,/session changed/);
});
test('staff parcel estimates and buyer proof selection are local state; staff mutations require explicit original records',async t=>{
  const f=controller(t,{role:'STAFF'});
  await f.submit('parcel-estimate',{presetId:'fedex_small_deep',weightOunces:'8'});assert.equal(posts(f).length,0);assert.equal(f.ui.parcelEstimates.atlas_order.status,'ESTIMATE_ONLY');assert.deepEqual(f.ui.parcelEstimates.atlas_order.parcel,{lengthInches:11.25,widthInches:8.75,heightInches:2.625,weightOunces:8});
  await f.submit('proof-review',{decision:'APPROVE',reviewRef:'review_ref'},{proof:'atlas_proof'});assert.equal(posts(f).length,0);
  await f.submit('proof-review',{decision:'APPROVE',reviewRef:'review_ref',reviewConfirmed:'on'},{proof:'atlas_proof'});assert.equal(posts(f).length,1);assert.equal(JSON.parse(posts(f)[0].options.body).proofId,'atlas_proof');
  await f.click('carrier-milestone',{step:'DELIVER'});assert.deepEqual(Object.keys(JSON.parse(posts(f).at(-1).options.body)).sort(),['action','orderId','requestId']);assert.equal(JSON.parse(posts(f).at(-1).options.body).deliveredAt,undefined);
  f.state=data('BUYER');await f.click('use-return-proof',{proof:'atlas_proof'});assert.equal(f.ui.returnProofs.atlas_order,'atlas_proof');assert.equal(posts(f).length,2);
});

test('externally issued shipments may omit their optional external shipment ID',async t=>{
  const f=controller(t,{role:'STAFF'});await f.submit('shipping-retain',{direction:'OUTBOUND',caseId:'',labelId:'se-label',shipmentId:'se-shipment',trackingNumber:'ORIGINAL',externalShipmentId:'',issuanceEvidenceRef:'issued',coverageEvidenceRef:'covered',measurementRef:'measured'});
  const value=JSON.parse(posts(f)[0].options.body);assert.equal(value.externalShipmentId,null);assert.equal(value.caseId,null);
});
