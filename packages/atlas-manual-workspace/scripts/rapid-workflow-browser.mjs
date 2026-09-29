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
import {explainAtlasManualReport} from '@atlas/grading-core/manual-report';
const root=fileURLToPath(new URL('../../../',import.meta.url)),app=resolve(root,'frontend/atlas-app');
const output=process.env.ATLAS_BROWSER_EVIDENCE;
if(!output)throw Error('ATLAS_BROWSER_EVIDENCE must name an isolated evidence directory');
await mkdir(output,{recursive:true});
const adapter=await createRapidPreviewAdapter({pythonExecutable:process.env.ATLAS_FIXTURE_PYTHON});
let failNext=false;const actions=[];
const source=`import React from'react';import{createRoot}from'react-dom/client';import{ManualWorkspace}from'./components/ManualCards.jsx';import{VerifiedImageCacheBoundary}from'../../packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx';import styles from'./components/BatchGrading.module.css';createRoot(document.getElementById('app')).render(<VerifiedImageCacheBoundary scope="synthetic-rapid"><dialog open className={styles.rapidDialog}><header className={styles.rapidHeader}><h2>Synthetic rapid review</h2></header><div className={styles.rapidBody}><ManualWorkspace rapid staff={{id:'synthetic',role:'REVIEWER'}} csrf="fixture" cardId="focused-synthetic"/></div><footer id="atlas-rapid-actions" className="mc-rapid-actions"><div id="atlas-rapid-edits" className="mc-rapid-edit-dock"/></footer></dialog></VerifiedImageCacheBoundary>);`;
const transport=`export function createManualClient(options){let pending=false;const load=async(path='/fixture',body)=>{const r=await fetch(path,body?{method:'POST',body:JSON.stringify(body)}:undefined);if(!r.ok){const failure=await r.json().catch(()=>({error:'LOCAL_PREVIEW_SAVE_FAILED'}));throw Object.assign(Error(failure.error),{code:failure.error});}const value=await r.json();options.onView(value);return value;};return {recover:()=>load(),hasPending:()=>pending,execute:async action=>{pending=true;options.onStatus('Saving…');try{const value=await load('/action',action);options.onStatus('Saved');return value;}catch(error){options.onStatus('Save failed');throw error;}finally{pending=false;}},previewReport:async()=>{const r=await fetch('/preview');if(!r.ok)throw Error('Preview unavailable');return r.json();}};}`;
const stubs={'@atlas/manual-workflow/client':transport,'next/router':`export const useRouter=()=>({query:{},events:{on(){},off(){},emit(){}}});`,'next/link':`import React from'react';export default function Link(props){return React.createElement('a',props,props.children);}`};
const bundle=await build({logLevel:'error',stdin:{contents:source,resolveDir:app,sourcefile:'rapid-workflow-fixture.jsx',loader:'jsx'},bundle:true,write:false,outdir:'/fixture',format:'esm',platform:'browser',target:'chrome120',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-transport',setup(build){build.onResolve({filter:/^@atlas\/manual-workspace\/(defects|focused-geometry|report-review)$/},args=>({path:resolve(root,'packages/atlas-manual-workspace/src/'+({'@atlas/manual-workspace/defects':'DefectReviewWorkspace.jsx','@atlas/manual-workspace/focused-geometry':'FocusedGeometryWorkspace.jsx','@atlas/manual-workspace/report-review':'FinalReportReview.jsx'}[args.path]))}));build.onResolve({filter:/^(@atlas\/manual-workflow\/client|next\/router|next\/link)$/},args=>({path:args.path,namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js',resolveDir:app}));}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=(await Promise.all(['styles/global.css','styles/grading.css','../../packages/atlas-report-view/src/report.css','../../packages/atlas-manual-workspace/src/workspace.css','../../packages/atlas-manual-workspace/src/defects.css','styles/manual.css','styles/atlas-brand.css','styles/atlas-theme.css','../../packages/atlas-manual-workspace/src/report-review.css','../../packages/atlas-manual-workspace/src/focused-geometry.css'].map(path=>readFile(resolve(app,path),'utf8')))).join('\n')+'\n'+bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server=createServer(async(q,r)=>{try{
 const imageMatch=/^\/images\/([a-f0-9]{64})$/.exec(q.url);
 if(imageMatch){const asset=adapter.asset(imageMatch[1]);if(!asset){r.writeHead(404);r.end();return;}r.setHeader('content-type',asset.mime);r.setHeader('Cache-Control','public, max-age=31536000, immutable');r.end(asset.bytes);return;}
 if(q.url==='/bundle.js'||q.url==='/style.css'){r.setHeader('content-type',q.url==='/bundle.js'?'text/javascript':'text/css');r.end(q.url==='/bundle.js'?js:css);return;}
 if(q.url==='/action'){
  let bytes='';for await(const chunk of q)bytes+=chunk;const action=JSON.parse(bytes);actions.push(action.type);
  if(failNext){failNext=false;r.writeHead(503);r.end();return;}
  await adapter.execute(action);
 }
 if(q.url==='/preview'){
  const preview=adapter.preview();
  r.setHeader('content-type','application/json');r.end(JSON.stringify({...preview,review:{report:preview.report,explanation:explainAtlasManualReport(preview.report)}}));return;
 }
 if(q.url==='/fixture'||q.url==='/action'||q.url?.includes('/view')){r.setHeader('content-type','application/json');r.end(JSON.stringify(adapter.view()));return;}
 if(q.url==='/'){r.setHeader('content-type','text/html');r.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script type="module" src="/bundle.js"></script>');return;}
 r.writeHead(404);r.end();
 }catch(error){r.writeHead(500,{'content-type':'application/json'});r.end(JSON.stringify({error:error.code??error.message??'LOCAL_PREVIEW_SAVE_FAILED'}));}});
await new Promise(resolve=>server.listen(Number(process.env.ATLAS_PREVIEW_PORT||0),'127.0.0.1',resolve));
if(process.env.ATLAS_PREVIEW_ONLY==='1'){console.log(`Synthetic rapid workspace: http://127.0.0.1:${server.address().port}`);await new Promise(()=>{});}
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 const front=page.getByRole('button',{name:'Approve Front borders and centering',exact:true});await front.waitFor();await page.waitForFunction(()=>!document.querySelector('.mc-rapid-approve')?.disabled);
 for(const size of [{width:1440,height:900},{width:1280,height:720},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);const dimensions=await page.locator('.fg-stage').evaluate(node=>({height:node.clientHeight,width:node.clientWidth,bottom:node.getBoundingClientRect().bottom,dock:document.querySelector('#atlas-rapid-actions').getBoundingClientRect().top}));
  assert.ok(dimensions.height>100);assert.ok(dimensions.bottom<=dimensions.dock);checks.push({stage:'geometry',viewport:size,...dimensions});await page.screenshot({path:resolve(output,`rapid-geometry-${size.width}.png`)});
 }
 await page.setViewportSize({width:1440,height:900});await front.click();const back=page.getByRole('button',{name:'Approve Back borders and centering',exact:true});await back.waitFor();await page.waitForFunction(()=>!document.querySelector('.mc-rapid-approve')?.disabled);assert.equal(actions.length,0);
 failNext=true;await back.click();await page.locator('.fg-error').waitFor();assert.equal(geometryStatus(adapter.view().geometry).confirmed,false);await back.click();
 const approve=page.getByRole('button',{name:'Approve finding 1 of 2',exact:true});await approve.waitFor();await page.waitForFunction(()=>!document.querySelector('.mc-rapid-approve')?.disabled);
 await page.getByRole('button',{name:'Edit trace',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Save trace',exact:true}).count(),0);await page.getByRole('button',{name:'Cancel trace',exact:true}).click();
 await page.getByRole('region',{name:'Front defects',exact:true}).getByRole('button',{name:'Add finding',exact:true}).click();await page.getByRole('button',{name:'Cancel trace',exact:true}).click();
 for(const size of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);const dimensions=await page.getByRole('region',{name:'Front image inspection',exact:true}).evaluate(node=>({height:node.clientHeight,width:node.clientWidth,bottom:node.getBoundingClientRect().bottom,dock:document.querySelector('#atlas-rapid-actions').getBoundingClientRect().top}));assert.ok(dimensions.height>80,JSON.stringify({size,dimensions}));assert.ok(dimensions.bottom<=dimensions.dock);checks.push({stage:'findings',viewport:size,...dimensions});await page.screenshot({path:resolve(output,`rapid-findings-${size.width}.png`)});
 }
 await page.setViewportSize({width:1440,height:900});await approve.click();await page.getByRole('button',{name:'Approve finding 2 of 2',exact:true}).click();await page.getByRole('button',{name:'Approve final grade and queue label',exact:true}).waitFor();
 assert.ok(adapter.view().defects.confirmation);assert.equal(actions.includes('APPROVE_REPORT'),false);assert.deepEqual(errors,[]);await page.screenshot({path:resolve(output,'rapid-final-grade.png')});
 await writeFile(resolve(output,'rapid-workflow-proof.json'),JSON.stringify({passed:true,checks,actions,errors,limits:'Synthetic pixels, actual React ManualWorkspace and shared shell, isolated in-memory transport with real reducers. Real local CPU preparation and trace reprojection/measurement; no production authentication, paid inference or real report approval.'},null,2));console.log(JSON.stringify({passed:true,evidence:output,checks:checks.length}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});console.error(JSON.stringify({error:String(error),errors,body:await page.locator('body').innerText().catch(()=>''),actions}));throw error;}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
