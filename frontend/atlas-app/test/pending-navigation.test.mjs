import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installPendingNavigationController, installPendingNavigationGuard, HISTORY_MARK } from '../lib/pending-navigation.mjs';
const require=createRequire(import.meta.url),mitt=require('next/dist/shared/lib/mitt.js').default;
const origin='https://atlasgrading.com';
const state=(path,key)=>({__N:true,url:path,as:path,options:{shallow:false},key});
function fixture({older=null,prior=null}={}){
    const events=mitt(),listeners=new Map(),queue=[],timers=new Map(),notices=[],transitions=[];
    const entries=older?[{href:origin+older.path,state:older.state},{href:origin+'/admin/grading',state:state('/admin/grading','queue')}]:[{href:origin+'/admin/grading',state:state('/admin/grading','queue')}];
    let index=entries.length-1,serial=0;
    const listen=(name,fn,capture=false)=>{const list=listeners.get(name)??[];list.push({fn,capture});listeners.set(name,list);};
    const unlisten=(name,fn,capture=false)=>listeners.set(name,(listeners.get(name)??[]).filter(x=>x.fn!==fn||x.capture!==capture));
    const window={location:{href:entries[index].href},crypto:{randomUUID:()=>`synthetic-session-${++serial}`},
        addEventListener:listen,removeEventListener:unlisten,setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)};
    const history={get state(){return entries[index].state;},
        pushState(value,title,url){entries.splice(index+1);entries.push({href:new URL(url,window.location.href).href,state:structuredClone(value)});index++;window.location.href=entries[index].href;},
        replaceState(value,title,url){entries[index]={href:new URL(url,window.location.href).href,state:structuredClone(value)};window.location.href=entries[index].href;},
        go(delta){queue.push(()=>{const target=index+delta;if(target<0||target>=entries.length)return;index=target;window.location.href=entries[index].href;dispatchPop();});}};
    window.history=history;
    const originals={push:history.pushState,replace:history.replaceState};
    const router={events,_bps:prior,_key:entries[index].state?.key,beforePopState(fn){this._bps=fn;}};
    const document={addEventListener:listen,removeEventListener:unlisten};
    const dispatch=(name,event={})=>{event.stopped=false;event.stopImmediatePropagation=()=>{event.stopped=true;};for(const item of [...(listeners.get(name)??[])].sort((a,b)=>Number(b.capture)-Number(a.capture))){item.fn(event);if(event.stopped)break;}return event;};
    const dispatchPop=()=>{
        const event=dispatch('popstate',{state:history.state});
        // Installed Next updates _key before its single beforePopState callback.
        if(!event.stopped&&event.state?.__N){router._key=event.state.key;if(router.skipBeforePopAt===event.state.as)return;if(!router._bps||router._bps(event.state))transitions.push(event.state.as);}
    };
    const owner=installPendingNavigationController({window,document,router,onBlocked:message=>notices.push(message)});
    return {window,document,router,entries,notices,transitions,timers,originals,owner,dispatch,
        index:()=>index,count:name=>(listeners.get(name)??[]).length,
        subscribe:(isPending,onBlocked)=>installPendingNavigationGuard({window,document,router,isPending,onBlocked}),
        install:()=>installPendingNavigationController({window,document,router}),
        flush:()=>{let limit=20;while(queue.length){assert.ok(limit-->0,'Traversal must terminate.');queue.shift()();}},
        flushOne:()=>queue.shift()?.(),
        navigate(path,{replace=false,hash=false}={}){events.emit(hash?'hashChangeStart':'routeChangeStart',path,{shallow:false});if(!hash)events.emit('beforeHistoryChange',path,{shallow:false});const key=replace?history.state.key:`key-${++serial}`;router._key=key;history[replace?'replaceState':'pushState'](state(path,key),'',path);events.emit(hash?'hashChangeComplete':'routeChangeComplete',path,{shallow:false});},
        complete:()=>events.emit('routeChangeComplete',window.location.href,{shallow:false}),
        click:(href,extra={})=>dispatch('click',{target:{closest:()=>({href:new URL(href,window.location.href).href,target:'',...extra})},button:0,preventDefault(){this.prevented=true;}}),
    };
}

