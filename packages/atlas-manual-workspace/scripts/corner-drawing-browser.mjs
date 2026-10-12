/** Real Chrome/React pointer proof against the shipped editor, entirely local. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {workspace} from '../test/defect-fixtures.mjs';
import {encodeSpeedsterTraceRleV1} from '@atlas/grading-core/trace-codec';
import {decodeSpeedsterTraceBitmapWireV1} from '@atlas/grading-core/trace-bitmap-wire';
const root=fileURLToPath(new URL('../../../',import.meta.url)),output=process.env.ATLAS_BROWSER_EVIDENCE;
assert(output,'Set task-owned ATLAS_BROWSER_EVIDENCE');await mkdir(output,{recursive:true});
const sharp=createRequire(resolve(root,'frontend/atlas-app/package.json'))('sharp');
const png=await sharp({create:{width:1350,height:1858,channels:3,background:'#baa784'}}).png().toBuffer(),sha=createHash('sha256').update(png).digest('hex');
const state=structuredClone(workspace()),points=[[10,10],[1259,10],[1259,1767],[10,1767]],pixels=new Uint8Array(1270*1778);
for(const[x,y]of points)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)pixels[(y+dy)*1270+x+dx]=1;
for(const side of ['FRONT','BACK']){state.sides[side].frame.inspectionImageSha256=sha;state.sides[side].cornerShape='ROUNDED_3_18_MM';const finding=state.sides[side].findings[0];finding.detectorMask=encodeSpeedsterTraceRleV1(pixels);Object.assign(finding.measurement,{pixelCount:100,areaMm2:.25,weightedAreaMm2:.25,zonePercent:.25/5015.55*100});}
const image={inspection:{url:'/card.png',sha256:sha,byteCount:png.length}};
const source=`import React from'react';import{createRoot}from'react-dom/client';import{DefectReviewWorkspace}from'./src/DefectReviewWorkspace.jsx';const root=createRoot(document.getElementById('app'));let generation=0;window.render=side=>{window.saved=null;root.render(<DefectReviewWorkspace key={++generation} workspace={${JSON.stringify(state)}} images={${JSON.stringify({FRONT:image,BACK:image})}} side={side} onEdit={async edit=>{window.saved=edit;}}/>);};window.render('FRONT');`;
const bundle=await build({stdin:{contents:source,resolveDir:resolve(root,'packages/atlas-manual-workspace'),loader:'jsx'},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'}});
const css=await readFile(resolve(root,'packages/atlas-manual-workspace/src/defects.css'),'utf8');
const server=createServer((q,r)=>{if(q.url==='/card.png'){r.setHeader('content-type','image/png');r.end(png);}else if(q.url==='/bundle.js'){r.setHeader('content-type','text/javascript');r.end(bundle.outputFiles[0].text);}else{r.setHeader('content-type','text/html');r.end('<!doctype html><style>'+css+'html,body,#app{height:100%;margin:0}.ad-workspace{height:100%;padding:12px;box-sizing:border-box}</style><div id="app"></div><script type="module" src="/bundle.js"></script>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));await page.route(/^https?:\/\//,route=>{assert.equal(new URL(route.request().url()).origin,origin);return route.continue();});
try{await page.goto(origin);
 for(const side of ['FRONT','BACK'])for(const zoom of [1,2,4])for(let corner=0;corner<4;corner++){
  await page.evaluate(s=>window.render(s),side);await page.getByRole('button',{name:'Add finding',exact:true}).waitFor();await page.getByRole('button',{name:'Add finding',exact:true}).click();
  assert.equal(await page.locator('.ad-trace-hit').count(),0,'Existing invisible halo must be absent during editing');
  const point=async()=>page.locator('.ad-plane').first().evaluate((element,[x,y])=>{const r=element.getBoundingClientRect();return{x:r.x+(40+x)/1350*r.width,y:r.y+(40+y)/1858*r.height};},points[corner]);
  let at=await point();if(zoom>1){await page.mouse.move(at.x,at.y);await page.mouse.wheel(0,-Math.log(zoom)/.002);await page.waitForFunction(z=>Number(document.querySelector('.ad-photo-controls output').textContent.replace('×',''))===z,zoom);at=await point();}
  await page.mouse.move(at.x,at.y);await page.mouse.down();await page.mouse.up();await page.getByRole('button',{name:'Save trace',exact:true}).click();
  await page.waitForFunction(()=>window.saved!==null);const saved=await page.evaluate(()=>window.saved),trace=decodeSpeedsterTraceBitmapWireV1(saved.action.trace.traceWire);
  assert(trace.some(Boolean));assert(trace[points[corner][1]*1270+points[corner][0]],'Raw extreme-corner point must survive');
  checks.push({side,zoom,corner,pixels:trace.reduce((n,v)=>n+v,0),sha:saved.action.trace.traceProvenance.finalTraceSha256});
 }
 assert.deepEqual(errors,[]);for(let corner=0;corner<4;corner++)for(const side of ['FRONT','BACK'])assert.equal(new Set(checks.filter(c=>c.side===side&&c.corner===corner).map(c=>c.sha)).size,1,'Brush pixels are zoom independent');
 await page.screenshot({path:resolve(output,'corner-editor.png')});await writeFile(resolve(output,'corner-drawing-result.json'),JSON.stringify({pass:true,fixture:'Synthetic original; no model, account or approval',checks,errors},null,2));console.log('24 real Chrome corner gestures passed at 1×, 2× and 4× on both sides.');
}catch(error){console.error(JSON.stringify({errors,body:await page.locator('body').innerText()}));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
