import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewDisplay} from '../src/review-display.mjs';
import {photo,photoSource,setup} from './review-display-fixture.mjs';

test('construction and pending GETs never generate, schedule or fetch full source bytes',async()=>{
 const f=setup(),read=await f.service.read(photo,photoSource);
 assert.equal(read.url,undefined);assert.equal(read.display,undefined);assert.equal(read.displayState.state,'PENDING');
 assert.equal(read.width,48);assert.equal(read.height,64);assert.equal(f.reads,0);assert.equal(f.discoveries,undefined);assert.deepEqual(f.generations,[]);
});
test('independent context is readable while full encoding is pending, then survives process replacement',async()=>{
 const f=setup();let release;f.beforeGenerate=async input=>{if(input.output==='full')await new Promise(r=>{release=r;});};
 f.service.start();await f.until(()=>f.jobs.get('context').state==='READY'&&release);
 const pending=await f.service.read(photo,photoSource);
 assert.equal(pending.displayState.state,'PENDING');assert(pending.preview.url);assert.equal(pending.preview.sourceSha256,photo.workingFrame.raster.content.sha256);assert.equal(pending.display,undefined);
 release();await f.until(()=>f.jobs.get('full').state==='READY');await f.service.stop();
 const restarted=createReviewDisplay(f.dependencies),before=f.reads,result=await restarted.read(photo,photoSource);
 assert.equal(result.displayState.state,'READY');assert(result.display.url);assert(result.preview.url);assert.equal(result.url,undefined);assert.equal(f.reads,before);
 assert.equal(result.display.width,48);assert.deepEqual(f.generations,['preview','full']);
 const context=await restarted.read(photo,photoSource,{contextOnly:true});assert.equal(context.display,undefined);assert(context.preview.url);
});
test('failed full generation preserves durable context and exposes failure instead of PNG fallback',async()=>{
 const f=setup();f.beforeGenerate=input=>{if(input.output==='full')throw Object.assign(Error(),{code:'PHOTO_COLOR_UNSUPPORTED'});};await f.run();
 const read=await f.service.read(photo,photoSource);assert.equal(read.displayState.state,'FAILED');assert.equal(read.displayState.code,'PHOTO_COLOR_UNSUPPORTED');assert(read.preview.url);assert.equal(read.url,undefined);assert.equal(read.display,undefined);await f.service.stop();
});
test('transient work failure is retried durably without turning the read path into work',async()=>{
 const f=setup();f.beforeGenerate=()=>{throw Object.assign(Error(),{code:'PHOTO_STORAGE_TIMEOUT'});};await f.run();
 assert([...f.jobs.values()].every(j=>j.state==='QUEUED'&&j.delayed));const before=f.generations.length;
 await f.service.read(photo,photoSource);assert.equal(f.generations.length,before);await f.service.stop();
});
test('cancelled late generation never writes or adopts derivative results',async()=>{
 const f=setup();f.jobs.delete('full');let release;f.beforeGenerate=()=>new Promise(r=>{release=r;});
 f.service.start();await f.until(()=>release);const stopping=f.service.stop();release();await stopping;
 assert.equal(f.writes.length,0);assert.equal(f.jobs.get('context').state,'QUEUED');
});

for(const [name,mutate]of[
 ['wrong source',v=>{v.sourceSha256='f'.repeat(64);}],['lossy full',v=>{v.descriptor.raster.content.mime='image/jpeg';}],
 ['resized full',v=>{v.descriptor.raster.dimensions.width--; }],['wrong policy',v=>{v.policyVersion='unqualified';}]
])test(`${name} durable full descriptor is refused`,async()=>{const f=setup();await f.run();await f.service.stop();
 f.jobs.get('full').result=structuredClone(f.jobs.get('full').result);mutate(f.jobs.get('full').result);await assert.rejects(f.service.read(photo,photoSource));});

test('all transient failures stop after six automatic attempts and expose explicit bounded recovery',async()=>{
 const f=setup();f.jobs.delete('context');const job=f.jobs.get('full');
 Object.assign(job,{id:'00000000-0000-4000-8000-000000000001',photo_hash:photoSource.ref.sha256,recovery:0,attempts:5});
 f.beforeGenerate=()=>{throw Object.assign(Error(),{code:'PHOTO_STORAGE_TIMEOUT'});};await f.run();
 assert.equal(job.attempts,6);assert.equal(job.state,'FAILED');
 const value=await f.service.read(photo,photoSource);assert.deepEqual(value.displayState.retry,{jobId:job.id,photoSourceHash:photoSource.ref.sha256});
 assert.equal(value.displayState.retryable,true);job.recovery=3;
 assert.equal((await f.service.read(photo,photoSource)).displayState.retry,undefined);
 await f.service.stop();
});