test('multiple panels share one central guard and latest predicates, with separate-tab sign-in allowed',()=>{
    const f=fixture();let a=true,b=false,noticesA=0,noticesB=0;
    const aOff=f.subscribe(()=>a,()=>noticesA++),bOff=f.subscribe(()=>b,()=>noticesB++);
    assert.equal(f.count('popstate'),1);assert.equal(f.count('beforeunload'),1);assert.equal(f.count('click'),1);
    assert.equal(f.click('/admin/operations').prevented,true);assert.equal(noticesA,1);assert.equal(noticesB,0);
    assert.equal(f.click('/admin?reauthenticate=1',{target:'_blank'}).prevented,undefined);assert.equal(f.click('#section').prevented,undefined);
    a=false;b=true;assert.equal(f.click('/admin/operations').prevented,true);assert.equal(noticesA,1);assert.equal(noticesB,1);
    assert.doesNotThrow(()=>f.router.events.emit('routeChangeStart','/admin/operations'));
    assert.throws(()=>f.router.events.emit('beforeHistoryChange','/admin/operations'),e=>e.cancelled===true);
    const leaving=f.dispatch('beforeunload',{preventDefault(){this.prevented=true;}});assert.equal(leaving.returnValue,'');
    aOff();bOff();f.owner();assert.equal(f.count('popstate'),0);assert.equal(f.count('beforeunload'),0);
});

test('push and replace preserve Next state and keys with correctly ordered metadata',()=>{
    const f=fixture(),initial=structuredClone(f.window.history.state);
    f.navigate('/admin/cards/card');const card=structuredClone(f.window.history.state);
    assert.equal(card[HISTORY_MARK].index,initial[HISTORY_MARK].index+1);assert.equal(card[HISTORY_MARK].session,initial[HISTORY_MARK].session);
    assert.deepEqual({...card,[HISTORY_MARK]:undefined},{...state('/admin/cards/card',card.key),[HISTORY_MARK]:undefined});
    f.navigate('/admin/cards/card?view=back',{replace:true});assert.equal(f.window.history.state.key,card.key);
    assert.deepEqual(f.window.history.state[HISTORY_MARK],{...card[HISTORY_MARK],href:origin+'/admin/cards/card?view=back'});assert.equal(f.entries.length,2);f.owner();
});

test('blocked Back compensates traversal without overwriting destinations or duplicating Next keys',()=>{
    const f=fixture();f.navigate('/admin/cards/card');const before=structuredClone(f.entries);let pending=true;
    const off=f.subscribe(()=>pending);f.window.history.go(-1);f.flush();
    assert.equal(f.index(),1);assert.deepEqual(f.entries,before);assert.equal(f.router._key,before[1].state.key);assert.deepEqual(f.transitions,[]);
    assert.equal(f.timers.size,0);pending=false;f.window.history.go(-1);f.flush();f.complete();
    assert.equal(f.index(),0);assert.deepEqual(f.transitions,['/admin/grading']);assert.deepEqual(f.entries,before);off();f.owner();
});

test('blocked Forward restores the original entry with no guessed key ordering',()=>{
    const f=fixture();f.navigate('/admin/cards/card');f.navigate('/admin/operations');f.window.history.go(-1);f.flush();f.complete();
    const before=structuredClone(f.entries);const off=f.subscribe(()=>true);f.transitions.length=0;
    f.window.history.go(1);f.flush();assert.equal(f.index(),1);assert.deepEqual(f.entries,before);
    assert.equal(f.router._key,before[1].state.key);assert.deepEqual(f.transitions,[]);off();f.owner();
});

