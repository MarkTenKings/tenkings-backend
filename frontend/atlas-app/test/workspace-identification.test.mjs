import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { hash, deny } from '../lib/server/policy.mjs';
import { canonical } from '../lib/server/review-contract.mjs';
import { StaffWorkspaceIntake } from '../lib/server/access/workspace-intake.mjs';
import { StaffWorkspaceIdentification, workspaceIdentificationSettings } from '../lib/server/access/workspace-identification.mjs';
import { deriveIdentificationPhoto, identificationRequest, parseIdentificationProviderOutput, workspaceIdentificationProvider } from '../lib/server/access/workspace-identification-provider.mjs';
import { IDENTIFICATION_VERSION, IDENTIFICATION_FIELDS, adoptWorkspaceIdentitySuggestions, parseWorkspaceIdentificationSuggestions,
    parseWorkspaceIdentificationResult, workspaceIdentificationPhotos, workspaceIdentificationPairKey } from '../lib/workspace-identification.mjs';
import { staffRequestDeadline } from '../lib/client-request.mjs';

const now = new Date('2026-09-11T04:00:00.000Z'), uuid = () => randomUUID();
const suggestions = (values = {}) => Object.fromEntries(IDENTIFICATION_FIELDS.map(field => [field, Object.hasOwn(values, field)
    ? { value: values[field], confidence: 'high', evidence: `Front printed ${field}.` } : { value: null, confidence: 'unknown', evidence: null }]));