test('published historical backfill reads only its approved artifact and preserves full bytes when current intake is unavailable',async()=>{
 const {default:sharp}=await import('sharp');const {descriptorSha256}=await import('@atlas/photo-core');
 const {digest}=await import('@atlas/manual-service/contract');
 const f=setup(),full=await sharp({create:{width:1350,height:1858,channels:3,background:'#8899aa'}}).webp({lossless:true}).toBuffer();
 const frame=photo.workingFrame;
 const image={schemaVersion:1,kind:'derivative',id:'historical-inspection',purpose:'inspection',
  originalDescriptorSha256:descriptorSha256(photo.original),frameDescriptorSha256:descriptorSha256(frame),
  raster:{content:{mime:'image/webp',sha256:digest(full),byteCount:full.length},dimensions:{width:1350,height:1858},object:{key:'test/old-canonical.webp',versionId:'1'}},
  frameToDerivative:[1,0,0,0,1,0,0,0,1],encoder:{name:'retained-canonical',version:'1',settingsSha256:'b'.repeat(64)}};
 const media={FRONT:{original:photo.original,decodePlan:photo.decodePlan,frame,descriptor:image}},hash=digest(JSON.stringify(media));
 const job={id:'publication-job',variant:'published',side:'FRONT',state:'QUEUED',attempts:0,card_id:'synthetic-card',
  publication:{version:'atlas-manual-publication-manifest-v1',packet:{ref:{sha256:'c'.repeat(64)}},publicHash:'c'.repeat(64),media:{ref:{sha256:hash},sourceHash:hash}}};
 f.jobs.clear();f.jobs.set('published',job);let originalReads=0;
 f.dependencies.authorityFor=()=>{throw Error('published authority cannot become an intake actor');};
 f.dependencies.intake.readSource=()=>{throw Error('replaced intake photo is unavailable');};
 f.dependencies.artifacts.read=async(ref,binding)=>{assert.equal(ref.sha256,hash);assert.equal(binding.kind,'APPROVED_MEDIA');return structuredClone(media);};
 f.storage.readDerivative=async({descriptor})=>{originalReads++;assert.equal(descriptor.raster.content.sha256,digest(full));return{bytes:full};};
 f.service=createReviewDisplay(f.dependencies);await f.run();assert.equal(job.state,'READY');assert.equal(originalReads,1);
 assert.equal(job.result.sourceSha256,digest(full));assert.equal(job.result.descriptor.raster.dimensions.height,768);
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].purpose,'preview');assert.equal(image.raster.content.sha256,digest(full));await f.service.stop();
 // A valid manifest for the wrong card cannot borrow publication authority.
 const bad=setup();bad.jobs.clear();bad.jobs.set('published',{...structuredClone(job),state:'QUEUED',attempts:0,card_id:'other-card'});
 bad.dependencies.artifacts=f.dependencies.artifacts;bad.dependencies.authorityFor=f.dependencies.authorityFor;
 bad.service=createReviewDisplay(bad.dependencies);await bad.run();assert.equal(bad.jobs.get('published').state,'FAILED');assert.equal(bad.writes.length,0);await bad.service.stop();
});

test('published operational outage remains recoverable after six attempts without scheduling work on reads',async()=>{
 const f=setup(),manifest={version:'atlas-manual-publication-manifest-v1',packet:{ref:{sha256:'a'.repeat(64)}},publicHash:'a'.repeat(64),media:{ref:{sha256:'b'.repeat(64)},sourceHash:'b'.repeat(64)}};
 f.jobs.clear();f.jobs.set('published',{variant:'published',publication:manifest,state:'QUEUED',attempts:6,card_id:'synthetic-card',side:'FRONT'});
 f.dependencies.artifacts.read=async()=>{throw Object.assign(Error('storage outage'),{code:'MANUAL_ARTIFACT_UNAVAILABLE'});};
 f.service=createReviewDisplay(f.dependencies);await f.run();assert.equal(f.jobs.get('published').state,'QUEUED');assert.equal(f.jobs.get('published').attempts,7);assert.equal(f.generations.length,0);await f.service.stop();
});

