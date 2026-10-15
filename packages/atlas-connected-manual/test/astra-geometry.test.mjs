import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { digest } from '@atlas/manual-service/contract';
import { prepareAstraGeometryRequest, projectAstraGeometryResponse, runAstraGeometry, gradingToCanonical, geometryProposal, applyAstraGeometryToPreparation } from '../src/astra-geometry.mjs';
const quad = [{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}];
const contour = Array.from({length:16},(_,i)=>{const edge=Math.floor(i/4),t=i%4/4,a=quad[edge],b=quad[(edge+1)%4];return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};});
const visual={physical:{quad,contour,uncertainty:'HIGH',observation:'Rounded card edge, glare at lower left.'},printed:{quad:[{x:.2,y:.2},{x:.8,y:.22},{x:.79,y:.8},{x:.19,y:.78}],uncertainty:'MEDIUM',observation:'Slanted printed frame.'}};
const response=value=>JSON.stringify({id:'resp_fixture',model:'gpt-6-astra',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:1,output_tokens:1}});
async function fixture(){const bytes=await sharp({create:{width:40,height:60,channels:3,background:'#3c4154'}}).png().toBuffer();return{bytes,frame:{schemaVersion:3,generation:{model:'synthetic-image-model'},id:'source',raster:{content:{sha256:digest(bytes)},dimensions:{width:40,height:60}}},original:{content:{sha256:digest(bytes)}}};}
test('actual Astra/xhigh request uses only clean grading pixels and four exact crops',async()=>{
 const source=await fixture();
 const {request,evidence}=await prepareAstraGeometryRequest({source,side:'FRONT'});
 assert.equal(request.model,'gpt-6-astra');assert.equal(request.reasoning.effort,'xhigh');assert.equal(request.max_output_tokens,32768);
 assert.equal(evidence.images.length,5);assert.equal(evidence.images[0].kind,'CLEAN');assert.equal(evidence.gradingSha256,digest(source.bytes));assert.ok(evidence.images.every(image=>image.kind.startsWith('CLEAN')));
 const images=request.input[0].content.filter(p=>p.type==='input_image');assert.equal(images.length,5);
 for(let i=0;i<images.length;i++)assert.equal(digest(Buffer.from(images[i].image_url.split(',')[1],'base64')),evidence.images[i].sha256);
 assert.match(request.instructions,/sole grading image and coordinate authority/);assert.match(request.instructions,/supported virtual intersections/);
 const result=projectAstraGeometryResponse({status:200,bodyText:response(visual),evidence},evidence);
 assert.deepEqual(result.printed.quad,visual.printed.quad);assert.equal(geometryProposal(result,'physical').ambiguity.ambiguous,true);
});
test('clean-frame general inner quad transforms independently, preserving its slant',()=>{
 const source={frame:{raster:{dimensions:{width:1000,height:2000}}}};
 const p=gradingToCanonical(visual.printed.quad,source,{frame:{sourceToRectified:[1.27,0,0,0,.889,0,0,0,1]}});
 p.forEach((v,i)=>{assert.ok(Math.abs(v.x-visual.printed.quad[i].x)<1e-12);assert.ok(Math.abs(v.y-visual.printed.quad[i].y)<1e-12);});
 assert.notEqual(p[0].y,p[1].y);
});

