import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createManualWorkflow } from '../src/workflow.mjs';
import { canonical, digest, inputCommand, requireThat, stateDocument } from '../../atlas-manual-service/src/contract.mjs';
import { createGeometryWorkspace, applyGeometryEdit, geometryBase, preparationBase, replaceGeometryImage } from '../../atlas-manual-workspace/src/geometry-actions.mjs';
import { adoptGeometryPreparation, adoptPhysicalGeometryProposal } from '../../atlas-manual-workspace/src/preparation-result.mjs';

const sides = ['FRONT', 'BACK'], clone = value => structuredClone(value), hash = value => value.repeat(64);
const quad = [{ x: .125, y: .1 }, { x: .875, y: .1 }, { x: .875, y: .9 }, { x: .125, y: .9 }];
const printed = [{ x: .04, y: .03 }, { x: .96, y: .03 }, { x: .96, y: .97 }, { x: .04, y: .97 }];
const edit = (state, side, kind) => ({ side, kind, base: geometryBase(state, side, kind), quad: kind === 'PHYSICAL' ? quad : printed, actor: 'HUMAN', proposal: null });
const commandEdit = (state, side, kind) => { const { actor, proposal, ...input } = edit(state, side, kind); return input; };
function prepareFrame(state, side) {
  const sx = 1269 / 1200, sy = 1777 / 1920;
  return adoptGeometryPreparation(state, { id: `${side}:synthetic-preparation`, side,
    base: preparationBase(state, side), settingsRevision: state.sides[side].settingsRevision,
    matColor: 'BLACK', cornerShape: 'ROUNDED_3_18_MM', proposal: { outcome: 'ACCEPTED', proposal: printed },
    frame: { id: `${side}:prepared`, version: state.sides[side].preparationRevision + 1,
      rectified: { sha256: hash(side === 'FRONT' ? 'c' : 'd'), width: 1270, height: 1778 },
      inspection: { sha256: hash(side === 'FRONT' ? 'e' : 'f'), width: 1350, height: 1858, cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } },
      sourceToRectified: [sx, 0, -200 * sx, 0, sy, -240 * sy, 0, 0, 1] } }).state;
}
async function fixture({ previousBackWork = false } = {}) {
  const cardId = randomUUID(), staff = {}, objects = new Map(), commands = new Map(); let card;
  const f = { prepares: 0, detections: 0, commits: 0, beforePrepare: null, failPrepare: false, loseNextReply: false, currentSource: hash('1') };
  const artifacts = {
    async write(value) { const ref = { id: digest(canonical(value)) }; objects.set(ref.id, clone(value)); return ref; },
    async read(ref) { return clone(objects.get(ref.id)); },
  };
  const repository = {
    async provision(_staff, input) { const saved = stateDocument(input.draft); card = { cardId, revision: 1, contentHash: saved.hash, draft: saved.draft }; return clone(card); },
    async load() { return { card: clone(card), principal: { id: 'synthetic-reviewer' } }; },
    async findAction(_staff, _cardId, command) { const old = commands.get(command.actionId); if (!old) return null;
      requireThat(old.requestHash === inputCommand(command).requestHash, 409, 'MANUAL_ACTION_ID_CONFLICT'); return clone(old.result); },
    async commit(_staff, input) {
      requireThat(input.input.expectedRevision === card.revision && input.baseHash === card.contentHash, 409, 'MANUAL_DRAFT_STALE');
      requireThat(input.draft.source.sourceHash === f.currentSource, 409, 'MANUAL_PHOTOS_CHANGED');
      const saved = stateDocument(input.draft); card = { ...card, revision: card.revision + 1, contentHash: saved.hash, draft: saved.draft };
      const result = { card: clone(card) }; commands.set(input.input.actionId, { requestHash: inputCommand(input.input).requestHash, result }); f.commits++;
      if (f.loseNextReply) { f.loseNextReply = false; throw Object.assign(new Error('Synthetic connection lost after commit'), { code: 'CONNECTION_LOST' }); }
      return result;
    },
  };
  const workflow = createManualWorkflow({ repository, artifacts, prepare: async ({ geometry, side, source }) => {
    f.prepares++; if (f.beforePrepare) await f.beforePrepare();
    if (!geometry.sides[side].physical) {
      f.detections++;
      geometry = adoptPhysicalGeometryProposal(geometry, { id: 'synthetic-checked-proposal', side,
        base: geometryBase(geometry, side, 'PHYSICAL'), proposal: { outcome: 'ACCEPTED', proposal: quad } }).state;
    }
    if (f.failPrepare) throw Object.assign(new Error('Synthetic preparation failure after proposal'), { name: 'PreparationError' });
    return { geometry: prepareFrame(geometry, side), source: { ...source, prepared: { ...source.prepared, [side]: { ref: { id: 'new-back-images' }, sourceHash: hash('3') } } } };
  } });
  let geometry = createGeometryWorkspace({ cardId, profile: 'POKEMON', sides: Object.fromEntries(sides.map(side => [side, {
    image: { version: side === 'BACK' ? 2 : 1, originalSha256: hash('a'), frameId: `${side}:decoded`, frameSha256: hash('b'),
      width: 1600, height: 2400, coordinateSpace: 'ORIENTED_DECODED' }, cornerShape: 'ROUNDED_3_18_MM', matColor: 'BLACK' }])) });
  geometry = applyGeometryEdit(geometry, edit(geometry, 'FRONT', 'PHYSICAL')).state;
  geometry = prepareFrame(geometry, 'FRONT');
  geometry = applyGeometryEdit(geometry, edit(geometry, 'FRONT', 'PRINTED')).state;
  if (previousBackWork) {
    geometry = applyGeometryEdit(geometry, edit(geometry, 'BACK', 'PHYSICAL')).state;
    geometry = replaceGeometryImage(geometry, { side: 'BACK', base: geometryBase(geometry, 'BACK', 'IMAGE'), image: { ...geometry.sides.BACK.image, version: 3 } }).state;
  }
  await workflow.provision(staff, { geometry, identity: { cardName: 'Synthetic Pokémon', year: '2026', productSet: 'Recovery fixture', layoutType: 'POKEMON' },
    source: { sourceHash: f.currentSource, uploads: { FRONT: 'retained-front', BACK: 'retained-back-v2' },
      prepared: { FRONT: { ref: { id: 'retained-front-images' }, sourceHash: hash('2') }, BACK: null } } });
  return Object.assign(f, { card: () => clone(card), state: () => workflow.hydrate(card),
    command: () => ({ actionId: randomUUID(), expectedRevision: card.revision, action: { type: 'PREPARE_SIDE', side: 'BACK' } }),
    execute: command => workflow.service.execute(staff, cardId, command) });
}