test('source-bound context requires full-frame aspect and exact half-pixel resize transform',async()=>{
 for(const mutate of [v=>{v.descriptor.raster.dimensions.width=16;},v=>{v.descriptor.frameToDerivative[2]=2;}]){
  const f=setup();await f.run();await f.service.stop();const row=f.jobs.get('context');row.result=structuredClone(row.result);mutate(row.result);
  const read=await f.service.read(photo,photoSource,{contextOnly:true});
  assert.equal(read.preview,undefined);assert.equal(read.displayState.state,'FAILED');assert.equal(read.displayState.code,'MANUAL_DISPLAY_BINDING_INVALID');
 }
});

for(const failure of ['lookup','binding','sign','grant'])test(`optional context ${failure} failure preserves valid full evidence and never emits malformed preview`,async()=>{
 const f=setup();await f.run();await f.service.stop();
 if(failure==='lookup'){const read=f.store.read;f.store.read=(source,variant)=>variant==='context'?Promise.reject(Object.assign(Error(),{code:'PHOTO_STORAGE_UNAVAILABLE'})):read(source,variant);}
 if(failure==='binding'){f.jobs.get('context').result=structuredClone(f.jobs.get('context').result);f.jobs.get('context').result.sourceSha256='f'.repeat(64);}
 if(['sign','grant'].includes(failure)){const sign=f.storage.createImmutableDerivativeRead;f.storage.createImmutableDerivativeRead=async input=>{
  if(input.descriptor.raster.content.mime==='image/jpeg'){if(failure==='sign')throw Object.assign(Error(),{code:'PHOTO_STORAGE_UNAVAILABLE'});return{...input.descriptor.raster.content,url:'https://bad.invalid',sha256:'f'.repeat(64)};}
  return sign(input);};}
 const read=await f.service.read(photo,photoSource);assert.equal(read.displayState.state,'READY');assert(read.display.url);
 assert.equal(read.preview,undefined);assert.equal(read.display.preview,undefined);assert.equal(read.previewState.state,'FAILED');assert.equal(read.previewState.retryable,false);
 const thumb=await f.service.read(photo,photoSource,{contextOnly:true});assert.equal(thumb.displayState.state,'FAILED');assert.equal(thumb.preview,undefined);
 assert.equal(f.reads,2);assert.deepEqual(f.generations,['preview','full']);
});

test('optional inspection parsing, index, grant and signing failures return no preview, while source authority and cancellation still propagate',async()=>{
 const f=setup();await f.run();await f.service.stop();
 const image={...structuredClone(f.jobs.get('full').result.descriptor),purpose:'inspection'};
 image.raster.dimensions={width:1350,height:1858};
 const preview={policyVersion:'atlas-inspection-preview-v1',sourceSha256:image.raster.content.sha256,descriptor:structuredClone(f.jobs.get('context').result.descriptor)};
 preview.descriptor.raster.dimensions={width:558,height:768};
 assert((await f.service.inspection(photo,image,preview)).url);
 assert.equal(await f.service.inspection(photo,image,{...preview,sourceSha256:'f'.repeat(64)}),null);
 f.store.inspection=async()=>{throw Object.assign(Error(),{code:'PHOTO_STORAGE_UNAVAILABLE'});};assert.equal(await f.service.inspection(photo,image),null);
 f.storage.createImmutableDerivativeRead=async()=>{throw Object.assign(Error(),{code:'PHOTO_STORAGE_UNAVAILABLE'});};assert.equal(await f.service.inspection(photo,image,preview),null);
 f.storage.createImmutableDerivativeRead=async()=>({...preview.descriptor.raster.content,url:'https://wrong.invalid',sha256:'f'.repeat(64)});assert.equal(await f.service.inspection(photo,image,preview),null);
 for(const error of [Object.assign(Error(),{status:403,code:'INTAKE_ACCESS_DENIED'}),Object.assign(Error(),{name:'AbortError'})]){
  f.storage.createImmutableDerivativeRead=async()=>{throw error;};await assert.rejects(f.service.inspection(photo,image,preview),e=>e===error);
 }
});

test('invalid source frames and authority failures cannot be converted into optional preview success',async()=>{
 const f=setup();const wrong=structuredClone(photo);wrong.workingFrame.originalDescriptorSha256='f'.repeat(64);
 await assert.rejects(f.service.read(wrong,photoSource));
 f.store.read=async()=>{throw Object.assign(Error(),{status:403,code:'INTAKE_ACCESS_DENIED'});};
 await assert.rejects(f.service.read(photo,photoSource),{code:'INTAKE_ACCESS_DENIED'});
});

