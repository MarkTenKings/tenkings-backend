import test from 'node:test';
import assert from 'node:assert/strict';
import { createMachineStaffBoundary } from '../src/machine-auth.mjs';

const ownerId='10000000-0000-4000-8000-000000000001';
function fixture(){
  let enabled=true, version=7, unsafe=false, humanCalls=0;
  const calls=[];
  const config={mode:'TEST',origin:'https://atlas.example',deploymentId:'deployment',releaseSha:'release',configHash:'config',phoneByHash:new Map([['phone-hash','not-exposed']])};
  const tx={async $executeRawUnsafe(sql){calls.push(sql);return 1;},async $queryRawUnsafe(sql,...args){
    calls.push(sql);
    if(sql.includes('pg_roles'))return[{unsafe}];
    assert.match(sql,/authenticate_machine/);
    assert.deepEqual(JSON.parse(args[2]),{mode:config.mode,origin:config.origin,deploymentId:config.deploymentId,releaseSha:config.releaseSha,configHash:config.configHash});
    assert.deepEqual(args[3],['phone-hash']);
    if(!enabled || args[0]!==null && (args[0]!==ownerId || args[1]!==version))return[];
    return[{id:args[0],name:'Owner',role:args[0]?'REVIEWER':'WORKER',access_version:args[0]?version:null,now_at:new Date()}];
  }};
  const boundary=createMachineStaffBoundary({auth:{config},manualClient:{$transaction:async work=>work(tx)},
    boundary:{transaction:async(staff,work)=>{humanCalls++;assert.equal(staff,'human');return work({principal:{id:'human'}});}}});
  return{boundary,calls,get humanCalls(){return humanCalls;},disable(){enabled=false;},revoke(){version++;},unsafe(){unsafe=true;}};
}
test('saved owner authority survives a new process without a browser session and cannot certify',async()=>{
  for(let process=0;process<2;process++){
    const f=fixture(),staff=f.boundary.machineOwner({ownerId,accessVersion:7});
    await f.boundary.transaction(staff,async({principal,refresh})=>{
      assert.equal(principal.id,ownerId);assert.equal(principal.actorKind,'MACHINE');assert.equal(principal.canCertify,false);
      assert.equal((await refresh()).principal.accessVersion,7);
    });
    assert.equal(f.humanCalls,0);assert(!f.calls.some(sql=>sql.includes('StaffSession')));
    await assert.rejects(f.boundary.machineTransaction({...staff},()=>{}),{code:'MANUAL_MACHINE_AUTH_REQUIRED'});
  }
});
test('owner revocation and release disablement fence admitted continuation',async()=>{
  const f=fixture(),staff=f.boundary.machineOwner({ownerId,accessVersion:7});
  f.revoke();await assert.rejects(f.boundary.transaction(staff,()=>assert.fail()),{code:'MANUAL_MACHINE_ACCESS_REVOKED'});
  f.disable();await assert.rejects(f.boundary.machineTransaction(null,()=>assert.fail()),{code:'MANUAL_MACHINE_ACCESS_REVOKED'});
});
test('queue discovery has no owner authority; ordinary human requests keep existing boundary',async()=>{
  const f=fixture();
  await f.boundary.machineTransaction(null,({principal})=>{assert.equal(principal.id,null);assert.equal(principal.role,'WORKER');assert.equal(principal.canCertify,false);});
  assert.equal(await f.boundary.transaction('human',({principal})=>principal.id),'human');assert.equal(f.humanCalls,1);
});
test('unsafe DB role refused before work and final authorization rechecked',async()=>{
  const f=fixture(),staff=f.boundary.machineOwner({ownerId,accessVersion:7});
  await assert.rejects(f.boundary.transaction(staff,()=>{f.disable();}),{code:'MANUAL_MACHINE_ACCESS_REVOKED'});
  const g=fixture();g.unsafe();await assert.rejects(g.boundary.machineTransaction(null,()=>assert.fail()),{code:'MANUAL_DATABASE_ROLE_INVALID'});
});
