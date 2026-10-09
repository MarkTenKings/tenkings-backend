/** Actual display components and market client against loopback saved state.
 * Synthetic sales are visibly labelled; no provider or production call occurs. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), app = resolve(root, 'frontend/atlas-app');
const require = createRequire(resolve(root, 'packages/atlas-manual-workspace/package.json'));
const { build } = require('esbuild'), { chromium } = require('playwright');
const output = process.env.ATLAS_BROWSER_EVIDENCE;
if (!output) throw Error('ATLAS_BROWSER_EVIDENCE must name an isolated evidence directory');
await mkdir(output, { recursive: true });
const cardId = randomUUID(), staffId = randomUUID(), approvalActionId = randomUUID(), previewId = randomUUID();
const approved = JSON.parse(await readFile(resolve(root, 'docs/atlas/design/first-look/reports/approved.json'), 'utf8')).reports.find(value => value.key === 'abomasnow');
const identity = approved.packet.report.identity, photo = await readFile(resolve(root, 'docs/atlas/design/first-look/reports/abomasnow-front.webp'));
const specimen = (id, extra = {}) => ({ sale: { id: String(id), title: `${identity.cardName} ${identity.productSet} ${identity.cardNumber} · Synthetic sale fixture ${id}`,
  listingUrl: `https://www.ebay.com/itm/${123456789000 + id}`, grader: 'PSA', grade: '10', soldAt: '2026-10-08T00:00:00.000Z', priceMinor: 4250, currency: 'USD', priceBasis: 'sold',
  language: 'English', printing: null, variant: 'Finish unspecified', identityStatus: 'UNKNOWN', ...extra }, match: 'UNKNOWN', matchReason: 'Synthetic fixture. Confirm unspecified printing and finish from the listing before publishing.', requiresReview: true });
const candidates = [specimen(1, { raw: true, grader: null, grade: null, rawCondition: 'Near mint', priceMinor: 225 }),
  specimen(2), specimen(3, { soldAt: '2026-10-04T00:00:00.000Z', priceMinor: 4000 }),
  specimen(4, { grader: 'BGS', designation: 'BLACK_LABEL', priceMinor: 15200 }),
  specimen(5, { grader: 'CGC', designation: 'PRISTINE', priceMinor: 6500 }),
  specimen(6, { grader: 'BGS', designation: null, priceMinor: 5100 }),
  specimen(7, { grader: 'BGS', designation: 'STANDARD', priceMinor: 5000 }),
  specimen(8, { grader: 'CGC', designation: 'STANDARD', priceMinor: 3950 }),
  specimen(9, { grade: '9', priceMinor: 2150 }), specimen(10, { grade: '9', language: 'Japanese', priceMinor: 1900 }),
  specimen(11, { grade: '8', priceMinor: 1250 })];
const preview = { query: [identity.year, identity.cardName, identity.productSet, identity.cardNumber].join(' '), atlasGrade: approved.packet.report.finalGrade,
  retrievedAt: '2026-10-09T02:00:00.000Z', binding: { approvalVersion: 1 }, candidates, excluded: { undisclosedOrUnsupported: 2, contradictory: 3 } };
let state = 'QUEUED', revision = 0, published = [], failSelectionOnce = false, empty = false; const posts = [], checks = [], receipts = new Map();
const marketSearch = () => ({ state, previewId, approvalActionId, refreshable: ['READY', 'FAILED', 'UNAVAILABLE'].includes(state),
  ...(state === 'READY' ? { preview: { ...preview, candidates: empty ? [] : candidates } } : {}), ...(state === 'UNKNOWN' ? { reason: 'PROVIDER_OUTCOME_UNKNOWN' } : {}) });
const source = `import React from 'react';import{createRoot}from'react-dom/client';import ReportMarketPicker from './components/ReportMarketPicker.jsx';import{ReportMarketAndDealers}from '../../packages/atlas-manual-workspace/src/ReportPresentation.jsx';
const publicView=location.pathname==='/public';const fixtures=${JSON.stringify({ cardId, staffId, approvalActionId, identity, candidates, preview })};
createRoot(document.getElementById('app')).render(<main><aside>LOCAL INTERACTION FIXTURE · Synthetic sale records · Existing approved card photograph</aside>{publicView?<div className="rr-report rr-platinum"><ReportMarketAndDealers presentation={{market:{observedAt:fixtures.preview.retrievedAt,sales:fixtures.candidates.map(value=>value.sale)}}}/></div>:<ReportMarketPicker cardId={fixtures.cardId} staffId={fixtures.staffId} approvalActionId={fixtures.approvalActionId} available pollIntervalMs={100} pickerOptions={{card:fixtures.identity,cardImage:<figure><img src="/card.webp" alt="Abomasnow · retained approved front photograph"/></figure>}}/>}</main>);`;
const bundle = await build({ logLevel: 'error', stdin: { contents: source, resolveDir: app, sourcefile: 'market-display-fixture.jsx', loader: 'jsx' }, bundle: true, write: false, outdir: '/fixture', format: 'esm', platform: 'browser', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = await readFile(resolve(root, 'packages/atlas-manual-workspace/src/report-review.css'), 'utf8') + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css')).text + '\n*{box-sizing:border-box}body{margin:0;background:#f5f5f3;font-family:Arial,sans-serif}main{max-width:1120px;margin:32px auto;padding:0 24px 36px}aside{font-size:10px;letter-spacing:.08em;color:#767369;line-height:1.6}.rr-report{margin-top:24px;background:white}@media(max-width:700px){main{padding:0 12px 24px;margin:18px auto}}';
const server = createServer(async (req, res) => {
  const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (['/', '/public'].includes(req.url)) { res.setHeader('content-type','text/html'); res.end('<!doctype html><title>ATLAS market display qualification</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script type="module" src="/bundle.js"></script>'); return; }
  if (req.url === '/card.webp') { res.setHeader('content-type', 'image/webp'); res.end(photo); return; }
  if (req.url === '/bundle.js' || req.url === '/style.css') { res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(req.url.endsWith('.js') ? js : css); return; }
  const base = `/admin/api/staff/manual-connected/cards/${cardId}/presentation`;
  if (req.url === base && req.method === 'GET') { json({ approvalActionId, revision, presentation: published.length ? { market: { sales: published.map(id => ({ id })) } } : null, marketSearch: marketSearch() }); return; }
  if (req.url === `${base}/market/select` && req.method === 'POST') {
    let data = ''; for await (const chunk of req) data += chunk;
    const body = JSON.parse(data); posts.push({ kind: 'selection', body });
    assert.equal(body.previewId, previewId); assert.equal(body.approvalActionId, approvalActionId);
    if (!receipts.has(body.requestId)) { published = body.selectedIds; revision++; receipts.set(body.requestId, { approvalActionId, revision, presentation: { market: { sales: published.map(id => ({ id })) } } }); }
    if (failSelectionOnce) { failSelectionOnce = false; json({ error: 'TEMPORARILY_UNAVAILABLE' }, 503); return; }
    json(receipts.get(body.requestId)); return;
  }
  if (req.url === `${base}/market/search` && req.method === 'POST') { let data = ''; for await (const chunk of req) data += chunk; posts.push({ kind: 'search', body: JSON.parse(data) }); json({ ...marketSearch(), state: 'QUEUED' }); return; }
  json({ error: 'NOT_FOUND' }, 404);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [name, viewport] of [['desktop',{width:1440,height:900}], ['tablet',{width:1024,height:768}], ['phone',{width:390,height:844}], ['narrow',{width:320,height:740}]]) {
    state = 'QUEUED'; revision = 0; published = []; posts.length = 0; receipts.clear(); empty = false;
    const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin, 'No external provider or listing request'); return route.continue(); });
    await page.goto(origin); await page.getByRole('status').filter({ hasText: 'Sold comps queued' }).waitFor();
    assert.equal(posts.length, 0); assert.equal(await page.getByRole('button', { name: 'Find sold cards', exact: true }).isDisabled(), true);
    state = 'SEARCHING'; await page.getByRole('status').filter({ hasText: 'Searching sold listings' }).waitFor();
    state = 'READY'; await page.getByRole('tab', { name: /Ungraded/ }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 10); assert.equal(await page.getByRole('checkbox').first().isChecked(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('tab').first().focus(); await page.keyboard.press('ArrowRight');
    assert.match(await page.getByRole('tab', { selected: true }).innerText(), /PSA 10/);
    assert.equal(await page.getByRole('row').count(), 3); assert.match(await page.getByRole('row').nth(1).innerText(), /fixture 2/);
    assert.equal(await page.getByRole('tab', { selected: true }).evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    await page.screenshot({ path: resolve(output, `${name}-staff-ready.png`), fullPage: true });
    await page.getByRole('checkbox').first().check(); await page.getByRole('tab', { name: /BGS 10 Black Label/ }).click();
    await page.getByRole('checkbox').first().check(); await page.getByText('2 selected across all groups', { exact: true }).waitFor();
    failSelectionOnce = true; await page.getByRole('button', { name: 'Publish references', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'The result is not confirmed yet' }).waitFor();
    assert.equal(posts.length, 1); assert.equal(receipts.size, 1);
    await page.reload(); await page.getByRole('button', { name: 'Resume saved selection', exact: true }).click();
    await page.getByText('Sales references published.', { exact: true }).waitFor();
    assert.equal(posts.length, 2); assert.deepEqual(posts[0].body, posts[1].body); assert.equal(receipts.size, 1);
    await page.reload(); await page.getByRole('tab', { name: /Ungraded/ }).waitFor(); assert.equal(posts.length, 2);
    state = 'UNKNOWN'; await page.reload(); await page.getByRole('button', { name: 'Check saved search', exact: true }).click(); assert.equal(posts.length, 2);
    state = 'READY'; empty = true; await page.reload(); await page.getByText('No qualifying sold listings', { exact: true }).waitFor(); assert.equal(await page.getByRole('tab').count(), 0);
    await page.screenshot({ path: resolve(output, `${name}-empty.png`), fullPage: true });
    empty = false; await page.goto(`${origin}/public`); await page.getByRole('tab', { name: /Ungraded/ }).waitFor();
    await page.getByRole('tab', { name: /CGC 10 Pristine/ }).click(); assert.equal(await page.getByRole('row').count(), 2);
    assert.equal(await page.getByRole('tab', { selected: true }).evaluate(el => getComputedStyle(el).color), 'rgb(255, 255, 255)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: resolve(output, `${name}-public-ready.png`), fullPage: true });
    assert.deepEqual(errors, []); checks.push({ name, viewport, exactGroups: 10, noOverflow: true, keyboardFocus: true, paidSearches: 0, selectionAttempts: posts.length, uniquePublicationReceipts: receipts.size, reloadRecovery: true, errors });
    await context.close();
  }
  const fresh = await browser.newContext(), page = await fresh.newPage(); state = 'READY'; empty = false;
  const before = posts.length; await page.goto(origin); await page.getByRole('tab', { name: /Ungraded/ }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.length), 0); assert.equal(posts.length, before); await fresh.close();
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ pass: true, syntheticSales: true, preservedApprovedPhoto: true, actual: ['MarketReferencePicker', 'ReportMarketPicker', 'report-market-client', 'ReportMarketAndDealers', 'market CSS'], excluded: ['production authentication', 'real SoldComps execution', 'physical phone performance'], freshSessionSavedResult: true, checks }, null, 2));
  console.log('Market display browser qualification passed at1440/1024/390/320px, including exact saved selection recovery and zero provider searches.');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