test('selected hints are bounded and expire; thumbnail reads never hint or invoke background work; lifecycle rotates fair scheduling lanes',async()=>{
 const f=setup();let now=1000;const discoveries=[],claims=[];
 f.store.discover=async(_limit,options)=>{discoveries.push(options);};f.store.claim=async(_limit,options)=>{claims.push(options);return null;};
 f.service=createReviewDisplay({...f.dependencies,now:()=>now});
 await f.service.read(photo,photoSource,{contextOnly:true});assert.equal(discoveries.length,0);assert.equal(claims.length,0);
 f.service.start();await f.service.tick();assert.deepEqual(discoveries[0].priorityPhotoHashes,[]);
 for(let i=0;i<18;i++)await f.service.read(photo,{ref:{sha256:i.toString(16).padStart(64,'0')}});
 assert.equal(discoveries.length,1,'GET cannot discover or schedule a worker');
 await f.service.tick();assert.equal(discoveries.at(-1).priorityPhotoHashes.length,16);assert(!discoveries.at(-1).priorityPhotoHashes.includes('0'.repeat(64)));
 await f.service.tick();await f.service.tick();assert.deepEqual(claims.slice(0,4).map(x=>x.lane),['context','selected','context','oldest']);
 now+=60001;await f.service.tick();assert.deepEqual(discoveries.at(-1).priorityPhotoHashes,[]);assert.equal(f.reads,0);assert.equal(f.writes.length,0);await f.service.stop();
});

test('optional preview deadline aborts a stalled transport and preserves full evidence without late rejection leaks',async()=>{
 const f=setup();await f.run();await f.service.stop();let previewSignal,rejectLate;
 const sign=f.storage.createImmutableDerivativeRead;
 f.storage.createImmutableDerivativeRead=input=>{
  if(input.descriptor.raster.content.mime==='image/jpeg'){previewSignal=input.signal;return new Promise((_resolve,reject)=>{rejectLate=reject;});}
  return sign(input);
 };
 const service=createReviewDisplay({...f.dependencies,previewTimeoutMs:10});
 const read=await service.read(photo,photoSource);assert.equal(previewSignal.aborted,true);assert.equal(previewSignal.reason.code,'MANUAL_PREVIEW_TIMEOUT');
 assert(read.display.url);assert.equal(read.preview,undefined);assert.deepEqual(read.previewState,{state:'FAILED',code:'MANUAL_PREVIEW_TIMEOUT',retryable:false});
 rejectLate(Object.assign(Error('late storage rejection'),{code:'PHOTO_STORAGE_UNAVAILABLE'}));await new Promise(resolve=>setImmediate(resolve));
 assert(f.errors.some(x=>x.code==='MANUAL_PREVIEW_TIMEOUT'));assert.equal(f.writes.length,2);
});

test('bounded optional inspection deadline does not retry saved preview work outside the deadline',async()=>{
 const f=setup();await f.run();await f.service.stop();
 f.store.inspection=async()=>new Promise(()=>{});
 const service=createReviewDisplay({...f.dependencies,previewTimeoutMs:10});
 const image=f.jobs.get('full').result.descriptor;
 assert.equal(await service.inspection(photo,image),null);assert(f.errors.some(x=>x.code==='MANUAL_PREVIEW_TIMEOUT'));
 const controller=new AbortController();
 f.store.inspection=async()=>new Promise(()=>{});
 const pending=service.inspection(photo,image,null,{signal:controller.signal});
 const refusal=Object.assign(Error('source changed'),{status:409,code:'MANUAL_PHOTOS_CHANGED'});controller.abort(refusal);
 await assert.rejects(pending,e=>e===refusal);
});

test('caller abort propagates into an in-flight context read and cleans its listener',async()=>{
 const f=setup();await f.run();await f.service.stop();let entered;const started=new Promise(resolve=>{entered=resolve;});
 const sign=f.storage.createImmutableDerivativeRead;let previewSignal;
 f.storage.createImmutableDerivativeRead=input=>input.descriptor.raster.content.mime==='image/jpeg'?(previewSignal=input.signal,entered(),new Promise(()=>{})):sign(input);
 const controller=new AbortController(),service=createReviewDisplay({...f.dependencies,previewTimeoutMs:1000});
 const pending=service.read(photo,photoSource,{signal:controller.signal});await started;
 const reason=Object.assign(Error('caller cancelled'),{name:'AbortError'});controller.abort(reason);
 await assert.rejects(pending,e=>e===reason);assert.equal(previewSignal.aborted,true);assert.equal(previewSignal.reason,reason);
});
