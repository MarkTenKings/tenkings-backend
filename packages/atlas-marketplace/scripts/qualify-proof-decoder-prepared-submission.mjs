// Operator-only. Real native observer required; no fixture peer or brand mint.
import assert from 'node:assert/strict';
import {constants,openSync,closeSync,fstatSync,lstatSync,realpathSync,readSync} from 'node:fs';
import {dirname,isAbsolute,normalize} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createProofDecoderLinuxObserver} from '../src/proof-decoder-linux-observer.mjs';
import {createProofDecoderTargetBrokerClient} from '../src/proof-decoder-target-broker.mjs';

function boundedFile(path,limit){
  assert.equal(typeof path,'string');assert.ok(isAbsolute(path));assert.equal(normalize(path),path);assert.equal(realpathSync(path),path);
  for(let dir=dirname(path);;dir=dirname(dir)){const st=lstatSync(dir);assert.ok(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&(st.mode&0o022)===0);if(dir==='/')break;}
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);let bytes;
  try{
    const before=fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&(before.mode&0o022n)===0n&&before.size>0n&&before.size<=BigInt(limit));
    bytes=Buffer.alloc(Number(before.size)+1);let used=0;
    while(used<bytes.length){const count=readSync(fd,bytes,used,bytes.length-used,null);if(!count)break;used+=count;}
    const after=fstatSync(fd,{bigint:true});assert.equal(BigInt(used),before.size);for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','uid','gid','nlink'])assert.equal(after[key],before[key]);return bytes.subarray(0,used);
  }catch(cause){bytes?.fill(0);throw cause;}finally{closeSync(fd);}
}
const emit=value=>process.stdout.write(JSON.stringify({classification:'UNQUALIFIED',...value})+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
async function rejected(promise){try{await promise;}catch(cause){return cause;}throw new Error('EXPECTED_REJECTION');}
function caught(action){try{action();}catch(cause){return cause;}throw new Error('EXPECTED_THROW');}
function disposition(client,value,expected,report){const observed=client.lookupDisposition(value);assert.equal(observed.disposition,expected);assert.equal(observed.request,report);assert.equal(observed.classification,'UNQUALIFIED');assert.equal(observed.executionAllowed,false);assert.equal(observed.freshPublicationAllowed,false);assert.ok(Object.isFrozen(observed));return observed;}
function command(expected,deadline,observer){
  return new Promise((resolve,reject)=>{
    let used=0,done=false;const expectedBytes=Buffer.from(expected),timer=setInterval(()=>{try{assert.ok(observer.boottimeNanoseconds()<deadline);}catch(cause){finish(cause);}},10);
    function finish(cause){if(done)return;done=true;clearInterval(timer);process.stdin.off('data',data);process.stdin.off('end',end);process.stdin.off('error',finish);process.stdin.pause();cause?reject(cause):resolve();}
    function data(bytes){try{assert.ok(used+bytes.length<=expectedBytes.length);assert.ok(bytes.equals(expectedBytes.subarray(used,used+bytes.length)));used+=bytes.length;if(used===expectedBytes.length)finish();}catch(cause){finish(cause);}}
    function end(){finish(new Error('OPERATOR_EOF'));}
    process.stdin.on('data',data);process.stdin.once('end',end);process.stdin.once('error',finish);process.stdin.resume();
  });
}
assert.equal(process.argv.length,3);assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert.equal(process.versions.node,'22.16.0');
const raw=boundedFile(process.argv[2],131072);let config;try{config=JSON.parse(raw);}finally{raw.fill(0);}
assert.deepEqual(Object.keys(config).sort(),['mode','plan','addonPath','addonSha256','expectedBootId','expectedEpoch','expectedBindingHash','originalPath','expectedOutcome'].sort());
assert.ok(['handles','before-start','unknown','complete','cancel','close-active'].includes(config.mode));
const {plan,addonPath,addonSha256,expectedBootId,expectedEpoch,expectedBindingHash}=config;
assert.equal(process.getuid(),plan.profile.ipc.clientUid);assert.equal(process.geteuid(),plan.profile.ipc.clientUid);assert.equal(process.getgid(),plan.profile.ipc.clientGid);assert.equal(process.getegid(),plan.profile.ipc.clientGid);assert.ok(process.getgroups().every(gid=>gid===plan.profile.ipc.clientGid));
const observer=createProofDecoderLinuxObserver({enabled:true,addonPath,addonSha256}),clients=[];
function factory(){const client=createProofDecoderTargetBrokerClient({enabled:true,plan,observer,expectedBootId,expectedEpoch,expectedBindingHash});clients.push(client);return client;}
let original;
try{
  if(config.mode==='handles'){
    assert.equal(config.originalPath,null);assert.equal(config.expectedOutcome,null);
    original=Buffer.from('operator-only prepared handle; never submitted');const sourcePlan={byteCount:original.length,sha256:sha(original),declaredType:'image/png'},client=factory(),other=factory();
    const handle=client.prepareRequest({bytes:original,plan:sourcePlan}),saved=clone(handle.report);
    assert.deepEqual(Object.keys(handle),['report']);assert.ok(Object.isFrozen(handle)&&Object.isFrozen(handle.report)&&Object.isFrozen(handle.report.plan));
    original.fill(0);sourcePlan.sha256='f'.repeat(64);assert.deepEqual(handle.report,saved);assert.equal(client.status().prepared,1);assert.equal(client.status().active,0);assert.equal(client.status().occupiedSlots,1);
    const capacity=caught(()=>client.prepareRequest({bytes:original,plan:sourcePlan}));disposition(client,capacity,'KNOWN_NO_START_SENT',null);assert.equal(client.status().requests,1);
    for(const owner of [client,other]){
      const forged=await rejected(owner.submitPrepared(clone(handle)));assert.throws(()=>owner.lookupDisposition(forged));assert.throws(()=>owner.lookupDisposition(handle.report));
    }
    const foreign=await rejected(other.submitPrepared(handle));assert.throws(()=>other.lookupDisposition(foreign));
    const discarded=client.discardPrepared(handle);disposition(client,discarded,'KNOWN_NO_START_SENT',handle.report);assert.throws(()=>other.lookupDisposition(discarded));assert.throws(()=>client.lookupDisposition(clone(discarded)));assert.equal(client.status().retainedOriginalBytes,0);assert.equal(client.status().occupiedSlots,0);
    const replay=await rejected(client.submitPrepared(handle));assert.throws(()=>client.lookupDisposition(replay));assert.throws(()=>client.discardPrepared(handle));emit({event:'CASE',name:'snapshot-capacity-ownership-single-use',passed:true});
    const bytes=Buffer.from('abort and expiry operators never send START'),requestPlan={byteCount:bytes.length,sha256:sha(bytes),declaredType:'image/png'};
    try{
      let getters=0;const invalid=caught(()=>client.prepareRequest({get bytes(){getters++;return bytes;},plan:requestPlan}));assert.equal(getters,0);disposition(client,invalid,'KNOWN_NO_START_SENT',null);
      for(const extra of [{requestId:handle.report.requestId},{deadlineBootNs:handle.report.deadlineBootNs},{qualified:true}])disposition(client,caught(()=>client.prepareRequest({bytes,plan:requestPlan,...extra})),'KNOWN_NO_START_SENT',null);
      const injected=new Error('caller supplied');const proxy=new Proxy({}, {getPrototypeOf(){throw injected;}}),isolated=caught(()=>client.prepareRequest(proxy));assert.notEqual(isolated,injected);assert.throws(()=>client.lookupDisposition(injected));disposition(client,isolated,'KNOWN_NO_START_SENT',null);
      let nested;const reentrant=new Proxy({bytes,plan:requestPlan},{getPrototypeOf(target){nested=caught(()=>client.prepareRequest({bytes,plan:requestPlan}));return Object.getPrototypeOf(target);}});
      const exclusive=client.prepareRequest(reentrant);disposition(client,nested,'KNOWN_NO_START_SENT',null);assert.equal(client.status().occupiedSlots,1);client.discardPrepared(exclusive);
      const closingClient=factory(),closingOptions=new Proxy({bytes,plan:requestPlan},{getPrototypeOf(target){void closingClient.close();return Object.getPrototypeOf(target);}});
      disposition(closingClient,caught(()=>closingClient.prepareRequest(closingOptions)),'KNOWN_NO_START_SENT',null);assert.equal(closingClient.status().retainedOriginalBytes,0);
      emit({event:'CASE',name:'closed-options-no-caller-identities',passed:true});
      const aborter=new AbortController(),cancelled=client.prepareRequest({bytes,plan:requestPlan,signal:aborter.signal});aborter.abort();assert.equal(client.status().retainedOriginalBytes,0);
      const cancellation=await rejected(client.submitPrepared(cancelled));disposition(client,cancellation,'KNOWN_NO_START_SENT',cancelled.report);cancellation.code='DECODER_BROKER_UNCERTAIN';disposition(client,cancellation,'KNOWN_NO_START_SENT',cancelled.report);assert.equal(client.status().quarantined,false);
      disposition(client,caught(()=>client.prepareRequest({bytes,plan:requestPlan,signal:aborter.signal})),'KNOWN_NO_START_SENT',null);emit({event:'CASE',name:'abort-before-submission-private-not-error-text',passed:true});
      const closeClient=factory(),closing=closeClient.prepareRequest({bytes,plan:requestPlan});await closeClient.close();assert.equal(closeClient.status().retainedOriginalBytes,0);disposition(closeClient,await rejected(closeClient.submitPrepared(closing)),'KNOWN_NO_START_SENT',closing.report);emit({event:'CASE',name:'close-wipes-prepared',passed:true});
      const expiring=client.prepareRequest({bytes,plan:requestPlan}),deadline=BigInt(expiring.report.deadlineBootNs);
      while(observer.boottimeNanoseconds()<deadline+100000000n)await delay(10);
      assert.equal(client.status().prepared,0);assert.equal(client.status().retainedOriginalBytes,0);const expired=await rejected(client.submitPrepared(expiring));disposition(client,expired,'KNOWN_NO_START_SENT',expiring.report);assert.equal(expiring.report.deadlineBootNs,String(deadline));assert.equal(client.status().quarantined,false);emit({event:'CASE',name:'real-boottime-expiry-wipes-without-renewal',passed:true});
    }finally{bytes.fill(0);}
    emit({event:'RESULT',mode:config.mode,cases:5,client:client.status(),note:'No socket method invoked; private-byte wiping checked by retained-byte accounting and source review.'});
  }else{
    assert.ok(config.mode==='complete'?['SUCCESS','INVALID_IMAGE'].includes(config.expectedOutcome):config.expectedOutcome===null);
    original=boundedFile(config.originalPath,plan.profile.limits.maxObjectBytes);const sourcePlan={byteCount:original.length,sha256:sha(original),declaredType:'image/png'},client=factory(),aborter=new AbortController();
    const handle=client.prepareRequest({bytes:original,plan:sourcePlan,signal:aborter.signal}),deadline=BigInt(handle.report.deadlineBootNs);
    original.fill(0);sourcePlan.sha256='0'.repeat(64);emit({event:'PREPARED',report:handle.report,client:client.status()});
    await command('SUBMIT\n',deadline,observer);
    const pending=client.submitPrepared(handle).then(result=>({result}),cause=>({cause}));emit({event:'SUBMITTED',requestId:handle.report.requestId});
    let observed;
    if(['cancel','close-active'].includes(config.mode)){
      // Root sends this only after independently observing the exact real START.
      const control=command(config.mode==='cancel'?'CANCEL\n':'CLOSE\n',deadline,observer).then(()=>({command:true}));
      const first=await Promise.race([pending,control]);assert.equal(first.command,true,'operation finished before the operator exercised the requested boundary');
      if(config.mode==='cancel')aborter.abort();else await client.close();observed=await pending;
    }else observed=await pending;
    if(config.mode==='complete'){
      assert.ok(observed.result);assert.equal(observed.result.outcome,config.expectedOutcome);assert.equal(observed.result.requestId,handle.report.requestId);assert.equal(observed.result.executionAllowed,false);assert.equal(observed.result.freshPublicationAllowed,false);
      if(config.expectedOutcome==='SUCCESS')assert.equal(observed.result.validation.sha256,handle.report.plan.sha256);
      disposition(client,observed.result,'COMPLETE_CLEAN',handle.report);assert.equal(client.status().quarantined,false);
    }else{assert.ok(observed.cause);disposition(client,observed.cause,config.mode==='before-start'?'KNOWN_NO_START_SENT':'UNKNOWN',handle.report);assert.equal(client.status().quarantined,config.mode!=='before-start');}
    const value=observed.result??observed.cause;assert.throws(()=>client.lookupDisposition(clone(value)));assert.throws(()=>factory().lookupDisposition(value));
    const replay=await rejected(client.submitPrepared(handle));assert.throws(()=>client.lookupDisposition(replay));assert.equal(client.status().retainedOriginalBytes,0);
    emit({event:'RESULT',mode:config.mode,report:observed.result??null,disposition:client.lookupDisposition(value),client:client.status()});
  }
}finally{original?.fill(0);for(const client of clients)await client.close();observer.close();process.stdin.destroy();}
