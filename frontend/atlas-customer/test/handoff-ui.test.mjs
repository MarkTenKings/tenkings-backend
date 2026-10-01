import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../package.json',import.meta.url)),babel=require('next/dist/compiled/babel/core'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const compile=path=>babel.transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{filename:path,presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}},'transform-runtime':{helpers:false}}]],babelrc:false,configFile:false}).code;
const token='v1.12345678-1234-4234-9234-123456789012.'+'A'.repeat(43);
const handoff={id:randomUUID(),orderId:randomUUID(),reference:'ATLAS-TEST',location:{name:'Test card shop'},cardCount:2,status:'AWAITING_SHOP_RECEIPT',receipt:null,cards:[{cardId:randomUUID(),identity:{title:'First owned card'}},{cardId:randomUUID(),identity:{title:'Second owned card'}}]};
function harness(file,request,extras={}){
 let cursor=0;const slots=[],effects=[],changed=(a,b)=>!a||a.length!==b.length||a.some((v,i)=>v!==b[i]);
 const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),useState(initial){const n=cursor++;if(!(n in slots))slots[n]=initial;return[slots[n],v=>{slots[n]=typeof v==='function'?v(slots[n]):v;}];},useEffect(fn,deps){const n=cursor++;if(changed(slots[n]?.deps,deps)){slots[n]={deps};effects.push(fn);}}};
 const storage=new Map(),exports={};vm.runInNewContext(compile(file),{exports,Date,Number,Intl,crypto:{randomUUID},window:{location:{hash:'#'+token},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}},require:name=>name==='react'?react:name.endsWith('/client.mjs')?{request}:name.endsWith('.css')?{}:name.endsWith('DealerWorkspace')?{__esModule:true,default:()=>null}:require(name),...extras});
 return {render(props,name='default'){cursor=0;const tree=exports[name](props);while(effects.length)effects.shift()();return tree;},storage};
}
const all=(tree,predicate)=>!tree||typeof tree!=='object'?[]:[...(predicate(tree)?[tree]:[]),...(tree.props?.children??[]).flat(Infinity).flatMap(child=>all(child,predicate))];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('staff handoff requires every named paid card and exact count, preserves request ID after ambiguous response',async()=>{
 const calls=[],h=harness('../components/dealer/DealerHandoff.jsx',async(path,args)=>{calls.push({path,args});if(path.endsWith('/confirm'))throw {code:'TEMPORARILY_UNAVAILABLE'};return{handoff};}),props={data:{location:handoff.location},csrf:'dealer-csrf'};
 h.render(props,'DealerHandoffReview');await tick();let tree=h.render(props,'DealerHandoffReview');
 const submit=()=>all(tree,n=>n.type==='button'&&n.props.type==='submit')[0];assert.equal(submit().props.disabled,true);
 const checks=all(tree,n=>n.type==='input'&&n.props.type==='checkbox');assert.equal(checks.length,2);
 checks[0].props.onChange({target:{checked:true}});tree=h.render(props,'DealerHandoffReview');
 all(tree,n=>n.type==='input'&&n.props.inputMode==='numeric')[0].props.onChange({target:{value:'2'}});tree=h.render(props,'DealerHandoffReview');assert.equal(submit().props.disabled,true);
 all(tree,n=>n.type==='input'&&n.props.type==='checkbox')[1].props.onChange({target:{checked:true}});tree=h.render(props,'DealerHandoffReview');assert.equal(submit().props.disabled,false);
 await all(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});tree=h.render(props,'DealerHandoffReview');
 await all(tree,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
 const sent=calls.filter(c=>c.path.endsWith('/confirm'));assert.equal(sent.length,2);assert.deepEqual(sent[0].args.body,sent[1].args.body);assert.equal(sent[0].args.csrf,'dealer-csrf');assert.deepEqual([...sent[0].args.body.cardIds],[...handoff.cards.map(c=>c.cardId)].sort());
 assert(!('receivedAt' in sent[0].args.body));assert(!('accountId' in sent[0].args.body));
});
test('compact tracking opens and fetches QR even when awaiting-handoff projection was already loaded',async()=>{
 const calls=[],h=harness('../components/dealer/CustomerHandoff.jsx',async(path,args)=>{calls.push({path,args});return{handoff,qr:{size:29,path:'M4 4h1v1h-1z'}};}),props={orderId:handoff.orderId,csrf:'customer-csrf',compact:true,initial:{handoff}};
 let tree=h.render(props);assert.equal(calls.length,0);all(tree,n=>n.type==='button')[0].props.onClick();tree=h.render(props);await tick();tree=h.render(props);
 assert.equal(calls.length,1);assert.equal(calls[0].path,`/orders/${handoff.orderId}/handoff`);assert.equal(calls[0].args.csrf,'customer-csrf');assert.equal(all(tree,n=>typeof n.type==='function'&&n.type.name==='HandoffCode').length,1);
});
test('customer receipt renders QR reference without implying physical custody; received state removes QR',()=>{
 const exports={};vm.runInNewContext(compile('../components/dealer/CustomerHandoff.jsx'),{exports,Date,require:name=>name==='react'?React:name.endsWith('.css')?{}:name.endsWith('/client.mjs')?{}:require(name)});
 const qr={size:29,path:'M4 4h1v1h-1z'},unreceived=renderToStaticMarkup(React.createElement(exports.default,{orderId:handoff.orderId,initial:{handoff,qr}}));
 assert.match(unreceived,/role="img"/);assert.match(unreceived,/payment alone does not confirm receipt/);assert.doesNotMatch(unreceived,/Shop receipt confirmed|Your shop has your cards/);
 const received=renderToStaticMarkup(React.createElement(exports.default,{orderId:handoff.orderId,initial:{handoff:{...handoff,status:'RECEIVED',receipt:{id:randomUUID(),receivedAt:'2026-10-01T18:00:00Z',cardCount:2}},qr}}));
 assert.match(received,/Your shop has your cards/);assert.doesNotMatch(received,/<svg/);
});
