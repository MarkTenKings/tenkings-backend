import test from 'node:test';
import assert from 'node:assert/strict';
import {renderApp} from '../ui/view.mjs';
import {FIXTURE_NOW} from './listing-fixtures.mjs';

function workspace(role='STAFF') {
  return {schema:'atlas-marketplace-workspace-v1',runtime:'AUTHENTICATED',environment:'PROVIDER_SANDBOX',scope:{role,actorId:'fixture_actor'},csrfToken:'fixture_csrf',now:FIXTURE_NOW,listings:[],reservations:[],orders:[],intents:[],fulfillment:{},taxReporting:{available:true,orders:[
    {orderId:'order_missing',saleStatus:'MISSING',operationId:null,refunds:[]},
    {orderId:'order_prepared',saleStatus:'PREPARED',operationId:'op_prepared',refunds:[]},
    {orderId:'order_unknown',saleStatus:'UNKNOWN',operationId:'op_unknown',refunds:[]},
    {orderId:'order_paid',saleStatus:'SUCCEEDED',operationId:'op_paid',refunds:[{refundIntentId:'refund_one',taxCents:80,status:'MISSING',operationId:null},{refundIntentId:'refund_prepared',taxCents:10,status:'PREPARED',operationId:'op_refund_prepared'}]},
  ]}};
}

test('tax review is staff-only, escapes identifiers, keeps provider/private fields absent and never describes paid orders as failed',()=>{
  const data=workspace();data.taxReporting.orders[0].orderId='<script>order</script>';
  Object.assign(data.taxReporting.orders[0],{providerId:'tax_PRIVATE_PROVIDER_ID',rawResponse:'PRIVATE_RAW_RESPONSE',address:'PRIVATE_ADDRESS'});
  const html=renderApp(data);assert.match(html,/&lt;script&gt;order&lt;\/script&gt;/);assert.match(html,/These orders are already paid/);assert.match(html,/integer cents totaling exactly 80/);
  assert.match(html,/data-form="tax-resume" data-operation="op_refund_prepared"/);assert.match(html,/data-form="tax-reconcile" data-operation="op_unknown"/);
  assert.doesNotMatch(html,/PRIVATE_|<script>|payment failed/i);
  assert.match(html,/href="#tax-reporting"/);assert.doesNotMatch(html,/href="#sell"|href="#balance"|href="#delivery-addresses"/);
  for(const role of ['BUYER','SELLER']){data.scope.role=role;assert.doesNotMatch(renderApp(data),/tax-reporting|tax-refund|op_unknown|order_prepared/);}
  assert.match(renderApp(data),/href="#sell"/);assert.match(renderApp(data),/href="#balance"/);
  data.scope.role='BUYER';data.destinationsEnabled=true;assert.match(renderApp(data),/href="#delivery-addresses"/);assert.doesNotMatch(renderApp(data),/href="#sell"|href="#balance"/);
  data.scope.role='STAFF';data.taxReporting.available=false;
  assert.match(renderApp(data),/approved tax reporting service is unavailable/);
  const buttons=[...renderApp(data).slice(renderApp(data).indexOf('id="tax-reporting"')).matchAll(/<button[^>]+type="submit"[^>]*>/g)];assert.ok(buttons.length);assert.ok(buttons.every(([tag])=>tag.includes('disabled')));
});

let importCount=0;
async function boot(data,{failPost=false}={}) {
  const previous={document:globalThis.document,fetch:globalThis.fetch,FormData:globalThis.FormData,location:globalThis.location},listeners={},calls=[];
  const root={dataset:{apiPath:'/account/marketplace/api',mountPath:'/account/marketplace/'},innerHTML:'',addEventListener(type,fn){listeners[type]=fn;},querySelector(){return null;},querySelectorAll(){return [];}};
  globalThis.document={getElementById:()=>root,querySelector:()=>null};globalThis.location={pathname:'/account/marketplace/',search:'',origin:'https://fixture.invalid'};
  globalThis.FormData=class{constructor(form){this.values=new Map(Object.entries(form.values??{}));}get(key){return this.values.get(key);}has(key){return this.values.has(key);}};
  globalThis.fetch=async(url,options={})=>{calls.push({url,options});if(options.method==='POST'&&failPost)throw new Error('Synthetic response loss');return {ok:true,json:async()=>options.method==='POST'?{}:data};};
  try{await import(`../ui/app.mjs?tax=${++importCount}`);}catch(error){Object.assign(globalThis,previous);throw error;}
  return {root,calls,submit:async(dataset,values={})=>listeners.submit({preventDefault(){},target:{dataset,values}}),close(){Object.assign(globalThis,previous);}};
}
const posts=app=>app.calls.filter(call=>call.options.method==='POST');

