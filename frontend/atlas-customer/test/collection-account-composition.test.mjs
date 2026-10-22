import test from 'node:test';
import assert from 'node:assert/strict';
import {customerPage} from '../lib/server/page.mjs';
import {BoundaryError} from '../lib/server/policy.mjs';
import {createMountedCollectionCompositionFixture,all,words,button,click,deferred,flush} from './collection-account-composition-fixture.mjs';
import {createPreferenceFixture,AID,CID} from './collection-preferences-fixture.mjs';
import {createCollectionDisplayFixture} from './collection-display-fixture.mjs';
const panels=tree=>all(tree,n=>n.type==='section'&&n.props.className==='panel');
const setPublic=(f,tree)=>{all(tree,n=>n.type==='select')[0].props.onChange({target:{value:'PUBLIC'}});f.render();};
async function setup(flags={display:true,preferences:true}) {
 const f=createMountedCollectionCompositionFixture(flags),p=createPreferenceFixture(),d=await createCollectionDisplayFixture();
 f.accountId=AID;f.customer=p.session.customer;f.customer.profile={};f.csrf=p.csrf;d.accountId=AID;d.snapshot.accountId=AID;d.snapshot.preferences.accountId=AID;d.card.cardId=CID;d.card.ownership.ownerAccountId=AID;f.snapshot=d.snapshot;
 f.extraFetch=(path,options)=>path.includes('/preferences')||path.includes('/preference-requests/')?p.request(path,options):path.includes('/display')?d.fetch(path,options):undefined;
 return{f,p,d};
}
const ready=f=>f.until(t=>words(t).includes('Current saved settings.')&&all(t,n=>n.type==='img'&&n.props.src?.startsWith('blob:')).length>0);
test('only exact admitted collection flags serialize; no credentials/capabilities or hints on other pages',async()=>{
 const res=()=>({setHeader(){}});const state={assertRequest(){},ownershipHistory:{configuredForDisplay:true},collectionDisplay:{configuredForDisplay:true,privateKey:'secret'},collectionPreferences:{configuredForDisplay:true,databaseUrl:'secret'}};
 assert.deepEqual(await customerPage({req:{},res:res()},{initialView:'collection'},async()=>state),{props:{initialView:'collection',historyConfiguredForDisplay:true,displayConfiguredForDisplay:true,preferencesConfiguredForDisplay:true}});
 for(const v of [false,null,undefined,'true',1]){const r=await customerPage({req:{},res:res()},{initialView:'collection',displayConfiguredForDisplay:true,preferencesConfiguredForDisplay:true},async()=>({...state,collectionDisplay:{configuredForDisplay:v},collectionPreferences:{configuredForDisplay:v}}));assert.equal(r.props.displayConfiguredForDisplay,false);assert.equal(r.props.preferencesConfiguredForDisplay,false);assert.doesNotMatch(JSON.stringify(r),/secret|databaseUrl/);}
 for(const initialView of ['dashboard','submit','profile'])assert.deepEqual(await customerPage({req:{},res:res()},{initialView},async()=>state),{props:{initialView}});
 let touched=0;const denied={assertRequest(){throw new BoundaryError(403,'DENIED');},get collectionDisplay(){touched++;throw Error();},get collectionPreferences(){touched++;throw Error();}};assert.deepEqual(await customerPage({req:{},res:res()},{initialView:'collection'},async()=>denied),{props:{unavailable:true}});assert.equal(touched,0);
});
test('actual AccountWorkspace boots configured settings/display once; ordinary parent/metadata renders keep session, request and image reads stable',async()=>{
 const {f,p,d}=await setup();try{f.render();let t=await ready(f);const initial=f.components('CollectionAccountWorkspace')[0],work=f.components('CollectionWorkspace')[0];assert.strictEqual(initial.session.customer,initial.customer);assert.equal(initial.customer.id,f.customer.id);assert.equal(initial.session.csrf,p.csrf);assert.equal(d.requests.length,2);
  const session=initial.session,reader=work.displayReader,request=work.preferencesRequest;for(let i=0;i<4;i++)f.render();assert.strictEqual(f.components('CollectionAccountWorkspace')[0].session,session);assert.strictEqual(f.components('CollectionWorkspace')[0].displayReader,reader);assert.strictEqual(f.components('CollectionWorkspace')[0].preferencesRequest,request);
  click(t,'Card settings +');await f.until(t=>panels(t).length===2&&all(panels(t)[1],n=>n.type==='select').length===1);setPublic(f,panels(f.render())[1]);setPublic(f,panels(f.render())[0]);click(panels(f.render())[0],'Save settings');t=await f.until(t=>words(panels(t)[0]).includes('Your save is confirmed'));assert.match(words(panels(t)[1]),/Unsaved changes/);assert.equal(d.requests.length,2);assert.equal(p.records.size,1);assert.equal(f.calls.filter(x=>x.path.includes('/collection?')).length,1);
 }finally{f.unmount();assert.equal(f.revoked.length,f.made.length);}
});
test('absent/non-boolean hints make no optional calls, independent flags enable only their reader',async()=>{
 for(const flags of [{display:false,preferences:false},{display:'true',preferences:1},{display:true,preferences:false},{display:false,preferences:true}]){const {f,p,d}=await setup(flags);try{f.render();await f.until(t=>words(t).includes('My Collection')&&words(t).includes('Grade Report'));await f.settle();assert.equal(p.requests.length>0,flags.preferences===true);assert.equal(d.requests.length>0,flags.display===true);assert.equal(words(f.render()).includes('Collection settings'),flags.preferences===true);}finally{f.unmount();}}
});
test('actual history switch disposes pending settings/photo view; old reply cannot end or update active history',async()=>{
 const {f,p}=await setup(),entered=deferred(),release=deferred();try{f.render();let t=await ready(f);setPublic(f,panels(t)[0]);p.afterHTTP=async()=>{if(p.records.size){entered.resolve();await release.promise;}};click(panels(f.render())[0],'Save settings');await entered.promise;f.render();const post=p.requests.find(x=>x.input.method==='POST');click(f.render(),'Ownership claim history');t=await f.settle();assert.equal(post.input.signal.aborted,true);assert.equal(f.revoked.length,f.made.length);assert.doesNotMatch(words(t),/Collection settings|Requested change/);release.resolve();await f.settle();assert.equal(button(f.render(),'Ownership claim history').props['aria-pressed'],true);assert.doesNotMatch(words(f.render()),/Last confirmed save|Collection access ended/);
  click(f.render(),'Current collection');t=await ready(f);assert.match(words(t),/Current: Public/);assert.doesNotMatch(words(t),/Last confirmed save/);assert.equal(p.records.size,1);
 }finally{release.resolve();f.unmount();}
});
test('actual account sign-out/pagehide closes pending save and all optional bytes; known commit is not falsely cancelled',async()=>{
 for(const end of ['logout','pagehide']){const {f,p}=await setup(),entered=deferred(),release=deferred();try{f.render();await ready(f);setPublic(f,panels(f.render())[0]);p.afterHTTP=async()=>{if(p.records.size){entered.resolve();await release.promise;}};click(panels(f.render())[0],'Save settings');await entered.promise;f.render();if(end==='logout')click(f.render(),'Sign out');else f.pagehide();f.render();assert.match(words(f.render()),/access ended/);assert.equal(f.revoked.length,f.made.length);release.resolve();await f.settle();assert.equal(p.records.size,1);assert.doesNotMatch(words(f.render()),/Requested change|Last confirmed save|Collection settings/);}finally{release.resolve();f.unmount();}}
});
test('hub session/CSRF/flag changes invalidate old child scopes before effects and old denial cannot clear successor',async()=>{
 for(const change of ['session','csrf','flag']){const {f,p}=await setup();let props={customer:f.customer,session:p.session,historyConfiguredForDisplay:true,displayConfiguredForDisplay:true,preferencesConfiguredForDisplay:true};f.useHub(props);try{f.render();await ready(f);const old=f.components('CollectionWorkspace')[0];if(change==='session')props={...props,session:{...p.session}};else if(change==='csrf')p.session.csrf+='rotated';else props={...props,preferencesConfiguredForDisplay:false};assert.doesNotMatch(words(f.render(props,{effects:false})),/Current:|Last confirmed/);f.render(props);await f.settle();old.onAccessLost();await flush();f.render();assert.doesNotMatch(words(f.render()),/Collection access ended/);}finally{f.unmount();}}
});

test('configuration toggles never revive a same-session denied hub',async()=>{
 const {f,p}=await setup();const props={customer:f.customer,session:p.session,historyConfiguredForDisplay:true,displayConfiguredForDisplay:true,preferencesConfiguredForDisplay:true};f.useHub(props);try{f.render();await ready(f);f.components('CollectionWorkspace')[0].onAccessLost();f.render();assert.match(words(f.render()),/Collection access ended/);f.render({...props,displayConfiguredForDisplay:false,preferencesConfiguredForDisplay:false});assert.match(words(f.render()),/Collection access ended/);f.render(props);assert.match(words(f.render()),/Collection access ended/);}finally{f.unmount();}
});
