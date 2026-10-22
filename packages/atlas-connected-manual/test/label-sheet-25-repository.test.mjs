import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { LABEL_25_PROFILE_DEFINITIONS, LABEL_JIG_25 } from '@atlas/finishing/label-sheet-25';
import { LABEL_JIG_V1 } from '@atlas/finishing/label-sheet-geometry';
import { createLabelRepository } from '../src/label-sheet-repository.mjs';

const profileFor = page => LABEL_25_PROFILE_DEFINITIONS.find(value => value.page === page && value.side === 'FRONT' && value.mode === 'original');
const legacyProfile = 'atlas-v4-sheet-800ppi-diagnostic-v2';
const clone = value => structuredClone(value);

// Exercise real repository decisions with a bounded transaction store. No
// database, raster work, artwork mutation, or print side effect is involved.
function fixture(slots = Array.from({ length: 50 }, (_, index) => index + 1)) {
  const principal = { id: randomUUID(), role: 'REVIEWER', accessVersion: 1 };
  const sheet = { id: randomUUID(), actor_id: principal.id, state: 'OPEN', revision: 50,
    jig_hash: LABEL_JIG_V1.jigHash, material_profile_id: 'atlas-v4-gold-v1' };
  const items = slots.map(slot => ({ id: randomUUID(), actor_id: principal.id, card_id: randomUUID(), action_id: randomUUID(),
    approval_version: 1, source_revision: 1, source_hash: digest(`source-${slot}`), report_hash: digest(`report-${slot}`),
    public_hash: digest(`public-${slot}`), artwork_hash: digest(`artwork-${slot}`), renderer_profile_hash: digest('renderer'),
    material_profile_id: sheet.material_profile_id, jig_hash: sheet.jig_hash, state: 'READY', sheet_id: sheet.id, slot,
    print_svg: `immutable-artwork-${slot}`, snapshot: null }));
  const exports = new Map(), events = [], writes = [], denied = new Set(), superseded = new Set();
  const tx = {
    async $executeRawUnsafe(sql) { assert.match(sql, /SELECT pg_advisory_xact_lock/); return 1; },
    async $queryRawUnsafe(sql, ...args) {
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.label_export')) {
        const rows = [...exports.values()];
        if (sql.includes('retry_requests @>')) return clone(rows.filter(row => row.actor_id === args[0]
          && (row.request_id === args[1] || row.retry_requests.some(retry => retry.requestId === args[1]))));
        if (sql.includes('sheet_id=$1')) return clone(rows.filter(row => row.sheet_id === args[0] && row.profile_id === args[1]));
        return clone(rows.filter(row => row.id === args[0] && row.actor_id === args[1]));
      }
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.label_sheet')) return clone([sheet]);
      if (sql.includes('FROM atlas_manual_connected.label_item i WHERE sheet_id=')) return clone(items);
      if (sql.startsWith('SELECT id,owner_id,approvers')) return items.filter(item => !denied.has(item.slot))
        .map(item => ({ id: item.card_id, owner_id: principal.id, approvers: [] }));
      if (sql.startsWith('SELECT card_id FROM atlas_manual_intake.discarded_card')) return [];
      if (sql.startsWith('SELECT p.*,a.source_revision')) return items.map(item => ({ card_id: item.card_id, action_id: item.action_id,
        latest_action_id: superseded.has(item.slot) ? randomUUID() : item.action_id, version: item.approval_version,
        source_revision: item.source_revision, source_hash: item.source_hash, report_hash: item.report_hash, public_hash: item.public_hash,
        state: 'PUBLISHED', mode: 'PRODUCTION' }));
      if (sql.startsWith('SELECT * FROM atlas_manual_connected.label_print_event'))
        return clone(events.filter(event => event.actor_id === args[0] && event.request_id === args[1]));
      writes.push({ sql, args: clone(args) });
      if (sql.startsWith('UPDATE atlas_manual_connected.label_sheet')) {
        Object.assign(sheet, { state: 'SEALED', revision: sheet.revision + 1, manifest: args[1], manifest_hash: args[2] });
        return clone([sheet]);
      }
      if (sql.startsWith('INSERT INTO atlas_manual_connected.label_export')) {
        const keys = ['id','actor_id','access_version','kind','sheet_id','item_id','sheet_revision','profile_id',
          'request_id','request_hash','manifest','manifest_hash'];
        const row = { ...Object.fromEntries(keys.map((key, index) => [key, args[index]])), state: 'PREPARING', retry_requests: [], attempts: 0, attempt_base: 0 };
        exports.set(row.id, row); return clone([row]);
      }
      if (sql.startsWith('UPDATE atlas_manual_connected.label_export SET state=\'PREPARING\'')) {
        const row = exports.get(args[0]); row.retry_requests.push(...JSON.parse(args[1]));
        Object.assign(row, { state: 'PREPARING', attempt_base: row.attempts, code: null, claim_id: null, lease_until: null });
        return clone([row]);
      }
      if (sql.startsWith('UPDATE atlas_manual_connected.label_export SET claim_id=')) {
        const row = exports.get(args[0]); Object.assign(row, { claim_id: args[1], attempts: row.attempts + 1 }); return clone([row]);
      }
      if (sql.startsWith('INSERT INTO atlas_manual_connected.label_print_event')) {
        const keys = ['id','actor_id','request_id','request_hash','export_id','export_sha256','manifest_hash','successful_slots','failed_slots'];
        const event = { ...Object.fromEntries(keys.map((key, index) => [key, args[index]])), created_at: '2026-10-22T12:00:00Z' };
        events.push(event); return clone([event]);
      }
      assert.fail(`Unexpected repository query: ${sql}`);
    },
  };
  const repository = createLabelRepository({ boundary: { transaction: async (_staff, work) => work({ tx, principal }) } });
  const prepare = (profileId, overrides = {}) => repository.prepareExport({}, { kind: 'SHEET', id: sheet.id,
    input: { requestId: randomUUID(), expectedSheetRevision: sheet.revision, exportProfileId: profileId, ...overrides } });
  const alterManifest = (row, alter) => { const manifest = JSON.parse(row.manifest); alter(manifest);
    row.manifest = canonical(manifest); row.manifest_hash = digest(row.manifest); };
  return { repository, sheet, items, exports, events, writes, denied, superseded, prepare, alterManifest };
}

