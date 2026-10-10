import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as client from '../lib/variant-review-client.mjs';
import * as routes from '../lib/routes.mjs';
const require = createRequire(import.meta.url), babel = require('next/dist/compiled/babel/core'), nextRequire = createRequire(require.resolve('next/package.json'));
const code = babel.transformSync(readFileSync(new URL('../components/VariantIdentityReview.jsx', import.meta.url), 'utf8'), {
  filename: 'VariantIdentityReview.jsx', presets: [[require.resolve('next/babel'), { 'preset-env': { targets: { node: 'current' } } }]], babelrc: false, configFile: false,
}).code;
const hash = c => c.repeat(64), all = (value, match, out = []) => { if (Array.isArray(value)) value.forEach(item => all(item, match, out)); else if (value && typeof value === 'object') { if (match(value)) out.push(value); all(value.props?.children, match, out); } return out; };
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value ?? '';
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ component = 'default', props, beforeEffects } = {}) {
  const slots = [], effects = [], values = new Map(), timers = new Map(); let cursor = 0, dirty, tree;
  const candidate = (candidateId, extra = {}) => ({candidateId,label:candidateId,identity:{name:'Pikachu',setName:'151',cardNumber:'025',language:'English'},parallel:'Reverse holo',applicability:'unknown',diagnostics:[{id:'foil',description:'Check the foil outside the artwork.'}],images:[],...extra});
  const f = { reads:0, writes:[], saved:0, gates:[], images:true, props:{cardId:randomUUID(),staffId:randomUUID(),enabled:true,sourceHash:hash('a'),identityRevision:1,revision:9,identity:{cardName:'Pikachu',productSet:'151',cardNumber:'025'},geometry:{sides:{FRONT:{},BACK:{}}},images:{}},
    status:{enabled:true,state:'READY',revision:9,sourceHash:hash('a'),identityRevision:1,identityHash:hash('b'),jobId:randomUUID(),resultHash:hash('c'),confirmation:null,approvalReady:false,result:{catalog:{schemaVersion:'atlas-variant-catalog/v1',snapshotHash:hash('d'),candidates:[candidate('second'),candidate('suggested'),candidate('language',{identity:{name:'Pikachu',setName:'151',cardNumber:'025',language:'Japanese'}}),candidate('other',{identity:{name:'Raichu',setName:'151',cardNumber:'026'}})]},suggestion:{candidateId:'suggested',reason:'Name and number match.'}}} };
  f.props.onGateChange = value => f.gates.push(value);
  f.props.onSaved = async () => { f.saved++; await f.reload?.(); };
  const react = {createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{const next=typeof value==='function'?value(slots[index]):value;if(!Object.is(slots[index],next)){slots[index]=next;dirty=true;}}];},
    useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},
    useEffect(callback,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>value!==previous.deps[i])){slots[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=callback();});}},
  };
  if (props) f.props = props;
  const exports={};vm.runInNewContext(`${code}\nexports.ReferencePhoto = ReferencePhoto;`,{exports,URL,Promise,window:{localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}},setTimeout:(fn,ms)=>{timers.set(ms,fn);return ms;},clearTimeout:ms=>timers.delete(ms),require(name){
    if(name==='react')return react;
    if(name.endsWith('routes.mjs'))return routes;
    if(name==='@atlas/manual-workspace')return{geometryImage:()=>({url:'verified'})};
    if(name==='@atlas/manual-workspace/report-review')return{useVerifiedImage:()=>({url:f.images?'blob:verified':null})};
    if(name.endsWith('variant-review-client.mjs'))return client;
    if(name.endsWith('manual-client.mjs'))return{manualRequest:async(path,options)=>{if(!options.method){f.reads++;return f.read?f.read():structuredClone(f.status);}f.writes.push(options.body);if(f.save)return f.save(options.body);const input=options.body;f.status={...f.status,confirmation:{...input,selectedCandidateId:input.candidateId},approvalReady:input.decision!=='UNRESOLVED'};return structuredClone(f.status);}};
    if(name.endsWith('.css'))return new Proxy({},{get:(_,key)=>key});return nextRequire(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);
  }});
  f.exports=exports;f.render=()=>{let loops=0;do{dirty=false;cursor=0;tree=exports[component](f.props);beforeEffects?.(tree);effects.splice(0).forEach(fn=>fn());assert.ok(++loops<20);}while(dirty);return tree;};
  f.find=predicate=>all(tree,predicate);f.text=()=>text(tree);f.button=label=>f.find(node=>node.type==='button'&&text(node)===label)[0];f.radios=()=>f.find(node=>node.type==='input'&&node.props.type==='radio');f.remount=()=>{slots.forEach(value=>value?.cleanup?.());slots.length=0;f.render();};f.dispose=()=>slots.forEach(value=>value?.cleanup?.());f.render();return f;
}
test('saved suggestions are ordered but never selected; foreign language and other cards remain separate',async()=>{const f=fixture();await flush();f.render();assert.equal(f.reads,1);assert.equal(f.writes.length,0);assert.ok(f.radios().every(node=>!node.props.checked));assert.equal(f.gates.at(-1),false);assert.match(f.text(),/AI suggestion · not a confirmation/);assert.equal(f.button('Confirm selected identity').props.disabled,true);const labels=f.find(node=>node.type==='strong').map(text);assert.ok(labels.indexOf('suggested')<labels.indexOf('second'));assert.match(f.text(),/Other languages/);assert.match(f.text(),/Other card matches/);assert.match(f.text(),/Reference photo unavailable/);f.dispose();});
test('choice alone keeps approval blocked; explicit successful confirmation opens gate after workspace refresh',async()=>{const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();assert.equal(f.gates.at(-1),false);f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.writes.length,1);assert.equal(f.writes[0].decision,'SELECTED');assert.equal(f.saved,1);assert.equal(f.gates.at(-1),true);assert.match(f.text(),/Human confirmed/);f.dispose();});
test('lost acknowledgement retains exact decision and reconciles with read only before another choice',async()=>{const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();f.save=input=>{f.status={...f.status,confirmation:{...input,selectedCandidateId:input.candidateId},approvalReady:true};throw Error('lost reply');};f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.gates.at(-1),false);assert.ok(f.radios().every(node=>node.props.disabled));assert.ok(f.button('Check retained decision'));f.button('Check retained decision').props.onClick();await flush();f.render();assert.equal(f.writes.length,1);assert.equal(f.saved,1);assert.equal(f.gates.at(-1),true);f.dispose();});
test('unresolved saves hold and manual observation requires both nonempty fields',async()=>{const f=fixture();await flush();f.render();f.button('I cannot tell').props.onClick();f.render();assert.equal(f.button('Save for identity review').props.disabled,false);f.button('Save for identity review').props.onClick();await flush();f.render();assert.equal(f.writes[0].decision,'UNRESOLVED');assert.equal(f.gates.at(-1),false);f.button('I can identify it from the physical card').props.onClick();f.render();assert.equal(f.button('Confirm selected identity').props.disabled,true);f.find(node=>node.type==='input'&&node.props.maxLength===120)[0].props.onChange({target:{value:'English reverse holo'}});f.render();f.find(node=>node.type==='textarea')[0].props.onChange({target:{value:'English text, matching number, foil outside artwork.'}});f.render();assert.equal(f.button('Confirm selected identity').props.disabled,false);f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.writes[1].decision,'MANUAL');assert.equal(f.gates.at(-1),true);f.dispose();});
test('saved decision with failed workspace reload stays gated and offers read-only recovery',async()=>{const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();f.reload=()=>{throw Error('workspace lost');};f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.gates.at(-1),false);assert.match(f.text(),/current review could not be reloaded/);f.reload=null;f.button('Check saved matches').props.onClick();await flush();f.render();assert.equal(f.writes.length,1);assert.equal(f.gates.at(-1),true);f.dispose();});
test('reloading after changed identity acknowledgement refreshes old workspace and refuses stale gate',async()=>{const f=fixture();f.status.identityRevision=2;f.status.approvalReady=true;f.status.confirmation={decision:'MANUAL',sourceHash:f.status.sourceHash,identityRevision:2,identityHash:f.status.identityHash};await flush();f.render();assert.equal(f.saved,1);assert.equal(f.gates.at(-1),false);assert.ok(f.radios().every(node=>node.props.disabled));f.dispose();});
test('late status from another card is discarded; queued polling does no writes and ends on unmount',async()=>{const f=fixture();let finish;f.read=()=>new Promise(resolve=>{finish=resolve;});await flush();f.props.cardId=randomUUID();f.status.state='QUEUED';f.read=null;f.render();await flush();f.render();const latest=f.text();finish({...f.status,state:'FAILED'});await flush();f.render();assert.equal(f.text(),latest);assert.match(f.text(),/queued/);assert.equal(f.writes.length,0);f.dispose();});
test('reference selection refuses unlicensed and unsafe images without promoting artwork to exact',()=>{const f=fixture(),pick=f.exports.variantReference;assert.equal(pick({images:[{url:'https://example.com/a',relationship:'exact',provenance:{usage:'permission_required'}}]}),null);assert.equal(pick({images:[{url:'javascript:alert(1)',relationship:'exact',provenance:{usage:'reviewed_catalog'}}]}),null);const image={url:'https://example.com/art',relationship:'card_art_only',provenance:{usage:'provider_reference'}};assert.equal(pick({images:[image]}).relationship,'card_art_only');f.dispose();});

