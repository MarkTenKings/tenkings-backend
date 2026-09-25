import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
// Real browser Blob/crypto/IndexedDB and application upload bridge. Only local
// synthetic HTTP/storage replies; this does not reproduce a physical iPhone.
if(!process.argv[2])throw Error('Pass the bundled node_modules path for Playwright.');
const {chromium,webkit}=createRequire(join(resolve(process.argv[2]),'__atlas__.cjs'))('playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),output=resolve(process.argv[3]??'/private/tmp/atlas-batch-upload-browser');mkdirSync(output,{recursive:true});
const deployed=path=>readFileSync(join(root,path));
const sources=new Map([
 ['/batch.mjs',deployed('frontend/atlas-app/lib/batch-import.mjs')],
 ['/client.mjs',deployed('packages/atlas-manual-intake/src/client.mjs')],
 ['/camera.mjs',deployed('frontend/atlas-shared/rapid-camera.mjs')],
 ['/photo-bytes.mjs',deployed('packages/atlas-manual-intake/src/photo-bytes.mjs')],
 ['/packages/atlas-manual-intake/src/photo-bytes.mjs',deployed('packages/atlas-manual-intake/src/photo-bytes.mjs')]
]);
const server=createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Local pre-plan bridge audit</title><script type="module">import * as batch from "/batch.mjs";import * as intake from "/client.mjs";import * as camera from "/camera.mjs";window.__modules={batch,intake,camera};</script>');return;}res.setHeader('content-type','text/javascript');res.end(sources.get(req.url));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,results=[];
try{
for(const [name,type,launch] of [['Chrome',chromium,{channel:'chrome'}],['WebKit',webkit,{}]]){
 const browser=await type.launch({headless:true,...launch});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844}});await context.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,origin);return route.continue();});
 const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>window.__modules);
 const result=await page.evaluate(async()=>{
  const {batch,intake,camera}=window.__modules;
  const results=[], nativeRead=Blob.prototype.arrayBuffer;
  for(const fault of [null,'BLOB_READ','READ_ALL','PLAN_LOST','INTAKE_JOURNAL_LIST']){
   const staffId=crypto.randomUUID(),journal=batch.createBrowserBatchImportJournal({staffId}),intakeJournal=intake.createBrowserIntakeJournal({staffId});
   const records=new Map(),creates=new Map(),calls=[],puts=[],errors=[];
   const request=async(path,{body}={})=>{
    calls.push({path,method:body?'POST':'GET'});
    const base='/api/staff/manual-intake/cards';
    if(path===base){if(!creates.has(body.requestId)){const card={cardId:crypto.randomUUID(),sides:{FRONT:{version:0,upload:null},BACK:{version:0,upload:null}},ready:false};records.set(card.cardId,card);creates.set(body.requestId,card);}return {card:structuredClone(creates.get(body.requestId))};}
    if(path==='/api/staff/manual-connected/cards/batch')return {jobs:[]};
    const [,id,uploadId,action]=/^\/api\/staff\/manual-intake\/cards\/([^/]+)(?:\/uploads(?:\/([^/]+)(?:\/([^/]+))?)?)?$/.exec(path)??[];
    const card=records.get(id);if(!card)throw Error('Unknown synthetic card');
    if(path.endsWith('/uploads')){const slot=card.sides[body.side];if(!slot.upload){slot.version++;slot.requestId=body.requestId;slot.upload={uploadId:crypto.randomUUID(),plan:{expected:{sha256:body.sha256,byteCount:body.byteCount}},verification:null,source:null};}if(slot.requestId!==body.requestId)throw Error('Duplicate replacement upload intent');if(fault==='PLAN_LOST'&&!slot.lostReply){slot.lostReply=true;throw Object.assign(Error('lost plan reply'),{code:'NETWORK_INTERRUPTED'});}return {upload:structuredClone(slot.upload)};}
    if(!uploadId)return {card:structuredClone(card)};
    const upload=Object.values(card.sides).find(slot=>slot.upload?.uploadId===uploadId).upload;
    if(action==='sign')return {state:'UPLOAD',method:'PUT',uploadId,byteCount:upload.plan.expected.byteCount,url:'https://synthetic.invalid/'+uploadId,headers:{}};
    if(action==='complete'){if(!puts.includes(uploadId))throw Object.assign(Error('not uploaded'),{code:'INTAKE_UPLOAD_ABSENT'});upload.verification={verified:true};return {upload:structuredClone(upload)};}
    if(action==='prepare'){upload.source={fixture:true};card.ready=Object.values(card.sides).every(slot=>slot.upload?.source);card.sourceHash=card.ready?'a'.repeat(64):null;return {upload:structuredClone(upload)};}
    throw Error('Unknown synthetic action');
   };
   const client=intake.createIntakeClient({request,journal:fault==='INTAKE_JOURNAL_LIST'?{...intakeJournal,list:async()=>{throw Object.assign(Error('injected read failure'),{code:'INTAKE_JOURNAL_UNAVAILABLE'});}}:intakeJournal,fetchImpl:async(url,{body})=>{await nativeRead.call(body);puts.push(new URL(url).pathname.slice(1));return {status:200};}});
   const owner=batch.createBatchImporter({request,journal,intake:client});
   const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;canvas.paused=false;canvas.videoWidth=canvas.width;canvas.videoHeight=canvas.height;
   const ctx=canvas.getContext('2d',{colorSpace:'display-p3'}),pixels=ctx.createImageData(canvas.width,canvas.height);let seed=892371;
   for(let i=0;i<pixels.data.length;i++){seed=(seed*1664525+1013904223)>>>0;pixels.data[i]=i%4===3?255:seed>>>24;}ctx.putImageData(pixels,0,0);
   const capture=await camera.captureRapidCameraPhoto(canvas,{readyState:'live'},'FRONT',{ImageCaptureImpl:null});
   const originalArrayBuffer=Blob.prototype.arrayBuffer, OriginalFileReader=window.FileReader, OriginalResponse=window.Response;
   if(fault==='READ_ALL'){
    await journal.put({version:1,items:Array.from({length:8},(_,i)=>({createId:crypto.randomUUID(),enqueueId:crypto.randomUUID(),cardId:null,started:false,hashes:{},done:false,code:null,label:`Card ${i+1}`,files:{FRONT:capture.file,BACK:new File([capture.file,new Uint8Array([i])],'back.png',{type:'image/png'})}}))});
    Blob.prototype.arrayBuffer=async function(){throw new DOMException('Injected unreadable original','NotReadableError');};
    window.FileReader=class {readAsArrayBuffer(){throw new DOMException('Injected unreadable original','NotReadableError');}};
    window.Response=class {constructor(){throw new DOMException('Injected unreadable original','NotReadableError');}};
   }
   if(fault==='BLOB_READ')Blob.prototype.arrayBuffer=async function(){throw new DOMException('Injected native blob read failure','NotReadableError');};
   const start=performance.now();
   try{
    if(fault==='READ_ALL')await owner.run();
    else for(let i=0;i<8;i++){await owner.saveSide('FRONT',capture.file,capture.capture);await owner.saveSide('BACK',new File([capture.file,new Uint8Array([i])],'back.png',{type:'image/png'}),capture.capture);}
    await owner.whenIdle();
   }finally{Blob.prototype.arrayBuffer=originalArrayBuffer;window.FileReader=OriginalFileReader;window.Response=OriginalResponse;}
   const saved=await owner.read(),pending=await intakeJournal.list();
   const result={fault: fault??'NONE',fileBytes:capture.file.size,captureSource:capture.capture.source,colorSpace:capture.capture.colorSpace,cards:creates.size,cardReads:calls.filter(x=>x.method==='GET').length,plans:calls.filter(x=>x.path.endsWith('/uploads')).length,puts:puts.length,queued:saved.items.filter(x=>x.done).length,pendingUploadIntents:pending.length,itemCodes:saved.items.map(x=>x.code),hashCounts:saved.items.map(x=>Object.keys(x.hashes).length),failures:saved.items.map(x=>batch.batchImportFailureDetails(x)),elapsedMs:Math.round(performance.now()-start)};
   if(['INTAKE_JOURNAL_LIST','PLAN_LOST','READ_ALL'].includes(fault)){result.originalsRetained=saved.items.every(x=>x.files.FRONT instanceof Blob&&x.files.BACK instanceof Blob);result.originalReadableAfterFaultRemoved=(await saved.items[0].files.FRONT.arrayBuffer()).byteLength===capture.file.size;}
   await owner.dispose();
   if(['INTAKE_JOURNAL_LIST','PLAN_LOST','READ_ALL'].includes(fault)){
    const priorIds=saved.items.map(item=>({cardId:item.cardId,createId:item.createId,enqueueId:item.enqueueId}));
    const restoredClient=intake.createIntakeClient({request,journal:intakeJournal,fetchImpl:async(url,{body})=>{await nativeRead.call(body);puts.push(new URL(url).pathname.slice(1));return {status:200};}});
    const restored=batch.createBatchImporter({request,journal,intake:restoredClient});await restored.run();const resumed=await restored.read();
    result.recovery={cards:creates.size,queued:resumed.items.filter(item=>item.done).length,sameIds:JSON.stringify(priorIds)===JSON.stringify(resumed.items.map(item=>({cardId:item.cardId,createId:item.createId,enqueueId:item.enqueueId}))),clearedFailures:resumed.items.every(item=>!item.failure)};await restored.dispose();
   }
   await journal.close();await intakeJournal.close();results.push(result);
  }
  return {userAgent:navigator.userAgent,results};
 });
 for(const row of result.results){assert.equal(row.cards,8);if(!['INTAKE_JOURNAL_LIST','PLAN_LOST','READ_ALL'].includes(row.fault)){assert.equal(row.plans,16);assert.equal(row.queued,8);assert.equal(row.puts,16);}else{assert.equal(row.plans,row.fault==='PLAN_LOST'?16:0);assert.equal(row.cardReads,row.fault==='PLAN_LOST'?16:0);assert(row.originalsRetained);assert.equal(row.recovery.cards,8);assert.equal(row.recovery.queued,8);assert(row.recovery.sameIds);assert(row.recovery.clearedFailures);assert(row.failures.every(failure=>failure.phase===(row.fault==='READ_ALL'?'READ_FRONT_BYTES':row.fault==='PLAN_LOST'?'UPLOAD_FRONT':'READ_FRONT_JOURNAL')));if(row.fault==='READ_ALL')assert(row.failures.every(failure=>failure.exceptionName==='NotReadableError'));}}
 results.push({browser:name,...result});await context.close();
 }finally{await browser.close();}
}
writeFileSync(join(output,'result.json'),JSON.stringify({status:'PASS',sourceHashes:Object.fromEntries([...sources].map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')])),scope:'Local actual acquisition fallback, IndexedDB journals and intake client; synthetic request/storage; desktop Chrome and WebKit, not physical iPhone proof',results},null,2)+'\n');console.log(JSON.stringify({status:'PASS',output,results}));
}finally{await new Promise(resolve=>server.close(resolve));}