test('pending created during asynchronous route loading blocks a push commit inside Next cancellation catch',async()=>{
    const f=fixture();let pending=false,commits=0;const off=f.subscribe(()=>pending);
    let release;const loaded=new Promise(resolve=>{release=resolve;});
    const transition=(async()=>{f.router.events.emit('routeChangeStart','/admin/cards/card');await loaded;
        try{f.router.events.emit('beforeHistoryChange','/admin/cards/card');commits++;return true;}catch(error){if(error.cancelled)return false;throw error;}})();
    pending=true;release();assert.equal(await transition,false);assert.equal(commits,0);assert.equal(f.index(),0);off();f.owner();
});

test('pending created during a pop load restores the original browser entry and Next internal key',()=>{
    const f=fixture();f.navigate('/admin/cards/card');const before=structuredClone(f.entries);let pending=false;const off=f.subscribe(()=>pending);
    f.window.history.go(-1);f.flush();assert.equal(f.index(),0);assert.equal(f.router._key,before[0].state.key);
    pending=true;assert.throws(()=>f.router.events.emit('beforeHistoryChange','/admin/grading'),e=>e.cancelled);f.flush();
    assert.equal(f.index(),1);assert.equal(f.router._key,before[1].state.key);assert.deepEqual(f.entries,before);off();f.owner();
});

test('Next hash completion tracks the correct entry and replacement keeps its index',()=>{
    const f=fixture();f.navigate('/admin/cards/card');const off=f.subscribe(()=>true);
    f.navigate('/admin/cards/card#label',{hash:true});const saved=structuredClone(f.entries);
    f.window.history.go(-2);f.flush();assert.equal(f.index(),2);assert.equal(f.window.location.href,origin+'/admin/cards/card#label');assert.deepEqual(f.entries,saved);
    f.navigate('/admin/cards/card#print',{hash:true,replace:true});assert.equal(f.entries.length,3);assert.deepEqual(f.window.history.state[HISTORY_MARK],{...saved[2].state[HISTORY_MARK],href:origin+'/admin/cards/card#print'});off();f.owner();
});

for(const nextOwned of [true,false])test(`unknown pre-app ${nextOwned?'Next':'native'} entry is preserved with explicit address mismatch until manual return`,()=>{
    const older={path:'/older',state:nextOwned?state('/older','old-key'):{unrelated:'preserved'}};
    const f=fixture({older});const before=structuredClone(f.entries),off=f.subscribe(()=>true);
    f.window.history.go(-1);f.flush();assert.equal(f.index(),0);assert.deepEqual(f.entries,before);assert.deepEqual(f.transitions,[]);
    assert.ok(f.notices.some(n=>n.includes('browser address currently differs')&&n.includes(origin+'/admin/grading')));
    assert.throws(()=>f.router.events.emit('beforeHistoryChange','/admin/operations'),e=>e.cancelled);
    f.window.history.go(1);f.flush();assert.equal(f.index(),1);assert.deepEqual(f.entries,before);assert.equal(f.router._key,before[1].state.key);
    assert.deepEqual(f.transitions,[]);off();f.owner();
});

test('owner replacement/HMR retains subscribers without duplicate wrappers and cleanup restores prior callback',()=>{
    const prior=()=>true,f=fixture({prior}),wrapped=f.window.history.pushState;
    const off=f.subscribe(()=>true),otherOwner=f.install();f.owner();
    assert.equal(f.window.history.pushState,wrapped);assert.equal(f.count('popstate'),1);
    assert.equal(f.click('/admin/operations').prevented,true);otherOwner();assert.equal(f.count('popstate'),1);
    off();assert.equal(f.count('popstate'),0);assert.equal(f.window.history.pushState,f.originals.push);assert.equal(f.window.history.replaceState,f.originals.replace);
    assert.equal(f.router._bps,prior);assert.equal(f.timers.size,0);
});

