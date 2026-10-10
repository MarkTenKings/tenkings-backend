/** Actual staff workspace/shared shell, isolated synthetic transport and real reducers. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createRapidPreviewAdapter} from './rapid-preview-adapter.mjs';
import {geometryStatus} from '../src/geometry-actions.mjs';
import {defectBase} from '../src/defect-actions.mjs';
import {explainAtlasManualReport} from '@atlas/grading-core/manual-report';
const root=fileURLToPath(new URL('../../../',import.meta.url)),app=resolve(root,'frontend/atlas-app');
const output=process.env.ATLAS_BROWSER_EVIDENCE;
if(!output)throw Error('ATLAS_BROWSER_EVIDENCE must name an isolated evidence directory');
await mkdir(output,{recursive:true});
const adapter=await createRapidPreviewAdapter({pythonExecutable:process.env.ATLAS_FIXTURE_PYTHON});
let failNext=false;const actions=[];
let variantState=null;
const fixtureView=()=>{
 const view=adapter.view();if(!variantState)return view;
 const ready=variantState==='READY',analysisActionId='synthetic-variant-recheck',analysisId='synthetic-fresh-analysis';
 view.variantVerification={enabled:true,approvalReady:ready,confirmation:{decision:'SELECTED',reprocessRequired:true,recheckState:variantState,analysisActionId}};
 view.astra={enabled:ready,status:ready?'READY':'RUNNING',requestActionId:analysisActionId,...(ready?{analysisId,
  base:Object.fromEntries(['FRONT','BACK'].map(side=>[side,defectBase(view.defects,side)])),
  proposals:[{id:'fresh-variant-suggestion',side:'BACK',defectType:'SURFACE_SCRATCH',reviewStatus:'UNREVIEWED',canonicalContour:[{x:.4,y:.4},{x:.5,y:.4},{x:.5,y:.5}]}],
  proposalReview:{analysisId,resultHash:'f'.repeat(64),proposalIds:['fresh-variant-suggestion']}}:{proposals:[]})};
 return view;
};
const direct=process.env.ATLAS_REVIEW_SHELL==='direct';
const source=direct?`import React from'react';import{createRoot}from'react-dom/client';import ManualCards from'./components/ManualCards.jsx';import{VerifiedImageCacheBoundary}from'../../packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx';createRoot(document.getElementById('app')).render(<VerifiedImageCacheBoundary scope="synthetic-direct"><ManualCards staff={{id:'synthetic',name:'Synthetic reviewer',role:'REVIEWER',mode:'PRODUCTION'}} cardId="focused-synthetic"/></VerifiedImageCacheBoundary>);`:`import React from'react';import{createRoot}from'react-dom/client';import{ManualWorkspace}from'./components/ManualCards.jsx';import{VerifiedImageCacheBoundary}from'../../packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx';import styles from'./components/BatchGrading.module.css';createRoot(document.getElementById('app')).render(<VerifiedImageCacheBoundary scope="synthetic-rapid"><dialog open className={styles.rapidDialog}><header className={styles.rapidHeader}><h2>Synthetic rapid review</h2></header><div className={styles.rapidBody}><ManualWorkspace rapid staff={{id:'synthetic',role:'REVIEWER'}} csrf="fixture" cardId="focused-synthetic"/></div><footer id="atlas-rapid-actions" className="mc-rapid-actions"><div id="atlas-rapid-edits" className="mc-rapid-edit-dock"/></footer></dialog></VerifiedImageCacheBoundary>);`;
const transport=`export function createManualClient(options){let pending=false;const load=async(path='/fixture',body)=>{const r=await fetch(path,body?{method:'POST',body:JSON.stringify(body)}:undefined);if(!r.ok){const failure=await r.json().catch(()=>({error:'LOCAL_PREVIEW_SAVE_FAILED'}));throw Object.assign(Error(failure.error),{code:failure.error});}const value=await r.json();options.onView(value);return value;};return {recover:()=>load(),hasPending:()=>pending,execute:async action=>{pending=true;options.onStatus('Saving…');try{const value=await load('/action',action);options.onStatus('Saved');return value;}catch(error){options.onStatus('Save failed');throw error;}finally{pending=false;}},previewReport:async()=>{const r=await fetch('/preview');if(!r.ok)throw Error('Preview unavailable');return r.json();}};}`;
const stubs={'@atlas/manual-workflow/client':transport,'next/router':`export const useRouter=()=>({pathname:'/manual/[cardId]',query:{},push:async()=>{},replace:async()=>{},events:{on(){},off(){},emit(){}}});`,'next/link':`import React from'react';export default function Link(props){return React.createElement('a',props,props.children);}`};
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
 if(q.url==='/action'){
  let bytes='';for await(const chunk of q)bytes+=chunk;const action=JSON.parse(bytes);actions.push(action.type);
  if(failNext){failNext=false;r.writeHead(503);r.end();return;}
  await adapter.execute(action);
 }
 if(q.url==='/preview'){
  const preview=adapter.preview();
  r.setHeader('content-type','application/json');r.end(JSON.stringify({...preview,review:{report:preview.report,explanation:explainAtlasManualReport(preview.report)}}));return;
 }
 if(q.url==='/fixture'||q.url==='/action'||q.url?.includes('/view')){r.setHeader('content-type','application/json');r.end(JSON.stringify(fixtureView()));return;}
 if(q.url==='/'||direct&&q.url==='/admin/manual/focused-synthetic'){r.setHeader('content-type','text/html');r.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script type="module" src="/bundle.js"></script>');return;}
 r.writeHead(404);r.end();
 }catch(error){r.writeHead(500,{'content-type':'application/json'});r.end(JSON.stringify({error:error.code??error.message??'LOCAL_PREVIEW_SAVE_FAILED'}));}});
await new Promise(resolve=>server.listen(Number(process.env.ATLAS_PREVIEW_PORT||0),'127.0.0.1',resolve));
if(process.env.ATLAS_PREVIEW_ONLY==='1'){console.log(`Synthetic rapid workspace: http://127.0.0.1:${server.address().port}`);await new Promise(()=>{});}
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.stack??error.message));
try{
 await page.goto(`http://127.0.0.1:${server.address().port}${direct?'/admin/manual/focused-synthetic':''}`);
 const front=page.getByRole('button',{name:'Approve Front borders and centering',exact:true});await front.waitFor();await page.waitForFunction(()=>!document.querySelector('.mc-rapid-approve')?.disabled);
 for(const size of [{width:1440,height:900},{width:1280,height:720},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);const dimensions=await page.locator('.fg-stage').evaluate(node=>({height:node.clientHeight,width:node.clientWidth,bottom:node.getBoundingClientRect().bottom,dock:document.querySelector('#atlas-rapid-actions').getBoundingClientRect().top}));
  assert.ok(dimensions.height>100);assert.ok(dimensions.bottom<=dimensions.dock);checks.push({stage:'geometry',viewport:size,...dimensions});await page.screenshot({path:resolve(output,`rapid-geometry-${size.width}.png`)});
 }
 await page.setViewportSize({width:1440,height:900});await front.click();const back=page.getByRole('button',{name:'Approve Back borders and centering',exact:true});await back.waitFor();await page.waitForFunction(()=>!document.querySelector('.mc-rapid-approve')?.disabled);assert.equal(actions.length,0);
 failNext=true;await back.click();await page.locator('.fg-error').waitFor();assert.equal(geometryStatus(adapter.view().geometry).confirmed,false);await back.click();
 const approve=page.getByRole('button',{name:'Approve all findings on Front and Back',exact:true});await approve.waitFor();await page.waitForFunction(()=>!document.querySelector('.mc-rapid-approve')?.disabled);
 const before=actions.length,tracePaths=await page.locator('.ad-overview-trace').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('d')));
 assert.equal(tracePaths.length,2);
 await page.getByRole('button',{name:'Zoom in Front',exact:true}).click();
 await page.getByRole('button',{name:'Pan Front →',exact:true}).click();
 await page.getByRole('button',{name:'Expand front',exact:true}).click();
 await page.screenshot({path:resolve(output,'rapid-findings-expanded.png')});
 assert.deepEqual(await page.locator('.ad-overview-trace').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('d'))),tracePaths);
 await page.getByRole('navigation',{name:'Expanded photograph',exact:true}).getByRole('button',{name:'Back',exact:true}).click();
 if(direct){
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.ad-overview-side-switch button[aria-pressed=true]')).backgroundColor==='rgb(255, 247, 231)');
  const activeStyle=await page.locator('.ad-overview-side-switch button[aria-pressed=true]').evaluate(node=>({color:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor}));assert.equal(activeStyle.color,'rgb(128, 83, 16)');assert.equal(activeStyle.background,'rgb(255, 247, 231)');
  const bounds=await page.evaluate(async()=>{const samples=[];for(let frame=0;frame<45;frame++){await new Promise(requestAnimationFrame);if(frame%10===0){const overview=document.querySelector('.ad-findings-overview'),photo=document.querySelector('.ad-overview-side:not([hidden]) .ad-overview-photo'),footer=document.querySelector('#atlas-rapid-actions'),box=footer.getBoundingClientRect();samples.push({documentHeight:document.documentElement.scrollHeight,scrollY,overviewHeight:overview.clientHeight,photoHeight:photo.clientHeight,footerTop:box.top,footerBottom:box.bottom,viewportHeight:innerHeight});}}return samples;});
  assert.ok(bounds.every(b=>b.documentHeight<=b.viewportHeight+1&&b.scrollY===0&&b.overviewHeight<=b.viewportHeight&&b.photoHeight<=b.viewportHeight&&b.footerTop>=0&&b.footerBottom<=b.viewportHeight+1),'actual direct route must keep document, canvas and footer bounded across animation frames');
  assert.ok(Math.abs(bounds.at(-1).photoHeight-bounds[0].photoHeight)<=1,'ResizeObserver must settle rather than grow the photo');checks.push({stage:'direct-expanded-back-stability',bounds});
 }
 await page.locator('#atlas-rapid-actions').getByRole('button',{name:'Return to all findings',exact:true}).click();
 await page.locator('.ad-overview-side-switch').waitFor({state:'detached'});
 assert.equal(await page.locator('.ad-overview-side:not([hidden])').count(),2);
 assert.equal(await page.locator('.fg-stage').count(),0);
 await page.getByRole('button',{name:'Inspect Back finding 2',exact:true}).click();
 assert.equal(await page.locator('.ad-findings-overview').count(),1);assert.equal(actions.length,before);
 assert.deepEqual(await page.locator('.ad-overview-trace').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('d'))),tracePaths);
 await page.locator('#atlas-rapid-actions').getByRole('button',{name:'Return to all findings',exact:true}).click();
 await page.locator('.ad-overview-selected').waitFor({state:'detached'});
 assert.equal(await page.locator('.fg-stage').count(),0);
 await page.locator('#atlas-rapid-actions').getByRole('button',{name:'Back to geometry',exact:true}).waitFor();
 for(const size of [{width:1440,height:900},{width:1024,height:768},{width:390,height:844},{width:320,height:844}]){
  await page.setViewportSize(size);await page.getByRole('button',{name:'Fit front',exact:true}).click();
  const dimensions=await page.locator('.ad-findings-overview').evaluate(node=>({width:node.clientWidth,scrollWidth:node.scrollWidth,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,photos:[...node.querySelectorAll('.ad-overview-photo')].map(photo=>({width:photo.clientWidth,height:photo.clientHeight}))}));
  assert.ok(dimensions.documentWidth<=size.width);assert.ok(dimensions.scrollWidth<=dimensions.width+1);assert.ok(dimensions.photos.every(photo=>photo.width>100&&photo.height>100));
  checks.push({stage:'findings',viewport:size,...dimensions});await page.screenshot({path:resolve(output,`rapid-findings-${size.width}.png`)});
 }
 await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'Inspect Front finding 1',exact:true}).click();
 await page.getByRole('button',{name:'Edit finding',exact:true}).click();await page.getByRole('button',{name:'Cancel trace',exact:true}).waitFor();
 await page.getByRole('button',{name:'Cancel trace',exact:true}).click();
 await page.getByRole('button',{name:'Return to all findings',exact:true}).last().click();
 assert.equal(actions.length,before,'inspection, editing cancellation and return never approve');
 await approve.click();await page.getByRole('button',{name:'Approve final grade and queue label',exact:true}).waitFor();
 assert.ok(adapter.view().defects.confirmation);assert.equal(actions.includes('APPROVE_REPORT'),false);assert.deepEqual(errors,[]);await page.screenshot({path:resolve(output,'rapid-final-grade.png')});
 if(direct){
  const prior=adapter.view().defects,priorActions=[...actions];variantState='QUEUED';await page.reload();
  await page.getByRole('heading',{name:/Synthetic saved identity/}).waitFor();
  await page.getByRole('button',{name:'03 Findings',exact:true}).click();await approve.waitFor();
  assert.equal(await approve.isDisabled(),true);assert.match(await page.locator('#atlas-rapid-actions').innerText(),/Checking the confirmed variant/);
  assert.equal(await page.getByRole('button',{name:'Back to geometry',exact:true}).isEnabled(),true);
  assert.deepEqual(adapter.view().defects,prior);assert.deepEqual(actions,priorActions);
  await page.screenshot({path:resolve(output,'rapid-variant-pending.png')});
  variantState='READY';await page.locator('.ad-overview-proposal').waitFor({timeout:15000});
  await page.waitForFunction(()=>!document.querySelector('.mc-rapid-approve')?.disabled);
  assert.deepEqual(adapter.view().defects,prior,'read-only completion must retain all previously reviewed findings');
  assert.deepEqual(actions,priorActions,'pending and READY polling must not save any human decision');assert.deepEqual(errors,[]);
  checks.push({stage:'direct-variant-pending-ready',approvalDisabledWhilePending:true,freshSuggestions:await page.locator('.ad-overview-proposal').count(),savedFindingsPreserved:true,actionsAdded:0});
  await page.screenshot({path:resolve(output,'rapid-variant-ready.png')});
 }
 await writeFile(resolve(output,'rapid-workflow-proof.json'),JSON.stringify({passed:true,checks,actions,errors,limits:`Synthetic pixels, actual React ${direct?'ManualCards direct route and Shell':'ManualWorkspace and shared modal shell'}, isolated in-memory transport with real reducers. Real local CPU preparation and trace reprojection/measurement; no production authentication, paid inference or real report approval.`},null,2));console.log(JSON.stringify({passed:true,evidence:output,checks:checks.length}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});console.error(JSON.stringify({error:String(error),errors,body:await page.locator('body').innerText().catch(()=>''),actions}));throw error;}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
