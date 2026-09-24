import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const req=createRequire(new URL('../package.json',import.meta.url)),babel=req('next/dist/compiled/babel/core'),nextReq=createRequire(req.resolve('next/package.json'));
const code=babel.transformSync(readFileSync(new URL('../components/BatchImport.jsx',import.meta.url),'utf8'),{filename:'BatchImport.jsx',presets:[[req.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const all=(node,p,out=[])=>{if(Array.isArray(node))node.forEach(n=>all(n,p,out));else if(node&&typeof node==='object'){if(p(node))out.push(node);all(node.props?.children,p,out);}return out;};
function fixture({enabled=true,saved=null}={}){
 const f={props:{staff:{id:'staff-a',role:'REVIEWER'},enabled},lock:false,runs:0,appends:[],closed:0,disposed:0,saved};
 const slots=[],effects=[];let cursor=0,dirty=false,tree;const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(slots[i],value)){slots[i]=value;dirty=true;}}];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(work,deps){const i=cursor++,old=slots[i];if(!old||deps.some((x,j)=>x!==old.deps[j])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=work();});}}};
 const exports={};vm.runInNewContext(code,{exports,navigator:{locks:{request:async(_name,_opts,work)=>{assert.equal(f.lock,false);f.lock=true;try{return await work({});}finally{f.lock=false;}}}},require(name){if(name==='react')return react;if(name.endsWith('.css'))return {};if(name==='../lib/manual-client.mjs')return{manualRequest:async()=>({staff:f.props.staff,csrf:'fixture'}),manualMessage:e=>e.code??e.message};if(name==='@atlas/manual-intake/client')return{createBrowserIntakeJournal:()=>({close:async()=>{f.closed++;}}),createIntakeClient:()=>({})};if(name==='../lib/batch-import.mjs')return{createBrowserBatchImportJournal:()=>({close:async()=>{f.closed++;}}),createBatchImporter:options=>{f.progress=options.onProgress;return f.owner={read:async()=>f.saved,run:async()=>{f.runs++;},whenIdle:()=>f.idle?.promise??Promise.resolve(),appendPair:async(front,back)=>{f.appends.push([front,back]);if(f.persist)await f.persist.promise;},append:async files=>{f.appends.push(files);},dispose:()=>{f.disposed++;return f.disposal?.promise??Promise.resolve();}};}};return nextReq(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);}});
 f.render=()=>{let count=0;do{dirty=false;cursor=0;tree=exports.default(f.props);effects.splice(0).forEach(work=>work());assert.ok(++count<20);}while(dirty);return tree;};
 f.inputs=()=>all(tree,n=>n.type==='input');f.select=(label,file)=>f.inputs().find(n=>n.props['aria-label']===label).props.onChange({target:{files:[file],value:'chosen'}});
 f.unmount=()=>slots.forEach(s=>s?.cleanup?.());f.render();return f;
}
test('continuous photo intake admits the next card after persistence, keeps one tab owner, and waits for disposal', async()=>{
 const pending={version:1,items:[{done:false}]},disabled=fixture({enabled:false,saved:pending});await flush();disabled.render();const disabledMountRuns=disabled.runs;assert.equal(disabledMountRuns,0);disabled.props.enabled=true;disabled.render();await flush();assert.equal(disabled.runs,1);disabled.render();await flush();assert.equal(disabled.runs,1);disabled.unmount();await flush();
 const f=fixture();await flush();f.render();assert.equal(f.lock,true);assert.equal(f.inputs().every(n=>!n.props.disabled),true);
 f.persist=deferred();f.idle=deferred();f.select('Batch Front photo',{name:'front1'});f.render();assert.equal(f.appends.length,0);f.select('Batch Back photo',{name:'back1'});f.render();assert.equal(f.appends.length,1);assert.equal(f.inputs().every(n=>n.props.disabled),true);
 f.persist.resolve();await flush();f.render();assert.equal(f.inputs().every(n=>!n.props.disabled),true);f.persist=null;f.select('Batch Front photo',{name:'front2'});f.render();f.select('Batch Back photo',{name:'back2'});await flush();f.render();assert.equal(f.appends.length,2);assert.equal(f.lock,true);
 f.disposal=deferred();f.unmount();await flush();assert.equal(f.disposed,1);assert.equal(f.closed,0);assert.equal(f.lock,true);f.disposal.resolve();f.idle.resolve();await flush();assert.equal(f.closed,2);assert.equal(f.lock,false);

});
