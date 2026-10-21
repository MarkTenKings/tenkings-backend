/** Actual staff archive + transport, served only on loopback with read-only
 * synthetic records. Photograph/DEMO-label references stay outside the repo. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), app = resolve(root, 'frontend/atlas-app');
const require = createRequire(resolve(root, 'packages/atlas-manual-workspace/package.json'));
const { build } = require('esbuild');
// The fixture uses exact, hash-verified copies of already public approved
// photographs. Its card IDs, staff, submissions and event history are synthetic.
const references = process.env.ATLAS_ARCHIVE_APPROVED_REFERENCES;
if (!references) throw Error('Provide ATLAS_ARCHIVE_APPROVED_REFERENCES with an external manifest.json.');
const manifest = JSON.parse(await readFile(resolve(references, 'manifest.json'), 'utf8'));
if (manifest.qualificationOnly !== true || !Array.isArray(manifest.records) || manifest.records.length !== 4) throw Error('Invalid approved reference manifest.');
const samples = await Promise.all(manifest.records.map(async record => {
  const images = {};
  for (const side of ['FRONT', 'BACK']) {
    const descriptor = record.images[side], bytes = await readFile(resolve(references, descriptor.file));
    if (descriptor.mime !== 'image/webp' || descriptor.width !== 1350 || descriptor.height !== 1858
      || descriptor.byteCount !== bytes.length || descriptor.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error('Reference photo changed.');
    images[side] = { descriptor, bytes };
  }
  return { ...record, images };
}));
const staff = { id: randomUUID(), name: 'Fixture reviewer', role: 'REVIEWER', mode: 'LOCAL_FIXTURE', customerOperationsEnabled: true };
const cards = Array.from({ length: 26 }, (_, index) => {
  const sample = index % 4, reference = samples[sample], token = `ar_${String(index).padStart(24, '0')}`, cardId = randomUUID();
  const published = index !== 5;
  return { cardId, identity: reference.identity,
    finalGrade: reference.finalGrade, approvedAt: `2026-10-${String(26 - index).padStart(2, '0')}T12:00:00.000000Z`,
    certificateNumber: `ATLAS-${String(1001 + index).padStart(12, '0')}`, approvalActionId: randomUUID(),
    report: { state: published ? 'PUBLISHED' : 'PENDING', version: 1, path: published ? `/reports/${token}?v=1` : null, publicToken: token, reportHash: 'a'.repeat(64), ...(published ? { publicHash: 'b'.repeat(64) } : {}) },
    approvedSummary: reference.approvedSummary, savedComparables: { state: 'UNAVAILABLE' },
    approver: { id: staff.id, name: 'Fixture approver' }, reviewers: [{ id: staff.id, name: 'Fixture reviewer' }],
    submission: index % 3 === 0 ? { orderId: randomUUID(), cardId: randomUUID(), reference: `SYNTHETIC-ORDER-${index + 1}`, customer: { name: 'Fixture customer' }, channel: index % 2 === 0 ? 'MAIL_IN' : 'KIOSK', dealer: index % 2 ? { name: 'Fixture shop' } : null } : null,
    media: !published ? {} : Object.fromEntries((index === 4 ? ['FRONT'] : ['FRONT', 'BACK']).map(side => [side, { url: `/api/reports/${token}/images/${side}?v=1`, provenance: 'APPROVED_GRADING_PHOTOGRAPH' }])),
    sample };
});
// A clearly synthetic sold-reference case exercises UI without fetching eBay,
// inventing a market estimate, or attaching fixture sales to a real card record.
cards[1].savedComparables = { state: 'SAVED', selection: 'SAVED_REPORT_SELECTION', source: 'EBAY_SOLD_LISTINGS', observedAt: '2026-10-26T12:00:00.000Z', presentationRevision: 1,
  sales: [{ id: 'synthetic-sale', title: 'Synthetic reference · UI qualification only', listingUrl: null, grader: 'PSA', grade: '7', soldAt: '2026-10-20T12:00:00.000Z', priceMinor: 12500, currency: 'USD', priceBasis: 'sold' },
    { id: 'synthetic-unknown-offer', title: 'Synthetic accepted offer · amount unavailable', listingUrl: null, grader: 'PSA', grade: '8', soldAt: '2026-10-19T12:00:00.000Z', priceMinor: null, currency: 'USD', priceBasis: 'accepted_offer_unknown' }] };
const storageOrigin = 'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com';
const globalStyles = ['./styles/global.css', './styles/grading.css', '@atlas/report-view/styles.css', '@atlas/manual-workspace/styles.css', '@atlas/manual-workspace/focused-geometry.css', '@atlas/manual-workspace/defects.css', './styles/manual.css', './styles/atlas-brand.css', './styles/atlas-theme.css', '@atlas/manual-workspace/report-review.css'];
const source = `${globalStyles.map(path => `import '${path}';`).join('')}import React from 'react';import{createRoot}from'react-dom/client';import GradedCards from './components/GradedCards.jsx';import CardHistory from './components/CardHistory.jsx';// Fixture-only adapter: only synthetic grants resolve to loopback; the production parser and byte verifier are unchanged.\nconst fixtureFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);return fixtureFetch(url.origin===${JSON.stringify(storageOrigin)}&&/^\\/atlas-detail-fixture\\/[a-f0-9-]+\\/(FRONT|BACK)$/.test(url.pathname)?'/fixture-storage'+url.pathname:input,options)};const id=/^\\/admin\\/graded-cards\\/([a-f0-9-]+)$/.exec(location.pathname)?.[1];createRoot(document.getElementById('app')).render(id?<CardHistory staff={${JSON.stringify(staff)}} cardId={id}/>:<GradedCards staff={${JSON.stringify(staff)}}/>);`;
const bundle = await build({ logLevel: 'error', stdin: { contents: source, resolveDir: app, sourcefile: 'graded-cards-fixture.jsx', loader: 'jsx' }, bundle: true, jsx: 'automatic', write: false, outdir: '/fixture', format: 'esm', platform: 'browser', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, external: ['/admin/brand/*'], plugins: [{ name: 'isolated-next-runtime', setup(build) {
  build.onResolve({ filter: /^next\/(link|head|router)$/ }, args => ({ path: args.path, namespace: 'fixture-next' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture-next' }, args => ({ contents: args.path === 'next/link' ? `export default function Link({href,children,...props}){return <a href={'/admin'+href}{...props}>{children}</a>}` : args.path === 'next/head' ? `export default function Head(){return null}` : `export function useRouter(){return {pathname:'/graded-cards',query:{}}}`, loader: 'jsx', resolveDir: app }));
} }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text, css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
let failure = null, hold = false, held = [], denySession = false, brokenPhoto = false, brokenBack = false, corruptBack = false, transientPhotos = 0;
const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1'), json = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  requests.push({ method: req.method, url: req.url });
  if (req.method !== 'GET') { json({ error: 'READ_ONLY_FIXTURE' }, 405); return; }
  if (url.pathname === '/fixture-controls') {
    const action = url.searchParams.get('action');
    if (action === 'fail-read') failure = 503;
    if (action === 'hold-reads') hold = true;
    if (action === 'release-reads') { hold = false; held.splice(0).forEach(done => done()); }
    if (action === 'deny-session') denySession = true;
    if (action === 'allow-session') denySession = false;
    if (action === 'break-photos') brokenPhoto = true;
    if (action === 'fail-next-photo') transientPhotos = 2;
    if (action === 'break-back') brokenBack = true;
    if (action === 'corrupt-back') corruptBack = true;
    if (action === 'restore-photos') { brokenPhoto = false; brokenBack = false; corruptBack = false; transientPhotos = 0; }
    json({ failure, hold, held: held.length, denySession, brokenPhoto, brokenBack, corruptBack, transientPhotos, reads: requests.length, writes: requests.filter(request => request.method !== 'GET').length }); return;
  }
  if (req.url === '/' || /^\/admin\/graded-cards(?:\/[a-f0-9-]+)?$/.test(url.pathname)) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const controls = ['fail-read', 'hold-reads', 'release-reads', 'deny-session', 'allow-session', 'break-photos', 'fail-next-photo', 'break-back', 'corrupt-back', 'restore-photos'];
    res.end('<!doctype html><meta charset="utf-8"><title>ATLAS graded cards · synthetic qualification</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="fixture-controls" style="background:#fff;color:#334155;padding:8px 4%;font:11px system-ui;border-bottom:1px solid #ddd"><details><summary>Local qualification · synthetic records, copies of approved public photos</summary><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'+controls.map(action=>'<button type="button" data-fixture-action="'+action+'" style="background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:4px;padding:8px">'+action+'</button>').join('')+'<button type="button" id="revoke-access" style="background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:4px;padding:8px">revoke-access</button></div><pre id="fixture-status" style="white-space:pre-wrap"></pre></details></div><div id="app"></div><script type="module" src="/bundle.js"></script><script>document.querySelectorAll("[data-fixture-action]").forEach(button=>button.addEventListener("click",async()=>{document.getElementById("fixture-status").textContent=JSON.stringify(await(await fetch("/fixture-controls?action="+button.dataset.fixtureAction)).json())}));document.getElementById("revoke-access").addEventListener("click",()=>window.dispatchEvent(new Event("atlas:verified-image-access-ended")));</script>'); return;
  }
  if (req.url === '/bundle.js' || req.url === '/style.css') { res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(req.url.endsWith('.js') ? js : css); return; }
  if (/^\/admin\/brand\/(?:atlas-grading-logo\.png|fonts\/original-[1-4]\.woff2|archive\/(?:slab-shell-front\.svg|nfc-tag-reference\.jpg))$/.test(url.pathname)) { const file = resolve(app, 'public', url.pathname.slice('/admin/'.length)); res.setHeader('content-type', file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.jpg') ? 'image/jpeg' : 'font/woff2'); res.end(await readFile(file)); return; }
  if (url.pathname === '/admin/api/staff/session') { json(denySession ? { error: 'SIGN_IN_REQUIRED' } : { staff, csrf: 'synthetic' }, denySession ? 401 : 200); return; }
  if (url.pathname === '/admin/api/staff/manual-connected/graded-cards') {
    if (failure) { const status = failure; failure = null; json({ error: status === 401 ? 'SIGN_IN_REQUIRED' : 'TEMPORARILY_UNAVAILABLE' }, status); return; }
    const q = (url.searchParams.get('q') || '').toLowerCase(), category = url.searchParams.get('category'), from = url.searchParams.get('from'), to = url.searchParams.get('to'), cursor = url.searchParams.get('cursor');
    const rows = cards.filter(card => (!q || JSON.stringify(card).toLowerCase().includes(q)) && (!category || card.identity.category === category) && (!from || card.approvedAt.slice(0, 10) >= from) && (!to || card.approvedAt.slice(0, 10) <= to));
    const offset = cursor ? Number(cursor.slice(4)) : 0, size = Number(url.searchParams.get('limit') || 24);
    const result = { schemaVersion: 1, cards: rows.slice(offset, offset + size), nextCursor: rows.length > offset + size ? `page${offset + size}` : null };
    if (hold) { held.push(() => json(result)); return; } json(result); return;
  }
  const provenance = /^\/admin\/api\/staff\/manual-connected\/cards\/([a-f0-9-]+)\/provenance$/.exec(url.pathname);
  if (provenance) {
    const card = cards.find(value => value.cardId === provenance[1]);
    if (!card) { json({ error: 'CARD_UNAVAILABLE' }, 404); return; }
    if (failure) { const status = failure; failure = null; json({ error: 'TEMPORARILY_UNAVAILABLE' }, status); return; }
    const at = card.approvedAt;
    const event = (kind, category, verification, index) => ({ eventId: `${category === 'CUSTODY' ? 'custody' : kind === 'REPORT_PUBLISHED' ? 'publication' : 'approval'}:${card.cardId}`, kind, category, verification,
      occurredAt: at, recordedAt: at, ...(category === 'CUSTODY' ? { sequence: index } : {}),
      ...(category === 'GRADING' ? { report: { version: 1, finalGrade: card.finalGrade, path: kind === 'REPORT_PUBLISHED' ? card.report.path : null } } : {}) });
    const events = [...(card.report.state === 'PUBLISHED' ? [event('REPORT_PUBLISHED', 'GRADING', 'VERIFIED_RECORD', 1)] : []), event('REPORT_APPROVED', 'GRADING', 'VERIFIED_RECORD', 2),
      ...(card.submission ? [event('ATLAS_RECEIVED', 'CUSTODY', 'VERIFIED_RECORD', 3)] : [])].sort((a, b) => a.eventId < b.eventId ? 1 : -1);
    const result = { schemaVersion: 1, card,
      ownership: { status: 'UNKNOWN', verification: 'UNKNOWN', history: [], reason: 'NO_REVIEWED_OWNERSHIP_RECORD' },
      custody: { status: card.submission ? 'RECORDED' : 'UNKNOWN', latestRecorded: null, currentPhysicalHolder: 'UNKNOWN' },
      history: { scope: 'RECORDED_ATLAS_EVENTS', complete: false, snapshot: '2026-10-31T00:00:00.000000Z', nextCursor: null, events },
      capabilities: { ownershipClaims: false, ownershipTransfers: false, reholder: false } };
    if (hold) { held.push(() => json(result)); return; } json(result); return;
  }
  const reportPage = /^\/reports\/(ar_[A-Za-z0-9_-]{24})$/.exec(url.pathname);
  if (reportPage) {
    const card = cards.find(value => value.report.publicToken === reportPage[1]);
    if (card?.report.state === 'PUBLISHED' && url.searchParams.get('v') === String(card.report.version)) {
      const source = samples[card.sample].binding;
      // Qualification only: the source report is already public. No auth or
      // private fixture data is forwarded, and the original version is retained.
      res.writeHead(302, { location: `https://atlasgrading.com/reports/${source.publicToken}?v=${source.approvalVersion}`, 'cache-control': 'no-store' }); res.end(); return;
    }
  }
  const photo = /^\/api\/reports\/(ar_[A-Za-z0-9_-]{24})\/images\/(FRONT|BACK)$/.exec(url.pathname);
  if (photo) {
    const card = cards.find(card => card.report.publicToken === photo[1]), side = photo[2];
    if (transientPhotos > 0) { transientPhotos--; json({ error: 'TEMPORARILY_UNAVAILABLE' }, 503); return; }
    if (!card?.media[side] || brokenPhoto || brokenBack && side === 'BACK') { json({ error: 'PHOTO_UNAVAILABLE' }, 404); return; }
    const { descriptor, bytes } = samples[card.sample].images[side];
    if (url.searchParams.get('delivery') === 'direct') {
      json({ version: 'atlas-approved-image-access-v1', publicToken: card.report.publicToken, approvalVersion: card.report.version, publicHash: card.report.publicHash, side,
        image: { url: `${storageOrigin}/atlas-detail-fixture/${card.cardId}/${side}`, sha256: descriptor.sha256, byteCount: bytes.length, mime: descriptor.mime, width: descriptor.width, height: descriptor.height } }); return;
    }
    res.setHeader('content-type', descriptor.mime); res.end(bytes); return;
  }
  const storage = /^\/fixture-storage\/atlas-detail-fixture\/([a-f0-9-]+)\/(FRONT|BACK)$/.exec(url.pathname);
  if (storage) {
    const card = cards.find(card => card.cardId === storage[1]);
    if (!card?.media[storage[2]]) { json({ error: 'PHOTO_UNAVAILABLE' }, 404); return; }
    const { bytes, descriptor } = samples[card.sample].images[storage[2]];
    res.setHeader('content-type', descriptor.mime);
    res.end(corruptBack && storage[2] === 'BACK' ? Buffer.alloc(bytes.length) : bytes); return;
  }
  json({ error: 'NOT_FOUND' }, 404);
});
const fixturePort = Number(process.env.ATLAS_ARCHIVE_FIXTURE_PORT || 0);
if (!Number.isInteger(fixturePort) || fixturePort < 0 || fixturePort > 65535) throw Error('Invalid fixture port.');
await new Promise(done => server.listen(fixturePort, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({ origin, syntheticRecords: true, samplePhotos: true, readOnly: true, actual: 'GradedCards, CardHistory, ApprovedCardMedia, validated source and image transport', cards: cards.slice(0, 6).map(card => ({ name: card.identity.playerName, cardId: card.cardId, path: '/admin/graded-cards/' + card.cardId })) }));
