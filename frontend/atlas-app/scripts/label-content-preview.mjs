/** Loopback-only label proof from hash-verified local copies of approved cards.
 * Optional previewIdentity is visibly identified as a proposed local correction.
 * No credentials, remote requests, database writes, print, NFC or deployment. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { renderApprovedBLabel } from '../../../packages/atlas-finishing/src/label-approved-b.mjs';
import { canonicalizeSpeedsterSessionIdentity, assertAtlasSportsAttributePhotos, projectAtlasSportsAttributes } from '@atlas/grading-core/identity';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const app = resolve(root, 'frontend/atlas-app');
const require = createRequire(resolve(root, 'packages/atlas-manual-workspace/package.json'));
const { build } = require('esbuild');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const file = resolve(process.argv[2] || '');
const base = dirname(file), output = resolve(base, 'proofs');
assert(file.endsWith('.json') && !isAbsolute(relative(root, file)) && relative(root, file).startsWith('../'), 'Use an external preview manifest');
const manifest = JSON.parse(await readFile(file, 'utf8'));
assert(manifest.qualificationOnly === true && manifest.readOnlyPublicCopies === true && manifest.signedURLsPersisted === false);
assert(Array.isArray(manifest.records) && manifest.records.length > 0 && manifest.records.length <= 12);
await mkdir(output, { recursive: true });
const assets = new Map(), cards = [];
for (const [index, record] of manifest.records.entries()) {
  const images = {};
  for (const side of ['FRONT', 'BACK']) {
    const d = record.images[side], path = resolve(base, d.file);
    assert(path.startsWith(base + '/'));
    const bytes = await readFile(path);
    assert.equal(sha(bytes), d.sha256); assert.equal(bytes.length, d.byteCount);
    assert.equal(d.mime, 'image/webp');
    const url = `/photos/${index}/${side}`;
    assets.set(url, { bytes, type: d.mime });
    images[side] = { ...d, url, sourceSha256: d.sha256, representation: 'full' };
  }
  const originalIdentity = structuredClone(record.identity);
  if (record.previewIdentity) assert(typeof record.proposalNote === 'string' && record.proposalNote.length > 0);
  const identity = canonicalizeSpeedsterSessionIdentity('SPORTS', record.previewIdentity ?? record.identity);
  if (identity.sportsAttributes) assertAtlasSportsAttributePhotos(identity.sportsAttributes,
    Object.fromEntries(Object.entries(images).map(([side, image]) => [side, image.sha256])));
  // Exercise the same private-to-public projection consumed by loadPacket.
  const labelIdentity = { ...identity, ...(identity.sportsAttributes ? { sportsAttributes: projectAtlasSportsAttributes(identity.sportsAttributes) } : {}) };
  const label = renderApprovedBLabel({ identity: labelIdentity, finalGrade: record.final_grade,
    reportNumber: record.report_number, approvalVersion: record.version, cardProfile: 'SPORTS' });
  assert.equal(label.state, 'READY', `${record.report_number}: ${JSON.stringify(label.diagnostics)}`);
  assert.deepEqual(record.identity, originalIdentity);
  const front = `/labels/${index}/FRONT`, back = `/labels/${index}/BACK`;
  assets.set(front, { bytes: Buffer.from(label.previewSvg), type: 'image/svg+xml' });
  assets.set(back, { bytes: Buffer.from(label.backPreviewSvg), type: 'image/svg+xml' });
  await writeFile(resolve(output, `${record.report_number}-front.svg`), label.previewSvg);
  cards.push({ index, name: identity.playerName, title: record.previewTitle ?? identity.playerName,
    certificate: record.report_number, grade: record.final_grade, images, front, back,
    frontSha256: sha(label.previewSvg), backSha256: sha(label.backPreviewSvg),
    layoutVersion: label.layoutVersion, diagnostics: label.diagnostics,
    proposalNote: record.proposalNote ?? null, sourceIdentity: originalIdentity, previewIdentity: identity });
}
await writeFile(resolve(output, 'diagnostics.json'), JSON.stringify(cards, null, 2));

const source = `import React,{useState,useEffect,lazy,Suspense}from'react';import{createRoot}from'react-dom/client';
import {ApprovedCardPresentation}from'./components/ApprovedCardMedia.jsx';
import {slabPhotoFrame}from'./lib/slab-photo-frame.mjs';
const Slab3D=lazy(()=>import('./components/Slab3D.jsx'));
const cards=${JSON.stringify(cards)};
function Proof3D({card,fallback}){const[urls,setUrls]=useState(null),[failed,setFailed]=useState(false);useEffect(()=>{const controller=new AbortController(),owned=[];let active=true;const entries=[['frontUrl',card.images.FRONT.url,card.images.FRONT.sha256],['backUrl',card.images.BACK.url,card.images.BACK.sha256],['labelUrl',card.front,card.frontSha256],['backLabelUrl',card.back,card.backSha256]];Promise.all(entries.map(async([key,url,hash])=>{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error('Local asset unavailable');const bytes=await response.arrayBuffer();const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');if(actual!==hash)throw Error('Local asset changed');if(!active)return null;const object=URL.createObjectURL(new Blob([bytes],{type:response.headers.get('content-type')}));owned.push(object);return[key,object]})).then(entries=>{if(active)setUrls(Object.fromEntries(entries))}).catch(()=>{if(active)setFailed(true)});return()=>{active=false;controller.abort();owned.forEach(url=>URL.revokeObjectURL(url))}},[card]);return urls?<Slab3D name={card.name} {...urls} frontPhotoFrame={slabPhotoFrame(card.images.FRONT)} backPhotoFrame={slabPhotoFrame(card.images.BACK)} labelLayoutVersion={card.layoutVersion} fallback={fallback}/>:<>{fallback}<p>{failed?'Local preview asset failed verification.':'Opening verified 3D assets…'}</p></>}
function Label({card}){return <div className="label"><img className="art" src={card.front} alt={card.title+' label'}/><span className="nfc"><img src="/admin/brand/archive/nfc-tag-reference-384.webp" alt=""/></span></div>}
function App(){const[index,setIndex]=useState(0),[side,setSide]=useState('FRONT');const c=cards[index],all=new URLSearchParams(location.search).get('view')==='labels';
const photo=c.images[side==='BACK'?'BACK':'FRONT'];const flat=<ApprovedCardPresentation name={c.name} photo={photo} side={side==='BACK'?'BACK':'FRONT'} artwork={{url:side==='BACK'?c.back:c.front}} layoutVersion={c.layoutVersion} onImageError={()=>{}}/>;
return <main><header><span className="eyebrow">ATLAS · LOCAL DESIGN PREVIEW</span><h1>Clear identity. Distinctive details.</h1><p>Two-line labels with manufacturer names and supported special features. Production records are unchanged.</p><a href={all?'/':'/?view=labels'}>{all?'Open interactive slab previews':'Compare all six labels'}</a></header>
{all?<div className="label-grid">{cards.map(card=><article key={card.index}><h2>{card.title}</h2><Label card={card}/><p className="caption">{card.diagnostics.metadata.lines.join(' / ')}</p>{card.proposalNote&&<p className="note">{card.proposalNote}</p>}</article>)}</div>:<><nav aria-label="Choose a card">{cards.map(card=><button key={card.index} aria-pressed={index===card.index} onClick={()=>{setIndex(card.index);setSide('FRONT')}}>{card.title}</button>)}</nav><div className="review"><section><div className="stage" style={side==='3D'?{height:680}:undefined}>{side==='3D'?<Suspense fallback={flat}><Proof3D key={c.index} card={c} fallback={flat}/></Suspense>:flat}</div><div className="tabs">{['FRONT','BACK','3D'].map(v=><button key={v} aria-pressed={side===v} onClick={()=>setSide(v)}>{v==='FRONT'?'Front':v==='BACK'?'Back':'3D'}</button>)}</div></section><section className="details"><span className="eyebrow">LABEL CLOSE-UP</span><h2>{c.title}</h2><Label card={c}/><div className="written">{c.diagnostics.metadata.lines.map((line,i)=><p key={i}>{line}</p>)}</div>{c.proposalNote&&<p className="note">{c.proposalNote}</p>}<p className="caption">Actual saved grade {c.grade} · {c.certificate}</p><p className="caption">These are digital proofs. Physical print size and legibility still need a sample print.</p></section></div></>}
</main>};createRoot(document.getElementById('app')).render(<App/>);`;
const bundle = await build({ logLevel: 'error', stdin: { contents: source, resolveDir: app, sourcefile: 'label-content-proof.jsx', loader: 'jsx' },
  bundle: true, splitting: true, write: false, outdir: '/fixture', entryNames: 'entry', chunkNames: 'chunks/[name]-[hash]',
  jsx: 'automatic', format: 'esm', platform: 'browser', target: 'chrome120',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  plugins: [{ name: 'local-next-link', setup(build) {
    build.onResolve({ filter: /^next\/link$/ }, args => ({ path: args.path, namespace: 'fixture-next' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture-next' }, () => ({ contents: 'import React from "react";export default function Link({children,...props}){return React.createElement("a",props,children)}', resolveDir: app }));
  } }] });
for (const part of bundle.outputFiles) assets.set(part.path.replace('/fixture', ''), { bytes: part.contents, type: part.path.endsWith('.css') ? 'text/css' : 'application/javascript' });
const css = `*{box-sizing:border-box}body{margin:0;background:#fff;color:#24332b;font-family:Arial,sans-serif}main{max-width:1500px;margin:auto;padding:30px}header{margin-bottom:28px}h1{font-size:32px;margin:10px 0}h2{font-size:22px;margin:10px 0 20px}p{line-height:1.5}.eyebrow{font-size:11px;font-weight:700;letter-spacing:.13em;color:#007b5b}a{color:#007b5b}nav,.tabs{display:flex;gap:8px;flex-wrap:wrap}nav{margin-bottom:24px}button{background:#fff;border:1px solid #d8e0dc;border-radius:8px;padding:12px 15px;font-size:14px;color:#253c30;cursor:pointer}button[aria-pressed=true]{background:#007c5b;color:#fff;border-color:#007c5b}.review{display:grid;grid-template-columns:minmax(250px,460px) minmax(0,1fr);gap:55px}.stage{max-width:405px;margin:auto;min-height:650px}.tabs{justify-content:center;margin:15px 0}.details{padding:30px 0}.label{position:relative;width:100%;line-height:0}.label>.art{display:block;width:100%;height:auto}.nfc{position:absolute;left:68.33%;top:23.155%;width:14.925%;aspect-ratio:1;overflow:hidden;border-radius:50%;background:#d18c0c}.nfc img{position:absolute;width:195.43%;height:260.57%;max-width:none;left:-50.86%;top:-54.71%}.written{border-top:1px solid #dfe6e2;margin-top:25px;padding-top:10px;font-size:18px}.written p{margin:10px 0}.caption{font-size:13px;color:#6b756e}.note{background:#f4f7f5;padding:14px;border-radius:8px;font-size:14px}.label-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:30px}.label-grid article{min-width:0}.label-grid h2{margin-bottom:12px}.label-grid .note{font-size:12px;margin:8px 0}.label-grid .caption{margin:8px 0}@media(max-width:760px){main{padding:18px}h1{font-size:25px}.review,.label-grid{grid-template-columns:1fr;gap:20px}.stage{max-width:350px;min-height:0}.details{padding-top:0}nav button{font-size:12px;padding:10px}}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas two-line label preview</title><link rel="stylesheet" href="/entry.css"><style>${css}</style></head><body><div id="app"></div><script type="module" src="/entry.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('cache-control', 'no-store');
    if (url.pathname === '/') {
      // A fixed-width comparison proof is useful when the host side panel is
      // narrow. The normal preview remains responsive and uses the same labels.
      const proofStyle = url.searchParams.get('proof') === 'wide'
        ? '<style>body{min-width:1280px}main{width:1280px;max-width:none;padding:30px}h1{font-size:32px}.label-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:30px}</style>' : '';
      res.setHeader('content-type', 'text/html'); res.end(html.replace('</head>', `${proofStyle}</head>`)); return;
    }
    const asset = assets.get(url.pathname);
    if (asset) { res.setHeader('content-type', asset.type); res.end(asset.bytes); return; }
    if (/^\/admin\/brand\/archive\/(slab-shell-front\.svg|nfc-tag-reference-384\.webp)$/.test(url.pathname)) {
      res.setHeader('content-type', url.pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/webp');
      res.end(await readFile(resolve(app, 'public', url.pathname.slice('/admin/'.length)))); return;
    }
    res.writeHead(404).end();
  } catch { res.writeHead(500).end('Local preview unavailable'); }
});
const port = Number(process.env.ATLAS_LABEL_PREVIEW_PORT ?? 0);
assert(Number.isInteger(port) && (port === 0 || port >= 1024 && port <= 65535), 'Invalid loopback preview port');
server.listen(port, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  await writeFile(resolve(output, 'server.json'), JSON.stringify({ pid: process.pid, url, cards: cards.length, localOnly: true }));
  console.log(JSON.stringify({ url, cards: cards.length, output, localOnly: true }));
});
