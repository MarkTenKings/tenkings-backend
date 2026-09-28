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
test('display retry HTTP requires same-origin POST, CSRF and authenticated source-scoped command',async()=>{
 const f=setup(),body={side:'FRONT',photoSourceHash:'a'.repeat(64),jobId:cardId,actionId:cardId};
 assert.equal((await f.request('display-retry','GET')).statusCode,405);
 assert.equal((await f.request('display-retry','POST',body,{origin:'https://other.invalid'})).statusCode,403);
 assert.equal((await f.request('display-retry','POST',body,{'x-atlas-csrf':undefined})).statusCode,403);
 const r=await f.request('display-retry','POST',body);assert.equal(r.statusCode,200);
 assert.deepEqual(f.calls.at(-1),['retry',{owner:true},cardId,body]);assert.equal(f.calls.filter(x=>x[0]==='retry').length,1);
});
