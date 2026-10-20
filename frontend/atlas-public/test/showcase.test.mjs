import test from 'node:test';
import assert from 'node:assert/strict';
import { createShowcaseHandler } from '../lib/server/showcase-http.mjs';
import { SHOWCASE_SELECTIONS, validShowcaseBinding } from '../lib/showcase-selections.mjs';
import { digest } from '../lib/server/policy.mjs';
import { publicationFixture } from '../../../packages/atlas-connected-manual/test/publication-fixture.mjs';
import { fingerprintSource } from '../../../packages/atlas-manual-workspace/src/report-fingerprint.mjs';
import { validateShowcaseSource, fetchShowcaseAsset } from '../components/showcase-browser.mjs';
import { manifestFromShowcaseSource, loadHeroEvidence, canonicalToCleanUV,
  cleanUVToSource, canonicalToSource, traceSpans } from '../../../docs/atlas/design/experience/site/hero-evidence.mjs';

const fixture = (async () => {
 const f=await publicationFixture({finalGradePolicy:'atlas-final-whole-point-v1'});
 await f.publication.publish({},f.cardId,f.actionId);const m=JSON.parse(f.row.manifest);
 const packet=await f.artifacts.read(m.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:m.packet.sourceHash});
 packet.mode='PRODUCTION';return packet;
})();
async function source(section='hero',letter='A') {
 const packet=structuredClone(await fixture);packet.publicToken='ar_'+letter.repeat(24);
 return bind(packet,section);
}
function bind(packet,section='hero') {
 const publicHash=digest(JSON.stringify(packet));
 return {schema:'atlas-showcase-source-v1',section,packet,publicHash,
  binding:{publicToken:packet.publicToken,approvalVersion:packet.approvalVersion,publicHash}};
}
function response(){return{headers:{},statusCode:null,body:null,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},end(){return this;},json(v){this.body=v;return this;}};}
function setup(record) {
 let current=record,calls=0;const handle=createShowcaseHandler({selections:{hero:record.binding},readerForRequest:()=>({async read(value){calls++;assert.deepEqual(value,{token:record.binding.publicToken,version:record.binding.approvalVersion});if(current instanceof Error)throw current;return current;}})});
 return {handle,get calls(){return calls;},current(value){current=value;}};
}
async function get(handle,query={section:'hero'},method='GET'){const res=response();await handle({method,query},res);return res;}

test('four section assignments are distinct complete immutable publication bindings',()=>{
 assert.deepEqual(Object.keys(SHOWCASE_SELECTIONS),['hero','report','fingerprint','connected']);
 assert.equal(new Set(Object.values(SHOWCASE_SELECTIONS).map(x=>x.publicToken)).size,4);
 assert.ok(Object.values(SHOWCASE_SELECTIONS).every(validShowcaseBinding));
 assert.equal(SHOWCASE_SELECTIONS.connected.approvalVersion,2);
 assert.equal(validShowcaseBinding({...SHOWCASE_SELECTIONS.hero,publicHash:'unbound'}),false);
});

test('showcase API verifies the exact current publication on every GET and HEAD, with optional images absent',async()=>{
 const record=await source(),f=setup(record);
 const first=await get(f.handle);assert.equal(first.statusCode,200);assert.deepEqual(first.body.packet,record.packet);
 assert.equal(first.body.reportImages,undefined);assert.equal(first.headers['Cache-Control'],'no-store, max-age=0');
 assert.equal(first.headers['X-Content-Type-Options'],'nosniff');
 const head=await get(f.handle,{section:'hero'},'HEAD');assert.equal(head.statusCode,200);assert.equal(head.body,null);assert.equal(f.calls,2);
 f.current(null);assert.equal((await get(f.handle)).statusCode,404);assert.equal(f.calls,3);
 f.current(new Error('temporarily unavailable'));assert.equal((await get(f.handle)).statusCode,503);
});

test('showcase API refuses packet drift, a newer approval, and malformed or write requests',async()=>{
 const record=await source(),f=setup(record);
 const drift=structuredClone(record);drift.packet.report.identity.playerName='Changed';f.current(drift);
 assert.equal((await get(f.handle)).statusCode,404);
 f.current({...record,packet:{...record.packet,approvalVersion:2}});assert.equal((await get(f.handle)).statusCode,404);
 f.current({...record,packet:{...record.packet,mode:'LOCAL_FIXTURE'}});assert.equal((await get(f.handle)).statusCode,404);
 const before=f.calls;
 for(const query of [{section:'retired'},{section:['hero']},{section:'hero',token:record.packet.publicToken}]) assert.equal((await get(f.handle,query)).statusCode,404);
 const denied=await get(f.handle,{section:'hero'},'POST');assert.equal(denied.statusCode,405);assert.equal(denied.headers.Allow,'GET, HEAD');assert.equal(f.calls,before);
});

