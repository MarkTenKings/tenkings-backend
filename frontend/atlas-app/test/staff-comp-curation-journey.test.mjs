// Actual JSX/controller/transport journey driver. Imported by the owned finite
// PG fixture; no test DB, listener, fake curation service or import-time effects.
// Hook renderer is a source-level harness, not DOM/browser acceptance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import * as history from '../lib/card-history-client.mjs';
import * as archive from '../lib/graded-cards-client.mjs';
import * as routes from '../lib/routes.mjs';
import * as orderDesk from '../lib/order-desk-client.mjs';
import * as controller from '../lib/staff-comp-curation-controller.mjs';
import * as entry from '../lib/staff-comp-curation-entry.mjs';
import * as client from '../lib/staff-comp-curation-client.mjs';
import * as sold from '@atlas/manual-workspace/sold-references';
import * as identity from '@atlas/grading-core/identity';
import * as reportEntry from '@atlas/site-router/report-entry';
const require=createRequire(import.meta.url),babel=require('next/dist/compiled/babel/core');
const words=tree=>(Array.isArray(tree)?tree.map(words).join(' '):tree==null||tree===false?'':typeof tree!=='object'?String(tree):words(tree.props?.children)).replace(/\s+/g,' ');
const nodes=(tree,predicate)=>Array.isArray(tree)?tree.flatMap(v=>nodes(v,predicate)):!tree||typeof tree!=='object'?[]:[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];
export function mountedCompJourney(props){
 const instances=new Map(),effects=[],window=new EventTarget();let current,cursor=0,dirty=false,tree,disposed=false;
 const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useState(initial){const at=cursor++,owner=current;if(!(at in owner))owner[at]=typeof initial==='function'?initial():initial;return [owner[at],value=>{if(disposed)return;const next=typeof value==='function'?value(owner[at]):value;if(!Object.is(next,owner[at])){owner[at]=next;dirty=true;}}];},
  useRef(initial){const at=cursor++;if(!(at in current))current[at]={current:initial};return current[at];},
  useEffect(fn,deps){const at=cursor++,owner=current,old=owner[at];if(!old||deps.some((v,i)=>v!==old.deps[i])){owner[at]={deps,fn};effects.push(()=>{old?.cleanup?.();owner[at].cleanup=fn();});}}
 };
 const modules=new Map();
 function compile(name){if(modules.has(name))return modules.get(name);const exports={};modules.set(name,exports);
  const code=babel.transformSync(readFileSync(new URL(`../components/${name}.jsx`,import.meta.url),'utf8'),{filename:`${name}.jsx`,
   presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}},'transform-runtime':{helpers:false}}]],babelrc:false,configFile:false}).code;
  vm.runInNewContext(code,{exports,Intl,URL,AbortController,window,crypto:webcrypto,require(path){
   if(path==='react')return react;if(path==='next/link')return 'a';
   if(path==='./Shell'||path==='./ApprovedCardMedia')return {__esModule:true,default:path.slice(2)};
   if(path==='./StaffCompCuration')return compile('StaffCompCuration');
   if(path.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_t,k)=>k})};
   const mapped={'../lib/card-history-client.mjs':history,'../lib/graded-cards-client.mjs':archive,'../lib/routes.mjs':routes,
    '../lib/order-desk-client.mjs':orderDesk,'../lib/staff-comp-curation-controller.mjs':controller,
    '../lib/staff-comp-curation-entry.mjs':entry,'../lib/staff-comp-curation-client.mjs':client,
    '@atlas/manual-workspace/sold-references':sold,'@atlas/grading-core/identity':identity,'@atlas/site-router/report-entry':reportEntry};
   if(mapped[path])return mapped[path];if(path==='../lib/client')return {api(){throw Error('No ordinary request fallback');}};return require(path);
  }});return exports;
 }
 const Component=compile('CardHistory').default;
 function resolveNode(node,path,seen){if(Array.isArray(node))return node.map((v,i)=>resolveNode(v,`${path}/${i}`,seen));if(!node||typeof node!=='object')return node;
  if(typeof node.type==='function'){const key=`${path}/${node.type.name}`,state=instances.get(key)??[];instances.set(key,state);seen.add(key);const prior=current,at=cursor;current=state;cursor=0;const value=node.type(node.props);current=prior;cursor=at;return resolveNode(value,`${key}/out`,seen);}
  return {...node,props:{...node.props,children:resolveNode(node.props?.children,`${path}/c`,seen)}};
 }
 function render(next=props,runEffects=true){props=next;let turns=0;do{dirty=false;const seen=new Set();tree=resolveNode({type:Component,props},'root',seen);
   if(runEffects){for(const [key,state]of instances)if(!seen.has(key)){for(const slot of state)slot?.cleanup?.();instances.delete(key);}while(effects.length)effects.shift()();}
   assert(++turns<40,'bounded hook render');}while(dirty&&runEffects);return tree;}
 function find(label){return nodes(tree,n=>n.type==='button'&&words(n).trim()===label)[0];}
 return {render,get tree(){return tree;},text:()=>words(tree),find,
  click(label){const button=find(label);assert(button,`${label}: ${words(tree).slice(-500)}`);assert(!button.props.disabled,label);button.props.onClick();render();},
  async until(pattern,observed=()=>true){const deadline=Date.now()+20000;do{
   // A browser event ends before the next user event. Yield before *every*
   // observation, including the first: act() deliberately queues a microtask,
   // so the old matching text cannot count as completion of the new action.
   await new Promise(r=>setTimeout(r,15));render();
   if(pattern.test(words(tree))&&!/Saving the private decision|Checking the exact saved decision|Reading saved evidence/.test(words(tree))&&observed())return tree;
  }while(Date.now()<deadline);assert.fail(`Did not reach ${pattern}: ${words(tree).slice(-1600)}`);},
  replay(){for(const state of instances.values())for(const slot of state)if(slot?.fn){slot.cleanup?.();slot.cleanup=slot.fn();}render();},
  pagehide(){window.dispatchEvent(new Event('pagehide'));render();},
  dispose(){disposed=true;for(const state of instances.values())for(const slot of state)slot?.cleanup?.();instances.clear();},
 };
}
export async function runMountedCompJourney(j){
 const append={'atlas_manual.comp_curation':{removed:0,added:1}},transport=j.browser();
 const props={staff:j.owner.staff,cardId:j.card.cardId,request:j.parentRequest,compCurationEnabled:false,compCurationRequest:transport.request};
 const h=mountedCompJourney(props);
 try{
  await j.phase('actual CardHistory default-off performs parent session/projection only',{},async()=>{
   await h.until(/SYNTHETIC restricted-role journey/);h.click('Sold comps');assert(!h.text().includes('Private comp selection'));assert.equal(j.privateExchanges.length,0);
  });j.checks.push('real parent default-off; synthetic history projection explicitly separated');
  props.compCurationEnabled=true;
  await j.phase('real panel resolves saved pool through read client and curation through restricted writer',{},async()=>{
   h.render(props);await h.until(/policy is unavailable/);assert.equal(h.find('Save private selection')?.props.disabled,true);assert(h.find('Skip for now'));
   assert(j.exchanges.some(r=>r.path.endsWith('/presentation/market')&&r.status===200));assert(j.privateExchanges.some(r=>r.method==='GET'&&r.status===200));
  });j.checks.push('CardHistory → entry → Response → real session/proxy/signer/private/native/service → restricted PG');
  await j.phase('human Skip adds one null-guidance private receipt',append,async()=>{h.click('Skip for now');await h.until(/Skipped for now/);const m=await j.metrics();assert.equal(m.last.outcome,'SKIP');assert.equal(m.last.guidance,null);assert.equal(m.last.policy,null);});
  await j.phase('human reload is read-only',{},async()=>{h.click('Review saved evidence');await h.until(/policy is unavailable/);});
  await j.phase('human No suitable adds one private receipt',append,async()=>{h.click('No suitable comps');await h.until(/No suitable comps recorded/);assert.equal((await j.metrics()).last.outcome,'NO_SUITABLE_COMPS');});
  await j.phase('reload before uncertain outcome is read-only',{},async()=>{h.click('Review saved evidence');await h.until(/policy is unavailable/);});
  let lost=false;
  j.hooks.afterNative=({method,result})=>{if(method==='POST'&&result.status===200&&!lost){lost=true;throw Error('SYNTHETIC response lost after committed native receipt');}};
  await j.phase('lost response leaves UI unresolved without auto-replay',append,async()=>{
   const before=(await j.metrics()).posts;h.click('Skip for now');await h.until(/Save outcome not confirmed/);assert.equal((await j.metrics()).posts,before+1);assert.equal(h.find('Skip for now'),undefined);
  });j.hooks.afterNative=null;
  await j.phase('exact recorded decision resolves uncertainty via GET only',{},async()=>{const before=(await j.metrics()).posts;h.click('Check recorded decision');await h.until(/Skipped for now/);assert.equal((await j.metrics()).posts,before);});
  await j.phase('reload for historical replay case',{},async()=>{h.click('Review saved evidence');await h.until(/policy is unavailable/);});
  lost=false;let original;
  j.hooks.afterNative=async({method,body,result})=>{if(method==='POST'&&result.status===200&&!lost){lost=true;original=structuredClone(body);await j.appendLaterReceipt(body);throw Error('SYNTHETIC lost reply with a newer explicit receipt');}};
  await j.phase('newer explicit same-looking decision exists after original lost reply',{'atlas_manual.comp_curation':{removed:0,added:2}},async()=>{h.click('Skip for now');await h.until(/Save outcome not confirmed/);});j.hooks.afterNative=null;
  await j.phase('later same-looking choice cannot prove original outcome; same-ID replay does',{},async()=>{
   const before=(await j.metrics()).posts,reads=j.privateExchanges.filter(r=>r.method==='GET').length;
   h.click('Check recorded decision');await h.until(/Save outcome not confirmed/,()=>j.privateExchanges.filter(r=>r.method==='GET').length===reads+1&&h.find('Retry this same save')?.props.disabled===false);
   const completedRead=j.privateExchanges.filter(r=>r.method==='GET').at(-1);assert.equal(completedRead.status,200);
   assert.equal((await j.metrics()).posts,before);assert.equal(h.find('Retry this same save').props.disabled,false);
   h.click('Retry this same save');await h.until(/Skipped for now/);const posts=j.privateExchanges.filter(r=>r.method==='POST');assert.equal(posts.at(-1).requestId,original.requestId);assert.equal((await j.metrics()).posts,before+1);
  });j.checks.push('real lost-reply exact current receipt and original same-ID historical replay; no automatic mutation retry');
  await j.phase('same-ID account object replacement fences old mounted handlers before effects',{},async()=>{
   h.click('Review saved evidence');await h.until(/policy is unavailable/);const stale=h.find('Skip for now').props.onClick,before=(await j.metrics()).posts;
   h.render({...props,staff:{...props.staff}},false);stale();await new Promise(r=>setTimeout(r,30));assert.equal((await j.metrics()).posts,before);
  });
  h.render(props);await h.until(/policy is unavailable/);
  await j.phase('actual session account change ends private scope and clears parent',{},async()=>{
   j.setActor('other');h.click('Skip for now');await h.until(/Sign in again/);assert(!h.text().includes('SYNTHETIC restricted-role journey'));
  });j.checks.push('account and late-handler teardown across real session wire');
  assert(j.privateExchanges.every(r=>/\/comp-curation(?:\?|\/decision)/.test(r.path)));
  assert(j.exchanges.every(r=>!r.path.includes('/search')&&!r.path.includes('/presentation/select')));
 }finally{j.hooks.afterNative=null;j.hooks.beforeFrontend=null;h.dispose();transport.close();j.setActor('owner');}
}

