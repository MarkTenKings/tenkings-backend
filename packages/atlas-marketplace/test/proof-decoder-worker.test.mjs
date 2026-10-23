import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,copyFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {createProofImageValidator} from '../src/proof-image.mjs';
import {classifyProofDecoderWorkerFailure,proofDecoderWorkerEnvironmentMatches} from '../src/proof-decoder-worker.mjs';
import {PROOF_DECODER_LIMITS,proofDecoderLimitsHash} from '../src/proof-decoder-protocol.mjs';
import {encodeProofDecoderWorkerRequestHeader,encodeProofDecoderWorkerRequest,createProofDecoderWorkerResultReader,assertProofDecoderWorkerResult} from '../src/proof-decoder-worker-protocol.mjs';

const worker=fileURLToPath(new URL('../src/proof-decoder-worker.mjs',import.meta.url));
const env={HOME:'/nonexistent',HOSTNAME:'atlas-proof-decoder',PATH:'/opt/atlas-proof-decoder/bin',UV_THREADPOOL_SIZE:'1',VIPS_CONCURRENCY:'1'};
const image=(format='png')=>sharp({create:{width:20,height:30,channels:3,background:{r:64,g:128,b:200}}})[format]().toBuffer();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const input=(bytes,type='image/png',changes={})=>{const limits={...PROOF_DECODER_LIMITS,...changes};return{requestId:randomUUID(),plan:{byteCount:bytes.length,sha256:hash(bytes),declaredType:type},limits,limitsHash:proofDecoderLimitsHash(limits)};};
function launch({entry=worker,args=[],environment=env,timeoutMs=3000}={}){
  const child=spawn(process.execPath,['--max-old-space-size=128',entry,...args],{env:environment,stdio:['pipe','pipe','pipe']});
  let out=[],outBytes=0,errBytes=0,timedOut=false;const start=performance.now();
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
  child.stdout.on('data',chunk=>{outBytes+=chunk.length;if(outBytes>4104)child.kill('SIGKILL');else out.push(chunk);});
  child.stderr.on('data',chunk=>{errBytes+=chunk.length;if(errBytes>4096)child.kill('SIGKILL');});child.stdin.on('error',()=>{});
  const done=new Promise((accept,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>{clearTimeout(timer);accept({code,signal,stdout:Buffer.concat(out),errBytes,timedOut,elapsed:performance.now()-start,pid:child.pid});});});
  return{child,done};
}
async function run(i,bytes,options){const job=launch(options);job.child.stdin.end(encodeProofDecoderWorkerRequest(i,bytes));return job.done;}
function parsed(receipt,i){
  const reader=createProofDecoderWorkerResultReader();reader.feed(receipt.stdout);const value=reader.end();
  return assertProofDecoderWorkerResult(value,{requestId:i.requestId,plan:i.plan,limits:i.limits});
}
function corruptPixels(png){
  const b=Buffer.from(png);let at=8;while(b.toString('ascii',at+4,at+8)!=='IDAT')at+=12+b.readUInt32BE(at);
  b.fill(0,at+8,at+8+b.readUInt32BE(at));const end=at+12+b.readUInt32BE(at);let crc=0xffffffff;
  for(const x of b.subarray(at+4,end-4)){crc^=x;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  b.writeUInt32BE((crc^0xffffffff)>>>0,end-4);return b;
}

test('real fixed worker fully decodes PNG/JPEG and matches the unchanged legacy validation DTO',async()=>{
  const legacy=createProofImageValidator();
  try{for(const format of ['png','jpeg']){
    const bytes=await image(format),i=input(bytes,'image/'+format),receipt=await run(i,bytes),value=parsed(receipt,i);
    assert.equal(receipt.code,0);assert.equal(receipt.signal,null);assert.equal(receipt.timedOut,false);assert.equal(value.outcome,'SUCCESS');
    assert.deepEqual(value.validation,await legacy.validate({bytes,plan:i.plan}));assert.equal(value.validation.width,20);assert.equal(value.validation.height,30);
    assert.deepEqual(Object.keys(value).sort(),['outcome','requestId','schema','validation']);
  }}finally{await legacy.close();}
});

test('real compressed-pixel corruption, truncated/appended containers, mismatched MIME and pixel limit are image rejections',async()=>{
  const png=await image(),jpeg=await image('jpeg');
  const cases=[[corruptPixels(png),'image/png',{}],[png.subarray(0,-4),'image/png',{}],[jpeg.subarray(0,-2),'image/jpeg',{}],[Buffer.concat([jpeg,Buffer.from('tail')]),'image/jpeg',{}],[png,'image/jpeg',{}],[png,'image/png',{maxPixels:200}]];
  for(const [bytes,mime,limits] of cases){const i=input(bytes,mime,limits),receipt=await run(i,bytes);assert.equal(receipt.code,0);assert.equal(parsed(receipt,i).outcome,'INVALID_IMAGE');}
});

test('worker import is inert; exact main refuses extra arguments, runtime flags and inherited environment',async()=>{
  const probe=spawnSync(process.execPath,['--input-type=module','-e','await import('+JSON.stringify(pathToFileURL(worker).href)+');console.log("inert");'],{encoding:'utf8',timeout:2000});
  assert.equal(probe.status,0);assert.equal(probe.stdout,'inert\n');
  assert.equal(proofDecoderWorkerEnvironmentMatches(env,{platform:'linux',uid:501}),true);
  assert.equal(proofDecoderWorkerEnvironmentMatches({...env,__CF_USER_TEXT_ENCODING:'0x1F5:0x0:0x0'},{platform:'darwin',uid:501}),true);
  for(const value of ['unexpected','0x1F4:0x0:0x0','0x1F5:0x1:0x0'])assert.equal(proofDecoderWorkerEnvironmentMatches({...env,__CF_USER_TEXT_ENCODING:value},{platform:'darwin',uid:501}),false);
  assert.equal(proofDecoderWorkerEnvironmentMatches({...env,__CF_USER_TEXT_ENCODING:'0x1F5:0x0:0x0'},{platform:'linux',uid:501}),false);
  const bytes=await image(),i=input(bytes);
  for(const options of [{args:['--unexpected']},{environment:{...env,APP_SECRET:'synthetic-should-never-be-read'}},{environment:{...env,VIPS_CONCURRENCY:'2'}}]){
    const receipt=await run(i,bytes,options);assert.equal(receipt.code,2);assert.equal(receipt.stdout.length,0);
  }
  const wrongFlags=spawnSync(process.execPath,[worker],{env,input:encodeProofDecoderWorkerRequest(i,bytes),timeout:2000});assert.equal(wrongFlags.status,2);assert.equal(wrongFlags.stdout.length,0);
});

test('missing dependency and unexpected native/resource faults are availability failures, never invalid-image',async(t)=>{
  const folder=await realpath(await mkdtemp(join(tmpdir(),'atlas-worker-dependency-')));t.after(()=>rm(folder,{recursive:true,force:true}));
  for(const file of ['proof-decoder-worker.mjs','proof-image-decode.mjs','proof-decoder-worker-protocol.mjs','proof-decoder-protocol.mjs','contract.mjs'])await copyFile(join(dirname(worker),file),join(folder,file));
  const bytes=await image(),i=input(bytes),receipt=await run(i,bytes,{entry:join(folder,'proof-decoder-worker.mjs')});
  assert.equal(receipt.code,2);assert.equal(parsed(receipt,i).outcome,'DECODER_FAILURE');
  for(const error of [{code:'ENOMEM',message:'allocation failed'},{message:'pngload_buffer: out of memory'},{message:'std::bad_alloc'},{code:'ERR_MODULE_NOT_FOUND'},{code:'PROOF_DECODER_VERSION_UNAVAILABLE'},{code:'PROOF_DECODE_INVALID'},{message:'native timeout'},{message:'unexpected native error'},{message:'Input buffer has corrupt header: pngload_buffer: ENOMEM'},{message:'Input buffer has corrupt header: VipsJpeg: unexpected setup failure'}])assert.equal(classifyProofDecoderWorkerFailure(error),'DECODER_FAILURE');
});

test('absolute partial-input deadline and external cancellation end owned processes without an image verdict',async()=>{
  const bytes=await image(),i=input(bytes,'image/png',{timeoutMs:60}),job=launch();
  job.child.stdin.write(encodeProofDecoderWorkerRequestHeader(i));job.child.stdin.write(bytes.subarray(0,1));
  const receipt=await job.done;assert.equal(receipt.code,2);assert.equal(receipt.stdout.length,0);assert.equal(receipt.timedOut,false);assert.ok(receipt.elapsed<1500);
  assert.throws(()=>process.kill(receipt.pid,0),{code:'ESRCH'});
  const cancelled=launch();cancelled.child.stdin.write(encodeProofDecoderWorkerRequestHeader(input(bytes)));
  cancelled.child.kill('SIGKILL');const stopped=await cancelled.done;assert.equal(stopped.signal,'SIGKILL');assert.equal(stopped.stdout.length,0);assert.throws(()=>process.kill(stopped.pid,0),{code:'ESRCH'});
});

test('trailing input and a source digest mismatch fail availability without calling either image outcome',async()=>{
  const bytes=await image(),i=input(bytes);
  for(const wire of [Buffer.concat([encodeProofDecoderWorkerRequest(i,bytes),Buffer.from([0])]),Buffer.concat([encodeProofDecoderWorkerRequestHeader({...i,plan:{...i.plan,sha256:'0'.repeat(64)}}),bytes])]){
    const job=launch();job.child.stdin.end(wire);const receipt=await job.done;
    assert.equal(receipt.code,2);assert.equal(parsed(receipt,i).outcome,'DECODER_FAILURE');
  }
});
