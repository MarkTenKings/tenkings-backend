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

// Real page, issue panel, identity validation, geometry component and production
// styles. Persistence/auth are synthetic and no remote requests are allowed.
const mocks={
 'next/router':`export const useRouter=()=>({query:{from:'batch'},events:{on(){},off(){}},replace:async()=>{}});`,
 'next/link':`import React from 'react';export default function Link(p){return <a {...p}/>;}`,
 './Shell':`import React from 'react';export default function Shell({children}){return <main className="mc-shell">{children}</main>;}`,
 '@atlas/manual-intake/client':`export const createBrowserIntakeJournal=()=>({close(){}}),createIntakeClient=()=>({pending:async()=>[]});`,
 '../lib/batch-import.mjs':`export const createBrowserBatchImportJournal=()=>({close(){}});`,
 '../lib/card-discard.mjs':`export const createWorkspaceDiscarder=()=>({pending:()=>false,reconcile:async()=>null}),hasPendingDiscard=()=>false,discardKey=()=>'',discardEvent='discard',discardedIdsFromEvent=()=>null;`,
 '../lib/manual-client.mjs':`export const manualMessage=e=>e.code;export async function manualRequest(path,options={}){if(options.method==='POST'){window.__posts++;throw Error('Unexpected mutation');}return path.endsWith('/session')?{staff:{id:'fixture'},csrf:'fixture'}:window.__card;}`,
 '../lib/early-geometry-client.mjs':`export const earlyGeometryIdentity=()=>'',createEarlyGeometryClient=()=>({ensure:async()=>{},poll:async()=>{},dispose(){}});`,
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
 return path.endsWith('/session')?{staff:{id:'fixture'},csrf:'fixture'}:window.fixture.card;
}`;
mocks['@atlas/manual-workflow/client']=`export function createManualClient({onView}){return {hasPending:()=>false,recover:async()=>{onView(window.fixture.view);return window.fixture.view;},execute:async()=>{throw Error('Fixture blocks workflow writes');}};}`;
const source=`import React from 'react';import {createRoot} from 'react-dom/client';
import ManualCards from './components/ManualCards.jsx';
import {createGeometryWorkspace} from '../../packages/atlas-manual-workspace/src/geometry-actions.mjs';
const url='/fixture.png',sides=['FRONT','BACK'];
const bytes=new Uint8Array(await (await fetch(url)).arrayBuffer());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const card={revision:1,card:{revision:1,label:'Geometry recovery fixture',ready:true,sourceHash:'sample',sides:Object.fromEntries(sides.map(side=>[side,{version:1,upload:{uploadId:side,source:{},verification:{verified:true}}}]))},identification:{state:'COMPLETE'},details:{profile:'SPORTS',fields:{name:'Rick Barry',year:'1975',manufacturer:'Topps',set_name:'Basketball',card_number:'24'},parallel:'Base',insert:'Base',matColor:'BLACK',cornerShape:'SQUARE'},previews:{FRONT:{url},BACK:{url}},earlyGeometry:Object.fromEntries(sides.map(side=>[side,{uploadId:side,key:side,state:'NEEDS_REVIEW',physical:null,printed:null,canRetry:true}]))};
const geometry=createGeometryWorkspace({cardId:'fixture',profile:'SPORTS',sides:Object.fromEntries(sides.map(side=>[side,{image:{version:1,originalSha256:hash,frameId:side,frameSha256:hash,width:1270,height:1778,coordinateSpace:'ORIENTED_DECODED'},matColor:'BLACK',cornerShape:'SQUARE'}]))});
window.fixture={card,audit:[],view:{card:{revision:1,contentHash:'fixture',draft:{}},geometry,identity:{},astra:{enabled:false},images:Object.fromEntries(sides.map(side=>[side,{original:{url,sha256:hash,byteCount:bytes.length,mime:'image/png'}}]))}};
createRoot(document.getElementById('app')).render(<ManualCards staff={{id:'fixture',role:'REVIEWER'}} cardId='fixture'/>);`;
const bundle=await build({stdin:{contents:source,resolveDir:app,sourcefile:'attention-fixture.jsx',loader:'jsx'},bundle:true,write:false,format:'esm',platform:'browser',target:'chrome120',jsx:'transform',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture-adapters',setup(b){b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:app}));}}]});
const css=['global.css','manual.css','atlas-brand.css','atlas-theme.css'].map(f=>readFileSync(join(app,'styles',f),'utf8')).join('\n')+readFileSync(join(root,'packages/atlas-manual-workspace/src/workspace.css'),'utf8');
const server=createServer((request,response)=>{if(request.url==='/fixture.png'){response.setHeader('content-type','image/png');response.end(fixtureImage);}else if(request.url.startsWith('/bundle.js')){response.setHeader('content-type','text/javascript; charset=utf-8');response.end(bundle.outputFiles[0].text);}else if(request.url==='/style.css'){response.setHeader('content-type','text/css; charset=utf-8');response.end(css);}else if(request.url.startsWith('/?')||request.url==='/'){response.setHeader('content-type','text/html; charset=utf-8');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><p id="audit" role="status" style="position:fixed;bottom:0;left:0;z-index:999;background:#fff;color:#000;padding:8px">Local fixture actions: none</p><div id="app"></div><script type="module" src="/bundle.js"></script>');}else{response.writeHead(404);response.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;

console.log(JSON.stringify({origin,mode:"synthetic local geometry recovery; no production access"}));