export async function runMountedSchedulingGuard() {
 // Actual mounted JSX/controller/service with the existing in-memory boundary.
 // This isolates event scheduling; the finite run separately proves real PG.
 const {compUIFixture,flush,deferred}=await import('./staff-comp-curation-ui-fixture.mjs');
 const f=await compUIFixture({policyDisabled:true});
 const detail=history.readCardHistory({schemaVersion:1,card:{...f.card,certificateNumber:'ATLAS-ABCDEF123456',
  identity:{category:'SPORTS',playerName:'SYNTHETIC scheduling guard'},finalGrade:9,approvedAt:'2026-10-20T00:00:00.000000Z',
  report:{...f.card.report,path:`/reports/${f.card.report.publicToken}?v=${f.card.report.version}`},media:{},savedComparables:{state:'UNAVAILABLE'}},
  ownership:{status:'UNKNOWN',verification:'UNKNOWN',history:[]},custody:{status:'UNKNOWN',currentPhysicalHolder:'UNKNOWN'},
  history:{scope:'RECORDED_ATLAS_EVENTS',complete:false,snapshot:'2026-10-22T08:00:00.000000Z',events:[],nextCursor:null}},f.cardId);
 const h=mountedCompJourney({staff:f.staff,cardId:f.cardId,request:async path=>path==='session'?{staff:f.staff}:structuredClone(detail),
  compCurationEnabled:true,compCurationRequest:f.request}),gate=deferred(),entered=deferred();
 try {
  await h.until(/SYNTHETIC scheduling guard/);h.click('Sold comps');await h.until(/policy is unavailable/);
  let lose=true;f.hooks.response=({method})=>{if(method==='POST'&&lose){lose=false;throw Error('SYNTHETIC retained reply loss');}};
  h.click('Skip for now');await h.until(/Save outcome not confirmed/);
  const original=structuredClone(f.traffic.find(r=>r.method==='POST').body);
  await f.service.decide(f.staff,f.cardId,{...original,requestId:webcrypto.randomUUID(),expectedSelectionRevision:1});
  let readEntered=false,completed=false,settled=false;
  f.hooks.response=async({method})=>{if(method==='GET'){readEntered=true;entered.resolve();await gate.promise;completed=true;}};
  const posts=f.traffic.filter(r=>r.method==='POST').length;
  h.click('Check recorded decision');
  // This was the old driver's premature success condition, before act() runs.
  assert.match(h.text(),/Save outcome not confirmed/);assert.equal(readEntered,false);assert.equal(h.find('Retry this same save').props.disabled,false);
  const waiting=h.until(/Save outcome not confirmed/,()=>completed&&h.find('Retry this same save')?.props.disabled===false).then(()=>{settled=true;});
  await entered.promise;await flush();h.render();
  assert.equal(settled,false);assert.equal(completed,false);assert.equal(h.find('Retry this same save').props.disabled,true);
  assert.equal(f.traffic.filter(r=>r.method==='POST').length,posts);
  gate.resolve();await waiting;assert.equal(completed,true);assert.equal(h.find('Retry this same save').props.disabled,false);
  f.hooks.response=null;h.click('Retry this same save');await h.until(/Skipped for now/);
  const sent=f.traffic.filter(r=>r.method==='POST');assert.equal(sent.length,posts+1);assert.deepEqual(sent.at(-1).body,original);
  assert.equal(f.calls.insert,2);assert.equal(f.rows.length,2);assert.match(h.text(),/Revision 1/);
  return {prematureOldViewObserved:true,deferredReadEntered:true,waitStayedPendingUntilReadCompleted:true,
   retryEnabledAfterCompletion:true,replayedOriginalRequest:true,posts:sent.length,insertedReceipts:2,productChanged:false,database:false};
 }finally {gate.resolve();f.hooks.response=null;h.dispose();}
}

