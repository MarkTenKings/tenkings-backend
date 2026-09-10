import { createHash } from 'node:crypto';
import { chmod, mkdir, realpath, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { assertClosedNative } from '../../../packages/atlas-operator/src/release-artifact.mjs';
import { BASE_IMAGE, ENGINE_PATH, SHARP_PACKAGES, canonical, check, digest, packageRuntimeFile,
    readRegular, safePath, scanFiles, verifyContainer } from '../container/verify.mjs';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..'), checkout = resolve(app, '../..');
const BUILTINS = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const EDGES = Object.freeze({ sharp: ['color', 'detect-libc', 'semver', '@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64'],
    '@img/sharp-linux-x64': ['@img/sharp-libvips-linux-x64'], color: ['color-convert', 'color-string'],
    'color-convert': ['color-name'], 'color-string': ['color-name', 'simple-swizzle'], 'simple-swizzle': ['is-arrayish'] });
function lockBlock(section, key) {
    const rows = section.split('\n'), index = rows.findIndex(line => line === `  ${key}:` || line === `  '${key}':`
        || line === `  ${key}: {}` || line === `  '${key}': {}`);
    check(index >= 0, 'ATLAS_PRIVATE_LOCK_MISSING');
    let end = index + 1;
    while (end < rows.length && !/^  [^ ]/.test(rows[end])) end++;
    return rows.slice(index, end).join('\n');
}
export function lockedPackages(lock) {
    const split = lock.split('\nsnapshots:\n');
    check(split.length === 2 && split[0].includes('\npackages:\n'), 'ATLAS_PRIVATE_LOCK_INVALID');
    return SHARP_PACKAGES.map(([name, version]) => {
        const key = `${name}@${version}`, definition = lockBlock(split[0].split('\npackages:\n')[1], key);
        const match = definition.match(/\n    resolution: \{integrity: (sha512-[A-Za-z0-9+/]{86}==)\}/);
        check(match, 'ATLAS_PRIVATE_LOCK_INTEGRITY');
        const snapshot = lockBlock(split[1], key), dependencies = [];
        let section;
        for (const line of snapshot.split('\n').slice(1)) {
            const heading = line.match(/^    (dependencies|optionalDependencies):$/);
            if (heading) { section = heading[1]; continue; }
            if (/^    [^ ]/.test(line)) section = undefined;
            const edge = line.match(/^      '?([^': ]+)'?: ([0-9]+\.[0-9]+\.[0-9]+)$/);
            if (!edge || !section) continue;
            const supported = SHARP_PACKAGES.find(([candidate]) => candidate === edge[1]);
            if (section === 'dependencies' || supported) {
                check(supported && supported[1] === edge[2], 'ATLAS_PRIVATE_LOCK_CLOSURE');
                dependencies.push(edge[1]);
            }
        }
        check(canonical(dependencies.sort()) === canonical([...(EDGES[name] ?? [])].sort()), 'ATLAS_PRIVATE_LOCK_CLOSURE');
        return { name, version, integrity: match[1] };
    });
}
export function verifyTarball(bytes, integrity) {
    check(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 16 * 1024 * 1024
        && /^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)
        && `sha512-${createHash('sha512').update(bytes).digest('base64')}` === integrity, 'ATLAS_PRIVATE_TARBALL_INTEGRITY');
}
function octal(bytes) {
    const value = bytes.toString('ascii').replace(/\0.*$/, '').trim();
    check(/^[0-7]+$/.test(value), 'ATLAS_PRIVATE_TAR_FORMAT');
    const result = Number.parseInt(value, 8);
    check(Number.isSafeInteger(result), 'ATLAS_PRIVATE_TAR_FORMAT'); return result;
}
function tarText(bytes) {
    const zero = bytes.indexOf(0), raw = zero < 0 ? bytes : bytes.subarray(0, zero);
    check(raw.every(value => value >= 0x20 && value <= 0x7e), 'ATLAS_PRIVATE_TAR_FORMAT');
    return raw.toString('ascii');
}
/** The eleven exact npm archives contain ordinary USTAR files only. Reject
 * links, PAX/GNU metadata and special files instead of invoking tar or scripts.
 */