const photos = () => ({ FRONT: { uploadId: uuid(), sha256: hash('front') }, BACK: { uploadId: uuid(), sha256: hash('back') } });
const result = (values = {}) => ({ suggestions: suggestions({ category: 'POKEMON', name: 'Charmander', cardNumber: '007/165', ...values }), warnings: [],
    provenance: { version: IDENTIFICATION_VERSION, authority: 'MACHINE', phase: 'INTAKE_IDENTIFICATION', model: 'gpt-6-astra', reasoningEffort: 'low', maxOutputTokens: 2400, elapsedMs: 7000, usageCeilingMicroUsd: 10000 } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const jsonResponse = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
const providerResponse = (value = suggestions({ category: 'SPORTS', name: 'Example Player' })) => ({ id: 'resp_fixture', model: 'gpt-6-astra', service_tier: 'default', status: 'completed',
    usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

test('identification reservations retain price and safe-integer integrity without a five-dollar cap', () => {
    const policy = { version: 'atlas-intake-identification-policy-v1', pilotId: uuid(), expiresAt: new Date(+now + 3600000).toISOString(),
        ocrReserveMicroUsd: 10000, modelReserveMicroUsd: 6000000, costEvidenceHash: hash('reviewed fixture pricing') };
    const settings = patch => workspaceIdentificationSettings({ ATLAS_IDENTIFICATION_ENABLED: 'true',
        ATLAS_IDENTIFICATION_OPENAI_API_KEY: 'fixture-openai-secret', ATLAS_IDENTIFICATION_GOOGLE_VISION_API_KEY: 'fixture-vision-secret',
        ATLAS_IDENTIFICATION_POLICY_JSON: JSON.stringify({ ...policy, ...patch }) }, { configHash: hash('staff') });
    assert.equal(settings({}).enabled, true);
    for (const patch of [{ modelReserveMicroUsd: 589599 }, { ocrReserveMicroUsd: 0 },
        { modelReserveMicroUsd: Number.MAX_SAFE_INTEGER }, { modelReserveMicroUsd: 6000000.1 }])
        assert.equal(settings(patch).enabled, false);
});

function fixture() {
    const f = { cards: new Map(), operations: new Map(), objects: new Map(), time: new Date(now), calls: 0, reads: 0, derives: 0,
        actor: { id: uuid(), role: 'REVIEWER', name: 'Grader', accessVersion: 1 }, staff: {}, pending: Promise.resolve() };
    const policy = { cohortId: uuid(), maxCards: 10, expiresAt: new Date(+now + 3600000), intakeEnabled: true, claimsEnabled: true, astraEnabled: true, processingLimit: 1 };
    f.settings = workspaceIdentificationSettings({ ATLAS_IDENTIFICATION_ENABLED: 'true', ATLAS_IDENTIFICATION_OPENAI_API_KEY: 'fixture-openai-secret',
        ATLAS_IDENTIFICATION_GOOGLE_VISION_API_KEY: 'fixture-vision-secret', ATLAS_IDENTIFICATION_POLICY_JSON: JSON.stringify({
            version: 'atlas-intake-identification-policy-v1', pilotId: uuid(), expiresAt: new Date(+now + 3600000).toISOString(),
            ocrReserveMicroUsd: 10000, modelReserveMicroUsd: 1000000, costEvidenceHash: hash('reviewed fixture pricing') }) }, { configHash: hash('staff') });
    f.store = { async transaction(staff, work) {
        const prior = f.pending; let release; f.pending = new Promise(r => { release = r; }); await prior;
        try {
            if (staff !== f.staff) deny(401, 'SIGN_IN_REQUIRED');
            const cards = structuredClone(f.cards), operations = structuredClone(f.operations);
            const tx = { getCard: async id => structuredClone(cards.get(id) ?? null), listCards: async () => [...cards.values()].map(value => structuredClone(value)),
                insertCard: async card => cards.set(card.id, structuredClone(card)), updateCard: async (card, revision) => {
                    assert.equal(cards.get(card.id).revision, revision); assert.equal(card.revision, revision + 1); cards.set(card.id, structuredClone(card)); },
                getOperation: async (actorId, operationId) => [...operations.values()].find(row => row.actorId === actorId && row.operationId === operationId) ?? null,
                getOperationById: async id => operations.get(id) ?? null,
                listOperations: async (id, actions) => [...operations.values()].filter(row => row.cardId === id && actions.includes(row.action)),
                insertOperation: async row => { assert(!operations.has(row.id)); operations.set(row.id, structuredClone(row)); } };
            const reply = await work({ tx, now: new Date(f.time), identity: f.actor, session: { tokenHash: hash('fixture session') },
                control: { mode: 'LOCAL_FIXTURE', releaseSha: '0'.repeat(40), revision: 1 }, policy, databaseTx: {} });
            f.cards = cards; f.operations = operations; return reply;
        } finally { release(); }
    } };
    f.intake = new StaffWorkspaceIntake({ store: f.store, source: { reserve: ({ cardId, creatorId }) => ({ sourceType: 'SPEEDSTER', sourceId: `atlas-${cardId}`, sourceOwnerId: `atlas-staff-${creatorId}` }) },
        storage: { read: async ({ upload }) => { f.reads++; return Buffer.from(f.objects.get(upload.objectRef)); } } });
    f.service = new StaffWorkspaceIdentification({ intake: f.intake, settings: f.settings,
        control: async context => ({ enabled: true, mode: 'LOCAL_FIXTURE', releaseSha: '0'.repeat(40), cohortId: context.policy.cohortId,
            configHash: f.settings.configHash, policyHash: f.settings.policyHash, policyCanonical: f.settings.policyCanonical, expiresAt: policy.expiresAt, revision: 1 }),
        derive: async ({ upload, bytes }) => { f.derives++; return { bytes, lineage: { sourceSha256: upload.sha256, derivedSha256: hash(bytes) } }; },
        provider: async () => { f.calls++; assert([...f.operations.values()].some(row => row.action === 'IDENTIFICATION_REQUEST')); if (f.wait) await f.wait; if (f.fail) throw new Error('uncertain paid response'); return result(f.values); } });
    f.card = async identity => {
        const reply = await f.intake.create(f.staff, { operationId: uuid(), title: '', identity: identity ?? {} });
        const card = f.cards.get(reply.card.id);
        for (const side of ['FRONT', 'BACK']) {
            const bytes = Buffer.from(`${card.id}/${side}`), uploadId = uuid(), verificationId = uuid();
            const upload = { id: uploadId, cardId: card.id, side, sourceId: card.source.sourceId, sourceOwnerId: card.source.sourceOwnerId,
                objectRef: `${card.id}/${side}.png`, sha256: hash(bytes), byteCount: bytes.length, contentType: 'image/png', name: `${side}.png` };
            const verification = { objectRef: upload.objectRef, sha256: upload.sha256, byteCount: upload.byteCount, contentType: 'image/png', width: 100, height: 200 };
            f.operations.set(uploadId, { id: uploadId, cardId: card.id, action: 'upload-plan', result: { upload } });
            f.operations.set(verificationId, { id: verificationId, cardId: card.id, action: 'upload-complete', result: { uploadId, verification } });
            card.sides[side] = { uploadId, verificationId }; f.objects.set(upload.objectRef, bytes);
        }
        return (await f.intake.read(f.staff, card.id)).card;
    };
    f.input = card => ({ operationId: uuid(), expectedRevision: card.revision, photos: workspaceIdentificationPhotos(card) });
    return f;
}

test('category discovery maps exact strings and preserves unsupported, low-confidence and human conflicts', () => {
    const pair = photos(), base = { identity: {}, currentPair: pair, requestPair: pair };
    const adopted = adoptWorkspaceIdentitySuggestions({ ...base, suggestions: suggestions({ category: 'SPORTS', name: 'Player Case', manufacturer: 'Printed Maker', cardNumber: '007/100', variant: 'Foil', cardType: 'Baseball' }) });
    assert.deepEqual(adopted.identity, { category: 'SPORTS', playerName: 'Player Case', manufacturer: 'Printed Maker', cardNumber: '007/100' });
    assert.equal(adopted.status, 'READY');
    const pokemon = adoptWorkspaceIdentitySuggestions({ ...base, suggestions: suggestions({ category: 'POKEMON', name: 'Card', manufacturer: 'Not a Pokemon field' }) });
    assert.deepEqual(pokemon.identity, { category: 'POKEMON', cardName: 'Card' });
    for (const [category, status] of [['UNSUPPORTED', 'UNSUPPORTED'], [null, 'UNKNOWN']]) {
        const value = suggestions(category ? { category } : {});
        assert.equal(adoptWorkspaceIdentitySuggestions({ ...base, suggestions: value }).status, status);
    }
    const conflicting = adoptWorkspaceIdentitySuggestions({ ...base, identity: { category: 'SPORTS', playerName: 'Human' }, suggestions: suggestions({ category: 'POKEMON', name: 'Wrong' }) });
    assert.equal(conflicting.status, 'CONFLICT'); assert.equal(conflicting.identity.playerName, 'Human');
    const low = suggestions({ category: 'SPORTS' }); low.category.confidence = 'low';
    assert.equal(adoptWorkspaceIdentitySuggestions({ ...base, suggestions: low }).status, 'UNKNOWN');
});
test('late pair results and intentional blank human edits cannot be adopted', () => {
    const pair = photos();
    const empty = adoptWorkspaceIdentitySuggestions({ identity: { category: 'POKEMON', cardName: '' }, requestIdentity: { category: 'POKEMON', cardName: '' },
        editedFields: ['cardName'], suggestions: suggestions({ category: 'POKEMON', name: 'Machine' }), currentPair: pair, requestPair: pair });
    assert.equal(empty.identity.cardName, '');
    assert.equal(adoptWorkspaceIdentitySuggestions({ identity: {}, suggestions: suggestions(), currentPair: pair, requestPair: photos() }).status, 'STALE_PAIR');
    for (const mutation of [v => v.extra = {}, v => v.cardNumber.value = '1'.repeat(41), v => v.name.evidence = '<script>unsafe</script>']) {
        const value = suggestions({ name: 'Card', cardNumber: '007' }); mutation(value); assert.throws(() => parseWorkspaceIdentificationSuggestions(value));
    }
});
test('real source derivation retains full-size original hash and separately bounds helper raster with exact lineage', async () => {
    const bytes = await sharp({ create: { width: 2000, height: 3000, channels: 3, background: '#aa4411' } }).png().toBuffer(), original = Buffer.from(bytes);
    const upload = { id: uuid(), sha256: hash(bytes), byteCount: bytes.length, contentType: 'image/png' };
    const photo = await deriveIdentificationPhoto({ bytes, upload, verification: { width: 2000, height: 3000 } });
    assert.deepEqual(bytes, original); assert.equal(photo.lineage.sourceSha256, hash(original)); assert.equal(photo.lineage.derivedSha256, hash(photo.bytes));
    assert.equal(photo.lineage.transform.height, 1400); assert.equal(photo.lineage.transform.sourceHeight, 3000);
    assert.equal(photo.lineage.transformHash, hash(canonical(photo.lineage.transform)));
    await assert.rejects(() => deriveIdentificationPhoto({ bytes, upload: { ...upload, sha256: hash('changed') }, verification: { width: 2000, height: 3000 } }));
});
test('both OCR sides overlap then one strict Astra request uses only derived bytes and bounded OCR', async () => {
    const gate = deferred(), calls = [], assets = { FRONT: { bytes: Buffer.from('front'), lineage: {} }, BACK: { bytes: Buffer.from('back'), lineage: {} } };
    const provider = workspaceIdentificationProvider({ openaiKey: 'fixture-openai-secret', googleKey: 'fixture-vision-secret', fetchImpl: async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        if (url.includes('vision.googleapis.com')) { if (calls.length === 2) gate.resolve(); await gate.promise; return jsonResponse({ responses: [{ fullTextAnnotation: { text: 'A'.repeat(8000) } }] }); }
        assert.equal(calls.length, 3); return jsonResponse(providerResponse());
    } });
    const response = await provider(assets); assert.equal(calls.length, 3); assert.equal(response.provenance.model, 'gpt-6-astra');
    const request = calls[2].body; assert.deepEqual(request.reasoning, { effort: 'low' }); assert.equal(request.store, false); assert.equal(request.max_output_tokens, 2400);
    assert.equal(request.text.format.strict, true); assert.equal(request.input[0].content.filter(part => part.type === 'input_image').length, 2);
    assert(!calls.some(call => call.url.includes('key='))); assert.equal(response.provenance.ocr.FRONT.status, 'READ');
    assert.equal(request.input[0].content[0].text.match(/A/g).length, 6000);
    assert.equal(staffRequestDeadline(`workspace/cards/${uuid()}/identify`, {}), 60000);
    assert.equal(staffRequestDeadline(`workspace/cards/${uuid()}/identify?x=1`, {}), 15000);
});
test('model refusals, wrong model, incomplete and usage overruns are rejected; OCR failure still allows photo support', async () => {
    for (const alter of [v => v.model = 'substitute', v => v.service_tier = 'priority', v => v.status = 'incomplete', v => v.output[0].content[0].type = 'refusal',
        v => { v.usage.input_tokens = 20000; v.usage.total_tokens = 20200; }]) { const payload = providerResponse(); alter(payload); assert.throws(() => parseIdentificationProviderOutput(payload)); }
    const malformed = providerResponse(); malformed.status = 'incomplete'; malformed.output = [];
    malformed.usage = { input_tokens: 1000000, output_tokens: 200, total_tokens: 1000200 };
    assert.throws(() => parseIdentificationProviderOutput(malformed), error => error.code === 'WORKSPACE_IDENTIFICATION_ENVELOPE_EXCEEDED'
        && error.usageCeilingMicroUsd === 25015000);
    const invalidCache = providerResponse(); invalidCache.usage.input_tokens_details = { cached_tokens: 1001 };
    assert.throws(() => parseIdentificationProviderOutput(invalidCache), error => error.code === 'WORKSPACE_IDENTIFICATION_INVALID');
    let calls = 0;
    const provider = workspaceIdentificationProvider({ openaiKey: 'fixture-openai-secret', googleKey: 'fixture-vision-secret', fetchImpl: async url => {
        calls++; if (url.includes('vision')) throw new Error('not readable'); return jsonResponse(providerResponse());
    } });
    const output = await provider({ FRONT: { bytes: Buffer.from('front'), lineage: {} }, BACK: { bytes: Buffer.from('back'), lineage: {} } });
    assert.equal(calls, 3); assert.equal(output.provenance.ocr.BACK.status, 'UNAVAILABLE'); assert.equal(output.warnings.length, 2);
});
test('reservation precedes provider, accepted identity persists, and exact retries recover without provider replay', async () => {
    const f = fixture(), card = await f.card(), input = f.input(card);
    const first = await f.service.identify(f.staff, card.id, input);
    assert.equal(first.card.identity.category, 'POKEMON'); assert.equal(first.card.identity.cardName, 'Charmander'); assert.equal(first.card.identity.cardNumber, '007/165');
    assert.equal(first.card.identityReady, true); assert.equal(first.card.identityReview.status, 'READY');
    parseWorkspaceIdentificationResult(first.identification, input.photos);
    const replay = await f.service.identify(f.staff, card.id, input); assert.deepEqual(replay, first); assert.equal(f.calls, 1);
    await f.service.identify(f.staff, card.id, { ...input, operationId: uuid() }); assert.equal(f.calls, 1);
    await assert.rejects(() => f.service.identify({}, card.id, input), error => error.code === 'SIGN_IN_REQUIRED');
    await assert.rejects(() => f.service.identify(f.staff, card.id, { ...input, storageKey: 'arbitrary' }));
});
test('concurrent request returns retained pending, late human edits win, and retake retains result without adopting it', async () => {
    const f = fixture(), card = await f.card({ category: 'POKEMON' }), input = f.input(card), gate = deferred(); f.wait = gate.promise;
    const running = f.service.identify(f.staff, card.id, input);
    while (!f.calls) await new Promise(resolve => setImmediate(resolve));
    const pending = await f.service.identify(f.staff, card.id, input); assert.equal(pending.identification.status, 'PENDING');
    await f.service.saveIdentity(f.staff, card.id, { operationId: uuid(), expectedRevision: card.revision,
        identity: { category: 'POKEMON', cardName: 'Human correction' }, editedFields: ['cardName'] });
    gate.resolve(); const reply = await running; assert.equal(reply.card.identity.cardName, 'Human correction'); assert.equal(f.calls, 1);
    const g = fixture(), replacement = await g.card(), oldInput = g.input(replacement), held = deferred(); g.wait = held.promise;
    const work = g.service.identify(g.staff, replacement.id, oldInput); while (!g.calls) await new Promise(resolve => setImmediate(resolve));
    g.cards.get(replacement.id).sides.FRONT = null; g.cards.get(replacement.id).revision++;
    held.resolve(); const late = await work; assert.equal(late.card.identity.category, undefined);
    assert.equal([...g.operations.values()].filter(row => row.action === 'IDENTIFICATION_RESULT').length, 1);
});
test('unknown paid outcome remains held across retries; queued staff category correction can unblock readiness', async () => {
    const f = fixture(), card = await f.card(), input = f.input(card); f.fail = true;
    const failed = await f.service.identify(f.staff, card.id, input); assert.equal(failed.identification.status, 'UNKNOWN'); assert.equal(failed.card.identityReady, false);
    f.fail = false; await f.service.identify(f.staff, card.id, input); assert.equal(f.calls, 1);
    const queued = await f.intake.queue(f.staff, card.id, { operationId: uuid(), expectedRevision: failed.card.revision, pairConfirmed: true });
    const edited = await f.service.saveIdentity(f.staff, card.id, { operationId: uuid(), expectedRevision: queued.card.revision,
        identity: { category: 'SPORTS', playerName: 'Human' }, editedFields: ['category', 'playerName'] });
    assert.equal(edited.card.state, 'WAITING'); assert.equal(edited.card.identityReady, true);
});
test('retake clears machine suggestions while preserving valid context for category-specific human corrections', async () => {
    for (const humanCorrection of [false, true]) {
        const f = fixture(); let card = await f.card();
        ({ card } = await f.service.identify(f.staff, card.id, f.input(card)));
        if (humanCorrection) ({ card } = await f.service.saveIdentity(f.staff, card.id, { operationId: uuid(), expectedRevision: card.revision,
            identity: { ...card.identity, cardName: '' }, editedFields: ['cardName'] }));
        f.intake.storage.verify = async () => { throw new Error('retake planning does not verify'); };
        f.intake.storage.grant = async ({ upload }) => ({ id: upload.id, url: 'https://synthetic-storage.example.test/retake',
            method: 'PUT', headers: { 'Content-Type': upload.contentType }, expiresAt: new Date(+now + 60000).toISOString() });
        const retake = await f.intake.planUpload(f.staff, card.id, { operationId: uuid(), expectedRevision: card.revision, side: 'FRONT',
            file: { name: 'retake.png', contentType: 'image/png', byteCount: 3, sha256: hash('new') } });
        assert.equal(retake.card.identityReady, false); assert.equal(retake.card.identityReview.status, 'UNKNOWN');
        assert.equal(retake.card.identity.cardNumber, undefined);
        if (humanCorrection) { assert.equal(retake.card.identity.category, 'POKEMON'); assert.equal(retake.card.identity.cardName, ''); }
        else assert.deepEqual(retake.card.identity, {});
    }
});
test('missing configuration and already queued exact pair cost no provider call', async () => {
    const f = fixture(), card = await f.card(), input = f.input(card); f.service.settings = { enabled: false };
    const unavailable = await f.service.identify(f.staff, card.id, input); assert.equal(unavailable.identification.status, 'UNAVAILABLE'); assert.equal(f.reads, 0); assert.equal(f.calls, 0);
    const other = await f.card(); const original = f.cards.get(card.id); original.pairConfirmedAt = now.toISOString(); original.captureHash = hash('bound'); original.state = 'WAITING';
    for (const side of ['FRONT', 'BACK']) {
        const retained = f.operations.get(f.cards.get(other.id).sides[side].uploadId).result.upload;
        const source = f.operations.get(original.sides[side].uploadId).result.upload;
        retained.sha256 = source.sha256; retained.byteCount = source.byteCount;
        f.operations.get(f.cards.get(other.id).sides[side].verificationId).result.verification.sha256 = source.sha256;
        f.operations.get(f.cards.get(other.id).sides[side].verificationId).result.verification.byteCount = source.byteCount;
    }
    const fresh = (await f.intake.read(f.staff, other.id)).card;
    const duplicate = await f.service.identify(f.staff, other.id, f.input(fresh)); assert.equal(duplicate.identification.status, 'EXISTING_CARD');
    assert.equal(duplicate.identification.existingCardId, card.id); assert.equal(f.calls, 0);
});
