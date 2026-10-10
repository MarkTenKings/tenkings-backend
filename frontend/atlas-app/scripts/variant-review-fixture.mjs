/** Loopback UI fixture only. Real permissioned archived photographs are reused
 * with conspicuously synthetic catalog metadata; this is not recognition proof.
 * No browser automation, model/provider request, or production access. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeometryWorkspace } from '../../../packages/atlas-manual-workspace/src/geometry-actions.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),app=resolve(root,'frontend/atlas-app');
const require=createRequire(resolve(root,'packages/atlas-manual-workspace/package.json')),{build}=require('esbuild');
const photos=Object.fromEntries(await Promise.all(['front','back'].map(async side=>[side,await readFile(resolve(root,`docs/atlas/design/first-look/reports/abomasnow-${side}.webp`))])));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),cardId=randomUUID(),staffId=randomUUID(),h=c=>c.repeat(64);
const photo=side=>({url:`/photo/${side}.webp`,sha256:sha(photos[side]),byteCount:photos[side].length,mime:'image/webp',width:1350,height:1858});
const geometry=createGeometryWorkspace({cardId,profile:'POKEMON',sides:Object.fromEntries(['FRONT','BACK'].map(side=>[side,{image:{version:1,originalSha256:photo(side.toLowerCase()).sha256,frameId:side,frameSha256:photo(side.toLowerCase()).sha256,width:1350,height:1858,coordinateSpace:'ORIENTED_DECODED'},matColor:'BLACK',cornerShape:'SQUARE'}]))});
const images={FRONT:{original:photo('front')},BACK:{original:photo('back')}};
const image={imageId:'owned-reference',relationship:'representative',...photo('front'),mimeType:'image/webp',publication:'Synthetic fixture only',provenance:{provider:'owned-archived-fixture',usage:'reviewed_catalog'},visibleDiagnosticIds:['foil']};
const candidate=(candidateId,label,extra={})=>({candidateId,label,authority:'reviewed_catalog',identity:{category:'POKEMON',name:'Abomasnow',setName:'Lost Origin',cardNumber:'043/196',year:'2022',language:'English'},parallel:'Synthetic printing',canonical:null,applicability:'unknown',diagnostics:[{id:'foil',description:'Compare the printed details. This fixture does not establish a real finish match.'}],images:[image],source:{provider:'owned-fixture'},...extra});
const artwork={...image,relationship:'card_art_only'},hybrid=process.env.ATLAS_VARIANT_FIXTURE_MODE==='hybrid';
const listing={...image,publication:null,relationship:'listing_photo',listing:{id:'123456789012',title:'SYNTHETIC LISTING TITLE · Abomasnow 043/196 Lost Origin English Reverse Holo — long seller title for layout inspection only',url:'https://www.ebay.com/itm/123456789012'},provenance:{provider:'ebay_sold_comps_v2',usage:'provider_reference',sourceUrl:'https://i.ebayimg.com/synthetic-fixture.webp'}};
const candidates=[candidate('one','Example printing A',hybrid?{authority:'provider_candidate',source:{provider:'scrydex'},images:[artwork,listing]}:{}),candidate('two','Example printing B',{images:[artwork]}),candidate('missing','Example without reference',{images:[]}),...(hybrid?[candidate('unknown','Listing · printing unconfirmed',{authority:'provider_candidate',parallel:null,images:[listing]}),candidate('broken','Example with unavailable photo',{authority:'provider_candidate',images:[artwork,{...listing,sha256:h('f')}]})]:[]),candidate('language','Other-language example',{identity:{category:'POKEMON',name:'Abomasnow',setName:'Lost Origin',cardNumber:'043/196',language:'Japanese'}}),candidate('other','Different-card example',{identity:{name:'Other fixture card',setName:'Other set',cardNumber:'1',language:'English'}})];
let state='READY',confirmation=null,revision=9,identityRevision=1,sourceHash=h('a'),identityHash=h('b'),loss=false,supersede=false,failReads=false,workspaceMode=false,jobId=h('e'),refreshRequestId=null;
let identity={cardName:'Abomasnow',year:'2022',productSet:'Lost Origin',cardNumber:'043/196',parallel:'Prior fixture printing',layoutType:'POKEMON',language:'English'};
const posts=[],receipts=new Map();
const status=()=>({enabled:true,state,revision,sourceHash,identityRevision,identityHash,jobId,refreshRequestId,refreshable:!['QUEUED','SEARCHING','UNKNOWN'].includes(state),resultHash:state==='READY'?h('c'):null,result:state==='READY'?{catalog:{schemaVersion:'atlas-variant-catalog/v1',snapshotHash:h('d'),candidates,coverage:{metadata:'fixture',images:'partial'}},suggestion:{candidateId:'one',reason:'Synthetic suggestion for interaction testing, not a recognition result.',confidence:.6}}:null,confirmation,approvalReady:(confirmation?.decision==='SELECTED'||confirmation?.decision==='MANUAL')&&(!confirmation.reprocessRequired||confirmation.recheckState==='READY')});
const view=()=>({card:{cardId,revision,contentHash:sha(`fixture:${revision}`),draft:{source:{sourceHash},identityRevision,identity}},identity,geometry,images,astra:{enabled:false},variantVerification:status()});
const source=`import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import VariantIdentityReview from './components/VariantIdentityReview.jsx';import{ManualWorkspace}from'./components/ManualCards.jsx';
const f=${JSON.stringify({cardId,staffId,images,geometry})};function App(){const[gate,setGate]=useState(false),[saved,setSaved]=useState(null);const load=async()=>setSaved(await(await fetch('/fixture/view')).json());useEffect(()=>{void load();},[]);async function control(action,reload=true){await fetch('/fixture/'+action,{method:'POST'});if(action==='ready'||action==='workspace')localStorage.removeItem('atlas-variant-review:'+f.staffId+':'+f.cardId);if(action==='workspace')location.assign('/workspace');else if(reload)location.reload();}return <main><p className="fixture">LOCAL FIXTURE · Synthetic catalog choices and persistence. Real archived photographs reused; no identification or production claim.</p>{location.pathname==='/workspace'?<ManualWorkspace staff={{id:f.staffId,role:'REVIEWER'}} cardId={f.cardId} csrf="fixture" onPhotos={()=>{}}/>:saved&&<><VariantIdentityReview {...f} csrf="fixture" enabled sourceHash={saved.card.draft.source.sourceHash} identityRevision={saved.card.draft.identityRevision} revision={saved.card.revision} identity={saved.identity} onGateChange={setGate} onSaved={load}/><footer className="approval"><span>{gate?'Saved identity confirmation ready':'Final approval waits for saved identity confirmation'}</span><button disabled={!gate}>Final approval fixture · no action</button></footer></>}<nav className="fixture-controls" aria-label="Synthetic scenario controls">Fixture controls: <button onClick={()=>control('queued')}>Queued</button><button onClick={()=>control('ready')}>Ready/reset</button><button onClick={()=>control('loss',false)}>Lose next save response</button><button onClick={()=>control('supersede',false)}>Lose reply then newer save</button><button onClick={()=>control('recheck')}>Recheck queued</button><button onClick={()=>control('fail-reads',false)}>Fail saved reads</button><button onClick={()=>control('restore-reads',false)}>Restore saved reads</button><button onClick={()=>control('source')}>Replace source fixture</button><button onClick={()=>control('workspace')}>Workflow review fixture</button></nav><p><a href="/fixture/state">Read synthetic request audit</a> · <a href="/">Identity panel fixture</a></p></main>};createRoot(document.getElementById('app')).render(<App/>);`;
const mocks={'next/router':`export const useRouter=()=>({query:{},events:{on(){},off(){}}});`,'next/link':`import React from 'react';export default function Link(p){return <a {...p}/>;}`,'next/head':`export default function Head(){return null;}`};
const built=await build({stdin:{contents:source,resolveDir:app,loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',outdir:'fixture',loader:{'.css':'css'},plugins:[{name:'fixture-routing',setup(b){b.onResolve({filter:/^@atlas\/manual-workspace(?:\/(report-review|focused-geometry|defects))?$/},args=>({path:resolve(root,'packages/atlas-manual-workspace/src/'+({'@atlas/manual-workspace':'PairedGeometryWorkspace.jsx','@atlas/manual-workspace/report-review':'FinalReportReview.jsx','@atlas/manual-workspace/focused-geometry':'FocusedGeometryWorkspace.jsx','@atlas/manual-workspace/defects':'DefectReviewWorkspace.jsx'}[args.path]))}));b.onResolve({filter:/^next\/(router|link|head)$/},args=>({path:args.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:app}));}}],define:{'process.env.NODE_ENV':'"development"'},logLevel:'silent'});
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).contents;
const css=Buffer.concat([built.outputFiles.find(f=>f.path.endsWith('.css')).contents,...await Promise.all(['frontend/atlas-app/styles/manual.css','frontend/atlas-app/styles/atlas-brand.css','packages/atlas-manual-workspace/src/workspace.css'].map(path=>readFile(resolve(root,path))))]);
const server=createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');const json=(value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(req.url==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(js);return;}if(req.url==='/app.css'){res.writeHead(200,{'Content-Type':'text/css'});res.end(css);return;}
 if(req.url.includes('/variants/images/')){res.writeHead(200,{'Content-Type':'image/webp','Content-Length':photos.front.length});res.end(photos.front);return;}
 if(req.url.startsWith('/photo/')){const side=req.url.includes('front')?'front':'back';res.writeHead(200,{'Content-Type':'image/webp','Content-Length':photos[side].length});res.end(photos[side]);return;}
 if(req.url==='/fixture/state'){json({state,posts,confirmation,uniqueReceipts:receipts.size,sourceHash,identityRevision,revision});return;}
 if(req.url==='/fixture/view'||/\/cards\/[^/]+\/view(?:\?.*)?$/.test(req.url)){json(view());return;}
 if(req.url.startsWith('/fixture/')&&req.method==='POST'){
  const action=req.url.split('/').pop();
  if(action==='loss')loss=true;
  else if(action==='supersede'){loss=true;supersede=true;}
  else if(action==='fail-reads')failReads=true;
  else if(action==='restore-reads')failReads=false;
  else if(action==='source'){sourceHash=sha(sourceHash);identityRevision++;revision++;identityHash=sha(identityHash);confirmation=null;}
  else if(action==='recheck'){confirmation={decision:'SELECTED',selectedCandidateId:'one',sourceHash,identityRevision,identityHash,reprocessRequired:true,recheckState:'QUEUED',recheckRetryable:false};}
  else {state=action==='queued'?'QUEUED':'READY';confirmation=action==='workspace'?{decision:'UNRESOLVED',sourceHash,identityRevision,identityHash}:null;workspaceMode=action==='workspace';failReads=false;loss=false;supersede=false;receipts.clear();}
  json({ok:true});return;
 }
 if(req.url.endsWith('/variants')&&req.method==='GET'){if(failReads)json({error:'FIXTURE_SAVED_READ_FAILED'},503);else json(status());return;}
 if((req.url.endsWith('/variants/refresh')||req.url.endsWith('/variants/confirm'))&&req.method==='POST'){
  let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw),refresh=req.url.endsWith('/refresh'),id=input.requestId??input.actionId;posts.push(input);
  if(!receipts.has(id)){
   if(refresh){refreshRequestId=id;jobId=sha(id);state='QUEUED';}
   else {revision++;if(workspaceMode&&input.decision!=='UNRESOLVED'){identityRevision++;identity={...identity,parallel:input.manualParallel??'Synthetic printing'};identityHash=sha(JSON.stringify(identity));}
    confirmation={...input,selectedCandidateId:input.candidateId,identityRevision,identityHash,...(workspaceMode&&input.decision!=='UNRESOLVED'?{reprocessRequired:true,recheckState:'QUEUED',recheckRetryable:false}:{})};}
   receipts.set(id,{operation:refresh?'REFRESH':'CONFIRM',requestId:id,sourceHash:input.sourceHash,identityRevision:input.identityRevision,identityHash:input.identityHash});
  }
  if(loss){loss=false;if(supersede){supersede=false;confirmation={...confirmation,actionId:randomUUID()};}json({error:'FIXTURE_RESPONSE_LOST'},503);}
  else json({...status(),acknowledgedRequest:receipts.get(id)});return;
 }
 if(req.url.endsWith('/actions')&&req.method==='POST'){
  let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);posts.push(input);
  if(input.action?.type!=='IDENTITY_EDIT'){json({error:'FIXTURE_BLOCKS_GRADING_AND_APPROVAL_WRITES'},403);return;}
  identity={...input.action.identity};identityRevision++;revision++;identityHash=sha(JSON.stringify(identity));confirmation=null;json({state:'COMMITTED'});return;
 }
 if(req.url.includes('/api/')){json({error:'FIXTURE_UNSUPPORTED_ROUTE'},404);return;}
 if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
 res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATLAS variant review fixture</title><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:#f1f0ec;font-family:Arial,sans-serif}main{max-width:1280px;margin:auto;padding:20px}.fixture,.fixture-controls{font-size:12px;color:#615745}.approval{display:flex;gap:20px;justify-content:space-between;padding:18px;background:white}.approval button,.fixture-controls button{padding:12px;border-radius:6px}.fixture-controls{margin-top:24px}@media(max-width:400px){main{padding:8px}.approval{flex-direction:column}}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');});
await new Promise(done=>server.listen(Number(process.env.PORT||0),'127.0.0.1',done));console.log(JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`,syntheticCatalog:true,permissionedArchivedPhotos:true,productionCalls:0}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
