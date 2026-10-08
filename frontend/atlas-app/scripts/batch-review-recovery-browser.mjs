/** Actual batch entry UI and durable manual client; loopback synthetic persistence.
 * This proves desktop/mobile recovery controls, not optical grading or staff auth. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), app = resolve(root, 'frontend/atlas-app');
const require = createRequire(resolve(root, 'packages/atlas-manual-workspace/package.json'));
const { build } = require('esbuild'), { chromium } = require('playwright');
const output = process.env.ATLAS_BROWSER_EVIDENCE;
if (!output) throw Error('ATLAS_BROWSER_EVIDENCE must name an isolated evidence directory');
await mkdir(output, { recursive: true });
const job = { key: 'a'.repeat(64), cardId: 'b51f7e20-43bf-4c76-aee2-652fd79c3638', state: 'REVIEW', revision: 10, evidence: { name: 'Synthetic retained card', proposedGrade: 8 } };
const packet = { key: job.key, cardId: job.cardId, reportHash: 'b'.repeat(64), resumeAvailable: true, canCertify: true };
let accepted = false, allow = false, journaled = null; const posts = [], checks = [];
const stubs = {
  'next/router': `const router={query:{tab:'REVIEW'},pathname:'/batch',replace(){},push(url){window.__navigation=url;}}; export const useRouter=()=>router;`,
  'next/link': `import React from 'react';export default function Link(props){return <a {...props}/>;}`,
  './Shell': `import React from 'react';export default function Shell({children}){return <div className="mc-shell">{children}</div>;}`,
  './BatchImport': 'export default function BatchImport(){return null;}',
  './ManualCards': `import React,{useEffect} from 'react';export function ManualWorkspace({onBusyChange}){useEffect(()=>onBusyChange?.(false),[onBusyChange]);return <p role="status">Saved review ready</p>;}`,
  './ManualFinishing': 'export default function ManualFinishing(){return null;}export const openManualLabelPrintWindow=()=>{throw Error("Approval is outside this fixture");};',
  '@atlas/manual-workspace/report-review': `import React,{useEffect} from 'react';export function MachineReportReview({children,onReadyChange}){useEffect(()=>onReadyChange(true),[onReadyChange]);return <section aria-label="Retained synthetic report"><h2>Synthetic retained card</h2><p>Existing inspection and report retained</p>{children}</section>;}`,
  '@atlas/manual-workspace/image-cache': 'export const usePrefetchVerifiedImages=()=>{};',
};
const source = `import React from 'react';import{createRoot}from'react-dom/client';import BatchGrading from './components/BatchGrading.jsx';createRoot(document.getElementById('app')).render(<BatchGrading staff={{id:'fixture-reviewer',role:'REVIEWER'}}/>);`;
const bundle = await build({ logLevel: 'error', stdin: { contents: source, resolveDir: app, sourcefile: 'batch-recovery.jsx', loader: 'jsx' }, bundle: true, write: false, outdir: '/fixture', format: 'esm', platform: 'browser', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'synthetic-inspector', setup(b) { b.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : null); b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'jsx', resolveDir: app })); } }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = (await Promise.all(['global.css','manual.css','atlas-brand.css','atlas-theme.css'].map(file => readFile(resolve(app, 'styles', file), 'utf8')))).join('\n') + bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const server = createServer(async (req, res) => {
  const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.url === '/') { res.setHeader('content-type','text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script type="module" src="/bundle.js"></script>'); return; }
  if (req.url === '/bundle.js' || req.url === '/style.css') { res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(req.url.endsWith('.js') ? js : css); return; }
  if (req.url === '/admin/api/staff/session') { json({ staff: { id: 'fixture-reviewer' }, csrf: 'fixture' }); return; }
  const base = '/admin/api/staff/manual-connected/cards/batch';
  if (req.url === base) { json({ jobs: [job] }); return; }
  if (req.url === `${base}/${job.key}`) { json(packet); return; }
  if (req.url.endsWith('/thumbnail')) { json({ images: {} }); return; }
  if (req.url.endsWith('/view')) { json({ card: { revision: accepted ? 6 : 5 }, ...(accepted ? { finalReview: { reportHash: packet.reportHash } } : {}) }); return; }
  if (req.url.endsWith('/actions') && req.method === 'POST') {
    let bytes = ''; for await (const chunk of req) bytes += chunk;
    posts.push(bytes); journaled ??= bytes; assert.equal(bytes, journaled);
    if (!allow) { json({ error: 'MANUAL_TEMPORARILY_UNAVAILABLE' }, 503); return; }
    accepted = true; json({ card: { revision: 6 } }); return;
  }
  if (/\/actions\/[^/]+$/.test(req.url)) { json({ state: accepted ? 'COMMITTED' : 'NOT_FOUND' }); return; }
  json({ error: 'NOT_FOUND' }, 404);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [name, viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}],['narrow',{width:320,height:740}]]) {
    accepted = false; allow = false; journaled = null; posts.length = 0;
    const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin); return route.continue(); });
    await page.goto(origin); await page.getByRole('button', { name: 'Start rapid review →', exact: true }).click();
    const retry = page.getByRole('button', { name: 'Retry opening review', exact: true }); await retry.waitFor();
    assert.equal(posts.length, 2, 'Initial uncertain dispatch and its exact recovery attempt');
    assert.equal(await page.getByRole('region', { name: 'Retained synthetic report' }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await retry.scrollIntoViewIfNeeded(); const box = await retry.boundingBox(); assert(box.width >= 44 && box.height >= 44);
    await page.screenshot({ path: resolve(output, `${name}-retained-error.png`), fullPage: true });
    allow = true; await retry.click(); await page.getByRole('status').filter({ hasText: 'Saved review ready' }).waitFor();
    assert.equal(posts.length, 3); assert(posts.every(value => value === posts[0]));
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('atlas-manual-pending:'))), false);
    assert.equal(await page.getByRole('dialog').count(), 1); await page.getByRole('button', { name: 'Exit review ×', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
    checks.push({ name, viewport, exactPayloadAttempts: posts.length, oneCommittedSyntheticAction: accepted, retryTarget: { width: box.width, height: box.height }, noOverflow: true, errors });
    await context.close();
  }
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ pass: true, syntheticPersistence: true, actual: ['BatchGrading JSX/styles','manual workflow journal client','modal lifecycle'], excluded: ['production authentication','full inspector optical evidence','real phone performance'], checks }, null, 2));
  console.log('Batch review recovery browser checks passed at 1440, 390 and 320 pixels.');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
