import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreferenceFixture,AID,CID,OTHER,prefId,defer} from './collection-preferences-fixture.mjs';
import {createCollectionDisplayFixture} from './collection-display-fixture.mjs';
import {createMountedPreferencesFixture,nodes,words} from './collection-preferences-component-fixture.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
const empty={fetch:()=>assert.fail('No photograph request'),snapshot:{},accountId:AID};
function setup(patch={}) {const f=createPreferenceFixture();let ids=80;const h=createMountedPreferencesFixture(empty,{component:'CollectionPreferences',props:{session:f.session,request:f.request,createRequestId:()=>prefId(ids++),...patch}});return{f,h};}
async function ready(h){h.render();await h.until(t=>words(t).includes('Current saved settings.'));}
const button=(h,label)=>nodes(h.tree(),n=>n.type==='button'&&words(n)===label)[0];
const select=(h,value,root)=>h.change('select',value,root);
test('actual preference component → controller/client/signed HTTP: absent inert; saved request distinct from later current',async()=>{
 const {f,h}=setup({request:null});assert.equal(h.render(),null);assert.equal(f.requests.length,0);h.render({...h.props,request:f.request});await h.until(t=>words(t).includes('Current saved settings.'));
 select(h,'PUBLIC');assert.match(words(h.tree()),/Unsaved changes/);h.click('Save settings');await h.until(t=>words(t).includes('Your save is confirmed'));
 assert.equal(f.records.size,1);assert.match(words(h.tree()),/Last confirmed save: Public/);assert.doesNotMatch(words(h.tree()),/Current: Private/);
 await f.service.setCollectionPreferences(f.cookie,f.csrf,{requestId:prefId(90),expectedPreferenceRevision:1,visibility:'PRIVATE',offersDisabled:true});h.click('Reload current settings');await h.until(t=>words(t).includes('Current: Private'));
 assert.match(words(h.tree()),/Last confirmed save: Public/);assert.match(words(h.tree()),/public collection browsing is not available yet/);assert.equal(f.requests.filter(x=>x.input.method==='POST').length,1);h.unmount();
});
test('generic conflict and absent lookup remain uncertain; only explicit same save retry uses identical bytes',async()=>{
 const {f,h}=setup();let failed=false;const sent=[],request=async(path,input)=>{if(input.method==='POST'){sent.push(input.body);if(!failed){failed=true;return new Response('{}',{status:409});}}return f.request(path,input);};h.props.request=request;await ready(h);
 select(h,'PUBLIC');h.click('Save settings');await h.until(t=>words(t).includes('Your change may have been saved'));
 assert.doesNotMatch(words(h.tree()),/Current: Public/);assert.match(words(h.tree()),/Requested change: Public/);assert.equal(nodes(h.tree(),n=>n.type==='select')[0].props.value,'PUBLIC');
 assert.equal(button(h,'Save settings'),undefined);assert.equal(button(h,'Reload current settings'),undefined);h.click('Check saved request');await h.until(t=>words(t).includes('Its outcome is still unconfirmed'));
 assert.equal(f.records.size,0);h.click('Retry this same save');await h.until(t=>words(t).includes('Your save is confirmed'));assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);assert.equal(f.records.size,1);h.unmount();
});
test('exact typed stale witness requires explicit latest read before a new chosen save',async()=>{
 const {f,h}=setup();await ready(h);select(h,'PUBLIC');await f.service.setCollectionPreferences(f.cookie,f.csrf,{requestId:prefId(90),expectedPreferenceRevision:0,visibility:'PRIVATE',offersDisabled:true});h.click('Save settings');await h.until(t=>words(t).includes('These settings changed elsewhere'));
 assert.equal(button(h,'Save settings'),undefined);assert.equal(button(h,'Retry this same save'),undefined);assert.doesNotMatch(words(h.tree()),/Last confirmed save/);const n=f.requests.length;await tick();h.render();assert.equal(f.requests.length,n);
 h.click('Reload current settings');await h.until(t=>words(t).includes('Current saved settings.'));select(h,'PUBLIC');h.click('Save settings');await h.until(t=>words(t).includes('Your save is confirmed'));
 const posts=f.requests.filter(r=>r.input.method==='POST').map(r=>JSON.parse(r.input.body));assert.equal(posts.length,2);assert.notEqual(posts[0].requestId,posts[1].requestId);assert.equal(posts[1].expectedPreferenceRevision,1);assert.equal(f.records.size,2);h.unmount();
});
test('held committed reply hides synchronously for changed account/object/CSRF/request and old events cannot mutate successor',async()=>{
 for(const kind of ['id','customer','csrf','session','request']){const {f,h}=setup();await ready(h);select(h,'PUBLIC');const old=button(h,'Save settings'),entered=defer(),wait=defer();f.afterHTTP=async()=>{if(f.records.size){entered.resolve();await wait.promise;}};old.props.onClick();h.render();await entered.promise;h.render();assert.match(words(h.tree()),/Requested change: Public/);assert.equal(nodes(h.tree(),n=>n.type==='select')[0].props.value,'PUBLIC');
  const next={...h.props};if(kind==='id')f.session.customer.id=OTHER;else if(kind==='customer')f.session.customer={id:AID};else if(kind==='csrf')f.session.csrf+='changed';else if(kind==='session')next.session={...f.session};else next.request=(...args)=>f.request(...args);
  const hidden=h.render(next,false);assert.doesNotMatch(words(hidden),/Current:|Last confirmed save|Unsaved/);old.props.onClick();h.render();wait.resolve();await tick();await tick();h.render();assert.equal(f.records.size,1);assert.doesNotMatch(words(h.tree()),/Last confirmed save: Public/);h.unmount();
 }
});
test('access loss/pagehide/unmount clear private state, stale handlers inert; StrictMode replay stays live without reviving denial',async()=>{
 for(const end of ['pagehide','unmount','access']){const {f,h}=setup();await ready(h);select(h,'PUBLIC');const old=button(h,'Save settings');if(end==='pagehide')h.pagehide();else if(end==='unmount')h.unmount();else h.render({...h.props,accessState:'ENDED'});old.props.onClick();await tick();assert.equal(f.records.size,0);if(end!=='unmount'){assert.doesNotMatch(words(h.tree()),/Current:|Last confirmed save/);h.replay();assert.match(words(h.tree()),/Sign in again/);h.unmount();}}
 const {f,h}=setup();await ready(h);h.replay();await h.until(t=>words(t).includes('Current saved settings.'));select(h,'PUBLIC');h.click('Save settings');await h.until(t=>words(t).includes('Your save is confirmed'));assert.equal(f.records.size,1);h.unmount();
});
test('actual collection/media composition preserves card draft and unresolved save across account save/reload with no repeated photo reads',async()=>{
 const f=createPreferenceFixture(),d=await createCollectionDisplayFixture();d.accountId=AID;d.snapshot.accountId=AID;d.snapshot.preferences.accountId=AID;d.card.cardId=CID;d.card.ownership.ownerAccountId=AID;
 const h=createMountedPreferencesFixture(d);h.props={...h.props,customer:f.session.customer,preferencesSession:f.session,preferencesRequest:f.request};let pageReads=0;h.props.readPage=async()=>{pageReads++;return structuredClone(d.snapshot);};h.render();await h.until(()=>h.image()&&words(h.tree()).includes('Current saved settings.'));h.loadImage();assert.equal(h.reads.length,1);assert.equal(f.requests.length,1);
 h.click('Card settings +');await h.until(()=>nodes(h.tree(),n=>n.type==='select').length===2);select(h,'PUBLIC',h.panel(1));assert.match(words(h.panel(1)),/Unsaved changes/);
 select(h,'PUBLIC',h.panel(0));h.click('Save settings',h.panel(0));await h.until(()=>words(h.panel(0)).includes('Your save is confirmed'));assert.match(words(h.panel(1)),/Unsaved changes/);h.click('Reload current settings',h.panel(0));await h.until(()=>words(h.panel(0)).includes('Current saved settings.'));assert.match(words(h.panel(1)),/Unsaved changes/);
 f.afterHTTP=()=>{if([...f.records.values()].some(r=>r.receipt.cardId===CID)){f.afterHTTP=null;throw Error('lost card reply');}};h.click('Save settings',h.panel(1));await h.until(()=>words(h.panel(1)).includes('Your change may have been saved'));
 select(h,'PRIVATE',h.panel(0));h.click('Save settings',h.panel(0));await h.until(()=>words(h.panel(0)).includes('Your save is confirmed'));assert.match(words(h.panel(1)),/Your change may have been saved/);assert.equal(pageReads,1);assert.equal(h.reads.length,1);assert.equal(d.requests.length,2);
 h.click('Check saved request',h.panel(1));await h.until(()=>words(h.panel(1)).includes('Your save is confirmed'));assert.equal(f.records.size,3);assert.equal(h.reads.length,1);h.unmount();assert.equal(h.revoked.length,1);
});
test('authoritative preference denial clears whole current collection; old page denial cannot clear replacement',async()=>{
 const f=createPreferenceFixture(),d=await createCollectionDisplayFixture();d.accountId=AID;d.snapshot.accountId=AID;d.snapshot.preferences.accountId=AID;d.card.cardId=CID;d.card.ownership.ownerAccountId=AID;
 const h=createMountedPreferencesFixture(d);let denied=0;h.props={...h.props,customer:f.session.customer,preferencesSession:f.session,preferencesRequest:f.request,onAccessLost:()=>denied++};h.render();await h.until(()=>h.image()&&words(h.tree()).includes('Current saved settings.'));
 const old=h.component('CollectionPreferences');h.click('Refresh collection');await h.until(()=>h.image()&&words(h.tree()).includes('Current saved settings.'));old.onAccessLost();h.render();assert.equal(denied,0);assert(h.image());
 f.liveAccount=null;select(h,'PUBLIC',h.panel(0));h.click('Save settings',h.panel(0));await h.until(t=>words(t).includes('Sign in again'));assert.equal(denied,1);assert.equal(h.image(),undefined);assert.doesNotMatch(words(h.tree()),/Synthetic collection card|Current:|Last confirmed/);assert.equal(h.revoked.length,h.made.length);h.unmount();
});
