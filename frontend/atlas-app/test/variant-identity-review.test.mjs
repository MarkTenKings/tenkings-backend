import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import * as client from '../lib/variant-review-client.mjs';
import * as routes from '../lib/routes.mjs';
import * as referencePhotos from '../lib/variant-reference-photos.mjs';
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
  f.activity = []; f.props.onActivityChange = value => f.activity.push(value);
  f.retained = () => [...values.entries()];
  f.props.onSaved = async () => { f.saved++; await f.reload?.(); };
  const react = {createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState(initial){const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],value=>{const next=typeof value==='function'?value(slots[index]):value;if(!Object.is(slots[index],next)){slots[index]=next;dirty=true;}}];},
    useRef(initial){const index=cursor++;if(!(index in slots))slots[index]={current:initial};return slots[index];},
    useEffect(callback,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>value!==previous.deps[i])){slots[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=callback();});}},
  };
  if (props) f.props = props;
  const exports={};vm.runInNewContext(`${code}\nexports.ReferencePhoto = ReferencePhoto; exports.Comparison = Comparison;`,{exports,URL,Promise,window:{localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}},setTimeout:(fn,ms)=>{timers.set(ms,fn);return ms;},clearTimeout:ms=>timers.delete(ms),require(name){
    if(name==='react')return react;
    if(name.endsWith('routes.mjs'))return routes;
    if(name==='@atlas/manual-workspace')return{geometryImage:()=>({url:'verified'})};
    if(name==='@atlas/manual-workspace/report-review')return{useVerifiedImage:descriptor=>({url:f.images&&descriptor?(descriptor.generative?'blob:clean':'blob:verified'):null})};
    if(name.endsWith('variant-review-client.mjs'))return client;
    if(name.endsWith('variant-reference-photos.mjs'))return referencePhotos;
    if(name.endsWith('manual-client.mjs'))return{manualRequest:async(path,options)=>{if(!options.method){f.reads++;return f.read?f.read():structuredClone(f.status);}f.writes.push(options.body);if(f.save)return f.save(options.body);const input=options.body;f.status={...f.status,confirmation:{...input,selectedCandidateId:input.candidateId},approvalReady:input.decision!=='UNRESOLVED'};return structuredClone(f.status);}};
    if(name.endsWith('.css'))return new Proxy({},{get:(_,key)=>key});return nextRequire(name.startsWith('@babel/runtime/')?`next/dist/compiled/${name}`:name);
  }});
  f.exports=exports;f.render=()=>{let loops=0;do{dirty=false;cursor=0;tree=exports[component](f.props);beforeEffects?.(tree);effects.splice(0).forEach(fn=>fn());assert.ok(++loops<20);}while(dirty);return tree;};
  f.find=predicate=>all(tree,predicate);f.text=()=>text(tree);f.button=label=>f.find(node=>node.type==='button'&&text(node)===label)[0];f.radios=()=>f.find(node=>node.type==='input'&&node.props.type==='radio');f.remount=()=>{slots.forEach(value=>value?.cleanup?.());slots.length=0;f.render();};f.dispose=()=>slots.forEach(value=>value?.cleanup?.());f.render();return f;
}
test('saved suggestions are ordered but never selected; foreign language and other cards remain separate',async()=>{const f=fixture();await flush();f.render();assert.equal(f.reads,1);assert.equal(f.writes.length,0);assert.ok(f.radios().every(node=>!node.props.checked));assert.equal(f.gates.at(-1),false);assert.match(f.text(),/AI suggestion · not a confirmation/);assert.equal(f.button('Confirm selected identity').props.disabled,true);const labels=f.find(node=>node.type==='strong').map(text);assert.ok(labels.indexOf('suggested')<labels.indexOf('second'));assert.match(f.text(),/Other languages/);assert.match(f.text(),/Other card matches/);assert.match(f.text(),/No matching reference photo yet/);f.dispose();});

test('saved sports identity stays visible before and after an empty catalog without claiming variant confirmation',async()=>{
 const f=fixture();f.props.identity={playerName:'Drake Maye',year:2025,manufacturer:'Panini',productSet:'Donruss Optic Football — Donruss Threads',cardNumber:'DTBH-DME',parallel:null};
 f.status.result.catalog.candidates=[];f.status.result.suggestion=null;f.render();
 const summary=()=>f.find(node=>node.props['aria-label']==='Saved card identification')[0];
 for(const value of ['Card identified','Drake Maye','2025','Panini','Donruss Optic Football — Donruss Threads','DTBH-DME','Saved variantNot recorded'])assert(text(summary()).includes(value),value);
 await flush();f.render();assert.match(f.text(),/reference library has no usable variant matches/);assert.match(f.text(),/Variant still needs confirmation/);
 assert.doesNotMatch(f.text(),/waits for an identified card|Card name not recorded/);assert.equal(f.gates.at(-1),false);assert.equal(f.writes.length,0);
 assert.equal(f.button('Confirm selected identity').props.disabled,true);
 f.button('I cannot tell').props.onClick();f.render();assert.match(f.text(),/card identification and grading work stay saved/);
 for(const value of ['Drake Maye','Panini','Donruss Optic Football — Donruss Threads','DTBH-DME','Saved variantNot recorded'])assert(text(summary()).includes(value),value);
 assert.equal(f.gates.at(-1),false);assert.equal(f.writes.length,0);f.dispose();
});

