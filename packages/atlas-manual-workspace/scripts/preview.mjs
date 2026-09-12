import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist/preview');
await mkdir(output, { recursive: true });
execFileSync(process.env.ATLAS_FIXTURE_PYTHON || 'python3', [resolve(root, 'scripts/generate-preview.py'), output], { stdio: 'inherit', timeout: 30000 });
await build({ absWorkingDir: root, entryPoints: ['dev/preview.jsx'], outdir: output, bundle: true, format: 'esm', platform: 'browser', target: ['es2022'], jsx: 'automatic' });
await writeFile(resolve(output, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATLAS synthetic geometry test</title><link rel="stylesheet" href="/preview.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/preview.js"></script></body></html>');
const allowed = new Set(await readdir(output));
const types = { png: 'image/png', json: 'application/json', css: 'text/css', js: 'text/javascript', html: 'text/html' };
const server = createServer(async (request, response) => {
  const path = request.url === '/' ? 'index.html' : request.url?.slice(1);
  if (request.method !== 'GET' || !allowed.has(path)) { response.writeHead(404); response.end(); return; }
  try { response.writeHead(200, { 'Content-Type': types[path.split('.').at(-1)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(await readFile(resolve(output, path))); }
  catch { response.writeHead(500); response.end(); }
});
server.listen(Number(process.env.ATLAS_PREVIEW_PORT || 4179), '127.0.0.1', () => process.stdout.write('Synthetic geometry preview: http://127.0.0.1:4179\n'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