test('all 25-position profiles freeze the whole source sheet and bind only their exact original slots', async () => {
  const f = fixture(), beforeItems = clone(f.items);
  for (const profile of LABEL_25_PROFILE_DEFINITIONS) {
    const prepared = await f.prepare(profile.id), row = f.exports.get(prepared.exportId), manifest = JSON.parse(row.manifest);
    const expectedSlots = Array.from({ length: 25 }, (_, index) => profile.firstSourceSlot + index);
    assert.deepEqual(manifest.items.map(item => item.slot), expectedSlots);
    assert.deepEqual(manifest.printTemplate, { templateId: LABEL_JIG_25.version, jigHash: LABEL_JIG_25.jigHash,
      page: profile.page, firstSourceSlot: profile.firstSourceSlot, lastSourceSlot: profile.lastSourceSlot });
    assert.equal(manifest.jigHash, LABEL_JIG_V1.jigHash);
    assert.notEqual(manifest.jigHash, manifest.printTemplate.jigHash);
    assert.equal(manifest.sheetRevision, 51);
    const exported = await f.repository.export({}, row.id), claimed = await f.repository.claimExport({}, row.id);
    assert.deepEqual(exported.items.map(item => item.slot), expectedSlots);
    assert.deepEqual(claimed.items.map(item => item.slot), expectedSlots);
    assert.equal(exported.manifest.items.length, 25);
  }
  assert.equal(f.sheet.state, 'SEALED'); assert.equal(f.sheet.revision, 51);
  assert.equal(JSON.parse(f.sheet.manifest).items.length, 50);
  assert.equal(Object.hasOwn(JSON.parse(f.sheet.manifest), 'printTemplate'), false);
  assert.equal(f.writes.filter(write => write.sql.startsWith('UPDATE atlas_manual_connected.label_sheet')).length, 1);
  assert.deepEqual(f.items, beforeItems);
});

