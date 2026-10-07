import * as routes from '../lib/routes.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as client from '../lib/identity-correction-client.mjs';
const require=createRequire(import.meta.url),babel=require('next/dist/compiled/babel/core'),nextRequire=createRequire(require.resolve('next/package.json'));
const compiled=babel.transformSync(readFileSync(new URL('../components/IdentityCorrection.jsx',import.meta.url),'utf8'),{
    filename:'IdentityCorrection.jsx',presets:[[require.resolve('next/babel'),{'preset-env':{targets:{node:'current'}}}]],babelrc:false,configFile:false}).code;
const makeCard=()=>({id:randomUUID(),canEdit:true,evidenceRevision:3,evidenceHash:'a'.repeat(64),reviewHash:'b'.repeat(64),
    draft:{revision:7,identityReviewed:true,reviewedSides:['FRONT','BACK'],observations:{FRONT:'Preserved note',BACK:'Other note'},disposition:'READY_FOR_HUMAN'},
    grading:{analysisRevision:2,analysisHash:'c'.repeat(64),sourceRevision:'2026-09-08T10:00:00.000Z',pendingOperations:0,
        report:{cardProfile:'SPORTS',identity:{playerName:'Original Player',year:'2020',manufacturer:'Example',productSet:'Sample',parallel:null,insert:null,cardNumber:'14'}}}});
function receipt(body){return{status:'CORRECTED',receiptId:randomUUID(),operationId:body.operationId,analysisRevision:3,reviewRevision:8,evidenceRevision:4,
    evidenceHash:'d'.repeat(64),sourceHash:'e'.repeat(64),reviewHash:'f'.repeat(64),createdAt:'2026-09-08T10:01:00.000Z'};}
function corrected(card){const value=structuredClone(card);Object.assign(value,{evidenceRevision:4,evidenceHash:'d'.repeat(64),reviewHash:'f'.repeat(64)});
    Object.assign(value.grading,{analysisRevision:3,analysisHash:'e'.repeat(64)});Object.assign(value.draft,{revision:8,identityReviewed:false,reviewedSides:[],disposition:'IN_REVIEW'});
    value.grading.report.identity.playerName='Corrected Player';return value;}
function harness(){
    const slots=[],effects=[];let cursor=0,tree,guard;
    const react={Fragment:'fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),
        useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},
        useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},
        useEffect(action,deps){const i=cursor++,before=slots[i];if(!before||deps.some((v,n)=>v!==before[n])){slots[i]=deps;effects.push(action);}}};
    const f={calls:[],locks:[],applied:[],accessCalls:0,token:'2'.repeat(64),respond:async()=>{throw Error('Unexpected synthetic request');},
        props:{card:makeCard(),csrf:'1'.repeat(64),disabled:false}};
    f.props.onPendingChange=value=>f.locks.push(value);
    f.props.onCorrected=value=>{f.applied.push(value);f.props.card=value;};
    f.props.refreshAccess=async()=>{f.accessCalls++;return f.token;};
    const exports={};vm.runInNewContext(compiled,{exports,structuredClone,crypto:{randomUUID},require(name){
        if(name==='react')return react;
        if(name==='../lib/routes.mjs')return routes;
        if(name==='./MachinePreparation')return{operationsRequest:async(path,options={})=>{f.calls.push({path,...options,body:options.body&&structuredClone(options.body)});return f.respond(path,options);}};
        if(name==='../lib/usePendingNavigation')return{usePendingNavigation:fn=>{guard=fn;}};
        if(name==='../lib/identity-correction-client.mjs')return client;
        if(name.endsWith('.module.css'))return{};
        return nextRequire(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);
    }});
    const all=(node,predicate,out=[])=>{if(Array.isArray(node))node.forEach(n=>all(n,predicate,out));else if(node&&typeof node==='object'){if(predicate(node))out.push(node);all(node.props?.children,predicate,out);}return out;};
    const text=node=>Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):node??'';
    f.render=()=>{cursor=0;tree=exports.default(f.props);for(const effect of effects.splice(0))effect();return tree;};
    f.find=(type,label)=>{const result=all(tree,n=>n.type===type&&(label===undefined||text(n).includes(label)))[0];assert.ok(result,`${type}: ${label}`);return result;};
    f.has=(type,label)=>all(tree,n=>n.type===type&&text(n).includes(label)).length>0;
    f.change=(label,value)=>{const field=f.find('label',label),input=all(field,n=>['input','textarea','select'].includes(n.type))[0];input.props.onChange({target:{value}});f.render();};
    f.prepare=()=>{f.change('Player name','Corrected Player');f.change('Reason for this correction','Checked the printed identity.');
        const checkbox=all(tree,n=>n.type==='input'&&n.props.type==='checkbox')[0];checkbox.props.onChange({target:{checked:true}});f.render();};
    f.submit=async()=>{await f.find('form').props.onSubmit({preventDefault(){}});f.render();};
    f.click=async label=>{await f.find('button',label).props.onClick();f.render();};
    f.pending=()=>guard();f.writes=()=>f.calls.filter(row=>row.body);f.render();return f;
}

