/** Local visual harness for the real component. Never imported by application pages. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { renderApprovedBLabel } from '../../../packages/atlas-finishing/src/label-approved-b.mjs';
import { renderLabelExportSvg, renderLabelBlackInkPreviewSvg } from '../../../packages/atlas-finishing/src/label-sheet.mjs';
import { LABEL_JIG_V1 } from '../../../packages/atlas-finishing/src/label-sheet-geometry.mjs';
const app = fileURLToPath(new URL('../', import.meta.url));
const workspaceRequire = createRequire(new URL('../../../packages/atlas-manual-workspace/package.json', import.meta.url));
const { build } = workspaceRequire('esbuild');
const directory = process.argv[2] ?? '/tmp/atlas-v4-label-browser', port = Number(process.argv[3] ?? 4397);
await mkdir(directory, { recursive: true });
const staff = { id: '11111111-1111-4111-8111-111111111111', name: 'Component fixture', role: 'REVIEWER', mode: 'PRODUCTION' };
const artwork = new Map(), sheets = [], exportsByRequest = new Map(), staticAssets = new Map();
const examples = [{ playerName: 'LEBRON JAMES', year: '2024', manufacturer: 'Panini', productSet: 'Prizm', cardNumber: '1', parallel: 'Silver' }, { playerName: 'MICHAEL JORDAN', year: '1992-93', manufacturer: 'Fleer', productSet: 'Ultra', cardNumber: '273' }, { cardName: 'CHARIZARD', year: '1999', productSet: 'Base Set', cardNumber: '4/102', parallel: 'Holo' }];
for (const [number, count, pokemon] of [[1, 50, false], [2, 32, true]]) {
  const sheet = { sheetId: randomUUID(), number, state: count === 50 ? 'SEALED' : 'OPEN', revision: count, occupied: count, capacity: 50, materialProfileId: pokemon ? 'atlas-v4-holo-v1' : 'atlas-v4-gold-v1', jigHash: LABEL_JIG_V1.jigHash, items: [], exports: [], printEvents: [] };
  for (let index = 0; index < count; index++) {
    const identity = examples[pokemon ? 2 : index % 2], itemId = randomUUID(), reportNumber = `ATLAS-${(number * 100 + index).toString(16).toUpperCase().padStart(12, '0')}`;
    const grade = index % 3 === 0 ? 10 : 9.5, cardProfile = pokemon ? 'POKEMON' : 'SPORTS';
    const rendered = renderApprovedBLabel({ identity, finalGrade: grade, reportNumber, approvalVersion: 1, cardProfile }, { previewMaterial: pokemon ? 'holo' : 'gold' });
    if (rendered.state !== 'READY') throw new Error(`Fixture artwork needs layout: ${JSON.stringify(rendered.diagnostics)}`);
    artwork.set(itemId, rendered);
    sheet.items.push({ itemId, cardId: randomUUID(), approvalActionId: randomUUID(), sheetId: sheet.sheetId, slot: index + 1, state: 'READY', labelHash: rendered.artworkHash, materialProfileId: sheet.materialProfileId, snapshot: { identity, grade, reportNumber, approvalVersion: 1, cardProfile, layoutVersion: rendered.layoutVersion }, exports: [] });
  }
  sheets.unshift(sheet);
}
const pending = { itemId: randomUUID(), cardId: randomUUID(), state: 'NEEDS_LAYOUT', identity: { playerName: 'A complete name requiring layout review' } };
await build({ absWorkingDir: app, stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import LabelSheets from './components/LabelSheets.jsx'; import './styles/global.css'; import './styles/manual.css'; import './styles/atlas-brand.css'; import './styles/atlas-theme.css'; createRoot(document.getElementById('root')).render(<><div style={{padding:'8px 20px',textAlign:'center',background:'#f3eee1',color:'#71613a',fontSize:11}}>LOCAL COMPONENT FIXTURE · Synthetic cards · No real printing or NFC</div><LabelSheets staff={${JSON.stringify(staff)}}/></>);`, resolveDir: app, sourcefile: 'label-fixture.jsx', loader: 'jsx' }, outdir: directory, entryNames: 'app', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', minify: false, external: ['/admin/brand/*'], plugins: [{ name: 'fixture-next', setup(builder) {
  builder.onResolve({ filter: /^next\/(link|router|head)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  builder.onResolve({ filter: /^@atlas\/manual-workspace\/image-cache$/ }, () => ({ path: resolve(app, '../../packages/atlas-manual-workspace/src/VerifiedImageCacheBoundary.jsx') }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ resolveDir: app, loader: 'jsx', contents: args.path === 'next/link' ? `import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}` : args.path === 'next/head' ? `export default function Head(){return null}` : `export const useRouter=()=>({pathname:'/labels',query:{},push(){},replace(){}});export default {};` }));
  builder.onLoad({ filter: /atlas-25-back-(?:black|gold|silver)\.png$/ }, async args => {
    const bytes = await readFile(args.path), hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    const src = `/admin/_next/static/media/${basename(args.path, '.png')}.${hash}.png`;
    staticAssets.set(src, bytes);
    return { loader: 'js', contents: `export default ${JSON.stringify({ src, width: 9764, height: 12598 })};` };
  });
} }], metafile: true }).then(async result => {
  const inputs = Object.keys(result.metafile.inputs);
  if (inputs.some(path => /label-v4\.mjs|label-sheet\.mjs|label-approved-b\.mjs|fontkit|sharp|node:/.test(path))) throw new Error('Server rendering entered fixture browser bundle');
  await writeFile(resolve(directory, 'bundle-boundary.json'), JSON.stringify({ browserOnly: true, inputs }, null, 2));
});
const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATLAS Labels · real component fixture</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
const json = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); };
if (process.env.ATLAS_LABEL_FIXTURE_BUILD_ONLY === '1') process.exit(0);
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`), path = url.pathname;
    if (path === '/admin/api/staff/session') return json(response, 200, { staff, csrf: 'fixture-csrf' });
    if (path === '/admin/api/staff/manual-connected/label-sheets') return json(response, 200, { version: 'atlas-label-sheets-v1', sheets: sheets.map(({ items, ...sheet }) => sheet), items: sheets.flatMap(sheet => sheet.items), pending: [pending], hasMore: false });
    const itemMatch = path.match(/^\/admin\/api\/staff\/manual-connected\/labels\/([^/]+)\/artwork$/);
    if (itemMatch) {
      const source = artwork.get(itemMatch[1]); if (!source) return json(response, 404, {});
      const mode = url.searchParams.get('mode') ?? 'preview';
      const svg = mode === 'preview-foil' ? renderLabelBlackInkPreviewSvg(source, { previewMaterial: source.previewMaterial })
        : mode.startsWith('preview') ? mode.includes('back') ? source.backPreviewSvg : source.previewSvg
          : renderLabelExportSvg(source, { side: mode.includes('back') ? 'BACK' : 'FRONT', blackInkTransparent: mode.endsWith('foil'), color: mode.endsWith('color') });
      response.writeHead(200, { 'content-type': 'image/svg+xml' }); return response.end(svg);
    }
    const parts = path.split('/'), sheet = sheets.find(value => parts.includes(value.sheetId));
    if (sheet && request.method === 'GET') return json(response, 200, sheet);
    if (request.method === 'POST' && path.startsWith('/admin/api/staff/manual-connected/')) {
      let raw = ''; for await (const chunk of request) raw += chunk; const body = JSON.parse(raw);
      if (request.headers['x-atlas-csrf'] !== 'fixture-csrf') return json(response, 403, { error: { code: 'CSRF_REQUIRED' } });
      if (exportsByRequest.has(body.requestId)) return json(response, 200, exportsByRequest.get(body.requestId));
      if (path.endsWith('/exports')) {
        const item = sheets.flatMap(value => value.items).find(value => parts.includes(value.itemId));
        const output = { exportId: randomUUID(), exportProfileId: body.exportProfileId, sheetId: sheet?.sheetId ?? null, itemId: item?.itemId ?? null, state: 'READY', sha256: 'c'.repeat(64), manifestHash: 'd'.repeat(64), mapping: { canvasWidthMm: sheet ? 310 : 68.342, canvasHeightMm: sheet ? 400 : 20.082, pixelWidth: sheet ? 9764 : 6458, pixelHeight: sheet ? 12598 : 1898, intendedImportXmm: null, intendedImportYmm: null, rotationDeg: 0, diagnostic: true } };
        if (sheet) { sheet.state = 'SEALED'; sheet.exports = [output]; } else if (item) item.exports = [output];
        exportsByRequest.set(body.requestId, output); return json(response, 200, output);
      }
      if (path.endsWith('/download')) return json(response, 503, { error: { code: 'LABEL_EXPORT_UNAVAILABLE' } });
      if (path.endsWith('/print-confirmations') && sheet) { const event = { ...body, eventId: randomUUID(), recordedAt: new Date().toISOString() }; sheet.printEvents.push(event); exportsByRequest.set(body.requestId, event); return json(response, 200, event); }
      return json(response, 503, { error: { code: 'LABEL_SHEETS_UNAVAILABLE' } });
    }
    if (path.startsWith('/admin/brand/')) { const bytes = await readFile(resolve(app, 'public', path.slice('/admin/'.length))); response.writeHead(200, { 'content-type': path.endsWith('.woff2') ? 'font/woff2' : 'image/png' }); return response.end(bytes); }
    if (staticAssets.has(path)) { response.writeHead(200, { 'content-type': 'image/png' }); return response.end(staticAssets.get(path)); }
    if (path === '/app.js' || path === '/app.css') { response.writeHead(200, { 'content-type': extname(path) === '.js' ? 'text/javascript' : 'text/css' }); return response.end(await readFile(resolve(directory, path.slice(1)))); }
    response.writeHead(200, { 'content-type': 'text/html' }); response.end(html);
  } catch (error) { json(response, 500, { error: { code: 'FIXTURE_ERROR', message: error.message } }); }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ fixture: true, url: `http://127.0.0.1:${port}`, directory, cards: sheets.reduce((sum, sheet) => sum + sheet.items.length, 0) })));
