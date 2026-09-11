#!/usr/bin/env node
// Owned disposable PostgreSQL only; no external database or provider transport.
// Keep the real ledger's 10-second interactive transaction deadline. Synthetic
// lossless PNG image content exercises JSON/base64 delivery, unlike text padding.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PrismaClient } from '../.generated/staff-database/index.js';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { workspaceCaptureFixture } from './workspace-capture-fixture.mjs';
import { disposablePostgres } from './disposable-postgres.mjs';
import { localAccessConfig, seedLocalStaff, fixtureVerifyProvider } from '../lib/server/access/fixture.mjs';
import { DurableStaffAuth } from '../lib/server/access/auth.mjs';
import { StaffDatabase } from '../lib/server/access/database.mjs';

const args = process.argv.slice(2), optimizedIndex = args.indexOf('--optimized-migration');
const optimizedMigration = optimizedIndex < 0 ? null : args.splice(optimizedIndex, 2)[1];
assert(optimizedIndex < 0 || optimizedMigration?.startsWith('/'), 'Optimized migration requires an absolute local SQL file');
const baselineMigration = readFileSync(new URL('../prisma/migrations/20260911050000_capture_attempt_abandonment/migration.sql', import.meta.url), 'utf8');
const baselineAttemptGuard = baselineMigration.match(/CREATE OR REPLACE FUNCTION atlas_staff\.operator_attempt_guard\(\)[\s\S]*?\nEND \$\$;/)?.[0];
assert(baselineAttemptGuard);