test('a missing saved variant is displayed as unrecorded and never inferred from candidate suggestions',async()=>{
 const f=fixture();f.props.identity={cardName:'Pikachu',year:2023,productSet:'151',cardNumber:'025',parallel:null};await flush();f.render();
 const summary=f.find(node=>node.props['aria-label']==='Saved card identification')[0];
 assert.match(text(summary),/Card identifiedPikachu/);assert.match(text(summary),/Saved variantNot recorded/);assert.doesNotMatch(text(summary),/Reverse holo/);
 assert.equal(f.gates.at(-1),false);assert.equal(f.writes.length,0);f.dispose();
});
test('empty catalog exposes physical-variant verification directly without retyping saved card identity or bypassing review',async()=>{
 const f=fixture();f.props.identity={playerName:'Drake Maye',year:2025,manufacturer:'Panini',productSet:'Donruss Optic Football — Donruss Threads',cardNumber:'DTBH-DME',parallel:null};
 f.status.result.catalog.candidates=[];await flush();f.render();
 assert.ok(f.button('Base'));assert.equal(f.button('I can verify the variant on the physical card'),undefined);
 assert.match(f.text(),/Drake Maye/);assert.match(f.text(),/DTBH-DME/);assert.equal(f.find(node=>node.type==='input'&&node.props.type!=='checkbox').length,1,'only the observed variant input is needed');
 const field=f.find(node=>node.type==='input'&&node.props.maxLength===120)[0];assert.equal(field.props.value,'');assert.equal(f.button('Confirm selected identity').props.disabled,true);
 field.props.onChange({target:{value:'Observed printing from physical card'}});f.render();assert.equal(f.button('Confirm selected identity').props.disabled,false,'explicit printing is sufficient');
 assert.equal(f.find(node=>node.type==='textarea').length,0);assert.equal(f.button('Confirm selected identity').props.disabled,false);assert.equal(f.writes.length,0);
 f.button('I cannot tell').props.onClick();f.render();assert.equal(f.gates.at(-1),false);assert.equal(f.writes.length,0);assert.ok(f.button('Save for identity review'));f.dispose();
});
test('choice alone keeps approval blocked; explicit successful confirmation opens gate after workspace refresh',async()=>{const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();assert.equal(f.gates.at(-1),false);f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.writes.length,1);assert.equal(f.writes[0].decision,'SELECTED');assert.equal(f.saved,1);assert.equal(f.gates.at(-1),true);assert.match(f.text(),/Human confirmed/);f.dispose();});
test('lost acknowledgement retains exact decision and reconciles with read only before another choice',async()=>{const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();f.save=input=>{f.status={...f.status,confirmation:{...input,selectedCandidateId:input.candidateId},approvalReady:true};throw Error('lost reply');};f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.gates.at(-1),false);assert.ok(f.radios().every(node=>node.props.disabled));assert.ok(f.button('Check retained decision'));f.button('Check retained decision').props.onClick();await flush();f.render();assert.equal(f.writes.length,1);assert.equal(f.saved,1);assert.equal(f.gates.at(-1),true);f.dispose();});
test('unresolved saves hold and explicit named printing needs no note',async()=>{const f=fixture();await flush();f.render();f.button('I cannot tell').props.onClick();f.render();assert.equal(f.button('Save for identity review').props.disabled,false);f.button('Save for identity review').props.onClick();await flush();f.render();assert.equal(f.writes[0].decision,'UNRESOLVED');assert.equal(f.gates.at(-1),false);f.find(node=>node.type==='input'&&node.props.maxLength===120)[0].props.onChange({target:{value:'English reverse holo'}});f.render();assert.equal(f.find(node=>node.type==='textarea').length,0);assert.equal(f.button('Confirm selected identity').props.disabled,false);f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.writes[1].decision,'MANUAL');assert.equal(f.gates.at(-1),true);f.dispose();});
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


test('manual draft after an unresolved hold restores as manual, and a new choice cannot reuse previous manual confirmation',async()=>{const f=fixture();await flush();f.render();f.button('I cannot tell').props.onClick();f.render();f.button('Save for identity review').props.onClick();await flush();f.render();assert.ok(f.button('Base'));f.find(node=>node.type==='input'&&node.props.maxLength===120)[0].props.onChange({target:{value:'English reverse holo'}});f.render();assert.equal(f.find(node=>node.type==='textarea').length,0);f.remount();await flush();f.render();assert.equal(f.button('Save for identity review'),undefined);assert.equal(f.button('Confirm selected identity').props.disabled,false);f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.gates.at(-1),true);f.radios()[0].props.onChange();f.render();assert.equal(f.gates.at(-1),false);assert.equal(f.button('Confirm selected identity').props.disabled,false);f.dispose();});

test('historical automatic recheck metadata cannot block a saved human confirmation or offer dispatch',async()=>{
 const f=fixture();f.status.approvalReady=true;f.status.confirmation={decision:'SELECTED',selectedCandidateId:'suggested',sourceHash:f.status.sourceHash,identityRevision:1,identityHash:f.status.identityHash,reprocessRequired:true,recheckState:'UNKNOWN',recheckRetryable:true};
 await flush();f.render();assert.match(f.text(),/Human confirmed/);assert.equal(f.gates.at(-1),true);
 assert.equal(f.button('Identity saved · grading check pending'),undefined);assert.equal(f.button('Retry confirmed variant check'),undefined);assert.equal(f.writes.length,0);f.dispose();
});
test('reference library refresh is explicit and an uncertain request keeps choices locked until saved acknowledgement',async()=>{const f=fixture();f.status.jobId=hash('e');f.status.refreshable=true;await flush();f.render();assert.equal(f.writes.length,0);f.save=input=>{f.status={...f.status,state:'QUEUED',refreshable:false,refreshRequestId:input.requestId,jobId:hash('f'),result:null};throw Error('lost refresh');};f.button('Refresh reference library').props.onClick();await flush();f.render();assert.ok(f.button('Check retained reference request'));assert.ok(f.radios().every(node=>node.props.disabled));f.button('Check retained reference request').props.onClick();await flush();f.render();assert.equal(f.writes.length,1);assert.equal(f.saved,0,'library refresh is not a human confirmation or grade refresh');assert.match(f.text(),/queued/);assert.equal(f.button('Refresh reference library'),undefined);f.dispose();});

test('a physically confirmed card can prepare its first references without repeating confirmation',async()=>{
 const f=fixture();f.status={...f.status,state:'NOT_REQUESTED',jobId:null,result:null,resultHash:null,refreshable:true,approvalReady:true};
 const confirmation={decision:'MANUAL',sourceHash:f.status.sourceHash,identityRevision:1,identityHash:f.status.identityHash};f.status.confirmation=confirmation;
 await flush();f.render();assert.equal(f.gates.at(-1),true);assert.equal(f.writes.length,0);assert.equal(f.button('Prepare references').props.disabled,false);
 f.save=input=>(f.status={...f.status,state:'QUEUED',jobId:hash('e'),refreshable:false,refreshRequestId:input.requestId});
 f.button('Prepare references').props.onClick();await flush();f.render();
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].jobId,null);assert.deepEqual(f.status.confirmation,confirmation);
 assert.equal(f.gates.at(-1),true);assert.equal(f.saved,0);assert.match(f.text(),/queued/);f.dispose();
});

