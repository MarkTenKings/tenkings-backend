#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { disposablePostgres } from './disposable-postgres.mjs';
import { localAccessConfig, seedLocalStaff } from '../lib/server/access/fixture.mjs';
import { workspaceRuntimeSettings } from '../lib/server/access/workspace-runtime.mjs';
import { WORKSPACE_FIXTURE_UPLOAD_ORIGIN } from '../lib/server/access/workspace-fixture.mjs';
import { hash } from '../lib/server/policy.mjs';
import { localSiteRouter } from '../../../packages/atlas-site-router/local.mjs';
import { verifyWorkspaceBrowser } from './workspace-ui-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), appRoot = join(root, 'frontend/atlas-app');
const args = process.argv.slice(2), toolIndex = args.indexOf('--tool-modules');
assert(toolIndex >= 0 && args[toolIndex + 1], 'An explicit local tool module directory is required');
const toolModules = realpathSync(args[toolIndex + 1]); args.splice(toolIndex, 2);
assert.equal(realpathSync(tmpdir()), '/private/tmp', 'Run this web fixture with TMPDIR=/tmp to match the existing local database path guard');
const fixtureRequire = createRequire(join(toolModules, '__workspace_fixture__.cjs')), sharp = fixtureRequire('sharp');
for (const file of ['.env', '.env.local', '.env.development', '.env.development.local']) assert(!existsSync(join(appRoot, file)), 'Refusing inherited app environment files');
const fixture = await disposablePostgres(args), serve = args.includes('--serve');
console.log(JSON.stringify({ phase: 'WORKSPACE_UI_DISPOSABLE_POSTGRES', directory: fixture.directory }));
let child, router, stopped = false, webConfig;
async function stopWeb() {
    if (!child || child.exitCode !== null) return;
    const current = child, exited = new Promise(done => current.once('exit', done)); current.kill('SIGTERM');
    await Promise.race([exited, delay(5000).then(() => { if (current.exitCode === null) current.kill('SIGKILL'); })]); await exited;
}
async function startWeb() {
    const require = createRequire(join(appRoot, 'package.json'));
    child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', appRoot, '-H', '127.0.0.1', '-p', '4328'], {
        cwd: appRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME,
            NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', ATLAS_LOCAL_POSTGRES: '1', ATLAS_LOCAL_POSTGRES_FILE: webConfig,
            ATLAS_LOCAL_WORKSPACE_FIXTURE: '1', ATLAS_WORKSPACE_UPLOAD_ORIGIN: WORKSPACE_FIXTURE_UPLOAD_ORIGIN } });
    writeFileSync(join(fixture.directory, 'workspace-web-owner.json'), JSON.stringify({ pid: child.pid, createdByHarness: true }), { mode: 0o600 });
    let log = ''; const capture = data => { log += fixture.safe(data); writeFileSync(join(fixture.directory, 'workspace-ui-next.log'), log, { mode: 0o600 }); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const deadline = Date.now() + 45_000;
    while (!log.includes('Ready in')) { assert(child.exitCode === null && Date.now() < deadline, 'Owned workspace app failed to start'); await delay(100); }
}
async function stop() { if (stopped) return; stopped = true; if (router) await new Promise(done => router.close(done)); await stopWeb(); await fixture.stop(); }
try {
    const db = await fixture.database(), config = localAccessConfig({ databaseUrl: db.staffUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
    const admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } });
    try {
        await seedLocalStaff(admin, config, { analyses: true, trained: true, traces: true });
        await admin.staffWorkspaceControl.create({ data: { enabled: true, mode: config.mode, releaseSha: config.releaseSha,
            configHash: workspaceRuntimeSettings({}, config).configHash, cohortId: randomUUID(), intakeEnabled: true,
            claimsEnabled: true, preparationEnabled: true, astraEnabled: false, processingLimit: 1, expiresAt: new Date(Date.now() + 3600_000) } });
    } finally { await admin.$disconnect(); }
    const ownership = JSON.parse(readFileSync(join(fixture.directory, 'ownership.json'), 'utf8'));
    webConfig = join(fixture.directory, 'web-config.json');
    writeFileSync(webConfig, JSON.stringify({ nonce: ownership.nonce, databaseUrl: db.staffUrl,
        sessionKey: config.sessionKey.toString('hex'), phoneKey: config.phoneKey.toString('hex') }), { mode: 0o600 });
    for (const name of ['workspace-assets', 'workspace-objects', 'workspace-results', 'workspace-screenshots']) mkdirSync(join(fixture.directory, name), { mode: 0o700 });
    const assets = [];
    for (let index = 1; index <= 10; index++) for (const side of ['FRONT', 'BACK']) {
        const number = String(index).padStart(2, '0'), color = `hsl(${index * 31 + (side === 'BACK' ? 125 : 0)},65%,40%)`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560"><rect width="400" height="560" fill="#171923"/><rect x="40" y="56" width="320" height="448" rx="16" fill="#f4f0e7"/><rect x="58" y="78" width="284" height="402" fill="${color}"/><path d="M72 310 L200 128 L328 310 Z" fill="#ffffff44"/><circle cx="200" cy="236" r="54" fill="#ffffff55"/><g fill="white" font-family="sans-serif" text-anchor="middle" font-weight="700"><text x="200" y="354" font-size="24">SYNTHETIC</text><text x="200" y="390" font-size="24">FIXTURE ${number}</text><text x="200" y="442" font-size="30">${side}</text></g></svg>`;
        const bytes = await sharp(Buffer.from(svg)).png().toBuffer(), prepared = await sharp(bytes).extract({ left: 40, top: 56, width: 320, height: 448 }).resize(1270, 1778).png().toBuffer();
        const file = `original-${number}-${side}.png`, preparedFile = `prepared-${number}-${side}.png`;
        writeFileSync(join(fixture.directory, 'workspace-assets', file), bytes, { mode: 0o600 });
        writeFileSync(join(fixture.directory, 'workspace-assets', preparedFile), prepared, { mode: 0o600 });
        assets.push({ index, side, file, sha256: hash(bytes), byteCount: bytes.length, width: 400, height: 560,
            prepared: { file: preparedFile, sha256: hash(prepared), byteCount: prepared.length, width: 1270, height: 1778 } });
    }
    assert.equal(new Set(assets.map(asset => asset.sha256)).size, 20);
    writeFileSync(join(fixture.directory, 'workspace-assets.json'), JSON.stringify({ nonce: ownership.nonce, syntheticOnly: true, assets }), { mode: 0o600 });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop().finally(() => process.exit()));
    await startWeb(); router = await localSiteRouter();
    const result = await verifyWorkspaceBrowser({ directory: fixture.directory, toolModules, assets, restart: async () => { await stopWeb(); await startWeb(); } });
    const database = await fixture.sql('SELECT count(*)::integer AS cards, count(*) FILTER (WHERE state=\'WAITING\')::integer AS waiting FROM atlas_staff."StaffWorkspaceCard"', [], db.name);
    assert.deepEqual(database.rows[0], { cards: 10, waiting: 9 });
    const events = readFileSync(join(fixture.directory, 'workspace-source-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(events.filter(event => event.event === 'SYNTHETIC_PREPARATION').length, 2);
    assert.equal(events.filter(event => event.event === 'SYNTHETIC_STATUS_READ').length, 2);
    const summary = { ...result, status: 'WORKSPACE_UI_LOCAL_PASS', database: database.rows[0], syntheticOnly: true, realSms: false, realModels: false,
        paidRequests: 0, actualPreparationAdmission: false, screenshots: join(fixture.directory, 'workspace-screenshots') };
    writeFileSync(join(fixture.directory, 'workspace-ui-result.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
    if (serve) { console.log('Owned workspace fixture remains at http://127.0.0.1:4318/admin; fictional phone +12025550141 and code424242.'); await new Promise(() => {}); }
} catch (error) {
    writeFileSync(join(fixture.directory, 'workspace-ui-failure.json'), JSON.stringify({ error: fixture.safe(error.stack) })); throw error;
} finally { await stop(); }