export function unpackTarball(bytes) {
    const tar = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }), files = new Map();
    check(tar.length % 512 === 0 && tar.length >= 1024, 'ATLAS_PRIVATE_TAR_FORMAT');
    let offset = 0, ended = false;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every(value => value === 0)) {
            check(offset + 1024 <= tar.length && tar.subarray(offset).every(value => value === 0), 'ATLAS_PRIVATE_TAR_FORMAT');
            ended = true; break;
        }
        const sum = [...header].reduce((n, value, index) => n + (index >= 148 && index < 156 ? 32 : value), 0);
        check(octal(header.subarray(148, 156)) === sum && tarText(header.subarray(257, 263)) === 'ustar', 'ATLAS_PRIVATE_TAR_FORMAT');
        check(header[156] === 48 || header[156] === 0, 'ATLAS_PRIVATE_TAR_SPECIAL');
        check(!tarText(header.subarray(157, 257)), 'ATLAS_PRIVATE_TAR_SPECIAL');
        const prefix = tarText(header.subarray(345, 500)), name = `${prefix ? `${prefix}/` : ''}${tarText(header.subarray(0, 100))}`;
        check(name.startsWith('package/'), 'ATLAS_PRIVATE_TAR_PATH');
        const path = safePath(name.slice(8)), size = octal(header.subarray(124, 136));
        check(size <= 64 * 1024 * 1024 && offset + 512 + size <= tar.length && !files.has(path), 'ATLAS_PRIVATE_TAR_FORMAT');
        files.set(path, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
        check(files.size <= 256, 'ATLAS_PRIVATE_TAR_FORMAT');
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    check(ended && files.has('package.json'), 'ATLAS_PRIVATE_TAR_FORMAT'); return files;
}
async function sourceFile(root, path) {
    safePath(path); const full = join(root, path);
    check(await realpath(full) === full && full.startsWith(`${root}${sep}`), 'ATLAS_PRIVATE_SOURCE_PATH');
    return readRegular(full);
}
export async function validateBuildInputs(root, manifest) {
    check(manifest.version === 'atlas-private-build-v1' && manifest.bundler === 'esbuild@0.27.7'
        && Array.isArray(manifest.inputs) && manifest.inputs.length > 0 && manifest.inputs.length <= 2000
        && Array.isArray(manifest.external) && manifest.external.every(name => BUILTINS.has(name)
            || ['sharp', '../.generated/database/index.js'].includes(name)), 'ATLAS_PRIVATE_BUILD_INVALID');
    const paths = new Set();
    for (const row of manifest.inputs) {
        check(!paths.has(row.path) && !/(?:^|\/)pages\//.test(row.path) && !row.path.includes('packages/database/src/'), 'ATLAS_PRIVATE_BUILD_INVALID');
        paths.add(row.path);
        const bytes = await sourceFile(root, row.path);
        check(bytes.length === row.byteCount && digest(bytes) === row.sha256, 'ATLAS_PRIVATE_BUILD_STALE');
    }
    return digest(canonical(manifest.inputs));
}
export function schemaTokens(text) {
    return (text.match(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_]\w*|\d+(?:\.\d+)?|[^\s]/g) ?? [])
        .filter(token => !token.startsWith('//') && !token.startsWith('/*'));
}
export function schemaSignature(text) {
    // Prisma's formatter reorders @@unique/@@index attributes. Their complete
    // tokens are compared per model; all fields and constraint contents remain.
    return text.replace(/^(model|enum)\s+(\w+)\s*\{\r?\n([\s\S]*?)^\}/gm, (_match, kind, name, body) => {
        const attributes = [];
        const fields = body.replace(/^[ \t]*@@[^\r\n]+/gm, attribute => { attributes.push(canonical(schemaTokens(attribute))); return ''; });
        return `${kind} ${name} ${canonical(schemaTokens(fields))} ${canonical(attributes.sort())}`;
    });
}
function models(text, schema) {
    const rows = [...text.matchAll(/^(model|enum)\s+(\w+)\s*\{\r?\n([\s\S]*?)^\}/gm)];
    check(rows.length > 0 && rows.every(row => !row[3].includes('@@schema(')), 'ATLAS_PRIVATE_SCHEMA_CHANGED');
    return rows.map(row => `${row[1]} ${row[2]} {\n${row[3]} @@schema("${schema}")\n}`).join('\n');
}
export function validateClient(client, schema, legacy, staff) {
    const match = client.match(/const config = (\{[\s\S]+?\n\})\n/);
    check(match, 'ATLAS_PRIVATE_CLIENT_CHANGED'); const config = JSON.parse(match[1]);
    check(config.clientVersion === '5.22.0' && config.engineVersion === '605197351a3c8bdd595af2d2a9bc3025bca48ea2'
        && config.generator?.config?.engineType === 'library' && config.activeProvider === 'postgresql'
        && canonical(config.datasourceNames) === canonical(['db'])
        && canonical(config.relativeEnvPaths) === canonical({ rootEnvPath: null })
        && canonical(config.inlineDatasources) === canonical({ db: { url: { fromEnvVar: 'ATLAS_PRIVATE_SOURCE_DATABASE_URL', value: null } } })
        && config.inlineSchema === schema, 'ATLAS_PRIVATE_CLIENT_CHANGED');
    const expected = `generator client { provider = "prisma-client-js" output = "../.generated/database"
        previewFeatures = ["multiSchema"] binaryTargets = ["native", "debian-openssl-3.0.x", "rhel-openssl-3.0.x"] }
        datasource db { provider = "postgresql" url = env("ATLAS_PRIVATE_SOURCE_DATABASE_URL") schemas = ["public", "atlas_staff"] }
\n${models(legacy, 'public')}\n${models(staff, 'atlas_staff')}`;
    check(canonical(schemaTokens(schemaSignature(schema))) === canonical(schemaTokens(schemaSignature(expected))), 'ATLAS_PRIVATE_SCHEMA_STALE');
}
async function archive(row, cache, download) {
    const name = `${row.name.replaceAll('/', '__')}-${row.version}.tgz`, path = join(cache, name);
    let bytes;
    try { bytes = await readRegular(path, 16 * 1024 * 1024); }
    catch (error) {
        if (error.code !== 'ENOENT' || !download) throw error;
        const base = row.name.split('/').at(-1);
        const response = await fetch(`https://registry.npmjs.org/${row.name}/-/${base}-${row.version}.tgz`, {
            redirect: 'error', signal: AbortSignal.timeout(30_000),
        });
        check(response.ok && Number(response.headers.get('content-length')) <= 16 * 1024 * 1024, 'ATLAS_PRIVATE_DOWNLOAD_FAILED');
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length; check(size <= 16 * 1024 * 1024, 'ATLAS_PRIVATE_DOWNLOAD_FAILED'); chunks.push(chunk);
        }
        bytes = Buffer.concat(chunks); verifyTarball(bytes, row.integrity);
        await writeFile(path, bytes, { flag: 'wx', mode: 0o444 });
    }
    verifyTarball(bytes, row.integrity); return bytes;
}
async function seal(root) {
    const { directories } = await scanFiles(root, { owner: process.getuid(), readonly: false });
    for (const path of directories.reverse()) await chmod(join(root, path), 0o555);
}
export async function writeContext({ output, files, metadata, dockerfile }) {
    check(isAbsolute(output) && resolve(output) === output && await realpath(dirname(output)) === dirname(output), 'ATLAS_PRIVATE_OUTPUT_PATH');
    await mkdir(output, { mode: 0o755 });
    const root = join(output, 'app'); await mkdir(root, { mode: 0o700 });
    const rows = [];
    for (const [path, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        safePath(path); check(Buffer.isBuffer(bytes), 'ATLAS_PRIVATE_CONTAINER_FILE');
        const mode = path === 'container/entrypoint.sh' || path.endsWith('.node') || path.endsWith('.so.42') ? 0o555 : 0o444;
        await mkdir(dirname(join(root, path)), { recursive: true, mode: 0o700 });
        await writeFile(join(root, path), bytes, { flag: 'wx', mode }); await chmod(join(root, path), mode);
        rows.push({ path, sha256: digest(bytes), byteCount: bytes.length, mode });
    }
    const manifest = { version: 'atlas-private-container-v1', baseImage: BASE_IMAGE, nodeVersion: 'v20.20.1',
        platform: 'linux', arch: 'x64', candidate: 'WORKTREE', ...metadata, files: rows };
    const bytes = Buffer.from(canonical(manifest)), manifestHash = digest(bytes);
    await writeFile(join(root, 'container-manifest.json'), bytes, { flag: 'wx', mode: 0o444 });
    await writeFile(join(root, 'container/manifest.sha256'), manifestHash, { flag: 'wx', mode: 0o444 });
    await writeFile(join(output, 'Dockerfile'), dockerfile, { flag: 'wx', mode: 0o444 });
    await writeFile(join(output, '.dockerignore'), '*\n!Dockerfile\n!app\n!app/**\n', { flag: 'wx', mode: 0o444 });
    await seal(root); await verifyContainer(root, { owner: process.getuid() });
    return { output, manifestHash, files: rows.length, bytes: rows.reduce((sum, row) => sum + row.byteCount, 0) };
}
export async function packageContainer({ output, cache, download = false, root = checkout }) {
    check(isAbsolute(root) && await realpath(root) === root && isAbsolute(output)
        && !output.startsWith(`${root}${sep}`) && output !== root, 'ATLAS_PRIVATE_OUTPUT_PATH');
    check(isAbsolute(cache) && await realpath(cache) === cache, 'ATLAS_PRIVATE_CACHE_PATH');
    const watched = new Map(), files = new Map();
    const read = async path => { const bytes = await sourceFile(root, path); watched.set(path, digest(bytes)); return bytes; };
    const prefix = 'backend/atlas-private';
    for (const path of ['dist/server.mjs', 'dist/runtime.mjs', 'dist/build-manifest.json',
        '.generated/database/index.js', '.generated/database/package.json', '.generated/database/schema.prisma',
        '.generated/database/runtime/library.js', ENGINE_PATH, 'container/entrypoint.sh', 'container/bootstrap.mjs', 'container/verify.mjs', 'container/smoke.mjs']) {
        files.set(path, await read(`${prefix}/${path}`));
    }
    const build = JSON.parse(files.get('dist/build-manifest.json').toString('utf8'));
    const sourceInputHash = await validateBuildInputs(root, build);
    const lock = await read('pnpm-lock.yaml'), packages = lockedPackages(lock.toString('utf8'));
    const legacy = await read('packages/database/prisma/schema.prisma'), staff = await read('frontend/atlas-app/prisma/schema.prisma');
    validateClient(files.get('.generated/database/index.js').toString('utf8'), files.get('.generated/database/schema.prisma').toString('utf8'),
        legacy.toString('utf8'), staff.toString('utf8'));
    check(JSON.parse(files.get('.generated/database/package.json').toString('utf8')).version === '5.22.0', 'ATLAS_PRIVATE_CLIENT_CHANGED');
    const runtime = await read('node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client/runtime/library.js');
    check(runtime.equals(files.get('.generated/database/runtime/library.js')), 'ATLAS_PRIVATE_CLIENT_CHANGED');
    const engineDependencies = assertClosedNative(files.get(ENGINE_PATH), { platform: 'linux', arch: 'x64', kind: 'library' });
    for (const row of packages) {
        const unpacked = unpackTarball(await archive(row, cache, download));
        const pkg = JSON.parse(unpacked.get('package.json').toString('utf8'));
        check(pkg.name === row.name && pkg.version === row.version, 'ATLAS_PRIVATE_PACKAGE_CHANGED');
        for (const [path, bytes] of unpacked) if (packageRuntimeFile(row.name, path)) files.set(`node_modules/${row.name}/${path}`, bytes);
    }
    const dockerfile = await read(`${prefix}/Dockerfile`);
    await read(`${prefix}/scripts/package-container.mjs`);
    const git = args => {
        const result = spawnSync('/usr/bin/git', ['-C', root, ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
        check(result.status === 0 && /^[a-f0-9]{40}\n?$/.test(result.stdout), 'ATLAS_PRIVATE_SOURCE_REVISION'); return result.stdout.trim();
    };
    const metadata = { sourceCommit: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']), sourceInputHash,
        lockHash: digest(lock), packages, prisma: { version: '5.22.0', engineDependencies,
            canonicalPublicSchemaHash: digest(legacy), canonicalStaffSchemaHash: digest(staff) },
        packagingInputs: [...watched].map(([path, sha256]) => ({ path, sha256 })).sort((a, b) => a.path.localeCompare(b.path)),
        dockerfileHash: digest(dockerfile) };
    // Catch an in-flight source/client edit after dependency extraction as well.
    await validateBuildInputs(root, build);
    for (const [path, sha256] of watched) check(digest(await sourceFile(root, path)) === sha256, 'ATLAS_PRIVATE_SOURCE_CHANGED');
    return writeContext({ output, files, metadata, dockerfile });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2), options = {};
        for (let n = 0; n < args.length; n++) {
            const key = args[n];
            check(['--output', '--cache', '--download'].includes(key), 'ATLAS_PRIVATE_PACKAGE_ARGUMENT');
            const name = key.slice(2); check(!(name in options), 'ATLAS_PRIVATE_PACKAGE_ARGUMENT');
            options[name] = name === 'download' ? true : args[++n];
        }
        check(typeof options.output === 'string' && typeof options.cache === 'string', 'ATLAS_PRIVATE_PACKAGE_ARGUMENT');
        const result = await packageContainer(options);
        process.stdout.write(JSON.stringify({ status: 'ATLAS_PRIVATE_CONTAINER_PACKAGED', ...result }) + '\n');
    } catch (error) {
        process.stderr.write(`${/^ATLAS_PRIVATE_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'ATLAS_PRIVATE_PACKAGE_REJECTED'}\n`);
        process.exitCode = 1;
    }
}
