import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createProofDecoderClient} from '../src/proof-decoder-client.mjs';
import {PROOF_DECODER_PROTOCOL,PROOF_DECODER_VERSION,proofDecoderLimits,proofDecoderLimitsHash,encodeProofDecoderFrame,createProofDecoderFrameReader} from '../src/proof-decoder-protocol.mjs';
const expectedQualificationHash='a'.repeat(64),expectedEpoch='synthetic_peer_epoch';
const source=()=>Buffer.from('synthetic protocol bytes, not a decoded photograph');
const plan=bytes=>({byteCount:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),declaredType:'image/png'});
const validated=start=>({schema:'atlas-marketplace-proof-image-v1',decoder:PROOF_DECODER_VERSION,byteCount:start.plan.byteCount,sha256:start.plan.sha256,contentType:start.plan.declaredType,width:2,height:3});
async function peer(t,behavior,{limits:overrides={},accept=true,hello=true,onConnect}={}){
  const directory=await mkdtemp(join(await realpath(tmpdir()),'atlas-decoder-')),socketPath=join(directory,'s'),limits=proofDecoderLimits({timeoutMs:500,...overrides}),sockets=new Set();let connections=0;
  const server=createServer({allowHalfOpen:true},socket=>{
    connections++;sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    const ctx={socket,start:null,received:0,chunks:[],send:(type,value)=>socket.write(encodeProofDecoderFrame(type,value)),terminal:(outcome='SUCCESS',options={})=>({requestId:ctx.start.requestId,qualificationHash:expectedQualificationHash,epoch:expectedEpoch,outcome,workerState:options.workerState??'REAPED',validation:outcome==='SUCCESS'?{...validated(ctx.start),...options.validation}:null}),end:(outcome='SUCCESS',options={})=>socket.end(encodeProofDecoderFrame('TERMINAL',ctx.terminal(outcome,options)))};
    const reader=createProofDecoderFrameReader({onFrame(type,value){if(type==='START'){ctx.start=value;if(accept)ctx.send('ACCEPT',{requestId:value.requestId,qualificationHash:expectedQualificationHash,epoch:expectedEpoch});}if(type==='DATA'){ctx.received+=value.length;ctx.chunks.push(value);}behavior?.(type,value,ctx);}});
    socket.on('data',chunk=>{try{reader.feed(chunk);}catch{socket.destroy();}});
    if(hello)ctx.send('HELLO',{schema:PROOF_DECODER_PROTOCOL,qualificationHash:expectedQualificationHash,epoch:expectedEpoch,limitsHash:proofDecoderLimitsHash(limits)});onConnect?.(ctx);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  const options={enabled:true,socketPath,expectedQualificationHash,expectedEpoch,limits:{...limits}},client=createProofDecoderClient(options);
  t.after(async()=>{await client.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
  return{client,options,limits,socketPath,connections:()=>connections,sockets};
}
function complete(type,_value,ctx){if(type==='DATA'&&ctx.received===ctx.start.plan.byteCount)ctx.end();}

test('disabled construction does not inspect endpoint inputs or establish a socket',async()=>{
  let touched=false;const client=createProofDecoderClient({get socketPath(){touched=true;throw Error('unexpected endpoint read');}});
  assert.equal(touched,false);assert.equal(client.status().state,'DISABLED');assert.equal(client.status().classification,'UNQUALIFIED');await assert.rejects(client.validate(),{code:'PROOF_DECODER_DISABLED'});await client.close();
});
test('successful protocol result remains unqualified and snapshots bytes, plan and limits before I/O',async t=>{
  let observed;const f=await peer(t,(type,value,ctx)=>{if(type==='DATA'&&ctx.received===ctx.start.plan.byteCount){observed=Buffer.concat(ctx.chunks);ctx.end();}}),bytes=source(),original=Buffer.from(bytes),inputPlan=plan(bytes),expected={...inputPlan};
  const pending=f.client.validate({bytes,plan:inputPlan});bytes.fill(0);inputPlan.sha256='b'.repeat(64);f.options.limits.maxPixels=1;f.options.expectedEpoch='changed';
  const result=await pending;assert.equal(result.classification,'UNQUALIFIED');assert.equal(result.reportedCleanup,'REAPED');assert.deepEqual(result.validation,{schema:'atlas-marketplace-proof-image-v1',decoder:PROOF_DECODER_VERSION,byteCount:expected.byteCount,sha256:expected.sha256,contentType:expected.declaredType,width:2,height:3});assert.deepEqual(observed,original);assert.equal(f.client.status().occupiedSlots,0);assert.equal(f.client.status().active,0);assert.equal(f.connections(),1);
});
test('source contradictions, oversized buffers and invalid signals fail before connecting',async t=>{
  const f=await peer(t,complete,{limits:{maxObjectBytes:64}}),bytes=source();
  for(const input of [{bytes:Buffer.alloc(65),plan:plan(Buffer.alloc(65))},{bytes:Buffer.alloc(0),plan:plan(bytes)},{bytes,plan:{...plan(bytes),sha256:'b'.repeat(64)}},{bytes,plan:{...plan(bytes),byteCount:bytes.length+1}},{bytes,plan:plan(bytes),signal:{aborted:false}}])await assert.rejects(f.client.validate(input));
  assert.equal(f.connections(),0);assert.equal(f.client.status().occupiedSlots,0);
});
test('contradictory terminal count, digest, type, dimensions and epoch quarantine the sent request',async t=>{
  for(const changed of [{byteCount:1},{sha256:'b'.repeat(64)},{contentType:'image/jpeg'},{width:100,height:100}]){
    const f=await peer(t,(type,value,ctx)=>{if(type==='DATA')ctx.end('SUCCESS',{validation:changed});},{limits:{maxPixels:100}}),bytes=source();
    await assert.rejects(f.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_DECODER_PROTOCOL'});assert.equal(f.client.status().quarantined,true);assert.equal(f.client.status().occupiedSlots,1);
  }
  for(const changed of [{epoch:'different_epoch'},{requestId:'11111111-1111-4111-8111-111111111111'},{qualificationHash:'b'.repeat(64)}]){const f=await peer(t,(type,value,ctx)=>{if(type==='DATA')ctx.socket.end(encodeProofDecoderFrame('TERMINAL',{...ctx.terminal(),...changed}));}),bytes=source();await assert.rejects(f.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_DECODER_PROTOCOL'});assert.equal(f.client.status().cleanupUncertain,true);assert.equal(f.client.status().occupiedSlots,1);}
});
test('success waits for EOF and rejects fragmented duplicate terminal or trailing bytes',async t=>{
  for(const suffix of ['duplicate','trailing']){
    let wrote;const ready=new Promise(resolve=>{wrote=resolve;}),f=await peer(t,(type,value,ctx)=>{if(type==='DATA'){const frame=encodeProofDecoderFrame('TERMINAL',ctx.terminal());ctx.socket.write(frame);wrote(ctx);}}),bytes=source();let resolved=false;
    const pending=f.client.validate({bytes,plan:plan(bytes)}).finally(()=>{resolved=true;}),rejected=assert.rejects(pending,{code:'PROOF_DECODER_PROTOCOL'}),ctx=await ready;await delay(10);assert.equal(resolved,false);
    const extra=suffix==='duplicate'?encodeProofDecoderFrame('TERMINAL',ctx.terminal()):Buffer.from([0]);ctx.socket.write(extra.subarray(0,1));await delay(5);ctx.socket.end(extra.subarray(1));await rejected;assert.equal(f.client.status().cleanupUncertain,true);
  }
});
test('BUSY before acceptance releases capacity, but premature INVALID_IMAGE is protocol failure',async t=>{
  let attempt=0;const f=await peer(t,(type,value,ctx)=>{if(type==='START'){attempt++;if(attempt===1)ctx.end('BUSY',{workerState:'NOT_STARTED'});else{ctx.send('ACCEPT',{requestId:value.requestId,qualificationHash:expectedQualificationHash,epoch:expectedEpoch});}}if(type==='DATA')ctx.end();},{accept:false}),bytes=source();
  await assert.rejects(f.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_VALIDATOR_BUSY'});assert.equal(f.client.status().occupiedSlots,0);assert.equal((await f.client.validate({bytes,plan:plan(bytes)})).classification,'UNQUALIFIED');
  for(const accept of [false,true]){const bad=await peer(t,(type,value,ctx)=>{if(type==='START')ctx.end('INVALID_IMAGE',{workerState:accept?'REAPED':'NOT_STARTED'});},{accept});await assert.rejects(bad.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_DECODER_PROTOCOL'});assert.equal(bad.client.status().cleanupUncertain,true);}
});
test('complete INVALID_IMAGE differs from containment failure and does not quarantine reusable capacity',async t=>{
  const bytes=source(),invalid=await peer(t,(type,value,ctx)=>{if(type==='DATA')ctx.end('INVALID_IMAGE');});await assert.rejects(invalid.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_IMAGE_INVALID'});assert.equal(invalid.client.status().occupiedSlots,0);assert.equal(invalid.client.status().quarantined,false);
  const failed=await peer(t,(type,value,ctx)=>{if(type==='DATA')ctx.end('CONTAINMENT_FAILURE',{workerState:'UNKNOWN'});});await assert.rejects(failed.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_DECODER_CONTAINMENT_FAILURE'});assert.equal(failed.client.status().occupiedSlots,1);await assert.rejects(failed.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_DECODER_QUARANTINED'});
});
test('absolute deadline covers a partial HELLO and terminal-without-EOF, with no retries',async t=>{
  const bytes=source(),partial=await peer(t,()=>{},{hello:false,limits:{timeoutMs:40},onConnect:ctx=>ctx.socket.write(Buffer.from([0,0]))});
  const start=Date.now();await assert.rejects(partial.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_VALIDATOR_TIMEOUT'});assert.ok(Date.now()-start<300);assert.equal(partial.connections(),1);assert.equal(partial.client.status().occupiedSlots,0);
  for(const partialTerminal of [false,true]){const output=await peer(t,(type,value,ctx)=>{if(type==='DATA'){const frame=encodeProofDecoderFrame('TERMINAL',ctx.terminal());ctx.socket.write(partialTerminal?frame.subarray(0,9):frame);}},{limits:{timeoutMs:40}});await assert.rejects(output.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_VALIDATOR_TIMEOUT'});assert.equal(output.connections(),1);assert.equal(output.client.status().occupiedSlots,1);assert.equal(output.client.status().cleanupUncertain,true);}
});
test('disconnect after START quarantines capacity; an active slot rejects rather than queues',async t=>{
  const bytes=source();let seen;const ready=new Promise(resolve=>{seen=resolve;}),f=await peer(t,(type,value,ctx)=>{if(type==='START')seen(ctx);},{accept:false,limits:{maxConcurrent:1}});
  const pending=f.client.validate({bytes,plan:plan(bytes)}),rejected=assert.rejects(pending,{code:'PROOF_DECODER_CLEANUP_UNCONFIRMED'}),ctx=await ready;await assert.rejects(f.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_DECODER_BUSY'});assert.equal(f.connections(),1);ctx.socket.destroy();await rejected;assert.equal(f.client.status().active,0);assert.equal(f.client.status().occupiedSlots,1);
});
test('cancel ignores late success, requires terminal cleanup, and close joins local sockets',async t=>{
  let data;const ready=new Promise(resolve=>{data=resolve;}),f=await peer(t,(type,value,ctx)=>{if(type==='DATA')data(ctx);if(type==='CANCEL')ctx.end();}),bytes=source(),controller=new AbortController();
  const pending=f.client.validate({bytes,plan:plan(bytes),signal:controller.signal}),rejected=assert.rejects(pending,{code:'PROOF_DECODER_CANCELLED'});await ready;controller.abort();await rejected;assert.equal(f.client.status().occupiedSlots,0);
  const report=await f.client.close();assert.equal(report.classification,'UNQUALIFIED');assert.equal(report.localSocketsClosed,true);assert.equal(report.cleanupUncertain,false);assert.equal(f.client.status().active,0);
  const unknown=await peer(t,()=>{},{limits:{timeoutMs:40}}),cancel=new AbortController(),work=unknown.client.validate({bytes,plan:plan(bytes),signal:cancel.signal}),failure=assert.rejects(work,{code:'PROOF_VALIDATOR_TIMEOUT'});await delay(10);cancel.abort();await failure;assert.equal(unknown.client.status().occupiedSlots,1);assert.equal((await unknown.client.close()).cleanupUncertain,true);
});


test('absolute deadline also bounds blocked input writes without releasing uncertain remote capacity',async t=>{
  const f=await peer(t,(type,value,ctx)=>{if(type==='START')ctx.socket.pause();},{limits:{timeoutMs:50,maxObjectBytes:2097152}}),bytes=Buffer.alloc(2097152,3),started=Date.now();
  await assert.rejects(f.client.validate({bytes,plan:plan(bytes)}),{code:'PROOF_VALIDATOR_TIMEOUT'});assert.ok(Date.now()-started<300);assert.equal(f.connections(),1);assert.equal(f.client.status().occupiedSlots,1);assert.equal(f.client.status().active,0);
});
test('close cancels active work and joins the locally closed socket without claiming verified containment',async t=>{
  let data,cancels=0;const ready=new Promise(resolve=>{data=resolve;}),f=await peer(t,(type,value,ctx)=>{if(type==='DATA')data();if(type==='CANCEL'){cancels++;ctx.end('CANCELLED');}}),bytes=source();
  const pending=f.client.validate({bytes,plan:plan(bytes)}),rejected=assert.rejects(pending,{code:'PROOF_DECODER_CLOSED'});await ready;const receipt=await f.client.close();await rejected;assert.equal(cancels,1);assert.equal(receipt.classification,'UNQUALIFIED');assert.equal(receipt.localSocketsClosed,true);assert.equal(receipt.cleanupUncertain,false);assert.equal(f.client.status().active,0);assert.equal(f.client.status().occupiedSlots,0);
});
