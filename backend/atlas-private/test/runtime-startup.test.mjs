import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(app, '../..');

// Bundle the real composition, operator host and both process guards. Only
// external adapters/artifact reads are replaced; no database, native engine,
// listener or provider is used. The same pinned bundler builds this service.
async function harness(t) {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-private-startup-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const contextPath = join(directory, 'context.mjs');
    await writeFile(contextPath, 'export let current; export function select(value) { current = value; }\n');
    const context = `import { current as f } from ${JSON.stringify(contextPath)};\n`;
    const runtimePath = join(directory, 'operator-runtime.mjs');
    await writeFile(runtimePath, context + `
export function productionOperatorConfig({ env }) {
    f.operatorEnv = env;
    return { config: { configHash: f.config.operatorRuntimeHash }, image: { origin: f.config.origin, key: f.imageKey } };
}
export function executeOperatorRun() { throw new Error('unexpected operator work during startup'); }
`);
    const adapters = context + `
export class PrismaClient { constructor(options) { return f.client(options.datasources.db.url); } }
export class S3Client { constructor() { f.events.push('storage:construct'); }
    destroy() { f.events.push('storage:destroy'); if (f.storageError) throw f.storageError; } }
export function privateRuntimeConfig() { return f.config; }
export function atlasGradingPolicyHash() { return 'a'.repeat(64); }
export async function assertWorkspacePrivileges(tx, role) {
    f.events.push('role:' + role);
    if (tx.role !== role) throw new Error('wrong database role');
    if (f.failRole === role) throw f.startupError;
}
export function createPrivateServer({ health }) { f.events.push('server:available');
    return { health, listen() { throw new Error('test must not listen'); } }; }
export function createAtlasWorkspaceSourceStorage() { return { readCapture() { throw new Error('unexpected storage read'); } }; }
export function createAtlasGradingPorts() { return {}; }
export class ScopedGradingBridge {}
export class OperatorEvidenceBridge {}
export const WORKSPACE_SERVICE_PATH = '/workspace', OPERATOR_EVIDENCE_PATH = '/evidence';
function unavailable() { throw new Error('unexpected dispatch during startup'); }
export { unavailable as createAtlasWorkspaceSourceAuthority, unavailable as createAtlasWorkspaceSourceHost,
    unavailable as createAtlasWorkspaceInitialization, unavailable as renderAtlasOperatorImage,
    unavailable as privateWorkspaceBinding, unavailable as verifyWorkspaceRequest,
    unavailable as workspaceResponseSignature, unavailable as verifyOperatorEvidenceRequest,
    unavailable as workspaceServiceClient, unavailable as createWorkspaceDispatcher };
`;
    const substitutions = new Set(['@aws-sdk/client-s3', '../.generated/database/index.js',
        '@atlas/service-bridge/workspace', '@atlas/service-bridge/operator-evidence',
        '@atlas/service-bridge/workspace-privileges', '@atlas/service-bridge/executor',
        '@atlas/operator/workspace-dispatcher', './config.mjs', './http.mjs']);
    const { build, version } = await import(pathToFileURL(resolve(root,
        'node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/lib/main.js')).href);
    assert.equal(version, '0.27.7');
    const output = await build({ absWorkingDir: root, entryPoints: [resolve(app, 'src/runtime.ts')],
        bundle: true, platform: 'node', format: 'esm', target: 'node20', write: false, logLevel: 'silent',
        plugins: [{ name: 'startup-adapters', setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path, importer }) => {
                if (path === contextPath) return { path, external: true };
                if (substitutions.has(path) || path.startsWith('../../../frontend/nextjs-app/lib/server/'))
                    return { path: 'adapters', namespace: 'startup-fixture' };
                if (path === './process.mjs' && importer === resolve(app, 'src/runtime.ts'))
                    return { path: 'process', namespace: 'startup-fixture' };
                if (path === '../../../packages/atlas-operator/src/release-artifact.mjs')
                    return { path: 'artifact', namespace: 'startup-fixture' };
            });
            builder.onLoad({ filter: /.*/, namespace: 'startup-fixture' }, ({ path }) => ({
                loader: 'js', resolveDir: root, contents: path === 'adapters' ? adapters : path === 'process'
                    ? context + `export { assertPrivateProcess } from ${JSON.stringify(resolve(app, 'src/process.mjs'))};
export function privateEnginePath() { return '/fixture/never-loaded-engine.node'; }`
                    : context + `export { assertReleaseProcess } from ${JSON.stringify(resolve(root, 'packages/atlas-operator/src/release-artifact.mjs'))};
export async function readCanonicalRelease() { f.events.push('artifact:manifest'); return { machineInitialization: null, buildHash: 'b'.repeat(64) }; }
export async function verifyOperatorArtifact() { f.events.push('artifact:verify'); return { runtimePath: ${JSON.stringify(runtimePath)} }; }`,
            }));
        } }] });
    const bundlePath = join(directory, 'runtime.mjs');
    await writeFile(bundlePath, output.outputFiles[0].contents);
    return { ...(await import(pathToFileURL(bundlePath).href)), ...(await import(pathToFileURL(contextPath).href)) };
}

