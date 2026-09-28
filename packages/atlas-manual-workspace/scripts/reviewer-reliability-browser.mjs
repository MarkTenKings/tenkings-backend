/** Local synthetic component proof. No accounts, real cards, provider calls, or approvals. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { workspace } from '../test/defect-fixtures.mjs';
import { parseDefectWorkspace, defectBase, markDefectSideInspected, confirmDefectFindings, previewDefectReport,
  markDefectFindingReviewed, reviewedDefectFindingIds } from '../src/defect-actions.mjs';
import { resizeInspectionView } from '../src/inspection-viewport.mjs';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root=fileURLToPath(new URL('../../../',import.meta.url)),app=resolve(root,'frontend/atlas-app');
const output=process.env.ATLAS_BROWSER_EVIDENCE;
if(!output)throw Error('ATLAS_BROWSER_EVIDENCE must name a task-owned directory');
await mkdir(output,{recursive:true});
const sharp=createRequire(resolve(app,'package.json'))('sharp');
const png=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1350" height="1858"><rect width="1350" height="1858" fill="#222"/><rect x="40" y="40" width="1270" height="1778" fill="#ccb469"/><rect x="100" y="100" width="1150" height="1658" fill="#285570"/><text x="200" y="930" fill="white" font-size="100">Synthetic card</text></svg>')).png().toBuffer();
const hash=createHash('sha256').update(png).digest('hex'),sides=['FRONT','BACK'];
let state=structuredClone(workspace());for(const side of sides)state.sides[side].frame.inspectionImageSha256=hash;
state=parseDefectWorkspace(state);let confirmed=state;
for(const side of sides)confirmed=markDefectSideInspected(confirmed,{side,base:defectBase(confirmed,side),actor:'HUMAN',inspected:true}).state;
confirmed=confirmDefectFindings(confirmed,{base:Object.fromEntries(sides.map(side=>[side,defectBase(confirmed,side)])),actor:'HUMAN',reviewed:true}).state;
const quad=[{x:.04,y:.03},{x:.96,y:.03},{x:.96,y:.97},{x:.04,y:.97}];
const full=previewDefectReport(confirmed,{identity:{playerName:'Synthetic reviewer test',year:'2026',manufacturer:'Fixture',productSet:'Local only'},centeringQuads:{FRONT:quad,BACK:quad},draftRevision:10});
const {inspection,...rest}=full;
const report={...rest,version:'atlas-machine-provisional-report-v1',authority:'MACHINE_PROPOSAL',certification:null,proposedGrade:full.finalGrade,findings:sides.flatMap(side=>state.sides[side].findings),geometry:Object.fromEntries(sides.map(side=>[side,{frame:{inspectionImageSha256:hash},centeringQuad:quad}]))};
const packet={report,reportHash:'a'.repeat(64),explanation:explainAtlasManualReport(full),images:Object.fromEntries(sides.map(side=>[side,{inspection:{url:'/card.png',sha256:hash,byteCount:png.length}}]))};
const source=`import React,{useRef,useState}from'react';import{createRoot}from'react-dom/client';import{createPortal}from'react-dom';import{MachineReportReview}from'../../packages/atlas-manual-workspace/src/FinalReportReview.jsx';import{DefectReviewWorkspace}from'../../packages/atlas-manual-workspace/src/DefectReviewWorkspace.jsx';import{VerifiedImageCacheBoundary}from'../../packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx';import styles from'./components/BatchGrading.module.css';
const input=await(await fetch('/fixture')).json();function Fixture(){const[data,setData]=useState(input),[mode,setMode]=useState('geometry'),[edit,setEdit]=useState(null),[ready,setReady]=useState(false),context=useRef(null);const remember=value=>{context.current=value;if(window.fixture){window.fixture.context=value;window.fixture.contextMode=mode;}};const correct=(finding,value)=>{setEdit(value);setMode('editor');};const save=async finding=>{const response=await fetch('/decision',{method:'POST',body:JSON.stringify({side:finding.side,findingId:finding.id})});setData(await response.json());};window.fixture={data,mode,context:context.current};return <VerifiedImageCacheBoundary scope="synthetic-review"><dialog open className={styles.rapidDialog}><header className={styles.rapidHeader}><h2>Local synthetic review</h2><button onClick={()=>setMode('geometry')}>Geometry review</button><button onClick={()=>setMode('findings')}>Findings review</button></header><div className={styles.rapidBody}><div className="mc-shell mc-rapid-stage">{mode==='editor'?<DefectReviewWorkspace workspace={data.workspace} images={data.packet.images} initialInspection={edit} onInspectionChange={remember} onReturn={()=>setMode('findings')} onEdit={async value=>{window.lastEdit=value;}} onReviewFinding={save} renderReviewActions={options=>createPortal(<><div className="mc-rapid-action-context">{options.inspection}<span>{options.message}</span></div><div className="mc-rapid-action-buttons"><button className="mc-rapid-approve" disabled={options.disabled} onClick={options.approve}>Confirm findings</button></div></>,document.getElementById("fixture-editor-actions"))}/>:<MachineReportReview key={mode} packet={data.packet} inspectionMode={mode} initialInspection={context.current} onInspectionChange={remember} onReadyChange={setReady} onCorrectFinding={correct} onAddFinding={value=>correct(null,{...value,intent:'ADD'})}/>}</div></div><footer id="fixture-editor-actions" className="mc-rapid-actions">{mode!=="editor"&&<><p role="status">Synthetic fixture · Decisions saved: {data.reviewed.length} · {ready?'Photos verified':'Verifying photos'}</p><button disabled={!ready||mode!=='findings'} onClick={()=>{const id=context.current?.findingId;const finding=data.packet.report.findings.find(value=>value.id===id);if(finding)void save(finding);}}>Save selected decision</button></>}</footer></dialog></VerifiedImageCacheBoundary>;}createRoot(document.getElementById('app')).render(<Fixture/>);`;
const bundle=await build({logLevel:'error',stdin:{contents:source,resolveDir:app,sourcefile:'reviewer-reliability-fixture.jsx',loader:'jsx'},bundle:true,write:false,outdir:'/fixture',format:'esm',platform:'browser',target:'chrome120',define:{'process.env.NODE_ENV':'"production"'}});
let css=(await Promise.all(['styles/global.css','styles/grading.css','../../packages/atlas-report-view/src/report.css','../../packages/atlas-manual-workspace/src/workspace.css','../../packages/atlas-manual-workspace/src/defects.css','styles/manual.css','styles/atlas-brand.css','styles/atlas-theme.css','../../packages/atlas-manual-workspace/src/report-review.css'].map(path=>readFile(resolve(app,path),'utf8')))).join('\n')+'\n'+bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
const fixture=()=>({workspace:state,packet,reviewed:sides.flatMap(side=>reviewedDefectFindingIds(state,side))});
const server=createServer(async(q,r)=>{try{if(q.url==='/card.png'){r.setHeader('content-type','image/png');r.end(png);}else if(q.url==='/bundle.js'){r.setHeader('content-type','text/javascript');r.end(js);}else if(q.url==='/style.css'){r.setHeader('content-type','text/css');r.end(css);}else if(q.url==='/fixture'||q.url==='/decision'){if(q.url==='/decision'){let data='';for await(const part of q)data+=part;const {side,findingId}=JSON.parse(data);state=markDefectFindingReviewed(state,{side,findingId,base:defectBase(state,side),reviewed:true,actor:'HUMAN',reviewerId:'synthetic-reviewer',reviewedAt:new Date().toISOString()}).state;}r.setHeader('content-type','application/json');r.end(JSON.stringify(fixture()));}else if(q.url==='/'){r.setHeader('content-type','text/html');r.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script type="module" src="/bundle.js"></script>');}else{r.writeHead(404);r.end();}}catch(error){r.writeHead(500);r.end(String(error));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage(),errors=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('Photos verified',{exact:false}).waitFor();
 for(const size of [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080},{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(size);await page.getByRole('button',{name:'Geometry review',exact:true}).click();
  const dimensions=await page.locator('.rr-viewport').first().evaluate(node=>({width:node.clientWidth,height:node.clientHeight,hiddenPanel:document.querySelector('.rr-findings-panel').getBoundingClientRect().height}));
  assert.equal(dimensions.hiddenPanel,0);assert.ok(dimensions.height>100);if(size.width>=1280)assert.ok(dimensions.height>400);
  checks.push({viewport:size,...dimensions});await page.screenshot({path:resolve(output,`geometry-${size.width}.png`)});
 }
 await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'Findings review',exact:true}).click();
 await page.getByRole('button',{name:/^Back 1 ·/}).click();await page.getByRole('button',{name:'Edit finding',exact:true}).waitFor();
 await page.waitForFunction(()=>window.fixture.context?.side==='BACK'&&window.fixture.context?.view?.zoom>1);
 const before=await page.evaluate(()=>window.fixture.context);assert.equal(before.side,'BACK');assert.ok(before.view.zoom>1);
 await page.getByRole('button',{name:'Edit finding',exact:true}).click();await page.waitForFunction(()=>window.fixture.mode==='editor'&&window.fixture.contextMode==='editor');
 const editorDimensions=await page.getByRole('region',{name:'Back image inspection'}).evaluate(node=>({width:node.clientWidth,height:node.clientHeight}));assert.ok(editorDimensions.height>250,JSON.stringify(editorDimensions));await page.screenshot({path:resolve(output,'finding-editor.png')});
 const editor=await page.evaluate(()=>window.fixture.context);assert.equal(editor.findingId,before.findingId);assert.equal(editor.side,'BACK');assert.equal(editor.imageSha256,before.imageSha256);assert.equal(editor.view.zoom,before.view.zoom);assert.deepEqual(editor.view,resizeInspectionView(before.view,before.size,editor.size));
 await page.getByRole('region',{name:'Back defects'}).getByRole('button',{name:'Edit trace',exact:true}).click();await page.getByRole('button',{name:'Cancel trace',exact:true}).click();
 await page.getByRole('button',{name:'Return to findings review',exact:true}).click();await page.getByRole('button',{name:'Edit finding',exact:true}).waitFor();
 await page.getByRole('button',{name:'Save selected decision',exact:true}).click();await page.getByText('Decisions saved: 1',{exact:false}).waitFor();
 await page.reload();await page.getByText('Decisions saved: 1',{exact:false}).waitFor();assert.equal(state.confirmation,null);
 await page.getByRole('button',{name:'Findings review',exact:true}).click();await page.getByRole('button',{name:'Add finding · Front',exact:true}).click();
 await page.getByRole('button',{name:'Cancel trace',exact:true}).waitFor();await page.waitForFunction(()=>window.fixture.mode==='editor'&&window.fixture.contextMode==='editor');assert.equal(await page.getByRole('button',{name:'Save trace',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Cancel trace',exact:true}).click();
 await page.screenshot({path:resolve(output,'add-finding-editor.png')});
 await page.getByRole('button',{name:'Return to findings review',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:/^Back 1 ·/}).click();await page.getByRole('button',{name:'Edit finding',exact:true}).waitFor();const mobilePanel=await page.locator('.rr-findings-panel').evaluate(node=>({height:node.clientHeight,display:getComputedStyle(node).display}));assert.ok(mobilePanel.height>100);assert.notEqual(mobilePanel.display,'none');await page.screenshot({path:resolve(output,'findings-mobile.png')});
 await page.getByRole('button',{name:'Edit finding',exact:true}).click();await page.waitForFunction(()=>window.fixture.mode==='editor'&&window.fixture.contextMode==='editor');const mobileEditor=await page.getByRole('region',{name:'Back image inspection'}).evaluate(node=>({width:node.clientWidth,height:node.clientHeight}));assert.ok(mobileEditor.height>100);await page.screenshot({path:resolve(output,'finding-editor-mobile.png')});assert.deepEqual(errors,[]);
 await writeFile(resolve(output,'reviewer-browser-proof.json'),JSON.stringify({checks,selection:{before,editor},editorDimensions,mobilePanel,mobileEditor,savedDecisionCount:fixture().reviewed.length,confirmation:state.confirmation,errors,limits:'Synthetic component and state fixture; no production authentication, CPU measurement, real-card save or approval.'},null,2));
 console.log(JSON.stringify({passed:true,checks:checks.length,evidence:output}));
}catch(error){await page.screenshot({path:resolve(output,'failure.png')}).catch(()=>{});console.error(JSON.stringify({errors,body:await page.locator('body').innerText().catch(()=>''),failure:String(error)}));throw error;}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
