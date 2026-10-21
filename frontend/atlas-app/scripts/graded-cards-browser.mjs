/** Actual staff archive + transport, served only on loopback with read-only
 * synthetic records. Photograph/DEMO-label references stay outside the repo. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), app = resolve(root, 'frontend/atlas-app');
const require = createRequire(resolve(root, 'packages/atlas-manual-workspace/package.json'));
const { build } = require('esbuild');
const references = process.env.ATLAS_ARCHIVE_PHOTO_REFERENCES;
if (!references) throw Error('Provide ATLAS_ARCHIVE_PHOTO_REFERENCES outside the repository.');
const staff = { id: randomUUID(), name: 'Fixture reviewer', role: 'REVIEWER', mode: 'LOCAL_FIXTURE', customerOperationsEnabled: true };
const names = ['Kobe Bryant', 'Charizard', 'Tom Brady', 'Alakazam'], files = ['kobe.jpg', 'charizard.jpg', 'brady.jpg', 'alakazam-reference.jpg'], labels = ['label-kobe.svg', 'label-charizard.svg', 'label-brady.svg', 'label-alakazam.svg'];
const samples = await Promise.all(files.map((file, index) => Promise.all([readFile(resolve(references, file)), readFile(resolve(references, labels[index]))])));
const cards = Array.from({ length: 26 }, (_, index) => {
  const sample = index % 4, token = `ar_${String(index).padStart(24, '0')}`, labelId = randomUUID(), category = sample % 2 ? 'POKEMON' : 'SPORTS';
  return { cardId: randomUUID(), identity: { category, playerName: category === 'SPORTS' ? index === 24 ? 'Second page specimen' : names[sample] : null, cardName: category === 'POKEMON' ? names[sample] : null, year: '2026', manufacturer: category === 'SPORTS' ? 'Synthetic fixture' : null, productSet: 'Isolated browser fixture', parallel: index === 2 ? 'Printed parallel' : null, insert: null, cardNumber: String(index + 1) },
    finalGrade: index === 4 ? 8.5 : [9, 10, 9, 9][sample], approvedAt: `2026-10-${String(26 - index).padStart(2, '0')}T12:00:00.000Z`, certificateNumber: `DEMO-${1001 + index}`, approvalActionId: randomUUID(),
    report: { state: index === 5 ? 'PENDING' : 'PUBLISHED', version: 1, path: `/reports/${token}?v=1`, publicToken: token, reportHash: 'a'.repeat(64) },
    approver: { id: staff.id, name: 'Fixture approver' }, reviewers: [{ id: staff.id, name: 'Fixture reviewer' }],
    submission: index % 3 === 0 ? { orderId: randomUUID(), reference: `SYNTHETIC-ORDER-${index + 1}`, customer: { name: 'Fixture customer' }, channel: index % 2 === 0 ? 'MAIL_IN' : 'KIOSK', dealer: index % 2 ? { name: 'Fixture shop' } : null } : null,
    media: index === 5 ? {} : { FRONT: { url: `/api/reports/${token}/images/FRONT?v=1`, provenance: 'APPROVED_GRADING_PHOTOGRAPH' }, BACK: { url: `/api/reports/${token}/images/BACK?v=1`, provenance: 'APPROVED_GRADING_PHOTOGRAPH' }, ...(index >= 4 ? {} : { LABEL: { url: `/admin/api/staff/manual-connected/labels/${labelId}/artwork?mode=preview`, provenance: 'REPORT_BOUND_LABEL_ARTWORK' } }) },
    sample, labelId };
});
const globalStyles = ['./styles/global.css', './styles/grading.css', '@atlas/report-view/styles.css', '@atlas/manual-workspace/styles.css', '@atlas/manual-workspace/focused-geometry.css', '@atlas/manual-workspace/defects.css', './styles/manual.css', './styles/atlas-brand.css', './styles/atlas-theme.css', '@atlas/manual-workspace/report-review.css'];
const source = `${globalStyles.map(path => `import '${path}';`).join('')}import React from 'react';import{createRoot}from'react-dom/client';import GradedCards from './components/GradedCards.jsx';import CardHistory from './components/CardHistory.jsx';const id=/^\\/admin\\/graded-cards\\/([a-f0-9-]+)$/.exec(location.pathname)?.[1];createRoot(document.getElementById('app')).render(id?<CardHistory staff={${JSON.stringify(staff)}} cardId={id}/>:<GradedCards staff={${JSON.stringify(staff)}}/>);`;
const bundle = await build({ logLevel: 'error', stdin: { contents: source, resolveDir: app, sourcefile: 'graded-cards-fixture.jsx', loader: 'jsx' }, bundle: true, jsx: 'automatic', write: false, outdir: '/fixture', format: 'esm', platform: 'browser', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, external: ['/admin/brand/*'], plugins: [{ name: 'isolated-next-runtime', setup(build) {
  build.onResolve({ filter: /^next\/(link|head|router)$/ }, args => ({ path: args.path, namespace: 'fixture-next' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture-next' }, args => ({ contents: args.path === 'next/link' ? `export default function Link({href,children,...props}){return <a href={'/admin'+href}{...props}>{children}</a>}` : args.path === 'next/head' ? `export default function Head(){return null}` : `export function useRouter(){return {pathname:'/graded-cards',query:{}}}`, loader: 'jsx', resolveDir: app }));
} }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text, css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
let failure = null, hold = false, held = [], denySession = false, brokenPhoto = false;
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
    if (action === 'restore-photos') brokenPhoto = false;
    json({ failure, hold, held: held.length, denySession, brokenPhoto, writes: requests.filter(request => request.method !== 'GET').length }); return;
  }
  if (req.url === '/' || /^\/admin\/graded-cards(?:\/[a-f0-9-]+)?$/.test(url.pathname)) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const controls = ['fail-read', 'hold-reads', 'release-reads', 'deny-session', 'allow-session', 'break-photos', 'restore-photos'];
    res.end('<!doctype html><meta charset="utf-8"><title>ATLAS graded cards · synthetic qualification</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="fixture-controls" style="background:#fff;color:#334155;padding:8px 4%;font:11px system-ui;border-bottom:1px solid #ddd"><details><summary>Synthetic qualification controls · no production data</summary><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'+controls.map(action=>'<button type="button" data-fixture-action="'+action+'" style="background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:4px;padding:8px">'+action+'</button>').join('')+'<button type="button" id="revoke-access" style="background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:4px;padding:8px">revoke-access</button></div><pre id="fixture-status" style="white-space:pre-wrap"></pre></details></div><div id="app"></div><script type="module" src="/bundle.js"></script><script>document.querySelectorAll("[data-fixture-action]").forEach(button=>button.addEventListener("click",async()=>{document.getElementById("fixture-status").textContent=JSON.stringify(await(await fetch("/fixture-controls?action="+button.dataset.fixtureAction)).json())}));document.getElementById("revoke-access").addEventListener("click",()=>window.dispatchEvent(new Event("atlas:verified-image-access-ended")));</script>'); return;
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
    const event = (kind, category, verification, index) => ({ eventId: `${category.toLowerCase()}:${card.cardId}:${index}`, kind, category, verification, occurredAt: at, recordedAt: at,
      ...(category === 'GRADING' ? { report: { version: 1, finalGrade: card.finalGrade, path: card.report.state === 'PUBLISHED' ? card.report.path : null } } : {}) });
    const result = { schemaVersion: 1, card: { ...card, media: card.media.FRONT ? { FRONT: card.media.FRONT } : {} },
      ownership: { status: 'UNKNOWN', verification: 'UNKNOWN', history: [], reason: 'NO_REVIEWED_OWNERSHIP_RECORD' },
      custody: { status: card.submission ? 'RECORDED' : 'UNKNOWN', latestRecorded: null, currentPhysicalHolder: 'UNKNOWN' },
      history: { scope: 'RECORDED_ATLAS_EVENTS', complete: false, snapshot: '2026-10-31T00:00:00.000000Z', nextCursor: null,
        events: [...(card.report.state === 'PUBLISHED' ? [event('REPORT_PUBLISHED', 'GRADING', 'VERIFIED_RECORD', 1)] : []), event('REPORT_APPROVED', 'GRADING', 'VERIFIED_RECORD', 2),
          ...(card.submission ? [event('ATLAS_RECEIVED', 'CUSTODY', 'VERIFIED_RECORD', 3), event('DEPOSIT_DECLARED', 'CUSTODY', 'SUBMITTER_REPORTED', 4)] : [])] },
      capabilities: { ownershipClaims: false, ownershipTransfers: false, reholder: false } };
    if (hold) { held.push(() => json(result)); return; } json(result); return;
  }
  const photo = /^\/api\/reports\/(ar_[A-Za-z0-9_-]{24})\/images\/(FRONT|BACK)$/.exec(url.pathname);
  if (photo) { const card = cards.find(card => card.report.publicToken === photo[1]); if (!card || brokenPhoto) { json({ error: 'PHOTO_UNAVAILABLE' }, 404); return; } res.setHeader('content-type', 'image/jpeg'); res.end(samples[card.sample][0]); return; }
  const label = /^\/admin\/api\/staff\/manual-connected\/labels\/([^/]+)\/artwork$/.exec(url.pathname);
  if (label) { const card = cards.find(card => card.labelId === label[1]); if (!card) { json({ error: 'LABEL_UNAVAILABLE' }, 404); return; } res.setHeader('content-type', 'image/svg+xml'); res.end(samples[card.sample][1]); return; }
  json({ error: 'NOT_FOUND' }, 404);
});
const fixturePort = Number(process.env.ATLAS_ARCHIVE_FIXTURE_PORT || 0);
if (!Number.isInteger(fixturePort) || fixturePort < 0 || fixturePort > 65535) throw Error('Invalid fixture port.');
await new Promise(done => server.listen(fixturePort, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({ origin, syntheticRecords: true, samplePhotos: true, readOnly: true, actual: 'GradedCards, Shell, global styles, archive client and staff transport' }));
