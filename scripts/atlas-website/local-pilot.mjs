#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '../../frontend/atlas-app/.generated/staff-database/index.js';
import { disposablePostgres } from '../../frontend/atlas-app/scripts/disposable-postgres.mjs';
import { localAccessConfig, seedLocalStaff } from '../../frontend/atlas-app/lib/server/access/fixture.mjs';
import { makePublicConfig, LOCAL_ORIGIN as PUBLIC_ORIGIN } from '../../frontend/atlas-public/lib/server/policy.mjs';
import { localConfig as customerConfig } from '../../frontend/atlas-customer/lib/server/fixture.mjs';
import { localSiteRouter } from '../../packages/atlas-site-router/local.mjs';
import { customerIntakeQueue } from '../../frontend/atlas-app/lib/customer-intake-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'http://127.0.0.1:4318', args = process.argv.slice(2), serve = args.includes('--serve');
for (const app of ['atlas-app', 'atlas-public', 'atlas-customer']) for (const name of ['.env', '.env.local', '.env.development', '.env.development.local'])
    assert(!existsSync(join(root, 'frontend', app, name)), 'Refusing app environment files in owned website fixture');
const fixture = await disposablePostgres(args), children = new Map(), checks = [];
console.log(JSON.stringify({ phase: 'owned-synthetic-website', evidenceDirectory: fixture.directory }));
let router, stopped = false;
async function stopApp(name) {
    const child = children.get(name); if (!child || child.exitCode !== null) return;
    const ended = new Promise(done => child.once('exit', done)); child.kill('SIGTERM');
    await Promise.race([ended, delay(5000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); })]); await ended;
}
async function stop() {
    if (stopped) return; stopped = true;
    if (router) await new Promise(done => router.close(done));
    await Promise.all([...children.keys()].map(stopApp)); await fixture.stop();
}
async function startApp(name, port, extra) {
    const app = join(root, 'frontend', name), require = createRequire(join(app, 'package.json'));
    const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', app, '-H', '127.0.0.1', '-p', String(port)], {
        cwd: app, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME,
            NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', ...extra } });
    children.set(name, child); let log = '';
    const record = data => { log += fixture.safe(data); writeFileSync(join(fixture.directory, `${name}.log`), log, { mode: 0o600 }); };
    child.stdout.on('data', record); child.stderr.on('data', record);
    const deadline = Date.now() + 45000;
    while (!log.includes('Ready in')) { assert(child.exitCode === null && Date.now() < deadline, `${name} failed to start; inspect owned fixture log`); await delay(100); }
}
function browser() {
    const jar = new Map();
    return { jar, async call(path, body, csrf, extraHeaders = {}) {
        const cookie = [...jar.entries()].filter(([, c]) => path === c.path || path.startsWith(`${c.path}/`))
            .map(([name, c]) => `${name}=${c.value}`).join('; ');
        const response = await fetch(`${origin}${path}`, { redirect: 'manual', method: body === undefined ? 'GET' : 'POST',
            headers: { Cookie: cookie, ...extraHeaders, ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json',
                [path.startsWith('/account/') ? 'X-Atlas-Customer-Csrf' : 'X-Atlas-Csrf']: csrf ?? '' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        for (const cookie of response.headers.getSetCookie()) {
            const [pair, ...flags] = cookie.split(';').map(v => v.trim()), split = pair.indexOf('='), name = pair.slice(0, split), value = pair.slice(split + 1);
            const scope = flags.find(f => f.startsWith('Path='))?.slice(5); assert(scope === '/account' || scope === '/admin');
            assert(flags.includes('HttpOnly') && flags.includes('SameSite=Lax'));
            if (!value || flags.includes('Max-Age=0')) jar.delete(name); else jar.set(name, { value, path: scope });
        }
        return response;
    } };
}
async function json(response, status = 200) {
    assert.equal(response.status, status, await response.clone().text());
    assert.match(response.headers.get('cache-control'), /no-store/); return response.json();
}
const mark = value => { checks.push(value); console.log(JSON.stringify({ check: value, status: 'PASS' })); };
try {
    const db = await fixture.database(), sessionKey = randomBytes(32), phoneKey = randomBytes(32);
    const staffConfig = localAccessConfig({ databaseUrl: db.staffUrl, sessionKey, phoneKey });
    const customer = customerConfig({ databaseUrl: db.customerUrl, sessionKey: randomBytes(32), phoneKey: randomBytes(32) });
    const publicConfig = makePublicConfig({ mode: 'LOCAL_FIXTURE', origin: PUBLIC_ORIGIN, deploymentId: 'local-public-fixture',
        releaseSha: '0'.repeat(40), databaseUrl: db.publicUrl });
    const admin = new PrismaClient({ datasources: { db: { url: db.adminUrl } } });
    try {
        const identities = await seedLocalStaff(admin, staffConfig, { analyses: true, trained: true, traces: true });
        const reviewer = identities[0];
        await admin.staffOperationsGrant.create({ data: { id: randomUUID(), identityId: reviewer.id, accessVersion: reviewer.accessVersion,
            controlRevision: 1, mode: staffConfig.mode, origin: staffConfig.origin, deploymentId: staffConfig.deploymentId,
            releaseSha: staffConfig.releaseSha, configHash: staffConfig.configHash, authorizationEvidenceHash: 'a'.repeat(64),
            createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 3600_000) } });
        const { databaseUrl, ...activation } = publicConfig; await admin.publicReaderControl.create({ data: { ...activation, enabled: true } });
        await fixture.sql(`INSERT INTO atlas_customer."CustomerControl"(id,enabled,mode,origin,"deploymentId","releaseSha","configHash")
            VALUES('active',true,$1,$2,$3,$4,$5)`, [customer.mode, customer.origin, customer.deploymentId, customer.releaseSha, customer.configHash], db.name);
    } finally { await admin.$disconnect(); }
    const ownership = JSON.parse(readFileSync(join(fixture.directory, 'ownership.json'), 'utf8'));
    const files = { staff: join(fixture.directory, 'web-config.json'), public: join(fixture.directory, 'public-config.json'), customer: join(fixture.directory, 'customer-web-config.json') };
    const save = (path, data) => writeFileSync(path, JSON.stringify({ nonce: ownership.nonce, ...data }), { mode: 0o600 });
    save(files.staff, { databaseUrl: db.staffUrl, operationsDatabaseUrl: db.operationsUrl, sessionKey: sessionKey.toString('hex'), phoneKey: phoneKey.toString('hex') });
    save(files.public, { databaseUrl: db.publicUrl });
    save(files.customer, { databaseUrl: db.customerUrl, sessionKey: customer.sessionKey.toString('hex'), phoneKey: customer.phoneKey.toString('hex') });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop().finally(() => process.exit()); });
    await Promise.all([startApp('atlas-app', 4328, { ATLAS_LOCAL_POSTGRES: '1', ATLAS_LOCAL_POSTGRES_FILE: files.staff }),
        startApp('atlas-public', 4319, { ATLAS_LOCAL_PUBLIC: '1', ATLAS_LOCAL_PUBLIC_FILE: files.public }),
        startApp('atlas-customer', 4320, { ATLAS_LOCAL_CUSTOMER: '1', ATLAS_LOCAL_CUSTOMER_FILE: files.customer })]);
    router = await localSiteRouter();
    const first = browser(), second = browser(), operator = browser();
    const home = await first.call('/'); assert.equal(home.status, 200); assert.match(await home.text(), /href="\/account"/); mark('public account entry');
    for (const path of ['/administrator', '/accounting', '/api/staff/session', '/api/customer/session']) assert.equal((await first.call(path)).status, 404);
    assert.equal((await first.call('/admin/grading')).headers.get('location'), '/admin/'); mark('exact private route ownership');
    const boot = await json(await first.call('/account/api/customer/session')); assert.equal(boot.customer, null);
    const challenge = await json(await first.call('/account/api/customer/auth/request', { phone: '+1 (202) 555-0141', requestId: randomUUID() }, boot.csrf));
    assert.equal((await fixture.sql('SELECT count(*)::integer AS count FROM atlas_customer."CustomerAccount"', [], db.name)).rows[0].count, 0);
    await json(await first.call('/account/api/customer/auth/verify', { challengeId: challenge.challengeId, code: '000000' }, boot.csrf), 400);
    const signed = await json(await first.call('/account/api/customer/auth/verify', { challengeId: challenge.challengeId, code: '424242' }, boot.csrf));
    assert(signed.customer.id); assert.equal(signed.customer.profile, null); mark('phone-only verified customer creation');
    const replay = await json(await first.call('/account/api/customer/auth/verify', { challengeId: challenge.challengeId, code: '424242' }, boot.csrf));
    assert.equal(replay.customer.id, signed.customer.id); mark('lost verification reply retains one account');
    const profile = { name: 'Synthetic Customer', address1: '123 Example Street', address2: '', city: 'Example City', region: 'CA', postalCode: '00000', country: 'US' };
    const input = { requestId: randomUUID(), profile, confirmed: true, intakeMethod: 'DEALER_DROP_OFF',
        cards: [{ title: 'Synthetic card A', category: 'POKEMON' }, { title: 'Synthetic card B', category: 'SPORTS' }] };
    await json(await first.call('/account/api/customer/submissions', { ...input, profile: null }, signed.csrf), 400);
    const created = await json(await first.call('/account/api/customer/submissions', input, signed.csrf));
    const again = await json(await first.call('/account/api/customer/submissions', input, signed.csrf));
    assert.deepEqual(again, created); mark('idempotent submission with deferred profile');
    let listing = await json(await first.call('/account/api/customer/submissions')); const submission = listing.submissions[0];
    assert.equal(submission.cards.length, 2); assert(submission.cards.every(c => c.stage === 'SUBMITTED')); assert.equal(submission.intakeMethod, 'DEALER_DROP_OFF');
    await json(await first.call('/account/api/customer/profile', { profile: { ...profile, address1: '456 Later Street' } }, signed.csrf));
    const detail = await json(await first.call(`/account/api/customer/submissions/${submission.id}`));
    assert.equal((detail.submission ?? detail).profileSnapshot.address1, profile.address1); mark('confirmed address snapshot preserved');
    await json(await first.call('/account/api/customer/submissions', { ...input, requestId: randomUUID(), intakeMethod: 'MAIL_IN' }, signed.csrf));
    listing = await json(await first.call('/account/api/customer/submissions')); assert.equal(listing.submissions.length, 2);
    assert.deepEqual(new Set(listing.submissions.map(s => s.intakeMethod)), new Set(['MAIL_IN', 'DEALER_DROP_OFF'])); mark('both intake channels recorded');
    const secondBoot = await json(await second.call('/account/api/customer/session'));
    const secondChallenge = await json(await second.call('/account/api/customer/auth/request', { phone: '+12025550143', requestId: randomUUID() }, secondBoot.csrf));
    await json(await second.call('/account/api/customer/auth/verify', { challengeId: secondChallenge.challengeId, code: '424242' }, secondBoot.csrf));
    await json(await second.call(`/account/api/customer/submissions/${submission.id}`), 404);
    await json(await second.call(`/account/api/customer/cards/${submission.cards[0].id}`), 404); mark('cross-customer details denied');
    const staffBoot = await json(await operator.call('/admin/api/staff/session'));
    const staffChallenge = await json(await operator.call('/admin/api/staff/auth/request', { phone: '+12025550141', requestId: randomUUID() }, staffBoot.csrf));
    const staffSigned = await json(await operator.call('/admin/api/staff/auth/verify', { challengeId: staffChallenge.challengeId, code: '424242' }, staffBoot.csrf));
    // Preserve this owned synthetic projection to distinguish transport/DTO
    // incompatibility from authorization failure without logging production data.
    const projected = { submissions: (await fixture.sql('SELECT atlas_customer.submission_projection(id,true) AS submission FROM atlas_customer."CustomerSubmission" ORDER BY id', [], db.name)).rows.map(row => row.submission), nextCursor: null };
    writeFileSync(join(fixture.directory, 'synthetic-intake-projection.json'), JSON.stringify(projected, null, 2), { mode: 0o600 });
    customerIntakeQueue(projected);
    const queue = await json(await operator.call('/admin/api/staff/operations/customers')); assert.equal(queue.submissions.length, 2); mark('staff sees customer intake through separate session');
    await json(await first.call('/admin/api/staff/operations/customers'), 401);
    await json(await operator.call('/account/api/customer/submissions'), 401); mark('customer and staff credentials remain distinct');
    const staffCards = await json(await operator.call('/admin/api/staff/cards'));
    const specimen = staffCards.cards.find(c => c.evidenceComplete);
    const bind = { operationId: randomUUID(), cardId: submission.cards[0].id, specimenId: specimen.id, physicalReceiptConfirmed: true };
    const receipt = await json(await operator.call('/admin/api/staff/operations/customers/bind', bind, staffSigned.csrf)); assert(receipt.receipt);
    const progress = await json(await first.call(`/account/api/customer/submissions/${submission.id}`));
    const updated = progress.submission ?? progress;
    assert.notEqual(updated.cards[0].stage, 'SUBMITTED'); assert.equal(updated.cards[1].stage, 'SUBMITTED'); mark('mixed-card progress follows physical intake');
    await stopApp('atlas-customer'); await startApp('atlas-customer', 4320, { ATLAS_LOCAL_CUSTOMER: '1', ATLAS_LOCAL_CUSTOMER_FILE: files.customer });
    const restored = await json(await first.call('/account/api/customer/session')); assert.equal(restored.customer.id, signed.customer.id);
    assert.equal((await json(await first.call('/account/api/customer/submissions'))).submissions.length, 2); mark('customer session and submissions survive process restart');
    await json(await first.call('/account/api/customer/auth/logout', {}, signed.csrf));
    await json(await first.call('/account/api/customer/submissions'), 401); mark('logout revokes customer access');
    const result = { status: 'LOCAL_WEBSITE_PILOT_PASS', checks, origin, source: fixture.source.commit,
        syntheticOnly: true, realSms: false, realModel: false, hardwareActions: 0 };
    writeFileSync(join(fixture.directory, 'website-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, evidenceDirectory: fixture.directory }));
    if (serve) { console.log('Owned synthetic website is ready at http://127.0.0.1:4318; code424242. Ctrl-C stops and cleans only this fixture.'); await new Promise(() => {}); }
} catch (error) {
    writeFileSync(join(fixture.directory, 'website-failure.json'), JSON.stringify({ error: fixture.safe(error.message), checks }));
    throw error;
} finally { await stop(); }
