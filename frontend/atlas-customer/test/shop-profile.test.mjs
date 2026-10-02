import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as profileContract from '../../../packages/atlas-customer-intake/src/profile.mjs';
import {profile as serverProfile} from '../lib/server/policy.mjs';
import * as captureState from '../lib/capture-state.mjs';
const require=createRequire(new URL('../package.json',import.meta.url)),nextRequire=createRequire(require.resolve('next/package.json'));
const compile=file=>require('next/dist/compiled/babel/core').transformSync(readFileSync(new URL(`../components/intake/${file}.jsx`,import.meta.url),'utf8'),{filename:`${file}.jsx`,presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const element=(type,props,...children)=>({type,props:{...props,children}});
const all=(node,match)=>Array.isArray(node)?node.flatMap(value=>all(value,match)):node&&typeof node==='object'?[...(match(node)?[node]:[]),...all(node.props?.children,match)]:[];
const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
const runtime=name=>name.startsWith('next/dist/compiled/@babel/runtime/')?nextRequire(name):name.startsWith('@babel/runtime/')?nextRequire(`next/dist/compiled/${name}`):undefined;
const fields={};vm.runInNewContext(compile('ProfileFields'),{exports:fields,require:name=>name==='react'?{createElement:element}:name==='@atlas/customer-intake/profile'?profileContract:runtime(name)});

test('shop fields expose name and required email, while mail retains full required return profile',()=>{
 const value={...fields.emptyProfile,name:'Alex'},shop=fields.default({value,onChange(){},intakeMethod:'DEALER_DROP_OFF'}),mail=fields.default({value,onChange(){}});
 const inputs=all(shop,n=>n.type==='input');assert.equal(inputs.length,2);assert.equal(inputs[0].props.required,true);assert.equal(inputs[1].props.required,true);assert.doesNotMatch(text(shop),/optional/);
 assert.equal(all(mail,n=>n.type==='input').length,8);assert.equal(fields.completeProfile(value,'DEALER_DROP_OFF'),false);assert.equal(fields.completeProfile(value,'MAIL_IN'),false);
 assert.deepEqual(fields.intakeProfile({...value,email:'alex@example.invalid',address1:'Saved return street'},'DEALER_DROP_OFF'),{name:'Alex',email:'alex@example.invalid'});
 assert.throws(()=>serverProfile({name:' Alex ',email:''},{allowContact:true}),{code:'CONTACT_DETAILS_REQUIRED'});
 assert.deepEqual(serverProfile({name:' Alex ',email:'alex@example.invalid'},{allowContact:true}),{name:'Alex',email:'alex@example.invalid'});
 assert.throws(()=>serverProfile({name:'Alex',email:''}));
 assert.throws(()=>serverProfile({name:'Alex',email:'bad'},{allowContact:true}),{code:'CONTACT_DETAILS_REQUIRED'});
 assert.throws(()=>serverProfile({name:'Alex',phone:'+12025550141'},{allowContact:true}));
});

async function intake(initialProfile){
 let cursor=0,tree,local={pairIds:[],pairs:[]};const slots=[],pending=[],calls=[];
 const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((v,i)=>v!==b[i]);
 const react={createElement:element,useState(initial){const id=cursor++;if(!(id in slots))slots[id]=initial;return[slots[id],v=>{slots[id]=typeof v==='function'?v(slots[id]):v;}];},
  useRef(initial){const id=cursor++;if(!(id in slots))slots[id]={current:initial};return slots[id];},
  useCallback(value,deps){const id=cursor++;if(changed(slots[id]?.deps,deps))slots[id]={value,deps};return slots[id].value;},
  useEffect(fn,deps){const id=cursor++;if(changed(slots[id]?.deps,deps)){const old=slots[id];slots[id]={deps};pending.push(()=>{old?.cleanup?.();slots[id].cleanup=fn();});}}};
 const draft={id:'fixture-draft',revision:1,state:'DRAFT',intakeMethod:'DEALER_DROP_OFF',kioskId:'fixture-shop',cards:[]};
 const buffer={snapshot:async()=>local,setService:async service=>(local={...local,service}),creation:async()=>({...local.service,requestId:'fixture-request'}),attachDraft:async draftId=>(local={...local,draftId}),close:async()=>{}};
 function Stub(){} function Camera(){} const exports={};
 vm.runInNewContext(compile('CustomerIntake'),{exports,AbortController,setInterval:()=>1,clearInterval(){},document:{visibilityState:'visible'},window:{sessionStorage:{}},navigator:{locks:{request:async(_n,_o,fn)=>fn({})}},require(name){
  if(runtime(name))return runtime(name);if(name==='react')return react;
  if(name.endsWith('/ProfileFields.jsx'))return {...fields,__esModule:true};
  if(name.endsWith('/capture-state.mjs'))return captureState;
  if(name.endsWith('/capture-buffer.mjs'))return{createCaptureBuffer:()=>buffer};
  if(name.endsWith('/intake-journal.mjs'))return{createBrowserIntakeJournal:()=>({close(){}}),createCustomerUploader:()=>({resume:async()=>{},dispose(){},whenIdle:async()=>{}})};
  if(name.endsWith('/client.mjs'))return{request:async(path,options)=>{calls.push({path,options});if(path==='/profile')return{customer:{id:'fixture',profile:options.body.profile}};return options?.body?{draft}:{drafts:[]};}};
  if(name.endsWith('/RapidCardCamera.jsx'))return{default:Camera,__esModule:true};return{default:Stub,__esModule:true};
 }});
 const render=()=>{cursor=0;tree=exports.default({customer:{id:'fixture',phone:'+12025550141',profile:initialProfile},csrf:'fixture',initialService:{intakeMethod:'DEALER_DROP_OFF',kioskId:'fixture-shop'},onCustomer(){}});while(pending.length)pending.shift()();};
 const settle=async()=>{for(let i=0;i<4;i++){render();await new Promise(resolve=>setImmediate(resolve));}render();};
 await settle();return{get tree(){return tree;},calls,settle,Camera};
}
test('first-time shop asks name and receipt email before camera, saves only compact contact and proceeds without address',async()=>{
 const view=await intake(null);assert.match(text(view.tree),/Who are we grading for/);assert.equal(all(view.tree,n=>n.type===view.Camera).length,0);
 const formFields=all(view.tree,n=>n.type===fields.default)[0];assert.equal(formFields.props.intakeMethod,'DEALER_DROP_OFF');formFields.props.onChange({...formFields.props.value,name:'Alex',email:'alex@example.invalid'});await view.settle();
 const form=all(view.tree,n=>n.type==='form')[0];form.props.onSubmit({preventDefault(){}});await view.settle();
 assert.deepEqual(view.calls.find(c=>c.path==='/profile').options.body.profile,{name:'Alex',email:'alex@example.invalid'});assert.equal(all(view.tree,n=>n.type===view.Camera).length,1);assert.match(text(view.tree),/Front. Back. Next./);
});
test('returning shop customer with saved name and email reaches camera without a duplicate profile step',async()=>{
 const view=await intake({name:'Alex',email:'alex@example.invalid'});assert.doesNotMatch(text(view.tree),/Who are we grading for/);assert.equal(all(view.tree,n=>n.type===view.Camera).length,1);assert.equal(view.calls.some(c=>c.path==='/profile'),false);
});

test('legacy name-only shop profile asks for email before a new intake without asking for a return address',async()=>{
 const view=await intake({name:'Alex'});assert.match(text(view.tree),/Who are we grading for/);
 const profile=all(view.tree,n=>n.type===fields.default)[0];assert.equal(profile.props.intakeMethod,'DEALER_DROP_OFF');
 assert.equal(all(view.tree,n=>n.type===view.Camera).length,0);assert.equal(view.calls.some(c=>c.path==='/profile'),false);
});
