import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { lockedPackages, unpackTarball, validateBuildInputs, validateClient, verifyTarball, writeContext } from '../scripts/package-container.mjs';
import { digest, ENGINE_PATH, packageRuntimeFile, SHARP_PACKAGES, verifyContainer } from '../container/verify.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
async function temporary(t) {
    const path = await realpath(await mkdtemp(join(tmpdir(), 'atlas-private-container-test-')));
    async function unlock(folder) {
        await chmod(folder, 0o755);
        for (const entry of await readdir(folder, { withFileTypes: true })) if (entry.isDirectory()) await unlock(join(folder, entry.name));
    }
    t.after(async () => { await unlock(path); await rm(path, { recursive: true }); });
    return path;
}
function archive(entries) {
    const pieces = [];
    for (const [name, value = '{}', type = '0'] of entries) {
        const data = Buffer.from(value), header = Buffer.alloc(512);
        header.write(name); header.write('0000444\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
        header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
        header.fill(32, 148, 156); header.write(type, 156); header.write('ustar\0', 257); header.write('00', 263);
        const sum = [...header].reduce((a, b) => a + b, 0);
        header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
        pieces.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
    }
    return gzipSync(Buffer.concat([...pieces, Buffer.alloc(1024)]));
}
function fixtureFiles() {
    const files = new Map();
    for (const path of ['dist/server.mjs', 'dist/runtime.mjs', 'dist/build-manifest.json',
        '.generated/database/index.js', '.generated/database/package.json', '.generated/database/runtime/library.js',
        '.generated/database/schema.prisma', ENGINE_PATH, 'container/entrypoint.sh', 'container/bootstrap.mjs',
        'container/verify.mjs', 'container/smoke.mjs']) files.set(path, Buffer.from('fixture bytes; never loaded'));
    for (const [name, version] of SHARP_PACKAGES) files.set(`node_modules/${name}/package.json`, Buffer.from(JSON.stringify({ name, version })));
    return files;
}
async function context(t) {
    const parent = await temporary(t), output = join(parent, 'context');
    const result = await writeContext({ output, files: fixtureFiles(), dockerfile: Buffer.from('# fixture'),
        metadata: { sourceInputHash: '1'.repeat(64), lockHash: '2'.repeat(64) } });
    return { ...result, app: join(output, 'app') };
}

test('locked Linux Sharp closure resolves all eleven exact versions and rejects changed snapshot edges', async () => {
    const lock = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
    const packages = lockedPackages(lock);
    assert.deepEqual(packages.map(({ name, version }) => [name, version]), SHARP_PACKAGES);
    const bad = lock.replace('      color: 4.2.3\n      detect-libc: 2.1.2', '      color: 4.2.3\n      detect-libc: 2.1.3');
    assert.throws(() => lockedPackages(bad), { code: 'ATLAS_PRIVATE_LOCK_CLOSURE' });
});
test('archives require exact SHA512 integrity before extraction', () => {
    const bytes = archive([['package/package.json']]);
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    verifyTarball(bytes, integrity);
    assert.throws(() => verifyTarball(Buffer.concat([bytes, Buffer.from('changed')]), integrity), { code: 'ATLAS_PRIVATE_TARBALL_INTEGRITY' });
});
test('bounded USTAR reader rejects traversal, duplicate entries, symlinks and header corruption', () => {
    assert.equal(unpackTarball(archive([['package/package.json']])).get('package.json').toString(), '{}');
    for (const entries of [[['package/../secret'], ['package/package.json']], [['/absolute'], ['package/package.json']],
        [['package/package.json'], ['package/package.json']], [['package/package.json', '{}', '2']],
        [['package/package.json', '{}', 'x']]]) assert.throws(() => unpackTarball(archive(entries)));
    assert.throws(() => unpackTarball(Buffer.from('not a gzip archive')));
    const corrupt = gunzipSync(archive([['package/package.json']])); corrupt[100] = 55;
    assert.throws(() => unpackTarball(gzipSync(corrupt)), { code: 'ATLAS_PRIVATE_TAR_FORMAT' });
});
test('runtime selection includes color conversion modules and excludes install scripts, headers and other architectures', () => {
    assert(packageRuntimeFile('color-convert', 'conversions.js')); assert(packageRuntimeFile('color-convert', 'route.js'));
    assert(packageRuntimeFile('sharp', 'lib/input.js'));
    assert(!packageRuntimeFile('sharp', 'install/check.js'));
    assert(!packageRuntimeFile('@img/sharp-libvips-linux-x64', 'lib/glib-2.0/include/glibconfig.h'));
    assert(!packageRuntimeFile('@img/sharp-linux-x64', 'lib/sharp-darwin-arm64.node'));
});
test('bundle source hash changes, unsupported externals and legacy authority imports fail packaging', async t => {
    const base = await temporary(t), path = 'src/runtime.mjs', bytes = Buffer.from('export const fixture = true;');
    await mkdir(join(base, 'src')); await writeFile(join(base, path), bytes);
    const manifest = { version: 'atlas-private-build-v1', bundler: 'esbuild@0.27.7',
        inputs: [{ path, sha256: digest(bytes), byteCount: bytes.length }], external: ['node:fs', 'sharp'] };
    assert.match(await validateBuildInputs(base, manifest), /^[a-f0-9]{64}$/);
    await writeFile(join(base, path), 'changed');
    await assert.rejects(validateBuildInputs(base, manifest), { code: 'ATLAS_PRIVATE_BUILD_STALE' });
    await assert.rejects(validateBuildInputs(base, { ...manifest, external: ['@tenkings/database'] }), { code: 'ATLAS_PRIVATE_BUILD_INVALID' });
    await assert.rejects(validateBuildInputs(base, { ...manifest, inputs: [{ ...manifest.inputs[0], path: 'pages/api/legacy.js' }] }), { code: 'ATLAS_PRIVATE_BUILD_INVALID' });
});
test('combined client binds canonical public/staff models, no inline URL, and exact library version', () => {
    const legacy = 'model Public {\n id String @id\n @@index([id])\n @@unique([id])\n}', staff = 'model Staff {\n id String @id\n}';
    const schema = 'generator client { provider = "prisma-client-js" output = "../.generated/database" previewFeatures = ["multiSchema"] binaryTargets = ["native", "debian-openssl-3.0.x", "rhel-openssl-3.0.x"] }\n'
        + 'datasource db { provider = "postgresql" url = env("ATLAS_PRIVATE_SOURCE_DATABASE_URL") schemas = ["public", "atlas_staff"] }\n'
        + 'model Public {\n id String @id\n @@unique([id])\n @@index([id])\n @@schema("public")\n}\n'
        + 'model Staff {\n id String @id\n @@schema("atlas_staff")\n}';
    const config = { clientVersion: '5.22.0', engineVersion: '605197351a3c8bdd595af2d2a9bc3025bca48ea2', generator: { config: { engineType: 'library' } },
        activeProvider: 'postgresql', datasourceNames: ['db'], relativeEnvPaths: { rootEnvPath: null },
        inlineDatasources: { db: { url: { fromEnvVar: 'ATLAS_PRIVATE_SOURCE_DATABASE_URL', value: null } } }, inlineSchema: schema };
    const client = value => `const config = ${JSON.stringify(value, null, 2)}\n`;
    validateClient(client(config), schema, legacy, staff);
    assert.throws(() => validateClient(client(config), schema, legacy, staff.replace('String', 'Int')), { code: 'ATLAS_PRIVATE_SCHEMA_STALE' });
    assert.throws(() => validateClient(client({ ...config, clientVersion: '5.23.0' }), schema, legacy, staff), { code: 'ATLAS_PRIVATE_CLIENT_CHANGED' });
    assert.throws(() => validateClient(client({ ...config, inlineDatasources: { db: { url: { value: 'postgresql://fixture.invalid/db' } } } }), schema, legacy, staff), { code: 'ATLAS_PRIVATE_CLIENT_CHANGED' });
});
test('container inventory is sealed and rejects a replaced runtime before importing it', async t => {
    const result = await context(t), options = { owner: process.getuid() };
    assert.equal((await verifyContainer(result.app, options)).manifestHash, result.manifestHash);
    const runtime = join(result.app, 'dist/runtime.mjs');
    await chmod(runtime, 0o644); await writeFile(runtime, 'throw new Error("must never be loaded")'); await chmod(runtime, 0o444);
    await assert.rejects(verifyContainer(result.app, options), { code: 'ATLAS_PRIVATE_CONTAINER_CHANGED' });
});
test('extra files, symlinks and writable/foreign-owned container trees are rejected', async t => {
    const result = await context(t), options = { owner: process.getuid() };
    await assert.rejects(verifyContainer(result.app, { owner: process.getuid() + 1 }), { code: 'ATLAS_PRIVATE_CONTAINER_DIRECTORY' });
    await chmod(result.app, 0o755);
    await assert.rejects(verifyContainer(result.app, options), { code: 'ATLAS_PRIVATE_CONTAINER_DIRECTORY' });
    await writeFile(join(result.app, '.env'), 'fixture-only'); await chmod(join(result.app, '.env'), 0o444); await chmod(result.app, 0o555);
    await assert.rejects(verifyContainer(result.app, options), { code: 'ATLAS_PRIVATE_CONTAINER_UNLISTED' });
    await chmod(result.app, 0o755); await rm(join(result.app, '.env')); await symlink('dist/runtime.mjs', join(result.app, 'extra')); await chmod(result.app, 0o555);
    await assert.rejects(verifyContainer(result.app, options), { code: 'ATLAS_PRIVATE_CONTAINER_FILE' });
});
test('writer refuses to overwrite an existing context', async t => {
    const result = await context(t);
    await assert.rejects(writeContext({ output: result.output, files: fixtureFiles(), metadata: {}, dockerfile: Buffer.from('fixture') }), { code: 'EEXIST' });
});
