import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Real React lifecycle/StrictMode, real SHA-256 and Blob decoding. The only
// network permitted is this task-owned loopback server with synthetic pixels.
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url);
const { build } = require('esbuild');
const engines = process.env.ATLAS_BROWSER_RUNTIME ? createRequire(process.env.ATLAS_BROWSER_RUNTIME)('playwright') : require('playwright');
const output = process.env.ATLAS_BROWSER_EVIDENCE;
assert(output?.startsWith('/'), 'Set absolute ATLAS_BROWSER_EVIDENCE'); await mkdir(output, { recursive: true });
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const descriptor = { url: '/image?grant=1', sha256: createHash('sha256').update(bytes).digest('hex'), byteCount: bytes.length, width: 1, height: 1 };
const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {useVerifiedImage} from './src/verified-image.mjs';
import {VerifiedImageCacheBoundary,clearVerifiedImageAccess} from './src/VerifiedImageCacheBoundary.jsx';
const original=${JSON.stringify(descriptor)};window.views={};window.revoke=clearVerifiedImageAccess;
function Photo({id,descriptor}){const view=useVerifiedImage(descriptor);window.views[id]=view;return <section><span>{view.loading?'Loading':view.error?.code??'Ready'}</span>{view.url&&<img src={view.url} alt={id}/>}</section>;}
function App(){const[scope,setScope]=useState('staff-a'),[stage,setStage]=useState(0),[both,setBoth]=useState(true),[value,setValue]=useState(original);window.scope=setScope;window.stage=setStage;window.both=setBoth;window.renew=url=>setValue({...original,url});return <VerifiedImageCacheBoundary scope={scope}><main><h1>Synthetic review cache proof</h1><Photo key={'left'+stage} id="left" descriptor={value}/>{both&&<Photo key={'right'+stage} id="right" descriptor={value}/>}</main></VerifiedImageCacheBoundary>;}createRoot(document.getElementById('app')).render(<React.StrictMode><App/></React.StrictMode>);`;
const bundle = await build({ stdin: { contents: source, resolveDir: root, loader: 'jsx' }, bundle: true, write: false,
  format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' } });
let requests = [];
const server = createServer((request, response) => {
  if (request.url.startsWith('/image')) {
    requests.push(request.url); response.setHeader('Content-Type', 'image/png'); response.setHeader('Content-Length', bytes.length);
    const timer = setTimeout(() => response.end(bytes), 400); response.on('close', () => clearTimeout(timer));
  } else if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents); }
  else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/bundle.js"></script>'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, results = [];
try {
  for (const engine of ['chromium', 'webkit']) {
    const browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' ? { channel: 'chrome' } : {}) });
    try {
      const page = await browser.newPage({ viewport: engine === 'webkit' ? { width: 390, height: 844 } : { width: 1280, height: 800 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin); return route.continue(); });
      requests = [];
      await page.goto(origin); await page.waitForFunction(() => window.views.left?.loading);
      await page.evaluate(() => window.renew('/image?grant=2'));
      await page.waitForFunction(() => document.querySelectorAll('img').length === 2 && [...document.querySelectorAll('img')].every(image => image.naturalWidth === 1));
      assert.equal(requests.length, 1, 'StrictMode, paired panes and renewed grant share one transfer');
      const before = await page.evaluate(() => window.views.left.url);
      const began = Date.now(); await page.evaluate(() => window.stage(1));
      await page.waitForFunction(url => window.views.left?.url === url && window.views.right?.url === url, before);
      const cachedSwitchMs = Date.now() - began; assert(cachedSwitchMs < 250); assert.equal(requests.length, 1);
      await page.evaluate(() => window.both(false));
      assert.equal(await page.locator('img').count(), 1); assert.equal(await page.locator('img').evaluate(image => image.naturalWidth), 1);
      await page.evaluate(() => window.scope('staff-b'));
      await page.waitForFunction(url => window.views.left?.url && window.views.left.url !== url, before);
      assert.equal(requests.length, 2, 'different authority receives a fresh verified asset');
      await page.evaluate(() => window.revoke()); await page.waitForFunction(() => !window.views.left?.url && !window.views.left?.loading);
      assert.equal(await page.locator('img').count(), 0);
      await page.evaluate(() => { window.stage(2); window.renew('/image?grant=3'); });
      await page.waitForTimeout(100); assert.equal(requests.length, 2, 'revocation prevents remount from using a still-live signed URL');
      await page.evaluate(() => window.scope('staff-c')); await page.waitForFunction(() => Boolean(window.views.left?.url));
      assert.equal(requests.length, 3);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
      await page.waitForFunction(() => !window.views.left?.url && !window.views.left?.loading);
      assert.equal(await page.locator('img').count(), 0, 'persisted pagehide drops authenticated image bytes');
      await Promise.all([
        page.waitForEvent('load'),
        page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))),
      ]);
      await page.waitForFunction(() => Boolean(window.views.left?.url));
      assert.equal(requests.length, 4, 'persisted restore reloads and obtains fresh evidence');
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `${engine}-verified-cache.png`) });
      results.push({ engine, cachedSwitchMs, imageRequests: requests.length, errors, checks: [
        'StrictMode paired views issue one exact-byte transfer', 'URL renewal does not restart transfer',
        'editor remount reuses verified Blob', 'one pane unmount preserves sibling',
        'authority change re-verifies bytes', 'revocation blocks signed URL reuse', 'new boundary can acquire fresh evidence',
        'simulated persisted page transition clears bytes and reloads on restore',
      ] });
      await page.close();
    } finally { await browser.close(); }
  }
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ pass: true, results }, null, 2));
  console.log(JSON.stringify({ pass: true, results }));
} finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
