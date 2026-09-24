import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {loadVerifiedImage,createVerifiedImageResource,verifiedImageContentKey,MAX_VERIFIED_IMAGE_BYTES} from '../src/verified-image.mjs';
import {geometryImageBinding} from '../dist/PairedGeometryWorkspace.js';
import {inspectionImageBinding} from '../dist/DefectReviewWorkspace.js';

const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const sha=value=>createHash('sha256').update(value).digest('hex');
const image={url:'/photo.png',sha256:sha(bytes),byteCount:bytes.length};
function fixture({chunks=[bytes],headers={},fetchImpl}={}) {
  const created=[],revoked=[],calls=[];let cancelled=0,reads=0;
  const response={ok:true,headers:new Headers(headers),body:{getReader(){let index=0;return {
    async read(){reads++;return index<chunks.length?{done:false,value:chunks[index++]}:{done:true};},
    async cancel(){cancelled++;},
  };}}};
  const options={origin:'https://staff.example.invalid',cryptoImpl:webcrypto,
    urlImpl:{createObjectURL:blob=>{created.push(blob);return `blob:verified-${created.length}`;},revokeObjectURL:url=>revoked.push(url)},
    fetchImpl:async(url,options)=>{calls.push({url,options});return fetchImpl?fetchImpl(url,options):response;}};
  return {created,revoked,calls,options,get cancelled(){return cancelled;},get reads(){return reads;}};
}
const rejection=code=>error=>error.code===code;

test('only exact bounded bytes become a Blob URL; same-origin cookies and no image re-encoding',async()=>{
  const f=fixture({chunks:[bytes.subarray(0,17),bytes.subarray(17)],headers:{'content-length':String(bytes.length)}});
  const result=await loadVerifiedImage(image,f.options);
  assert.equal(result.sha256,image.sha256);assert.equal(result.byteCount,bytes.length);assert.equal(f.created.length,1);
  assert.equal(f.created[0].type,'image/png');assert.deepEqual(Buffer.from(await f.created[0].arrayBuffer()),bytes);
  assert.equal(f.calls[0].options.credentials,'same-origin');assert.equal(f.calls[0].options.mode,'cors');
  assert.equal(f.calls[0].options.redirect,'error');assert.equal(f.calls[0].options.referrerPolicy,'no-referrer');
  result.dispose();result.dispose();assert.deepEqual(f.revoked,[result.url]);
});

test('cross-origin signed HTTPS omits cookies; insecure cross-origin, userinfo and fragment are denied',async()=>{
  const f=fixture();const found=await loadVerifiedImage({...image,url:'https://private.example.invalid/photo?signature=synthetic'},f.options);
  assert.equal(f.calls[0].options.credentials,'omit');found.dispose();
  for(const url of ['http://private.example.invalid/photo','https://user:pass@private.example.invalid/photo','/photo#fragment','blob:unverified','blob:https://staff.example.invalid/unverified','data:image/png;base64,AAAA'])
    await assert.rejects(loadVerifiedImage({...image,url},f.options),rejection('VERIFIED_IMAGE_ORIGIN'));
  assert.equal(f.calls.length,1);
});

test('legacy hash-only descriptors remain bounded and tampered bytes never create URLs',async()=>{
  const f=fixture(),legacy={url:image.url,sha256:image.sha256};
  const found=await loadVerifiedImage(legacy,f.options);found.dispose();
  const wrong=fixture({chunks:[Uint8Array.from(bytes,(value,index)=>index===20?value^1:value)]});
  await assert.rejects(loadVerifiedImage(legacy,wrong.options),rejection('VERIFIED_IMAGE_HASH'));
  assert.equal(wrong.created.length,0);assert.equal(wrong.cancelled,1);
});

test('header, streamed size and actual descriptor byte-count mismatches are rejected',async()=>{
  assert.equal(MAX_VERIFIED_IMAGE_BYTES,256*1024*1024);
  const header=fixture({headers:{'content-length':String(MAX_VERIFIED_IMAGE_BYTES+1)}});
  await assert.rejects(loadVerifiedImage({url:image.url,sha256:image.sha256},header.options),rejection('VERIFIED_IMAGE_TOO_LARGE'));
  assert.equal(header.reads,0);assert.equal(header.created.length,0);
  const stream=fixture();await assert.rejects(loadVerifiedImage({url:image.url,sha256:image.sha256},{...stream.options,maxBytes:bytes.length-1}),rejection('VERIFIED_IMAGE_TOO_LARGE'));
  for(const byteCount of [bytes.length-1,bytes.length+1]){
    const f=fixture();await assert.rejects(loadVerifiedImage({...image,byteCount},f.options),rejection('VERIFIED_IMAGE_LENGTH'));assert.equal(f.created.length,0);
  }
  await assert.rejects(loadVerifiedImage({...image,byteCount:MAX_VERIFIED_IMAGE_BYTES+1},fixture().options));
});

test('non-raster content, redirects and unsuccessful responses cannot reach img',async()=>{
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),f=fixture({chunks:[svg]});
  await assert.rejects(loadVerifiedImage({url:'/photo',sha256:sha(svg)},f.options),rejection('VERIFIED_IMAGE_FORMAT'));assert.equal(f.created.length,0);
  for(const response of [{ok:false},{ok:true,redirected:true,body:{getReader(){throw new Error('must not read');}}}]){
    const denied=fixture({fetchImpl:async()=>response});await assert.rejects(loadVerifiedImage(image,denied.options),rejection('VERIFIED_IMAGE_UNAVAILABLE'));assert.equal(denied.created.length,0);
  }
});

