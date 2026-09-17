import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describeDecodedFrame, verifyAndDecodePhoto } from '@atlas/photo-runtime';
import { prepareGeometry } from '@atlas/preparation-runtime';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist/preview');
await mkdir(output, { recursive: true });
execFileSync(process.env.ATLAS_FIXTURE_PYTHON || 'python3', [resolve(root, 'scripts/generate-preview.py'), output], { stdio: 'inherit', timeout: 30000 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const limits = { maxInputBytes: 8_000_000, maxPixels: 3_000_000, maxOutputBytes: 8_000_000, timeoutMs: 10000 };
const sources = {}, fixture = JSON.parse(await readFile(resolve(output, 'fixture.json')));
const immutable = async (filename, bytes) => {
  try { await writeFile(resolve(output, filename), bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST' || sha(await readFile(resolve(output, filename))) !== sha(bytes)) throw error; }
};
for (const side of ['FRONT','BACK']) {
  const originalKey = `${side.toLowerCase()}-original.png`, bytes = await readFile(resolve(output, originalKey));
  const decoded = await verifyAndDecodePhoto({ bytes, limits: { ...limits, maxRasterBytes: 30_000_000 },
    uploadPlan: { schemaVersion: 1, uploadId: `synthetic-${side}`, binding: { cardId: 'synthetic-component-fixture', pairId: 'synthetic-pair', side, version: 1 },
      object: { key: originalKey, versionId: null }, expected: { sha256: sha(bytes), byteCount: bytes.length } },
    observedObject: { key: originalKey, versionId: null } });
  const filename = `${decoded.raster.content.sha256}.png`;
  await immutable(filename, decoded.png);
  const frame = describeDecodedFrame(decoded, { id: `${side}-verified-decoded`, object: { key: filename, versionId: null } });
  sources[side] = { original: decoded.original, decodePlan: decoded.decodePlan, frame, bytes: decoded.png };
  fixture[side].photoSource = { original: decoded.original, decodePlan: decoded.decodePlan, frame };
  fixture[side].frames.original = { url: `/${filename}`, sha256: frame.raster.content.sha256, ...frame.raster.dimensions };
}
await writeFile(resolve(output, 'fixture.json'), JSON.stringify(fixture));
await build({ absWorkingDir: root, entryPoints: ['dev/preview.jsx'], outdir: output, bundle: true, format: 'esm', platform: 'browser', target: ['es2022'], jsx: 'automatic' });
await writeFile(resolve(output, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATLAS synthetic geometry test</title><link rel="stylesheet" href="/preview.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/preview.js"></script></body></html>');
const allowed = new Set(await readdir(output));
const types = { png: 'image/png', json: 'application/json', css: 'text/css', js: 'text/javascript', html: 'text/html' };
types.webp = 'image/webp';
const active = new Set();
const server = createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/prepare') {
    if (request.headers.origin !== `http://127.0.0.1:${server.address().port}` || active.size >= 2) { response.writeHead(403); response.end(); return; }
    const controller = new AbortController(); active.add(controller);
    const disconnected = () => { if (!response.writableFinished) controller.abort(); };
    response.on('close', disconnected);
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 32768) throw new Error('request limit'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks));
      if (!['FRONT','BACK'].includes(body.side)) throw new Error('side');
      const result = await prepareGeometry({ workspace: body.workspace, side: body.side, source: sources[body.side], limits,
        pythonExecutable: process.env.ATLAS_FIXTURE_PYTHON, signal: controller.signal });
      for (const outputImage of Object.values(result.outputs)) {
        const filename = `${outputImage.sha256}.webp`;
        await immutable(filename, outputImage.bytes); allowed.add(filename);
      }
      const { outputs, ...verifiedResult } = result;
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(verifiedResult));
    } catch { if (!response.destroyed) { response.writeHead(400); response.end(JSON.stringify({ error: 'Preparation did not complete' })); } }
    finally { response.off('close', disconnected); active.delete(controller); }
    return;
  }
  const requestPath = request.url?.split('?')[0];
  const path = requestPath === '/' ? 'index.html' : requestPath?.slice(1);
  if (request.method !== 'GET' || !allowed.has(path)) { response.writeHead(404); response.end(); return; }
  try { response.writeHead(200, { 'Content-Type': types[path.split('.').at(-1)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(await readFile(resolve(output, path))); }
  catch { response.writeHead(500); response.end(); }
});
server.listen(Number(process.env.ATLAS_PREVIEW_PORT || 4179), '127.0.0.1', () => process.stdout.write(`Synthetic geometry preview: http://127.0.0.1:${server.address().port}\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const controller of active) controller.abort(); server.close(); });
