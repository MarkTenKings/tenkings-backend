import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
const require = createRequire(new URL('../package.json', import.meta.url));
const nextRequire = createRequire(require.resolve('next/package.json'));
const compile = path => require('next/dist/compiled/babel/core').transformSync(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  filename: path, presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const all = (node, match) => Array.isArray(node) ? node.flatMap(value => all(value, match)) : node && typeof node === 'object'
  ? [...(match(node) ? [node] : []), ...all(node.props?.children, match)] : [];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node ?? '';
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(path, { request, customer = null, locks, strict = false, imports = {} } = {}) {
  let cursor = 0, tree; const slots = [], pending = [], calls = [], navigations = [], memory = new Map();
  const changed = (a,b) => !a || !b || a.length !== b.length || a.some((v,i) => v !== b[i]);
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], value => { slots[id] = typeof value === 'function' ? value(slots[id]) : value; }]; },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useCallback(value,deps) { const id = cursor++; if (changed(slots[id]?.deps,deps)) slots[id] = {value,deps}; return slots[id].value; },
    useEffect(fn,deps) { const id = cursor++; if (changed(slots[id]?.deps,deps)) { const old = slots[id]; slots[id] = {deps}; pending.push(() => { old?.cleanup?.(); slots[id].cleanup = fn(); if (strict && !old) { slots[id].cleanup?.(); slots[id].cleanup = fn(); } }); } },
  };
  const win = { location: {hash:'#token='+'A'.repeat(43),replace: path => navigations.push(path)},
    history:{replaceState(){win.location.hash='';}}, addEventListener(){},removeEventListener(){},
    sessionStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)} };
  function Stub() {} const exports = {};
  vm.runInNewContext(compile(path), {exports,AbortController,crypto:{randomUUID},setInterval:()=>1,clearInterval(){},
    document:{visibilityState:'visible'},window:win,navigator:{locks},require(name) {
      if (name.startsWith('next/dist/compiled/@babel/runtime/')) return nextRequire(name);
      if (name.startsWith('@babel/runtime/')) return nextRequire(`next/dist/compiled/${name}`);
      if (name === 'react') return react;
      if (Object.hasOwn(imports,name)) return imports[name];
      if (name.endsWith('/client.mjs')) return {request:async(path,options)=>{calls.push({path,options});return path==='/session'?{customer,csrf:'csrf'}:request(path,options);}};
      if (name.endsWith('/server/page.mjs')) return {customerPage:async()=>({props:{}})};
      return {default:Stub,__esModule:true};
    }});
  const render = (props={}) => {cursor=0;tree=exports.default(props);while(pending.length)pending.shift()();return tree;};
  return {exports,render,calls,navigations,memory,win,get tree(){return tree;}};
}

