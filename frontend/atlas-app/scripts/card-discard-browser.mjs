import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const {chromium,webkit}=createRequire(join(resolve(process.argv[2]),'__atlas__.cjs'))('playwright');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),output=resolve(process.argv[3]);mkdirSync(output,{recursive:true});
const files=new Map([['/batch.mjs','frontend/atlas-app/lib/batch-import.mjs'],['/client.mjs','packages/atlas-manual-intake/src/client.mjs'],
  ['/photo-bytes.mjs','packages/atlas-manual-intake/src/photo-bytes.mjs'],['/packages/atlas-manual-intake/src/photo-bytes.mjs','packages/atlas-manual-intake/src/photo-bytes.mjs']]);
const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/'?'text/html':'text/javascript');res.end(req.url==='/'?'<script type="module">import * as batch from "/batch.mjs";import * as intake from "/client.mjs";window.modules={batch,intake}</script>':files.has(req.url)?readFileSync(join(root,files.get(req.url))):'');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,results=[];
try{
 for(const [name,engine,options]of [['Chrome',chromium,{channel:'chrome'}],['WebKit',webkit,{}]]){
  const browser=await engine.launch({headless:true,...options});
  try{
   const context=await browser.newContext();await context.route('**/*',route=>{assert.equal(new URL(route.request().url()).origin,origin);return route.continue();});
   const page=await context.newPage();await page.goto(origin);await page.waitForFunction(()=>window.modules);
   const result=await page.evaluate(async()=>{
    const {batch,intake}=window.modules,staffId=crypto.randomUUID(),otherId=crypto.randomUUID(),photo=new File(['untouched original'],'original.heic',{type:'image/heic',lastModified:7});
    const a=batch.createBrowserBatchImportJournal({staffId}),b=batch.createBrowserBatchImportJournal({staffId}),other=batch.createBrowserBatchImportJournal({staffId:otherId});
    const items=Array.from({length:2},()=>({createId:crypto.randomUUID(),cardId:crypto.randomUUID(),enqueueId:crypto.randomUUID(),files:{FRONT:photo,BACK:photo},done:false}));
    const draft={id:crypto.randomUUID(),files:{FRONT:photo}};await a.put({version:1,items,draft});await other.put({version:1,items,draft});
    const stale=await a.get(),beforeReads=[];const originalGet=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(key){beforeReads.push(key);return originalGet.call(this,key);};
    await b.getMetadata();await b.retire({createRequestIds:[items[0].createId],cardIds:[items[0].cardId]});
    IDBObjectStore.prototype.get=originalGet;
    const metadataOnly=!beforeReads.some(key=>String(key).includes(':photo-bytes:'));
    await a.put(stale);const after=await a.get();
    const selected=after.items.length===1&&after.items[0].createId===items[1].createId&&after.draft.id===draft.id&&await after.items[0].files.FRONT.text()==='untouched original';
    await b.retire({createRequestIds:items.map(item=>item.createId),cardIds:items.map(item=>item.cardId),draftId:draft.id});
    await a.put(stale);const cleared=await a.get();
    const staleBatchFenced=cleared.items.length===0&&!cleared.draft;
    const u=intake.createBrowserIntakeJournal({staffId}),v=intake.createBrowserIntakeJournal({staffId}),op=crypto.randomUUID();
    const saved={kind:'upload',cardId:items[0].cardId,file:photo,input:{requestId:op,side:'FRONT',byteCount:photo.size}};
    await u.put(op,saved);await u.get(op);await v.retire({cardIds:[items[0].cardId],createRequestIds:[]});
    let lateCode;try{await u.put(op,saved);}catch(error){lateCode=error.code;}
    const lateNativeFenced=lateCode==='INTAKE_CARD_DELETED'&&!(await u.get(op))&&(await u.list()).length===0;
    const createId=crypto.randomUUID();await v.retire({createRequestIds:[createId],cardIds:[]});
    let createCode;try{await u.put(createId,{kind:'create',input:{requestId:createId}});}catch(error){createCode=error.code;}
    // The retirement commits while another journal is still reading bytes for
    // its first write; no data may be put after that acknowledged disposition.
    const raceId=crypto.randomUUID(),raceCard=crypto.randomUUID(),held=new Blob(['held native']);let release,entered;
    const began=new Promise(resolve=>entered=resolve);const bytes=await held.arrayBuffer();held.arrayBuffer=()=>{entered();return new Promise(resolve=>release=()=>resolve(bytes));};
    const writing=u.put(raceId,{kind:'upload',cardId:raceCard,file:held,input:{requestId:raceId,side:'BACK'}});await began;
    await v.retire({cardIds:[raceCard],createRequestIds:[]});release();let raceCode;try{await writing;}catch(error){raceCode=error.code;}
    const duringHashFenced=raceCode==='INTAKE_CARD_DELETED'&&!(await u.get(raceId));
    const unaffected=await other.get(),otherStaffPreserved=unaffected.items.length===2&&unaffected.draft.id===draft.id;
    const keys=async(name,store)=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const r=db.transaction(store,'readonly').objectStore(store).getAllKeys();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}};
    const allKeys=[...await keys('atlas-batch-originals-v1','imports'),...await keys('atlas-native-photo-intake-v1','pending')];
    const noDeletedBytes=allKeys.filter(key=>String(key).startsWith(`${staffId}:photo-bytes:`)).length===0;
    await Promise.all([a.close(),b.close(),other.close(),u.close(),v.close()]);
    return {metadataOnly,selected,staleBatchFenced,lateNativeFenced,createFenced:createCode==='INTAKE_CARD_DELETED',duringHashFenced,otherStaffPreserved,noDeletedBytes};
   });
   for(const [key,value]of Object.entries(result))assert.equal(value,true,`${name}: ${key}`);results.push({browser:name,...result});await context.close();
  }finally{await browser.close();}
 }
 const receipt={status:'PASS',scope:'Isolated desktop Chrome/WebKit synthetic IndexedDB deletion and late-write races; no owner browser or production access.',sourceHashes:Object.fromEntries([...new Set(files.values())].map(file=>[file,createHash('sha256').update(readFileSync(join(root,file))).digest('hex')])),results};
 writeFileSync(join(output,'result.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await new Promise(resolve=>server.close(resolve));}