test('missing-year search choices show each source year without filling or confirming the saved identity',async()=>{
 const f=fixture(),base=f.status.result.catalog.candidates[0];f.props.identity.year=null;f.status.result.suggestion=null;
 f.status.result.catalog.candidates=['2024-25','2025-26'].map((year,index)=>({...base,candidateId:`year-${index}`,label:'Base',identity:{...base.identity,year}}));
 await flush();f.render();const choices=f.find(node=>node.type==='label'&&node.props['data-selected']!==undefined);
 assert.deepEqual(choices.map(choice=>all(choice,node=>node.type==='small').map(text)),[['2024-25'],['2025-26']]);assert.ok(f.radios().every(radio=>!radio.props.checked));
 assert.equal(f.props.identity.year,null);assert.equal(f.writes.length,0);f.dispose();
});


test('retained reviewed and provider reference bytes use the authenticated staff route, including null catalog URLs',()=>{const f=fixture(),pick=f.exports.variantReference;for(const authority of ['reviewed_catalog','provider_candidate']){const result=pick({authority,images:[{url:null,sha256:hash('a'),relationship:'exact',publication:authority==='reviewed_catalog'?'publication':null,provenance:{usage:authority==='reviewed_catalog'?'reviewed_catalog':'provider_reference'}}]},f.props.cardId);assert.equal(result.url,`/admin/api/staff/manual-connected/cards/${f.props.cardId}/variants/images/${hash('a')}`);}f.dispose();});

const listingImage = (extra = {}) => ({imageId:'listing-photo',url:'https://i.ebayimg.com/images/synthetic.jpg',sha256:hash('e'),mimeType:'image/jpeg',relationship:'listing_photo',
 listing:{id:'123456789012',title:'Synthetic Pikachu 025/165 English Reverse Holo — exact seller title for the reference photograph',url:'https://www.ebay.com/itm/123456789012'},
 provenance:{provider:'ebay_sold_comps_v2',usage:'provider_reference',sourceUrl:'https://i.ebayimg.com/images/synthetic.jpg'},...extra});
