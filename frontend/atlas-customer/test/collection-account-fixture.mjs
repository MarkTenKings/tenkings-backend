// Test-only nested JSX/hook harness. It executes the actual account/hub/views,
// HTTP handlers, browser readers and v2 projector against synthetic capabilities.
// It is not React DOM/browser or database qualification; no socket is opened.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import * as collectionContract from '../lib/collection-contract.mjs';
import * as collectionClient from '../lib/collection-client.mjs';
import * as claimsClient from '../lib/ownership-claims-client.mjs';
import * as claimsTransport from '../lib/ownership-claims-transport.mjs';
import { CustomerAuth } from '../lib/server/auth.mjs';
import { makeConfig } from '../lib/server/config.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { createOwnershipClaimsHandler } from '../lib/server/ownership-claims-http.mjs';
import { createCollectionPreviewFixture } from './collection-preview-fixture.mjs';
import { CLAIM_ACCOUNT, createOwnershipClaimsFixture, createOwnershipClaimHistoryFixture } from './ownership-claims-fixture.mjs';
const require = createRequire(new URL('../package.json', import.meta.url)), babel = require('next/dist/compiled/babel/core');
const app = fileURLToPath(new URL('../', import.meta.url));
const compilation = new Map();
export const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes;reject=no; }); return {promise,resolve,reject}; };
export const all = (tree, test) => tree == null || typeof tree !== 'object' ? [] : [...(test(tree)?[tree]:[]), ...(tree.props?.children??[]).flat(Infinity).flatMap(x=>all(x,test))];
export const words = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree !== 'object' ? String(tree) : (tree.props?.children??[]).flat(Infinity).map(words).join(' ').replace(/\s+/g,' ');
export const button = (tree,label) => all(tree,x=>x.type==='button'&&words(x)===label)[0];
export function click(tree,label) { const b=button(tree,label);assert(b,label);assert(!b.props.disabled,label+' disabled');b.props.onClick(); }
export const flush = () => new Promise(resolve=>setImmediate(resolve));

