import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, basename } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url)), repo = resolve(root, '../..');
const output = process.env.ATLAS_BROWSER_EVIDENCE;
assert(output?.startsWith('/'), 'Set ATLAS_BROWSER_EVIDENCE to an absolute output directory'); await mkdir(output, { recursive: true });
const fixtures = JSON.parse(await readFile(resolve(repo, 'docs/atlas/design/first-look/reports/approved.json'))).reports;
const derivativeDir = process.env.ATLAS_PRESENTATION_FIXTURE_DIR;
let manifest = null;
if (derivativeDir) manifest = JSON.parse(await readFile(resolve(derivativeDir, 'manifest.json')));
const assets = new Map(), reports = {};
for (const entry of fixtures) {
  const images = {};
  for (const side of ['FRONT', 'BACK']) {
    const url = `/${entry.key}/${side}.webp`, bytes = await readFile(resolve(repo, 'docs/atlas/design/first-look/reports', `${entry.key}-${side.toLowerCase()}.webp`));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.packet.images[side].sha256);
    assets.set(url, { bytes, type: 'image/webp' });
    images[side] = { inspection: { ...entry.packet.images[side], url } };
    if (entry.key === 'maye' && manifest) {
      const d = manifest[side], bytes = await readFile(resolve(derivativeDir, `maye-${side.toLowerCase()}-openai.png`));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), d.sha256);
      const url = `/api/reports/${entry.packet.publicToken}/presentation/${side}?v=${entry.packet.approvalVersion}&sha=${d.sha256}`;
      assets.set(url, { bytes, type: 'image/png', derivative: true });
      images[side].presentation = { ...d, url, publicToken: entry.packet.publicToken, publicHash: entry.publicHash, approvalVersion: entry.packet.approvalVersion,
        contentType: 'image/png', byteCount: bytes.length };
    }
  }
  reports[entry.key] = { report: entry.packet.report, explanation: entry.explanation, geometry: entry.packet.geometry, images,
    publication: { reportNumber: entry.packet.reportNumber, version: entry.packet.approvalVersion, approvedAt: entry.packet.approvedAt, reportHash: entry.publicHash, url: entry.source } };
}
const contents = `import React from 'react';import {createRoot} from 'react-dom/client';import {ApprovedReportView} from './src/FinalReportReview.jsx';const reports=${JSON.stringify(reports)};const key=new URL(location.href).searchParams.get('card')||'maye';const props=reports[key];window.fixture=props;createRoot(document.getElementById('app')).render(<ApprovedReportView {...props}/>);`;
const bundle = await build({ stdin: { contents, loader: 'jsx', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } });
let requests = [], failedDerivative = false;
const server = createServer(async (req, res) => {
  requests.push({ url: req.url, at: Date.now() });
  const asset = assets.get(req.url);
  if (asset) { if (asset.derivative && failedDerivative) { res.writeHead(503); res.end(); return; } res.setHeader('Content-Type', asset.type); res.setHeader('Content-Length', asset.bytes.length); res.end(asset.bytes); return; }
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  if (/^\/[a-z-]+\.css$/.test(req.url)) { try { res.setHeader('Content-Type', 'text/css'); res.end(await readFile(resolve(root, 'src', basename(req.url)))); return; } catch {} }
  if (req.url.startsWith('/brand/')) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/report-review.css"><style>body{margin:0;background:white}#app{max-width:1440px;margin:auto;padding:0 24px}@media(max-width:600px){#app{padding:0 12px}}</style></head><body><div id="app"></div><script type="module" src="/bundle.js"></script></body></html>');
});
await new Promise(resolve => server.listen(process.env.ATLAS_PREVIEW_PORT || 0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--serve')) { console.log(JSON.stringify({ preview: origin, decorativeFixtures: Boolean(manifest) })); }
else {
  const browser = await chromium.launch({ headless: true, channel: process.env.ATLAS_CHROMIUM_CHANNEL || 'chrome' });
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin); return route.continue(); });
    const ready = async key => { await page.goto(`${origin}/?card=${key}`); await page.locator('.rr-approved-whole').waitFor(); };
    await ready('maye');
    assert.equal(await page.locator('.rr-public-sections button').count(), 8);
    if (manifest) await page.getByRole('button', { name: 'Original photo', exact: true }).waitFor({ state: 'visible' });
    if (manifest) await page.waitForFunction(() => !document.querySelector('.rr-approved-whole .actions button').disabled);
    const measure = () => page.locator('.rr-approved-whole .breathing-trace').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
    if (await page.getByRole('button', { name: 'Ⅱ Pause', exact: true }).count()) await page.getByRole('button', { name: 'Ⅱ Pause', exact: true }).click();
    const paused = await measure(); await page.waitForTimeout(120); assert.deepEqual(await measure(), paused);
    await page.screenshot({ path: resolve(output, 'desktop-whole.png'), fullPage: false });
    assert.equal(await page.locator('.rr-approved-whole .fc-label').count(), 7);
    const expected = await page.locator('.rr-approved-whole .fc-label').first().getAttribute('data-finding-id');
    await page.locator('.rr-approved-whole .fc-label').first().click();
    await page.waitForFunction(() => document.querySelector('.rr-public-explorer').dataset.section === 'finding');
    assert.equal(await page.getByLabel('All findings', { exact: true }).inputValue(), expected);
    assert.equal(await page.locator('.rr-public-viewers:not([hidden]) image').count(), 0, 'no generated image in inspection');
    assert.equal(await page.locator('.rr-clean-viewport img').getAttribute('src'), await page.locator('.rr-image-side:not([hidden]) .rr-viewport').first().locator('img[alt*="saved inspection"]').getAttribute('src'));
    await page.screenshot({ path: resolve(output, 'original-measurements.png'), fullPage: false });
    for (const name of ['Whole card', 'Centering', 'Corners', 'Edges', 'Surface', 'ATLAS Card fingerprint', 'Grade science']) {
      await page.getByRole('button', { name, exact: true }).click();
      assert.equal(await page.locator('.rr-public-sections button[aria-pressed=true]').count(), 1);
    }
    await page.getByRole('button', { name: 'Whole card', exact: true }).click();
    if (await page.getByRole('button', { name: 'Ⅱ Pause', exact: true }).count()) await page.getByRole('button', { name: 'Ⅱ Pause', exact: true }).click();
    const color = await page.locator('.rr-approved-whole .axis-core').first().evaluate(node => getComputedStyle(node).stroke);
    const grid = await page.locator('.rr-approved-whole .defect-grid-line').first().evaluate(node => getComputedStyle(node).stroke);
    assert.equal(color, 'rgb(121, 255, 59)'); assert.equal(grid, color);
    results.push({ scenario: 'desktop', tabs: 8, findings: 7, pause: true, exactOriginalDetail: true, centeringAndGrid: color });
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await page.waitForFunction(() => document.querySelector('.rr-approved-whole').dataset.compact === 'true');
      assert.equal(await page.locator('.rr-approved-whole .study-card').count(), 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
      await page.screenshot({ path: resolve(output, `whole-${width}.png`), fullPage: false });
      results.push({ scenario: `width-${width}`, overflow, cards: 1 });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.getByRole('button', { name: 'Motion reduced', exact: true }).isDisabled(), true);
    const reduced = await measure(); await page.waitForTimeout(100); assert.deepEqual(await measure(), reduced);
    results.push({ scenario: 'reduced-motion', static: true });
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.setViewportSize({ width: 1440, height: 1000 });
    await ready('abomasnow'); assert.equal(await page.locator('.rr-approved-whole .fc-label').count(), 13); assert.equal(await page.locator('.finding-callouts-flow').count(), 1);
    results.push({ scenario: 'many-findings', findings: 13, flowingLabels: true });
    await ready('dart'); assert.equal(await page.locator('.rr-approved-whole .fc-label').count(), 0); results.push({ scenario: 'zero-findings', findings: 0 });
    if (manifest) { failedDerivative = true; requests = []; await ready('maye'); await page.waitForTimeout(200); assert.equal(await page.getByRole('button', { name: 'Original photo', exact: true }).isDisabled(), true); assert.equal(await page.locator('.rr-approved-whole image').count(), 2); results.push({ scenario: 'derivative-failure', originalFallback: true }); }
    assert.deepEqual(errors, []);
    await writeFile(resolve(output, 'result.json'), JSON.stringify({ pass: true, origin, decorativeFixtures: Boolean(manifest), results, errors }, null, 2));
    console.log(JSON.stringify({ pass: true, output, results }));
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
