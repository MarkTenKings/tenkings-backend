/** Actual order desk, operations forms and staff transport against isolated saved
 * fixture records. Sample photos are supplied at runtime, never shipped in app. */
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
const output = process.env.ATLAS_BROWSER_EVIDENCE, reference = process.env.ATLAS_ORDER_DESK_PHOTO_REFERENCE;
if (!output || !reference) throw Error('Provide ATLAS_BROWSER_EVIDENCE and ATLAS_ORDER_DESK_PHOTO_REFERENCE outside the repository.');
await mkdir(output, { recursive: true });
const photoSource = await readFile(reference, 'utf8'), sourceMatch = photoSource.match(/const photos=(\{[^\n]+\});/);
if (!sourceMatch) throw Error('The approved photo reference must contain its sample photo manifest.');
const photos = Object.values(JSON.parse(sourceMatch[1])), staff = { id: randomUUID(), name: 'Fixture reviewer', role: 'REVIEWER', mode: 'LOCAL_FIXTURE', customerOperationsEnabled: true };
const photoBytes = new Map();
const base = '/admin/api/staff/manual-connected/order-desk', posts = [], reads = [], checks = [];
let failAck = false, failPhoto = false, holdQueue = false, heldQueue = [], initialOrders;
const groupStage = { ARRIVAL: 'WAITING_FOR_ARRIVAL', RECEIVED: 'RECEIVED', GRADING_REVIEW: 'HUMAN_REVIEW', FINISHING_PACKING: 'FINISHING', RETURNING: 'RETURNING', COMPLETE: 'COMPLETE' };
const groups = Object.keys(groupStage);
function makeOrder(index, group = groups[index % groups.length]) {
  const id = randomUUID(), cardCount = index === 0 ? 3 : index === 1 ? 2 : 1;
  const cards = Array.from({ length: cardCount }, (_, cardIndex) => {
    const cardId = randomUUID(), photo = photos[(index + cardIndex) % photos.length];
    for (const side of ['FRONT', 'BACK']) { const data = photo[side.toLowerCase()].split(','); photoBytes.set(`${cardId}/${side}`, { type: data[0].slice(5).split(';')[0], bytes: Buffer.from(data[1], 'base64') }); }
    const stage = cardIndex === 1 && index === 2 ? 'GRADING' : groupStage[group], received = group !== 'ARRIVAL';
    return { cardId, identity: { ...photo.identity, title: photo.identity.playerName || photo.identity.cardName }, identitySource: 'CUSTOMER_SUBMISSION', channel: 'MAIL_IN', stage,
      photos: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, { state: index === 5 ? 'UNAVAILABLE' : 'READY', uploadId: randomUUID(), provenance: 'CUSTOMER_SUBMISSION' }])),
      manualCardId: ['ARRIVAL', 'RECEIVED'].includes(group) ? null : randomUUID(), grading: { state: ['FINISHING_PACKING', 'RETURNING', 'COMPLETE'].includes(group) ? 'HUMAN_APPROVED' : group === 'GRADING_REVIEW' ? 'IN_GRADING' : 'NOT_STARTED' },
      finishing: { label: 'NOT_RECORDED', nfc: group === 'FINISHING_PACKING' ? 'VERIFIED' : 'NOT_RECORDED', assembly: 'NOT_RECORDED', welding: 'NOT_RECORDED', packing: 'NOT_RECORDED' },
      events: received ? [{ id: randomUUID(), kind: 'ATLAS_RECEIVED', occurredAt: '2026-10-08T12:00:00Z' }] : [], custodyEvents: [], approvedAt: group === 'FINISHING_PACKING' ? '2026-10-09T10:00:00Z' : null };
  });
  const totalCents = cardCount * 4320, paidAt = new Date(Date.UTC(2026, 9, 9, 12 - index)).toISOString();
  return { id, reference: `ATLAS-FIXTURE-${1010-index}`, paidAt, channel: 'MAIL_IN', customer: { name: `Synthetic customer ${String.fromCharCode(65+index)}`, email: `fixture${index}+desk@example.test`, phone: '+12025550100', returnAddress: { address1: '123 Fixture Street', address2: 'Suite 2', city: 'Example', region: 'CA', postalCode: '90000', country: 'US' } }, cardCount,
    group, stage: groupStage[group], mixedStages: false, stageCounts: { [groupStage[group]]: cardCount },
    acknowledgment: index < 2 ? null : { requestId: randomUUID(), acknowledgedAt: paidAt, acknowledgedBy: { id: staff.id, name: staff.name } },
    gradingPayment: { state: 'PAID', currency: 'USD', totalCents }, shippingPayment: { state: index === 0 ? 'UNQUOTED_UNPAID' : 'PAID' },
    photoCards: cards.map(card => ({ cardId: card.cardId, title: card.identity.title, photos: card.photos })), cards,
    payments: { grading: { state: 'PAID', paidAt, receipt: { currency: 'USD', subtotalCents: cardCount*4000, shippingCents: 0, taxCents: cardCount*320, totalCents, channel: 'MAIL_IN', cards: cards.map(card => ({ cardId: card.cardId, unitCents: 4000, identity: card.identity })), shipping: [], terms: { days: 14, clockStart: 'ATLAS_RECEIVED', paymentFlow: 'GRADING_NOW_SHIPPING_LATER' } } }, shipping: { state: index === 0 ? 'UNQUOTED_UNPAID' : 'PAID', paidAt: index === 0 ? null : paidAt, receipt: index === 0 ? null : { currency: 'USD', subtotalCents: 2000, shippingCents: 2000, taxCents: 160, totalCents: 2160, shipping: [{ leg: 'INBOUND', amountCents: 1000, currency: 'USD', provider: 'ShipStation', carrierName: 'Fixture carrier', serviceName: 'Fixture service' }] } } },
    shipping: { inbound: { state: index === 0 ? 'NOT_PREPARED' : 'SUCCEEDED', artifactState: index === 0 ? 'NOT_PREPARED' : 'READY', trackingNumber: index === 0 ? null : 'SYNTHETIC-TRACKING' }, return: { state: 'NOT_PREPARED', artifactState: 'NOT_PREPARED', trackingNumber: null, prepared: false, preparedRequestId: null, canPrepare: group === 'FINISHING_PACKING' } },
    history: [{ id: randomUUID(), kind: 'PAYMENT_CONFIRMED', occurredAt: paidAt, recordedAt: paidAt, cardId: null, actor: null, note: 'Synthetic fixture payment only.' }], manualCards: [] };
}
let orders = Array.from({ length: 6 }, (_, index) => makeOrder(index)); initialOrders = structuredClone(orders);
const globalStyles = [ './styles/global.css', './styles/grading.css', '@atlas/report-view/styles.css', '@atlas/manual-workspace/styles.css', '@atlas/manual-workspace/focused-geometry.css', '@atlas/manual-workspace/defects.css', './styles/manual.css', './styles/atlas-brand.css', './styles/atlas-theme.css', '@atlas/manual-workspace/report-review.css' ];
const source = `${globalStyles.map(path => `import '${path}';`).join('')}import React from 'react';import{createRoot}from'react-dom/client';import{Operations}from './components/CustomerOperations.jsx';createRoot(document.getElementById('app')).render(<Operations staff={${JSON.stringify(staff)}}/>);`;
const bundle = await build({ logLevel: 'error', stdin: { contents: source, resolveDir: app, sourcefile: 'order-desk-fixture.jsx', loader: 'jsx' }, bundle: true, jsx: 'automatic', write: false, outdir: '/fixture', format: 'esm', platform: 'browser', target: 'chrome120', define: { 'process.env.NODE_ENV': '\"production\"', 'process.env': '{}' }, external: ['/admin/brand/*'], plugins: [{ name: 'isolated-next-runtime', setup(build) {
  build.onResolve({ filter: /^next\/(link|head|router)$/ }, args => ({ path: args.path, namespace: 'fixture-next' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture-next' }, args => ({ contents: args.path === 'next/link' ? `export default function Link({href,children,...props}){return <a href={href}{...props}>{children}</a>}` : args.path === 'next/head' ? `export default function Head(){return null}` : `export function useRouter(){return {pathname:'/customer-operations',query:{}}}`, loader: 'jsx', resolveDir: app }));
} }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1'), json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.url === '/') { res.setHeader('content-type','text/html'); res.end('<!doctype html><title>ATLAS order desk qualification</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="app"></div><script type="module" src="/bundle.js"></script>'); return; }
  if (/^\/admin\/brand\/(atlas-grading-logo\.png|fonts\/original-[1-4]\.woff2)$/.test(url.pathname)) { const path = resolve(app, 'public', url.pathname.slice('/admin/'.length)); res.setHeader('content-type', path.endsWith('.png') ? 'image/png' : 'font/woff2'); res.end(await readFile(path)); return; }
  if (req.url === '/bundle.js' || req.url === '/style.css') { res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(req.url.endsWith('.js') ? js : css); return; }
  if (url.pathname === '/admin/api/staff/session') { json({ staff, csrf: 'fixture-csrf' }); return; }
  if (url.pathname === '/admin/api/staff/manual-connected/dealer-operations') { json({ orders: orders.map(order => ({ ...order, returnShipping: order.shipping.return })), locations: [], memberships: [], manualCards: [] }); return; }
  if (url.pathname === base) {
    reads.push(req.url);
    const q = (url.searchParams.get('q') ?? '').toLowerCase(), stage = url.searchParams.get('stage'), view = url.searchParams.get('view'), limit = Number(url.searchParams.get('limit') ?? 30), cursor = url.searchParams.get('cursor');
    const matched = orders.filter(order => `${order.reference} ${order.customer.name} ${order.customer.email}`.toLowerCase().includes(q));
    let rows = matched.filter(order => (!stage || order.group === stage) && (view !== 'new' || !order.acknowledgment));
    const start = cursor ? rows.findIndex(order => order.id === cursor) + 1 : 0, page = rows.slice(start, start + limit);
    const result = { schemaVersion: 1, orders: page, counts: { all: matched.length, new: matched.filter(order => !order.acknowledgment).length, groups: Object.fromEntries(groups.map(group => [group, matched.filter(order => order.group === group).length])), stages: {} }, nextCursor: rows.length > start + limit ? page.at(-1).id : null };
    if (holdQueue) { heldQueue.push(() => json(result)); return; } json(result); return;
  }
  const photoMatch = url.pathname.match(/\/cards\/([^/]+)\/photos\/(FRONT|BACK)$/);
  if (photoMatch) { const photo = photoBytes.get(`${photoMatch[1]}/${photoMatch[2]}`); if (!photo) { json({ error: 'ORDER_PHOTO_UNAVAILABLE' }, 404); return; } if (failPhoto && photoMatch[2] === 'BACK' && url.searchParams.get('size') === 'detail') { failPhoto = false; json({ error: 'ORDER_PHOTO_UNAVAILABLE' }, 503); return; } res.setHeader('content-type', photo.type); res.setHeader('cache-control', 'no-store'); res.end(photo.bytes); return; }
  const detail = url.pathname.match(/\/orders\/([^/]+)(?:\/(acknowledge|labels\/INBOUND))?$/);
  if (detail) {
    const order = orders.find(order => order.id === detail[1]); if (!order) { json({ error: 'ORDER_NOT_FOUND' }, 404); return; }
    if (detail[2] === 'acknowledge' && req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw); posts.push({ orderId: order.id, body: input }); assert.equal(req.headers['x-atlas-csrf'], 'fixture-csrf');
      const outcome = order.acknowledgment ? 'ALREADY_ACKNOWLEDGED' : 'ACKNOWLEDGED';
      if (!order.acknowledgment) order.acknowledgment = { requestId: input.requestId, acknowledgedAt: new Date().toISOString(), acknowledgedBy: { id: staff.id, name: staff.name } };
      if (failAck) { failAck = false; json({ error: 'OUTCOME_UNKNOWN' }, 503); return; }
      json({ orderId: order.id, requestId: input.requestId, outcome, acknowledgment: order.acknowledgment }); return;
    }
    if (detail[2] === 'labels/INBOUND') { const bytes = Buffer.from('%PDF-1.7\nSynthetic fixture inbound label\n%%EOF'); res.writeHead(200, { 'content-type': 'application/pdf', 'x-atlas-label-sha256': createHash('sha256').update(bytes).digest('hex') }); res.end(bytes); return; }
    json({ schemaVersion: 1, order }); return;
  }
  json({ error: 'NOT_FOUND' }, 404);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.env.ATLAS_BROWSER_SERVE === '1') { console.log(JSON.stringify({ origin, actual: 'Shell, AtlasBrand, global app styles, OrderDesk, Operations, custody forms, staff transport', syntheticOrders: true, samplePhotos: true })); }
else {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const [name, viewport] of [['desktop',{width:1440,height:900}], ['tablet',{width:1024,height:768}], ['phone',{width:390,height:844}], ['narrow',{width:320,height:740}]]) {
      orders = structuredClone(initialOrders); posts.length = 0; failPhoto = true;
      const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error('Fixture browser error:', error.message); });
      await context.route(/^https?:\/\//, route => { assert.equal(new URL(route.request().url()).origin, origin); return route.continue(); });
      await page.goto(origin); await page.getByRole('button', { name: /ATLAS-FIXTURE-1010/ }).waitFor();
      assert.equal(posts.length, 0); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const shellStyles = await page.evaluate(() => { const shell = document.querySelector('.mc-shell'), header = document.querySelector('.mc-shell-header'), title = document.querySelector('h1'), search = document.querySelector('input[type=search]'); return { shell: getComputedStyle(shell).backgroundColor, header: getComputedStyle(header).backgroundColor, title: getComputedStyle(title).color, search: getComputedStyle(search).backgroundColor }; });
      assert.deepEqual(shellStyles, { shell: 'rgb(255, 255, 255)', header: 'rgb(255, 255, 255)', title: 'rgb(32, 36, 44)', search: 'rgb(255, 255, 255)' });
      await page.getByRole('navigation', { name: 'Staff workspace' }).getByRole('link', { name: 'Order desk', exact: true }).waitFor();
      await page.screenshot({ path: resolve(output, `${name}-queue.png`), fullPage: true });
      await page.getByRole('button', { name: /ATLAS-FIXTURE-1010/ }).click();
      const inspector = page.getByRole('article', { name: 'Order ATLAS-FIXTURE-1010' });
      await inspector.getByRole('heading', { name: 'Customer card photographs' }).waitFor();
      await inspector.getByRole('button', { name: /Retry back customer/ }).first().click();
      await inspector.getByRole('button', { name: /Enlarge back customer/ }).first().waitFor();
      assert.equal(await inspector.getByText('$129.60', { exact: true }).isVisible(), false);
      await inspector.getByRole('button', { name: /Enlarge front customer/ }).first().click();
      await inspector.getByRole('button', { name: '← Front & back photographs' }).click();
      await inspector.getByText('Record an actual custody event', { exact: true }).first().click();
      const evidence = inspector.getByLabel('Physical evidence reference').first(); await evidence.fill('Unsaved fixture note');
      if (viewport.width < 701) await page.getByRole('button', { name: '← Back to orders' }).click();
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      if (viewport.width < 701) await page.getByRole('button', { name: /ATLAS-FIXTURE-1010/ }).click();
      assert.equal(await evidence.inputValue(), 'Unsaved fixture note');
      if (viewport.width > 700) {
        await page.getByRole('navigation', { name: 'Filter by recorded card stage' }).getByRole('button', { name: /Received/ }).click();
        await page.getByText('The selected order is kept open outside this queue view.', { exact: true }).waitFor();
        assert.equal(await evidence.inputValue(), 'Unsaved fixture note');
        await page.getByRole('button', { name: 'All stages', exact: true }).click();
      }
      await inspector.getByRole('button', { name: 'Payment', exact: true }).click(); await inspector.getByText('$129.60', { exact: true }).waitFor();
      await inspector.getByRole('button', { name: 'Contact & shipping', exact: true }).click(); await inspector.getByText('123 Fixture Street', { exact: true }).waitFor();
      await inspector.getByRole('button', { name: 'Cards & work', exact: true }).click();
      await inspector.getByText('Record an actual custody event', { exact: true }).first().click();
      await page.screenshot({ path: resolve(output, `${name}-detail.png`), fullPage: true });
      failAck = true; await inspector.getByRole('button', { name: 'Acknowledge order', exact: true }).click();
      await page.getByRole('button', { name: 'Check saved acknowledgment', exact: true }).waitFor(); assert.equal(posts.length, 1);
      await page.reload(); await page.getByRole('button', { name: 'Check saved acknowledgment', exact: true }).click();
      await page.getByText('The team acknowledgment is confirmed in the saved order.', { exact: true }).waitFor(); assert.equal(posts.length, 1);
      if (viewport.width < 701) await page.getByRole('button', { name: /ATLAS-FIXTURE-1010/ }).click();
      await page.getByText(/Acknowledged by Fixture reviewer/).first().waitFor();
      if (viewport.width < 701) await page.getByRole('button', { name: '← Back to orders' }).click();
      await page.getByRole('button', { name: /ATLAS-FIXTURE-1009/ }).click();
      const shippingOrder = page.getByRole('article', { name: 'Order ATLAS-FIXTURE-1009' });
      await shippingOrder.getByRole('button', { name: 'Contact & shipping', exact: true }).click();
      const download = page.waitForEvent('download');
      await shippingOrder.getByRole('button', { name: 'Download customer-to-ATLAS label', exact: true }).click();
      assert.equal((await download).suggestedFilename(), 'ATLAS-FIXTURE-1009-customer-to-atlas.pdf');
      if (viewport.width < 701) await page.getByRole('button', { name: '← Back to orders' }).click();
      await page.getByRole('button', { name: /ATLAS-FIXTURE-1007/ }).click();
      const approvedOrder = page.getByRole('article', { name: 'Order ATLAS-FIXTURE-1007' });
      await approvedOrder.getByText('Record an actual custody event', { exact: true }).click();
      assert.equal(await approvedOrder.getByRole('combobox').first().locator('option[value="MAIL_DISPATCHED"]').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('navigation', { name: 'Customer operations sections' }).getByRole('button', { name: 'Kiosk setup', exact: true }).click();
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.mc-shell')).backgroundColor), 'rgb(8, 9, 7)');
      await page.getByRole('navigation', { name: 'Customer operations sections' }).getByRole('button', { name: 'Order desk', exact: true }).click();
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.mc-shell')).backgroundColor), 'rgb(255, 255, 255)');
      assert.deepEqual(errors, []); checks.push({ name, viewport, actualShell: true, fullGlobalAppStyles: true, lightShellOnlyOrdersTab: true, noOverflow: true, explicitAcknowledgmentOnly: true, lostReplyRecoveredWithoutRepeat: true, photoExpansion: true, explicitFailedPhotoRetry: true, formPreservedOnRead: true, contactStreet: true, inboundPdfDownload: true, approvedCustodyObjectAdapted: true, moneyOnlyPaymentTab: true, errors });
      await context.close();
    }
    await writeFile(resolve(output, 'result.json'), JSON.stringify({ pass: true, actual: ['Shell','AtlasBrand','global app styles','OrderDesk','Operations','CustodyCard','ReturnShippingLabel','staffClientRequest'], syntheticOrderRecords: true, suppliedRealSamplePhotos: true, productionSession: false, physicalPhonePerformance: false, checks }, null, 2));
    console.log(`Order desk browser checks passed. Evidence: ${output}`);
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
}
