import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { canonical, digest } from '../src/protocol.mjs';
import { makeIntakeConfig, signIntakeRequest, verifyIntakeRequest, ScopedSourceIntake, intakeClient, validateIntakeReceipt } from '../src/intake.mjs';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const h = n => String(n).repeat(64);
function fixture() {
    const now = new Date();
    const config = makeIntakeConfig({ mode: 'LOCAL_FIXTURE', origin: 'https://intake.example.test', deploymentId: 'private-local',
        releaseSha: '0'.repeat(40), key: Buffer.alloc(32, 7), gradingPolicyHash: h(1), otherKeyHashes: [h(2),h(3),h(4)] });
    const control = { id: 'active', enabled: true, mode: config.mode, origin: 'https://staff.example.test', deploymentId: 'staff-local',
        releaseSha: '0'.repeat(40), configHash: h(5), gradingPolicyHash: h(1), revision: 3 };
    const identity = { id: id(1), phoneHash: h(6), accessVersion: 2, role: 'REVIEWER', revokedAt: null };
    const session = { tokenHash: h(7), identityId: identity.id, browserHash: h(8), accessVersion: 2, controlRevision: 3,
        revokedAt: null, createdAt: new Date(+now - 1000), expiresAt: new Date(+now + 600_000) };
    const browser = { tokenHash: h(8), controlRevision: 3, createdAt: new Date(+now - 2000), expiresAt: new Date(+now + 600_000) };
    const grant = { id: id(2), identityId: identity.id, accessVersion: 2, controlRevision: 3, mode: control.mode, origin: control.origin,
        deploymentId: control.deploymentId, releaseSha: control.releaseSha, configHash: control.configHash,
        authorizationEvidenceHash: h(9), createdAt: new Date(+now - 1000), expiresAt: new Date(+now + 600_000), revokedAt: null };
    const intake = { ...config, enabled: true, revision: 1 };
    const source = { sourceType: 'LOCAL_FIXTURE', sourceId: 'preserved-1', sourceOwnerId: 'owner-1' };
    const original = { id: source.sourceId, createdByUserId: source.sourceOwnerId, workflowState: 'CAPTURED', updatedAt: new Date(+now - 20_000) };
    const asset = { sha256: h(1), sourceRef: 'private/fixture/front.webp', byteCount: 100, width: 100, height: 100, contentType: 'image/webp' };
    const preparation = { preparationRelease: { fixture: 'explicit-local-admission' }, frontAuthorityHash: h(2), backAuthorityHash: h(3) };
    const scope = { actorId: identity.id, sessionHash: session.tokenHash, browserHash: browser.tokenHash, accessVersion: 2,
        controlRevision: 3, staffOrigin: control.origin, deploymentId: control.deploymentId, releaseSha: control.releaseSha,
        staffConfigHash: control.configHash, operationsGrantId: grant.id };
    const state = { now, finish: now, rows: [], calls: [], duplicate: false, inside: false, failFlush: false };
    const tx = {
        async $queryRaw(strings, ...args) {
            const sql = strings.join('?'); state.calls.push(sql);
            if (sql.includes('clock_timestamp')) { const n = state.calls.filter(v => v.includes('clock_timestamp')).length; return [{ now: n % 2 ? state.now : state.finish }]; }
            for (const [name, row] of Object.entries({ StaffIntakeControl: intake, StaffControl: control, StaffIdentity: identity, StaffSession: session, StaffBrowser: browser }))
                if (sql.includes(`"${name}"`)) return [row];
            if (sql.includes('"StaffOperationsGrant"')) return state.duplicate ? [grant, { ...grant, id: id(99) }] : [grant];
            if (sql.includes('"StaffSourceAdmission"')) return state.rows.filter(row => row.id === args[0]);
            throw new Error(sql);
        },
        async $executeRaw(strings, ...args) {
            const sql = strings.join('?'); state.calls.push(sql);
            if (sql.includes('INSERT INTO')) {
                const names = ['id','actorId','sessionHash','operationsGrantId','controlRevision','sourceType','sourceId','sourceOwnerId',
                    'sourceRevision','title','subtitle','evidenceCanonical','evidenceHash','admissionCanonical','admissionHash','gradingPolicyHash','bridgeConfigHash','createdAt','expiresAt'];
                state.rows.push(Object.fromEntries(names.map((name, i) => [name, args[i]])));
            }
            if (state.failFlush && sql.includes('SET CONSTRAINTS')) throw new Error('deferred constraint');
            return 1;
        },
    };
    const client = { async $transaction(work) {
        const saved = structuredClone(state.rows); state.inside = true;
        try { return await work(tx); } catch (error) { state.rows = saved; throw error; } finally { state.inside = false; }
    } };
    const ports = { async loadSource(_tx, exact) { assert.equal(state.inside, true); assert.deepEqual(exact, source); return original; },
        sourceEvidence: (_source, sourceRevision) => ({ sourceId: source.sourceId, sourceOwnerId: source.sourceOwnerId, sourceRevision,
            sides: { FRONT: asset, BACK: asset }, originals: { FRONT: asset, BACK: asset } }),
        assertSourceAdmission() {}, sourceAdmission: () => preparation, sourceTitle: () => ({ title: 'Preserved card', subtitle: 'Authorized captured fixture' }),
        isStaffPhoneAllowed: phoneHash => phoneHash === identity.phoneHash };
    const bridge = new ScopedSourceIntake({ client, config, ports });
    const signed = () => signIntakeRequest(config, scope, source, +now, id(3));
    const run = () => { const r = signed(); return bridge.receive(r.body, r.signature); };
    return { config, control, identity, session, browser, grant, intake, source, original, preparation, scope, state, ports, bridge, signed, run };
}
test('intake receipt preserves both sides and originals without releasing private descriptors', async () => {
    const f = fixture(), result = await f.run();
    assert.equal(result.receiptId, id(3)); assert.equal(f.state.rows.length, 1);
    assert.equal(JSON.stringify(result).includes('private/'), false);
    assert.equal(+f.state.rows[0].expiresAt, +f.session.createdAt + 300_000);
    validateIntakeReceipt(f.state.rows[0], { source: f.source, gradingPolicyHash: f.config.gradingPolicyHash, bridgeConfigHash: f.config.configHash });
    assert.ok(f.state.calls[0].includes('pg_advisory_xact_lock')); assert.ok(f.state.calls.at(-1).includes('SET CONSTRAINTS'));
});
test('same nonce is immutable idempotent and rejects changed source or scope', async () => {
    const f = fixture(); const a = await f.run(), b = await f.run(); assert.deepEqual(a, b); assert.equal(f.state.rows.length, 1);
    f.original.updatedAt = new Date(+f.original.updatedAt + 1);
    await assert.rejects(f.run(), /INTAKE_NONCE_CONFLICT/); assert.equal(f.state.rows.length, 1);
});
test('separate nonces produce stable evidence and admission hashes', async () => {
    const f = fixture(); await f.run(); const r = signIntakeRequest(f.config, f.scope, f.source, +f.state.now, id(4));
    await f.bridge.receive(r.body, r.signature);
    assert.equal(f.state.rows[0].admissionHash, f.state.rows[1].admissionHash);
});
test('signature purpose, audience, expiration and exact source are enforced', () => {
    const f = fixture(), r = f.signed();
    assert.throws(() => verifyIntakeRequest(f.config, r.body, h(0), +f.state.now), /AUTHENTICATION/);
    assert.throws(() => verifyIntakeRequest(f.config, r.body, r.signature, +f.state.now + 30_000), /EXPIRED/);
    for (const change of [p => p.purpose = 'atlas-other-v1', p => p.audience = 'https://evil.test', p => p.source.url = 'https://evil.test', p => p.source.sourceId = '../secret']) {
        const p = JSON.parse(r.body); change(p); const body = canonical(p), signature = createHmac('sha256', f.config.key).update(body).digest('hex');
        assert.throws(() => verifyIntakeRequest(f.config, body, signature, +f.state.now));
    }
});
test('disabled intake/staff and policy/control drift fail before source reads', async () => {
    for (const mutate of [f => f.intake.enabled = false, f => f.control.enabled = false, f => f.intake.configHash = h(0),
        f => f.control.gradingPolicyHash = h(0), f => f.control.revision++, f => f.intake.clientKeyHash = h(0)]) {
        const f = fixture(); mutate(f); await assert.rejects(f.run(), /INTAKE_NOT_ENABLED/); assert.equal(f.state.rows.length, 0);
    }
});
test('expired, revoked, unbound or stale human authority fails', async () => {
    for (const mutate of [f => f.session.createdAt = new Date(+f.state.now - 300_001), f => f.session.revokedAt = f.state.now,
        f => f.grant.revokedAt = f.state.now, f => f.identity.accessVersion++, f => f.browser.expiresAt = f.state.now,
        f => f.grant.configHash = h(0), f => f.state.duplicate = true, f => f.ports.isStaffPhoneAllowed = () => false]) {
        const f = fixture(); mutate(f); await assert.rejects(f.run(), /FRESH_HUMAN/); assert.equal(f.state.rows.length, 0);
    }
});
test('final DB clock expiry and deferred failures roll back receipt', async () => {
    const f = fixture(); f.state.finish = new Date(+f.state.now + 30_001);
    await assert.rejects(f.run(), /EXPIRED/); assert.equal(f.state.rows.length, 0);
    const g = fixture(); g.state.failFlush = true;
    await assert.rejects(g.run(), /deferred constraint/); assert.equal(g.state.rows.length, 0);
});
test('owner, captured state, absent release and missing originals fail closed', async () => {
    for (const mutate of [f => f.original.createdByUserId = 'wrong', f => f.original.workflowState = 'NEW',
        f => f.preparation.preparationRelease = null, f => f.ports.sourceEvidence = (_s, sourceRevision) => ({ sourceRevision })]) {
        const f = fixture(); mutate(f); await assert.rejects(f.run()); assert.equal(f.state.rows.length, 0);
    }
});
test('asynchronous preparation admission rejection is awaited', async () => {
    const f = fixture(); f.ports.assertSourceAdmission = async () => { throw new Error('release not admitted'); };
    await assert.rejects(f.run(), /release not admitted/); assert.equal(f.state.rows.length, 0);
});
test('key reuse with another authority is rejected', () => {
    const f = fixture(); assert.throws(() => makeIntakeConfig({ ...f.config, otherKeyHashes: [f.config.clientKeyHash,h(2),h(3)] }), /CONFIGURATION/);
});
test('fixed destination transport returns safe summary and rejects redirect/error or huge body', async () => {
    const f = fixture(), summary = await f.run();
    const client = intakeClient(f.config, async (url, options) => {
        assert.equal(url, `${f.config.origin}/api/internal/atlas/intake`); assert.equal(options.redirect, 'error');
        verifyIntakeRequest(f.config, options.body, options.headers['x-atlas-intake-signature']); return new Response(JSON.stringify(summary));
    });
    assert.deepEqual(await client.call(f.scope, f.source), summary);
    await assert.rejects(intakeClient(f.config, async () => new Response('', { status: 302 })).call(f.scope,f.source), /UNCONFIRMED/);
    await assert.rejects(intakeClient(f.config, async () => new Response('x'.repeat(5000))).call(f.scope,f.source), /RESPONSE_INVALID/);
});