test('retained Astra printed coordinates survive native re-preparation without replacing a human material contour',async()=>{
 const source=await fixture(),{evidence}=await prepareAstraGeometryRequest({source,side:'FRONT'});
 const saved=projectAstraGeometryResponse({status:200,bodyText:response(visual),evidence},evidence);
 const humanContour=structuredClone(contour),result={frameDescriptorSha256:evidence.frameDescriptorSha256,frame:{sourceToRectified:[1270/40,0,0,0,1778/60,0,0,0,1],materialContour:humanContour}};
 applyAstraGeometryToPreparation({visual:saved,source,result,includePhysicalContour:false});
 assert.equal(result.actor,'ASTRA');assert.equal(result.proposal.provenance.responseHash,saved.responseHash);
 result.proposal.proposal.forEach((p,i)=>{assert.ok(Math.abs(p.x-visual.printed.quad[i].x)<1e-12);assert.ok(Math.abs(p.y-visual.printed.quad[i].y)<1e-12);});
 assert.deepEqual(result.frame.materialContour,humanContour);
 assert.throws(()=>applyAstraGeometryToPreparation({visual:saved,source,result:{...result,frameDescriptorSha256:'e'.repeat(64)}}),{code:'GEOMETRY_PHOTO_CHANGED'});
 const changed=structuredClone(source);changed.frame.raster.content.sha256='f'.repeat(64);
 assert.throws(()=>applyAstraGeometryToPreparation({visual:saved,source:changed,result}),{code:'GEOMETRY_PHOTO_CHANGED'});
 const absent=structuredClone(saved);absent.printed.quad=null;
 applyAstraGeometryToPreparation({visual:absent,source,result,includePhysicalContour:false});
 assert.equal(result.proposal.outcome,'ABSTAIN');assert.equal(result.proposal.proposal,null);
});
test('original fallback geometry uses lossless original pixels, explicit provenance and the same xhigh coordinate contract',async()=>{
 const source=await fixture();source.frame.schemaVersion=2;delete source.frame.generation;
 const {request,evidence}=await prepareAstraGeometryRequest({source,side:'FRONT'});
 assert.match(request.instructions,/saved original photograph/);assert.doesNotMatch(request.instructions,/generated photograph|CLEAN/);
 assert.equal(request.model,'gpt-6-astra');assert.equal(request.reasoning.effort,'xhigh');
 assert.equal(evidence.gradingSha256,digest(source.bytes));assert(evidence.images.every(image=>image.kind.startsWith('ORIGINAL')));
 assert.equal(evidence.promptHash,digest(request.instructions));
 const image=request.input[0].content.find(item=>item.type==='input_image');
 assert.deepEqual(await sharp(Buffer.from(image.image_url.split(',')[1],'base64')).raw().toBuffer(),await sharp(source.bytes).raw().toBuffer());
 const result=projectAstraGeometryResponse({status:200,bodyText:response(visual),evidence},evidence);
 assert.deepEqual(result.printed.quad,visual.printed.quad);
});
test('Photoroom geometry preserves xhigh policy and exact clean crops without claiming generated pixels',async()=>{
 const source=await fixture();source.frame.schemaVersion=4;delete source.frame.generation;
 source.frame.segmentation={provider:'PHOTOROOM_PLUS'};
 const {request,evidence}=await prepareAstraGeometryRequest({source,side:'BACK'});
 assert.match(request.instructions,/background-removed photograph with verified unchanged foreground RGB and original framing/);
 assert.doesNotMatch(request.instructions,/generated photograph|ORIGINAL/);
 assert.equal(request.model,'gpt-6-astra');assert.equal(request.reasoning.effort,'xhigh');
 assert.equal(evidence.gradingSha256,digest(source.bytes));assert.equal(evidence.images.length,5);
 for(const [index,image] of request.input[0].content.filter(item=>item.type==='input_image').entries()){
  const descriptor=evidence.images[index],input=sharp(source.bytes);
  if(index)input.extract({left:descriptor.left,top:descriptor.top,width:descriptor.width,height:descriptor.height});
  assert.deepEqual(await sharp(Buffer.from(image.image_url.split(',')[1],'base64')).raw().toBuffer(),await input.raw().toBuffer());
 }
});
test('durable one-dispatch journal reprojects retained raw response without another model call or changed grading request',async()=>{
 const source=await fixture(),job={key:'j',claimId:'c',input:{side:'FRONT',cardId:'card'}};let saved=null,calls=0;const artifacts=new Map();
 const store={async readModel(){return saved;},async dispatchModel(_j,requestHash,request){if(saved)return false;saved={requestHash,request,response:null};return true;},async saveModelResponse(_j,_hash,response){saved.response=response;return true;}};
 const storage={async write(value,context){const ref=String(artifacts.size);artifacts.set(ref,{value:structuredClone(value),context});return ref;},async read(ref,context){assert.deepEqual(artifacts.get(ref).context,context);return structuredClone(artifacts.get(ref).value);}};
 const model=async()=>{calls++;return{status:200,bytes:Buffer.from(response(visual))};};
 const input={job,source,store,artifacts:storage,model,signal:new AbortController().signal};
 const first=await runAstraGeometry(input),again=await runAstraGeometry(input);
 assert.equal(calls,1);assert.deepEqual(first,again);assert.ok(saved.response);
});
test('lost response never redispatches after a job restart and leaves explicit unknown evidence',async()=>{
 const source=await fixture(),job={key:'j',claimId:'c',input:{side:'BACK',cardId:'card'}};let saved=null,calls=0;
 const store={async readModel(){return saved;},async dispatchModel(_j,requestHash,request){saved={requestHash,request,response:null};return true;}};
 const input={job,source,store,artifacts:{async write(){return'fixture';}},model:async()=>{calls++;throw Error('lost socket');}};
 await assert.rejects(runAstraGeometry(input),/lost socket/);await assert.rejects(runAstraGeometry(input),e=>e.code==='GEOMETRY_MODEL_RESPONSE_UNKNOWN');assert.equal(calls,1);
});
test('model refusal, invalid/crossing quad and an incomplete response never invent an outline',async()=>{
 const {evidence}=await prepareAstraGeometryRequest({source:await fixture(),side:'BACK'});
 for(const mutate of [v=>{v.physical.quad=[quad[0],quad[2],quad[1],quad[3]];},v=>{v.physical.contour[0].x=4;}]){
  const bad=structuredClone(visual);mutate(bad);assert.throws(()=>projectAstraGeometryResponse({status:200,bodyText:response(bad),evidence},evidence));
 }
 assert.throws(()=>projectAstraGeometryResponse({status:500,bodyText:'{}',evidence},evidence));
 const absent=structuredClone(visual);absent.physical.quad=null;absent.physical.contour=[];const result=projectAstraGeometryResponse({status:200,bodyText:response(absent),evidence},evidence);assert.equal(geometryProposal(result,'physical').proposal,null);
});

