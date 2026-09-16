import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import sharp from 'sharp';
import { identifyCard, parseCardIdentificationInput } from '@tenkings/card-identification-core';
import { createManualArtifactStore } from '@atlas/manual-service/artifacts';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { createIdentification, identificationEffects } from '../src/identification.mjs';
import { createDetailsStore, FIELDS, gradingIdentity } from '../src/details.mjs';

const V1 = 'card-identification-v1', V2 = 'card-identification-v2';
const MASK = 'responses(fullTextAnnotation/text,textAnnotations/description,error)';
const GOOGLE_KEY = 'synthetic-google-key-1234', OPENAI_KEY = 'synthetic-openai-key-1234';
const raw = value => Buffer.from(JSON.stringify(value));
const clone = value => structuredClone(value);
function suggestions(category = 'Sports cards', overrides = {}) {
  const values = { name: category === 'Pokémon' ? 'Pikachu' : 'Example Player', category,
    manufacturer: category === 'Pokémon' ? 'The Pokémon Company' : 'Panini', card_number: '025',
    year: '2023', set_name: 'Fixture set', variant: 'Holo', card_type: 'Base', ...overrides };
  return Object.fromEntries(FIELDS.map(field => [field, values[field] === null
    ? { value: null, confidence: 'unknown', evidence: null }
    : { value: values[field], confidence: 'high', evidence: `Front: ${field} print` }]));
}
function modelReply(value) {
  return { model: 'gpt-6-astra', status: 'completed', error: null, incomplete_details: null,
    usage: { input_tokens: 120, output_tokens: 80 }, output: [{ type: 'message', role: 'assistant',
      status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// These fixtures implement the narrow SQL/storage contracts used by the real
// stores. Transactions serialize, roll back on errors, and enforce row CAS and
// unique effect claims. They do not establish PostgreSQL or staff-session proof.
async function fixture({ category = 'Sports cards', values = {}, pauseModel = false,
  pauseRequestArtifact = false, httpStatus = 200 } = {}) {
  const cardId = randomUUID(), staff = { id: randomUUID(), edit: true };
  const sourceHash = digest('original synthetic pair'), objects = new Map();
  const db = { attempts: new Map(), details: new Map(), actions: new Map(), events: new Map() };
  const calls = { http: [], reads: [], authorization: [], receipts: [] };
  const modelEntered = deferred(), modelRelease = deferred();
  const requestArtifactEntered = deferred(), requestArtifactRelease = deferred(), requestArtifactFinished = deferred();
  const modelReceiptSaved = deferred();
  const original = { FRONT: { side: 'FRONT', sha256: digest('native front original') },
    BACK: { side: 'BACK', sha256: digest('native back original') } };
  let pair = { sourceHash, sides: {} };
  const workingBytes = {};
  for (const [side, background] of [['FRONT', '#aa3322'], ['BACK', '#2255bb']]) {
    workingBytes[side] = await sharp({ create: { width: 18, height: 25, channels: 3, background } }).png().toBuffer();
    pair.sides[side] = { photo: { original: original[side], workingFrame: { side, sha256: digest(workingBytes[side]) },
      decodePlan: { policy: 'synthetic-verified-working-frame' } } };
  }
  const originalPair = clone(pair);
  const tx = {
    async $queryRawUnsafe(sql, ...args) {
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.identification')) {
        const row = db.attempts.get(`${args[0]}:${args[1]}`); return row ? [clone(row)] : [];
      }
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.details WHERE')) {
        const row = db.details.get(args[0]); return row ? [clone(row)] : [];
      }
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.details_action')) {
        const row = db.actions.get(`${args[0]}:${args[1]}`); return row ? [clone(row)] : [];
      }
      if (sql.startsWith('SELECT id FROM atlas_manual.card')) return [];
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
    async $executeRawUnsafe(sql, ...args) {
      if (sql.startsWith('INSERT INTO atlas_manual_connected.identification(')) {
        const [id, card_id, source_hash, actor_id, input] = args, key = `${card_id}:${source_hash}`;
        if (db.attempts.has(key)) return 0;
        db.attempts.set(key, { id, card_id, source_hash, actor_id, input, state: 'RUNNING',
          result: null, error: null, created_at: new Date(), finished_at: null }); return 1;
      }
      if (sql.startsWith('UPDATE atlas_manual_connected.identification SET')) {
        const [state, result, error, id] = args;
        const row = [...db.attempts.values()].find(item => item.id === id);
        if (!row || row.state !== 'RUNNING') return 0;
        Object.assign(row, { state, result, error, finished_at: new Date() }); return 1;
      }
      if (sql.startsWith('INSERT INTO atlas_manual_connected.effect(')) {
        const [attempt_id, stage, event, request_hash, evidence] = args;
        const key = `${attempt_id}:${stage}:${event}`;
        if (db.events.has(key)) return 0;
        db.events.set(key, { attempt_id, stage, event, request_hash, evidence }); return 1;
      }
      if (sql.startsWith('INSERT INTO atlas_manual_connected.details(')) {
        const [card_id, content, content_hash] = args;
        if (db.details.has(card_id)) return 0;
        db.details.set(card_id, { card_id, content, content_hash, revision: 1 }); return 1;
      }
      if (sql.startsWith('UPDATE atlas_manual_connected.details SET')) {
        const [content, content_hash, id, revision] = args, row = db.details.get(id);
        if (!row || row.revision !== revision) return 0;
        Object.assign(row, { content, content_hash, revision: revision + 1 }); return 1;
      }
      if (sql.startsWith('INSERT INTO atlas_manual_connected.details_action(')) {
        const [card_id, action_id, actor_id, request_hash, result] = args, key = `${card_id}:${action_id}`;
        assert.equal(db.actions.has(key), false);
        db.actions.set(key, { actor_id, request_hash, result }); return 1;
      }
      throw new Error(`Unexpected fixture write: ${sql}`);
    },
  };
  let tail = Promise.resolve();
  const boundary = { transaction(principal, work) {
    const result = tail.then(async () => {
      requireThat(principal.id === staff.id, 403, 'FIXTURE_STAFF_DENIED');
      const before = clone(db);
      try { return await work({ tx, principal }); }
      catch (error) { Object.assign(db, before); throw error; }
    });
    tail = result.catch(() => {}); return result;
  } };
  const intakeRepository = {
    async authorizeInTransaction(_tx, principal, id, options = {}) {
      calls.authorization.push({ id, ...options });
      requireThat(id === cardId && principal.id === staff.id, 404, 'FIXTURE_CARD_DENIED');
      requireThat(!options.edit || principal.edit, 403, 'FIXTURE_EDIT_DENIED');
    },
    async assertCurrentPair(_tx, principal, expected) {
      await this.authorizeInTransaction(_tx, principal, expected.cardId, { edit: true });
      requireThat(expected.sourceHash === pair.sourceHash, 409, 'INTAKE_PAIR_STALE');
    },
  };
  const intake = { async verifiedPair(principal, id) {
    await intakeRepository.authorizeInTransaction(tx, principal, id); return clone(pair);
  }, async read(principal, id) {
    await intakeRepository.authorizeInTransaction(tx, principal, id);
    return { card: { cardId, ready: true, sourceHash: pair.sourceHash } };
  } };
  const storage = { async readDecodedFrame(args) {
    calls.reads.push(clone(args));
    const side = args.frame.side;
    assert.deepEqual(args, { frame: pair.sides[side].photo.workingFrame,
      original: pair.sides[side].photo.original, decodePlan: pair.sides[side].photo.decodePlan });
    return { bytes: Buffer.from(workingBytes[side]) };
  } };
  const artifactStore = createManualArtifactStore({ transport: {
    async putIfAbsent(value) {
      assert.equal(objects.has(value.key), false, 'immutable fixture keys must be create-only');
      objects.set(value.key, { ...value, bytes: Buffer.from(value.bytes) });
    },
    async read({ key, maxBytes }) {
      const found = objects.get(key); assert.ok(found); assert.equal(found.bytes.length, maxBytes);
      return { ...found, bytes: Buffer.from(found.bytes) };
    },
  } });
  const artifacts = { read: (...args) => artifactStore.read(...args), async write(value, source) {
    const ref = await artifactStore.write(value, source);
    if (pauseRequestArtifact && source.kind === 'IDENTIFICATION_REQUEST' && value.stage === 'MODEL') {
      requestArtifactEntered.resolve(); await requestArtifactRelease.promise; requestArtifactFinished.resolve();
    }
    return ref;
  } };
  const receiptClient = { async $queryRawUnsafe(sql, attempt_id, stage, event, request_hash, evidence) {
    assert.match(sql, /^SELECT atlas_manual_connected\.append_receipt\(/);
    const key = `${attempt_id}:${stage}:${event}`, value = { attempt_id, stage, event, request_hash, evidence };
    if (db.events.has(key)) assert.deepEqual(db.events.get(key), value);
    else db.events.set(key, value);
    calls.receipts.push(value);
    if (stage === 'MODEL' && event === 'RESPONSE') modelReceiptSaved.resolve();
    return [];
  } };
  const proposed = suggestions(category, values);
  const effects = identificationEffects({ openaiKey: OPENAI_KEY, googleKey: GOOGLE_KEY,
    async fetchImpl(url, init) {
      const parsed = new URL(url), body = JSON.parse(init.body);
      calls.http.push({ url: parsed, init, body });
      if (parsed.hostname === 'vision.googleapis.com') return Response.json({ responses: [{
        fullTextAnnotation: { text: category === 'Pokémon' ? 'Pokémon HP 60 025' : 'Panini 2023 Example Player' },
      }] });
      assert.equal(parsed.href, 'https://api.openai.com/v1/responses');
      modelEntered.resolve(); if (pauseModel) await modelRelease.promise;
      return Response.json(modelReply(proposed), { status: httpStatus });
    },
  });
  const details = createDetailsStore({ boundary, intakeRepository });
  const config = { boundary, intake, intakeRepository, storage, artifacts, details, effects, receiptClient };
  const identification = createIdentification(config);
  return { cardId, staff, sourceHash, originalPair, workingBytes, objects, db, calls, artifacts, details,
    identification, proposed, modelEntered, modelRelease,
    requestArtifactEntered, requestArtifactRelease, requestArtifactFinished, modelReceiptSaved,
    restart: () => createIdentification(config),
    currentRow: () => db.attempts.get(`${cardId}:${pair.sourceHash}`),
    retake() {
      pair = { ...clone(pair), sourceHash: digest('replacement synthetic pair') };
      pair.sides.FRONT.photo.original.sha256 = digest('retaken native front original');
      return pair.sourceHash;
    },
    async save(changes) {
      const current = await details.read(staff, cardId);
      return details.save(staff, cardId, { actionId: randomUUID(), expectedRevision: current.revision, changes });
    },
    artifactsOf(kind) { return [...objects.values()].filter(value => value.key.includes(`/${kind}/`)).map(value => JSON.parse(value.bytes)); },
    async seedV1({ state = 'COMPLETE', ageMs = 0, savedResult = true } = {}) {
      const bytes = {};
      for (const side of ['front', 'back']) bytes[side] = await sharp(workingBytes[side.toUpperCase()]).jpeg({ quality: 92 }).toBuffer();
      const input = parseCardIdentificationInput({ subject: { id: cardId, revision: pair.sourceHash },
        photos: Object.fromEntries(Object.entries(bytes).map(([side, bytes]) => [side,
          { ref: `historical-${side}`, sha256: digest(bytes), byteCount: bytes.length }])) });
      const result = savedResult ? await identifyCard(input, {
        readPhoto: async (_photo, context) => bytes[context.side],
        ocr: async () => raw({ responses: [{ fullTextAnnotation: { text: 'Panini 2023' } }] }),
        model: async () => raw(modelReply(proposed)),
      }) : null;
      const ref = result ? await artifacts.write(result, { cardId, kind: 'IDENTIFICATION_RESULT', sourceHash: pair.sourceHash }) : null;
      const row = { id: randomUUID(), card_id: cardId, source_hash: pair.sourceHash, actor_id: staff.id,
        input: canonical(input), state, result: ref ? canonical({ ref }) : null, error: null,
        created_at: new Date(Date.now() - ageMs), finished_at: state === 'COMPLETE' ? new Date() : null };
      db.attempts.set(`${cardId}:${pair.sourceHash}`, row); return { row, input, result };
    },
  };
}

test('new sports attempt transports V2 OCR envelopes and retains exact request, response and original-frame evidence', async () => {
  const f = await fixture(), result = await f.identification.run(f.staff, f.cardId);
  assert.equal(result.state, 'COMPLETE'); assert.equal(result.result.provenance.engine_version, V2);
  const saved = JSON.parse(f.currentRow().input);
  assert.equal(saved.engineVersion, V2); assert.equal(saved.input.subject.revision, f.sourceHash);
  const ocr = f.calls.http.filter(call => call.url.hostname === 'vision.googleapis.com');
  assert.equal(ocr.length, 2); assert.equal(f.calls.http.length, 3);
  for (const call of ocr) {
    assert.equal(call.url.searchParams.get('fields'), MASK);
    assert.deepEqual([...call.url.searchParams.keys()], ['fields']);
    assert.deepEqual(Object.keys(call.body), ['requests']);
    assert.equal(call.body.body, undefined); assert.equal(call.body.responseFields, undefined);
    assert.equal(call.init.headers['X-Goog-Api-Key'], GOOGLE_KEY);
    assert.equal(call.init.redirect, 'error'); assert.ok(call.init.signal instanceof AbortSignal);
  }
  const requests = f.artifactsOf('IDENTIFICATION_REQUEST');
  assert.equal(requests.length, 3);
  for (const evidence of requests) {
    assert.equal(evidence.engineVersion, V2); assert.equal(evidence.request, undefined);
    assert.equal(digest(evidence.requestJson), evidence.requestHash);
    const request = JSON.parse(evidence.requestJson);
    const event = f.db.events.get(`${result.attemptId}:${evidence.stage}:DISPATCH`);
    assert.equal(event.request_hash, evidence.requestHash);
    if (evidence.stage.startsWith('OCR_')) {
      assert.equal(request.responseFields, MASK);
      assert.ok(ocr.some(call => call.init.body === JSON.stringify(request.body)));
    } else {
      assert.equal(evidence.requestJson, f.calls.http.find(call => call.url.hostname === 'api.openai.com').init.body);
      assert.equal(evidence.requestHash, result.result.provenance.request_sha256);
      assert.equal(request.input[0].content.filter(part => part.type === 'input_image').length, 2);
    }
  }
  const responses = f.artifactsOf('IDENTIFICATION_RESPONSE');
  assert.equal(responses.length, 3); assert.equal(f.calls.receipts.length, 3);
  for (const response of responses) {
    assert.equal(response.engineVersion, V2); assert.equal(response.status, 200);
    assert.equal(digest(Buffer.from(response.base64, 'base64')), response.sha256);
  }
  assert.deepEqual(responses.find(value => value.stage === 'MODEL').usage, { input_tokens: 120, output_tokens: 80 });
  const images = f.artifactsOf('IDENTIFICATION_IMAGE'); assert.equal(images.length, 2);
  for (const image of images) {
    const side = image.original.side;
    assert.deepEqual(image.original, f.originalPair.sides[side].photo.original);
    assert.deepEqual(image.workingFrame, f.originalPair.sides[side].photo.workingFrame);
    assert.equal(image.mime, 'image/jpeg');
    assert.notEqual(digest(Buffer.from(image.base64, 'base64')), digest(f.workingBytes[side]));
  }
  assert.ok(f.calls.authorization.some(call => call.edit && call.lock === 'SHARE'));
  const adopted = await f.details.read(f.staff, f.cardId);
  assert.equal(adopted.details.profile, 'SPORTS');
  assert.equal(gradingIdentity(adopted.details).playerName, 'Example Player');
  const replay = await f.restart().run(f.staff, f.cardId);
  assert.deepEqual(replay.result, result.result); assert.equal(replay.attemptId, result.attemptId);
  assert.equal(f.calls.http.length, 3); assert.equal(f.calls.reads.length, 2);
  assert.equal((await f.details.read(f.staff, f.cardId)).revision, adopted.revision);
});

test('Pokémon V2 uses one model call with dependent Front detail; publisher and finish remain descriptive', async () => {
  const f = await fixture({ category: 'Pokémon', values: { card_number: '0'.repeat(80) } });
  const result = await f.identification.run(f.staff, f.cardId);
  assert.equal(result.state, 'COMPLETE'); assert.equal(f.calls.http.length, 3);
  const model = f.calls.http.find(call => call.url.hostname === 'api.openai.com').body;
  const images = model.input[0].content.filter(part => part.type === 'input_image');
  assert.equal(images.length, 3); assert.match(images[2].image_url, /^data:image\/png;base64,/);
  const detail = Buffer.from(images[2].image_url.split(',')[1], 'base64');
  const metadata = await sharp(detail).metadata(); assert.equal(metadata.width, 18); assert.equal(metadata.height, 13);
  const savedInput = JSON.parse(f.currentRow().input).input;
  assert.deepEqual(result.result.provenance.photos.front, savedInput.photos.front);
  const parent = Buffer.from(images[0].image_url.split(',')[1], 'base64');
  const region = { left: 0, top: 12, width: 18, height: 13 };
  assert.deepEqual(detail, await sharp(parent).extract(region).png().toBuffer());
  assert.deepEqual(result.result.provenance.pokemon_detail, {
    transform: 'pokemon-lower-front-png-v1', parent_side: 'front', parent_sha256: savedInput.photos.front.sha256,
    source_width: 18, source_height: 25, region, mime_type: 'image/png', byte_count: detail.length, sha256: digest(detail),
  });
  assert.equal(digest(parent), savedInput.photos.front.sha256);
  const adopted = await f.details.read(f.staff, f.cardId);
  assert.equal(adopted.details.profile, 'POKEMON'); assert.equal(adopted.details.fields.manufacturer, 'The Pokémon Company');
  assert.equal(adopted.details.fields.variant, 'Holo'); assert.equal(adopted.details.parallel, '');
  assert.equal(adopted.details.fields.card_number.length, 80);
  assert.throws(() => gradingIdentity(adopted.details), { name: 'SpeedsterIdentityValidationError' });
  const reviewed = await f.save({ layoutType: 'POKEMON' }), identity = gradingIdentity(reviewed.details);
  assert.equal(identity.cardName, 'Pikachu'); assert.equal(identity.cardNumber.length, 80);
  for (const forbidden of ['manufacturer', 'playerName', 'insert', 'variant']) assert.equal(Object.hasOwn(identity, forbidden), false);
  assert.equal(identity.parallel, null);
});

test('in-flight staff edits and explicit clears survive V2 result adoption and recovered COMPLETE replay', async () => {
  const f = await fixture({ pauseModel: true }), running = f.identification.run(f.staff, f.cardId);
  await f.modelEntered.promise;
  const edited = await f.save({ name: 'Human correction', manufacturer: '', variant: '', parallel: 'Human parallel' });
  f.modelRelease.resolve(); const result = await running; assert.equal(result.state, 'COMPLETE');
  const adopted = await f.details.read(f.staff, f.cardId);
  assert.equal(adopted.details.fields.name, 'Human correction'); assert.equal(adopted.details.fields.manufacturer, '');
  assert.equal(adopted.details.fields.variant, ''); assert.equal(adopted.details.parallel, 'Human parallel');
  assert.equal(adopted.details.fields.year, '2023'); assert.equal(adopted.details.fields.card_number, '025');
  assert.deepEqual(adopted.details.touched, edited.details.touched);
  const after = await f.save({ card_number: '' });
  await f.restart().run(f.staff, f.cardId);
  assert.deepEqual(await f.details.read(f.staff, f.cardId), after); assert.equal(f.calls.http.length, 3);
});

test('in-flight category, profile and layout edits keep grading identity category-safe', async () => {
  const f = await fixture({ pauseModel: true }), running = f.identification.run(f.staff, f.cardId);
  await f.modelEntered.promise;
  await f.save({ category: 'Pokémon', profile: 'POKEMON', layoutType: 'TRAINER', name: 'Human Trainer' });
  f.modelRelease.resolve(); assert.equal((await running).state, 'COMPLETE');
  const adopted = await f.details.read(f.staff, f.cardId), identity = gradingIdentity(adopted.details);
  assert.equal(adopted.details.fields.category, 'Pokémon'); assert.equal(adopted.details.profile, 'POKEMON');
  assert.equal(identity.cardName, 'Human Trainer'); assert.equal(identity.layoutType, 'TRAINER');
  assert.equal(Object.hasOwn(identity, 'manufacturer'), false); assert.equal(Object.hasOwn(identity, 'playerName'), false);
});

test('cleared category and profile are not inferred back from a late suggestion', async () => {
  const f = await fixture({ category: 'Pokémon', pauseModel: true }), running = f.identification.run(f.staff, f.cardId);
  await f.modelEntered.promise; await f.save({ category: '', profile: null, layoutType: null });
  f.modelRelease.resolve(); assert.equal((await running).state, 'COMPLETE');
  const adopted = await f.details.read(f.staff, f.cardId);
  assert.equal(adopted.details.fields.category, ''); assert.equal(adopted.details.profile, null);
  assert.throws(() => gradingIdentity(adopted.details), { code: 'MANUAL_CARD_PROFILE_REQUIRED' });
});

test('retake while V2 model is in flight saves stale evidence, fences adoption, and permits only one new pair attempt', async () => {
  const f = await fixture({ pauseModel: true }); await f.save({ name: 'Retained human name' });
  const before = await f.details.read(f.staff, f.cardId), running = f.identification.run(f.staff, f.cardId);
  await f.modelEntered.promise;
  const oldRow = f.currentRow(), newSource = f.retake(); f.modelRelease.resolve();
  const result = await running; assert.equal(result.state, 'STALE');
  // The refused adoption transaction rolls back its snapshot; read the retained
  // row again rather than relying on an object reference from before rollback.
  const staleRow = f.db.attempts.get(`${f.cardId}:${f.sourceHash}`);
  assert.equal(staleRow.state, 'STALE'); assert.ok(staleRow.result);
  assert.deepEqual(await f.details.read(f.staff, f.cardId), before);
  assert.equal((await f.restart().status(f.staff, f.cardId)).state, 'NOT_STARTED');
  const next = await f.restart().run(f.staff, f.cardId); assert.equal(next.state, 'COMPLETE');
  assert.notEqual(next.attemptId, oldRow.id); assert.equal(next.result.provenance.subject.revision, newSource);
  const current = await f.details.read(f.staff, f.cardId);
  assert.equal(current.details.fields.name, 'Retained human name'); assert.equal(current.details.sourceHash, newSource);
  assert.equal(f.db.attempts.size, 2); assert.equal(f.calls.http.length, 6);
  await f.restart().run(f.staff, f.cardId); assert.equal(f.calls.http.length, 6);
});

test('concurrent V2 starts and in-flight replay share one claimed attempt without duplicate provider work', async () => {
  const f = await fixture({ pauseModel: true });
  const first = f.identification.run(f.staff, f.cardId), second = f.restart().run(f.staff, f.cardId);
  await f.modelEntered.promise;
  const replay = await f.restart().run(f.staff, f.cardId); assert.equal(replay.state, 'RUNNING');
  f.modelRelease.resolve(); const results = await Promise.all([first, second]);
  assert.equal(results.filter(value => value.state === 'COMPLETE').length, 1);
  assert.ok(results.every(value => value.attemptId === replay.attemptId));
  assert.equal(f.db.attempts.size, 1); assert.equal(f.calls.http.length, 3);
  assert.equal([...f.db.events.values()].filter(value => value.event === 'DISPATCH').length, 3);
});

test('historical bare V1 COMPLETE rows load, recover missing adoption and replay without reinterpretation or providers', async () => {
  const f = await fixture(), seeded = await f.seedV1(), savedRow = clone(seeded.row);
  assert.equal(seeded.result.provenance.engine_version, V1);
  await f.save({ name: 'Reviewed legacy name', manufacturer: '' });
  const status = await f.restart().status(f.staff, f.cardId); assert.deepEqual(status.result, seeded.result);
  assert.equal((await f.details.read(f.staff, f.cardId)).details.sourceHash, null);
  const recovered = await f.restart().run(f.staff, f.cardId); assert.deepEqual(recovered.result, seeded.result);
  const adopted = await f.details.read(f.staff, f.cardId);
  assert.equal(adopted.details.fields.name, 'Reviewed legacy name'); assert.equal(adopted.details.fields.manufacturer, '');
  assert.equal(adopted.details.sourceHash, f.sourceHash); assert.equal(adopted.details.fields.year, '2023');
  await f.restart().run(f.staff, f.cardId);
  assert.deepEqual(await f.details.read(f.staff, f.cardId), adopted); assert.deepEqual(f.currentRow(), savedRow);
  assert.equal(f.calls.http.length, 0); assert.equal(f.calls.reads.length, 0); assert.equal(f.db.events.size, 0);
});

test('historical already-dispatched V1 RUNNING/UNKNOWN attempts remain V1 and never dispatch V2 on recovery', async () => {
  for (const ageMs of [0, 121000]) {
    const f = await fixture(), { row } = await f.seedV1({ state: 'RUNNING', savedResult: false, ageMs });
    const saved = clone(row), expectedState = ageMs ? 'UNKNOWN' : 'RUNNING';
    assert.equal((await f.restart().status(f.staff, f.cardId)).state, expectedState);
    assert.equal((await f.restart().run(f.staff, f.cardId)).state, expectedState);
    assert.deepEqual(f.currentRow(), saved); assert.equal(f.calls.http.length, 0); assert.equal(f.db.details.size, 0);
  }
});

test('unknown stored input or result versions and V1/V2 mismatches fail without fallback, adoption or paid work', async t => {
  for (const variant of ['unknown-running-input', 'unknown-complete-input', 'unknown-result', 'v2-input-v1-result', 'v1-input-v2-result']) {
    await t.test(variant, async () => {
      const f = await fixture(), seeded = await f.seedV1();
      if (['unknown-running-input', 'unknown-complete-input', 'v2-input-v1-result'].includes(variant)) {
        seeded.row.input = canonical({ engineVersion: variant.startsWith('unknown') ? 'card-identification-v99' : V2, input: seeded.input });
        if (variant === 'unknown-running-input') { seeded.row.state = 'RUNNING'; seeded.row.result = null; }
      } else {
        const changed = clone(seeded.result);
        changed.provenance.engine_version = variant === 'unknown-result' ? 'card-identification-v99' : V2;
        const ref = await f.artifacts.write(changed, { cardId: f.cardId, kind: 'IDENTIFICATION_RESULT', sourceHash: f.sourceHash });
        seeded.row.result = canonical({ ref });
      }
      const saved = clone(seeded.row);
      await assert.rejects(f.restart().status(f.staff, f.cardId));
      await assert.rejects(f.restart().run(f.staff, f.cardId));
      assert.deepEqual(f.currentRow(), saved); assert.equal(f.db.details.size, 0);
      assert.equal(f.calls.http.length, 0); assert.equal(f.calls.reads.length, 0); assert.equal(f.db.events.size, 0);
    });
  }
});

test('real V2 HTTP failure retains status/accounting and UNKNOWN replay never retries the model', async () => {
  const f = await fixture({ httpStatus: 429 }), result = await f.identification.run(f.staff, f.cardId);
  assert.equal(result.state, 'UNKNOWN'); assert.equal(f.calls.http.length, 3);
  const response = f.artifactsOf('IDENTIFICATION_RESPONSE').find(value => value.stage === 'MODEL');
  assert.equal(response.status, 429); assert.deepEqual(response.usage, { input_tokens: 120, output_tokens: 80 });
  assert.ok([...f.db.events.values()].some(value => value.stage === 'MODEL' && value.event === 'FAILURE'));
  assert.equal((await f.restart().run(f.staff, f.cardId)).state, 'UNKNOWN');
  assert.equal(f.calls.http.length, 3); assert.equal(f.db.details.size, 0);
});

test('core model timeout while request-artifact save is pending fences late MODEL dispatch and replay', async t => {
  const f = await fixture({ pauseRequestArtifact: true });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const running = f.identification.run(f.staff, f.cardId);
    await f.requestArtifactEntered.promise;
    assert.equal(f.calls.http.length, 2, 'only the settled OCR pair was dispatched');
    assert.equal(f.artifactsOf('IDENTIFICATION_REQUEST').filter(value => value.stage === 'MODEL').length, 1);
    assert.equal([...f.db.events.values()].some(value => value.stage === 'MODEL'), false);

    // Exercise the actual core's unchanged 25-second model deadline. The
    // adapter receives no timeout option, injected engine or cancellation hook.
    t.mock.timers.tick(25001);
    const result = await running;
    assert.equal(result.state, 'UNKNOWN'); assert.equal(f.currentRow().state, 'UNKNOWN');
    assert.equal(f.currentRow().result, null); assert.equal(f.db.details.size, 0);

    f.requestArtifactRelease.resolve(); await f.requestArtifactFinished.promise; await nextTurn();
    assert.equal(f.calls.http.length, 2, 'late artifact acknowledgement must never send the model request');
    assert.equal([...f.db.events.values()].some(value => value.stage === 'MODEL'), false,
      'late artifact acknowledgement must not reserve a MODEL dispatch');
    assert.equal(f.artifactsOf('IDENTIFICATION_RESULT').length, 0); assert.equal(f.db.details.size, 0);
    assert.equal((await f.restart().run(f.staff, f.cardId)).state, 'UNKNOWN');
    assert.equal(f.calls.http.length, 2); assert.equal(f.db.attempts.size, 1);
  } finally {
    f.requestArtifactRelease.resolve(); t.mock.timers.reset();
  }
});

test('core timeout after MODEL dispatch retains its late raw response receipt without adoption or paid retry', async t => {
  const f = await fixture({ pauseModel: true });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const running = f.identification.run(f.staff, f.cardId);
    await f.modelEntered.promise;
    assert.equal(f.calls.http.length, 3);
    const row = f.currentRow(), dispatch = f.db.events.get(`${row.id}:MODEL:DISPATCH`);
    assert.ok(dispatch); assert.equal(f.db.events.has(`${row.id}:MODEL:RESPONSE`), false);

    t.mock.timers.tick(25001);
    const result = await running;
    assert.equal(result.state, 'UNKNOWN'); assert.equal(f.currentRow().state, 'UNKNOWN');
    assert.equal(f.currentRow().result, null);
    assert.equal(f.calls.http.find(call => call.url.hostname === 'api.openai.com').init.signal.aborted, true);

    // This provider fixture deliberately ignores abort, modelling a response
    // already on the wire. Its bytes and liability must still be accounted for.
    f.modelRelease.resolve(); await f.modelReceiptSaved.promise; await nextTurn();
    const receipt = f.db.events.get(`${row.id}:MODEL:RESPONSE`);
    assert.equal(receipt.request_hash, dispatch.request_hash);
    const { ref } = JSON.parse(receipt.evidence);
    const response = await f.artifacts.read(ref, { cardId: f.cardId, kind: 'IDENTIFICATION_RESPONSE', sourceHash: f.sourceHash });
    const expected = raw(modelReply(f.proposed));
    assert.equal(response.engineVersion, V2); assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(response.base64, 'base64'), expected); assert.equal(response.sha256, digest(expected));
    assert.deepEqual(response.usage, { input_tokens: 120, output_tokens: 80 });
    assert.equal(f.currentRow().state, 'UNKNOWN'); assert.equal(f.currentRow().result, null);
    assert.equal(f.artifactsOf('IDENTIFICATION_RESULT').length, 0); assert.equal(f.db.details.size, 0);
    const replay = await f.restart().run(f.staff, f.cardId);
    assert.equal(replay.state, 'UNKNOWN'); assert.equal(replay.attemptId, row.id);
    assert.equal(f.calls.http.length, 3); assert.equal(f.db.attempts.size, 1);
    assert.equal(f.calls.receipts.filter(value => value.stage === 'MODEL' && value.event === 'RESPONSE').length, 1);
  } finally {
    f.modelRelease.resolve(); t.mock.timers.reset();
  }
});

