// OWNED LOOPBACK FIXTURE ONLY. Existing staff authentication, synthetic SMS,
// real PostgreSQL, actual CPU image/defect engines and private immutable files.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createHandler } from '../../../frontend/atlas-app/lib/server/http.mjs';
import { assertLocalRequest, assertWrite } from '../../../frontend/atlas-app/lib/server/policy.mjs';
import { createGeometryWorkspace, applyGeometryEdit, applyPreparedFrame, geometryBase, preparationBase } from '@atlas/manual-workspace/geometry-actions';
import { adoptGeometryPreparation } from '@atlas/manual-workspace/preparation-result';
import { verifyAndDecodePhoto, describeDecodedFrame } from '@atlas/photo-runtime';
import { prepareGeometry } from '@atlas/preparation-runtime';
import { createManualWorkflow } from '../src/workflow.mjs';
import { createWorkflowHandler } from '../src/http.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), output = resolve(root, 'dist/preview');
const pythonExecutable = process.env.ATLAS_FIXTURE_PYTHON;
if (!pythonExecutable?.startsWith('/') || !process.env.ATLAS_BROWSER_EVIDENCE) throw new Error('Explicit owned Python and evidence paths required');
const evidence = resolve(process.env.ATLAS_BROWSER_EVIDENCE), origin = 'http://127.0.0.1:4318';
const fixture = await createOwnedManualFixture(process.argv.slice(2));
let server;
try {
  const connection = fixture.connect(), { auth, boundary, repository } = connection;
  await mkdir(output, { recursive: true }); await mkdir(evidence, { recursive: true });
  execFileSync(pythonExecutable, [resolve(root, '../atlas-manual-workspace/scripts/generate-preview.py'), output], { stdio: 'inherit', timeout: 30000 });
  const sampleCardId = randomUUID();
  const samples = JSON.parse(await readFile(join(output, 'fixture.json'))), assets = new Map(), sources = {}, cards = new Map();
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const limits = { maxInputBytes: 8_000_000, maxPixels: 3_000_000, maxOutputBytes: 8_000_000, timeoutMs: 15000 };
  async function retain(bytes, extension) {
    const sha256 = hash(bytes), path = join(output, `${sha256}.${extension}`);
    try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST' || hash(await readFile(path)) !== sha256) throw error; }
    assets.set(sha256, { path, contentType: extension === 'webp' ? 'image/webp' : 'image/png', extension });
    return sha256;
  }
  for (const side of ['FRONT', 'BACK']) {
    const filename = `${side.toLowerCase()}-original.png`, bytes = await readFile(join(output, filename));
    // The generated pixels are synthetic; intake and CPU preparation are real.
    const decoded = await verifyAndDecodePhoto({ bytes, limits: { ...limits, maxRasterBytes: 30_000_000 },
      uploadPlan: { schemaVersion: 1, uploadId: `synthetic-${side}`, binding: { cardId: sampleCardId, pairId: 'synthetic-pair', side, version: 1 },
        object: { key: filename, versionId: null }, expected: { sha256: hash(bytes), byteCount: bytes.length } }, observedObject: { key: filename, versionId: null } });
    const sha256 = await retain(decoded.png, 'png');
    const frame = describeDecodedFrame(decoded, { id: `${side}-verified-decoded`, object: { key: `${sha256}.png`, versionId: null } });
    sources[side] = { original: decoded.original, decodePlan: decoded.decodePlan, frame, bytes: decoded.png };
    for (const kind of ['rectified', 'inspection']) await retain(await readFile(join(output, `${side.toLowerCase()}-${kind}.png`)), 'png');
  }
  const workflow = createManualWorkflow({ repository, artifacts: fixture.artifacts, pythonExecutable,
    measurementLimits: { maxInputBytes: 8_000_000, maxOutputBytes: 16_000_000, maxFindings: 200, timeoutMs: 15000 },
    prepare: async ({ geometry, side }) => {
      const result = await prepareGeometry({ workspace: geometry, side, source: sources[side], limits, pythonExecutable });
      for (const image of Object.values(result.outputs)) await retain(image.bytes, 'webp');
      return adoptGeometryPreparation(geometry, result).state;
    } });
  const assertRequest = req => assertLocalRequest(req, { NODE_ENV: 'development', ATLAS_LOCAL_SYNTHETIC: '1' });
  const authHandler = createHandler({ auth, mode: 'SYNTHETIC_LOCAL', origin, cookies: fixture.config.cookies, assertRequest,
    cookie: (name, token, age) => `${name}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}` });
  const descriptors = ({ card, state }) => Object.fromEntries(['FRONT', 'BACK'].map(side => {
    const slot = state.geometry.sides[side], make = sha256 => {
      const asset = assets.get(sha256); if (!asset) throw new Error('Verified image missing');
      return { sha256, url: `/api/staff/manual/cards/${card.cardId}/images/${sha256}.${asset.extension}` };
    };
    return [side, { original: make(slot.image.frameSha256), ...(slot.prepared ? { rectified: make(slot.prepared.frame.rectified.sha256), inspection: make(slot.prepared.frame.inspection.sha256) } : {}) }];
  }));
  const handler = createWorkflowHandler({ workflow, boundary, origin, assertRequest, imageDescriptors: descriptors });
  async function provision(staff) {
    if (cards.has(staff.id)) return cards.get(staff.id);
    const cardId = sampleCardId;
    let geometry = createGeometryWorkspace({ cardId, profile: 'SPORTS', sides: Object.fromEntries(['FRONT', 'BACK'].map(side => {
      const source = sources[side], raster = source.frame.raster;
      return [side, { image: { version: 1, originalSha256: source.original.content.sha256, frameId: source.frame.id, frameSha256: raster.content.sha256,
        width: raster.dimensions.width, height: raster.dimensions.height, coordinateSpace: 'ORIENTED_DECODED' }, cornerShape: 'SQUARE', matColor: 'BLACK' }];
    })) });
    for (const side of ['FRONT', 'BACK']) {
      const sample = samples[side], frame = kind => ({ sha256: sample.frames[kind].sha256, width: sample.frames[kind].width, height: sample.frames[kind].height });
      geometry = applyGeometryEdit(geometry, { side, kind: 'PHYSICAL', base: geometryBase(geometry, side, 'PHYSICAL'), quad: sample.physical, actor: 'HUMAN', proposal: null }).state;
      geometry = applyPreparedFrame(geometry, { side, base: preparationBase(geometry, side), frame: { id: `${side}-synthetic-prepared`, version: 1,
        rectified: frame('rectified'), inspection: { ...frame('inspection'), cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } }, sourceToRectified: sample.matrix } }).state;
      geometry = applyGeometryEdit(geometry, { side, kind: 'PRINTED', base: geometryBase(geometry, side, 'PRINTED'), quad: sample.printed, actor: 'HUMAN', proposal: null }).state;
    }
    await workflow.provision(staff, { geometry, identity: { playerName: 'Synthetic Player', year: '2026', manufacturer: 'Fixture', productSet: 'Local test' } });
    cards.set(staff.id, cardId); return cardId;
  }
  await build({ absWorkingDir: root, entryPoints: ['dev/preview.jsx'], outdir: output, bundle: true, format: 'esm', platform: 'browser', target: ['es2022'], jsx: 'automatic' });
  await writeFile(join(output, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATLAS local manual workflow</title><link rel="stylesheet" href="/preview.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/preview.js"></script></body></html>');
  const staticFiles = { '/': ['index.html', 'text/html'], '/preview.js': ['preview.js', 'text/javascript'], '/preview.css': ['preview.css', 'text/css'] };
  server = createServer(async (req, res) => {
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
    res.send = value => { res.end(value); return res; };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      assertRequest(req);
      if (req.method === 'POST') {
        assertWrite(req, origin); let length = 0; const chunks = [], maximum = req.url.endsWith('/trace') ? 1_048_576 : 65536;
        for await (const bytes of req) { length += bytes.length; if (length > maximum) { res.status(413).json({ error: 'REQUEST_TOO_LARGE' }); return; } chunks.push(bytes); }
        req.body = JSON.parse(Buffer.concat(chunks));
      }
      if (req.url === '/api/staff/session' || /^\/api\/staff\/auth\/(request|verify|logout)$/.test(req.url)) { await authHandler(req, res); return; }
      if (req.url === '/fixture/card' && req.method === 'POST') {
        const staff = await boundary.authenticate(req.headers.cookie ?? '', req.headers['x-atlas-csrf']);
        if (Object.keys(req.body).length) throw new Error('Fixture arguments forbidden');
        res.json({ cardId: await provision(staff) }); return;
      }
      const photo = /^\/api\/staff\/manual\/cards\/([a-f0-9-]{36})\/images\/([a-f0-9]{64})\.(png|webp)$/.exec(req.url);
      if (photo && req.method === 'GET') {
        const staff = await boundary.authenticate(req.headers.cookie ?? ''), card = await workflow.service.read(staff, photo[1]), state = await workflow.hydrate(card);
        const current = Object.values(descriptors({ card, state })).flatMap(side => Object.values(side)).some(image => image.sha256 === photo[2]);
        const asset = assets.get(photo[2]); if (!current || !asset || asset.extension !== photo[3]) { res.status(404).json({ error: 'IMAGE_NOT_FOUND' }); return; }
        const bytes = await readFile(asset.path); if (hash(bytes) !== photo[2]) throw new Error('Image content changed');
        res.setHeader('Content-Type', asset.contentType); res.end(bytes); return;
      }
      if (await handler(req, res)) return;
      const file = staticFiles[req.url];
      if (req.method === 'GET' && file) { res.setHeader('Content-Type', file[1]); res.end(await readFile(join(output, file[0]))); }
      else res.status(404).json({ error: 'NOT_FOUND' });
    } catch (error) { if (!res.writableEnded) res.status(Number.isInteger(error.status) ? error.status : 503).json({ error: error.code ?? 'LOCAL_FIXTURE_UNAVAILABLE' }); }
  });
  server.requestTimeout = 60000; server.headersTimeout = 10000;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(4318, '127.0.0.1', done); });
  await writeFile(join(evidence, 'server-start.json'), JSON.stringify({ pid: process.pid, cwd: process.cwd(), origin, ownedDatabaseDirectory: fixture.cluster.directory,
    auth: 'actual DurableStaffAuth; synthetic SMS provider', at: new Date().toISOString() }, null, 2));
  console.log(`Authenticated local manual workflow: ${origin}`);
  await new Promise(done => { process.once('SIGTERM', done); process.once('SIGINT', done); });
} finally {
  if (server?.listening) await new Promise(done => server.close(done));
  await fixture.stop();
  await copyFile(join(fixture.cluster.directory, 'cleanup.json'), join(evidence, 'database-cleanup.json'));
  await writeFile(join(evidence, 'server-cleanup.json'), JSON.stringify({ pid: process.pid, serverClosed: true, databaseStoppedVerified: true, at: new Date().toISOString() }, null, 2));
}
