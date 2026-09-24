import test from 'node:test';
import assert from 'node:assert/strict';
import {DealerOperations} from '../src/service.mjs';
import {selectLocations,scheduleText,locationTime} from '../src/directory.mjs';
const locations=[{id:'north',name:'North',address:{city:'Sacramento',postalCode:'95814'},position:{lat:38.58,lng:-121.49}},{id:'south',name:'South',address:{city:'Los Angeles',postalCode:'90001'},position:{lat:34.05,lng:-118.24}}];
test('directory search uses real address and optional coordinates; denied location can use text',()=>{
 assert.deepEqual(selectLocations(locations,{query:'95814'}).map(x=>x.id),['north']);
 assert.deepEqual(selectLocations(locations,{lat:34,lng:-118}).map(x=>x.id),['south','north']);
 assert(selectLocations(locations,{lat:91,lng:0}).every(x=>x.distanceMiles===null));
 assert(selectLocations(locations).every(x=>x.distanceMiles===null));
 assert.equal(selectLocations([],{}).length,0);
});
test('dealer session is independently issued and never passes a caller account to reads',async()=>{
 const calls=[];const service=new DealerOperations({sessionKey:'s'.repeat(32),call:async(action,input)=>{calls.push([action,input]);return {location:{id:'owned'}};}});
 const a=await service.enter({sessionHash:'a'.repeat(64),browserHash:'b'.repeat(64)},'owned');
 assert.match(a.sessionToken,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(a.sessionToken,'a'.repeat(64));
 await service.read(a.sessionToken,'b'.repeat(64));
 assert.deepEqual(Object.keys(calls[1][1]).sort(),['browserHash','dealerSessionHash']);
 assert.equal(calls[0][1].dealerSessionHash,calls[1][1].dealerSessionHash);
 assert.throws(()=>service.logout(a.sessionToken,'b'.repeat(64),'customer-csrf'),/CSRF_REQUIRED/);
 await service.logout(a.sessionToken,'b'.repeat(64),a.csrf);assert.equal(calls[2][0],'dealer_logout');
});
test('dealer read rejects customer hash in place of opaque dealer session before SQL',()=>{
 const service=new DealerOperations({sessionKey:'s'.repeat(32),call:()=>assert.fail('must not dispatch')});
 assert.throws(()=>service.read('a'.repeat(64),'b'.repeat(64)),/DEALER_SIGN_IN_REQUIRED/);
});
test('directory entry is passed as server resolution input, with local search applied afterward',async()=>{
 const service=new DealerOperations({sessionKey:'s'.repeat(32),call:async(action,data)=>{assert.equal(action,'dealer_locations');assert.deepEqual(data,{entry:'configured-entry'});return {locations,resolvedLocationId:'north'};}});
 const result=await service.locations({entry:'configured-entry',query:'Sacramento'});assert.equal(result.resolvedLocationId,'north');assert.equal(result.locations.length,1);
});
test('schedule display identifies timezone and strict cutoff instead of fabricating dates',()=>{
 assert.deepEqual(scheduleText({timeZone:'America/Los_Angeles',pickups:[{weekday:3,time:'10:00',cutoff:'09:00'}],returns:[{weekday:3,time:'10:00'}]}),{timeZone:'America/Los_Angeles',pickups:'Wednesday 10:00 (cutoff 09:00)',returns:'Wednesday 10:00'});
 assert.match(locationTime('2026-09-30T17:00:00Z','America/Los_Angeles'),/10:00/);
 assert.equal(locationTime(null,'America/Los_Angeles'),'Schedule unavailable');
});
