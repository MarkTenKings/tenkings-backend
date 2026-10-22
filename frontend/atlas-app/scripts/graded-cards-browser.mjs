/** Actual staff archive + transport, served only on loopback with read-only
 * synthetic records. Photograph/DEMO-label references stay outside the repo. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { renderLabelV4 } from '../../../packages/atlas-finishing/src/label-v4.mjs';
import { renderApprovedBLabel } from '../../../packages/atlas-finishing/src/label-approved-b.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), app = resolve(root, 'frontend/atlas-app');
const require = createRequire(resolve(root, 'packages/atlas-manual-workspace/package.json'));
const { build } = require('esbuild');
const sharp = createRequire(resolve(app, 'package.json'))('sharp');
const materialMode = process.env.ATLAS_SLAB_MATERIAL_COMPARE || 'reflection';
if (!['reflection', 'transmission'].includes(materialMode)) throw Error('Invalid slab material comparison.');
// The fixture uses exact, hash-verified copies of already public approved
// photographs. Its card IDs, staff, submissions and event history are synthetic.
const references = process.env.ATLAS_ARCHIVE_APPROVED_REFERENCES;
if (!references) throw Error('Provide ATLAS_ARCHIVE_APPROVED_REFERENCES with an external manifest.json.');
const manifest = JSON.parse(await readFile(resolve(references, 'manifest.json'), 'utf8'));
if (manifest.qualificationOnly !== true || !Array.isArray(manifest.records) || manifest.records.length !== 4) throw Error('Invalid approved reference manifest.');
const reportContentPath = process.env.ATLAS_ARCHIVE_REPORT_CONTENT;
const reportContent = reportContentPath ? JSON.parse(await readFile(reportContentPath, 'utf8')) : null;
if (reportContent && (reportContent.readOnlyPublicCopies !== true || reportContent.signedURLsPersisted !== false)) throw Error('Invalid public report fixture content.');
const samples = await Promise.all(manifest.records.map(async record => {
  const images = {};
  for (const side of ['FRONT', 'BACK']) {
    const descriptor = record.images[side], bytes = await readFile(resolve(references, descriptor.file));
    if (descriptor.mime !== 'image/webp' || descriptor.width !== 1350 || descriptor.height !== 1858
      || descriptor.byteCount !== bytes.length || descriptor.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error('Reference photo changed.');
    // Display-only local rendition, bound to the exact public source bytes.
    // Production uses the already saved OpenCV preview; this fixture exercises
    // that same transport and verification contract without writing any record.
    const previewBytes = await sharp(bytes).resize(558, 768).jpeg({ quality: 78 }).toBuffer();
    const preview = { bytes: previewBytes, descriptor: { sha256: createHash('sha256').update(previewBytes).digest('hex'),
      byteCount: previewBytes.length, mime: 'image/jpeg', width: 558, height: 768,
      sourceSha256: descriptor.sha256, policyVersion: 'atlas-inspection-preview-v1' } };
    images[side] = { descriptor, bytes, preview };
  }
  const content = reportContent?.records?.find(value => value.publicToken === record.binding.publicToken);
  if (reportContent && (!content || content.publicHash !== record.binding.publicHash
    || content.packet.approvalVersion !== record.binding.approvalVersion
    || ['FRONT', 'BACK'].some(side => content.packet.images[side].sha256 !== record.images[side].sha256))) throw Error('Public report fixture binding changed.');
  return { ...record, images, content };
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
// Local-only labels use the same deterministic renderer as the application,
// bound to these synthetic certificates. This neither saves a production label
// nor claims that the reference photograph's physical slab has been finished.
const fixtureLabels = new Map();
for (const [index, card] of cards.entries()) {
  if (card.report.state !== 'PUBLISHED' || index === 6) continue;
  const itemId = randomUUID();
  // Retain one historical front-only example alongside the current saved
  // front/back contract. These labels remain synthetic qualification records.
  const rendered = (index === 2 ? renderLabelV4 : renderApprovedBLabel)({ identity: card.identity, finalGrade: card.finalGrade,
    reportNumber: card.certificateNumber, approvalVersion: card.report.version,
    cardProfile: card.identity.category });
  if (rendered.state !== 'READY') throw Error('Synthetic label needs layout.');
  fixtureLabels.set(itemId, { preview: rendered.previewSvg, 'preview-back': rendered.backPreviewSvg });
  card.media.LABEL = { itemId, url: `/admin/api/staff/manual-connected/labels/${itemId}/artwork?mode=preview`,
    provenance: 'REPORT_BOUND_LABEL_ARTWORK', layoutVersion: rendered.layoutVersion };
  if (rendered.backPreviewSvg) card.media.LABEL_BACK = { ...card.media.LABEL,
    url: `/admin/api/staff/manual-connected/labels/${itemId}/artwork?mode=preview-back` };
}
// A clearly synthetic sold-reference case exercises UI without fetching eBay,
// inventing a market estimate, or attaching fixture sales to a real card record.
cards[1].savedComparables = { state: 'SAVED', selection: 'SAVED_REPORT_SELECTION', source: 'EBAY_SOLD_LISTINGS', observedAt: '2026-10-26T12:00:00.000Z', presentationRevision: 1,
  sales: [{ id: 'synthetic-sale', title: 'Synthetic reference · UI qualification only', listingUrl: null, grader: 'PSA', grade: '7', soldAt: '2026-10-20T12:00:00.000Z', priceMinor: 12500, currency: 'USD', priceBasis: 'sold' },
    { id: 'synthetic-unknown-offer', title: 'Synthetic accepted offer · amount unavailable', listingUrl: null, grader: 'PSA', grade: '8', soldAt: '2026-10-19T12:00:00.000Z', priceMinor: null, currency: 'USD', priceBasis: 'accepted_offer_unknown' }] };
const storageOrigin = 'https://atlas-grading-private-20260910.nyc3.digitaloceanspaces.com';
const fixtureReports = Object.fromEntries(cards.filter(card => card.report.state === 'PUBLISHED' && samples[card.sample].content).map(card => {
  const content = samples[card.sample].content;
  return [card.report.publicToken, { packet: { ...content.packet, mode: 'LOCAL_FIXTURE', publicToken: card.report.publicToken,
    reportNumber: card.certificateNumber, approvalVersion: card.report.version, approvedAt: card.approvedAt },
    publicHash: card.report.publicHash, explanation: content.explanation }];
}));
const globalStyles = ['./styles/global.css', './styles/grading.css', '@atlas/report-view/styles.css', '@atlas/manual-workspace/styles.css', '@atlas/manual-workspace/focused-geometry.css', '@atlas/manual-workspace/defects.css', './styles/manual.css', './styles/atlas-brand.css', './styles/atlas-theme.css', '@atlas/manual-workspace/report-review.css'];
const source = `${globalStyles.map(path => `import '${path}';`).join('')}
import React from 'react';import{createRoot}from'react-dom/client';
import GradedCards from './components/GradedCards.jsx';import CardHistory from './components/CardHistory.jsx';
import {ApprovedReportView} from '@atlas/manual-workspace/report-review';
import {useInspectionImages} from '../atlas-public/components/useInspectionImages.mjs';
import ReportEntryNavigation from '../atlas-public/components/ReportEntryNavigation.jsx';
// Only synthetic fixture grants resolve to loopback; parsers and byte verification are unchanged.
const fixtureFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,location.origin);return fixtureFetch(url.origin===${JSON.stringify(storageOrigin)}&&/^\\/atlas-detail-fixture\\/[a-f0-9-]+\\/(FRONT|BACK)$/.test(url.pathname)?'/fixture-storage'+url.pathname+url.search:input,options)};
const reports=${JSON.stringify(fixtureReports)};
function FixtureReport({packet,publicHash,explanation}){const images=useInspectionImages(packet,publicHash);const path='/reports/'+packet.publicToken+'?v='+packet.approvalVersion;
return <main className="public-manual-report" style={{background:'#fff',color:'#1d1d1f',minHeight:'100vh',padding:'20px clamp(12px,3vw,48px) 40px'}}>
<ReportEntryNavigation reportPath={path}/><ApprovedReportView report={packet.report} explanation={explanation} images={images} geometry={packet.geometry}
brandSrc="/admin/brand/atlas-grading-logo.png" publication={{publicToken:packet.publicToken,reportNumber:packet.reportNumber,version:packet.approvalVersion,approvedAt:packet.approvedAt,reportHash:publicHash,url:path}}/>
<p style={{fontSize:11,color:'#65716a'}}>Local navigation preview. Saved public report content with synthetic certificate and entry context.</p></main>}
const id=/^\\/admin\\/graded-cards\\/([a-f0-9-]+)$/.exec(location.pathname)?.[1];
const token=/^\\/reports\\/(ar_[A-Za-z0-9_-]{24})$/.exec(location.pathname)?.[1];
createRoot(document.getElementById('app')).render(token&&reports[token]?<FixtureReport {...reports[token]}/>:id?<CardHistory staff={${JSON.stringify(staff)}} cardId={id}/>:<GradedCards staff={${JSON.stringify(staff)}}/>);`;
const bundle = await build({ logLevel: 'error', stdin: { contents: source, resolveDir: app, sourcefile: 'graded-cards-fixture.jsx', loader: 'jsx' }, bundle: true, splitting: true, entryNames: 'entry', chunkNames: 'chunks/[name]-[hash]', jsx: 'automatic', write: false, outdir: '/fixture', format: 'esm', platform: 'browser', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, external: ['/admin/brand/*'], plugins: [{ name: 'isolated-next-runtime', setup(build) {
  // Comparison is injected only into this disposable loopback bundle. Product
  // routes expose no material/debug query parameter or alternate render path.
  if (materialMode === 'transmission') build.onLoad({ filter: /slab-3d-scene\.mjs$/ }, async args => {
    const contents = await readFile(args.path, 'utf8'), marker = '}, overrides = {}) {';
    if (!contents.includes(marker)) throw Error('Slab comparison adapter changed.');
    return { contents: contents.replace(marker, "}, overrides = { materialMode: 'transmission' }) {"), loader: 'js' };
  });
  build.onResolve({ filter: /^next\/(link|head|router)$/ }, args => ({ path: args.path, namespace: 'fixture-next' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture-next' }, args => ({ contents: args.path === 'next/link' ? `export default function Link({href,children,...props}){return <a href={'/admin'+href}{...props}>{children}</a>}` : args.path === 'next/head' ? `export default function Head(){return null}` : `export function useRouter(){return {pathname:'/graded-cards',query:{}}}`, loader: 'jsx', resolveDir: app }));
} }] });
const js = bundle.outputFiles.find(file => file.path.endsWith('/entry.js')).text, css = bundle.outputFiles.find(file => file.path.endsWith('/entry.css')).text;
const bundleFiles = new Map(bundle.outputFiles.map(file => [file.path.replace('/fixture', ''), file]));
let failure = null, hold = false, held = [], denySession = false, brokenPhoto = false, brokenBack = false, corruptBack = false, transientPhotos = 0, failSlabChunk = false;
let fullDelayMs = 0, brokenPreview = false;
const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1'), json = (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  const requestRecord = { method: req.method, url: req.url, at: Date.now() }; requests.push(requestRecord);
  const end = res.end.bind(res);
  res.end = (body, ...args) => { requestRecord.bytes = typeof body === 'string' ? Buffer.byteLength(body) : body?.byteLength ?? 0; return end(body, ...args); };
  res.on('finish', () => { requestRecord.status = res.statusCode; requestRecord.completed = true; requestRecord.durationMs = Date.now() - requestRecord.at; });
  res.on('close', () => { if (!requestRecord.completed) requestRecord.cancelled = true; });
  if (req.method !== 'GET') { json({ error: 'READ_ONLY_FIXTURE' }, 405); return; }
  if (url.pathname === '/fixture-requests') { json({ requests }); return; }
  if (url.pathname === '/fixture-controls') {
    const action = url.searchParams.get('action');
    if (action === 'fail-read') failure = 503;
    if (action === 'fail-next-slab-chunk') failSlabChunk = true;
    if (action === 'hold-reads') hold = true;
    if (action === 'release-reads') { hold = false; held.splice(0).forEach(done => done()); }
    if (action === 'deny-session') denySession = true;
    if (action === 'allow-session') denySession = false;
    if (action === 'break-photos') brokenPhoto = true;
    if (action === 'fail-next-photo') transientPhotos = 2;
    if (action === 'break-back') brokenBack = true;
    if (action === 'corrupt-back') corruptBack = true;
    if (action === 'restore-photos') { brokenPhoto = false; brokenBack = false; corruptBack = false; transientPhotos = 0; }
    if (action === 'delay-full') fullDelayMs = 6000;
    if (action === 'restore-full') fullDelayMs = 0;
    if (action === 'break-preview') brokenPreview = true;
    if (action === 'restore-preview') brokenPreview = false;
    json({ failure, hold, held: held.length, denySession, brokenPhoto, brokenBack, corruptBack, transientPhotos, reads: requests.length, writes: requests.filter(request => request.method !== 'GET').length }); return;
  }
  const localReportToken = /^\/reports\/(ar_[A-Za-z0-9_-]{24})$/.exec(url.pathname)?.[1];
  if (req.url === '/' || /^\/admin\/graded-cards(?:\/[a-f0-9-]+)?$/.test(url.pathname)
    || localReportToken && fixtureReports[localReportToken] && url.searchParams.get('v') === String(fixtureReports[localReportToken].packet.approvalVersion)) {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const controls = ['fail-read', 'hold-reads', 'release-reads', 'deny-session', 'allow-session', 'break-photos', 'fail-next-photo', 'break-back', 'corrupt-back', 'restore-photos', 'fail-next-slab-chunk'];
    res.end('<!doctype html><meta charset="utf-8"><title>ATLAS graded cards · synthetic qualification</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="fixture-controls" style="background:#fff;color:#334155;padding:8px 4%;font:11px system-ui;border-bottom:1px solid #ddd"><details><summary>Local qualification · synthetic records, copies of approved public photos</summary><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'+controls.map(action=>'<button type="button" data-fixture-action="'+action+'" style="background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:4px;padding:8px">'+action+'</button>').join('')+'<button type="button" id="lose-3d-context" style="background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:4px;padding:8px">lose-3d-context</button><button type="button" id="revoke-access" style="background:#fff;color:#334155;border:1px solid #cbd5e1;border-radius:4px;padding:8px">revoke-access</button></div><pre id="fixture-status" style="white-space:pre-wrap"></pre></details></div><div id="app"></div><script type="module" src="/bundle.js"></script><script>document.querySelectorAll("[data-fixture-action]").forEach(button=>button.addEventListener("click",async()=>{document.getElementById("fixture-status").textContent=JSON.stringify(await(await fetch("/fixture-controls?action="+button.dataset.fixtureAction)).json())}));document.getElementById("lose-3d-context").addEventListener("click",()=>document.querySelector("canvas")?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext());document.getElementById("revoke-access").addEventListener("click",()=>window.dispatchEvent(new Event("atlas:verified-image-access-ended")));</script>'); return;
  }
  if (req.url === '/bundle.js' || req.url === '/style.css') { res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(req.url.endsWith('.js') ? js : css); return; }
  if (failSlabChunk && /^\/chunks\/Slab3D-/.test(url.pathname)) { failSlabChunk = false; json({ error: 'LOCAL_SLAB_CHUNK_FAILURE' }, 503); return; }
  if (bundleFiles.has(url.pathname)) { const file = bundleFiles.get(url.pathname); res.setHeader('content-type', file.path.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(file.contents); return; }
  if (/^\/admin\/brand\/(?:atlas-grading-logo\.png|fonts\/original-[1-4]\.woff2|archive\/(?:slab-shell-front\.svg|nfc-tag-reference\.jpg|nfc-tag-reference-384\.webp))$/.test(url.pathname)) { const file = resolve(app, 'public', url.pathname.slice('/admin/'.length)); res.setHeader('content-type', file.endsWith('.png') ? 'image/png' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.jpg') ? 'image/jpeg' : 'font/woff2'); res.end(await readFile(file)); return; }
  if (url.pathname === '/admin/api/staff/session') { json(denySession ? { error: 'SIGN_IN_REQUIRED' } : { staff, csrf: 'synthetic' }, denySession ? 401 : 200); return; }
  const labelArtwork = /^\/admin\/api\/staff\/manual-connected\/labels\/([a-f0-9-]+)\/artwork$/.exec(url.pathname);
  if (labelArtwork) {
    if (denySession) { json({ error: 'SIGN_IN_REQUIRED' }, 401); return; }
    const artwork = fixtureLabels.get(labelArtwork[1])?.[url.searchParams.get('mode')];
    if (!artwork) { json({ error: 'ARTWORK_UNAVAILABLE' }, 404); return; }
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' }); res.end(artwork); return;
  }
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
    const { descriptor, bytes, preview } = samples[card.sample].images[side];
    if (url.searchParams.get('delivery') === 'direct') {
      json({ version: 'atlas-approved-image-access-v1', publicToken: card.report.publicToken, approvalVersion: card.report.version, publicHash: card.report.publicHash, side,
        image: { url: `${storageOrigin}/atlas-detail-fixture/${card.cardId}/${side}`, sha256: descriptor.sha256, byteCount: bytes.length, mime: descriptor.mime, width: descriptor.width, height: descriptor.height,
          preview: { ...preview.descriptor, url: `${storageOrigin}/atlas-detail-fixture/${card.cardId}/${side}?preview=1` } } }); return;
    }
    res.setHeader('content-type', descriptor.mime); res.end(bytes); return;
  }
  const storage = /^\/fixture-storage\/atlas-detail-fixture\/([a-f0-9-]+)\/(FRONT|BACK)$/.exec(url.pathname);
  if (storage) {
    const card = cards.find(card => card.cardId === storage[1]);
    if (!card?.media[storage[2]]) { json({ error: 'PHOTO_UNAVAILABLE' }, 404); return; }
    const source = samples[card.sample].images[storage[2]], small = url.searchParams.get('preview') === '1';
    if (small && brokenPreview) { json({ error: 'PREVIEW_UNAVAILABLE' }, 404); return; }
    if (!small && fullDelayMs) await new Promise(done => setTimeout(done, fullDelayMs));
    const { bytes, descriptor } = small ? source.preview : source;
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
