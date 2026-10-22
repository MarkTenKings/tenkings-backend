import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionDisplayFixture,deferred} from './collection-display-fixture.mjs';
import {createMountedDisplayFixture,nodes,words} from './collection-display-component-fixture.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
test('actual Workspace → MyCollection → media shows exact saved title/grade, single read across metadata/search rerenders; default absent stays absent',async()=>{
 const f=await createCollectionDisplayFixture(),h=createMountedDisplayFixture(f);
 h.render({...h.props,displayReader:null});await h.until(t=>words(t).includes('Graded card'));assert.equal(h.reads.length,0);assert.equal(h.image(),undefined);
 h.render({...h.props,displayReader:h.reader});await h.until(()=>h.image());assert.equal(h.reads.length,1);assert.equal(h.made.length,1);
 assert.match(words(h.tree()),/Synthetic collection card · 2026/);assert.match(words(h.tree()),/ATLAS 9/);assert.equal(h.image().props.className,'photoPending');
 h.loadImage();assert.equal(h.image().props.className,'photoVisible');
 for(let i=0;i<4;i++){const search=nodes(h.tree(),n=>n.type==='input'&&n.props.type==='search')[0];search.props.onChange({target:{value:i%2?'Synthetic':''}});h.render();await tick();h.render();}
 assert.equal(h.reads.length,1);assert.equal(h.made.length,1);assert.equal(f.requests.length,2);h.unmount();assert.deepEqual(h.revoked,['blob:synthetic-1']);
});
test('photo-only failure keeps metadata, explicit retry renews reads, exact decoded dimensions required',async()=>{
 const f=await createCollectionDisplayFixture();f.imageHook=()=>{throw {status:404};};const h=createMountedDisplayFixture(f);h.render();await h.until(t=>words(t).includes('Photograph unavailable'));
 assert.match(words(h.tree()),/Synthetic collection card/);assert.equal(h.image(),undefined);assert.equal(h.reads.length,1);
 f.imageHook=null;h.click('Retry photograph');await h.until(()=>h.image());assert.equal(h.reads.length,2);h.loadImage(1349,1858);
 assert.match(words(h.tree()),/Photograph unavailable/);assert.equal(h.image(),undefined);assert.equal(h.revoked.length,1);
 h.click('Retry photograph');await h.until(()=>h.image());h.loadImage();assert.equal(h.image().props.className,'photoVisible');h.unmount();assert.equal(h.revoked.length,2);
});
test('owner absence after image read clears entire collection and all resources; availability never masquerades as empty',async()=>{
 const f=await createCollectionDisplayFixture(),h=createMountedDisplayFixture(f);let lost=0;h.props.onAccessLost=()=>lost++;
 f.imageHook=()=>{f.ownerHook=()=>{throw {code:'OWNERSHIP_NOT_FOUND',status:404};};};h.render();await h.until(t=>words(t).includes('Sign in again'));
 assert.equal(lost,1);assert.equal(h.image(),undefined);assert.doesNotMatch(words(h.tree()),/Synthetic collection card|ATLAS-AAAA|No verified cards/);assert.equal(h.made.length,0);h.unmount();
});
test('page refresh and owner replacement fence old child failure/metadata callbacks before effects',async()=>{
 const f=await createCollectionDisplayFixture(),h=createMountedDisplayFixture(f);let lost=0;h.props.onAccessLost=()=>lost++;
 h.render();await h.until(()=>h.image());const old=h.component('CollectionCardMedia');h.loadImage();
 h.click('Refresh collection');await h.until(()=>h.image());const before=h.reads.length;old.onAccessLost();old.onDisplay({});h.render();assert.equal(lost,0);assert(h.image());assert.equal(h.reads.length,before);
 const previous=h.component('CollectionCardMedia'),next={...h.props,customer:{id:f.accountId}};assert.doesNotMatch(words(h.render(next,false)),/Synthetic collection card/);
 previous.onAccessLost();h.render(next);await h.until(()=>h.image());assert.equal(lost,0);assert(h.revoked.length>=2);h.unmount();
});
test('late image delivery after access end/unmount never publishes or clears successor; pagehide is terminal',async()=>{
 for(const end of ['unmount','access','pagehide']){
  const f=await createCollectionDisplayFixture(),wait=deferred(),entered=deferred();f.imageHook=()=>{entered.resolve();return wait.promise;};const h=createMountedDisplayFixture(f);h.render();await h.until(()=>h.reads.length===1);await entered.promise;
  const old=h.component('CollectionCardMedia');if(end==='unmount')h.unmount();else if(end==='access')h.render({...h.props,accessState:'ENDED'});else h.pagehide();
  wait.resolve();await tick();await tick();old.onAccessLost();if(end!=='unmount'){h.render();assert.equal(h.image(),undefined);assert.match(words(h.tree()),/Sign in again/);}assert.equal(h.made.length,0);
  if(end!=='unmount')h.unmount();
 }
});
test('StrictMode effect replay remains usable, revokes old URL and keeps permanent denial; hidden cards release bytes',async()=>{
 const f=await createCollectionDisplayFixture(),h=createMountedDisplayFixture(f);h.render();await h.until(()=>h.image());h.loadImage();h.replay();await h.until(()=>h.image());assert(h.revoked.length>=1);
 const visible=h.visibility.filter(x=>!x.closed).at(-1);visible.callback([{isIntersecting:false}]);h.render();assert.equal(h.image(),undefined);assert.equal(h.revoked.length,h.made.length);
 visible.callback([{isIntersecting:true}]);h.render();await h.until(()=>h.image());const cb=h.component('CollectionCardMedia').onAccessLost;cb();h.render();assert.match(words(h.tree()),/Sign in again/);h.replay();await tick();h.render();assert.match(words(h.tree()),/Sign in again/);h.unmount();
});
test('in-place reader replacement invalidates old callbacks before effects and reauthorizes the new page',async()=>{
 const f=await createCollectionDisplayFixture(),h=createMountedDisplayFixture(f);let lost=0;h.props.onAccessLost=()=>lost++;
 h.render();await h.until(()=>h.image());const old=h.component('CollectionCardMedia'),read=h.reader.read;h.reader.read=input=>read(input);
 assert.doesNotMatch(words(h.render(h.props,false)),/Synthetic collection card/);old.onAccessLost();h.render();await h.until(()=>h.image());
 assert.equal(lost,0);assert.equal(h.reads.length,2);assert.equal(h.revoked.length,1);h.unmount();
});