test('one existing PREPARE_SIDE recovers untouched Back and exact replay preserves human Front and retained uploads', async () => {
  const f = await fixture(), before = f.card(), state = await f.state(), command = f.command();
  const saved = await f.execute(command), after = await f.state();
  assert.equal(f.commits, 1); assert.equal(f.detections, 1); assert.equal(saved.card.revision, before.revision + 1);
  assert.deepEqual(after.geometry.sides.FRONT, state.geometry.sides.FRONT);
  assert.deepEqual(saved.card.draft.source.prepared.FRONT, before.draft.source.prepared.FRONT);
  assert.deepEqual(saved.card.draft.source.uploads, before.draft.source.uploads);
  assert.equal(after.geometry.sides.BACK.physical.actor, 'ENGINE'); assert(after.geometry.sides.BACK.prepared); assert(after.geometry.sides.BACK.printed);
  assert.equal(after.geometry.sides.BACK.confirmation, null); assert(after.defects); assert.equal(after.defects.confirmation, null);
  assert.deepEqual(await f.execute(command), saved); assert.equal(f.prepares, 1); assert.equal(f.commits, 1);
});

test('failed preparation after detection leaves both saved sides and the action receipt unchanged', async () => {
  const f = await fixture(), before = f.card(), command = f.command(); f.failPrepare = true;
  await assert.rejects(f.execute(command), { code: 'MANUAL_PREPARATION_FAILED' });
  assert.deepEqual(f.card(), before); assert.equal(f.commits, 0);
  f.failPrepare = false; await f.execute(command); assert.equal(f.commits, 1);
});

test('a lost reply after committed recovery returns the durable action receipt without preparing again', async () => {
  const f = await fixture(), command = f.command(); f.loseNextReply = true;
  await assert.rejects(f.execute(command), { code: 'CONNECTION_LOST' });
  const committed = f.card(); assert.equal(f.commits, 1); assert.equal(f.detections, 1);
  assert.deepEqual((await f.execute(command)).card, committed);
  assert.equal(f.prepares, 1); assert.equal(f.commits, 1);
});

test('a missing outline with previous human-side history is refused before preparation', async () => {
  const f = await fixture({ previousBackWork: true }), before = f.card();
  assert.equal((await f.state()).geometry.sides.BACK.physical, null);
  await assert.rejects(f.execute(f.command()), { code: 'MANUAL_GEOMETRY_RECOVERY_UNAVAILABLE' });
  assert.equal(f.prepares, 0); assert.equal(f.commits, 0); assert.deepEqual(f.card(), before);
});

test('a human physical outline is prepared as saved without invoking automatic detection', async () => {
  const f = await fixture(), before = await f.state();
  await f.execute({ ...f.command(), action: { type: 'GEOMETRY_EDIT', edit: commandEdit(before.geometry, 'BACK', 'PHYSICAL') } });
  const human = (await f.state()).geometry.sides.BACK.physical;
  await f.execute(f.command()); assert.equal(f.detections, 0);
  assert.deepEqual((await f.state()).geometry.sides.BACK.physical, human);
});

test('a concurrent human Front edit rejects the whole Back candidate and preserves the newer Front work', async () => {
  const f = await fixture();
  f.beforePrepare = async () => {
    const state = await f.state();
    await f.execute({ ...f.command(), action: { type: 'GEOMETRY_EDIT', edit: { ...commandEdit(state.geometry, 'FRONT', 'PRINTED'),
      quad: [{ x: .05, y: .04 }, { x: .95, y: .04 }, { x: .95, y: .96 }, { x: .05, y: .96 }] } } });
  };
  await assert.rejects(f.execute(f.command()), { code: 'MANUAL_DRAFT_STALE' });
  const state = await f.state(); assert.equal(state.geometry.sides.BACK.physical, null);
  assert.equal(state.geometry.sides.FRONT.printed.quad[0].x, .05); assert.equal(f.commits, 1);
});

test('a replaced photo source during recovery rejects the candidate without altering saved work', async () => {
  const f = await fixture(), before = f.card(); f.beforePrepare = async () => { f.currentSource = hash('9'); };
  await assert.rejects(f.execute(f.command()), { code: 'MANUAL_PHOTOS_CHANGED' });
  assert.deepEqual(f.card(), before); assert.equal(f.commits, 0);
});
