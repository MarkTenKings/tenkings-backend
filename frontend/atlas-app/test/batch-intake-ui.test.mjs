import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { batchImportDiagnostics, batchImportFailureDetails } from '../lib/batch-import.mjs';
const req=createRequire(new URL('../package.json',import.meta.url)),babel=req('next/dist/compiled/babel/core'),nextReq=createRequire(req.resolve('next/package.json'));
const code=babel.transformSync(readFileSync(new URL('../components/BatchImport.jsx',import.meta.url),'utf8'),{filename:'BatchImport.jsx',presets:[[req.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const all=(node,p,out=[])=>{if(Array.isArray(node))node.forEach(n=>all(n,p,out));else if(node&&typeof node==='object'){if(p(node))out.push(node);all(node.props?.children,p,out);}return out;};
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
function fixture({enabled=true,saved=null}={}){
 const f={sessionCalls:0,props:{staff:{id:'staff-a',role:'REVIEWER'},enabled},lock:false,runs:0,appends:[],closed:0,disposed:0,saved};
 const slots=[],effects=[];let cursor=0,dirty=false,tree;const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(slots[i],value)){slots[i]=value;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(work,deps){const i=cursor++,old=slots[i];if(!old||deps.some((x,j)=>x!==old.deps[j])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=work();});}}};
 const exports={};vm.runInNewContext(code,{exports,localStorage:{getItem:()=>null},window:{addEventListener(){},removeEventListener(){}},navigator:{locks:{request:async(_name,_opts,work)=>{assert.equal(f.lock,false);f.lock=true;try{return await work({});}finally{f.lock=false;}}}},require(name){if(name==='react')return react;if(name==='../lib/card-discard.mjs')return {hasPendingDiscard:()=>false,discardKey:id=>id,discardEvent:'discard',discardedIdsFromEvent:()=>null,createWorkspaceDiscarder:()=>({pending:()=>false,reconcile:async()=>({cardIds:[],createRequestIds:[]}),discard:async body=>{f.deletions??=[];f.deletions.push(body);f.saved=null;f.progress(null);return {cardIds:[],createRequestIds:[]};}})};if(name==='../../atlas-shared/RapidCardCamera.jsx')return {default:'rapid-camera'};if(name.endsWith('.css'))return {};if(name==='../lib/manual-client.mjs')return{manualRequest:async()=>{f.sessionCalls++;return {staff:f.props.staff,csrf:'fixture'};},manualMessage:e=>e.code??e.message};if(name==='@atlas/manual-intake/client')return{createBrowserIntakeJournal:()=>({close:async()=>{f.closed++;}}),createIntakeClient:()=>({})};if(name==='../lib/batch-import.mjs')return{batchImportDiagnostics,batchImportFailureDetails,createBrowserBatchImportJournal:()=>({close:async()=>{f.closed++;}}),createBatchImporter:options=>{f.progress=options.onProgress;return f.owner={read:async()=>f.saved,refresh:async()=>f.saved,pauseForDiscard:async()=>{},resumeAfterDiscard:()=>{},run:async()=>{f.runs++;},whenIdle:()=>f.idle?.promise??Promise.resolve(),saveSide:async(side,file)=>{if(f.persist)await f.persist.promise;f.saved??={version:1,items:[],draft:null};f.saved.draft??={files:{}};f.saved.draft.files[side]=file;if(f.saved.draft.files.FRONT&&f.saved.draft.files.BACK){f.appends.push([f.saved.draft.files.FRONT,f.saved.draft.files.BACK]);f.saved.items.push({done:false});f.saved.draft=null;}options.onProgress(f.saved);return f.saved;},append:async files=>{f.appends.push(files);},dispose:()=>{f.disposed++;return f.disposal?.promise??Promise.resolve();}};}};return nextReq(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);}});
 f.render=()=>{let count=0;do{dirty=false;cursor=0;tree=exports.default(f.props);effects.splice(0).forEach(work=>work());assert.ok(++count<20);}while(dirty);return tree;};
 f.inputs=()=>all(tree,n=>n.type==='input');f.select=(label,file)=>f.inputs().find(n=>n.props['aria-label']===label).props.onChange({target:{files:[file],value:'chosen'}});
 f.unmount=()=>slots.forEach(s=>s?.cleanup?.());f.render();return f;
}
test('continuous photo intake admits the next card after persistence, keeps one tab owner, and waits for disposal', async()=>{
 const pending={version:1,items:[{done:false}]},disabled=fixture({enabled:false,saved:pending});await flush();disabled.render();const disabledMountRuns=disabled.runs;assert.equal(disabledMountRuns,0);disabled.props.enabled=true;disabled.render();await flush();assert.equal(disabled.runs,1);disabled.render();await flush();assert.equal(disabled.runs,1);disabled.unmount();await flush();
 const f=fixture();await flush();f.render();assert.equal(f.lock,true);assert.equal(f.inputs().every(n=>!n.props.disabled),true);
 assert.equal(f.sessionCalls,0); // A stalled session refresh cannot block local capture.
 f.persist=deferred();f.idle=deferred();f.select('Batch Front photo',{name:'front1'});f.render();assert.equal(f.appends.length,0);assert.equal(f.inputs().every(n=>n.props.disabled),true);
 f.persist.resolve();await flush();f.render();assert.equal(f.inputs().find(n=>n.props['aria-label']==='Batch Front photo').props.disabled,true);assert.equal(f.inputs().find(n=>n.props['aria-label']==='Batch Back photo').props.disabled,false);
 f.persist=null;f.select('Batch Back photo',{name:'back1'});await flush();f.render();assert.equal(f.appends.length,1);assert.equal(f.inputs().every(n=>!n.props.disabled),true);
 f.select('Batch Front photo',{name:'front2'});await flush();f.render();f.select('Batch Back photo',{name:'back2'});await flush();f.render();assert.equal(f.appends.length,2);assert.equal(f.lock,true);
 f.disposal=deferred();f.unmount();await flush();assert.equal(f.disposed,1);assert.equal(f.closed,0);assert.equal(f.lock,true);f.disposal.resolve();f.idle.resolve();await flush();assert.equal(f.closed,2);assert.equal(f.lock,false);

});

test('uploaded pairs show current ATLAS job state and attention instead of a permanent queued claim',async()=>{
 const item={createId:'saved-pair',cardId:'saved-card',label:'Card 1',done:true},opened=[];
 const f=fixture({saved:{version:1,items:[item],draft:null}});f.props.onOpenCard=id=>opened.push(id);await flush();
 assert.match(text(f.render()),/1 uploaded to ATLAS/);assert.match(text(f.render()),/Checking grading status/);assert.doesNotMatch(text(f.render()),/Queued up/);
 for(const [state,stage,code,expected] of [
  ['QUEUED','PREPARE',null,'Queued up for ATLAS'],
  ['RUNNING','PREPARE',null,'ATLAS preparing'],
  ['RUNNING','ANALYZE',null,'ATLAS grading'],
  ['RUNNING','REPORT',null,'ATLAS preparing report'],
  ['NEEDS_ATTENTION','PREPARE','BATCH_GEOMETRY_NEEDS_REVIEW','Check edges before grading'],
  ['NEEDS_ATTENTION','PREPARE','BATCH_IDENTITY_NEEDS_REVIEW','Check card details before grading'],
  ['REVIEW','REPORT',null,'Ready for human review'],
  ['APPROVED','REPORT',null,'Approved'],
 ]){
  f.props.jobs=[{cardId:item.cardId,state,stage,code}];const rendered=f.render();assert.ok(text(rendered).includes(expected),expected);
  if(state!=='QUEUED')assert.doesNotMatch(text(rendered),/Queued up for ATLAS/);
  if(state==='NEEDS_ATTENTION'){const button=all(rendered,node=>node.type==='button'&&text(node).includes('Review card'))[0];assert.ok(button);button.props.onClick();}
 }
 assert.deepEqual(opened,['saved-card','saved-card']);
 f.props.jobs=[{cardId:'other-card',state:'QUEUED'}];assert.match(text(f.render()),/Checking grading status/);assert.doesNotMatch(text(f.render()),/Queued up/);
 assert.equal(item.done,true);assert.equal(f.appends.length,0);f.unmount();await flush();
});

test('visible Delete all cards control performs a server discard and resets the local roster',async()=>{
 const f=fixture({saved:{version:1,items:[{createId:'pending',label:'Card 1',done:false,code:'TEMPORARILY_UNAVAILABLE'}]}});
 await flush();let tree=f.render();const button=all(tree,node=>node.type==='button'&&text(node)==='Delete all cards')[0];
 assert.ok(button);assert.equal(button.props.disabled,false);button.props.onClick();await flush();tree=f.render();
 assert.deepEqual(JSON.parse(JSON.stringify(f.deletions)),[{scope:'ALL'}]);assert.equal(f.saved,null);assert.match(text(tree),/All cards deleted from your workspace and this device/);f.unmount();await flush();
});

test('another device sees verified originals and exact-side preparation attention from compact server progress',async()=>{
 const f=fixture(),opened=[];f.props.onOpenCard=id=>opened.push(id);await flush();
 const card={cardId:'remote-card',createRequestId:'remote-create',label:'Camera card',ready:false,
  sides:{FRONT:{verified:true,prepared:true},BACK:{verified:true,prepared:false}},
  ingestion:{FRONT:{stage:'ADMIT',state:'COMPLETE',code:null},BACK:{stage:'PREPARE',state:'ATTENTION',code:'PHOTO_FORMAT_UNSUPPORTED'}}};
 f.props.intakeCards=[card];let tree=f.render();
 assert.match(text(tree),/1 uploaded to ATLAS/);assert.match(text(tree),/Back · Unsupported format, including camera RAW/);
 assert.match(text(tree),/original retained/);assert.match(text(tree),/PHOTO_FORMAT_UNSUPPORTED/);
 assert.doesNotMatch(text(tree),/Checking grading status|Queued up for ATLAS/);
 all(tree,n=>n.type==='button'&&text(n).includes('Review card'))[0].props.onClick();assert.deepEqual(opened,['remote-card']);
 card.ingestion.BACK={stage:'PREPARE',state:'RUNNING',code:null};tree=f.render();assert.match(text(tree),/Front prepared · Back verified · Preparing/);
 card.ingestion.BACK={stage:'PREPARE',state:'QUEUED',code:'PHOTO_STORAGE_TIMEOUT'};
 tree=f.render();assert.match(text(tree),/Back · Preparation delayed; retrying automatically/);assert.match(text(tree),/PHOTO_STORAGE_TIMEOUT/);
 assert.doesNotMatch(text(tree),/Preparation queued|Resume saved uploads/);
 card.sides.BACK.verified=false;card.ingestion.BACK={stage:'VERIFY',state:'QUEUED',code:'INTAKE_UPLOAD_ABSENT'};
 tree=f.render();assert.match(text(tree),/Back · Waiting for original upload/);assert.match(text(tree),/0 uploaded to ATLAS/);
 assert.doesNotMatch(text(tree),/Uploading originals…/);f.unmount();await flush();
});
