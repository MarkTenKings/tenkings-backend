import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),app=join(root,'frontend/atlas-app');
const req=createRequire(join(root,'packages/atlas-manual-workspace/package.json'));
const {build}=req('esbuild');
const sharp=createRequire(join(app,'package.json'))('sharp');
const fixtureImage=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1270" height="1778"><rect width="1270" height="1778" fill="#252c24"/><rect x="100" y="100" width="1070" height="1578" fill="#d4b35b"/><text x="230" y="900" font-size="60">Synthetic card</text></svg>')).png().toBuffer();

// Real review entry, identity validation, sequential geometry and production
// styles. Persistence/auth are synthetic and no remote requests are allowed.
const mocks={
 '@atlas/manual-workspace/focused-geometry':`export * from '../../packages/atlas-manual-workspace/src/FocusedGeometryWorkspace.jsx';`,
 'next/router':`export const useRouter=()=>({query:{from:'batch'},events:{on(){},off(){}},replace:async()=>{}});`,
 'next/link':`import React from 'react';export default function Link(p){return <a {...p}/>;}`,
 './Shell':`import React from 'react';export default function Shell({children}){return <main className="mc-shell">{children}</main>;}`,
 '@atlas/manual-intake/client':`export const createBrowserIntakeJournal=()=>({close(){}}),createIntakeClient=()=>({pending:async()=>[]});`,
 '../lib/batch-import.mjs':`export const createBrowserBatchImportJournal=()=>({close(){}});`,
 '../lib/card-discard.mjs':`export const createWorkspaceDiscarder=()=>({pending:()=>false,reconcile:async()=>null}),hasPendingDiscard=()=>false,discardKey=()=>'',discardEvent='discard',discardedIdsFromEvent=()=>null;`,
 '../lib/manual-client.mjs':`export const manualMessage=e=>e.code;export async function manualRequest(path,options={}){if(options.method==='POST'){window.__posts++;throw Error('Unexpected mutation');}return path.endsWith('/session')?{staff:{id:'fixture'},csrf:'fixture'}:window.__card;}`,
 './ManualFinishing':`export default ()=>null;export const openManualLabelPrintWindow=()=>null;`,
};
for(const name of ['./ReportPhotoUploader','./ReportMarketPicker','./ReportResearchPicker','./DealerOfferPicker'])mocks[name]='export default ()=>null;';
mocks['../lib/manual-client.mjs']=`export const manualMessage=e=>e.message??e.code;export async function manualRequest(path,options={}){
 if(options.method==='POST'){
  window.fixture.audit.push(path.split('/').at(-1));
  if(path.endsWith('/details')){window.fixture.card.details={...window.fixture.card.details,...options.body.changes};window.fixture.card.revision++;}
  else if(path.endsWith('/initialize'))window.fixture.card.manual={current:true,revision:1};
  else throw Error('Fixture blocks unexpected writes');
  document.getElementById('audit').textContent='Local fixture actions: '+window.fixture.audit.join(', ');
  return {};
 }
 return path.endsWith('/session')?{staff:{id:'fixture'},csrf:'fixture'}:path.split('?')[0].endsWith('/view')?window.fixture.view:window.fixture.card;
}`;
mocks['@atlas/manual-workflow/client']=`export function createManualClient({onView,onStatus}){return {hasPending:()=>false,recover:async()=>{onView(window.fixture.view);return window.fixture.view;},execute:async action=>{
 if(window.fixture.mode!=='existing-preparation'||action.type!=='PREPARE_SIDE')throw Error('Fixture blocks unexpected workflow writes');
 window.fixture.audit.push(action.type+':'+action.side);
 document.getElementById('audit').textContent='Local fixture actions: '+window.fixture.audit.join(', ');
 await new Promise(resolve=>{window.fixture.releasePreparation=resolve;});
 const value=window.fixture.prepare(action.side);onView(value);onStatus('Saved');return value;
}};}`;
const source=`import React from 'react';import {createRoot} from 'react-dom/client';
import ManualCards from './components/ManualCards.jsx';
import {createGeometryWorkspace,applyGeometryEdit,applyPreparedFrame,geometryBase,preparationBase,originalPointToPrepared,printedQuadOnOriginal} from '../../packages/atlas-manual-workspace/src/geometry-actions.mjs';
const url='/fixture.png',sides=['FRONT','BACK'],mode=new URL(location.href).searchParams.get('mode')??'missing-outlines';
const bytes=new Uint8Array(await (await fetch(url)).arrayBuffer());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const card={revision:1,card:{revision:1,label:'Geometry recovery fixture',ready:true,sourceHash:'sample',sides:Object.fromEntries(sides.map(side=>[side,{version:1,upload:{uploadId:side,source:{},verification:{verified:true}}}]))},identification:{state:'COMPLETE'},details:{profile:'SPORTS',fields:{name:'Synthetic specimen',year:'1975',manufacturer:'Topps',set_name:'Basketball',card_number:'24'},parallel:'Base',insert:'Base',matColor:'BLACK',cornerShape:'SQUARE'},previews:{FRONT:{url},BACK:{url}},gradingImages:Object.fromEntries(sides.map(side=>[side,{uploadId:side,state:'READY'}])),earlyGeometry:Object.fromEntries(sides.map(side=>[side,{uploadId:side,key:side,state:'NEEDS_REVIEW',physical:null,printed:null,canRetry:true}]))};
let geometry=createGeometryWorkspace({cardId:'fixture',profile:'SPORTS',sides:Object.fromEntries(sides.map(side=>[side,{image:{version:1,originalSha256:hash,frameId:side,frameSha256:hash,width:1270,height:1778,coordinateSpace:'ORIENTED_DECODED'},matColor:'BLACK',cornerShape:'SQUARE'}]))});
// Authored fixture data only. These saved proposals simulate retained Astra
// observations; the fixture never calls a provider or approves geometry.
const physical=[[100,100],[1169,100],[1169,1677],[100,1677]].map(([x,y])=>({x:x/1270,y:y/1778}));
const retainedPrinted=[[155,185],[1114,185],[1114,1592],[155,1592]].map(([x,y])=>({x:x/1270,y:y/1778}));
if(mode==='existing-preparation'){
 card.manual={current:true,revision:1};
 for(const side of sides)geometry=applyGeometryEdit(geometry,{side,kind:'PHYSICAL',base:geometryBase(geometry,side,'PHYSICAL'),quad:physical,actor:'ASTRA',proposal:{id:'synthetic-'+side+'-physical',ambiguous:false}}).state;
}
window.fixture={card,mode,audit:[],retainedPrinted,physical,view:{card:{revision:1,contentHash:'fixture',draft:{}},geometry,identity:{},astra:{enabled:false},images:Object.fromEntries(sides.map(side=>[side,{original:{url,sha256:hash,byteCount:bytes.length,mime:'image/png'}}]))}};
window.fixture.prepare=side=>{
 const current=window.fixture.view,sx=1269/1069,sy=1777/1577;
 let next=applyPreparedFrame(current.geometry,{side,base:preparationBase(current.geometry,side),frame:{id:side+'-synthetic-prepared',version:1,rectified:{sha256:'a'.repeat(64),width:1270,height:1778},inspection:{sha256:'b'.repeat(64),width:1350,height:1858,cardBounds:{x:40,y:40,width:1270,height:1778}},sourceToRectified:[sx,0,-100*sx,0,sy,-100*sy,0,0,1]}}).state;
 next=applyGeometryEdit(next,{side,kind:'PRINTED',base:geometryBase(next,side,'PRINTED'),quad:retainedPrinted.map(point=>originalPointToPrepared(next,side,point)),actor:'ASTRA',proposal:{id:'synthetic-'+side+'-printed',ambiguous:false}}).state;
 window.fixture.view={...current,card:{...current.card,revision:current.card.revision+1},geometry:next};return window.fixture.view;
};
window.fixture.savedOutlines=()=>Object.fromEntries(sides.map(side=>[side,{physical:window.fixture.view.geometry.sides[side].physical,printed:window.fixture.view.geometry.sides[side].printed,printedOriginal:printedQuadOnOriginal(window.fixture.view.geometry,side),confirmation:window.fixture.view.geometry.sides[side].confirmation}]));
createRoot(document.getElementById('app')).render(<ManualCards staff={{id:'fixture',role:'REVIEWER'}} cardId='fixture'/>);`;
const bundle=await build({stdin:{contents:source,resolveDir:app,sourcefile:'attention-fixture.jsx',loader:'jsx'},bundle:true,write:false,logLevel:'error',outfile:'bundle.js',format:'esm',platform:'browser',target:'chrome120',jsx:'transform',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture-adapters',setup(b){b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:app}));}}]});
const css=['global.css','manual.css','atlas-brand.css','atlas-theme.css'].map(f=>readFileSync(join(app,'styles',f),'utf8')).join('\n')+['workspace.css','focused-geometry.css','defects.css','report-review.css'].map(f=>readFileSync(join(root,'packages/atlas-manual-workspace/src',f),'utf8')).join('\n')+'\n'+(bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text??'');
const server=createServer((request,response)=>{if(request.url==='/fixture.png'){response.setHeader('content-type','image/png');response.end(fixtureImage);}else if(request.url.startsWith('/bundle.js')){response.setHeader('content-type','text/javascript; charset=utf-8');response.end(bundle.outputFiles[0].text);}else if(request.url==='/style.css'){response.setHeader('content-type','text/css; charset=utf-8');response.end(css);}else if(request.url.startsWith('/?')||request.url==='/'){response.setHeader('content-type','text/html; charset=utf-8');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><p id="audit" role="status" style="position:fixed;bottom:0;left:0;z-index:999;background:#fff;color:#000;padding:8px">Local fixture actions: none</p><div id="app"></div><script type="module" src="/bundle.js"></script>');}else{response.writeHead(404);response.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;

console.log(JSON.stringify({origin,mode:"synthetic local geometry recovery; no production access"}));

if(process.argv.includes('--verify')){
 const {webkit}=req('playwright');
 const browser=await webkit.launch({headless:true,...(process.env.ATLAS_REVIEW_BROWSER_EXECUTABLE?{executablePath:process.env.ATLAS_REVIEW_BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1040}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin);
  await page.getByRole('region',{name:'Front geometry',exact:true}).waitFor();
  await page.getByRole('button',{name:'Place physical edge',exact:true}).waitFor();
  assert.equal(await page.locator('.fg-outlines polygon,.fg-handle').count(),0,'missing outlines never render substitute geometry');
  const initial=await page.evaluate(()=>({text:document.body.innerText,audit:window.fixture.audit,photos:document.querySelectorAll('.fg-photo').length,pair:document.querySelectorAll('.mc-photo-pair').length}));
  assert.deepEqual(initial.audit,['initialize']);assert.equal(initial.pair,0);assert.equal(initial.photos,1);
  assert.doesNotMatch(initial.text,/Review the items highlighted|Edit Front geometry|Original retained|Retry/);
  assert.match(initial.text,/Place the physical edge/);
  assert.equal(await page.getByRole('button',{name:'Approve Front borders and centering',exact:true}).isDisabled(),true);
  const resultDir=process.env.ATLAS_REVIEW_FIXTURE_OUTPUT??'/tmp/atlas-r18-review-entry';mkdirSync(resultDir,{recursive:true});
  await page.screenshot({path:join(resultDir,'front-direct.png'),fullPage:true});
  await page.getByRole('button',{name:/02\s*Back/}).click();
  await page.getByRole('region',{name:'Back geometry',exact:true}).waitFor();
  const after=await page.evaluate(()=>window.fixture.audit);assert.deepEqual(after,['initialize']);
  await page.screenshot({path:join(resultDir,'back-direct.png'),fullPage:true});
  await page.goto(origin+'/?mode=existing-preparation');
  await page.waitForFunction(()=>window.fixture?.audit[0]==='PREPARE_SIDE:FRONT');
  await page.getByRole('region',{name:'Loading card review',exact:true}).waitFor();
  assert.match(await page.locator('body').innerText(),/Preparing saved outlines/);
  assert.equal(await page.locator('.fg-photo,.mc-photo-pair').count(),0,'editing stays unmounted during preparation');
  assert.equal(await page.getByRole('button',{name:/Retry/}).count(),0,'pending preparation is not a failure');
  await page.evaluate(()=>window.fixture.releasePreparation());
  await page.waitForFunction(()=>window.fixture.audit[1]==='PREPARE_SIDE:BACK');
  assert.equal(await page.locator('.fg-photo').count(),0,'both sides prepare before editing mounts');
  await page.evaluate(()=>window.fixture.releasePreparation());
  await page.getByRole('region',{name:'Front geometry',exact:true}).waitFor();
  await page.locator('.fg-outlines polygon').first().waitFor();
  assert.equal(await page.locator('.fg-outlines polygon:not(.fg-stroke-contrast)').count(),2,'saved physical and retained printed outlines render');
  const recovered=await page.evaluate(()=>({text:document.body.innerText,audit:window.fixture.audit,outlines:window.fixture.savedOutlines(),physical:window.fixture.physical,retainedPrinted:window.fixture.retainedPrinted,pair:document.querySelectorAll('.mc-photo-pair').length}));
  assert.deepEqual(recovered.audit,['PREPARE_SIDE:FRONT','PREPARE_SIDE:BACK']);assert.equal(recovered.pair,0);
  assert.doesNotMatch(recovered.text,/Review the items highlighted|Edit Front geometry|Original retained|Retry|Place the physical edge/);
  for(const side of ['FRONT','BACK']){
   assert.deepEqual(recovered.outlines[side].physical.quad,recovered.physical,'preparation preserves saved physical');
   assert.equal(recovered.outlines[side].physical.actor,'ASTRA');assert.equal(recovered.outlines[side].printed.actor,'ASTRA');
   assert.equal(recovered.outlines[side].confirmation,null,'preparation never confirms geometry');
   for(let i=0;i<4;i++)for(const axis of ['x','y'])assert.ok(Math.abs(recovered.outlines[side].printedOriginal[i][axis]-recovered.retainedPrinted[i][axis])<1e-12,'restored printed outline matches retained source geometry');
  }
  await page.screenshot({path:join(resultDir,'front-prepared.png'),fullPage:true});
  await page.getByRole('button',{name:/02\s*Back/}).click();
  await page.getByRole('region',{name:'Back geometry',exact:true}).waitFor();
  await page.locator('.fg-outlines polygon').first().waitFor();
  assert.equal(await page.locator('.fg-outlines polygon:not(.fg-stroke-contrast)').count(),2);
  await page.screenshot({path:join(resultDir,'back-prepared.png'),fullPage:true});
  assert.deepEqual(await page.evaluate(()=>window.fixture.audit),recovered.audit);
  assert.equal(await page.getByRole('alert').count(),0);
  assert.deepEqual(errors,[]);
  writeFileSync(join(resultDir,'result.json'),JSON.stringify({passed:true,mode:'synthetic local UI, no provider/database calls or human decisions',initial,after,recovered,errors},null,2));
  console.log(JSON.stringify({passed:true,resultDir}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