test('native same-page hash entry with no marker gets a fresh tracking origin without guessing direction',()=>{
    const f=fixture();f.navigate('/admin/cards/card');const prior=structuredClone(f.entries);
    f.originals.push.call(f.window.history,null,'','#native');f.dispatch('hashchange');
    assert.equal(f.entries.length,3);assert.deepEqual(f.entries.slice(0,2),prior);
    assert.equal(f.window.history.state[HISTORY_MARK].index,0);assert.notEqual(f.window.history.state[HISTORY_MARK].session,prior[1].state[HISTORY_MARK].session);f.owner();
});

for(const copied of [false,true])test(`native fragment with ${copied?'copied':'null'} state cannot cause an off-by-one compensation across a later wrapped push`,()=>{
    const f=fixture();f.navigate('/admin/cards/card');const beforeFragment=structuredClone(f.entries);
    const nativeState=copied?structuredClone(f.window.history.state):null;
    f.originals.push.call(f.window.history,nativeState,'','#native');f.dispatch('hashchange');
    assert.notEqual(f.window.history.state[HISTORY_MARK].session,beforeFragment[1].state[HISTORY_MARK].session);
    assert.equal(f.window.history.state[HISTORY_MARK].index,0);
    assert.equal(f.window.history.state[HISTORY_MARK].href,origin+'/admin/cards/card#native');
    assert.deepEqual(f.entries.slice(0,2),beforeFragment);
    f.navigate('/admin/operations');const all=structuredClone(f.entries),off=f.subscribe(()=>true);
    // Crossing the native fragment's boundary reaches another tracking origin.
    // It must stay explicitly detached, never guess the incorrect +2 return.
    f.window.history.go(-3);f.flush();assert.equal(f.index(),0);assert.deepEqual(f.entries,all);
    assert.ok(f.notices.some(n=>n.includes('browser address currently differs')));
    f.window.history.go(3);f.flush();assert.equal(f.index(),3);assert.deepEqual(f.entries,all);
    // Within the new contiguous origin a one-entry compensation is exact.
    f.window.history.go(-1);f.flush();assert.equal(f.index(),3);assert.deepEqual(f.entries,all);
    assert.equal(f.router._key,all[3].state.key);off();f.owner();
});

test('copied native fragment state is rebased before Next can rewrite it prior to hash completion',()=>{
    const f=fixture();f.navigate('/admin/cards/card');const original=structuredClone(f.window.history.state);
    f.originals.push.call(f.window.history,original,'','#native');
    // Next can call replaceState from pop processing before native hashchange.
    f.window.history.replaceState({...original,as:'/admin/cards/card#native'},'','#native');f.dispatch('hashchange');
    assert.notEqual(f.window.history.state[HISTORY_MARK].session,original[HISTORY_MARK].session);
    assert.equal(f.window.history.state[HISTORY_MARK].index,0);assert.equal(f.entries[1].state.key,original.key);f.owner();
});

test('Next initial-SSR shortcut still completes compensation when beforePopState is skipped',async()=>{
    const f=fixture();f.navigate('/admin/cards/card');f.router.skipBeforePopAt='/admin/cards/card';const off=f.subscribe(()=>true);
    f.window.history.go(-1);f.flush();await Promise.resolve();
    assert.equal(f.index(),1);assert.equal(f.router._key,f.entries[1].state.key);assert.equal(f.timers.size,0);
    assert.doesNotThrow(()=>f.router.events.emit('beforeHistoryChange','/admin/cards/card#label'));off();f.owner();
});

test('compensation timeout is bounded and does not rewrite the unresolved destination',()=>{
    const f=fixture();f.navigate('/admin/cards/card');const before=structuredClone(f.entries),off=f.subscribe(()=>true);
    f.window.history.go(-1);f.flushOne();assert.equal(f.index(),0);assert.equal(f.timers.size,1);
    for(const [id,callback]of [...f.timers]){f.timers.delete(id);callback();}
    assert.deepEqual(f.entries,before);assert.ok(f.notices.some(n=>n.includes('browser address currently differs')));
    f.flush();assert.equal(f.index(),1);assert.deepEqual(f.entries,before);off();f.owner();
});
