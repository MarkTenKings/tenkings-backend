/** Serve-only actual staff workspace, durable client, real reducers and local CPU.
 * No browser automation, production connection, provider request or approval. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {createRapidPreviewAdapter} from './rapid-preview-adapter.mjs';
import {explainAtlasManualReport} from '@atlas/grading-core/manual-report';
const root=fileURLToPath(new URL('../../../',import.meta.url)),app=resolve(root,'frontend/atlas-app');
let adapter=await createRapidPreviewAdapter({pythonExecutable:process.env.ATLAS_FIXTURE_PYTHON});
const receipts=new Map();
const fixtureView=()=>adapter.view();
const direct=process.env.ATLAS_REVIEW_SHELL==='direct';
const source=direct?`import React from'react';import{createRoot}from'react-dom/client';import ManualCards from'./components/ManualCards.jsx';import{VerifiedImageCacheBoundary}from'../../packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx';createRoot(document.getElementById('app')).render(<VerifiedImageCacheBoundary scope="synthetic-direct"><ManualCards staff={{id:'synthetic',name:'Synthetic reviewer',role:'REVIEWER',mode:'PRODUCTION'}} cardId="focused-synthetic"/></VerifiedImageCacheBoundary>);`:`import React from'react';import{createRoot}from'react-dom/client';import{ManualWorkspace}from'./components/ManualCards.jsx';import{VerifiedImageCacheBoundary}from'../../packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx';import styles from'./components/BatchGrading.module.css';createRoot(document.getElementById('app')).render(<VerifiedImageCacheBoundary scope="synthetic-rapid"><dialog open className={styles.rapidDialog}><header className={styles.rapidHeader}><h2>Synthetic rapid review</h2></header><div className={styles.rapidBody}><ManualWorkspace staff={{id:'synthetic',role:'REVIEWER'}} csrf="fixture" cardId="focused-synthetic"/></div><footer id="atlas-rapid-actions" className="mc-rapid-actions"><div id="atlas-rapid-edits" className="mc-rapid-edit-dock"/></footer></dialog></VerifiedImageCacheBoundary>);`;
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
 const imageMatch=/^\/images\/([a-f0-9]{64})$/.exec(q.url);
 if(imageMatch){const asset=adapter.asset(imageMatch[1]);if(!asset){r.writeHead(404);r.end();return;}r.setHeader('content-type',asset.mime);r.setHeader('Cache-Control','public, max-age=31536000, immutable');r.end(asset.bytes);return;}
 if(q.url==='/bundle.js'||q.url==='/style.css'){r.setHeader('content-type',q.url==='/bundle.js'?'text/javascript':'text/css');r.end(q.url==='/bundle.js'?js:css);return;}
 if(direct&&q.url?.endsWith('/api/staff/session')){r.setHeader('content-type','application/json');r.end(JSON.stringify({staff:{id:'synthetic'},csrf:'fixture'}));return;}
 if(direct&&q.url?.endsWith('/api/staff/manual-connected/cards/focused-synthetic')){const v=adapter.view();r.setHeader('content-type','application/json');r.end(JSON.stringify({revision:1,card:{cardId:'focused-synthetic',label:'Card 1',ready:true,sourceHash:v.card.contentHash,sides:{FRONT:{version:1},BACK:{version:1}}},manual:{current:true,revision:v.card.revision},identification:{state:'COMPLETE'},details:{sourceHash:v.card.contentHash,profile:'POKEMON',layoutType:'POKEMON',fields:{name:'Synthetic saved identity'}}}));return;}
 if(q.url==='/fixture/state'){r.setHeader('content-type','application/json');r.end(JSON.stringify({view:adapter.view(),actions:adapter.actions(),receipts:receipts.size}));return;}
 if(q.url==='/fixture/reset'||q.url==='/fixture/exclusion'||q.url==='/fixture/observation'){
  adapter=await createRapidPreviewAdapter({pythonExecutable:process.env.ATLAS_FIXTURE_PYTHON});receipts.clear();
  if(q.url.endsWith('/exclusion'))await adapter.excludeFrontForReview();
  if(q.url.endsWith('/observation'))await adapter.observeFrontForReview();
  r.writeHead(303,{Location:'/'});r.end();return;
 }
 if(q.url?.endsWith('/trace')&&q.method==='POST'){
  let bytes='';for await(const chunk of q)bytes+=chunk;const input=JSON.parse(bytes);
  r.setHeader('content-type','application/json');r.end(JSON.stringify({type:'DEFECT_EDIT',side:input.side,base:input.base,...(input.finalObservation?{finalObservation:input.finalObservation}:{}),edit:{type:'TRACE_SAVE',side:input.side,findingId:input.findingId,trace:input.trace}}));return;
 }
 if(q.url?.includes('/actions/')&&q.method==='GET'){
  const result=receipts.get(q.url.split('/').at(-1));r.setHeader('content-type','application/json');r.end(JSON.stringify(result?{state:'COMMITTED',result}:{state:'NOT_FOUND'}));return;
 }
 if(q.url?.endsWith('/actions')&&q.method==='POST'){
  let bytes='';for await(const chunk of q)bytes+=chunk;const command=JSON.parse(bytes);
  if(!receipts.has(command.actionId)){
   if(command.expectedRevision!==adapter.view().card.revision){r.writeHead(409,{'content-type':'application/json'});r.end(JSON.stringify({error:'MANUAL_REVISION_CONFLICT'}));return;}
   receipts.set(command.actionId,await adapter.execute(command.action));
  }
  r.setHeader('content-type','application/json');r.end(JSON.stringify(receipts.get(command.actionId)));return;
 }
 if(q.url?.endsWith('/report-preview')){
  const preview=adapter.preview();
  r.setHeader('content-type','application/json');r.end(JSON.stringify({...preview,review:{report:preview.report,explanation:explainAtlasManualReport(preview.report)}}));return;
 }
 if(q.url==='/fixture'||q.url?.includes('/view')){r.setHeader('content-type','application/json');r.end(JSON.stringify(fixtureView()));return;}
 if(q.url==='/'||direct&&q.url==='/admin/manual/focused-synthetic'){r.setHeader('content-type','text/html');r.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><nav style="position:fixed;z-index:9999;top:0;right:0;background:#fff;padding:4px;font:11px sans-serif" aria-label="Local synthetic fixture"><a href="/fixture/reset">Reset</a> · <a href="/fixture/exclusion">Outline exclusion</a> · <a href="/fixture/observation">Original observation</a> · <a href="/fixture/state">Audit</a> · LOCAL SYNTHETIC ONLY</nav><script type="module" src="/bundle.js"></script>');return;}
 r.writeHead(404);r.end();
 }catch(error){r.writeHead(500,{'content-type':'application/json'});r.end(JSON.stringify({error:error.code??error.message??'LOCAL_PREVIEW_SAVE_FAILED'}));}});
await new Promise(resolve=>server.listen(Number(process.env.ATLAS_PREVIEW_PORT||0),'127.0.0.1',resolve));
console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`,source:'actual ManualWorkspace and durable client, real reducers and local CPU measurement',exclusion:'/fixture/exclusion',reset:'/fixture/reset',audit:'/fixture/state',productionCalls:0,providerCalls:0,approval:false}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
