/** Loopback synthetic clean pixels, actual editor/client and native preparation.
 * No production connection, image generation, model request or final approval. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createRapidPreviewAdapter} from './rapid-preview-adapter.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const output=resolve(process.argv[2]);await mkdir(output,{recursive:true});
let fail=true;
const adapter=await createRapidPreviewAdapter({pythonExecutable:process.env.ATLAS_FIXTURE_PYTHON,beforePrepare:async()=>{
 if(fail){fail=false;throw Object.assign(Error('Synthetic interrupted preparation'),{status:422,code:'MANUAL_PREPARATION_FAILED'});}
}});
const receipts=new Map(),requests=[];
const source=`import React,{useEffect,useState,useRef}from'react';import{createRoot}from'react-dom/client';
import{FocusedGeometryWorkspace}from'./src/FocusedGeometryWorkspace.jsx';
import{approveRapidGeometrySide}from'./src/rapid-review.mjs';import{sourceQuadToPrepared}from'./src/geometry-focus.mjs';
import{createManualClient}from'../atlas-manual-workflow/src/client.mjs';
function App(){const[view,setView]=useState(null),[done,setDone]=useState(false),client=useRef(null),checkpoint=useRef({});
 useEffect(()=>{client.current=createManualClient({cardId:'synthetic-card',staffId:'fixture',csrf:'fixture',storage:localStorage,onView:setView,timeoutMs:45000});void client.current.load();},[]);
 const approve=async input=>{const result=await approveRapidGeometrySide(view,input,(action,options)=>client.current.execute(action,options),sourceQuadToPrepared,checkpoint.current,()=>client.current.load());setView(result);setDone(true);return result;};
 window.__view=view;window.__done=done;
 return view?<><p role='status'>{done?'Saved both outlines and measured the corrected frame':'Synthetic clean-image geometry recovery'}</p><FocusedGeometryWorkspace workspace={view.geometry} side='BACK' images={view.images} onApproveSide={approve}/></>:<p>Loading</p>;}
createRoot(document.getElementById('app')).render(<App/>);`;
const bundle=await build({stdin:{contents:source,resolveDir:resolve(root,'packages/atlas-manual-workspace'),loader:'jsx'},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'}});
const css=await readFile(resolve(root,'packages/atlas-manual-workspace/src/focused-geometry.css'),'utf8');
const html='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script type="module" src="/bundle.js"></script>';
const server=createServer(async(req,res)=>{
 requests.push(req.url);const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 try{
  if(req.url==='/bundle.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(bundle.outputFiles[0].text);return;}
  if(req.url==='/style.css'){res.writeHead(200,{'content-type':'text/css'});res.end(css+'\nhtml,body{margin:0;font-family:Arial}#app{height:94vh}button{font:inherit}');return;}
  if(req.url.startsWith('/images/')){const asset=adapter.asset(req.url.split('/').at(-1));assert(asset);res.writeHead(200,{'content-type':asset.mime});res.end(asset.bytes);return;}
  if(req.url.includes('/view')){json(adapter.view());return;}
  if(req.url.includes('/actions/')&&req.method==='GET'){const saved=receipts.get(req.url.split('/').at(-1));json(saved?{state:'COMMITTED',result:saved}:{state:'NOT_FOUND'});return;}
  if(req.url.endsWith('/actions')&&req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
   if(receipts.has(input.actionId)){json(receipts.get(input.actionId));return;}
   assert.equal(input.expectedRevision,adapter.view().card.revision,'real browser client uses current CAS revision');
   const saved=await adapter.execute(input.action);receipts.set(input.actionId,saved);json(saved);return;
  }
  if(req.url==='/'){res.writeHead(200,{'content-type':'text/html'});res.end(html);return;}
  res.writeHead(404);res.end();
 }catch(error){json({error:error.code??'SYNTHETIC_FIXTURE_ERROR'},error.status??500);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\//,route=>{assert.equal(new URL(route.request().url()).origin,origin);return route.continue();});
try{
 await page.goto(origin);await page.waitForFunction(()=>document.querySelectorAll('.fg-handle:enabled').length===8);
 const before=await page.evaluate(()=>window.__view);assert(before.defects.sides.BACK.frame.materialContour);
 const handle=page.getByRole('button',{name:'BACK physical edge Top right',exact:true});await handle.focus();await handle.press('ArrowLeft');
 await page.getByRole('button',{name:'BACK printed border Top left',exact:true}).focus();await page.keyboard.press('ArrowRight');
 await page.getByRole('button',{name:'Approve',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.equal(adapter.actions().filter(a=>a.type==='GEOMETRY_EDIT'&&a.edit.kind==='PHYSICAL').length,1);
 assert.equal(adapter.view().geometry.sides.BACK.prepared,null);assert.equal(await page.evaluate(()=>window.__view.card.revision),adapter.view().card.revision);
 await page.screenshot({path:resolve(output,'retained-adjustment.png')});
 await page.getByRole('button',{name:'Approve',exact:true}).click();await page.waitForFunction(()=>window.__done===true,{},{timeout:45000});
 const saved=adapter.view();assert.deepEqual(adapter.actions().map(a=>a.type),['GEOMETRY_EDIT','PREPARE_SIDE','GEOMETRY_EDIT']);
 assert(saved.defects.sides.BACK.frame.materialContour);assert.equal(saved.defects.sides.BACK.frame.frameId,saved.geometry.sides.BACK.prepared.frame.id);
 assert.equal(saved.defects.sides.BACK.pending,null);assert.equal(saved.defects.sides.BACK.measurement.receipt.version,'atlas-manual-cpu-measurement-v1');
 assert.equal(saved.geometry.sides.BACK.physical.quad[1].x,before.geometry.sides.BACK.physical.quad[1].x-1/1600);
 assert.deepEqual(errors,[]);await page.screenshot({path:resolve(output,'recovered-save.png')});
 const proof={status:'LOCAL_CLEAN_GEOMETRY_SAVE_RECOVERY_PASS',checks:['actual keyboard adjustment','compact physical save retained across failed preparation','same local draft retries without duplicate physical edit','native RGBA preparation and contour-aware defect reprojection','real CPU remeasurement','printed source points saved after new transform','no final approval','loopback traffic only'],actions:adapter.actions().map(a=>a.type),requests,errors,finalRevision:saved.card.revision};
 await writeFile(resolve(output,'result.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}finally{await browser.close();await new Promise(r=>server.close(r));}