test('browser source validation rejects swapped identities and tampered saved report content',async()=>{
 const record=await source();assert.equal((await validateShowcaseSource(record,'hero')).publicHash,record.publicHash);
 await assert.rejects(validateShowcaseSource(record,'connected'),/wrong section/);
 const swapped=structuredClone(record);swapped.binding.publicToken='ar_'+'B'.repeat(24);
 await assert.rejects(validateShowcaseSource(swapped,'hero'),/wrong report binding/);
 const changed=structuredClone(record);changed.packet.report.identity.playerName='Changed';
 await assert.rejects(validateShowcaseSource(changed,'hero'),/report hash mismatch/);
});

test('each section keeps its own report, source photograph, finding coordinates and exact crop transform',async()=>{
 const a=manifestFromShowcaseSource(await source('hero','A')),b=manifestFromShowcaseSource(await source('report','B'));
 assert.notEqual(a.report.bindingKey,b.report.bindingKey);assert.equal(a.findings[0].id,b.findings[0].id);
 assert.match(a.sides.FRONT.original.src,/ar_A{24}/);assert.match(b.sides.FRONT.original.src,/ar_B{24}/);
 assert.notEqual(a.sides.FRONT.mask.contentKey,b.sides.FRONT.mask.contentKey);
 for(const side of ['FRONT','BACK'])for(const p of [[0,0],[1270,1778],[635,889]]){
  const actual=cleanUVToSource(a.sides[side],canonicalToCleanUV(a.sides[side],p)),expected=canonicalToSource(a.sides[side],p);
  assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<1e-8);
 }
 assert.deepEqual(a.sides.FRONT.presentation.cropUV,[40/1350,40/1858,1310/1350,1818/1858]);
 assert.equal(a.sides.FRONT.presentation.sha256,a.sides.FRONT.original.sha256);
 assert.equal(a.report.sourceReportHash,(await source()).packet.reportHash);
 assert.equal(a.report.finalGradePolicy,'atlas-final-whole-point-v1');
});

test('whole and historical half-point policies, modern reviewed traces and legacy single regions remain exact',async()=>{
 const current=await source();const p=current.packet;
 const oldFinding=p.report.findings[0],{zone,measurement,canonicalContour,detectorMask,...base}=oldFinding;
 p.report.findings[0]={...base,reviewResult:'SMART_MARKED',finalTrace:detectorMask,traceProvenance:{finalTraceSha256:detectorMask.sha256},measurementRegions:[{zone,measurement,canonicalContour}]};
 p.report.findings[1].reviewResult='TYPE_CORRECTED';
 const modern=manifestFromShowcaseSource(await validateShowcaseSource(bind(p),'hero'));
 assert.equal(modern.findings[0].trace.sha256,detectorMask.sha256);assert.equal(modern.findings[0].regions.length,1);
 assert.equal(modern.findings[1].reviewResult,'TYPE_CORRECTED');assert.equal(modern.findings[1].regions.length,1);
 p.report.finalGradePolicy='atlas-final-half-point-v1';p.report.finalGrade=Math.round(p.report.grade.overall.rawGrade*2)/2;
 assert.equal(manifestFromShowcaseSource(await validateShowcaseSource(bind(p),'hero')).report.finalGrade,p.report.finalGrade);
});

test('zero findings produce empty exact fields and no invented macro; missing trace is explicitly incomplete',async()=>{
 const record=await source();record.packet.report.findings=[];record.packet.report.findingCounts={total:0,included:0,removed:0,unreviewed:0};
 const zero=manifestFromShowcaseSource(await validateShowcaseSource(bind(record.packet),'hero'));
 assert.equal(zero.findings.length,0);assert.equal(zero.selectedMacro,null);assert.equal(zero.report.recordedFindingCount,0);
 for(const side of ['FRONT','BACK']){assert.deepEqual(zero.sides[side].mask.spans,[]);assert.equal(zero.sides[side].fingerprint.occupiedPixels,0);}
 const missing=await source(),side=missing.packet.report.findings[0].side;delete missing.packet.report.findings[0].detectorMask;
 const incomplete=manifestFromShowcaseSource(await validateShowcaseSource(bind(missing.packet),'hero'));
 assert.equal(incomplete.report.unavailableFindingCount,1);assert.equal(incomplete.report.recordedFindingCount,2);
 assert.equal(incomplete.sides[side].fingerprint,null);
});