const crcTable = Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
});
function png(seed, width = 800, height = 797) {
    const chunk = (type, payload) => {
        const bytes = Buffer.concat([Buffer.from(type), payload]), header = Buffer.alloc(4), trailer = Buffer.alloc(4);
        header.writeUInt32BE(payload.length); let crc = 0xffffffff;
        for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
        trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([header, bytes, trailer]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
    const pixels = Buffer.alloc((width * 3 + 1) * height); let state = seed;
    for (let row = 0; row < height; row++) for (let column = 1; column <= width * 3; column++) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        pixels[row * (width * 3 + 1) + column] = state & 255;
    }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(pixels, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
const imageBytes = [png(1729), png(1871)];

function instrument(client, report) {
    let current = null, currentPhase = 'setup', currentMethod = null;
    client.$on('query', event => current?.serverQueries.push({ sql: event.query.slice(0, 1000), milliseconds: event.duration }));
    const fail = error => ({ code: error?.code ?? null, message: String(error?.message ?? error).slice(-700) });
    const wrap = (target, label = '') => new Proxy(target, { get(object, key) {
        const value = object[key];
        if (typeof value === 'function') return async (...values) => {
            const transaction = current, begin = performance.now();
            let sql = null;
            if (String(key).startsWith('$') && Array.isArray(values[0])) sql = values[0].join('?').slice(0, 1000);
            const query = { method: `${label}${String(key)}`, sql, startedMs: begin - transaction.started, milliseconds: null };
            transaction.calls.push(query);
            try { return await value.apply(object, values); }
            catch (error) { query.error = fail(error); throw error; }
            finally { query.milliseconds = performance.now() - begin; }
        };
        if (value && typeof value === 'object' && !String(key).startsWith('$')) return wrap(value, `${String(key)}.`);
        return value;
    } });
    const proxy = new Proxy(client, { get(target, key) {
        if (key !== '$transaction') return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
        return async (work, options) => {
            assert.equal(options.timeout, 10_000, 'Runtime transaction timeout must remain exactly 10 seconds');
            const entry = { phase: currentPhase, method: currentMethod, timeoutMs: options.timeout, started: performance.now(), calls: [], serverQueries: [] };
            report.transactions.push(entry); current = entry;
            try { return await target.$transaction(tx => work(wrap(tx)), options); }
            catch (error) { entry.error = fail(error); throw error; }
            finally {
                entry.milliseconds = performance.now() - entry.started;
                entry.queryWallMs = entry.calls.reduce((sum, row) => sum + row.milliseconds, 0);
                entry.nonQueryWallMs = entry.milliseconds - entry.queryWallMs;
                delete entry.started; current = null;
            }
        };
    } });
    return { client: proxy, async method(name, work) {
        const previous = currentMethod; currentMethod = name;
        try { return await work(); } finally { currentMethod = previous; }
    }, async phase(name, work) {
        currentPhase = name; const started = performance.now();
        try { return await work(); }
        finally { report.phases.push({ name, milliseconds: performance.now() - started }); currentPhase = 'setup'; }
    } };
}

const fixture = await disposablePostgres(args), reports = [];
console.log(JSON.stringify({ event: 'OWNED_PROFILE_STARTED', directory: fixture.directory,
    publicMigrations: fixture.source.publicMigrations.length, staffMigrations: fixture.source.staffMigrations.length }));
let caught;
try {
    for (const variant of optimizedMigration ? ['original', 'optimized'] : ['original']) {
        const db = await fixture.database(), admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } }),
            client = new PrismaClient({ datasources: { db: { url: db.staffUrl } } });
        const report = { variant, baselineAttemptGuardHash: digest(baselineAttemptGuard), imageByteCounts: imageBytes.map(bytes => bytes.length),
            originalTimeoutMs: 10_000, phases: [], transactions: [] };
        reports.push(report);
        const sql = (query, values) => fixture.sql(query, values, db.name);
        const config = localAccessConfig({ databaseUrl: db.staffUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
        const identities = await seedLocalStaff(admin, config);
        const auth = new DurableStaffAuth({ config, database: new StaffDatabase(client, config), provider: fixtureVerifyProvider(config) });
        const login = async () => {
            const boot = await auth.bootstrap(undefined, 'large-image-profile'), cookie = `${config.cookies.browser}=${boot.browserToken}`;
            const challenge = await auth.send(cookie, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'large-image-profile');
            const result = await auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'large-image-profile');
            return { ...result, cookie: `${cookie}; ${config.cookies.session}=${result.token}` };
        };
        try {
            await sql(baselineAttemptGuard);
            if (variant === 'optimized') {
                const migration = readFileSync(optimizedMigration, 'utf8'); report.optimizedMigrationHash = digest(migration); await sql(migration);
            }
            await sql(`ALTER DATABASE "${db.name}" SET track_functions='all'`);
            await workspaceCaptureFixture({ db, admin, client, config, identities, auth, login, sql }, async f => {
                const native = new PrismaClient({ datasources: { db: { url: db.operatorUrl } }, log: [{ level: 'query', emit: 'event' }] });
                const meter = instrument(native, report); f.ledger.client = meter.client;
                for (const name of ['claim', 'renew', 'reserve', 'takeDispatch', 'recordReceipt', 'inspectTool', 'applyTool']) {
                    const method = f.ledger[name].bind(f.ledger);
                    f.ledger[name] = (...values) => meter.method(name, () => method(...values));
                }
                const saved = () => writeFileSync(join(fixture.directory, 'large-image-profile.partial.json'), JSON.stringify(reports, null, 2));
                const phase = async (name, work) => {
                    try { return await meter.phase(name, work); }
                    finally { saved(); console.log(JSON.stringify({ event: 'PROFILE_PHASE', variant, ...report.phases.at(-1) })); }
                };
                try {
                    const current = await phase('claim', () => f.claim()); let lease = current.lease;
                    let request = await phase('seed_1_request', () => f.request(lease, 'read_original_photos'));
                    lease = (await phase('seed_1_apply_two_images', () => f.apply(lease, request))).lease;
                    for (const [index, asset] of JSON.parse(current.run.manifestCanonical).assets.entries()) {
                        const crop = { assetId: asset.assetId, sourceSha256: asset.sha256, side: asset.side,
                            rect: { x: 0, y: 0, width: asset.width, height: asset.height } };
                        request = await phase(`seed_${index + 2}_request`, () => f.request(lease, 'inspect_region', crop));
                        lease = (await phase(`seed_${index + 2}_apply_crop`, () => f.apply(lease, request))).lease;
                    }
                    const before = await admin.staffOperatorRun.findUnique({ where: { id: current.run.id } });
                    report.inputBytes = Buffer.byteLength(before.inputCanonical); report.inputHash = before.inputHash;
                    report.images = await admin.staffOperatorImage.count({ where: { runId: current.run.id } });
                    report.appliedBefore = await admin.staffOperatorAttempt.count({ where: { runId: current.run.id, state: 'APPLIED' } });
                    assert.equal(report.images, 4); assert.equal(report.appliedBefore, 3); assert.equal(before.revision, 4);
                    assert(report.inputBytes >= 10_190_000 && report.inputBytes < 10_260_000, 'Four-image continuation must match the observed 10.2 MB size');
                    assert(report.inputBytes < 12 * 1024 * 1024, 'Continuation must stay inside the existing 12 MiB contract');
                    await phase('large_renew', () => f.ledger.renew(lease));
                    // Native EXPLAIN executes this metadata write only inside a
                    // rolled-back owned fixture transaction. All guards remain enabled.
                    report.renewExplain = await admin.$transaction(async tx => {
                        const plan = await tx.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) UPDATE atlas_staff."StaffOperatorRun"
                            SET "leaseExpiresAt"=LEAST("deadlineAt", (clock_timestamp() AT TIME ZONE 'UTC')+interval '59 seconds'),
                                "updatedAt"=clock_timestamp() AT TIME ZONE 'UTC' WHERE id=$1::uuid RETURNING id`, current.run.id);
                        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
                        throw Object.assign(new Error('OWNED_EXPLAIN_ROLLBACK'), { plan });
                    }, { timeout: 30_000 }).catch(error => { if (error.message === 'OWNED_EXPLAIN_ROLLBACK') return error.plan; throw error; });
                    const manifest = JSON.parse(before.manifestCanonical), reference = manifest.assets[0];
                    request = await phase('large_reserve_dispatch_receipt', () => f.request(lease, 'propose_capture_identity', { fields: [
                        { field: 'playerName', value: 'Synthetic supplied identity', evidence: [
                            { assetId: reference.assetId, sha256: reference.sha256, side: reference.side }] }], summary: 'Synthetic continuation performance evidence.' }));
                    const attempt = await admin.staffOperatorAttempt.findUnique({ where: { id: request.attemptId }, select: { requestCanonical: true, requestHash: true } });
                    report.requestBytes = Buffer.byteLength(attempt.requestCanonical); assert(report.requestBytes < 12 * 1024 * 1024);
                    lease = (await phase('large_inspect_apply', () => f.apply(lease, request))).lease;
                    await phase('large_renew_after_apply', () => f.ledger.renew(lease));
                    const after = await admin.staffOperatorRun.findUnique({ where: { id: current.run.id }, select: { revision: true, state: true, inputHash: true } });
                    report.after = { ...after, attempts: await admin.staffOperatorAttempt.count(), receipts: await admin.staffOperatorReceipt.count(),
                        steps: await admin.staffOperatorStep.count(), images: await admin.staffOperatorImage.count(), syntheticProviderCalls: f.calls() };
                    assert.equal(after.revision, 5); assert.equal(after.state, 'RUNNING'); assert.equal(report.after.attempts, 4);
                    assert.equal(report.after.receipts, 4); assert.equal(report.after.steps, 4); assert.equal(report.after.images, 4);
                    assert.equal(report.after.syntheticProviderCalls, 4); report.ok = true;
                } catch (error) { report.ok = false; report.error = { code: error.code ?? null, message: fixture.safe(error.stack).slice(-1800) }; }
                finally { await native.$disconnect(); }
            }, { rosterSize: 1, effort: 'max', imageFactory: ({ sideIndex }) => imageBytes[sideIndex] });
            await sql('SELECT pg_stat_clear_snapshot()');
            report.functionTimings = (await sql(`SELECT schemaname,funcname,calls,total_time,self_time FROM pg_stat_user_functions
                WHERE schemaname='atlas_staff' AND calls>0 ORDER BY total_time DESC LIMIT 30`)).rows;
            report.timeoutReproduced = report.transactions.some(tx => tx.error?.code === 'P2028');
            console.log(JSON.stringify({ event: 'PROFILE_VARIANT_RESULT', variant, ok: report.ok, inputBytes: report.inputBytes,
                timeoutReproduced: report.timeoutReproduced, error: report.error ?? null }));
        } finally { await admin.$disconnect(); await client.$disconnect(); await db.dispose(); }
    }
} catch (error) { caught = error; }
finally {
    await fixture.stop();
    const result = { stopped: true, publicMigrations: fixture.source.publicMigrations.length,
        staffMigrations: fixture.source.staffMigrations.length, reports, error: caught ? fixture.safe(caught.stack) : null };
    writeFileSync(join(fixture.directory, 'large-image-profile.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ event: 'OWNED_PROFILE_FINISHED', directory: fixture.directory, stopped: true, error: result.error }));
}
if (caught || reports.some(report => !report.ok && (report.variant === 'optimized' || !report.timeoutReproduced))) process.exitCode = 1;
