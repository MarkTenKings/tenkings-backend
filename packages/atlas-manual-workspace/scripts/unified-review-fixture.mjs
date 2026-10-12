/** Serve-only actual staff workspace, durable client, real reducers and local CPU.
 * No browser automation, production connection, provider request or approval. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createRapidPreviewAdapter} from './rapid-preview-adapter.mjs';
import {explainAtlasManualReport} from '@atlas/grading-core/manual-report';
import {geometryBase} from '../src/geometry-actions.mjs';
import {defectBase} from '../src/defect-actions.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),app=resolve(root,'frontend/atlas-app');
let adapter=await createRapidPreviewAdapter({pythonExecutable:process.env.ATLAS_FIXTURE_PYTHON});
const receipts=new Map();
const variants=process.env.ATLAS_REVIEW_VARIANTS==='1',fixtureCardId=randomUUID(),fixtureStaffId=randomUUID();
const sha=value=>createHash('sha256').update(value).digest('hex'),variantReceipts=new Map(),variantPosts=[],referenceAssets=new Map(),referencePhotos=[];
let variantScenario='empty',variantRevision=0,variantConfirmation=null,variantParallel=null;
const fixtureIdentity=()=>({playerName:'Jaxson Dart · SYNTHETIC UI FIXTURE',year:'2025',manufacturer:'Panini',productSet:'Donruss Optic Football — Donruss Threads',cardNumber:'DTBH-JDT',parallel:variantParallel});
const variantIdentityHash=()=>sha(JSON.stringify(fixtureIdentity()));
const variantCandidates=()=>variantScenario==='empty'?[]:[{candidateId:'fixture-no-photo',label:'Synthetic named printing · no assigned photo',parallel:'Synthetic named printing',identity:{category:'SPORTS',name:fixtureIdentity().playerName,year:'2025',manufacturer:'Panini',setName:fixtureIdentity().productSet,cardNumber:'DTBH-JDT',language:'English'},authority:'provider_candidate',source:{provider:'manufacturer_checklist'},images:[],diagnostics:[],applicability:'unknown'}];
const variantStatus=()=>({enabled:true,state:'READY',revision:adapter.view().card.revision+variantRevision,sourceHash:adapter.view().card.draft.source.sourceHash,identityRevision:1+variantRevision,identityHash:variantIdentityHash(),jobId:sha('fixture-variant-job'),resultHash:sha('fixture-variant-result'),refreshable:false,confirmation:variantConfirmation,approvalReady:['SELECTED','MANUAL'].includes(variantConfirmation?.decision),result:{catalog:{schemaVersion:'atlas-variant-catalog/v1',snapshotHash:sha('fixture-catalog'),candidates:variantCandidates(),referencePhotos:variantScenario==='gallery'?referencePhotos:[]},referenceLabels:{version:'atlas-slab-label-associations/v1',catalogHash:sha('fixture-catalog'),readings:variantScenario==='gallery'?referencePhotos.map((image,index)=>({imageId:image.imageId,sha256:image.sha256,candidateId:null,gradingCompany:index?'PSA fixture':'CGC fixture',labelText:index?'SYNTHETIC 2025 PIKACHU SNOWFLAKE — layout example':'SYNTHETIC 2024 PIKACHU COSMOS HOLO COSTCO — layout example',reason:'Synthetic saved label remains unassigned to the named printing.'})):[]},suggestion:{candidateId:null}}});
const fixtureView=()=>{const view=adapter.view();if(!variants)return view;return {...view,identity:fixtureIdentity(),card:{...view.card,id:fixtureCardId,cardId:fixtureCardId,revision:view.card.revision+variantRevision,contentHash:sha(`${view.card.contentHash}:${variantRevision}`),draft:{...view.card.draft,identity:fixtureIdentity(),identityRevision:1+variantRevision}},variantVerification:variantStatus()};};
async function prepareVariantScenario(){
 variantRevision=0;variantConfirmation=null;variantParallel=null;variantReceipts.clear();variantPosts.length=0;
 await adapter.execute({type:'CONFIRM_GEOMETRY',reviewed:true,base:Object.fromEntries(['FRONT','BACK'].map(side=>[side,geometryBase(adapter.view().geometry,side,'REVIEW')]))});
 for(const side of ['FRONT','BACK'])await adapter.execute({type:'INSPECT_SIDE',side,base:defectBase(adapter.view().defects,side),inspected:true});
 await adapter.execute({type:'CONFIRM_FINDINGS',reviewed:true,base:Object.fromEntries(['FRONT','BACK'].map(side=>[side,defectBase(adapter.view().defects,side)]))});
}
if(variants){
 await prepareVariantScenario();
 const sharp=createRequire(resolve(app,'package.json'))('sharp');
 for(const [index,color] of ['#266286','#785732'].entries()){
  const bytes=await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="760"><rect width="520" height="760" fill="#eceff1"/><rect x="22" y="18" width="476" height="124" rx="12" fill="white" stroke="#777"/><text x="42" y="55" font-size="22">SYNTHETIC SAVED REFERENCE ${index+1}</text><text x="42" y="90" font-size="20">${index?'PSA fixture · Snowflake':'CGC fixture · Costco Cosmos'}</text><text x="42" y="122" font-size="15">Not a real card or slab-label reading</text><rect x="62" y="170" width="396" height="548" rx="16" fill="${color}"/><text x="104" y="390" fill="white" font-size="27">LOCAL UI FIXTURE</text><text x="96" y="435" fill="white" font-size="20">Unassigned photograph</text></svg>`)).png().toBuffer(),hash=sha(bytes);
  referenceAssets.set(hash,bytes);referencePhotos.push({imageId:`unassigned-fixture-${index}`,sha256:hash,mimeType:'image/png',byteCount:bytes.length,width:520,height:760,relationship:'listing_photo',listing:{id:null,title:'Synthetic saved reference photograph',url:null},provenance:{provider:'ebay_sold_comps_v2',usage:'provider_reference'}});
 }
}
const direct=!variants&&process.env.ATLAS_REVIEW_SHELL==='direct';
const source=direct?`import React from'react';import{createRoot}from'react-dom/client';import ManualCards from'./components/ManualCards.jsx';import{VerifiedImageCacheBoundary}from'../../packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx';createRoot(document.getElementById('app')).render(<VerifiedImageCacheBoundary scope="synthetic-direct"><ManualCards staff={{id:'synthetic',name:'Synthetic reviewer',role:'REVIEWER',mode:'PRODUCTION'}} cardId="focused-synthetic"/></VerifiedImageCacheBoundary>);`:`import React from'react';import{createRoot}from'react-dom/client';import{ManualWorkspace}from'./components/ManualCards.jsx';import{VerifiedImageCacheBoundary}from'../../packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx';import styles from'./components/BatchGrading.module.css';createRoot(document.getElementById('app')).render(<VerifiedImageCacheBoundary scope="synthetic-rapid"><dialog open className={styles.rapidDialog}><header className={styles.rapidHeader}><h2>Synthetic rapid review</h2></header><div className={styles.rapidBody} data-review-scroll><ManualWorkspace staff={{id:'${variants?fixtureStaffId:'synthetic'}',role:'REVIEWER'}} csrf="fixture" cardId="${variants?fixtureCardId:'focused-synthetic'}" initialReviewStage={${variants?"'report'":"null"}}/></div><footer id="atlas-rapid-actions" className="mc-rapid-actions"><div id="atlas-rapid-edits" className="mc-rapid-edit-dock"/></footer></dialog></VerifiedImageCacheBoundary>);`;
const stubs={'next/router':`export const useRouter=()=>({pathname:'/manual/[cardId]',query:{},push:async()=>{},replace:async()=>{},events:{on(){},off(){},emit(){}}});`,'next/link':`import React from'react';export default function Link(props){return React.createElement('a',props,props.children);}`};
if(direct)Object.assign(stubs,{
 'next/head':`export default function Head(){return null;}`,
 '@atlas/manual-intake/client':`export const createBrowserIntakeJournal=()=>({close(){}});export const createIntakeClient=()=>({pending:async()=>[]});`,
 '../lib/batch-import.mjs':`export const createBrowserBatchImportJournal=()=>({close(){}});`,
 '../lib/card-discard.mjs':`export const createWorkspaceDiscarder=()=>({pending:()=>false,reconcile:async()=>null});export const hasPendingDiscard=()=>false;export const discardKey=()=>"fixture-discard";export const discardEvent="fixture-discard";export const discardedIdsFromEvent=()=>null;`
});
const bundle=await build({logLevel:'error',stdin:{contents:source,resolveDir:app,sourcefile:'rapid-workflow-fixture.jsx',loader:'jsx'},bundle:true,jsx:'automatic',write:false,outdir:'/fixture',format:'esm',platform:'browser',target:'chrome120',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-transport',setup(build){build.onResolve({filter:/^@atlas\/manual-workspace\/(defects|focused-geometry|report-review)$/},args=>({path:resolve(root,'packages/atlas-manual-workspace/src/'+({'@atlas/manual-workspace/defects':'DefectReviewWorkspace.jsx','@atlas/manual-workspace/focused-geometry':'FocusedGeometryWorkspace.jsx','@atlas/manual-workspace/report-review':'FinalReportReview.jsx'}[args.path]))}));build.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:null);build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js',resolveDir:app}));}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=(await Promise.all(['styles/global.css','styles/grading.css','../../packages/atlas-report-view/src/report.css','../../packages/atlas-manual-workspace/src/workspace.css','../../packages/atlas-manual-workspace/src/defects.css','styles/manual.css','styles/atlas-brand.css','styles/atlas-theme.css','../../packages/atlas-manual-workspace/src/report-review.css','../../packages/atlas-manual-workspace/src/focused-geometry.css'].map(path=>readFile(resolve(app,path),'utf8')))).join('\n')+'\n'+bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server=createServer(async(q,r)=>{try{
 const referenceMatch=/\/variants\/images\/([a-f0-9]{64})$/.exec(q.url);
 if(variants&&referenceMatch){const bytes=referenceAssets.get(referenceMatch[1]);if(!bytes){r.writeHead(404);r.end();return;}r.writeHead(200,{'content-type':'image/png'});r.end(bytes);return;}
 if(variants&&q.url.endsWith('/variants')){r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify(variantStatus()));return;}
 if(variants&&q.url.endsWith('/variants/confirm')&&q.method==='POST'){
  let bytes='';for await(const chunk of q)bytes+=chunk;const input=JSON.parse(bytes);variantPosts.push(input);
  if(!variantReceipts.has(input.actionId)){
   const current=variantStatus(),chosen=variantCandidates().find(candidate=>candidate.candidateId===input.candidateId);
   if(input.expectedRevision!==current.revision||input.sourceHash!==current.sourceHash||input.identityHash!==current.identityHash){r.writeHead(409,{'content-type':'application/json'});r.end(JSON.stringify({error:'VARIANT_IDENTITY_STALE'}));return;}
   if(!['MANUAL','SELECTED','UNRESOLVED'].includes(input.decision)||input.decision==='MANUAL'&&!input.manualParallel?.trim()||input.decision==='SELECTED'&&!chosen){r.writeHead(400,{'content-type':'application/json'});r.end(JSON.stringify({error:'VARIANT_CONFIRMATION_INVALID'}));return;}
   if(input.decision!=='UNRESOLVED')variantParallel=input.manualParallel??chosen.parallel;
   variantRevision++;variantConfirmation={...input,selectedCandidateId:input.candidateId,identityRevision:1+variantRevision,identityHash:variantIdentityHash()};
   variantReceipts.set(input.actionId,{operation:'CONFIRM',requestId:input.actionId,sourceHash:input.sourceHash,identityRevision:input.identityRevision,identityHash:input.identityHash});
  }
  r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify({...variantStatus(),acknowledgedRequest:variantReceipts.get(input.actionId)}));return;
 }
 const imageMatch=/^\/images\/([a-f0-9]{64})$/.exec(q.url);
 if(imageMatch){const asset=adapter.asset(imageMatch[1]);if(!asset){r.writeHead(404);r.end();return;}r.setHeader('content-type',asset.mime);r.setHeader('Cache-Control','public, max-age=31536000, immutable');r.end(asset.bytes);return;}
 if(q.url==='/bundle.js'||q.url==='/style.css'){r.setHeader('content-type',q.url==='/bundle.js'?'text/javascript':'text/css');r.end(q.url==='/bundle.js'?js:css);return;}
 if(direct&&q.url?.endsWith('/api/staff/session')){r.setHeader('content-type','application/json');r.end(JSON.stringify({staff:{id:'synthetic'},csrf:'fixture'}));return;}
 if(direct&&q.url?.endsWith('/api/staff/manual-connected/cards/focused-synthetic')){const v=adapter.view();r.setHeader('content-type','application/json');r.end(JSON.stringify({revision:1,card:{cardId:'focused-synthetic',label:'Card 1',ready:true,sourceHash:v.card.contentHash,sides:{FRONT:{version:1},BACK:{version:1}}},manual:{current:true,revision:v.card.revision},identification:{state:'COMPLETE'},details:{sourceHash:v.card.contentHash,profile:'POKEMON',layoutType:'POKEMON',fields:{name:'Synthetic saved identity'}}}));return;}
 if(q.url==='/fixture/state'){r.setHeader('content-type','application/json');r.end(JSON.stringify({view:fixtureView(),actions:adapter.actions(),receipts:receipts.size,variantScenario,variantPosts,variantReceipts:variantReceipts.size,productionCalls:0,providerCalls:0}));return;}
 if(q.url==='/fixture/reset'||q.url==='/fixture/exclusion'||q.url==='/fixture/observation'||variants&&['/fixture/variant-empty','/fixture/variant-gallery'].includes(q.url)){
  adapter=await createRapidPreviewAdapter({pythonExecutable:process.env.ATLAS_FIXTURE_PYTHON});receipts.clear();
  if(variants){variantScenario=q.url.endsWith('/variant-gallery')?'gallery':'empty';await prepareVariantScenario();}
  if(q.url.endsWith('/exclusion'))await adapter.excludeFrontForReview();
  if(q.url.endsWith('/observation'))await adapter.observeFrontForReview();
  r.writeHead(303,{Location:'/'});r.end();return;
 }
 if(q.url?.endsWith('/trace')&&q.method==='POST'){
  let bytes='';for await(const chunk of q)bytes+=chunk;const input=JSON.parse(bytes);
  r.setHeader('content-type','application/json');r.end(JSON.stringify({type:'DEFECT_EDIT',side:input.side,base:input.base,edit:{type:'TRACE_SAVE',side:input.side,findingId:input.findingId,trace:input.trace}}));return;
 }
 if(q.url?.includes('/actions/')&&q.method==='GET'){
  const result=receipts.get(q.url.split('/').at(-1));r.setHeader('content-type','application/json');r.end(JSON.stringify(result?{state:'COMMITTED',result}:{state:'NOT_FOUND'}));return;
 }
 if(q.url?.endsWith('/actions')&&q.method==='POST'){
  let bytes='';for await(const chunk of q)bytes+=chunk;const command=JSON.parse(bytes);
  if(command.action?.type==='APPROVE_REPORT'){r.writeHead(403,{'content-type':'application/json'});r.end(JSON.stringify({error:'FIXTURE_BLOCKS_FINAL_APPROVAL'}));return;}
  if(!receipts.has(command.actionId)){
   if(command.expectedRevision!==adapter.view().card.revision){r.writeHead(409,{'content-type':'application/json'});r.end(JSON.stringify({error:'MANUAL_REVISION_CONFLICT'}));return;}
   receipts.set(command.actionId,await adapter.execute(command.action));
  }
  r.setHeader('content-type','application/json');r.end(JSON.stringify(receipts.get(command.actionId)));return;
 }
 if(q.url?.endsWith('/report-preview')){
  const preview=adapter.preview();
  if(variants){const view=fixtureView();preview.report={...preview.report,identity:fixtureIdentity()};preview.reportHash=sha(JSON.stringify(preview.report));preview.sourceRevision=view.card.revision;preview.sourceHash=view.card.contentHash;preview.canCertify=true;}
  r.setHeader('content-type','application/json');r.end(JSON.stringify({...preview,review:{report:preview.report,explanation:explainAtlasManualReport(preview.report)}}));return;
 }
 if(q.url==='/fixture'||q.url?.includes('/view')){r.setHeader('content-type','application/json');r.end(JSON.stringify(fixtureView()));return;}
 if(q.url==='/'||direct&&q.url==='/admin/manual/focused-synthetic'){r.setHeader('content-type','text/html');r.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><nav style="position:fixed;z-index:9999;top:0;right:0;background:#fff;padding:4px;font:11px sans-serif" aria-label="Local synthetic fixture">'+(variants?'<a href="/fixture/variant-empty">Empty catalog</a> · <a href="/fixture/variant-gallery">Unassigned photos</a> · ':'<a href="/fixture/reset">Reset</a> · <a href="/fixture/exclusion">Outline exclusion</a> · <a href="/fixture/observation">Original observation</a> · ')+'<a href="/fixture/state">Audit</a> · LOCAL SYNTHETIC ONLY · final approval blocked</nav><script type="module" src="/bundle.js"></script>');return;}
 r.writeHead(404);r.end();
 }catch(error){r.writeHead(500,{'content-type':'application/json'});r.end(JSON.stringify({error:error.code??error.message??'LOCAL_PREVIEW_SAVE_FAILED'}));}});
await new Promise(resolve=>server.listen(Number(process.env.ATLAS_PREVIEW_PORT||0),'127.0.0.1',resolve));
console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`,source:'actual ManualWorkspace and durable client, real reducers and local CPU measurement',variants,empty:'/fixture/variant-empty',gallery:'/fixture/variant-gallery',exclusion:'/fixture/exclusion',reset:'/fixture/reset',audit:'/fixture/state',productionCalls:0,providerCalls:0,approval:false}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