test('an immediate image refusal stays unavailable after effects; another source can load',()=>{
 let refused = false;
 const f = fixture({ component:'ReferencePhoto', props:{image:{url:'https://images.scrydex.com/pokemon/xy12-51/large'},label:'Mewtwo artwork'},
  beforeEffects(tree){ const img=all(tree,node=>node.type==='img')[0]; if(img&&!refused){refused=true;img.props.onError();} } });
 assert.equal(refused,true);assert.equal(f.find(node=>node.type==='img').length,0);assert.match(f.text(),/Reference photo unavailable/);
 f.render();assert.equal(f.find(node=>node.type==='img').length,0,'a later render must not erase a known failure');
 f.props.image={url:'https://assets.tcgdex.net/en/xy/xy12/51/high.webp'};f.render();
 const img=f.find(node=>node.type==='img')[0];assert.equal(img.props.src,f.props.image.url);assert.equal(img.props.referrerPolicy,'no-referrer');
 img.props.onError();f.render();assert.match(f.text(),/Reference photo unavailable/);f.dispose();
});


test('manual draft after an unresolved hold restores as manual, and a new choice cannot reuse previous manual confirmation',async()=>{const f=fixture();await flush();f.render();f.button('I cannot tell').props.onClick();f.render();f.button('Save for identity review').props.onClick();await flush();f.render();f.button('I can identify it from the physical card').props.onClick();f.render();f.find(node=>node.type==='input'&&node.props.maxLength===120)[0].props.onChange({target:{value:'English reverse holo'}});f.render();f.find(node=>node.type==='textarea')[0].props.onChange({target:{value:'Foil outside artwork.'}});f.render();f.remount();await flush();f.render();assert.equal(f.button('Save for identity review'),undefined);assert.equal(f.button('Confirm selected identity').props.disabled,false);f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.gates.at(-1),true);f.radios()[0].props.onChange();f.render();assert.equal(f.gates.at(-1),false);assert.equal(f.button('Confirm selected identity').props.disabled,false);f.dispose();});