import { receiptSourceValidation, withSourceIntake } from '../../../frontend/atlas-app/lib/server/access/intake.mjs';
test('staff validator checks definer receipt actor, grant, time and canonical scope', async () => {
    const f = fixture(); await f.run(); const row = f.state.rows[0];
    const context = { actorKind: 'HUMAN', capability: 'OPERATIONS', identity: f.identity, session: f.session, control: f.control,
        operationsGrantId: f.grant.id, tx: { async $queryRaw(strings, ...args) {
            if (strings.join('').includes('clock_timestamp')) return [{ now: f.state.now }];
            assert.deepEqual(args, [f.identity.id,f.session.tokenHash,f.grant.id,f.source.sourceType,f.source.sourceId,f.source.sourceOwnerId]);
            return [row];
        } } };
    const validator = receiptSourceValidation({ gradingPolicyHash: f.config.gradingPolicyHash, bridgeConfigHash: f.config.configHash });
    assert.equal((await validator.inspect(context, f.source)).evidenceHash, row.evidenceHash);
    row.operationsGrantId = id(99); await assert.rejects(validator.inspect(context,f.source), /EXPIRED/); row.operationsGrantId = f.grant.id;
    row.expiresAt = f.state.now; await assert.rejects(validator.inspect(context,f.source), /EXPIRED/);
    row.expiresAt = new Date(+f.state.now + 10_000); row.admissionHash = h(0);
    await assert.rejects(validator.inspect(context,f.source), /RECEIPT_INVALID/);
});
test('staff facade ends authority transaction before external preflight and reruns service authority', async () => {
    const f = fixture(); let inside = false, calls = [];
    const admin = { async transaction(_staff, work) { inside = true; try { return await work({ identity: f.identity, session: f.session,
        control: f.control, operationsGrantId: f.grant.id, actorKind: 'HUMAN', capability: 'OPERATIONS' }); } finally { inside = false; } } };
    const operations = { admin, async previewIntake(staff, source) { assert.equal(inside, false); calls.push('service'); return admin.transaction(staff, () => source); },
        roster() { assert.equal(this, operations); return 'roster'; } };
    const intake = { binding: { gradingPolicyHash: f.config.gradingPolicyHash, bridgeConfigHash: f.config.configHash },
        async call(scope, source) { assert.equal(inside, false); assert.deepEqual(scope, f.scope); assert.deepEqual(source, f.source); calls.push('external'); } };
    const facade = withSourceIntake({ operations, admin, intake });
    assert.deepEqual(await facade.previewIntake({}, f.source), f.source); assert.deepEqual(calls, ['external', 'service']);
    assert.equal(facade.roster(), 'roster');
    intake.call = async () => { throw new Error('preflight denied'); }; calls = [];
    await assert.rejects(facade.previewIntake({}, f.source), /preflight denied/); assert.deepEqual(calls, []);
});
test('staff facade ten-card preflight resolves exact persisted source identities', async () => {
    const f = fixture(), ids = Array.from({ length: 10 }, (_,i) => id(100+i)), sources = ids.map((_,i) => ({ ...f.source, sourceId: `source-${i}` }));
    let inside = false, externals = 0, completed = false;
    const admin = { async transaction(_staff, work) { inside = true; try { return await work({ identity: f.identity, session: f.session,
        control: f.control, operationsGrantId: f.grant.id, actorKind: 'HUMAN', capability: 'OPERATIONS', tx: {
            staffAudit: { async findUnique() { return null; } },
            staffSpecimen: { async findMany(query) { assert.deepEqual(query.where.id.in, ids); return sources.map((s,i) => ({ id: ids[i], ...s })); } },
        } }); } finally { inside = false; } } };
    const operations = { admin, async preparePilot() { assert.equal(inside, false); assert.equal(externals, 10); completed = true; } };
    const intake = { binding: { gradingPolicyHash: f.config.gradingPolicyHash, bridgeConfigHash: f.config.configHash },
        async call(_scope, source) { assert.equal(inside, false); assert.deepEqual(source, sources[externals++]); } };
    await withSourceIntake({ operations, admin, intake }).preparePilot({}, { operationId: 'prepare-1', reason: 'Authorized fixture', authorizationEvidenceHash: h(1),
        specimens: ids.map(specimenId => ({ specimenId, evidenceHash: h(1), sourceBindingHash: h(2) })),
        policy: { version: 'atlas-grading-bridge-policy-v1', pilotId: id(8), specimenIds: ids, expiresAt: new Date(+f.state.now+60_000).toISOString(),
            maxOperationsPerCard: 1,maxTotalMicroUsd: 1000,maxCardMicroUsd: 100,reservationPerOperationMicroUsd: 100,maxWorkerCalls: 1,deadlineMs: 1000 } });
    assert.equal(completed, true);
});
test('production intake rejects absent preparation release independently of an empty assert port', async () => {
    const f = fixture();
    const config = makeIntakeConfig({ ...f.config, mode: 'PRODUCTION', releaseSha: 'a'.repeat(40), otherKeyHashes: [h(2),h(3),h(4)] });
    Object.assign(f.intake, config); f.control.mode = 'PRODUCTION'; f.control.releaseSha = 'b'.repeat(40);
    f.grant.mode = 'PRODUCTION'; f.grant.releaseSha = f.control.releaseSha; f.scope.releaseSha = f.control.releaseSha;
    f.source.sourceType = 'SPEEDSTER'; f.preparation.preparationRelease = null;
    const bridge = new ScopedSourceIntake({ client: f.bridge.client, config, ports: f.ports });
    const r = signIntakeRequest(config,f.scope,f.source,+f.state.now,id(3));
    await assert.rejects(bridge.receive(r.body,r.signature), /INTAKE_ADMISSION_REQUIRED/); assert.equal(f.state.rows.length,0);
});
test('self-consistent rehashed receipt cannot substitute another source or preparation binding', async () => {
    const f = fixture(); await f.run(); const row = structuredClone(f.state.rows[0]);
    const admission = JSON.parse(row.admissionCanonical); admission.source.sourceOwnerId = 'another-owner';
    row.admissionCanonical = canonical(admission); row.admissionHash = digest(row.admissionCanonical);
    assert.throws(() => validateIntakeReceipt(row, { source:f.source,gradingPolicyHash:f.config.gradingPolicyHash,bridgeConfigHash:f.config.configHash }), /ADMISSION_REQUIRED/);
});
import { StaffOperations } from '../../../frontend/atlas-app/lib/server/access/operations.mjs';
test('lost intake reply recovers the actual service audit before any external source call', async () => {
    const f = fixture(), audits = new Map(); let authorized = true, authorityChecks = 0, externalCalls = 0;
    const admin = { async transaction(_staff, work) {
        authorityChecks++; if (!authorized) throw new Error('FRESH_HUMAN_OPERATIONS_REQUIRED');
        return work({ identity: f.identity,session: f.session,control: f.control,operationsGrantId: f.grant.id,
            actorKind: 'HUMAN',capability: 'OPERATIONS',now: f.state.now,capabilityUntil: f.grant.expiresAt,
            tx: { staffAudit: { async findUnique({ where }) { return audits.get(where.id) ?? null; },
                async create({ data }) { audits.set(data.id, data); return data; } } } });
    } };
    const operations = new StaffOperations({ admin });
    const input = { operationId: 'intake-recover-1',reason: 'Exact authorized source',authorizationEvidenceHash:h(1),source:f.source,sourceBindingHash:h(2) };
    const receipt = { specimenId:id(10),admitted:true };
    // Persist via the real mutation implementation: no copy of audit ID logic in this test.
    await operations.mutation({},'SPECIMEN_INTAKE_ADMITTED',digest(canonical(input.source)),input,async () => ({ receipt }));
    const intake = { binding: { gradingPolicyHash:f.config.gradingPolicyHash,bridgeConfigHash:f.config.configHash },
        async call() { externalCalls++; throw new Error('source now unavailable'); } };
    const facade = withSourceIntake({ operations,admin,intake });
    assert.deepEqual(await facade.admitIntake({},input),receipt); assert.equal(externalCalls,0); assert.equal(authorityChecks,2);
    await assert.rejects(facade.admitIntake({}, { ...input,reason:'Changed request' }), /OPERATIONS_REQUEST_CONFLICT/); assert.equal(externalCalls,0);
    const stored = [...audits.values()][0]; stored.event = 'TEN_CARD_PILOT_PREPARED';
    await assert.rejects(facade.admitIntake({},input), /OPERATIONS_REQUEST_CONFLICT/); stored.event = 'SPECIMEN_INTAKE_ADMITTED';
    authorized = false; await assert.rejects(facade.admitIntake({},input), /FRESH_HUMAN_OPERATIONS_REQUIRED/); assert.equal(externalCalls,0);
});
test('lost pilot preparation reply recovers actual service audit without reloading source metadata', async () => {
    const f = fixture(), audits = new Map();
    const admin = { async transaction(_staff,work) { return work({ identity:f.identity,session:f.session,control:f.control,
        operationsGrantId:f.grant.id,actorKind:'HUMAN',capability:'OPERATIONS',now:f.state.now,capabilityUntil:f.grant.expiresAt,
        tx:{ staffAudit:{ async findUnique({where}) { return audits.get(where.id); },async create({data}) { audits.set(data.id,data); } } } }); } };
    const operations = new StaffOperations({admin}), ids = Array.from({length:10},(_,i)=>id(100+i));
    const input = { operationId:'pilot-recover-1',reason:'Authorized ten card pilot',authorizationEvidenceHash:h(1),
        specimens:ids.map(specimenId=>({specimenId,evidenceHash:h(1),sourceBindingHash:h(2)})),
        policy:{version:'atlas-grading-bridge-policy-v1',pilotId:id(8),specimenIds:ids,expiresAt:new Date(+f.state.now+60_000).toISOString(),
            maxOperationsPerCard:1,maxTotalMicroUsd:1000,maxCardMicroUsd:100,reservationPerOperationMicroUsd:100,maxWorkerCalls:1,deadlineMs:1000} };
    const receipt = { state:'PREPARED_ONLY',pilotId:input.policy.pilotId };
    await operations.mutation({},'TEN_CARD_PILOT_PREPARED',input.policy.pilotId,input,async()=>({receipt}));
    const facade = withSourceIntake({operations,admin,intake:{binding:{gradingPolicyHash:f.config.gradingPolicyHash,bridgeConfigHash:f.config.configHash},
        async call(){throw new Error('must not call source');}}});
    assert.deepEqual(await facade.preparePilot({},input),receipt);
    await assert.rejects(facade.preparePilot({}, {...input,policy:{...input.policy,pilotId:id(9)}}),/OPERATIONS_REQUEST_CONFLICT/);
});
test('phone allowlist changes require a different activated intake config hash',()=>{
    const f=fixture();
    const original=makeIntakeConfig({...f.config,otherKeyHashes:[],phoneAllowlistHash:h(1)});
    const changed=makeIntakeConfig({...f.config,otherKeyHashes:[],phoneAllowlistHash:h(2)});
    assert.notEqual(original.configHash,changed.configHash);
    assert.throws(()=>makeIntakeConfig({...f.config,otherKeyHashes:[],phoneAllowlistHash:'bad'}),/CONFIGURATION_INVALID/);
    assert.throws(()=>new ScopedSourceIntake({client:f.bridge.client,ports:f.ports,
        config:{...original,phoneAllowlistHash:h(2)}}),/CONFIGURATION_INVALID/);
});
test('only explicit local fixture mode admits the exact loopback staff origin',()=>{
    const f=fixture(),scope={...f.scope,staffOrigin:'http://127.0.0.1:4318'};
    const r=signIntakeRequest(f.config,scope,f.source,+f.state.now);
    assert.equal(verifyIntakeRequest(f.config,r.body,r.signature,+f.state.now).scope.staffOrigin,scope.staffOrigin);
    assert.throws(()=>signIntakeRequest(f.config,{...scope,staffOrigin:'http://127.0.0.1:4319'},f.source),/CONFIGURATION_INVALID/);
    const production=makeIntakeConfig({...f.config,mode:'PRODUCTION',releaseSha:'a'.repeat(40),otherKeyHashes:[]});
    assert.throws(()=>signIntakeRequest(production,scope,{...f.source,sourceType:'SPEEDSTER'}),/CONFIGURATION_INVALID/);
});
