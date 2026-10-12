import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { digest } from '@atlas/manual-service/contract';
import { prepareAstraGeometryRequest, projectAstraGeometryResponse, runAstraGeometry, originalToCanonical, geometryProposal } from '../src/astra-geometry.mjs';
const quad = [{x:.1,y:.1},{x:.9,y:.1},{x:.9,y:.9},{x:.1,y:.9}];
const contour = Array.from({length:16},(_,i)=>{const edge=Math.floor(i/4),t=i%4/4,a=quad[edge],b=quad[(edge+1)%4];return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};});
const visual={physical:{quad,contour,uncertainty:'HIGH',observation:'Rounded card edge, glare at lower left.'},printed:{quad:[{x:.2,y:.2},{x:.8,y:.22},{x:.79,y:.8},{x:.19,y:.78}],uncertainty:'MEDIUM',observation:'Slanted printed frame.'}};
const response=value=>JSON.stringify({id:'resp_fixture',model:'gpt-6-astra',status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:1,output_tokens:1}});
async function fixture(){const bytes=await sharp({create:{width:40,height:60,channels:3,background:'#3c4154'}}).png().toBuffer();return{bytes,frame:{id:'source',raster:{content:{sha256:digest(bytes)},dimensions:{width:40,height:60}}},original:{content:{sha256:digest(bytes)}}};}
test('actual request uses Astra/xhigh, full original plus four hashed original crops; cutout is distinctly labelled view aid',async()=>{
 const source=await fixture(),clean={bytes:source.bytes,contentType:'image/png',sha256:digest(source.bytes),width:40,height:60};
 const {request,evidence}=await prepareAstraGeometryRequest({source,side:'FRONT',cleanPhoto:clean});
 assert.equal(request.model,'gpt-6-astra');assert.equal(request.reasoning.effort,'xhigh');assert.equal(request.max_output_tokens,32768);
 assert.equal(evidence.images.length,6);assert.equal(evidence.images[0].kind,'ORIGINAL');assert.equal(evidence.images[5].kind,'GENERATED_VIEW_AID');
 const images=request.input[0].content.filter(p=>p.type==='input_image');assert.equal(images.length,6);
 for(let i=0;i<images.length;i++)assert.equal(digest(Buffer.from(images[i].image_url.split(',')[1],'base64')),evidence.images[i].sha256);
 assert.match(request.instructions,/Never measure or return coordinates from the generated image/);
 const result=projectAstraGeometryResponse({status:200,bodyText:response(visual),evidence},evidence);
 assert.deepEqual(result.printed.quad,visual.printed.quad);assert.equal(geometryProposal(result,'physical').ambiguity.ambiguous,true);
});
test('original-frame general inner quad transforms independently, preserving its slant',()=>{
 const source={frame:{raster:{dimensions:{width:1000,height:2000}}}};
 const p=originalToCanonical(visual.printed.quad,source,{frame:{sourceToRectified:[1.27,0,0,0,.889,0,0,0,1]}});
 p.forEach((v,i)=>{assert.ok(Math.abs(v.x-visual.printed.quad[i].x)<1e-12);assert.ok(Math.abs(v.y-visual.printed.quad[i].y)<1e-12);});
 assert.notEqual(p[0].y,p[1].y);
});
test('durable one-dispatch journal reprojects retained raw response without another model call or changed cutout request',async()=>{
 const source=await fixture(),job={key:'j',claimId:'c',input:{side:'FRONT',cardId:'card'}};let saved=null,calls=0;const artifacts=new Map();
 const store={async readModel(){return saved;},async dispatchModel(_j,requestHash,request){if(saved)return false;saved={requestHash,request,response:null};return true;},async saveModelResponse(_j,_hash,response){saved.response=response;return true;}};
 const storage={async write(value,context){const ref=String(artifacts.size);artifacts.set(ref,{value:structuredClone(value),context});return ref;},async read(ref,context){assert.deepEqual(artifacts.get(ref).context,context);return structuredClone(artifacts.get(ref).value);}};
 const model=async()=>{calls++;return{status:200,bytes:Buffer.from(response(visual))};};
 const input={job,source,store,artifacts:storage,model,signal:new AbortController().signal};
 const first=await runAstraGeometry(input),again=await runAstraGeometry({...input,cleanPhoto:{invalid:'later generated view cannot alter an existing request'}});
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

test('lossless view encoding preserves every original pixel; nonempty simple clockwise silhouette is required',async()=>{
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
 await runAstraGeometry({...input,cleanPhoto:{changed:'new cutout cannot alter the exact successor request'}});
 assert.equal(actions.length,2);assert.equal(requests[0],requests[1]);assert.equal(actions[0].response.httpStatus,429);assert.equal(actions[1].response.httpStatus,200);
 await runAstraGeometry(input);assert.equal(requests.length,2);
});
