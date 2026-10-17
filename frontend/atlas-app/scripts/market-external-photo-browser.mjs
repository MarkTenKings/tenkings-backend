/** Production CSP + actual picker, with locally fulfilled external image bytes.
 * No provider requests, real sales, production authentication or mutations. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { staffContentSecurityPolicy } from '../lib/content-security.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),app=resolve(root,'frontend/atlas-app');
const require=createRequire(resolve(root,'packages/atlas-manual-workspace/package.json'));
const {build}=require('esbuild'),{chromium}=require('playwright');
const output=process.env.ATLAS_BROWSER_EVIDENCE;
assert(output,'ATLAS_BROWSER_EVIDENCE must name an isolated evidence directory');
await mkdir(output,{recursive:true});
const sharp=createRequire(resolve(app,'package.json'))('sharp');
const photo=await sharp({create:{width:160,height:240,channels:3,background:'#cda955'}}).png().toBuffer();
const imageUrl='https://i.ebayimg.com/images/g/atlas-local-csp-fixture/s-l1600.png';
const deniedUrl='https://i.ebayimg.com.unapproved.example/atlas-local-csp-fixture.png';
const sale={id:'synthetic-sale',title:'Synthetic sold listing',imageUrl,listingUrl:null,soldAt:'2026-10-15T00:00:00Z',priceMinor:null,currency:null,priceBasis:'unknown',raw:true};
const candidates=[{sale,match:'UNKNOWN',requiresReview:true,slabReading:{sha256:null}}];
const sources={
 pending:{state:'SEARCHING',stage:'READING_PHOTOS',refreshable:false,retrieved:{query:'Synthetic query',retrievedAt:'2026-10-16T00:00:00Z',candidates}},
 fallback:{state:'READY',previewId:'synthetic-preview',preview:{version:'atlas-market-preview-v2',query:'Synthetic query',atlasGrade:9,retrievedAt:'2026-10-16T00:00:00Z',candidates,counts:{returned:1,raw:1}}},
};
const source=`import React from 'react';import{createRoot}from'react-dom/client';import MarketReferencePicker from './components/MarketReferencePicker.jsx';
const state=new URL(location.href).searchParams.get('state'),sources=${JSON.stringify(sources)};
const forbidden=()=>{throw new Error('No search or save is permitted in this fixture')};
createRoot(document.getElementById('app')).render(<main><p>LOCAL CSP FIXTURE · synthetic sale and solid-color image</p><MarketReferencePicker scopeKey="csp-fixture" cardId="synthetic-card" available savedSource={sources[state]} onPreview={forbidden} onSave={forbidden}/><img src=${JSON.stringify(deniedUrl)} alt="Unapproved host control"/></main>);`;
const bundle=await build({logLevel:'error',stdin:{contents:source,resolveDir:app,sourcefile:'market-external-photo-fixture.jsx',loader:'jsx'},bundle:true,write:false,outdir:'/fixture',format:'esm',platform:'browser',target:'chrome120',define:{'process.env.NODE_ENV':'"production"'}});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server=createServer((req,res)=>{
 if(req.url==='/bundle.js'||req.url==='/style.css'){res.setHeader('content-type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(req.url.endsWith('.js')?js:css);return;}
 const url=new URL(req.url,'http://fixture.invalid');
 if(url.pathname!=='/'){res.writeHead(404);res.end();return;}
 const policy=staffContentSecurityPolicy();
 // Reproduce the diagnosed policy as a negative control against the same UI.
 res.setHeader('content-security-policy',url.searchParams.has('legacy')?policy.replace(' https://i.ebayimg.com',''):policy);
 res.setHeader('content-type','text/html');
 res.end('<!doctype html><title>Market external photograph CSP fixture</title><link rel="stylesheet" href="/style.css"><div id="app"></div><script type="module" src="/bundle.js"></script>');
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];
try{
 for(const state of ['pending','fallback'])for(const legacy of [true,false]){
  const context=await browser.newContext(),page=await context.newPage(),requests=[],errors=[];
  await context.addInitScript(()=>{window.cspViolations=[];document.addEventListener('securitypolicyviolation',event=>window.cspViolations.push({directive:event.effectiveDirective,blockedURI:event.blockedURI}));});
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const url=route.request().url();
   if(new URL(url).origin===origin){assert.equal(route.request().method(),'GET');await route.continue();return;}
   requests.push(url);
   assert.equal(url,imageUrl,'No unapproved external request may reach the network boundary');
   await route.fulfill({status:200,contentType:'image/png',body:photo});
  });
  await page.goto(`${origin}/?state=${state}${legacy?'&legacy=1':''}`);
  const image=page.getByRole('img',{name:/^(Saved sold listing|Sold card) photograph/});
  await image.waitFor();await image.scrollIntoViewIfNeeded();
  const facts=await image.evaluate(async image=>{let decoded=true;try{await image.decode();}catch{decoded=false;}return{src:image.src,decoded,width:image.naturalWidth,height:image.naturalHeight};});
  assert.equal(facts.src,imageUrl);assert.equal(facts.decoded,!legacy);
  assert.equal(facts.width>0,!legacy);assert.equal(facts.height>0,!legacy);
  const blocked=page.getByRole('img',{name:'Unapproved host control'});
  assert.equal(await blocked.evaluate(async image=>{try{await image.decode();return true;}catch{return false;}}),false);
  const violations=await page.evaluate(()=>window.cspViolations);
  assert(violations.some(value=>value.directive==='img-src'&&value.blockedURI===deniedUrl));
  assert.equal(violations.some(value=>value.directive==='img-src'&&value.blockedURI===imageUrl),legacy);
  assert.equal(requests.filter(url=>url===imageUrl).length,legacy?0:1);
  if(!legacy){
   const link=page.getByRole('link',{name:/Enlarge photo/});
   assert.equal(await link.getAttribute('href'),imageUrl);
   assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
   const popupPromise=context.waitForEvent('page');await link.click();const popup=await popupPromise;
   await popup.waitForLoadState();assert.equal(popup.url(),imageUrl);
   assert.equal(await popup.locator('img').evaluate(async image=>{await image.decode();return image.naturalWidth>0&&image.naturalHeight>0;}),true);
   assert.equal(requests.length,2);await popup.close();
   await page.screenshot({path:resolve(output,`${state}-external-photo.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  assert.equal(await page.getByRole('checkbox').count(),state==='pending'?0:1);
  if(state==='fallback')assert.equal(await page.getByRole('checkbox').isChecked(),false);
  checks.push({state,legacy,photo:facts,violations,externalRequestsLocallyFulfilled:requests.length,enlargementDecoded:!legacy});
  await context.close();
 }
 await writeFile(resolve(output,'result.json'),JSON.stringify({pass:true,actual:['MarketReferencePicker','staffContentSecurityPolicy','browser CSP enforcement'],externalNetworkRequests:0,searches:0,saves:0,excluded:['production authentication','real provider photo delivery'],checks},null,2)+'\n');
 console.log('External market photographs passed: pending/fallback thumbnails and enlargement decode; old policy and unapproved hosts remain blocked. Zero provider requests or writes.');
}finally{await browser.close();await new Promise(done=>server.close(done));}