test('HTTP effects preserve historical V1 body, V2 fields transport, response limit and caller cancellation', async () => {
  const seen = [];
  const effects = identificationEffects({ googleKey: GOOGLE_KEY, openaiKey: OPENAI_KEY, async fetchImpl(url, init) {
    seen.push({ url: new URL(url), init }); return new Response('{}', { status: 403 });
  } });
  const body = { requests: [{ image: { content: 'synthetic-base64' } }] }, signal = new AbortController().signal;
  for (const context of [{ signal }, { signal, engineVersion: V1 }]) {
    const reply = await effects.ocr(body, context); assert.equal(reply.status, 403); assert.equal(reply.bytes.toString(), '{}');
  }
  await effects.ocr({ body, responseFields: MASK }, { signal, engineVersion: V2 });
  for (const call of seen) {
    assert.equal(call.init.body, JSON.stringify(body)); assert.equal(call.init.signal, signal);
    assert.equal(call.init.redirect, 'error'); assert.equal(call.init.headers['X-Goog-Api-Key'], GOOGLE_KEY);
  }
  assert.equal(seen[0].url.search, ''); assert.equal(seen[1].url.search, ''); assert.equal(seen[2].url.searchParams.get('fields'), MASK);
  const oversized = identificationEffects({ googleKey: GOOGLE_KEY, openaiKey: OPENAI_KEY,
    fetchImpl: async () => new Response(Buffer.alloc(262145)) });
  await assert.rejects(oversized.ocr({ body, responseFields: MASK }, { signal, engineVersion: V2 }), { code: 'IDENTIFICATION_RESPONSE_TOO_LARGE' });
  const controller = new AbortController(); controller.abort();
  const cancelled = identificationEffects({ googleKey: GOOGLE_KEY, openaiKey: OPENAI_KEY,
    async fetchImpl(_url, init) { init.signal.throwIfAborted(); assert.fail('aborted request sent'); } });
  await assert.rejects(cancelled.ocr({ body, responseFields: MASK }, { signal: controller.signal, engineVersion: V2 }), { name: 'AbortError' });
});