test('actual correction retry keeps exact request through disabled props and bad fresh CSRF, then updates parent access',async()=>{
    const f=harness(),originalCard=f.props.card;f.prepare();f.respond=async()=>{throw Error('Lost reply');};await f.submit();
    const original=f.writes()[0].body;assert.equal(f.pending(),true);
    f.props.disabled=true;f.props.csrf='3'.repeat(64);f.token='invalid';f.render();await f.click('Retry exact identity');
    assert.equal(f.writes().length,1);assert.equal(f.pending(),true);assert.equal(f.accessCalls,1);
    f.token='4'.repeat(64);f.respond=async(path,{body})=>body?{correction:receipt(body)}:{card:corrected(originalCard)};
    await f.click('Retry exact identity');assert.equal(f.accessCalls,2);assert.deepEqual(f.writes()[1].body,original);assert.equal(f.writes()[1].csrf,'4'.repeat(64));
    assert.equal(f.pending(),false);assert.equal(f.locks.at(-1),false);assert.equal(f.applied.length,1);
    assert.equal(f.applied[0].draft.identityReviewed,false);assert.deepEqual(f.applied[0].draft.reviewedSides,[]);assert.equal(f.applied[0].draft.observations.FRONT,'Preserved note');
    assert.equal(f.calls.some(row=>row.path==='session'),false,'Parent callback owns access refresh.');
});

test('confirmed correction with failed reload keeps parent locked and reload retry never posts again',async()=>{
    const f=harness(),originalCard=f.props.card;f.prepare();f.respond=async(path,{body})=>{if(body)return{correction:receipt(body)};throw{status:401};};await f.submit();
    assert.equal(f.has('button','Retry exact identity'),false);assert.equal(f.has('button','Reload corrected card'),true);assert.equal(f.pending(),true);assert.equal(f.locks.at(-1),true);
    f.props.disabled=true;f.render();f.respond=async path=>{assert.equal(path,`cards/${originalCard.id}`);return{card:corrected(originalCard)};};
    await f.click('Reload corrected card');assert.equal(f.accessCalls,1);assert.equal(f.writes().length,1);assert.equal(f.pending(),false);assert.equal(f.locks.at(-1),false);
});

test('captured correction target cannot reload a different specimen after prop changes or release on stale heads',async()=>{
    const f=harness(),originalCard=f.props.card;f.prepare();f.respond=async()=>{throw Error('Lost reply');};await f.submit();const original=f.writes()[0].body;
    f.props.card=makeCard();f.render();f.respond=async(path,{body})=>{assert.equal(path,`cards/${originalCard.id}/identity-correction`);return{correction:receipt(body)};};
    await f.click('Retry exact identity');assert.deepEqual(f.writes()[1].body,original);assert.equal(f.applied.length,0);assert.equal(f.calls.length,2);assert.equal(f.pending(),true);
    await f.click('Reload corrected card');assert.equal(f.calls.length,2);assert.equal(f.applied.length,0);
    f.props.card=originalCard;f.render();f.respond=async()=>({card:originalCard});await f.click('Reload corrected card');
    assert.equal(f.applied.length,0);assert.equal(f.pending(),true);assert.equal(f.locks.at(-1),true);
    f.respond=async()=>({card:corrected(originalCard)});await f.click('Reload corrected card');assert.equal(f.applied.length,1);assert.equal(f.pending(),false);assert.equal(f.writes().length,2);
});

test('malformed receipt never unlocks and a later signed-out response preserves the original correction',async()=>{
    const f=harness();f.prepare();f.respond=async(path,{body})=>({correction:{...receipt(body),operationId:randomUUID()}});await f.submit();const original=f.writes()[0].body;
    assert.equal(f.pending(),true);assert.equal(f.applied.length,0);
    f.respond=async()=>{throw{status:401,code:'SIGN_IN_REQUIRED'};};await f.click('Retry exact identity');
    assert.equal(f.pending(),true);assert.deepEqual(f.writes()[1].body,original);assert.equal(f.locks.at(-1),true);
});

test('initial post-dispatch 401, 403 and 409 preserve the exact correction until its committed receipt is recovered',async()=>{
    for(const [status,code]of [[401,'SIGN_IN_REQUIRED'],[403,'FRESH_IDENTITY_REVIEWER_REQUIRED'],[409,'IDENTITY_HEAD_CHANGED']]){
        const f=harness(),originalCard=f.props.card;f.prepare();let committed;
        f.respond=async(path,{body})=>{committed=receipt(body);throw{status,code};};await f.submit();
        const original=f.writes()[0].body;assert.equal(f.pending(),true,code);assert.equal(f.locks.at(-1),true);
        f.props.disabled=true;f.render();f.respond=async(path,{body})=>body?{correction:committed}:{card:corrected(originalCard)};
        await f.click('Retry exact identity');assert.deepEqual(f.writes()[1].body,original);assert.equal(f.writes()[1].csrf,f.token);
        assert.equal(f.pending(),false);assert.equal(f.applied.length,1);assert.equal(f.accessCalls,1);
    }
});

test('disabled fresh form sends nothing and same-tick repeated correction submit sends once',async()=>{
    const f=harness();f.prepare();f.props.disabled=true;f.render();await f.submit();assert.equal(f.calls.length,0);
    f.props.disabled=false;f.render();let reject;f.respond=()=>new Promise((_,no)=>{reject=no;});
    const first=f.submit();await f.submit();assert.equal(f.writes().length,1);reject(Error('Lost reply'));await first;assert.equal(f.pending(),true);
});

test('reload receipt binding rejects same-revision hash substitution but permits a newer saved review',()=>{
    const original=makeCard(),body=client.correctionRequest(original,'SPORTS',original.grading.report.identity,'Checked',randomUUID()),saved=receipt(body),card=corrected(original);
    assert.equal(client.correctionReloadResult({card},{specimenId:original.id,receipt:saved}),card);
    assert.throws(()=>client.correctionReloadResult({card:{...card,reviewHash:'9'.repeat(64)}},{specimenId:original.id,receipt:saved}));
    const later=structuredClone(card);later.draft.revision++;later.reviewHash='9'.repeat(64);
    assert.equal(client.correctionReloadResult({card:later},{specimenId:original.id,receipt:saved}),later);
});
