import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(app, '../..');
const { build, version } = await import(pathToFileURL(resolve(root, 'node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/lib/main.js')).href);
assert.equal(version, '0.27.7');
await mkdir(resolve(app, 'dist'), { recursive: true });
const output = await build({ absWorkingDir: root, entryPoints: [resolve(app, 'src/server.ts'), resolve(app, 'src/runtime.ts')],
    outdir: resolve(app, 'dist'), outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
    target: 'node20', metafile: true, sourcemap: false, logLevel: 'silent', external: ['sharp'],
    banner: { js: 'import { createRequire as __atlasCreateRequire } from "node:module"; const require = __atlasCreateRequire(import.meta.url);' },
    plugins: [{ name: 'private-database-only', setup(builder) {
        builder.onResolve({ filter: /^@tenkings\/database$/ }, () => ({ path: resolve(app, 'src/forbidden-database.mjs') }));
        builder.onResolve({ filter: /(?:^@prisma\/client$|\.generated\/database\/index\.js$)/ }, () => ({ path: '../.generated/database/index.js', external: true }));
    } }] });
const inputs = [];
for (const [name] of Object.entries(output.metafile.inputs)) {
    assert(!/(?:^|\/)pages\//.test(name) && !name.includes('packages/database/src/'), `Unexpected private host dependency: ${name}`);
    const path = resolve(root, name), bytes = await readFile(path);
    inputs.push({ path: relative(root, path), sha256: createHash('sha256').update(bytes).digest('hex'), byteCount: bytes.length });
}
const external = [...new Set(Object.values(output.metafile.outputs).flatMap(value => value.imports.filter(item => item.external).map(item => item.path)))].sort();
assert(external.every(name => name.startsWith('node:') || ['assert', 'async_hooks', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'os', 'path', 'process', 'stream', 'string_decoder', 'url', 'util', 'zlib', 'sharp', '../.generated/database/index.js'].includes(name)), external.join(','));
const manifest = { version: 'atlas-private-build-v1', bundler: `esbuild@${version}`, inputs: inputs.sort((a, b) => a.path.localeCompare(b.path)), external };
await writeFile(resolve(app, 'dist/build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(JSON.stringify({ status: 'ATLAS_PRIVATE_BUILD_PASS', inputs: inputs.length, external }) + '\n');