const artworkImage = {imageId:'shared-art',url:'https://images.scrydex.com/pokemon/fixture/large',relationship:'card_art_only',provenance:{provider:'scrydex',usage:'provider_reference'}};
test('cross-provider listing photo beats generic artwork and only loads through saved authenticated bytes',()=>{
 const f=fixture(),pick=f.exports.variantReference,image=listingImage(),candidate={authority:'provider_candidate',source:{provider:'scrydex'},images:[artworkImage,image]};
 const selected=pick(candidate,f.props.cardId);assert.equal(selected.relationship,'listing_photo');assert.equal(selected.listing.title,image.listing.title);
 assert.equal(selected.url,`/admin/api/staff/manual-connected/cards/${f.props.cardId}/variants/images/${image.sha256}`);
 for(const invalid of [{sha256:null},{provenance:{provider:'scrydex',usage:'provider_reference'}},{provenance:{provider:'ebay_sold_comps_v2',usage:'reviewed_catalog'}},
  {listing:{listingId:'123456789012',title:image.listing.title,listingUrl:image.listing.url}},{listing:{...image.listing,url:'javascript:alert(1)'}},{listing:{...image.listing,url:'//www.ebay.com/itm/123456789012'}}]){
  assert.equal(pick({...candidate,images:[listingImage(invalid)]},f.props.cardId),null);
 }
 assert.equal(pick({...candidate,images:[image]}),null,'a raw eBay image URL is never rendered without retained card binding');
 assert.equal(pick({...candidate,images:[artworkImage]},f.props.cardId,{artwork:false}),null);f.dispose();
});
test('listing tile and comparison retain catalog label, exact image listing title and link with no price or automatic choice',async()=>{
 const f=fixture(),image=listingImage();f.status.result.suggestion=null;
 const candidate={...f.status.result.catalog.candidates[0],label:'Scrydex · Reverse Holo',authority:'provider_candidate',source:{provider:'scrydex',url:'https://scrydex.com/cards/fixture'},images:[artworkImage,image],soldPrice:99999};
 f.status.result.catalog.candidates=[candidate];await flush();f.render();
 assert.match(f.text(),/Scrydex · Reverse Holo/);assert.match(f.text(),/eBay listing photo/);assert.ok(f.text().includes(image.listing.title));assert.doesNotMatch(f.text(),/99999|Sold price/);
 const listingLink=f.find(node=>node.type==='a'&&text(node)===image.listing.title);assert.equal(listingLink.length,1);assert.equal(listingLink[0].props.href,image.listing.url);
 assert.equal(listingLink[0].props.rel,'noopener noreferrer');assert.equal(f.find(node=>node.type==='a'&&node.props.href===image.provenance.sourceUrl).length,0);
 assert.equal(f.radios()[0].props.checked,false);assert.equal(f.writes.length,0);assert.equal(f.gates.at(-1),false);
 f.find(node=>node.type==='button'&&node.props['aria-label']==='Enlarge Scrydex · Reverse Holo reference')[0].props.onClick({currentTarget:{focus(){}}});f.render();
 const comparison=f.find(node=>node.type?.name==='Comparison')[0];assert.equal(comparison.props.reference.relationship,'listing_photo');
 const dialog=fixture({component:'Comparison',props:comparison.props});assert.ok(dialog.text().includes(image.listing.title));assert.match(dialog.text(),/eBay listing photo/);
 assert.equal(dialog.find(node=>node.type==='a'&&text(node)===image.listing.title)[0].props.href,image.listing.url);assert.equal(dialog.button('Enlarge both photos').props['aria-pressed'],false);
 dialog.button('Enlarge both photos').props.onClick();dialog.render();assert.equal(dialog.button('Fit both photos').props['aria-pressed'],true);
 dialog.dispose();f.dispose();
});
test('named variants stay selectable without photos; repeated artwork never substitutes for a variant photo',async()=>{
 const f=fixture(),base=f.status.result.catalog.candidates[0];f.status.result.suggestion=null;
 f.status.result.catalog.candidates=['Normal','Holo','Reverse Holo','Stamped','Other finish'].map((label,index)=>({...base,candidateId:`art-${index}`,label,parallel:label,images:[artworkImage]}));
 await flush();f.render();assert.equal(f.radios().length,5);assert.ok(f.radios().every(radio=>!radio.props.checked&&!radio.props.disabled));
 assert.equal(f.find(node=>node.type?.name==='ReferencePhoto').length,0);assert.match(f.text(),/No matching reference photo yet/);
 f.radios()[2].props.onChange();f.render();assert.match(text(f.find(node=>node.props['aria-label']==='Variant reference preview')[0]),/Reverse Holo/);
 assert.equal(f.writes.length,0);assert.equal(f.gates.at(-1),false);f.dispose();
});
test('unknown seller variant remains visibly unconfirmed and separate from an explicitly supported catalog variant',async()=>{
 const f=fixture(),base=f.status.result.catalog.candidates[0];f.status.result.suggestion=null;
 f.status.result.catalog.candidates=[{...base,candidateId:'known',label:'Reverse Holo',images:[]},{...base,candidateId:'unknown',label:'Listing · printing unconfirmed',source:{provider:'ebay_sold_comps_v2'},parallel:null,images:[listingImage()]}];
 await flush();f.render();assert.equal(f.radios().length,1);assert.equal(f.radios()[0].props.disabled,false);
 assert.match(f.text(),/Other saved reference photos/);assert.ok(f.radios().every(radio=>!radio.props.checked));assert.equal(f.writes.length,0);f.dispose();
});
test('actual listing adapter and Scrydex composition produce a displayable retained photo with exact listing attribution',async()=>{
 const {prepareVariantListingRequest,createVariantListingProvider}=await import('../../../packages/atlas-connected-manual/src/variant-listing-provider.mjs');
 const {importScrydexVariantCandidates,scrydexVariantSearchUrl}=await import('../../../packages/card-catalog-evidence/src/index.mjs');
 const digest=value=>createHash('sha256').update(value).digest('hex'),capturedAt='2026-10-10T10:00:00.000Z';
 const identity={category:'POKEMON',name:'Mewtwo',year:'2016',setName:'Evolutions',cardNumber:'051/108',manufacturer:null,language:null};
 const title='2016 Pokemon Evolutions Mewtwo #51/108 English Reverse Holo',id='123456780001',printing={name:'Reverse Holofoil',language:'en'},request=prepareVariantListingRequest(identity,printing);
 const bodyText=JSON.stringify({keyword:request.query,page:1,totalItems:1,hasNextPage:false,items:[{itemId:id,title,url:`https://www.ebay.com/itm/${id}`,thumbnailUrl:'https://i.ebayimg.com/images/g/fixture/s-l300.jpg',listingType:'sold',condition:'Ungraded',endedAt:'2026-10-09',soldPrice:'99.95',soldCurrency:'USD',bestOfferAccepted:false}]});
 const source={schemaVersion:'variant-listing-response/v1',requestKey:request.requestKey,url:request.url,httpStatus:200,contentType:'application/json',bodyText,sha256:digest(bodyText),capturedAt};
 const sharp=createRequire(new URL('../../../packages/atlas-connected-manual/package.json',import.meta.url))('sharp');
 const bytes=await sharp({create:{width:12,height:16,channels:3,background:'#345678'}}).png().toBuffer(),entries=new Map();let imageReads=0;
 const provider=createVariantListingProvider({now:()=>Date.parse(capturedAt),cache:{get:async key=>entries.get(key),getRetained:async key=>entries.get(key),put:async(key,value)=>entries.set(key,structuredClone(value))},fetchImpl:async url=>{assert.equal(url,'https://i.ebayimg.com/images/g/fixture/s-l300.jpg');imageReads++;return new Response(bytes,{headers:{'content-type':'image/png'}});}});
 const evidence=await provider.acquireImages({request,source});assert.equal(imageReads,1);
 const choices=importScrydexVariantCandidates({identity,card:{id:'xy12-51',name:'Mewtwo',number:'51',printed_number:'51/108',language_code:'en',expansion:{id:'xy12',name:'Evolutions',release_date:'2016/11/02',is_online_only:false,printed_total:108},images:[{type:'front',large:'https://images.scrydex.com/pokemon/xy12-51/large'}],variants:[{name:'normal',images:[]},{name:'reverseHolofoil',images:[]}]},source:{url:scrydexVariantSearchUrl(identity),sha256:digest('scrydex fixture'),capturedAt}});
 const f=fixture();f.props.identity={cardName:identity.name,productSet:identity.setName,cardNumber:identity.cardNumber};
 f.status.result.catalog.candidates=choices;f.status.result.catalog.referencePhotos=evidence.referencePhotos;f.status.result.suggestion=null;await flush();f.render();
 assert.equal(evidence.referencePhotos.length,1);assert.equal(evidence.referencePhotos[0].sha256,digest(bytes));
 assert(choices.every(candidate=>candidate.images.every(image=>image.relationship!=='listing_photo')),'A seller title cannot assign a printing');
 assert.equal(f.find(node=>node.type==='a'&&text(node)===title)[0].props.href,`https://www.ebay.com/itm/${id}`);
 assert.doesNotMatch(f.text(),/99\.95|USD/);assert.equal(f.writes.length,0);assert.ok(f.radios().every(node=>!node.props.checked));f.dispose();
});

test('an unsaved not-shown choice can be explicitly discarded for one durable reference refresh',async()=>{
 const f=fixture();f.status.jobId=hash('e');f.status.refreshable=true;await flush();f.render();
 f.button('My card is not shown').props.onClick();f.render();f.remount();await flush();f.render();
 const label='Discard unsaved choice and refresh reference library';assert.equal(f.button(label).props.disabled,false);
 assert.match(f.text(),/discards only your unsaved variant choice/);assert.match(f.text(),/saved variant and grading work stay unchanged/);assert.equal(f.writes.length,0);
 f.save=input=>{f.status={...f.status,state:'QUEUED',refreshable:false,refreshRequestId:input.requestId,jobId:hash('f'),result:null};return structuredClone(f.status);};
 const click=f.button(label).props.onClick;click();click();await flush();f.render();
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].jobId,hash('e'));assert.ok(f.writes[0].requestId);assert.equal(f.writes[0].actionId,undefined);assert.equal(f.writes[0].decision,undefined);
 assert.equal(f.saved,0);assert.equal(f.gates.at(-1),false);assert.equal(f.button(label),undefined);assert.equal(f.button('Save for identity review'),undefined);
 f.remount();await flush();f.render();assert.equal(f.button('Save for identity review'),undefined,'the discarded local hold does not return after reload');f.dispose();
});

