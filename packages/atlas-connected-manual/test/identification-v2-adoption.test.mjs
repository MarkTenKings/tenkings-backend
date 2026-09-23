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
import { createConnectedHandler } from '../src/http.mjs';

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
  pauseRequestArtifact = false, httpStatus = 200, modelError = null, ocrText = null, pauseClaim = false } = {}) {
  const cardId = randomUUID(), staff = { id: randomUUID(), edit: true };
  const sourceHash = digest('original synthetic pair'), objects = new Map();
  const db = { attempts: new Map(), details: new Map(), actions: new Map(), events: new Map() };
  const calls = { http: [], reads: [], authorization: [], receipts: [] };
  const modelEntered = deferred(), modelRelease = deferred();
  const claimEntered = deferred(), claimRelease = deferred();
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
  let workspaceExists=false;
  const latest=source=>[...db.attempts.values()].find(row=>row.card_id===cardId && row.source_hash===source && ![...db.attempts.values()].some(child=>child.retry_of===row.id));
  const tx = {
    async $queryRawUnsafe(sql, ...args) {
      if (sql.startsWith('SELECT i.* FROM atlas_manual_connected.identification')) {
        const row=latest(args[1]);return row?[clone(row)]:[];
      }
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.identification')) {
        const row=[...db.attempts.values()].find(value=>
          sql.includes('WHERE retry_of=')?value.retry_of===args[0]:
          sql.includes('WHERE id=')?value.id===args[0] && value.card_id===args[1] && value.source_hash===args[2]:
          value.card_id===args[0] && value.retry_action_id===args[1]);
        return row?[clone(row)]:[];
      }
      if(sql.startsWith('SELECT * FROM atlas_manual_connected.effect'))return [...db.events.values()].filter(value=>value.attempt_id===args[0]).map(clone);
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.details WHERE')) {
        const row = db.details.get(args[0]); return row ? [clone(row)] : [];
      }
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.details_action')) {
        const row = db.actions.get(`${args[0]}:${args[1]}`); return row ? [clone(row)] : [];
      }
      if (sql.startsWith('SELECT id FROM atlas_manual.card')) return workspaceExists?[{id:cardId}]:[];
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
    async $executeRawUnsafe(sql, ...args) {
      if (sql.startsWith('INSERT INTO atlas_manual_connected.identification(')) {
        const [id, card_id, source_hash, actor_id, input, retry_of=null, retry_action_id=null, evidence_attempt_id=null] = args;
        if([...db.attempts.values()].some(row=>retry_of?
          row.retry_of===retry_of || row.card_id===card_id && row.retry_action_id===retry_action_id:
          row.card_id===card_id && row.source_hash===source_hash && row.retry_of===null))return 0;
        db.attempts.set(id, { id, card_id, source_hash, actor_id, input, retry_of, retry_action_id, evidence_attempt_id, state: 'RUNNING',
          result: null, error: null, created_at: new Date(), finished_at: null });
        if(retry_of && pauseClaim){claimEntered.resolve();await claimRelease.promise;}
        return 1;
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
        fullTextAnnotation: { text: ocrText ?? (category === 'Pokémon' ? 'Pokémon HP 60 025' : 'Panini 2023 Example Player') },
      }] });
      assert.equal(parsed.href, 'https://api.openai.com/v1/responses');
      modelEntered.resolve(); if (pauseModel) await modelRelease.promise;
      return Response.json(modelError?{error:modelError}:modelReply(proposed), { status: httpStatus });
    },
  });
  const details = createDetailsStore({ boundary, intakeRepository });
  const config = { boundary, intake, intakeRepository, storage, artifacts, details, effects, receiptClient };
  const identification = createIdentification(config);
  return { cardId, staff, sourceHash, originalPair, workingBytes, objects, db, calls, artifacts, details,
    identification, proposed, modelEntered, modelRelease,
    claimEntered, claimRelease,
    requestArtifactEntered, requestArtifactRelease, requestArtifactFinished, modelReceiptSaved,
    restart: () => createIdentification(config),
    currentRow: () => latest(pair.sourceHash),
    setModel(status,error=null,{pause=false}={}){httpStatus=status;modelError=error;pauseModel=pause;},
    setWorkspace(value=true){workspaceExists=value;},
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
      Object.assign(row,{retry_of:null,retry_action_id:null,evidence_attempt_id:null});
      db.attempts.set(row.id, row); return { row, input, result };
    },
  };
}

