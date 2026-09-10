// Bootstrap-only verifier. No private runtime, native code or package imports.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const BASE_IMAGE = 'node:20.20.1-bookworm@sha256:abc255963bb4311b1f81bf45f2382df39a4041d2a975b1807d05809f1bc21bbe';
// Actual /usr/local/bin/node bytes in the pinned official amd64 base above.
export const BASE_NODE_SHA256 = 'a03953a7b16bff002b94d6fb58ada900b68241cbcaee6efc400b20dadd36dddc';
export const ENGINE_PATH = '.generated/database/libquery_engine-debian-openssl-3.0.x.so.node';
export const SHARP_PACKAGES = Object.freeze([
    ['sharp', '0.33.5'], ['@img/sharp-linux-x64', '0.33.5'], ['@img/sharp-libvips-linux-x64', '1.0.4'],
    ['color', '4.2.3'], ['detect-libc', '2.1.2'], ['semver', '7.7.2'], ['color-convert', '2.0.1'],
    ['color-string', '1.9.1'], ['color-name', '1.1.4'], ['simple-swizzle', '0.2.4'], ['is-arrayish', '0.3.4'],
]);
const REQUIRED = ['dist/server.mjs', 'dist/runtime.mjs', 'dist/build-manifest.json',
    '.generated/database/index.js', '.generated/database/package.json', '.generated/database/runtime/library.js',
    '.generated/database/schema.prisma', ENGINE_PATH, 'container/entrypoint.sh', 'container/bootstrap.mjs',
    'container/verify.mjs', 'container/smoke.mjs'];