test('an empty selected page refuses export before sealing or reserving', async () => {
  for (const [slots, page] of [[[1, 25], 2], [[26, 50], 1]]) {
    const f = fixture(slots), before = clone(f.sheet);
    await assert.rejects(f.prepare(profileFor(page).id), { code: 'LABEL_SHEET_PAGE_EMPTY' });
    assert.equal(f.exports.size, 0); assert.deepEqual(f.writes, []); assert.deepEqual(f.sheet, before);
  }
});

test('nonselected members still require full-sheet access, current approvals and READY state', async () => {
  for (const scenario of ['denied', 'superseded', 'not-ready']) {
    const f = fixture([1, 26]);
    if (scenario === 'not-ready') f.items[1].state = 'SUPERSEDED'; else f[scenario].add(26);
    await assert.rejects(f.prepare(profileFor(1).id), { code: scenario === 'denied' ? 'MANUAL_CARD_NOT_FOUND'
      : scenario === 'superseded' ? 'LABEL_SOURCE_SUPERSEDED' : 'LABEL_SHEET_NOT_READY' });
    assert.deepEqual(f.writes, []);
  }
  const f = fixture([1, 26]), prepared = await f.prepare(profileFor(1).id);
  f.denied.add(26); await assert.rejects(f.repository.export({}, prepared.exportId), { code: 'MANUAL_CARD_NOT_FOUND' });
  f.denied.clear(); f.superseded.add(26); await assert.rejects(f.repository.export({}, prepared.exportId), { code: 'LABEL_SOURCE_SUPERSEDED' });
  f.superseded.clear(); f.items[1].state = 'SUPERSEDED';
  await assert.rejects(f.repository.export({}, prepared.exportId), { code: 'LABEL_SOURCE_SUPERSEDED' });
});

test('partial pages keep holes and eligibility sees only selected artwork after full-source checks', async () => {
  const f = fixture([1, 25, 27, 50]); let checked;
  const prepared = await f.repository.prepareExport({}, { kind: 'SHEET', id: f.sheet.id,
    input: { requestId: randomUUID(), expectedSheetRevision: 50, exportProfileId: profileFor(2).id },
    validateItems(items) { checked = items.map(item => item.slot); } });
  assert.deepEqual(checked, [27, 50]);
  assert.deepEqual((await f.repository.export({}, prepared.exportId)).manifest.items.map(item => item.slot), [27, 50]);
  assert.deepEqual(JSON.parse(f.sheet.manifest).items.map(item => item.slot), [1, 25, 27, 50]);
});

test('rehashing a modified page template, source binding or selected manifest cannot authorize an export', async () => {
  const changes = [
    manifest => { delete manifest.printTemplate; },
    manifest => { manifest.printTemplate.page = 1; },
    manifest => { manifest.printTemplate.templateId = 'other-template'; },
    manifest => { manifest.printTemplate.jigHash = LABEL_JIG_V1.jigHash; },
    manifest => { manifest.printTemplate.firstSourceSlot = 1; },
    manifest => { manifest.printTemplate.lastSourceSlot = 25; },
    manifest => { manifest.printTemplate.extra = true; },
    manifest => { manifest.jigHash = LABEL_JIG_25.jigHash; },
    manifest => { manifest.sheetId = randomUUID(); },
    manifest => { manifest.sheetRevision++; },
    manifest => { manifest.materialProfileId = 'different-stock'; },
    manifest => { manifest.items.pop(); },
    manifest => { manifest.items[0].slot = 1; },
    manifest => { manifest.items[0].sourceHash = digest('changed'); },
    manifest => { manifest.items[0] = null; },
  ];
  for (const change of changes) {
    const f = fixture([1, 25, 26, 50]), prepared = await f.prepare(profileFor(2).id);
    const row = f.exports.get(prepared.exportId); f.alterManifest(row, change);
    await assert.rejects(f.repository.export({}, row.id), { code: 'LABEL_EXPORT_BINDING_INVALID' });
  }
  const f = fixture([1, 25, 26, 50]), prepared = await f.prepare(profileFor(2).id), row = f.exports.get(prepared.exportId);
  f.alterManifest(row, manifest => { manifest.items = JSON.parse(f.sheet.manifest).items; });
  await assert.rejects(f.repository.export({}, row.id), { code: 'LABEL_EXPORT_BINDING_INVALID' });
});