function fixture(options = {}) {
    const imageKey = Buffer.alloc(32, 7), events = [];
    const f = { events, imageKey, startupError: new Error('fixture role admission rejected'), ...options };
    f.config = { sourceDatabaseUrl: 'SOURCE', origin: 'https://private.example.test', operatorRuntimeHash: 'c'.repeat(64),
        dispatch: { coordinatorDatabaseUrl: 'COORDINATOR', artifactRoot: '/fixture/artifact', manifestPath: '/fixture/manifest.json',
            manifestHash: 'd'.repeat(64), operatorEnv: Object.freeze({ NODE_ENV: 'production' }) },
        storage: { endpoint: 'https://storage.example.test', region: 'fixture', bucket: 'fixture', uploadOrigin: 'https://storage.example.test' },
        credentials: {}, workers: {}, receiptIds: {}, grading: {},
        image: { key: imageKey, clientKeyHash: createHash('sha256').update(imageKey).digest('hex') } };
    f.client = role => {
        assert(['SOURCE', 'COORDINATOR'].includes(role)); events.push(`client:${role}`);
        return {
            async $transaction(work) {
                events.push(`native:${role}`);
                // The trusted Prisma engine discovers these OS paths on its
                // first TLS connection, after the launch environment check.
                process.env.SSL_CERT_FILE = '/etc/ssl/certs/ca-certificates.crt';
                process.env.SSL_CERT_DIR = '/etc/ssl/certs';
                return work({ role, async $executeRaw() {},
                    async $queryRaw() { throw new Error('unexpected staff control read during startup'); } });
            },
            async $disconnect() {
                events.push(`disconnect:${role}`);
                if (role === 'COORDINATOR' && f.coordinatorClose) await f.coordinatorClose();
            },
        };
    };
    return f;
}

async function withEnvironment(work) {
    const unsafe = name => name === 'DEBUG' || name.startsWith('NODE_') && name !== 'NODE_ENV'
        || ['LD_', 'DYLD_', 'PRISMA_', 'OPENSSL_'].some(prefix => name.startsWith(prefix))
        || ['SSL_CERT_FILE', 'SSL_CERT_DIR'].includes(name);
    const previous = Object.fromEntries(Object.entries(process.env).filter(([name]) => unsafe(name)));
    for (const name of Object.keys(previous)) delete process.env[name];
    try { return await work(); }
    finally {
        for (const name of Object.keys(process.env).filter(unsafe)) delete process.env[name];
        Object.assign(process.env, previous);
    }
}

const cleanupEvents = f => f.events.filter(event => event.startsWith('disconnect:') || event === 'storage:destroy');
const expectedCleanup = ['disconnect:COORDINATOR', 'storage:destroy', 'disconnect:SOURCE'];

