import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Synthetic loopback regression for the real React hook, including slow image
// responses and expiring transport URLs. No card data or external API is used.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(root, 'packages/atlas-manual-workspace/package.json'));
const { build } = require('esbuild');
const engines = createRequire(join(resolve(process.argv[2]), 'fixture.cjs'))('playwright');
const engine = process.argv[4] ?? 'chromium'; assert(['chromium', 'webkit'].includes(engine));
const output = resolve(process.argv[3]); mkdirSync(output, { recursive: true });
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const sharp = createRequire(join(root, 'frontend/atlas-app/package.json'))('sharp');
const alternate = await sharp({ create: { width: 1, height: 1, channels: 4, background: '#ffd466' } }).png().toBuffer();
const descriptor = buffer => ({ sha256: createHash('sha256').update(buffer).digest('hex'), byteCount: buffer.length });
const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {useVerifiedImage} from './src/verified-image.mjs';
const primary=${JSON.stringify(descriptor(bytes))},alternate=${JSON.stringify(descriptor(alternate))};
function Image({descriptor,scope}){const view=useVerifiedImage(descriptor,{cacheScope:scope});window.__view=view;return <section><p role="status">{view.loading?'Loading':view.error?.code??'Ready'}</p>{view.url&&<img src={view.url} alt="Synthetic verified photo"/>}<button onClick={view.retry}>Retry photo</button></section>;}
function App(){const [value,setValue]=useState({url:'/primary?grant=1',...primary}),[scope,setScope]=useState('card-one'),[visible,setVisible]=useState(true);window.__set=(kind,url)=>setValue({...kind==='alternate'?alternate:primary,url});window.__scope=setScope;window.__visible=setVisible;return visible?<Image descriptor={value} scope={scope}/>:null;}
createRoot(document.getElementById('app')).render(<App/>);`;
const bundle = await build({ stdin: { contents: source, resolveDir: join(root, 'packages/atlas-manual-workspace'), loader: 'jsx' }, bundle: true, write: false, platform: 'browser', format: 'esm', define: { 'process.env.NODE_ENV': '"production"' } });
const requests = []; let failNext = false;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (['/primary', '/alternate', '/retry'].includes(path)) {
    requests.push(request.url);
    if (path === '/retry' && failNext) { failNext = false; response.writeHead(503); response.end(); return; }
    const payload = path === '/alternate' ? alternate : bytes;
    response.setHeader('content-type', 'image/png'); response.setHeader('content-length', payload.length);
    const timer = setTimeout(() => response.end(payload), path === '/primary' ? 900 : 30);
    response.on('close', () => clearTimeout(timer));
  } else if (path === '/bundle.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].text); }
  else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><div id="app"></div><script type="module" src="/bundle.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await engines[engine].launch({ ...(engine === 'chromium' ? { channel: 'chrome' } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin); return route.continue(); });
try {
  await page.goto(origin); await page.waitForFunction(() => window.__view?.loading);
  for (let index = 2; index < 5; index++) { await page.evaluate(index => window.__set('primary', '/primary?grant=' + index), index); await page.waitForTimeout(120); }
  await page.waitForFunction(() => Boolean(window.__view?.url));
  assert.deepEqual(requests, ['/primary?grant=1']);
  const originalUrl = await page.evaluate(() => window.__view.url);
  await page.evaluate(() => window.__set('alternate', '/alternate')); await page.waitForFunction(url => window.__view?.url && window.__view.url !== url, originalUrl);
  await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1);
  await page.evaluate(() => window.__set('primary', '/primary?grant=5')); await page.waitForFunction(url => window.__view?.url === url, originalUrl);
  assert.deepEqual(requests, ['/primary?grant=1', '/alternate']);
  await page.evaluate(() => window.__scope('card-two')); await page.waitForFunction(url => window.__view?.url && window.__view.url !== url, originalUrl);
  assert.equal(requests.length, 3);
  failNext = true; await page.evaluate(() => { window.__scope('retry-card'); window.__set('primary', '/retry'); });
  await page.waitForFunction(() => window.__view?.error?.code === 'VERIFIED_IMAGE_UNAVAILABLE');
  await page.getByRole('button', { name: 'Retry photo' }).click(); await page.waitForFunction(() => Boolean(window.__view?.url));
  assert.equal(requests.filter(path => path === '/retry').length, 2);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, 'verified-image-hook-mobile.png') });
  writeFileSync(join(output, 'result.json'), JSON.stringify({ pass: true, engine, requests, checks: ['slow same-content URL renewal completes one transfer', 'original/straightened return reuses verified blob', 'card scope change clears previous verified images', 'failed saved image download can retry', 'zero page errors'] }, null, 2));
  console.log('Verified image browser checks passed');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