test('discard-and-refresh refuses stale binding and cannot replace an uncertain retained confirmation',async()=>{
 const label='Discard unsaved choice and refresh reference library';
 const stale=fixture();stale.status.jobId=hash('e');stale.status.refreshable=true;await flush();stale.render();stale.button('My card is not shown').props.onClick();stale.render();
 stale.status.sourceHash=hash('f');stale.button(label).props.onClick();await flush();stale.render();assert.equal(stale.writes.length,0);assert.match(stale.text(),/photos or saved card identity changed/);stale.dispose();
 const pending=fixture();pending.status.jobId=hash('e');pending.status.refreshable=true;await flush();pending.render();pending.button('My card is not shown').props.onClick();pending.render();
 const oldRefresh=pending.button(label).props.onClick;pending.save=()=>{throw Error('uncertain save');};pending.button('Save for identity review').props.onClick();await flush();pending.render();
 assert.equal(pending.writes.length,1);assert.equal(pending.button(label).props.disabled,true);assert.ok(pending.button('Check retained decision'));
 oldRefresh();await flush();pending.render();assert.equal(pending.writes.length,1,'even a stale click handler must not replace the pending request');assert.ok(pending.button('Check retained decision'));pending.dispose();
});

test('number padding preserves same-card grouping while explicit denominator and prefix conflicts stay separate',()=>{
 const f=fixture(),compare=f.exports.variantCardNumberComparison,group=f.exports.variantCandidateGroup;
 for(const [a,b,expected] of [['039/192','39/192','match'],['#025/0165','25/165','match'],['TG01/TG030','TG1/TG30','match'],['RC1','1','conflict'],['039/192','39/193','conflict'],['039/192','39','unknown'],['039','39/192','unknown'],[null,'39','unknown']])assert.equal(compare(a,b),expected,`${a} vs ${b}`);
 const identity={cardName:'Magikarp',productSet:'Rebel Clash',cardNumber:'039/192'},candidate={identity:{name:'Magikarp',setName:'Rebel Clash',cardNumber:'39/192',language:'en'}};
 assert.equal(group(candidate,identity),'same');assert.equal(group({...candidate,identity:{...candidate.identity,cardNumber:'39'}},identity),'same');
 assert.equal(group({...candidate,identity:{...candidate.identity,cardNumber:'39/193'}},identity),'other');f.dispose();
});
test('compatible collector number without a stated set total is visibly unconfirmed rather than an exact full match',async()=>{
 const f=fixture();f.props.identity.cardNumber='025/165';await flush();f.render();
 assert.match(f.text(),/Variants for this card/);assert.match(f.text(),/Full collector number unconfirmed · check the number and set total/);
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
function permitPhotos(f){contributionToggle(f).props.onChange({target:{checked:true}});f.render();rightsBasis(f).props.onChange({target:{value:'permission'}});f.render();assert.equal(f.find(node=>node.type==='textarea').length,0);}
test('photo contribution defaults off and requires an explicit rights basis without burdening ordinary confirmation',async()=>{
 const f=fixture();await flush();f.render();assert.equal(contributionToggle(f).props.checked,false);assert.equal(rightsBasis(f),undefined);
 assert.match(f.text(),/For internal ATLAS and Ten Kings reference review/);assert.match(f.text(),/does not publish them automatically/);
 f.radios()[0].props.onChange();f.render();assert.equal(f.button('Confirm selected identity').props.disabled,false);
 contributionToggle(f).props.onChange({target:{checked:true}});f.render();assert.equal(rightsBasis(f).props.value,'');assert.equal(f.button('Confirm selected identity').props.disabled,true);
 rightsBasis(f).props.onChange({target:{value:'owned_original'}});f.render();assert.equal(f.button('Confirm selected identity').props.disabled,false);
 assert.equal(f.find(node=>node.type==='textarea').length,0);assert.equal(f.button('Confirm selected identity').props.disabled,false);
 assert.equal(f.writes.length,0);f.button('Confirm selected identity').props.onClick();await flush();f.render();
 assert.deepEqual(f.writes[0].referencePermission,{basis:'owned_original',consumers:['inventory','atlas']});assert.equal(contributionToggle(f).props.checked,false);f.dispose();
});
test('photo rights survive draft reload but clear when the source or identity changes and cannot attach to unresolved holds',async()=>{
 for(const field of ['sourceHash','identityRevision']){
  const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();permitPhotos(f);f.remount();await flush();f.render();
  assert.equal(contributionToggle(f).props.checked,true);assert.equal(rightsBasis(f).props.value,'permission');assert.equal(f.find(node=>node.type==='textarea').length,0);
  const value=field==='sourceHash'?hash('f'):2;f.props[field]=value;f.status[field]=value;f.render();await flush();f.render();assert.equal(contributionToggle(f).props.checked,false);assert.equal(rightsBasis(f),undefined);assert.equal(f.writes.length,0);f.dispose();
 }
 const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();permitPhotos(f);f.button('I cannot tell').props.onClick();f.render();assert.equal(contributionToggle(f),undefined);
 f.button('Save for identity review').props.onClick();await flush();f.render();assert.equal(Object.hasOwn(f.writes[0],'referencePermission'),false);assert.equal(f.gates.at(-1),false);f.dispose();
});
test('denied opted-in save keeps exact permission pending and locks all contribution controls until explicit recovery',async()=>{
 const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();permitPhotos(f);f.save=()=>{throw {status:403,code:'SESSION_EXPIRED'};};
 f.button('Confirm selected identity').props.onClick();await flush();f.render();const original=f.writes[0];assert.ok(f.button('Check retained decision'));assert.equal(f.gates.at(-1),false);
 contributionToggle(f).props.onChange({target:{checked:false}});f.render();assert.equal(contributionToggle(f).props.checked,true);
 assert.ok(f.find(node=>node.type==='fieldset'&&node.props['aria-label']==='Optional reference photo contribution')[0].props.disabled);f.remount();await flush();f.render();assert.equal(contributionToggle(f).props.checked,true);assert.equal(f.find(node=>node.type==='textarea').length,0);
 f.save=null;f.button('Check retained decision').props.onClick();await flush();f.render();assert.deepEqual(f.writes,[original,original]);f.dispose();
});

test('Scrydex series aliases show named variants in primary group, while wrong card/year and flagged set aliases remain separate',()=>{
 const f=fixture(),group=f.exports.variantCandidateGroup,identity={cardName:'Pikachu',productSet:'Scarlet & Violet—151',cardNumber:'025/165',year:'2023'};
 const c={identity:{name:'Pikachu',setName:'151',cardNumber:'25/165',year:'2023',language:'en'},source:{provider:'scrydex'},warnings:[]};
 assert.equal(group(c,identity),'same');assert.equal(group({...c,warnings:['SET_NAME_REQUIRES_REVIEW']},identity),'other');
 assert.equal(group({...c,identity:{...c.identity,name:'Raichu'}},identity),'other');assert.equal(group({...c,identity:{...c.identity,year:'2024'}},identity),'other');f.dispose();
});
test('saved manufacturer fallback is bound to the current photograph source and does not mutate the identity',async()=>{
 const f=fixture();f.props.savedIdentification={sourceHash:f.props.sourceHash,fields:{manufacturer:'Pokémon'}};await flush();f.render();
 assert.match(f.text(),/ManufacturerPokémon/);assert.equal(f.props.identity.manufacturer,undefined);assert.equal(f.writes.length,0);
 f.props.savedIdentification.sourceHash=hash('e');f.render();assert.match(f.text(),/ManufacturerNot recorded/);f.dispose();
});

test('reference preview changes only the viewed reference and never drafts or confirms a decision',async()=>{
 const f=fixture();f.props.previewOnly=true;await flush();f.render();
 assert.match(f.text(),/Compare variant references/);
 for(const label of ['Confirm selected identity','My card is not shown','I cannot tell'])assert.equal(f.button(label),undefined);
 assert.equal(contributionToggle(f),undefined);f.radios()[1].props.onChange();f.render();assert.equal(f.radios()[1].props.checked,true);
 assert.equal(f.writes.length,0);assert.equal(f.saved,0);assert.equal(f.gates.at(-1),false);
 f.props.previewOnly=false;f.remount();await flush();f.render();assert.ok(f.radios().every(r=>!r.props.checked));
 assert.equal(f.button('Confirm selected identity').props.disabled,true);f.dispose();
});
test('reference preview preserves an existing draft and cannot discard it for refresh',async()=>{
 const f=fixture();f.status.jobId=hash('e');f.status.refreshable=true;await flush();f.render();
 f.radios()[0].props.onChange();f.render();f.props.previewOnly=true;f.remount();await flush();f.render();
 assert.equal(f.button('Refresh reference library'),undefined);assert.equal(f.button('Discard unsaved choice and refresh reference library'),undefined);
 f.radios()[1].props.onChange();f.render();f.props.previewOnly=false;f.remount();await flush();f.render();
 assert.equal(f.radios()[0].props.checked,true);assert.equal(f.radios()[1].props.checked,false);assert.equal(f.writes.length,0);f.dispose();
});
test('reference preview permits one explicit reference refresh without refreshing or approving the grade',async()=>{
 const f=fixture();f.props.previewOnly=true;f.status.jobId=hash('e');f.status.refreshable=true;await flush();f.render();
 f.save=input=>{f.status={...f.status,state:'QUEUED',refreshable:false,refreshRequestId:input.requestId,jobId:hash('f'),result:null};return structuredClone(f.status);};
 const refresh=f.button('Refresh reference library').props.onClick;refresh();refresh();await flush();f.render();
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].decision,undefined);assert.equal(f.saved,0);assert.equal(f.gates.at(-1),false);f.dispose();
});
test('reference preview reads an uncertain confirmation without redispatching it or reloading grading',async()=>{
 const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();f.save=()=>{throw Error('uncertain save');};
 f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.writes.length,1);
 f.props.previewOnly=true;f.remount();await flush();f.render();f.button('Check saved matches').props.onClick();await flush();f.render();
 assert.equal(f.writes.length,1);assert.equal(f.saved,0);assert.equal(f.gates.at(-1),false);f.dispose();
});
test('preview releases the navigation lock for a retained confirmation without erasing or resending it',async()=>{
 const f=fixture();await flush();f.render();f.radios()[0].props.onChange();f.render();f.save=()=>{throw Error('confirmation never acknowledged');};
 f.button('Confirm selected identity').props.onClick();await flush();f.render();assert.equal(f.activity.at(-1),true);
 const retained=f.retained();assert.equal(retained.length,1);
 f.props.previewOnly=true;f.render();assert.equal(f.activity.at(-1),false,'changing to preview must unlock without requiring a remount');
 f.remount();await flush();f.render();assert.equal(f.activity.at(-1),false);
 f.button('Check saved matches').props.onClick();f.render();assert.equal(f.activity.at(-1),true,'an active read still locks navigation');
 await flush();f.render();assert.equal(f.activity.at(-1),false);assert.deepEqual(f.retained(),retained);
 assert.equal(f.writes.length,1);assert.equal(f.saved,0);assert.equal(f.gates.at(-1),false);
 f.props.previewOnly=false;f.remount();await flush();f.render();assert.equal(f.activity.at(-1),true);assert.ok(f.button('Check retained decision'));
 assert.deepEqual(f.retained(),retained);assert.equal(f.writes.length,1);f.dispose();
});
test('preview keeps a retained reference refresh locked across remount without an automatic resend or erase',async()=>{
 const f=fixture();f.props.previewOnly=true;f.status.jobId=hash('e');f.status.refreshable=true;await flush();f.render();
 f.save=()=>{throw Error('refresh never acknowledged');};f.button('Refresh reference library').props.onClick();f.render();assert.equal(f.activity.at(-1),true);
 await flush();f.render();assert.equal(f.activity.at(-1),true);assert.equal(f.writes.length,1);const retained=f.retained();assert.equal(retained.length,1);
 f.remount();await flush();f.render();assert.equal(f.activity.at(-1),true);assert.deepEqual(f.retained(),retained);
 assert.equal(f.writes.length,1);assert.equal(f.saved,0);assert.equal(f.gates.at(-1),false);f.dispose();
});
test('switching an open panel to preview prevents its late initial read from reloading grading',async()=>{
 const f=fixture();let finish;f.read=()=>new Promise(resolve=>{finish=resolve;});await flush();assert.equal(typeof finish,'function');
 f.props.previewOnly=true;f.render();finish({...structuredClone(f.status),identityRevision:2});await flush();f.render();
 assert.match(f.text(),/Compare variant references/);assert.match(f.text(),/earlier identity/);
 assert.equal(f.saved,0);assert.equal(f.writes.length,0);assert.equal(f.gates.at(-1),false);assert.equal(f.activity.at(-1),false);f.dispose();
});
test('retained listing photograph takes priority over a provider exact image',()=>{
 const f=fixture(),exact={...artworkImage,relationship:'exact'},listing=listingImage();
 assert.equal(f.exports.variantReference({authority:'provider_candidate',images:[exact,listing]},f.props.cardId).relationship,'listing_photo');f.dispose();
});