test('human confirmation remains visibly saved while recheck is pending; unknown only checks and known retry requires explicit action',async()=>{const f=fixture();f.status.confirmation={decision:'SELECTED',selectedCandidateId:'suggested',sourceHash:f.status.sourceHash,identityRevision:1,identityHash:f.status.identityHash,reprocessRequired:true,recheckState:'UNKNOWN',recheckRetryable:false};await flush();f.render();assert.match(f.text(),/Human confirmed/);assert.equal(f.gates.at(-1),false);assert.equal(f.button('Identity saved · grading check pending').props.disabled,true);assert.equal(f.button('Retry confirmed variant check'),undefined);f.status.confirmation.recheckState='REFUSED';f.status.confirmation.recheckRetryable=true;f.button('Check saved matches').props.onClick();await flush();f.render();assert.equal(f.button('Retry confirmed variant check').props.disabled,false);assert.equal(f.writes.length,0);f.button('Retry confirmed variant check').props.onClick();await flush();f.render();assert.equal(f.writes.length,1);assert.equal(f.writes[0].candidateId,'suggested');f.dispose();});
test('reference library refresh is explicit and an uncertain request keeps choices locked until saved acknowledgement',async()=>{const f=fixture();f.status.jobId=hash('e');f.status.refreshable=true;await flush();f.render();assert.equal(f.writes.length,0);f.save=input=>{f.status={...f.status,state:'QUEUED',refreshable:false,refreshRequestId:input.requestId,jobId:hash('f'),result:null};throw Error('lost refresh');};f.button('Refresh reference library').props.onClick();await flush();f.render();assert.ok(f.button('Check retained reference request'));assert.ok(f.radios().every(node=>node.props.disabled));f.button('Check retained reference request').props.onClick();await flush();f.render();assert.equal(f.writes.length,1);assert.equal(f.saved,0,'library refresh is not a human confirmation or grade refresh');assert.match(f.text(),/queued/);assert.equal(f.button('Refresh reference library'),undefined);f.dispose();});


