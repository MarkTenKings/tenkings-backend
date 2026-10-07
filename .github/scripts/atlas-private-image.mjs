// Release validation only. No application activation, database connection or
// provider credential is accepted by this helper.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readlink, realpath, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { BASE_IMAGE, BASE_NODE_SHA256, ENGINE_PATH, canonical, digest, readRegular, verifyContainer } from '../../backend/atlas-private/container/verify.mjs';
import { validateBuildInputs } from '../../backend/atlas-private/scripts/package-container.mjs';

const sha = /^[a-f0-9]{40}$/, oci = /^sha256:[a-f0-9]{64}$/;
function command(program, args, { input, status = 0, timeout = 120_000 } = {}) {
    const result = spawnSync(program, args, { input, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    assert(!result.error, result.error?.message); assert.equal(result.status, status, `${program} failed: ${result.stderr}`);
    return result.stdout;
}
async function json(path) { return JSON.parse((await readRegular(path, 16 * 1024 * 1024)).toString('utf8')); }
async function save(path, value) {
    assert(isAbsolute(path) && resolve(path) === path && await realpath(dirname(path)) === dirname(path));
    await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

export async function cleanSource(root, expectedSha) {
    assert(sha.test(expectedSha) && isAbsolute(root) && await realpath(root) === root);
    const git = args => command('git', ['-C', root, ...args]);
    assert.equal(git(['rev-parse', 'HEAD']).trim(), expectedSha, 'Wrong checkout commit');
    const tree = git(['rev-parse', 'HEAD^{tree}']).trim(); assert(sha.test(tree));
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '', 'Dirty checkout');
    const entries = git(['ls-tree', '-rz', '--full-tree', expectedSha]).split('\0').filter(Boolean), files = [];
    for (const entry of entries) {
        const match = entry.match(/^(100644|100755|120000) blob ([a-f0-9]{40})\t(.+)$/s); assert(match, 'Unexpected source tree entry');
        const [, mode, blob, path] = match;
        assert(!isAbsolute(path) && path.split('/').every(part => part && part !== '.' && part !== '..'));
        const full = join(root, path), stat = await lstat(full);
        let bytes;
        if (mode === '120000') { assert(stat.isSymbolicLink()); bytes = Buffer.from(await readlink(full)); }
        else {
            assert.equal(await realpath(full), full, 'Source parent symlink');
            assert.equal(Boolean(stat.mode & 0o111), mode === '100755', 'Source mode changed');
            bytes = await readRegular(full, 256 * 1024 * 1024);
        }
        const actualBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        assert.equal(actualBlob, blob, `Source bytes differ from commit: ${path}`);
        files.push({ path, mode, gitBlob: blob, sha256: digest(bytes), byteCount: bytes.length });
    }
    assert(files.length > 0);
    assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '', 'Checkout changed during inventory');
    assert.equal(git(['rev-parse', 'HEAD']).trim(), expectedSha);
    return { version: 'atlas-private-ci-source-v1', sourceCommit: expectedSha, sourceTree: tree,
        sourceInventoryHash: digest(canonical(files)), files };
}

export async function bindContext(root, expectedSha, context, before) {
    const source = await cleanSource(root, expectedSha); assert.deepEqual(source, before, 'Source changed after checkout proof');
    const { manifestHash, manifest } = await verifyContainer(join(context, 'app'), { owner: process.getuid() });
    assert.equal(manifest.candidate, 'WORKTREE'); // Preserve the canonical producer's honest local format.
    assert.equal(manifest.sourceCommit, source.sourceCommit); assert.equal(manifest.sourceTree, source.sourceTree);
    assert.equal(manifest.lockHash, digest(await readRegular(join(root, 'pnpm-lock.yaml'))));
    assert.equal(manifest.dockerfileHash, digest(await readRegular(join(context, 'Dockerfile'))));
    assert.equal(manifest.dockerfileHash, digest(await readRegular(join(root, 'backend/atlas-private/Dockerfile'))));
    const build = await json(join(context, 'app/dist/build-manifest.json'));
    assert.equal(await validateBuildInputs(root, build), manifest.sourceInputHash);
    for (const row of manifest.packagingInputs) assert.equal(digest(await readRegular(join(root, row.path))), row.sha256);
    return { version: 'atlas-private-ci-context-v1', cleanCommittedSourceVerified: true,
        sourceCommit: source.sourceCommit, sourceTree: source.sourceTree, sourceInventoryHash: source.sourceInventoryHash,
        manifestHash, sourceInputHash: manifest.sourceInputHash, lockHash: manifest.lockHash,
        baseImage: BASE_IMAGE, packagedCandidate: manifest.candidate, files: manifest.files.length,
        packagingInputs: manifest.packagingInputs, buildInputs: build.inputs };
}

export function imageIdentity(image) {
    // Engine-local IDs can differ between an index tag and its platform digest.
    // Registry digest equality is checked separately before signing.
    return { RootFS: image.RootFS, Config: image.Config, Architecture: image.Architecture, Os: image.Os };
}
export function assertImage(image, manifest, manifestHash) {
    assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, 'amd64'); assert(oci.test(image.Id));
    const config = image.Config;
    assert.equal(config.User, '65532:65532'); assert.equal(config.WorkingDir, '/app');
    assert.deepEqual(config.Entrypoint, ['/app/container/entrypoint.sh']); assert.equal(config.Cmd ?? null, null);
    const env = Object.fromEntries(config.Env.map(value => value.split(/=(.*)/s).slice(0, 2)));
    assert.deepEqual(Object.keys(env).sort(), ['ATLAS_PRIVATE_LISTEN_HOST', 'NODE_ENV', 'NODE_VERSION', 'PATH', 'PORT', 'YARN_VERSION']);
    assert.equal(env.NODE_VERSION, '20.20.1'); assert.equal(env.YARN_VERSION, '1.22.22');
    assert.equal(env.NODE_ENV, 'production'); assert.equal(env.ATLAS_PRIVATE_LISTEN_HOST, '0.0.0.0'); assert.equal(env.PORT, '8091');
    assert.equal(config.Labels['org.opencontainers.image.revision'], manifest.sourceCommit);
    assert.equal(config.Labels['io.atlas.source-tree'], manifest.sourceTree);
    assert.equal(config.Labels['io.atlas.container-manifest'], manifestHash);
    assert.equal(config.Volumes ?? null, null);
}
export function assertIsolation(container) {
    const host = container.HostConfig;
    assert.equal(host.NetworkMode, 'none'); assert.equal(host.ReadonlyRootfs, true); assert.equal(host.Privileged, false);
    assert.deepEqual(host.CapDrop, ['ALL']); assert(host.SecurityOpt.some(value => /^no-new-privileges(?::true)?$/.test(value)));
    assert(!host.Binds?.length && !container.Mounts?.length); assert(!host.PortBindings || !Object.keys(host.PortBindings).length);
    assert.equal(container.Config.User, '65532:65532');
}
export async function probeImage(image, context, metadata, output) {
    assert(/^[a-z0-9][a-z0-9./:@_-]+$/.test(image)); assert(oci.test(metadata['containerimage.digest']));
    await mkdir(output, { mode: 0o700 });
    const { manifest, manifestHash } = await verifyContainer(join(context, 'app'), { owner: process.getuid() });
    const inspected = JSON.parse(command('docker', ['image', 'inspect', image])); assert.equal(inspected.length, 1);
    assertImage(inspected[0], manifest, manifestHash); await save(join(output, 'image.json'), inspected[0]);
    const results = [];
    for (const probe of [
        { name: 'verify', args: ['--verify-only'], exit: 0 }, { name: 'smoke', args: ['--smoke'], exit: 0 },
        { name: 'missing-config', args: [], exit: 78, message: 'ATLAS_PRIVATE_STARTUP_REJECTED\n' },
        { name: 'invalid-listener', env: 'PORT=80', args: [], exit: 78 },
        { name: 'loader-override', env: 'NODE_OPTIONS=--invalid-atlas-loader', args: [], exit: 78 },
        { name: 'prisma-override', env: 'PRISMA_QUERY_ENGINE_LIBRARY=/fixture/untrusted.node', args: [], exit: 78 },
        { name: 'wrong-base-metadata', env: 'NODE_VERSION=20.0.0', args: [], exit: 78 },
    ]) {
        const id = command('docker', ['create', '--platform', 'linux/amd64', '--network', 'none', '--read-only',
            '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', ...(probe.env ? ['-e', probe.env] : []), image, ...probe.args]).trim();
        assert(/^[a-f0-9]{64}$/.test(id));
        try {
            const [container] = JSON.parse(command('docker', ['inspect', id])); assertIsolation(container);
            command('docker', ['start', id]);
            const code = Number(command('docker', ['wait', id], { timeout: 60_000 }).trim());
            assert.equal(code, probe.exit, probe.name);
            const captured = spawnSync('docker', ['logs', id], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
            assert.equal(captured.status, 0); const text = captured.stdout + captured.stderr;
            let result;
            if (probe.exit) assert.equal(text, probe.message ?? 'ATLAS_PRIVATE_CONTAINER_STARTUP_REJECTED\n', probe.name);
            else {
                result = JSON.parse(text); assert.equal(result.manifestHash, manifestHash);
                if (probe.name === 'verify') { assert.equal(result.status, 'ATLAS_PRIVATE_CONTAINER_VERIFIED'); assert.equal(result.files, manifest.files.length); }
                else {
                    assert.equal(result.status, 'ATLAS_PRIVATE_CONTAINER_SMOKE_PASS');
                    assert.deepEqual([result.nodeVersion, result.platform, result.arch, result.uid, result.gid], ['v20.20.1', 'linux', 'x64', 65532, 65532]);
                    assert.equal(result.nodeSha256, BASE_NODE_SHA256); assert.equal(result.engineHash, manifest.files.find(row => row.path === ENGINE_PATH).sha256);
                    assert.deepEqual([result.sharp, result.vips, result.prisma], ['0.33.5', '8.15.3', '5.22.0']);
                    assert.equal(result.libraryConstructed, true); assert.equal(result.databaseConnected, false);
                }
            }
            await save(join(output, `${probe.name}.json`), { name: probe.name, exit: code, isolationVerified: true, ...(result ? { result } : { boundedOutput: true }) });
            results.push({ name: probe.name, exit: code, isolationVerified: true });
        } finally { command('docker', ['rm', '--force', id]); }
        assert.equal(command('docker', ['ps', '--all', '--filter', `id=${id}`, '--format', '{{.ID}}']).trim(), '');
    }
    const result = { version: 'atlas-private-ci-runtime-v1', status: 'ATLAS_PRIVATE_CI_RUNTIME_PASS',
        image, candidateDigest: metadata['containerimage.digest'], manifestHash, sourceCommit: manifest.sourceCommit,
        sourceTree: manifest.sourceTree, imageIdentityHash: digest(canonical(imageIdentity(inspected[0]))), results,
        providerRequests: 0, databaseConnected: false, ownedContainersRemoved: true };
    await save(join(output, 'result.json'), result); return result;
}

async function main(args) {
    const mode = args.shift(), options = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index]; assert(/^--[a-z-]+$/.test(key) && args[index + 1] && !(key in options)); options[key] = args[index + 1];
    }
    const shape = {
        source: ['--root', '--expected-sha', '--output'],
        context: ['--root', '--expected-sha', '--context', '--before', '--output'],
        runtime: ['--image', '--context', '--metadata', '--output'],
        published: ['--tested', '--published', '--output'],
    }[mode]; assert(shape && canonical(Object.keys(options).sort()) === canonical(shape.sort()));
    let result;
    if (mode === 'source') result = await cleanSource(options['--root'], options['--expected-sha']);
    if (mode === 'context') result = await bindContext(options['--root'], options['--expected-sha'], options['--context'], await json(options['--before']));
    if (mode === 'runtime') result = await probeImage(options['--image'], options['--context'], await json(options['--metadata']), options['--output']);
    if (mode === 'published') {
        const tested = await json(options['--tested']), published = await json(options['--published']);
        assert(Array.isArray(published) && published.length === 1); assert.deepEqual(imageIdentity(published[0]), imageIdentity(tested));
        result = { status: 'ATLAS_PRIVATE_PUBLISHED_IMAGE_MATCHES_TESTED', imageIdentityHash: digest(canonical(imageIdentity(tested))) };
    }
    if (mode !== 'runtime') await save(options['--output'], result);
    console.log(JSON.stringify({ status: `ATLAS_PRIVATE_CI_${mode.toUpperCase()}_PASS`, output: options['--output'] }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