test('Codex slab references join only the exact catalog printing and photo bytes, including base',async()=>{
 const f=fixture(),image=listingImage(),candidate={...f.status.result.catalog.candidates[0],candidateId:'base',label:'Normal',parallel:'Normal',images:[]};
 f.status.result.catalog.candidates=[candidate];f.status.result.catalog.referencePhotos=[image];f.status.result.suggestion=null;
 const reading={imageId:image.imageId,sha256:image.sha256,candidateId:'base',gradingCompany:'PSA',labelText:'2023 POKEMON MEW EN 025 PIKACHU',reason:'Base printing label'};
 f.status.result.referenceLabels={version:'atlas-slab-label-associations/v1',catalogHash:f.status.result.catalog.snapshotHash,readings:[reading]};
 await flush();f.render();const reference=f.exports.variantReference(candidate,f.props.cardId,{artwork:false,result:f.status.result});
 assert.equal(reference.labelReading.text,reading.labelText);assert.equal(reference.url,`/admin/api/staff/manual-connected/cards/${f.props.cardId}/variants/images/${image.sha256}`);
 assert.match(f.text(),/PSA slab · saved in ATLAS Codex/);assert.ok(f.text().includes(reading.labelText));
 assert(f.radios().every(v=>!v.props.checked));assert.equal(f.writes.length,0);assert.equal(f.gates.at(-1),false);
 for(const change of [{candidateId:'other'},{sha256:hash('f')},{imageId:'other'},{labelText:null}]){
  const result={...f.status.result,referenceLabels:{...f.status.result.referenceLabels,readings:[{...reading,...change}]}};
  assert.equal(f.exports.variantReference(candidate,f.props.cardId,{artwork:false,result}),null);
 }
 const changed={...f.status.result,referenceLabels:{...f.status.result.referenceLabels,catalogHash:hash('f')}};
 assert.equal(f.exports.variantReference(candidate,f.props.cardId,{artwork:false,result:changed}),null);
 assert.deepEqual(candidate.images,[],'rendering does not rewrite the authoritative catalog');f.dispose();
});

