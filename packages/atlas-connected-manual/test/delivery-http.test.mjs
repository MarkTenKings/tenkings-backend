import test from 'node:test';import assert from 'node:assert/strict';
import {createConnectedHandler} from '../src/http.mjs';
const cardId='00000000-0000-4000-8000-000000000001',origin='https://staff.invalid';
function setup(){const calls=[];const boundary={async authenticate(cookie,csrf){calls.push(['auth',cookie,csrf]);return {owner:true};}};
 const handler=createConnectedHandler({boundary,origin,assertRequest:async()=>{},connected:{workflow:{},intake:{},
  async thumbnails(staff,id){calls.push(['thumbnail',staff,id]);return{cardId:id,sourceHash:'a'.repeat(64),images:{FRONT:{state:'PENDING'},BACK:{state:'PENDING'}}};},
  reviewDisplay:{async retry(staff,id,body){calls.push(['retry',staff,id,body]);return{state:'QUEUED',jobId:body.jobId};}}}});
 return {calls,async request(path,method='GET',body,headers={}){const response={setHeader(){},status(code){this.statusCode=code;return this;},json(value){this.body=value;}};
  await handler({url:`/api/staff/manual-connected/cards/${cardId}/${path}`,method,body,headers:{cookie:'session',origin,'content-type':'application/json','x-atlas-csrf':'csrf',...headers}},response);return response;}};
}
test('thumbnail HTTP route is authenticated, read-only and returns explicit pending descriptors',async()=>{
 const f=setup();const r=await f.request('thumbnail');assert.equal(r.statusCode,200);assert.equal(r.body.images.FRONT.state,'PENDING');
 assert.deepEqual(f.calls[0],['auth','session',undefined]);assert.equal((await f.request('thumbnail','POST',{})).statusCode,405);
 assert.equal((await f.request('thumbnail/FRONT')).statusCode,404);assert.equal((await f.request('thumbnail?mode=full')).statusCode,404);
 assert.equal(f.calls.filter(x=>x[0]==='thumbnail').length,1);
});
test('retired raw display retry route is not executable',async()=>{
 const f=setup();assert.equal((await f.request('display-retry','POST',{})).statusCode,404);
 assert.equal(f.calls.length,0);
});