test('page two print confirmation records source slots 26 through 50 and rejects physical or other-page numbers', async () => {
  const f = fixture([1, 25, 26, 27, 50]), prepared = await f.prepare(profileFor(2).id), row = f.exports.get(prepared.exportId);
  Object.assign(row, { state: 'READY', sha256: digest('saved-page-two-png') });
  const input = { requestId: randomUUID(), exportId: row.id, exportSha256: row.sha256, manifestHash: row.manifest_hash,
    successfulSlots: [26, 50], failedSlots: [27] };
  const event = await f.repository.confirmPrint({}, input);
  assert.deepEqual(event.successfulSlots, [26, 50]); assert.deepEqual(event.failedSlots, [27]);
  assert.deepEqual(await f.repository.confirmPrint({}, input), event); assert.equal(f.events.length, 1);
  for (const successfulSlots of [[1], [25], [26, 1], [26, 26], [28]])
    await assert.rejects(f.repository.confirmPrint({}, { ...input, requestId: randomUUID(), successfulSlots, failedSlots: [] }), { code: 'LABEL_PRINT_SLOTS_INVALID' });
  assert.equal(f.events.length, 1);
});

test('idempotent requests and failed retries preserve exact page membership and validate the stored binding', async () => {
  const f = fixture([1, 26, 50]), input = { requestId: randomUUID(), expectedSheetRevision: 50, exportProfileId: profileFor(2).id };
  const prepare = () => f.repository.prepareExport({}, { kind: 'SHEET', id: f.sheet.id, input });
  const prepared = await prepare(), row = f.exports.get(prepared.exportId), before = row.manifest;
  assert.equal((await prepare()).exportId, row.id); assert.equal(f.exports.size, 1);
  row.state = 'FAILED'; row.attempts = 3;
  const retry = { requestId: randomUUID() }; assert.equal((await f.prepare(profileFor(2).id, retry)).exportId, row.id);
  assert.equal(row.retry_requests.length, 1); assert.equal(row.manifest, before); assert.equal(row.state, 'PREPARING');
  row.state = 'FAILED'; f.alterManifest(row, manifest => { manifest.printTemplate.page = 1; });
  const beforeWrites = f.writes.length;
  await assert.rejects(f.prepare(profileFor(2).id), { code: 'LABEL_EXPORT_BINDING_INVALID' });
  assert.equal(f.writes.length, beforeWrites);
});

test('legacy 50-position exports retain the sealed manifest bytes and all source slots', async () => {
  const f = fixture(), before = clone(f.items), prepared = await f.prepare(legacyProfile), row = f.exports.get(prepared.exportId);
  assert.equal(row.manifest, f.sheet.manifest); assert.equal(row.manifest_hash, f.sheet.manifest_hash);
  const result = await f.repository.export({}, row.id);
  assert.equal(result.items.length, 50); assert.equal(Object.hasOwn(result.manifest, 'printTemplate'), false);
  assert.deepEqual(result.items.map(item => item.slot), Array.from({ length: 50 }, (_, index) => index + 1));
  assert.deepEqual(f.items, before);
});