test('same original phone browser uses AUTO POST once and restores exact server draft, including Strict Mode', async () => {
  const id=randomUUID(),view=harness('../pages/verify-email.jsx',{customer:{id:'phone-account'},strict:true,
    locks:{request:async(_name,_options,work)=>work({})},request:async(path,options)=>{
      assert.equal(path,'/email/confirm');assert.equal(options.body.mode,'AUTO');return{verified:true,resumeDraftId:id};}});
  view.render();await tick();view.render();
  assert.equal(view.calls.filter(c=>c.path==='/email/confirm').length,1);
  assert.deepEqual(view.navigations,[`/account/submit?draft=${id}`]);
  assert.equal(view.win.location.hash,'');assert.equal(view.memory.size,0);
});
test('signed-out landing makes no confirmation request until explicit click and receives no draft/login', async () => {
  const view=harness('../pages/verify-email.jsx',{request:async(_path,options)=>{assert.equal(options.body.mode,'CONFIRM');return{verified:true};}});
  view.render();await tick();view.render();assert.equal(view.calls.length,1);assert.equal(view.calls[0].path,'/session');
  all(view.tree,n=>n.type==='button')[0].props.onClick();await tick();view.render();
  assert.match(text(view.tree),/Email verified/);assert.deepEqual(view.navigations,[]);
  assert.equal(all(view.tree,n=>n.type==='a').length,0);
});
test('different authenticated browser requires explicit confirmation when server refuses AUTO authority', async () => {
  const modes=[],view=harness('../pages/verify-email.jsx',{customer:{id:'other-account'},request:async(_p,o)=>{
    modes.push(o.body.mode);return o.body.mode==='AUTO'?{verified:false,requiresConfirmation:true}:{verified:true};}});
  view.render();await tick();view.render();assert.deepEqual(modes,['AUTO']);
  all(view.tree,n=>n.type==='button')[0].props.onClick();await tick();view.render();
  assert.deepEqual(modes,['AUTO','CONFIRM']);assert.equal(view.navigations.length,0);
});
test('existing camera owner keeps original tab; closed tab and missing lock API restore exact draft', async () => {
  const id=randomUUID();
  for(const held of [true,false]) {
    const view=harness('../pages/verify-email.jsx',{customer:{id:'phone-account'},
      ...(held?{locks:{request:async(_n,_o,fn)=>fn(null)}}:{}),request:async()=>({verified:true,resumeDraftId:id})});
    view.render();await tick();view.render();
    assert.equal(view.navigations.length,held?0:1);
    assert.equal(all(view.tree,n=>n.type==='a')[0].props.href,`/account/submit?draft=${id}`);
  }
});
test('waiting panel never sends on mount; uncertain request retains idempotency key for explicit replay', async () => {
  const status={state:'UNSENT',email:'a@example.invalid',required:true},calls=[];
  const view=harness('../components/intake/EmailVerificationPanel.jsx');
  const request=async(path,o)=>{calls.push({path,o});if(path.startsWith('/email/status'))return status;throw Error('synthetic lost response');};
  view.render({accountId:'a',draftId:'d',request,onVerified(){}});await tick();
  assert.equal(calls.length,1);assert(calls[0].path.startsWith('/email/status'));
  await assert.rejects(view.exports.requestEmailVerification(request,'a','d',status.email));
  await assert.rejects(view.exports.requestEmailVerification(request,'a','d',status.email));
  assert.equal(calls[1].o.body.requestId,calls[2].o.body.requestId);assert.equal(view.memory.size,1);
});
test('closed original tab without lock API resumes server-owned reviewed draft and never opens or clears local photos', async () => {
  const id=randomUUID(),draft={id,revision:4,state:'REVIEW',intakeMethod:'MAIL_IN',kioskId:null,profileSnapshot:{name:'Saved',email:'a@example.invalid'},cards:[{id:'saved-card'}]};
  function EmailPanel() {} const imports={
    './EmailVerificationPanel.jsx':{default:EmailPanel,__esModule:true},
    './ProfileFields.jsx':{default:()=>null,emptyProfile:{},completeProfile:()=>true,__esModule:true},
    '../../lib/capture-buffer.mjs':{createCaptureBuffer(){throw Error('must not open saved device photos without lock');}},
    '../../lib/capture-state.mjs':{captureCounts:()=>({count:1,waitingCount:0,ready:true})},
  };
  const view=harness('../components/intake/CustomerIntake.jsx',{imports,request:async path=>path===`/intake/drafts/${id}`?{draft}:{drafts:[draft]}});
  const props={customer:{id:'account',profile:{}},csrf:'csrf',resumeDraftId:id};
  view.render(props);await tick();view.render(props);
  const panel=all(view.tree,n=>n.type===EmailPanel)[0];assert.equal(panel.props.draftId,id);
  assert(view.calls.every(c=>c.options?.body===undefined));
  assert.match(text(view.tree),/uploaded photos are saved/);
});
test('explicit review saves the exact draft before sending its first email, with no effect-driven resend', async () => {
  const id=randomUUID(),draft={id,revision:2,state:'DRAFT',intakeMethod:'MAIL_IN',kioskId:null,cards:[{id:'photo-card'}]};
  const saved={...draft,state:'REVIEW',revision:3},events=[];
  const snapshot={pairIds:[],pairs:[],draftId:null,front:null};
  function EmailPanel() {} const imports={
    './EmailVerificationPanel.jsx':{default:EmailPanel,requestEmailVerification:async(request,_account,draftId)=>{
      events.push('SEND');return request('/email/request',{body:{draftId,requestId:randomUUID()}});},__esModule:true},
    './ProfileFields.jsx':{default:()=>null,emptyProfile:{},completeProfile:()=>true,intakeProfile:p=>p,__esModule:true},
    '../../lib/capture-state.mjs':{captureCounts:()=>({count:1,waitingCount:0,ready:true})},
    '../../lib/capture-buffer.mjs':{createCaptureBuffer:()=>({snapshot:async()=>snapshot,setService:async()=>{},attachDraft:async()=>({...snapshot,draftId:id}),close(){}})},
    '../../lib/intake-journal.mjs':{createBrowserIntakeJournal:()=>({close(){}}),createCustomerUploader:()=>({resume:async()=>{},dispose(){},whenIdle:async()=>{}})},
  };
  const view=harness('../components/intake/CustomerIntake.jsx',{imports,locks:{request:async(_n,_o,fn)=>fn({})},request:async(path,o)=>{
    if(path==='/intake/drafts')return{drafts:[draft]};
    if(path===`/intake/drafts/${id}/review`){events.push('SAVE');assert.equal(o.body.expectedRevision,2);return{draft:saved};}
    if(path===`/email/status?draftId=${id}`){events.push('STATUS');return{state:'UNSENT',required:true,email:'a@example.invalid'};}
    if(path==='/email/request'){assert.equal(o.body.draftId,id);return{state:'SENT',verified:false};}
    throw Error('Unexpected request '+path);
  }});
  const props={customer:{id:'account',profile:{name:'Saved',email:'a@example.invalid'}},csrf:'csrf'};
  view.render(props);await tick();view.render(props);
  all(view.tree,n=>n.type==='button'&&text(n).startsWith('Resume '))[0].props.onClick();await tick();view.render(props);
  all(view.tree,n=>n.type==='button'&&text(n).startsWith('Done adding cards'))[0].props.onClick();view.render(props);
  all(view.tree,n=>n.type==='button'&&text(n).startsWith('Continue to checkout'))[0].props.onClick();await tick();view.render(props);
  assert.deepEqual(events,['SAVE','STATUS','SEND']);
  view.render(props);await tick();view.render(props);assert.deepEqual(events,['SAVE','STATUS','SEND']);
  assert.equal(all(view.tree,n=>n.type===EmailPanel)[0].props.draftId,id);
});

test('lost send response keeps same-address identity but changed email and explicit fresh link each get a new request', async () => {
 const view=harness('../components/intake/EmailVerificationPanel.jsx'),ids=[];
 const request=async(_path,o)=>{ids.push(o.body.requestId);throw Error('synthetic lost response');};
 for(const email of ['a@example.invalid','a@example.invalid','b@example.invalid','b@example.invalid'])
  await assert.rejects(view.exports.requestEmailVerification(request,'account','draft',email));
 assert.equal(ids[0],ids[1]);assert.notEqual(ids[1],ids[2]);assert.equal(ids[2],ids[3]);
 await assert.rejects(view.exports.requestEmailVerification(request,'account','draft','b@example.invalid',{fresh:true}));
 assert.notEqual(ids[3],ids[4]);
});
