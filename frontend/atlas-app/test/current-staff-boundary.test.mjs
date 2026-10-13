import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/server/http.mjs';
import { STAFF_GRANTS, staffGrantSQL } from '../lib/server/access/privileges.mjs';
const response=()=>({statusCode:null,value:null,setHeader(){},status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;}});

test('retired staff routes cannot be re-enabled by supplying old runtime services',async()=>{
  const effect=()=>assert.fail('A retired route dispatched an effect');
  const state={assertRequest(){},auth:{authenticate:effect},review:{list:effect,read:effect,save:effect},grading:{run:effect},
    learning:{decide:effect},workspace:{list:effect},operations:{roster:effect},identityCorrection:{correct:effect}};
  const handler=createHandler(state);
  for(const [method,path] of [['GET','cards'],['GET','workspace'],['GET','operations/roster'],['POST','cards/11111111-1111-4111-8111-111111111111/grade'],['POST','cards/11111111-1111-4111-8111-111111111111/identity-correction']]){
    const res=response();await handler({method,url:'/api/staff/'+path,headers:{},socket:{}},res);
    assert.equal(res.statusCode,404);assert.equal(res.value.error,'NOT_FOUND');
  }
});
test('current manual proxy remains the sole grading dispatch ahead of the auth routes',async()=>{
  let calls=0;const handler=createHandler({assertRequest(){},auth:{},connectedManual:{async handler(req,res){calls++;assert.equal(req.url,'/api/staff/manual-connected/cards');res.status(200).json({current:true});return true;}}});
  const res=response();await handler({method:'GET',url:'/api/staff/manual-connected/cards',headers:{},socket:{}},res);
  assert.equal(calls,1);assert.deepEqual(res.value,{current:true});
});
test('current staff grant template grants only authentication and cannot target an injected role',()=>{
  assert.deepEqual(Object.keys(STAFF_GRANTS),['StaffControl','StaffIdentity','StaffBrowser','StaffChallenge','StaffSession','StaffRateBucket','StaffAudit']);
  const sql=staffGrantSQL('atlas_fixture_staff');assert.match(sql,/lock_control\(\)/);
  assert.doesNotMatch(sql,/StaffSpecimen|workspace|operator|correction|StaffOperationsGrant|public\./);
  assert.throws(()=>staffGrantSQL('bad";GRANT ALL TO PUBLIC;'),/Invalid staff role/);
});