test('private runtime startup composition', async t => {
    const h = await harness(t);
    await t.test('native CA discovery admits both roles before exposing HTTP', () => withEnvironment(async () => {
        const f = fixture(); h.select(f);
        const runtime = await h.createPrivateRuntime({});
        assert.deepEqual(f.events.filter(event => event.startsWith('role:') || event === 'server:available'),
            ['role:COORDINATOR', 'role:SOURCE', 'server:available']);
        assert.equal(f.events.indexOf('artifact:verify') < f.events.indexOf('native:COORDINATOR'), true);
        assert.equal(process.env.SSL_CERT_DIR, '/etc/ssl/certs');
        assert.equal(process.env.SSL_CERT_FILE, '/etc/ssl/certs/ca-certificates.crt');
        assert.equal(f.operatorEnv, f.config.dispatch.operatorEnv);
        assert(!Object.hasOwn(f.operatorEnv, 'SSL_CERT_FILE') && !Object.hasOwn(f.operatorEnv, 'SSL_CERT_DIR'));
        assert(runtime.health.capabilities.includes('WORKSPACE_DISPATCH'));
        await runtime.close(); assert.deepEqual(cleanupEvents(f), expectedCleanup);
    }));
    await t.test('externally supplied CA overrides fail before clients or artifact reads', () => withEnvironment(async () => {
        for (const name of ['SSL_CERT_FILE', 'SSL_CERT_DIR']) for (const value of ['', '/untrusted/ca']) {
            const f = fixture(); h.select(f); process.env[name] = value;
            try { await assert.rejects(h.createPrivateRuntime({}), /ATLAS_PRIVATE_PROCESS_UNSAFE/); }
            finally { delete process.env[name]; }
            assert.deepEqual(f.events, []);
        }
    }));
    for (const failRole of ['COORDINATOR', 'SOURCE']) {
        await t.test(`${failRole} admission failure closes every constructed client without exposing HTTP`,
            () => withEnvironment(async () => {
                const f = fixture({ failRole }); h.select(f);
                await assert.rejects(h.createPrivateRuntime({}), error => error === f.startupError);
                assert(!f.events.includes('server:available'));
                if (failRole === 'COORDINATOR') assert(!f.events.includes('native:SOURCE'));
                assert.deepEqual(cleanupEvents(f), expectedCleanup);
            }));
    }
    await t.test('failed coordinator close preserves startup rejection and still releases storage and SOURCE',
        () => withEnvironment(async () => {
            const closeError = new Error('fixture coordinator close rejected');
            const f = fixture({ failRole: 'SOURCE', async coordinatorClose() { throw closeError; } }); h.select(f);
            const error = await h.createPrivateRuntime({}).then(() => assert.fail('startup must reject'), error => error);
            assert.deepEqual(cleanupEvents(f), expectedCleanup);
            assert.equal(error, f.startupError);
            assert(!f.events.includes('server:available'));
        }));
    await t.test('normal shutdown waits for operator close, then releases remaining resources even if it fails',
        () => withEnvironment(async () => {
            let rejectClose;
            const pending = new Promise((_, reject) => { rejectClose = reject; });
            const f = fixture({ coordinatorClose: () => pending }); h.select(f);
            const runtime = await h.createPrivateRuntime({});
            const closing = runtime.close();
            const rejection = assert.rejects(closing, /fixture close rejected/);
            await new Promise(setImmediate);
            assert.deepEqual(cleanupEvents(f), ['disconnect:COORDINATOR']);
            rejectClose(new Error('fixture close rejected')); await rejection;
            assert.deepEqual(cleanupEvents(f), expectedCleanup);
        }));
    await t.test('storage cleanup failure cannot skip SOURCE disconnection or replace the startup error',
        () => withEnvironment(async () => {
            const f = fixture({ failRole: 'SOURCE', storageError: new Error('fixture storage close rejected') }); h.select(f);
            const error = await h.createPrivateRuntime({}).then(() => assert.fail('startup must reject'), error => error);
            assert.deepEqual(cleanupEvents(f), expectedCleanup);
            assert.equal(error, f.startupError);
        }));
});