test('staff tax forms send exact approved originals and reject invalid split, unprojected IDs, missing review and other roles',async()=>{
  const data=workspace(),app=await boot(data);
  try{
    assert.equal(posts(app).length,0);
    const dataset={form:'tax-refund',refund:'refund_one'},review={itemTaxCents:'80',shippingTaxCents:'0',reviewRef:'review_exact',reviewConfirmed:'on'};
    for(const change of [{itemTaxCents:'0.8'},{itemTaxCents:'-1'},{itemTaxCents:'79'},{itemTaxCents:'9007199254740992'},{reviewRef:''},{reviewConfirmed:undefined}]){
      const values={...review,...change};if(values.reviewConfirmed===undefined)delete values.reviewConfirmed;await app.submit(dataset,values);
    }
    await app.submit({form:'tax-sale',order:'unprojected_order'});assert.equal(posts(app).length,0);
    await app.submit(dataset,review);
    let request=posts(app).at(-1);assert.equal(request.url,'/account/marketplace/api/staff/tax/refund');assert.deepEqual(JSON.parse(request.options.body),{refundIntentId:'refund_one',itemTaxCents:80,shippingTaxCents:0,reviewRef:'review_exact'});assert.equal(request.options.headers['x-atlas-csrf'],'fixture_csrf');
    await app.submit({form:'tax-sale',order:'order_missing'});assert.deepEqual(JSON.parse(posts(app).at(-1).options.body),{orderId:'order_missing'});
    await app.submit({form:'tax-resume',operation:'op_refund_prepared'});assert.equal(posts(app).at(-1).url,'/account/marketplace/api/staff/tax/resume');assert.deepEqual(JSON.parse(posts(app).at(-1).options.body),{operationId:'op_refund_prepared'});
    const count=posts(app).length;await app.submit({form:'tax-resume',operation:'op_unknown'});await app.submit({form:'tax-reconcile',operation:'op_prepared'});await app.submit({form:'tax-reconcile',operation:'unprojected'});assert.equal(posts(app).length,count);
    for(const values of [{providerId:'tax_ORIGINAL'},{providerId:'https://other.invalid'},{reviewRef:'review_only'}])await app.submit({form:'tax-reconcile',operation:'op_unknown'},values);
    assert.equal(posts(app).length,count);
    await app.submit({form:'tax-reconcile',operation:'op_unknown'});assert.deepEqual(JSON.parse(posts(app).at(-1).options.body),{operationId:'op_unknown'});
    await app.submit({form:'tax-reconcile',operation:'op_unknown'},{providerId:'tax_ORIGINAL',reviewRef:'review_original'});assert.deepEqual(JSON.parse(posts(app).at(-1).options.body),{operationId:'op_unknown',providerId:'tax_ORIGINAL',reviewRef:'review_original'});
    const finalCount=posts(app).length;data.scope.role='BUYER';await app.submit(dataset,review);data.scope.role='SELLER';await app.submit({form:'tax-sale',order:'order_missing'});assert.equal(posts(app).length,finalCount);
  }finally{app.close();}
});

test('lost tax response only refreshes workspace; it never automatically repeats the original write',async()=>{
  const app=await boot(workspace(),{failPost:true});
  try{await app.submit({form:'tax-sale',order:'order_missing'});assert.equal(posts(app).length,1);assert.equal(app.calls.filter(call=>!call.options.method).length,2);assert.match(app.root.innerHTML,/response was interrupted/);assert.doesNotMatch(app.root.innerHTML,/payment failed/i);}finally{app.close();}
});
