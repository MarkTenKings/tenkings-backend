import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),babel=require('next/dist/compiled/babel/core'),nextRequire=createRequire(require.resolve('next/package.json'));
const code=babel.transformSync(readFileSync(new URL('../components/ReportResearchPicker.jsx',import.meta.url),'utf8'),{filename:'ReportResearchPicker.jsx',presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const all=(node,test,out=[])=>{if(Array.isArray(node))node.forEach(n=>all(n,test,out));else if(node&&typeof node==='object'){if(test(node))out.push(node);all(node.props?.children,test,out);}return out;};
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const slots=[],effects=[];let cursor=0,dirty=false,tree;const f={preview:null,pending:null,calls:0,disabled:false};
 const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],next=>{if(!Object.is(slots[index],next)){slots[index]=next;dirty=true;}}];},useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},useEffect(work,deps){const index=cursor++,before=slots[index];if(!before||deps.some((value,i)=>value!==before.deps[i])){slots[index]={deps,cleanup:before?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=work();});}}};
 const exports={};vm.runInNewContext(code,{exports,require(name){if(name==='react')return react;if(name.endsWith('.css'))return {};if(name==='./ReportMarketPicker')return {__esModule:true,default:'market'};if(name==='../lib/report-research-client.mjs')return {createReportResearchClient:()=>{throw Error('constructor belongs to outer component');}};return nextRequire(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);}});
 const outer=exports.default({staffId:'staff',cardId:'card',approvalActionId:'approval'});
 f.client={pendingObservation:()=>f.pending,async contribute(id){f.calls++;assert.equal(id,'preview');if(f.submit)return f.submit();return {state:'RECORDED'};},async reconcileObservation(){f.calls++;if(f.submit)return f.submit();f.pending=null;return {state:'RECORDED'};}};
 f.render=()=>{let count=0;do{dirty=false;cursor=0;const details=outer.props.renderDetails(f.preview,f.client);tree=details.type({...details.props,disabled:f.disabled});effects.splice(0).forEach(work=>work());assert.ok(++count<15);}while(dirty);return tree;};
 f.text=()=>text(tree);f.buttons=()=>all(tree,n=>n.type==='button');f.render();return f;
}
const preview=()=>({state:'READY',previewId:'preview',research:{identity:{reason:'Saved card identity'},photoIdentity:{reason:'Visible surface details'},catalog:{status:'no_publication'},queries:[{}],warnings:[],knowledge:{canContribute:true},candidates:[{id:'sale',title:'Source sale',listingUrl:'https://www.ebay.com/itm/123456789012',identityMatch:true,variantMatch:false,visualMatch:null,conditionDecision:{reason:'Different external grader'}}]}});
test('research evidence displays true, false and unknown comparisons and no automatic contribution',()=>{
 const f=fixture();assert.equal(f.render(),null);f.preview=preview();f.render();assert.match(f.text(),/Identity: matches\. Variant: does not match\. Photo: not established\./);assert.match(f.text(),/Shared catalog: no publication/);assert.equal(f.calls,0);
});
test('explicit contribution retains unknown recovery and successful receipt never claims reviewed knowledge',async()=>{
 const f=fixture();f.preview=preview();f.render();f.submit=()=>{f.pending={previewId:'preview'};throw Error('lost');};f.buttons()[0].props.onClick();await flush();f.render();assert.match(f.text(),/Check saved observation/);assert.match(f.text(),/not confirmed/);assert.equal(f.calls,1);
 f.submit=undefined;f.buttons()[0].props.onClick();await flush();f.render();assert.equal(f.calls,2);assert.match(f.text(),/not yet published shared knowledge/);assert.equal(f.buttons().length,0);
});
test('disabled action and double click cannot dispatch another observation',async()=>{
 const f=fixture();f.preview=preview();f.disabled=true;f.render();f.buttons()[0].props.onClick();assert.equal(f.calls,0);
 f.disabled=false;f.render();let finish;f.submit=()=>new Promise(resolve=>{finish=resolve;});f.buttons()[0].props.onClick();f.buttons()[0].props.onClick();assert.equal(f.calls,1);finish({state:'RECORDED'});await flush();f.render();assert.equal(f.buttons().length,0);
});