test('cancellation and deadline stop stalled reads/fetch; late response body is cancelled',async()=>{
  const pre=new AbortController();pre.abort();const untouched=fixture();
  await assert.rejects(loadVerifiedImage(image,{...untouched.options,signal:pre.signal}),rejection('VERIFIED_IMAGE_CANCELLED'));assert.equal(untouched.calls.length,0);
  let cancelReader=0,reading;const began=new Promise(resolve=>{reading=resolve;});
  const f=fixture({fetchImpl:async()=>({ok:true,headers:new Headers(),body:{getReader:()=>({read:()=>{reading();return new Promise(()=>{});},cancel:()=>{cancelReader++;return new Promise(()=>{});}})}})});
  const controller=new AbortController(),active=loadVerifiedImage(image,{...f.options,signal:controller.signal});await began;controller.abort();
  await assert.rejects(active,rejection('VERIFIED_IMAGE_CANCELLED'));assert.equal(cancelReader,1);assert.equal(f.created.length,0);
  let finishFetch,lateCancelled=0;const slow=fixture({fetchImpl:()=>new Promise(resolve=>{finishFetch=resolve;})});
  await assert.rejects(loadVerifiedImage(image,{...slow.options,timeoutMs:10}),rejection('VERIFIED_IMAGE_TIMEOUT'));
  finishFetch({ok:true,body:{cancel:async()=>{lateCancelled++;}}});await new Promise(resolve=>setImmediate(resolve));assert.equal(lateCancelled,1);
});

test('input descriptor and reused stream chunks are snapshotted before verification',async()=>{
  let finish,called;const started=new Promise(resolve=>{called=resolve;}),response=new Promise(resolve=>{finish=resolve;});
  const f=fixture({fetchImpl:()=>{called();return response;}}),descriptor={...image};
  const active=loadVerifiedImage(descriptor,f.options);await started;descriptor.sha256='0'.repeat(64);descriptor.byteCount=1;
  let index=0;const shared=new Uint8Array(bytes.length);
  finish({ok:true,headers:new Headers(),body:{getReader:()=>({async read(){if(index++===0){shared.set(bytes);return {done:false,value:shared};}shared.fill(0);return {done:true};},async cancel(){}})}});
  const result=await active;assert.equal(result.sha256,image.sha256);assert.deepEqual(Buffer.from(await f.created[0].arrayBuffer()),bytes);result.dispose();
});

test('URL refresh reuses proved Blob; pixel replacement and unmount revoke only owned URLs',async()=>{
  const disposed=[],loads=[],states=[];
  const resource=createVerifiedImageResource({load:async descriptor=>{loads.push(descriptor);const url=`blob:${loads.length}`;return {contentKey:verifiedImageContentKey(descriptor),url,dispose:()=>disposed.push(url)};}});
  await resource.update(image,value=>states.push(value));const first=states.at(-1);
  await resource.update({...image,url:'https://private.example.invalid/renewed'},value=>states.push(value));
  assert.equal(loads.length,1);assert.equal(states.at(-1).url,first.url);assert.equal(disposed.length,0);
  await resource.update({...image,sha256:'a'.repeat(64)},value=>states.push(value));assert.equal(loads.length,2);assert.equal(disposed.length,1);
  resource.dispose();assert.deepEqual(disposed,['blob:1','blob:2']);
});

test('superseded noncooperative load is disposed and cannot publish stale pixels',async()=>{
  let resolveFirst,oldSignal;const states=[],disposed=[];
  const resource=createVerifiedImageResource({load:(descriptor,{signal})=>{
    if(descriptor.sha256===image.sha256){oldSignal=signal;return new Promise(resolve=>{resolveFirst=resolve;});}
    return Promise.resolve({contentKey:verifiedImageContentKey(descriptor),url:'blob:new',dispose:()=>disposed.push('new')});
  }});
  const first=resource.update(image,value=>states.push(value));await resource.update({...image,sha256:'a'.repeat(64)},value=>states.push(value));
  resolveFirst({contentKey:verifiedImageContentKey(image),url:'blob:old',dispose:()=>disposed.push('old')});await first;
  assert.equal(oldSignal.aborted,true);assert.equal(states.at(-1).url,'blob:new');assert(!states.some(value=>value.url==='blob:old'));assert.deepEqual(disposed,['old']);resource.dispose();
});

test('actual component editor bindings ignore authorization URL but retain source/frame revisions',()=>{
  const state={cardId:'card',sides:{FRONT:{image:{frameSha256:image.sha256,width:3024,height:4032},imageRevision:1,preparationRevision:1}}};
  const images={FRONT:{original:image}},renewed={FRONT:{original:{...image,url:'https://private.example.invalid/renewed',byteCount:undefined}}};
  const original=geometryImageBinding(state,'FRONT','PHYSICAL',images);
  assert.equal(geometryImageBinding(state,'FRONT','PHYSICAL',renewed),original);
  assert.notEqual(geometryImageBinding({...state,sides:{FRONT:{...state.sides.FRONT,imageRevision:2}}},'FRONT','PHYSICAL',renewed),original);
  const defects={cardId:'card',sides:{FRONT:{frame:{inspectionImageSha256:image.sha256,frameId:'one'},findingRevision:1}}};
  const binding=inspectionImageBinding(defects,'FRONT',{inspection:image});
  assert.equal(inspectionImageBinding(defects,'FRONT',{inspection:{...image,url:'https://private.example.invalid/renewed'}}),binding);
  assert.notEqual(inspectionImageBinding({...defects,sides:{FRONT:{...defects.sides.FRONT,frame:{...defects.sides.FRONT.frame,frameId:'two'}}}},'FRONT',{inspection:image}),binding);
});