const SHA = /^[a-f0-9]{64}$/;
const MAX_FILE = 64 * 1024 * 1024, MAX_TOTAL = 256 * 1024 * 1024, MAX_FILES = 512;
export function check(condition, code = 'ATLAS_PRIVATE_CONTAINER_INVALID') {
    if (!condition) throw Object.assign(new Error(code), { code });
}
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export function safePath(path) {
    check(typeof path === 'string' && path.length > 0 && path.length <= 400 && !isAbsolute(path)
        && /^[A-Za-z0-9_.@/+()-]+$/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..'),
    'ATLAS_PRIVATE_CONTAINER_PATH');
    return path;
}
export async function readRegular(path, limit = MAX_FILE) {
    const before = await lstat(path);
    check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= limit, 'ATLAS_PRIVATE_CONTAINER_FILE');
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await file.stat();
        check(stat.dev === before.dev && stat.ino === before.ino && stat.size <= limit, 'ATLAS_PRIVATE_CONTAINER_FILE');
        const bytes = await file.readFile(), after = await file.stat();
        check(bytes.length === stat.size && stat.size === after.size && stat.mtimeMs === after.mtimeMs
            && stat.ctimeMs === after.ctimeMs, 'ATLAS_PRIVATE_CONTAINER_CHANGED');
        return bytes;
    } finally { await file.close(); }
}
export function packageRuntimeFile(name, path) {
    safePath(path);
    if (['package.json', 'LICENSE', 'LICENSE.md', 'README.md'].includes(path)) return true;
    if (name === '@img/sharp-linux-x64') return path === 'lib/sharp-linux-x64.node';
    if (name === '@img/sharp-libvips-linux-x64') return ['lib/libvips-cpp.so.42', 'lib/index.js', 'versions.json'].includes(path);
    if (name === 'sharp' || name === 'detect-libc') return /^lib\/[A-Za-z0-9_-]+\.js$/.test(path);
    if (name === 'semver') return /^(?:index|preload)\.js$/.test(path) || /^(?:classes|functions|internal|ranges)\/[A-Za-z0-9_-]+\.js$/.test(path);
    if (name === 'color-convert') return ['index.js', 'conversions.js', 'route.js'].includes(path);
    return path === 'index.js';
}
function allowed(path) {
    if (REQUIRED.includes(path)) return true;
    return SHARP_PACKAGES.some(([name]) => path.startsWith(`node_modules/${name}/`)
        && packageRuntimeFile(name, path.slice(`node_modules/${name}/`.length)));
}
export function assertProcess({ env = process.env, execArgv = process.execArgv,
    version = process.version, platform = process.platform, arch = process.arch } = {}) {
    check(version === 'v20.20.1' && platform === 'linux' && arch === 'x64', 'ATLAS_PRIVATE_CONTAINER_PLATFORM');
    check(execArgv.length === 0 && !Object.keys(env).some(name => name === 'DEBUG'
        || name.startsWith('NODE_') && name !== 'NODE_ENV'
        || ['LD_', 'DYLD_', 'PRISMA_', 'OPENSSL_', 'SSL_CERT_'].some(prefix => name.startsWith(prefix))),
    'ATLAS_PRIVATE_CONTAINER_PROCESS');
}
export async function verifyExecutable(path = process.execPath) {
    check(digest(await readRegular(path, 256 * 1024 * 1024)) === BASE_NODE_SHA256, 'ATLAS_PRIVATE_CONTAINER_NODE_CHANGED');
}
export async function scanFiles(root, { owner = 0, readonly = true } = {}) {
    check(isAbsolute(root) && resolve(root) === root && await realpath(root) === root, 'ATLAS_PRIVATE_CONTAINER_PATH');
    const files = [], directories = [];
    async function visit(folder) {
        const stat = await lstat(folder);
        check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === owner
            && (!readonly || (stat.mode & 0o777) === 0o555), 'ATLAS_PRIVATE_CONTAINER_DIRECTORY');
        directories.push(relative(root, folder).split(sep).join('/'));
        for (const name of await readdir(folder)) {
            const full = join(folder, name), entry = await lstat(full);
            check(!entry.isSymbolicLink(), 'ATLAS_PRIVATE_CONTAINER_FILE');
            if (entry.isDirectory()) await visit(full);
            else {
                check(entry.isFile() && entry.nlink === 1 && entry.uid === owner && entry.size <= MAX_FILE
                    && (!readonly || [0o444, 0o555].includes(entry.mode & 0o777)), 'ATLAS_PRIVATE_CONTAINER_FILE');
                files.push(safePath(relative(root, full).split(sep).join('/')));
                check(files.length <= MAX_FILES, 'ATLAS_PRIVATE_CONTAINER_LIMIT');
            }
        }
    }
    await visit(root);
    return { files: files.sort(), directories: directories.sort() };
}
export async function verifyContainer(root, { owner = 0 } = {}) {
    const scanned = await scanFiles(root, { owner });
    const bytes = await readRegular(join(root, 'container-manifest.json'), 512 * 1024);
    const expected = (await readRegular(join(root, 'container/manifest.sha256'), 65)).toString('utf8');
    check(SHA.test(expected) && digest(bytes) === expected, 'ATLAS_PRIVATE_CONTAINER_MANIFEST');
    const manifest = JSON.parse(bytes.toString('utf8'));
    check(canonical(manifest) === bytes.toString('utf8') && manifest.version === 'atlas-private-container-v1'
        && manifest.baseImage === BASE_IMAGE && manifest.nodeVersion === 'v20.20.1'
        && manifest.platform === 'linux' && manifest.arch === 'x64' && manifest.candidate === 'WORKTREE'
        && SHA.test(manifest.lockHash) && SHA.test(manifest.sourceInputHash)
        && Array.isArray(manifest.files) && manifest.files.length > REQUIRED.length && manifest.files.length < MAX_FILES,
    'ATLAS_PRIVATE_CONTAINER_MANIFEST');
    const paths = manifest.files.map(row => {
        check(canonical(Object.keys(row).sort()) === canonical(['byteCount', 'mode', 'path', 'sha256'])
            && allowed(safePath(row.path)) && SHA.test(row.sha256) && Number.isSafeInteger(row.byteCount)
            && row.byteCount >= 0 && row.byteCount <= MAX_FILE
            && row.mode === (row.path === 'container/entrypoint.sh' || row.path.endsWith('.node') || row.path.endsWith('.so.42') ? 0o555 : 0o444));
        return row.path;
    });
    check(new Set(paths).size === paths.length && canonical(paths) === canonical([...paths].sort())
        && REQUIRED.every(path => paths.includes(path)) && SHARP_PACKAGES.every(([name]) => paths.includes(`node_modules/${name}/package.json`))
        && manifest.files.reduce((sum, row) => sum + row.byteCount, 0) <= MAX_TOTAL, 'ATLAS_PRIVATE_CONTAINER_CLOSURE');
    const expectedFiles = [...paths, 'container-manifest.json', 'container/manifest.sha256'].sort();
    const expectedDirs = new Set(['']);
    for (const path of expectedFiles) {
        const parts = path.split('/'); parts.pop();
        while (parts.length) { expectedDirs.add(parts.join('/')); parts.pop(); }
    }
    check(canonical(scanned.files) === canonical(expectedFiles)
        && canonical(scanned.directories) === canonical([...expectedDirs].sort()), 'ATLAS_PRIVATE_CONTAINER_UNLISTED');
    for (const row of manifest.files) {
        const path = join(root, row.path), stat = await lstat(path);
        check((stat.mode & 0o777) === row.mode && stat.size === row.byteCount
            && digest(await readRegular(path)) === row.sha256, 'ATLAS_PRIVATE_CONTAINER_CHANGED');
    }
    for (const [name, version] of SHARP_PACKAGES) {
        const pkg = JSON.parse((await readRegular(join(root, 'node_modules', name, 'package.json'))).toString('utf8'));
        check(pkg.name === name && pkg.version === version, 'ATLAS_PRIVATE_CONTAINER_DEPENDENCY');
    }
    check(canonical(await scanFiles(root, { owner })) === canonical(scanned), 'ATLAS_PRIVATE_CONTAINER_CHANGED');
    return Object.freeze({ manifestHash: expected, manifest });
}