test('saved slab photos remain visible when provider listing ID, title and URL are unavailable',()=>{
 const f=fixture(),image=listingImage({listing:{id:null,title:null,url:null}});
 const picked=f.exports.variantReference({authority:'provider_candidate',images:[image]},f.props.cardId);
 assert.equal(picked.sha256,image.sha256);assert.equal(picked.url,`/admin/api/staff/manual-connected/cards/${f.props.cardId}/variants/images/${image.sha256}`);f.dispose();
});

test('explicit Base confirmation is always available without references or a note, and background completion preserves its draft',async()=>{
 for(const state of ['NOT_REQUESTED','QUEUED','SEARCHING','FAILED','UNKNOWN','READY']){
  const f=fixture();f.status.state=state;f.status.result=null;await flush();f.render();
  assert.ok(f.button('Base'));
  assert.equal(f.button('Confirm selected identity').props.disabled,true);f.button('Base').props.onClick();f.render();
  f.status.jobId=hash('f');f.status.resultHash=hash('e');f.remount();await flush();f.render();
  assert.equal(f.find(node=>node.type==='textarea').length,0);assert.equal(f.button('Confirm selected identity').props.disabled,false);
  f.button('Confirm selected identity').props.onClick();await flush();f.render();
  assert.equal(f.writes[0].manualParallel,'Base');assert.equal(Object.hasOwn(f.writes[0],'observedFeatures'),false);assert.equal(f.gates.at(-1),true);f.dispose();
 }
});
test('photo wheel zoom is anchored, bounded and identical for normal wheel and Ctrl pinch',()=>{
 const f=fixture(),zoom=f.exports.zoomVariantPhoto,rect={left:0,top:0,width:400,height:600},camera={scale:1,x:0,y:0};
 const event={deltaY:-120,clientX:300,clientY:400};const next=zoom(camera,event,rect);
 assert(next.scale>1);assert(next.x<0);assert(next.y<0);assert.deepEqual(zoom(camera,{...event,ctrlKey:true},rect),next);
 assert.deepEqual({...zoom(next,{...event,deltaY:10000},rect)},camera);assert.equal(zoom(camera,{...event,deltaY:-10000},rect).scale,8);f.dispose();
});