export async function runCompJourneyPlanGuards({output,roleResult,schemaPath}) {
 // Defer this test-only import: the executable runner itself awaits this
 // driver's module, so a static back-import deadlocks top-level evaluation.
 const fixtureUrl=new URL('../../../packages/atlas-connected-manual/test/fixtures/staff-comp-curation-journey-postgres.mjs',import.meta.url);
 const {prepareCompJourney,validateCompJourneyPlan}=await import(fixtureUrl);
 const child=spawnSync(process.execPath,[fileURLToPath(fixtureUrl),'--check-driver-import'],{encoding:'utf8',timeout:5000,maxBuffer:1048576});
 assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'MOUNTED_DRIVER_IMPORT_SETTLED');
 let timer;const scheduling=await Promise.race([runMountedSchedulingGuard(),new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(Error('Mounted scheduling guard exceeded 5s')),5000);})]).finally(()=>clearTimeout(timer));
 const prepared=await prepareCompJourney({output,roleResult,schemaPath,purpose:'finite',dbPort:55439});
 const plan=JSON.parse(await readFile(prepared.planPath,'utf8'));
 assert.equal(validateCompJourneyPlan(plan,output,'finite'),plan);assert.equal(typeof plan.schema,'string');assert.equal(plan.schemaRef.path,schemaPath);
 for(const mutate of [p=>{p.schema=p.schemaRef;delete p.schemaRef;},p=>{p.output+='/other';},p=>{p.purpose='preview';},p=>{p.nonce='wrong';},p=>{p.port=0;},p=>{p.sources=[];}]){
  const invalid=structuredClone(plan);mutate(invalid);assert.throws(()=>validateCompJourneyPlan(invalid,output,'finite'));
 }
 const result={pass:true,scheduling,checks:['actual mounted deferred reconciliation cannot match old text and exact same-ID retry completes without another row','actual executable runner→dynamic driver import settles in bounded child process without DB/listener','actual inert prepare→JSON→same validator used before execute','schema discriminator/reference cannot collide','output/purpose/nonce/port/source closure mutations refuse'],planSha256:prepared.sha256,clusterStarted:false,listenerStarted:false};
 await writeFile(resolve(output,'plan-guards.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)&&process.argv[2]==='--plan-guards'){
 const [mode,output,roleResult,schemaPath]=process.argv.slice(2);assert.equal(mode,'--plan-guards');assert.equal(process.argv.length,6);
 console.log(JSON.stringify(await runCompJourneyPlanGuards({output,roleResult,schemaPath})));
}