test('shutdown during identification request persistence prevents a new model dispatch and retains completed OCR evidence', async () => {
  const f = await fixture({ pauseRequestArtifact: true }), admission = new AbortController();
  const pending = f.identification.run(f.staff, f.cardId, { dispatchSignal: admission.signal });
  await f.requestArtifactEntered.promise;
  admission.abort(Object.assign(Error('BATCH_STOPPED'), { code: 'BATCH_STOPPED' }));
  f.requestArtifactRelease.resolve();
  const result = await pending;
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(f.calls.http.length, 2); assert.equal(f.calls.http.every(call => call.url.hostname === 'vision.googleapis.com'), true);
  assert.equal(f.calls.receipts.filter(value => value.event === 'RESPONSE').length, 2);
  assert.equal([...f.db.events.values()].some(value => value.stage === 'MODEL' && value.event === 'DISPATCH'), false);
  await f.identification.run(f.staff, f.cardId); assert.equal(f.calls.http.length, 2);
});

test('shutdown admission does not cancel an identification model already dispatched or discard its response', async () => {
  const f = await fixture({ pauseModel: true }), admission = new AbortController();
  const pending = f.identification.run(f.staff, f.cardId, { dispatchSignal: admission.signal });
  await f.modelEntered.promise;
  admission.abort(Object.assign(Error('BATCH_STOPPED'), { code: 'BATCH_STOPPED' }));
  const model = f.calls.http.find(call => call.url.hostname === 'api.openai.com');
  assert.equal(model.init.signal.aborted, false);
  f.modelRelease.resolve();
  assert.equal((await pending).state, 'COMPLETE');
  assert.equal(f.calls.http.length, 3);
  assert.equal(f.calls.receipts.some(value => value.stage === 'MODEL' && value.event === 'RESPONSE'), true);
});

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
  const staleRow = [...f.db.attempts.values()].find(row=>row.source_hash===f.sourceHash);
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

