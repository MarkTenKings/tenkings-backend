/** Actual v2 market components against a visibly synthetic loopback saved fixture.
 * No production authentication, provider request, or real sale is represented. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), app = resolve(root, 'frontend/atlas-app');
const require = createRequire(resolve(root, 'packages/atlas-manual-workspace/package.json'));
const { build } = require('esbuild'), { chromium } = require('playwright');
const output = process.env.ATLAS_BROWSER_EVIDENCE;
assert(output, 'ATLAS_BROWSER_EVIDENCE must name an isolated evidence directory');
await mkdir(output, { recursive: true });
const cardId = randomUUID(), staffId = randomUUID(), approvalActionId = randomUUID(), previewId = randomUUID();
const approved = JSON.parse(await readFile(resolve(root, 'docs/atlas/design/first-look/reports/approved.json'), 'utf8')).reports.find(value => value.key === 'abomasnow');
const identity = approved.packet.report.identity, photo = await readFile(resolve(root, 'docs/atlas/design/first-look/reports/abomasnow-front.webp'));
const photoSha = createHash('sha256').update(photo).digest('hex');
const base = `/admin/api/staff/manual-connected/cards/${cardId}/presentation`;
const imagePath = `${base}/market?preview=${previewId}&image=${photoSha}`;
const specimen = (i, extra) => ({ sale: { id: `atlas-sale:${i}`, title: `Abomasnow · Synthetic sale fixture ${i}`,
  listingUrl: null, imageUrl: null, grader: 'SGC', grade: '10', soldAt: `2026-10-0${9-i}T00:00:00.000Z`,
  priceMinor: null, currency: null, priceBasis: 'unknown', identityStatus: 'MATCH',
  labelText: 'SYNTHETIC LABEL FIXTURE\n2022 ABOMASNOW\nASTRAL RADIANCE TG01/TG30 Holo', ...extra },
  match: i === 1 ? 'UNKNOWN' : 'MATCH', requiresReview: true,
  slabReading: { sha256: photoSha, imageUrl: 'https://i.ebayimg.com/fixture-unused.webp' } });
const candidates = [specimen(0, { listingUrl: 'https://www.ebay.com/itm/123456789000', priceBasis: 'sold', priceMinor: 4250, currency: 'USD' }),
  specimen(1, { grader: 'Grading company unread', grade: '9.5', identityStatus: 'UNKNOWN', labelText: 'SYNTHETIC LABEL FIXTURE\n2022 ABOMASNOW\nTG01/TG30 C.Holo' }),
  specimen(2, { grader: 'Other Company', grade: '9', priceBasis: 'accepted_offer_unknown', reportedPrice: '40.00', currency: 'EUR' })];
const preview = { version: 'atlas-market-preview-v2', responsePolicy: 'ATLAS_SLAB_V1',
  query: '2022 Astral Radiance Trainer Gallery Abomasnow TG01/TG30 grade 10', atlasGrade: approved.packet.report.finalGrade,
  retrievedAt: '2026-10-10T02:00:00.000Z', binding: { approvalVersion: 1 }, candidates,
  counts: { returned: 7, missingImage: 1, unreadGrade: 1, differentIdentity: 1, outsideGrade: 1, shown: 3 } };
let state = 'READY', revision = 0, published = [], failSelectionOnce = false;
const posts = [], checks = [], receipts = new Map(), imageReads = [];
const marketSearch = () => ({ state, previewId, approvalActionId, refreshable: state === 'READY', ...(state === 'READY' ? { preview } : {}) });
const source = `import React from 'react';import{createRoot}from'react-dom/client';import ReportMarketPicker from './components/ReportMarketPicker.jsx';
const fixture=${JSON.stringify({ cardId, staffId, approvalActionId, identity })};
createRoot(document.getElementById('app')).render(<main><aside>LOCAL V2 INTERACTION FIXTURE · Synthetic sales and label readings · The unchanged approved card photograph demonstrates image rendering; it is not a sale or slab photograph.</aside><ReportMarketPicker cardId={fixture.cardId} staffId={fixture.staffId} approvalActionId={fixture.approvalActionId} available csrf="loopback-fixture" pollIntervalMs={100} pickerOptions={{card:fixture.identity,cardImage:<figure><img src="/card.webp" alt="Abomasnow · retained approved front photograph"/></figure>}}/></main>);`;
const bundle = await build({ logLevel: 'error', stdin: { contents: source, resolveDir: app, sourcefile: 'market-slab-display-fixture.jsx', loader: 'jsx' }, bundle: true, write: false, outdir: '/fixture', format: 'esm', platform: 'browser', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' } });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text + '\n*{box-sizing:border-box}body{margin:0;background:#f5f5f3;font-family:Arial,sans-serif}main{max-width:1120px;margin:32px auto;padding:0 24px 36px}aside{font-size:11px;letter-spacing:.03em;color:#59564e;line-height:1.6}@media(max-width:700px){main{padding:0 12px 24px;margin:18px auto}}';
const server = createServer(async (req, res) => {
  const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>ATLAS v2 market fixture qualification</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script type="module" src="/bundle.js"></script>'); return; }
  if (req.url === '/bundle.js' || req.url === '/style.css') { res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(req.url.endsWith('.js') ? js : css); return; }
  if (req.url === '/card.webp') { res.setHeader('content-type', 'image/webp'); res.end(photo); return; }
  if (req.url?.startsWith(base) && req.headers.cookie !== 'atlas-fixture=authorized') { json({ error: 'SIGN_IN_REQUIRED' }, 401); return; }
  if (req.url === imagePath && req.method === 'GET') {
    imageReads.push({ path: req.url, sha256: photoSha });
    res.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }); res.end(photo); return;
  }
  if (req.url === base && req.method === 'GET') { json({ approvalActionId, revision, presentation: published.length ? { market: { sales: published.map(id => ({ id })) } } : null, marketSearch: marketSearch() }); return; }
  if (req.url === `${base}/market/select` && req.method === 'POST') {
    let data = ''; for await (const chunk of req) data += chunk;
    const body = JSON.parse(data); posts.push({ kind: 'selection', body });
    assert.equal(body.previewId, previewId); assert.equal(body.approvalActionId, approvalActionId);
    assert.equal(req.headers['x-atlas-csrf'], 'loopback-fixture');
    if (!receipts.has(body.requestId)) { published = body.selectedIds; revision++; receipts.set(body.requestId, { approvalActionId, revision, presentation: { market: { sales: published.map(id => ({ id })) } } }); }
    if (failSelectionOnce) { failSelectionOnce = false; json({ error: 'TEMPORARILY_UNAVAILABLE' }, 503); return; }
    json(receipts.get(body.requestId)); return;
  }
  if (req.url === `${base}/market/search` && req.method === 'POST') { posts.push({ kind: 'search' }); json({ error: 'SEARCH_FORBIDDEN_IN_FIXTURE' }, 503); return; }
  json({ error: 'NOT_FOUND' }, 404);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['tablet', { width: 1024, height: 768 }], ['phone', { width: 390, height: 844 }], ['narrow', { width: 320, height: 740 }]]) {
    state = 'READY'; revision = 0; published = []; posts.length = 0; receipts.clear(); imageReads.length = 0;
    const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [];
    await context.addCookies([{ name: 'atlas-fixture', value: 'authorized', url: origin }]);
    page.on('pageerror', error => errors.push(error.message));
    await context.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin, 'No external provider or image request'); return route.continue(); });
    await page.goto(origin); await page.getByRole('tab', { name: /Recent graded/ }).waitFor();
    assert.equal(posts.length, 0); assert.equal(await page.getByRole('tab').count(), 1);
    assert.equal(await page.getByRole('checkbox').count(), 3); assert.equal(await page.getByRole('checkbox').first().isChecked(), false);
    assert.equal(await page.getByRole('button', { name: 'Publish references', exact: true }).isDisabled(), true);
    await page.getByText('7 listings returned · 3 comps within one grade point · Most recent first', { exact: true }).waitFor();
    const rows = page.locator('tbody tr'); assert.equal(await rows.count(), 3);
    assert.match(await rows.nth(1).innerText(), /Sold amount unavailable/);
    assert.equal(await rows.nth(1).locator('a[href^="https://www.ebay.com"]').count(), 0);
    assert.match(await rows.nth(2).innerText(), /Accepted offer/);
    assert.equal(await rows.nth(1).locator('p').first().textContent(), candidates[1].sale.labelText);
    const images = page.getByRole('img', { name: /Graded card photograph/ });
    for (let i = 0; i < 3; i++) { await images.nth(i).scrollIntoViewIfNeeded(); await images.nth(i).evaluate(image => image.decode()); }
    assert.equal(await images.count(), 3);
    const imageFacts = await images.evaluateAll(images => images.map(image => ({ src: new URL(image.src).pathname + new URL(image.src).search,
      loaded: image.complete && image.naturalWidth > 0, width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height })));
    assert(imageFacts.every(image => image.src === imagePath && image.loaded && image.width >= 100 && image.height >= 200));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const labels = await rows.locator('p').evaluateAll(nodes => nodes.map(node => ({ whiteSpace: getComputedStyle(node).whiteSpace, font: parseFloat(getComputedStyle(node).fontSize), clipped: node.scrollWidth > node.clientWidth + 1 })));
    assert(labels.every(label => label.whiteSpace === 'pre-wrap' && label.font >= 13 && !label.clipped));
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: resolve(output, `${name}-slab-ready.png`), fullPage: true });
    await rows.nth(1).screenshot({ path: resolve(output, `${name}-unknown-sale-detail.png`) });
    const read = await context.request.get(origin + imagePath); assert.equal(read.status(), 200);
    assert.equal(createHash('sha256').update(await read.body()).digest('hex'), photoSha);
    await page.reload(); await page.getByRole('tab', { name: /Recent graded/ }).waitFor(); assert.equal(posts.length, 0);
    await page.getByRole('checkbox').nth(1).check();
    await page.getByText('1 selected across all groups', { exact: true }).waitFor();
    failSelectionOnce = true; await page.getByRole('button', { name: 'Publish references', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'The result is not confirmed yet' }).waitFor();
    assert.equal(posts.length, 1); assert.deepEqual(posts[0].body.selectedIds, ['atlas-sale:1']);
    await page.reload(); await page.getByRole('button', { name: 'Resume saved selection', exact: true }).click();
    await page.getByText('Sales references published.', { exact: true }).waitFor();
    assert.equal(posts.length, 2); assert.deepEqual(posts[0], posts[1]); assert.equal(receipts.size, 1);
    await page.reload(); await page.getByRole('tab', { name: /Recent graded/ }).waitFor(); assert.equal(posts.length, 2);
    assert.equal(posts.filter(post => post.kind === 'search').length, 0); assert.deepEqual(errors, []);
    checks.push({ name, viewport, noOverflow: true, literalMultilineLabel: true, nullableLink: true, unknownPrice: true,
      imageFacts, exactPhotoSha256: photoSha, imageGetCount: imageReads.length, searchPosts: 0,
      selectionAttempts: posts.length, uniqueSelectionReceipts: receipts.size, sameRequestRecoveredAfterReload: true, errors });
    await context.close();
  }
  const unauthorized = await browser.newContext();
  assert.equal((await unauthorized.request.get(origin + imagePath)).status(), 401); await unauthorized.close();
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ pass: true, syntheticSalesAndLabels: true,
    approvedPhotographUnchanged: true, photographSha256: photoSha, actual: ['MarketReferencePicker', 'ReportMarketPicker', 'report-market-client', 'market CSS'],
    excluded: ['production authentication', 'real sold listing photograph', 'real provider/OCR execution', 'physical phone performance'],
    providerCalls: 0, checks }, null, 2) + '\n');
  console.log('V2 market browser fixture passed at 1440/1024/390/320px: retained images, literal labels, unknown price, explicit selection/recovery, zero searches.');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