test('empty Jaxson catalog exposes physical inputs beside its photo and the anchored action chooses then confirms explicitly',async()=>{
 const f=fixture();f.props.identity={playerName:'Jaxson Dart',year:'2025',manufacturer:'Panini',productSet:'Donruss Optic Football — Donruss Threads',cardNumber:'DTBH-JDT',parallel:null};
 f.status.result.catalog.candidates=[];f.status.result.suggestion={candidateId:null};
 f.props.renderReviewActions=options=>({type:'ReviewActions',props:options});await flush();f.render();
 const action=()=>f.find(node=>node.type==='ReviewActions')[0]?.props;
 assert.equal(action().approveLabel,'Choose variant');assert.equal(action().disabled,false);assert.equal(f.button('Confirm selected identity'),undefined);
 const choices=f.find(node=>node.props['aria-label']==='Choose the card variant')[0];
 const column=f.find(node=>node.type==='div'&&node.props.children.includes(choices))[0],layout=f.find(node=>node.type==='div'&&node.props.children.includes(column))[0];
 assert.ok(layout&&all(layout,node=>node.type==='figure').length,'physical controls share the photo comparison columns');
 let scrolls=0,focuses=0;choices.props.ref.current={scrollIntoView(){scrolls++;},querySelector(){return {focus(){focuses++;}};}};
 action().approve();assert.equal(scrolls,1);assert.equal(focuses,1);assert.equal(f.writes.length,0);assert.equal(f.gates.at(-1),false);
 f.button('Base').props.onClick();f.render();assert.equal(action().approveLabel,'Confirm variant');assert.equal(action().disabled,false);assert.equal(f.writes.length,0);
 action().approve();await flush();f.render();assert.equal(f.writes.length,1);assert.equal(f.writes[0].decision,'MANUAL');assert.equal(f.writes[0].manualParallel,'Base');assert.equal(f.gates.at(-1),true);assert.equal(action(),undefined,'saved variant leaves the dock for separate report approval');f.dispose();
});

test('a new card cannot inherit the previous card variant or enabled confirmation action',async()=>{
 const f=fixture();f.status.result.catalog.candidates=[];f.props.renderReviewActions=options=>({type:'ReviewActions',props:options});await flush();f.render();
 f.button('Base').props.onClick();f.render();f.find(node=>node.type==='ReviewActions')[0].props.approve();await flush();f.render();assert.equal(f.gates.at(-1),true);
 f.props.cardId=randomUUID();f.status={...f.status,confirmation:null,approvalReady:false};f.render();await flush();f.render();
 const action=f.find(node=>node.type==='ReviewActions')[0].props;assert.equal(action.approveLabel,'Choose variant');assert.equal(f.gates.at(-1),false);assert.equal(f.find(node=>node.type==='input'&&node.props.maxLength===120)[0].props.value,'');assert.equal(f.writes.length,1);f.dispose();
});

test('unassigned retained slab photos show literal labels and compare without becoming a printing choice',async()=>{
 const f=fixture(),image=listingImage();f.status.result.catalog.referencePhotos=[image];f.status.result.referenceLabels={version:'atlas-slab-label-associations/v1',catalogHash:f.status.result.catalog.snapshotHash,readings:[{imageId:image.imageId,sha256:image.sha256,candidateId:null,gradingCompany:'CGC',labelText:'2024 PIKACHU 025/165 COSMOS HOLO COSTCO',reason:'The saved year differs from the catalog printing.'}]};
 await flush();f.render();assert.match(f.text(),/Other saved reference photos · 1/);assert.match(f.text(),/2024 PIKACHU 025\/165 COSMOS HOLO COSTCO/);assert.match(f.text(),/Saved CGC slab · printing unassigned/);
 const gallery=f.find(node=>node.props['aria-label']==='Unassigned saved reference photos')[0];
 const photo=all(gallery,node=>node.type?.name==='ReferencePhoto')[0];assert.equal(photo.props.image.url,`/admin/api/staff/manual-connected/cards/${f.props.cardId}/variants/images/${image.sha256}`);
 f.find(node=>node.props['aria-label']==='Compare CGC · unassigned reference')[0].props.onClick({currentTarget:{focus(){}}});f.render();
 assert.equal(f.find(node=>node.type?.name==='Comparison')[0].props.candidate.images[0].associationStatus,'UNASSIGNED');assert.ok(f.radios().every(node=>!node.props.checked));assert.equal(f.writes.length,0);assert.equal(f.gates.at(-1),false);f.dispose();
});

test('catalog choice can be confirmed during reference processing without loaded images or geometry',async()=>{
 const f=fixture();f.images=false;f.props.geometry=null;f.status.state='SEARCHING';await flush();f.render();
 assert(f.radios().every(r=>!r.props.disabled));f.radios()[0].props.onChange();f.render();
 assert.equal(f.button('Confirm selected identity').props.disabled,false);f.button('Confirm selected identity').props.onClick();await flush();f.render();
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].decision,'SELECTED');f.dispose();
});
test('ready clean presentation defaults on, switches to original, and detailed comparison uses the original',async()=>{
 const f=fixture();f.props.geometry=null;f.props.images={FRONT:{original:{url:'original'},clean:{url:'clean',generative:true}},BACK:{original:{url:'back'}}};await flush();f.render();
 assert.equal(f.button('Clean').props['aria-pressed'],true);assert.match(f.text(),/AI generated/);
 const image=()=>f.find(node=>node.type==='img'&&String(node.props.alt).includes('card photograph'))[0];assert.equal(image().props.src,'blob:clean');
 f.button('Original').props.onClick();f.render();assert.equal(image().props.src,'blob:verified');assert.equal(f.button('Original').props['aria-pressed'],true);
 f.button('Clean').props.onClick();f.render();f.find(node=>node.type==='button'&&node.props['aria-label']==='Enlarge your uploaded photograph')[0].props.onClick({currentTarget:{}});f.render();
 const comparison=f.find(node=>node.type===f.exports.Comparison)[0];assert.equal(comparison.props.photo,'blob:verified');assert.doesNotMatch(f.text(),/unchanged pixels/);f.dispose();
});

test('source-supported sports season alias stays in this card printings without merging unrelated years',()=>{
 const f=fixture(),candidate={source:{provider:'manufacturer_checklist'},identity:{name:'LaMelo Ball',year:'2025-26',setName:'Topps Chrome — Ball of Duty',cardNumber:'BD-13'},diagnostics:[{id:'manufacturer-checklist-year',description:'Official checklist year: 2025-26.'}]};
 const identity={playerName:'LaMelo Ball',year:'2025',productSet:'Topps Chrome — Ball of Duty',cardNumber:'BD-13'};
 assert.equal(f.exports.variantCandidateGroup(candidate,identity),'same');assert.equal(f.exports.variantCandidateGroup({...candidate,diagnostics:[]},identity),'other');assert.equal(f.exports.variantCandidateGroup(candidate,{...identity,year:'2024'}),'other');f.dispose();
});