test('lossless view encoding preserves every clean grading pixel; nonempty simple clockwise silhouette is required',async()=>{
 const source=await fixture(),{request,evidence}=await prepareAstraGeometryRequest({source,side:'FRONT'});
 const image=request.input[0].content.find(p=>p.type==='input_image');assert.match(image.image_url,/^data:image\/webp/);
 assert.deepEqual(await sharp(Buffer.from(image.image_url.split(',')[1],'base64')).raw().toBuffer(),await sharp(source.bytes).raw().toBuffer());
 for(const change of [v=>{v.physical.contour=[];},v=>{v.physical.contour.reverse();},v=>{[v.physical.contour[3],v.physical.contour[11]]=[v.physical.contour[11],v.physical.contour[3]];},v=>{v.physical.contour[2]=v.physical.contour[1];}]){
  const value=structuredClone(visual);change(value);assert.throws(()=>projectAstraGeometryResponse({status:200,bodyText:response(value),evidence},evidence));
 }
});

test('explicit bounded retry of definite rejection submits exact retained bytes and keeps prior receipts',async()=>{
 const source=await fixture(),job={key:'j',claimId:'c',input:{side:'FRONT',cardId:'card'}},actions=[],records=new Map(),requests=[];
 const store={async readModel(){return actions.at(-1)??null;},async dispatchModel(_job,requestHash,request){actions.push({attempt:actions.length+1,retryAuthorized:false,requestHash,request,response:null});return true;},async saveModelResponse(_job,_hash,response){actions.at(-1).response=response;return true;}};
 const artifacts={async write(value,context){const ref=String(records.size);records.set(ref,{value:structuredClone(value),context});return ref;},async read(ref,context){assert.deepEqual(records.get(ref).context,context);return structuredClone(records.get(ref).value);}};
 const input={job,source,store,artifacts,model:async request=>{requests.push(JSON.stringify(request));return requests.length===1?{status:429,bytes:Buffer.from('{"error":"rate limit"}')}:{status:200,bytes:Buffer.from(response(visual))};}};
 await assert.rejects(runAstraGeometry(input));assert.equal(actions[0].response.httpStatus,429);
 await assert.rejects(runAstraGeometry(input));assert.equal(requests.length,1,'Worker recovery cannot authorize another POST');
 actions[0].retryAuthorized=true;
 await runAstraGeometry(input);
 assert.equal(actions.length,2);assert.equal(requests[0],requests[1]);assert.equal(actions[0].response.httpStatus,429);assert.equal(actions[1].response.httpStatus,200);
 await runAstraGeometry(input);assert.equal(requests.length,2);
});