export function createMountedCollectionFixture({history=true}={}) {
  const f={accountId:CLAIM_ACCOUNT,calls:[],reads:[],collectionUnavailable:false,collectionEmpty:false,historyUnavailable:false,refusal:null,hold:null,historyPage:null,historyResult:null,foreignCollection:false};
  f.customer={id:f.accountId,profile:{}};
  const config=makeConfig({origin:'https://atlas.example.invalid',cookies:{browser:'fixture_browser',session:'fixture_session'},sessionKey:Buffer.alloc(32,7),mode:'LOCAL_FIXTURE',
    deploymentId:'collection-account-fixture',releaseSha:'0'.repeat(40),accountSid:'AC'+'0'.repeat(32),serviceSid:'VA'+'0'.repeat(32),phoneKey:Buffer.alloc(32,8)});
  const token=Buffer.alloc(32,1).toString('base64url'),cookie=`fixture_browser=${token}; fixture_session=${token}`;
  const auth=new CustomerAuth({config,database:{call(){assert.fail('No general database');}}});
  auth.bootstrap=async()=>({customer:f.customer,csrf:'synthetic-csrf',browserToken:token});
  auth.logout=async()=>({ok:true});
  const capabilities={
    async readAccess(){if(f.refusal)throw {status:f.refusal};return {schema:'atlas-ownership-customer-access-v1',accountId:f.accountId};},
    async listClaims(_cookie,input){f.reads.push(['list_claims',input]);if(f.historyUnavailable)throw Error('private unready reader');return f.historyPage??createOwnershipClaimsFixture({accountId:f.accountId,count:8}).page;},
    async listHistory(_cookie,input){f.reads.push(['list_history',input]);return f.historyResult??createOwnershipClaimHistoryFixture({accountId:f.accountId,n:Number.parseInt(input.claimId.slice(0,8),16),afterRevision:input.afterRevision}).history;},
  };
  const state={auth,config,assertRequest(req){assert.equal(req.headers['x-fixture-hop'],'accepted');},clientAddress:()=> 'fixture',cookie:()=> 'fixture-cookie',
    ownershipRead:{async read(_cookie,action,input){
      f.reads.push([action,input]);assert.equal(action,'read_collection');if(f.refusal)throw Object.assign(Error('private'),{code:f.refusal===401?'SIGN_IN_REQUIRED':'CUSTOMER_ACCESS_NOT_ENABLED'});
      if(f.collectionUnavailable)throw Error('private missing reader');
      const value=createCollectionPreviewFixture().snapshot,id=f.foreignCollection?'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb':f.accountId;
      value.accountId=id;value.preferences.accountId=id;for(const card of value.cards)card.ownership.ownerAccountId=id;
      if(f.collectionEmpty)value.cards=[];return value;
    }},ownershipClaims:capabilities};
  state.ownershipHistory={handler:createOwnershipClaimsHandler(state)};
  const handler=createHandler(state);
  f.fetch=async(path,options={})=>{
    f.calls.push({path,options});
    const req=Object.assign(new EventEmitter(),{method:options.method??'GET',url:path.replace(/^\/account/,''),body:options.body?JSON.parse(options.body):'',headers:{cookie,'x-fixture-hop':'accepted','sec-fetch-site':'same-origin',...options.headers}});
    const res=Object.assign(new EventEmitter(),{headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(value){this.body=value;this.writableEnded=true;return this;}});
    await handler(req,res);
    const reply=()=>new Response(JSON.stringify(res.body),{status:res.code??200,headers:{...res.headers,'content-type':'application/json'}});
    if(f.hold?.match(path)){const hold=f.hold;hold.entered.resolve({path,options});await hold.release.promise;}
    return reply();
  };
  const modules=new Map(),instances=new Map(),typeIds=new Map(),listeners=new Map();let current=null,dirty=false,rootProps={initialView:'collection',historyConfiguredForDisplay:history},tree,idCounter=0;
  const changed=(a,b)=>!a||a.length!==b.length||a.some((x,i)=>x!==b[i]);
  const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState(initial){const instance=current,i=instance.cursor++;if(!(i in instance.slots))instance.slots[i]=typeof initial==='function'?initial():initial;
      return [instance.slots[i],value=>{assert(instance.mounted,'No state update after unmount');instance.slots[i]=typeof value==='function'?value(instance.slots[i]):value;dirty=true;}];},
    useId(){return react.useRef('fixture-'+(++idCounter)).current;},
    useRef(initial){const i=current.cursor++;if(!(i in current.slots))current.slots[i]={current:initial};return current.slots[i];},
    useMemo(fn,deps){const i=current.cursor++;if(changed(current.slots[i]?.deps,deps))current.slots[i]={deps,value:fn()};return current.slots[i].value;},
    useCallback(fn,deps){return react.useMemo(()=>fn,deps);},
    useEffect(fn,deps){const instance=current,i=instance.cursor++;if(changed(instance.slots[i]?.deps,deps)){const prior=instance.slots[i];instance.slots[i]={deps,effect:fn,cleanup:prior?.cleanup};instance.effects.push(()=>{prior?.cleanup?.();instance.slots[i].cleanup=fn();});}},
  };
  const window={sessionStorage:{getItem:()=>null},location:{assign:path=>{f.assigned=path;},reload:()=>{f.reloaded=true;}},addEventListener:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);},removeEventListener:(event,fn)=>listeners.get(event)?.delete(fn)};
  function load(file){
    if(modules.has(file))return modules.get(file);
    if(!compilation.has(file))compilation.set(file,babel.transformSync(readFileSync(file,'utf8'),{filename:file,presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}},'transform-runtime':{helpers:false}}]],babelrc:false,configFile:false}).code);
    const exports={};modules.set(file,exports);
    vm.runInNewContext(compilation.get(file),{exports,AbortController,AbortSignal,Promise,Intl,Date,fetch:f.fetch,window,document:{body:{style:{}}},crypto:globalThis.crypto,
      require:name=>{
        if(name==='react')return react;
        if(name==='next/head')return {__esModule:true,default:()=>null};
        if(name==='next/link')return {__esModule:true,default:props=>react.createElement('a',props,...props.children)};
        if(name.endsWith('.css'))return {};
        if(name.endsWith('/collection-contract.mjs'))return collectionContract;
        if(name.endsWith('/collection-client.mjs'))return {...collectionClient,readCollectionPage:input=>collectionClient.readCollectionPage(input,f.fetch)};
        if(name.endsWith('/ownership-claims-client.mjs'))return claimsClient;
        if(name.endsWith('/ownership-claims-transport.mjs'))return claimsTransport;
        if(name.endsWith('/client.mjs'))return {request:async(path,options={})=>{const r=await f.fetch('/account/api/customer'+path,{method:options.body===undefined?'GET':'POST',body:options.body===undefined?undefined:JSON.stringify(options.body)});if(!r.ok)throw Error('Account unavailable');return r.json();}};
        if(name.includes('/intake/')||name.includes('/orders/')||name.includes('/report-films/')||name.includes('/notifications/'))return {__esModule:true,default:()=>null,emptyProfile:{},intakeProfile:x=>x};
        if(name.startsWith('.'))return load(resolve(dirname(file),name));
        return require(name);
      }});
    return exports;
  }
  let Component=load(resolve(app,'components/AccountWorkspace.jsx')).default;
  function descend(node,path,seen){
    if(node==null||typeof node!=='object')return node;
    if(Array.isArray(node))return {type:'fragment',props:{children:node.map((x,i)=>descend(x,path+'.'+i,seen))}};
    if(typeof node.type==='function'){
      if(!typeIds.has(node.type))typeIds.set(node.type,typeIds.size);
      const key=path+':'+typeIds.get(node.type)+':'+(node.props.key??'');seen.add(key);
      let instance=instances.get(key);if(!instance){instance={slots:[],effects:[],mounted:true};instances.set(key,instance);}instance.cursor=0;current=instance;
      return descend(node.type(node.props),key,seen);
    }
    return {...node,props:{...node.props,children:(node.props?.children??[]).flat(Infinity).map((child,i)=>descend(child,path+'.'+i,seen))}};
  }
  function once(effects){const seen=new Set();tree=descend(react.createElement(Component,rootProps),'root',seen);
    for(const [key,instance]of instances)if(!seen.has(key)){for(const slot of instance.slots)slot?.cleanup?.();instance.mounted=false;instances.delete(key);}
    if(effects)for(const instance of instances.values())while(instance.effects.length)instance.effects.shift()();return tree;}
  f.render=(props=rootProps,{effects=true}={})=>{rootProps=props;if(!effects)return once(false);let count=0;do{dirty=false;once(true);assert(++count<30,'Render settled');}while(dirty);return tree;};
  f.useHub=(props)=>{Component=load(resolve(app,'components/collection/CollectionAccountWorkspace.jsx')).default;rootProps=props;};
  f.settle=async()=>{for(let n=0;n<5;n++){await flush();f.render();}return tree;};
  f.replayEffects=()=>{const slots=[...instances.values()].flatMap(i=>i.slots).filter(s=>s?.effect);for(const s of slots)s.cleanup?.();for(const s of slots)s.cleanup=s.effect();return f.render();};
  f.pagehide=()=>{for(const fn of [...listeners.get('pagehide')??[]])fn();};
  f.unmount=()=>{for(const instance of instances.values()){for(const slot of instance.slots)slot?.cleanup?.();instance.mounted=false;}instances.clear();};
  return f;
}