test('concurrent V2 starts and in-flight replay share one claimed attempt without duplicate provider work', { timeout: 10000 }, async () => {
  const f = await fixture({ pauseModel: true });
  const first = f.identification.run(f.staff, f.cardId), second = f.restart().run(f.staff, f.cardId);
  await f.modelEntered.promise;
  // Keep the winning model request paused until the other start reaches its
  // claim/read. Otherwise a slower photo conversion may legitimately observe
  // COMPLETE after release without dispatching another provider request.
  const inFlight = await Promise.race([first, second]);
  assert.equal(inFlight.state, 'RUNNING');
  const replay = await f.restart().run(f.staff, f.cardId); assert.equal(replay.state, 'RUNNING');
  assert.equal(inFlight.attemptId, replay.attemptId);
  f.modelRelease.resolve(); const results = await Promise.all([first, second]);
  assert.equal(results.filter(value => value.state === 'COMPLETE').length, 1);
  assert.ok(results.every(value => value.attemptId === replay.attemptId));
  const completedReplay = await f.restart().run(f.staff, f.cardId);
  assert.equal(completedReplay.state, 'COMPLETE');
  assert.equal(completedReplay.attemptId, replay.attemptId);
  assert.deepEqual(completedReplay.result, results.find(value => value.state === 'COMPLETE').result);
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

const exhausted = { type:'insufficient_quota',code:'credit_balance_exhausted',param:null,message:'Synthetic API balance exhausted.' };
const retryInput = f => ({actionId:randomUUID(),expectedAttemptId:f.currentRow().id,sourceHash:f.sourceHash});
async function waitModelCalls(f,count){
  for(let i=0;i<1000 && f.calls.http.length<count;i++)await nextTurn();
  assert.equal(f.calls.http.length,count);
}

test('verified API credit rejection exposes a manual retry that reuses the exact saved pair/OCR/model request', async()=>{
  const f=await fixture({httpStatus:429,modelError:exhausted}), failed=await f.identification.run(f.staff,f.cardId);
  assert.deepEqual(failed.rejection,{code:'API_CREDIT_BALANCE_EXHAUSTED',canRetry:true});
  const old=clone(f.currentRow()), events=clone([...f.db.events.values()]), command=retryInput(f);
  for(let i=0;i<2;i++)await f.restart().run(f.staff,f.cardId);
  assert.equal(f.calls.http.length,3);
  f.setModel(200);
  const recovered=await f.restart().retry(f.staff,f.cardId,command);
  assert.equal(recovered.state,'COMPLETE');assert.notEqual(recovered.attemptId,old.id);
  assert.deepEqual(f.db.attempts.get(old.id),old);
  assert.deepEqual([...f.db.events.values()].filter(e=>e.attempt_id===old.id),events);
  const current=f.currentRow();assert.equal(current.retry_of,old.id);assert.equal(current.evidence_attempt_id,old.id);
  assert.equal(current.retry_action_id,command.actionId);assert.equal(current.input,old.input);
  assert.equal(f.calls.http.length,4);assert.equal(f.calls.reads.length,2);
  assert.equal(f.calls.http[3].init.body,f.calls.http[2].init.body);
  assert.equal([...f.db.events.values()].filter(e=>e.attempt_id===current.id && e.stage.startsWith('OCR')).length,0);
  assert.equal((await f.restart().status(f.staff,f.cardId)).attemptId,current.id);
  assert.equal((await f.restart().run(f.staff,f.cardId)).attemptId,current.id);
  assert.equal((await f.restart().retry(f.staff,f.cardId,command)).attemptId,current.id);
  assert.equal(f.calls.http.length,4);
  await assert.rejects(f.identification.retry(f.staff,f.cardId,{...command,expectedAttemptId:current.id}),{code:'IDENTIFICATION_RETRY_ACTION_CONFLICT'});
});

test('repeated explicit quota retries form one immutable chain using the original evidence, including Pokémon crop bytes', async()=>{
  const f=await fixture({category:'Pokémon',httpStatus:429,modelError:exhausted});await f.identification.run(f.staff,f.cardId);
  const root=clone(f.currentRow()), first=retryInput(f);
  const again=await f.identification.retry(f.staff,f.cardId,first);
  assert.equal(again.state,'UNKNOWN');assert.equal(again.rejection.canRetry,true);
  const second=retryInput(f);f.setModel(200);
  const complete=await f.identification.retry(f.staff,f.cardId,second);
  assert.equal(complete.state,'COMPLETE');assert.equal(f.db.attempts.size,3);
  assert.equal(f.currentRow().retry_of,again.attemptId);assert.equal(f.currentRow().evidence_attempt_id,root.id);
  assert.deepEqual(f.db.attempts.get(root.id),root);assert.equal(f.calls.http.length,5);
  assert.equal(f.calls.http[2].init.body,f.calls.http[3].init.body);assert.equal(f.calls.http[3].init.body,f.calls.http[4].init.body);
  assert.equal((await f.identification.retry(f.staff,f.cardId,first)).attemptId,again.attemptId);
  assert.equal(f.calls.http.length,5);
});

test('concurrent same-action retries claim one child and losing replay never settles the running child', async()=>{
  const f=await fixture({httpStatus:429,modelError:exhausted});await f.identification.run(f.staff,f.cardId);
  const command=retryInput(f);f.setModel(200,null,{pause:true});
  const first=f.identification.retry(f.staff,f.cardId,command), second=f.restart().retry(f.staff,f.cardId,command);
  await waitModelCalls(f,4);const pending=await Promise.race([first,second]);
  assert.equal(pending.state,'RUNNING');assert.equal(f.currentRow().state,'RUNNING');assert.equal(f.db.attempts.size,2);
  f.modelRelease.resolve();const results=await Promise.all([first,second]);
  assert.ok(results.every(value=>value.attemptId===pending.attemptId));assert.equal(f.currentRow().state,'COMPLETE');
  assert.equal(f.calls.http.length,4);
});

test('concurrent different-action retries refuse the stale parent and retain human edits during the winning request', async()=>{
  const f=await fixture({httpStatus:429,modelError:exhausted});await f.identification.run(f.staff,f.cardId);
  const firstInput=retryInput(f),secondInput={...firstInput,actionId:randomUUID()};f.setModel(200,null,{pause:true});
  const first=f.identification.retry(f.staff,f.cardId,firstInput);await waitModelCalls(f,4);
  await assert.rejects(f.identification.retry(f.staff,f.cardId,secondInput),{code:'IDENTIFICATION_RETRY_STALE'});
  await f.save({name:'Human retained name',manufacturer:'',variant:''});f.modelRelease.resolve();
  assert.equal((await first).state,'COMPLETE');const saved=await f.details.read(f.staff,f.cardId);
  assert.equal(saved.details.fields.name,'Human retained name');assert.equal(saved.details.fields.manufacturer,'');
  assert.equal(saved.details.fields.variant,'');assert.equal(f.calls.http.length,4);
});

test('a timed-out child claim retains same-action recovery and cannot dispatch after its deadline',async t=>{
  const f=await fixture({httpStatus:429,modelError:exhausted,pauseClaim:true});await f.identification.run(f.staff,f.cardId);
  const command=retryInput(f);f.setModel(200);t.mock.timers.enable({apis:['setTimeout']});
  try{
    const pending=f.identification.retry(f.staff,f.cardId,command);await f.claimEntered.promise;
    t.mock.timers.tick(25001);
    await assert.rejects(pending,{status:503,code:'IDENTIFICATION_RETRY_CLAIM_UNCERTAIN'});
    f.claimRelease.resolve();await nextTurn();
    const replay=await f.identification.retry(f.staff,f.cardId,command);
    assert.equal(replay.state,'RUNNING');assert.equal(replay.attemptId,f.currentRow().id);
    assert.equal(f.db.attempts.size,2);assert.equal(f.calls.http.length,3);
    assert.equal([...f.db.events.values()].filter(event=>event.attempt_id===replay.attemptId).length,0);
  }finally{f.claimRelease.resolve();t.mock.timers.reset();}
});

test('only the exact retained credit-balance rejection enables a successor', async t=>{
  for(const [name,status,error] of [
    ['rate limit',429,{...exhausted,type:'rate_limit_error',code:'rate_limit_exceeded'}],
    ['other quota code',429,{...exhausted,code:'insufficient_quota'}],
    ['wrong type',429,{...exhausted,type:'invalid_request_error'}],
    ['wrong HTTP status',403,exhausted],['wrong parameter',429,{...exhausted,param:'model'}],
  ])await t.test(name,async()=>{
    const f=await fixture({httpStatus:status,modelError:error});await f.identification.run(f.staff,f.cardId);
    assert.equal((await f.identification.status(f.staff,f.cardId)).rejection.canRetry,false);
    await assert.rejects(f.identification.retry(f.staff,f.cardId,retryInput(f)),{code:'IDENTIFICATION_RETRY_NOT_ALLOWED'});
    assert.equal(f.calls.http.length,3);assert.equal(f.db.attempts.size,1);
  });
});

test('missing responses, mismatched receipts, failed OCR, and corrupted retained bytes never enable retries', async t=>{
  for(const mutation of ['missing-model-response','mismatched-model-hash','missing-ocr-response','corrupt-artifact','failed-ocr'])await t.test(mutation,async()=>{
    const f=await fixture({httpStatus:429,modelError:exhausted});await f.identification.run(f.staff,f.cardId);const row=f.currentRow();
    if(mutation==='missing-model-response')f.db.events.delete(`${row.id}:MODEL:RESPONSE`);
    else if(mutation==='mismatched-model-hash')f.db.events.get(`${row.id}:MODEL:RESPONSE`).request_hash=digest('different request');
    else if(mutation==='missing-ocr-response')f.db.events.delete(`${row.id}:OCR_FRONT:RESPONSE`);
    else if(mutation==='corrupt-artifact'){
      const event=f.db.events.get(`${row.id}:MODEL:RESPONSE`),ref=JSON.parse(event.evidence).ref;
      f.objects.get(ref.key).bytes=Buffer.from('corrupted retained artifact');
    }else{
      const event=f.db.events.get(`${row.id}:OCR_FRONT:RESPONSE`),old=JSON.parse(event.evidence).ref;
      const reply=JSON.parse(f.objects.get(old.key).bytes);reply.status=403;
      const ref=await f.artifacts.write(reply,{cardId:f.cardId,kind:'IDENTIFICATION_RESPONSE',sourceHash:f.sourceHash});event.evidence=canonical({ref});
    }
    assert.notEqual((await f.identification.status(f.staff,f.cardId)).rejection?.canRetry,true);
    await assert.rejects(f.identification.retry(f.staff,f.cardId,retryInput(f)),{code:'IDENTIFICATION_RETRY_NOT_ALLOWED'});
    assert.equal(f.calls.http.length,3);assert.equal(f.db.attempts.size,1);
  });
});

test('reconstructed request mismatch is refused before successor claim or provider dispatch',async()=>{
  const f=await fixture({httpStatus:429,modelError:exhausted});await f.identification.run(f.staff,f.cardId);const row=f.currentRow();
  const dispatch=f.db.events.get(`${row.id}:MODEL:DISPATCH`),reply=f.db.events.get(`${row.id}:MODEL:RESPONSE`);
  const ref=JSON.parse(dispatch.evidence).ref,stored=JSON.parse(f.objects.get(ref.key).bytes),request=JSON.parse(stored.requestJson);
  request.instructions+=' Synthetic unsupported historical instruction.';stored.requestJson=JSON.stringify(request);stored.requestHash=digest(stored.requestJson);
  const replacement=await f.artifacts.write(stored,{cardId:f.cardId,kind:'IDENTIFICATION_REQUEST',sourceHash:f.sourceHash});
  dispatch.evidence=canonical({ref:replacement});dispatch.request_hash=stored.requestHash;reply.request_hash=stored.requestHash;
  const before=clone(row);await assert.rejects(f.identification.retry(f.staff,f.cardId,retryInput(f)),{code:'IDENTIFICATION_RETRY_NOT_ALLOWED'});
  assert.deepEqual(f.currentRow(),before);assert.equal(f.db.attempts.size,1);assert.equal(f.calls.http.length,3);
});

test('a changed OCR request cannot be hidden by the shared engines empty-text fallback',async()=>{
  const f=await fixture({httpStatus:429,modelError:exhausted,ocrText:''});await f.identification.run(f.staff,f.cardId);const row=f.currentRow();
  const dispatch=f.db.events.get(`${row.id}:OCR_FRONT:DISPATCH`),reply=f.db.events.get(`${row.id}:OCR_FRONT:RESPONSE`);
  const ref=JSON.parse(dispatch.evidence).ref,stored=JSON.parse(f.objects.get(ref.key).bytes),request=JSON.parse(stored.requestJson);
  request.body.requests[0].features[0].type='TEXT_DETECTION';stored.requestJson=JSON.stringify(request);stored.requestHash=digest(stored.requestJson);
  const replacement=await f.artifacts.write(stored,{cardId:f.cardId,kind:'IDENTIFICATION_REQUEST',sourceHash:f.sourceHash});
  dispatch.evidence=canonical({ref:replacement});dispatch.request_hash=stored.requestHash;reply.request_hash=stored.requestHash;
  await assert.rejects(f.identification.retry(f.staff,f.cardId,retryInput(f)),{code:'IDENTIFICATION_RETRY_NOT_ALLOWED'});
  assert.equal(f.db.attempts.size,1);assert.equal(f.calls.http.length,3);
});

test('changed photos and initialized workspaces fence new retry work; late initialization fences adoption',async()=>{
  const f=await fixture({httpStatus:429,modelError:exhausted});await f.identification.run(f.staff,f.cardId);const command=retryInput(f);
  f.setWorkspace();assert.equal((await f.identification.status(f.staff,f.cardId)).rejection.canRetry,false);
  await assert.rejects(f.identification.retry(f.staff,f.cardId,command),{code:'IDENTIFICATION_RETRY_NOT_ALLOWED'});
  f.setWorkspace(false);f.setModel(200,null,{pause:true});const retry=f.identification.retry(f.staff,f.cardId,command);
  await waitModelCalls(f,4);f.setWorkspace();f.modelRelease.resolve();assert.equal((await retry).state,'STALE');
  assert.equal(f.db.details.size,0);f.retake();
  await assert.rejects(f.identification.retry(f.staff,f.cardId,command),{code:'INTAKE_PAIR_STALE'});
  assert.equal(f.calls.http.length,4);
});

test('existing identify endpoint dispatches only a closed explicit retry body after ordinary auth and CSRF',async()=>{
  const f=await fixture({httpStatus:429,modelError:exhausted}),origin='https://manual.fixture.invalid',calls=[];
  const handler=createConnectedHandler({origin,assertRequest(){},boundary:{async authenticate(cookie,csrf){
    requireThat(cookie==='ordinary-session' && csrf==='ordinary-csrf',403,'CSRF_REQUIRED');return f.staff;
  }},connected:{intake:{},workflow:{service:{}},identification:{
    async run(...args){calls.push(['run',args]);return {state:'UNKNOWN'};},
    async retry(...args){calls.push(['retry',args]);return {state:'RUNNING'};},
  }}});
  const body={actionId:randomUUID(),expectedAttemptId:randomUUID(),sourceHash:f.sourceHash};
  async function request(value,csrf='ordinary-csrf'){
    const res={setHeader(){},status(value){this.code=value;return this;},json(value){this.body=value;}};
    await handler({url:`/api/staff/manual-connected/cards/${f.cardId}/identify`,method:'POST',body:value,
      headers:{origin,cookie:'ordinary-session','content-type':'application/json','x-atlas-csrf':csrf}},res);return res;
  }
  assert.equal((await request({})).code,200);assert.equal((await request(body)).code,200);
  assert.deepEqual(calls.map(value=>value[0]),['run','retry']);assert.deepEqual(calls[1][1][2],body);
  assert.equal((await request({...body,retry:true})).code,400);assert.equal((await request(body,'bad')).code,403);
  assert.equal(calls.length,2);
});