test('retained reviewed and provider reference bytes use the authenticated staff route, including null catalog URLs',()=>{const f=fixture(),pick=f.exports.variantReference;for(const authority of ['reviewed_catalog','provider_candidate']){const result=pick({authority,images:[{url:null,sha256:hash('a'),relationship:'exact',publication:authority==='reviewed_catalog'?'publication':null,provenance:{usage:authority==='reviewed_catalog'?'reviewed_catalog':'provider_reference'}}]},f.props.cardId);assert.equal(result.url,`/admin/api/staff/manual-connected/cards/${f.props.cardId}/variants/images/${hash('a')}`);}f.dispose();});

test('number padding preserves same-card grouping while explicit denominator and prefix conflicts stay separate',()=>{
 const f=fixture(),compare=f.exports.variantCardNumberComparison,group=f.exports.variantCandidateGroup;
 for(const [a,b,expected] of [['039/192','39/192','match'],['#025/0165','25/165','match'],['TG01/TG030','TG1/TG30','match'],['RC1','1','conflict'],['039/192','39/193','conflict'],['039/192','39','unknown'],['039','39/192','unknown'],[null,'39','unknown']])assert.equal(compare(a,b),expected,`${a} vs ${b}`);
 const identity={cardName:'Magikarp',productSet:'Rebel Clash',cardNumber:'039/192'},candidate={identity:{name:'Magikarp',setName:'Rebel Clash',cardNumber:'39/192',language:'en'}};
 assert.equal(group(candidate,identity),'same');assert.equal(group({...candidate,identity:{...candidate.identity,cardNumber:'39'}},identity),'same');
 assert.equal(group({...candidate,identity:{...candidate.identity,cardNumber:'39/193'}},identity),'other');f.dispose();
});
test('compatible collector number without a stated set total is visibly unconfirmed rather than an exact full match',async()=>{
 const f=fixture();f.props.identity.cardNumber='025/165';await flush();f.render();
 assert.match(f.text(),/This card’s printings/);assert.match(f.text(),/Full collector number unconfirmed · check the number and set total/);
 assert.equal(f.radios().length,4);assert.equal(f.writes.length,0);f.dispose();
});
test('an unresolved hold never claims human-confirmed identity or offers to retry an inherited grading check',async()=>{
 const f=fixture();f.status.confirmation={decision:'UNRESOLVED',selectedCandidateId:null,sourceHash:f.status.sourceHash,
  identityRevision:1,identityHash:f.status.identityHash,reprocessRequired:true,recheckState:'REFUSED',recheckRetryable:true};
 await flush();f.render();assert.equal(f.gates.at(-1),false);assert.ok(f.button('Save for identity review'));
 assert.equal(f.button('Retry confirmed variant check'),undefined);assert.doesNotMatch(f.text(),/Human confirmed|variant check needs attention/);
 assert.equal(f.writes.length,0);f.dispose();
});

