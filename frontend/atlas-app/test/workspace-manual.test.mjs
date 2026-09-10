import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { measureSpeedsterCenteringBorders, calculateCenteringBalance, calculateCenteringScore } from '@atlas/grading-core/scoring';
import { StaffWorkspaceIntake } from '../lib/server/access/workspace-intake.mjs';
import { StaffWorkspaceManual, parseWorkspaceManualAction } from '../lib/server/access/workspace-manual.mjs';
import { deny, hash } from '../lib/server/policy.mjs';

const FRAME = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const BOUNDARY = [{ x: .1, y: .05 }, { x: .9, y: .05 }, { x: .9, y: .95 }, { x: .1, y: .95 }];
const INNER = [{ x: .04, y: .06 }, { x: .96, y: .06 }, { x: .96, y: .94 }, { x: .04, y: .94 }];
const SPORTS = { category: 'SPORTS', playerName: '  Example Player  ', year: '2024', manufacturer: 'Example', productSet: 'Set', parallel: null, insert: null, cardNumber: '14' };
const POKEMON = { category: 'POKEMON', cardName: '  Example Pokémon  ', year: '2023', productSet: 'Sample Set', parallel: null, cardNumber: '7', layoutType: 'TRAINER' };
const NO_MAP = { status: 'NO_MAP', name: null, scope: null, version: null, registration: { FRONT: 'MISSING', BACK: 'MISSING' }, bindingReady: false, canRegister: false };
const clone = value => structuredClone(value);
async function manualFixture() {
    const f = { now: new Date('2026-09-10T04:00:00Z'), state: { cards: new Map(), operations: new Map(), ids: new Map() }, objects: new Map(), active: false, tail: Promise.resolve(), calls: [], ready: true,
        policy: { cohortId: 'ten-fresh-photo-cards', maxCards: 10, processingLimit: 1, expiresAt: new Date('2026-09-16T20:41:57Z'), intakeEnabled: true, claimsEnabled: true, astraEnabled: false } };
    f.staff = { id: 'authenticated-session-one' }; f.other = { id: 'authenticated-session-two' }; f.observer = { id: 'authenticated-observer' };
    f.identities = new Map([[f.staff, { id: randomUUID(), name: 'First Human', role: 'REVIEWER', accessVersion: 1 }], [f.other, { id: randomUUID(), name: 'Second Human', role: 'REVIEWER', accessVersion: 1 }], [f.observer, { id: randomUUID(), name: 'Observer', role: 'OBSERVER', accessVersion: 1 }]]);
    f.store = { async transaction(staff, operation) {
        const prior = f.tail; let release; f.tail = new Promise(resolve => { release = resolve; }); await prior;
        try {
            const identity = f.identities.get(staff); if (!identity) deny(401, 'SIGN_IN_REQUIRED');
            const state = clone(f.state); f.active = true;
            const tx = {
                async getCard(id) { return clone(state.cards.get(id) ?? null); }, async listCards(cohort) { return clone([...state.cards.values()].filter(value => value.cohortId === cohort)); },
                async insertCard(row) { assert(!state.cards.has(row.id)); state.cards.set(row.id, clone(row)); },
                async updateCard(row, revision) { if (state.cards.get(row.id)?.revision !== revision) deny(409, 'WORKSPACE_REVISION_CHANGED'); assert.equal(row.revision, revision + 1); state.cards.set(row.id, clone(row)); },
                async getOperation(actor, id) { return clone(state.operations.get(`${actor}:${id}`) ?? null); }, async getOperationById(id) { return clone(state.ids.get(id) ?? null); },
                async insertOperation(row) { const key = `${row.actorId}:${row.operationId}`; assert(!state.operations.has(key)); assert(!state.ids.has(row.id)); state.operations.set(key, clone(row)); state.ids.set(row.id, clone(row)); }
            };
            const result = await operation({ tx, identity, session: { tokenHash: 'f'.repeat(64) }, control: { revision: 6 }, policy: clone(f.policy), now: new Date(f.now) });
            f.state = state; return result;
        } finally { f.active = false; release(); }
    } };
    const intake = new StaffWorkspaceIntake({ store: f.store, source: { reserve: ({ cardId, creatorId }) => ({ sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` }) }, storage: {
        async grant({ upload }) { f.objects.set(upload.objectRef, Buffer.from(`${upload.side} fresh image`)); return { id: upload.id, method: 'PUT', url: 'https://storage.example/photo', headers: { 'Content-Type': upload.contentType }, expiresAt: new Date(+f.now + 60_000).toISOString() }; },
        async verify({ upload }) { return { objectRef: upload.objectRef, byteCount: upload.byteCount, sha256: upload.sha256, contentType: upload.contentType, width: 800, height: 1100 }; }
    } });
    f.intake = intake;
    let current = (await intake.create(f.staff, { operationId: randomUUID(), title: 'Fresh physical card', identity: {} })).card;
    for (const side of ['FRONT', 'BACK']) {
        const bytes = Buffer.from(`${side} fresh image`), plan = await intake.planUpload(f.staff, current.id, { operationId: randomUUID(), expectedRevision: current.revision, side, file: { name: `${side}.png`, contentType: 'image/png', byteCount: bytes.length, sha256: hash(bytes) } });
        current = (await intake.completeUpload(f.staff, current.id, { operationId: randomUUID(), expectedRevision: plan.card.revision, uploadId: plan.upload.id })).card;
    }
    current = (await intake.queue(f.staff, current.id, { operationId: randomUUID(), expectedRevision: current.revision, pairConfirmed: true })).card;
    current = (await intake.claim(f.staff, current.id, { operationId: randomUUID(), expectedRevision: current.revision, operator: 'HUMAN' })).card;
    f.id = current.id;
    f.map = NO_MAP;
    f.reply = (request, state = 'SUCCEEDED') => {
        const row = f.state.ids.get(request.requestId), action = row.result.action, side = row.result.payload.side;
        return { requestId: request.requestId, cardId: request.cardId, action, captureHash: request.binding.captureHash, claimFence: request.binding.claimFence, state,
            ...(action === 'PREPARE_SIDE' ? { side, preparation: { manifestHash: (side === 'FRONT' ? 'a' : 'b').repeat(64), width: 1270, height: 1778, sourceCorners: clone(f.state.cards.get(f.id).workspace.preparation[side].corners), matColor: 'BLACK', centeringProposal: INNER } } : ['RESOLVE_MAP', 'REGISTER_MAP', 'CONTINUE_WITHOUT_MAP'].includes(action) ? { map: clone(f.map) } : { specimenId: randomUUID() }) };
    };
    f.respond = async request => f.reply(request);
    f.source = Object.fromEntries(['prepare', 'finalize', 'status', 'resolveMap', 'registerMap', 'continueWithoutMap'].map(method => [method, async request => {
        assert.equal(f.active, false, 'The external port runs outside a database transaction.');
        assert.equal(f.state.cards.get(f.id).workspace.pending.requestId, request.requestId, 'Durable intent exists before any external call.');
        f.calls.push({ method, request: clone(request) }); return f.respond(request, method);
    }]));
    f.manual = new StaffWorkspaceManual({ intake, source: f.source, sourceReady: () => f.ready });
    const project = f.manual.projectIntake; f.restart = () => { intake.project = project; f.manual = new StaffWorkspaceManual({ intake, source: f.source, sourceReady: () => f.ready }); intake.project = f.manual.project.bind(f.manual); }; f.restart();
    f.current = () => f.state.cards.get(f.id);
    f.input = (action, payload = {}) => ({ operationId: randomUUID(), expectedRevision: f.current().revision, action, payload });
    f.act = (action, payload = {}, staff = f.staff) => f.manual.action(staff, f.id, f.input(action, payload));
    f.identity = () => f.act('SAVE_IDENTITY', { identity: POKEMON, cornerShape: 'SQUARE' });
    f.boundary = side => f.act('SAVE_BOUNDARY', { side, corners: BOUNDARY, matColor: 'BLACK' });
    f.prepareBoth = async () => { await f.identity(); for (const side of ['FRONT', 'BACK']) { await f.boundary(side); await f.act('PREPARE_SIDE', { side }); } };
    return f;
}

test('manual identity uses the canonical category contract and records selected physical corners', async () => {
    const f = await manualFixture(), input = f.input('SAVE_IDENTITY', { identity: SPORTS, cornerShape: 'SQUARE' }), result = await f.manual.action(f.staff, f.id, input);
    assert.equal(result.operationId, input.operationId); assert.equal(result.card.identity.playerName, 'Example Player'); assert.equal(result.card.workspace.cornerShape, 'SQUARE');
    assert.equal('cardName' in result.card.identity, false); assert.equal(result.card.stage, 'PREPARATION'); assert.equal(f.calls.length, 0);
    f.restart(); const before = f.state.operations.size, replay = await f.manual.action(f.staff, f.id, input);
    assert.equal(replay.card.revision, result.card.revision); assert.equal(f.state.operations.size, before);
    for (const identity of [{ ...POKEMON, playerName: 'Wrong category' }, { ...SPORTS, cardName: 'Wrong category' }, { ...POKEMON, layoutType: null }]) assert.throws(() => parseWorkspaceManualAction({ ...input, payload: { identity } }));
});

test('identity and boundary edits invalidate dependent preparation and centering without rewriting prior operations', async () => {
    const f = await manualFixture(); await f.identity(); await f.boundary('FRONT');
    const before = clone([...f.state.operations.values()]); await f.act('SAVE_IDENTITY', { identity: POKEMON, cornerShape: 'ROUNDED_3_18_MM' });
    assert.deepEqual(f.current().workspace.preparation, {}); assert.deepEqual(f.current().workspace.centering, {});
    for (const original of before) assert.deepEqual(f.state.ids.get(original.id), original);
    await f.boundary('FRONT'); await f.act('PREPARE_SIDE', { side: 'FRONT' }); await f.act('SAVE_CENTERING', { side: 'FRONT', outer: FRAME, inner: INNER, confirmed: true });
    assert.ok(f.current().workspace.centering.FRONT); const prepared = clone(f.current().workspace.preparation.FRONT);
    await f.boundary('FRONT'); assert.equal(f.current().workspace.preparation.FRONT.status, 'BOUNDARY_SAVED'); assert.equal(f.current().workspace.centering.FRONT, undefined);
    assert.ok([...f.state.operations.values()].some(row => row.result.preparation?.manifestHash === prepared.manifestHash));
});

test('manual centering uses the unchanged engine on a prepared full frame and never accepts entered scores', async () => {
    const f = await manualFixture(); await f.prepareBoth();
    const input = f.input('SAVE_CENTERING', { side: 'FRONT', outer: FRAME, inner: INNER, confirmed: true });
    for (const payload of [{ ...input.payload, outer: BOUNDARY }, { ...input.payload, score: 10 }, { ...input.payload, confirmed: false }]) await assert.rejects(f.manual.action(f.staff, f.id, { ...input, payload }));
    const result = await f.manual.action(f.staff, f.id, input), actual = result.card.workspace.centering.FRONT, borders = measureSpeedsterCenteringBorders(INNER);
    assert.deepEqual(actual.bordersMm, borders); assert.equal(actual.score, calculateCenteringScore(borders));
    assert.equal(actual.ratios.leftRight, calculateCenteringBalance(borders.leftMm, borders.rightMm).map(value => Number(value.toFixed(2))).join(' / '));
    assert.equal(actual.preparationHash, result.card.workspace.preparation.FRONT.manifestHash);
    await f.act('SAVE_CENTERING', { side: 'BACK', outer: FRAME, inner: INNER, confirmed: true }); assert.equal(f.current().stage, 'INSPECTION');
    assert.ok((await f.intake.read(f.staff, f.id)).card.capabilities.actions.includes('RESOLVE_MAP'));
    assert.equal((await f.intake.read(f.staff, f.id)).card.capabilities.actions.includes('INITIALIZE_REPORT'), false);
    await f.act('RESOLVE_MAP'); assert.ok((await f.intake.read(f.staff, f.id)).card.capabilities.actions.includes('INITIALIZE_REPORT'));
});

test('durable preparation intent survives lost external response and restart; recovery only reads the saved request status', async () => {
    const f = await manualFixture(); await f.identity(); await f.boundary('FRONT');
    f.respond = async () => { throw new Error('Unknown provider reply'); }; const input = f.input('PREPARE_SIDE', { side: 'FRONT' }), first = await f.manual.action(f.staff, f.id, input);
    assert.ok(first.card.workspace.pending); assert.equal(first.operationId, input.operationId); assert.deepEqual(first.card.capabilities.actions, []);
    const pending = clone(first.card.workspace.pending); assert.equal(f.calls[0].method, 'prepare');
    f.restart(); f.respond = async request => f.reply(request, 'UNKNOWN');
    const held = await f.manual.recover(f.staff, f.id, { requestId: pending.requestId }); assert.deepEqual(held.card.workspace.pending, pending);
    f.respond = async request => f.reply(request); const recovered = await f.manual.recover(f.staff, f.id, { requestId: pending.requestId });
    assert.equal(recovered.card.workspace.pending, undefined); assert.equal(recovered.card.workspace.preparation.FRONT.status, 'PREPARED');
    assert.deepEqual(f.calls.map(call => call.method), ['prepare', 'status', 'status']);
    for (const call of f.calls) assert.equal(call.request.requestId, pending.requestId);
    const count = f.calls.length; await f.manual.action(f.staff, f.id, input); assert.equal(f.calls.length, count);
});

test('foreign reviewer, observer, expired claim policy and stale revision cannot dispatch preparation', async () => {
    const f = await manualFixture(); await f.identity(); await f.boundary('FRONT'); const input = f.input('PREPARE_SIDE', { side: 'FRONT' });
    await assert.rejects(f.manual.action(f.other, f.id, input), /WORKSPACE_CLAIM_CONFLICT/);
    await assert.rejects(f.manual.action(f.observer, f.id, input), /WORKSPACE_REVIEW_PERMISSION_REQUIRED/);
    await assert.rejects(f.manual.action(f.staff, f.id, { ...input, expectedRevision: input.expectedRevision - 1 }), /WORKSPACE_REVISION_CHANGED/);
    f.policy.expiresAt = new Date(+f.now - 1); await assert.rejects(f.manual.action(f.staff, f.id, input), /WORKSPACE_CAPABILITY_UNAVAILABLE/);
    assert.equal(f.calls.length, 0);
});

test('late preparation cannot overwrite a changed capture or operator fence', async () => {
    for (const change of ['capture', 'fence', 'revision']) {
        const f = await manualFixture(); await f.identity(); await f.boundary('FRONT'); let resolve, entered;
        const waiting = new Promise(value => { entered = value; }); f.respond = request => new Promise(value => { resolve = () => value(f.reply(request)); entered(); });
        const operation = f.act('PREPARE_SIDE', { side: 'FRONT' }); await waiting;
        const current = f.current(); if (change === 'capture') current.captureHash = 'c'.repeat(64); else if (change === 'fence') current.claimFence++; else current.revision++;
        resolve(); await assert.rejects(operation, /WORKSPACE_CLAIM_CONFLICT|WORKSPACE_REVISION_CHANGED/);
        assert.equal(f.current().workspace.preparation.FRONT.status, 'BOUNDARY_SAVED'); assert.ok(f.current().workspace.pending);
    }
});

test('mismatched source receipts and failed prepared evidence remain pending until exact status resolves', async () => {
    for (const corrupt of [result => ({ ...result, requestId: randomUUID() }), result => ({ ...result, captureHash: 'd'.repeat(64) }), result => ({ ...result, preparation: { ...result.preparation, width: 1269 } })]) {
        const f = await manualFixture(); await f.identity(); await f.boundary('FRONT'); f.respond = async request => corrupt(f.reply(request));
        await assert.rejects(f.act('PREPARE_SIDE', { side: 'FRONT' }), /WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED/);
        const pending = clone(f.current().workspace.pending); assert.ok(pending); assert.equal(f.current().workspace.preparation.FRONT.status, 'BOUNDARY_SAVED');
        await assert.rejects(f.manual.recover(f.other, f.id, { requestId: pending.requestId }), /WORKSPACE_CLAIM_CONFLICT/);
        f.respond = async request => f.reply(request); await f.manual.recover(f.staff, f.id, { requestId: pending.requestId });
        assert.deepEqual(f.calls.map(call => call.method), ['prepare', 'status']);
    }
});

test('manual report initialization requires both measured prepared sides, preserves pending status, and attaches one exact specimen', async () => {
    const f = await manualFixture(); await f.prepareBoth();
    await assert.rejects(f.act('INITIALIZE_REPORT'), /WORKSPACE_CAPABILITY_UNAVAILABLE/);
    for (const side of ['FRONT', 'BACK']) await f.act('SAVE_CENTERING', { side, outer: FRAME, inner: INNER, confirmed: true });
    await f.act('RESOLVE_MAP');
    f.respond = async request => f.reply(request, 'PENDING'); const input = f.input('INITIALIZE_REPORT'), pending = await f.manual.action(f.staff, f.id, input);
    const requestId = pending.card.workspace.pending.requestId; assert.equal(f.calls.at(-1).method, 'finalize');
    const specimenId = randomUUID(); f.respond = async request => ({ ...f.reply(request), specimenId });
    const result = await f.manual.recover(f.staff, f.id, { requestId }); assert.equal(result.card.specimenId, specimenId); assert.equal(result.card.state, 'IN_PROGRESS');
    assert.equal(result.card.stage, 'INSPECTION'); assert.deepEqual(result.card.capabilities.actions, []);
    const before = f.calls.length; const replay = await f.manual.action(f.staff, f.id, input); assert.equal(replay.card.specimenId, specimenId); assert.equal(f.calls.length, before);
});

test('map failures require a genuine affirmative human decision; no-map and integrity states cannot bypass registration', async () => {
    for (const status of ['NO_MAP', 'LOADED', 'LOOKUP_FAILED', 'INTEGRITY_ERROR', 'REGISTRATION_BLOCKED']) {
        const f = await manualFixture(); await f.prepareBoth();
        for (const side of ['FRONT', 'BACK']) await f.act('SAVE_CENTERING', { side, outer: FRAME, inner: INNER, confirmed: true });
        f.map = { ...NO_MAP, status, canRegister: ['LOADED', 'REGISTRATION_BLOCKED'].includes(status) };
        await f.act('RESOLVE_MAP'); const allowed = ['LOOKUP_FAILED', 'REGISTRATION_BLOCKED'].includes(status);
        assert.equal((await f.intake.read(f.staff, f.id)).card.capabilities.actions.includes('CONTINUE_WITHOUT_MAP'), allowed);
        await assert.rejects(f.act('CONTINUE_WITHOUT_MAP', { confirmed: false }), /WORKSPACE_REQUEST_INVALID/);
        if (!allowed) { await assert.rejects(f.act('CONTINUE_WITHOUT_MAP', { confirmed: true }), /WORKSPACE_CAPABILITY_UNAVAILABLE/); continue; }
        await assert.rejects(f.act('CONTINUE_WITHOUT_MAP', { confirmed: true }, f.other), /WORKSPACE_CLAIM_CONFLICT/);
        f.map = { ...NO_MAP, status: 'HUMAN_REVIEW_WITHOUT_MAP' };
        const result = await f.act('CONTINUE_WITHOUT_MAP', { confirmed: true });
        assert.equal(result.card.workspace.map.status, 'HUMAN_REVIEW_WITHOUT_MAP'); assert.ok(result.card.capabilities.actions.includes('INITIALIZE_REPORT'));
        const history = [...f.state.operations.values()].filter(row => row.result.action === 'RESOLVE_MAP');
        await f.act('SAVE_CENTERING', { side: 'FRONT', outer: FRAME, inner: INNER, confirmed: true });
        assert.equal(f.current().workspace.map, undefined); for (const row of history) assert.deepEqual(f.state.ids.get(row.id), row);
    }
});

test('unknown registration and malformed source map retain the exact pending action for status-only recovery', async () => {
    const f = await manualFixture(); await f.prepareBoth();
    for (const side of ['FRONT', 'BACK']) await f.act('SAVE_CENTERING', { side, outer: FRAME, inner: INNER, confirmed: true });
    f.map = { ...NO_MAP, status: 'LOADED', canRegister: true }; await f.act('RESOLVE_MAP');
    f.respond = async request => f.reply(request, 'UNKNOWN'); const pending = await f.act('REGISTER_MAP');
    assert.ok(pending.card.workspace.pending); assert.deepEqual(pending.card.capabilities.actions, []);
    f.respond = async request => ({ ...f.reply(request), map: { ...f.map, bindingReady: true } });
    await assert.rejects(f.manual.recover(f.staff, f.id, { requestId: pending.card.workspace.pending.requestId }), /WORKSPACE_SOURCE_OUTCOME_UNCONFIRMED/);
    f.map = { ...f.map, registration: { FRONT: 'REGISTERED', BACK: 'REGISTERED' }, bindingReady: true, canRegister: false };
    f.respond = async request => f.reply(request); const settled = await f.manual.recover(f.staff, f.id, { requestId: pending.card.workspace.pending.requestId });
    assert.ok(settled.card.capabilities.actions.includes('INITIALIZE_REPORT')); assert.equal(f.calls.filter(call => call.method === 'registerMap').length, 1);
});