test('canonical field unions preserve exact occupied cells and never sum overlapping findings twice',async()=>{
 const record=await source(),finding=record.packet.report.findings[0];record.packet.report.findings=[finding,{...structuredClone(finding),id:'second-overlap'}];
 record.packet.report.findingCounts={total:2,included:2,removed:0,unreviewed:0};
 const manifest=manifestFromShowcaseSource(await validateShowcaseSource(bind(record.packet),'hero'));
 const spans=[...traceSpans(finding.detectorMask)],count=spans.reduce((n,s)=>n+s.width,0);
 assert.equal(manifest.sides[finding.side].mask.occupiedPixels,count);
 assert.deepEqual(manifest.sides[finding.side].fingerprint.spans,manifest.sides[finding.side].mask.spans);
 assert.deepEqual(manifest.sides[finding.side].fingerprint.spans,fingerprintSource(record.packet.report.findings,finding.side).spans);
});

test('unknown profile cannot invent millimetres or qualify for spatial rendering',async()=>{
 const record=await source();record.packet.report.cardProfile='OVERSIZED';
 const manifest=manifestFromShowcaseSource(bind(record.packet));
 assert.equal(manifest.card.widthMm,null);assert.equal(manifest.card.heightMm,null);assert.equal(manifest.spatialReady,false);
 assert.ok(manifest.findings.every(f=>f.markedSpan===null));
});

test('aborted loads never poison a future load and every new context reads again',async()=>{
 const record=await source('connected','C');let calls=0;const fetcher=async()=>{calls++;return new Response(JSON.stringify(record),{headers:{'content-type':'application/json'}});};
 const controller=new AbortController();controller.abort();await assert.rejects(loadHeroEvidence('connected',{signal:controller.signal,fetcher}));
 assert.equal(calls,0);
 const manifest=await loadHeroEvidence('connected',{signal:new AbortController().signal,fetcher});
 assert.equal(manifest.report.bindingKey,`${record.packet.publicToken}:1:${record.publicHash}`);
 await loadHeroEvidence('connected',{signal:new AbortController().signal,fetcher});assert.equal(calls,2);
});


test('Pokémon publication uses its own identity and authoritative profile dimensions without a new layout',async()=>{
 const f=await publicationFixture({cardProfile:'POKEMON',identity:{cardName:'Synthetic Pokémon',year:'2026',productSet:'Fixture',parallel:null,cardNumber:null},finalGradePolicy:'atlas-final-whole-point-v1'});
 await f.publication.publish({},f.cardId,f.actionId);const m=JSON.parse(f.row.manifest);
 const packet=await f.artifacts.read(m.packet.ref,{cardId:f.cardId,kind:'PUBLIC_REPORT',sourceHash:m.packet.sourceHash});packet.mode='PRODUCTION';
 const manifest=manifestFromShowcaseSource(await validateShowcaseSource(bind(packet),'hero'));
 assert.equal(manifest.report.displayName,'Synthetic Pokémon');assert.equal(manifest.card.profile,'POKEMON');
 assert.equal(manifest.card.widthMm,63.5);assert.equal(manifest.card.heightMm,88.9);assert.equal(manifest.spatialReady,true);
});

test('empty fingerprint raster stays transparent and abort prevents any raster work',async t=>{
 const previous=globalThis.document,calls=[];
 t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 globalThis.document={createElement(name){assert.equal(name,'canvas');return{getContext(){return{fillRect(...args){calls.push(args);},putImageData(){throw Error('Invented empty field');}};},toBlob(callback){callback(new Blob([],{type:'image/png'}));}};}};
 const asset={kind:'SHOWCASE_FINGERPRINT',spans:[]};
 assert.equal((await fetchShowcaseAsset(asset,{signal:new AbortController().signal})).type,'image/png');assert.deepEqual(calls,[]);
 const stopped=new AbortController();stopped.abort();await assert.rejects(fetchShowcaseAsset(asset,{signal:stopped.signal}),{name:'AbortError'});
});