const contributionToggle=f=>f.find(node=>node.type==='input'&&node.props.type==='checkbox')[0];
const rightsBasis=f=>f.find(node=>node.type==='select'&&node.props['aria-label']==='Photo rights basis')[0];
const rightsNote=f=>f.find(node=>node.type==='textarea'&&node.props['aria-label']==='Brief rights note')[0];
function permitPhotos(f){contributionToggle(f).props.onChange({target:{checked:true}});f.render();rightsBasis(f).props.onChange({target:{value:'permission'}});f.render();rightsNote(f).props.onChange({target:{value:'The photographer permitted internal ATLAS and Ten Kings reference review.'}});f.render();}
test('photo contribution defaults off and requires an explicit rights basis and note without burdening ordinary confirmation',async()=>{
 const f=fixture();await flush();f.render();assert.equal(contributionToggle(f).props.checked,false);assert.equal(rightsBasis(f),undefined);
 assert.match(f.text(),/For internal ATLAS and Ten Kings reference review/);assert.match(f.text(),/does not publish them automatically/);
 f.radios()[0].props.onChange();f.render();assert.equal(f.button('Confirm selected identity').props.disabled,false);
 contributionToggle(f).props.onChange({target:{checked:true}});f.render();assert.equal(rightsBasis(f).props.value,'');assert.equal(f.button('Confirm selected identity').props.disabled,true);
 rightsBasis(f).props.onChange({target:{value:'owned_original'}});f.render();assert.equal(f.button('Confirm selected identity').props.disabled,true);
 rightsNote(f).props.onChange({target:{value:'I took these original photos and authorize this internal use.'}});f.render();assert.equal(f.button('Confirm selected identity').props.disabled,false);
 assert.equal(f.writes.length,0);f.button('Confirm selected identity').props.onClick();await flush();f.render();
 assert.deepEqual(f.writes[0].referencePermission,{basis:'owned_original',detail:'I took these original photos and authorize this internal use.',consumers:['inventory','atlas']});assert.equal(contributionToggle(f).props.checked,false);f.dispose();
});
test('photo rights survive draft reload but clear when the source or identity changes and cannot attach to unresolved holds',async()=>{
 for(const field of ['sourceHash','identityRevision']){
  const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();permitPhotos(f);f.remount();await flush();f.render();
  assert.equal(contributionToggle(f).props.checked,true);assert.equal(rightsBasis(f).props.value,'permission');assert.match(rightsNote(f).props.value,/photographer permitted/);
  const value=field==='sourceHash'?hash('f'):2;f.props[field]=value;f.status[field]=value;f.render();await flush();f.render();assert.equal(contributionToggle(f).props.checked,false);assert.equal(rightsBasis(f),undefined);assert.equal(f.writes.length,0);f.dispose();
 }
 const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();permitPhotos(f);f.button('I cannot tell').props.onClick();f.render();assert.equal(contributionToggle(f),undefined);
 f.button('Save for identity review').props.onClick();await flush();f.render();assert.equal(Object.hasOwn(f.writes[0],'referencePermission'),false);assert.equal(f.gates.at(-1),false);f.dispose();
});
test('denied opted-in save keeps exact permission pending and locks all contribution controls until explicit recovery',async()=>{
 const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();permitPhotos(f);f.save=()=>{throw {status:403,code:'SESSION_EXPIRED'};};
 f.button('Confirm selected identity').props.onClick();await flush();f.render();const original=f.writes[0];assert.ok(f.button('Check retained decision'));assert.equal(f.gates.at(-1),false);
 contributionToggle(f).props.onChange({target:{checked:false}});f.render();assert.equal(contributionToggle(f).props.checked,true);
 assert.ok(f.find(node=>node.type==='fieldset'&&node.props['aria-label']==='Optional reference photo contribution')[0].props.disabled);f.remount();await flush();f.render();assert.equal(contributionToggle(f).props.checked,true);assert.match(rightsNote(f).props.value,/photographer permitted/);
 f.save=null;f.button('Check retained decision').props.onClick();await flush();f.render();assert.deepEqual(f.writes,[original,original]);f.dispose();
});
