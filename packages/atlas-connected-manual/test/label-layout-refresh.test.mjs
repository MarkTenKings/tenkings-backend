import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { renderApprovedBLabel, LABEL_APPROVED_B_RENDERER_PROFILE_HASH } from '@atlas/finishing/label-approved-b';
import { LABEL_JIG_V1 } from '@atlas/finishing/label-sheet-geometry';
import { createLabelService } from '../src/label-sheet-service.mjs';
import { createLabelRepository } from '../src/label-sheet-repository.mjs';
import { createManualFinishing } from '../src/finishing.mjs';
import { LABEL_REFRESH_REASON, labelRefreshRequestId, labelRefreshRequestHash, labelReplacementIntent } from '../src/label-replacement-intent.mjs';
import { publicationFixture } from './publication-fixture.mjs';

const target = cardProfile => ({ rendererProfileHash: LABEL_APPROVED_B_RENDERER_PROFILE_HASH,
  materialProfileId: cardProfile === 'POKEMON' ? 'atlas-v4-holo-v1' : 'atlas-v4-gold-v1', jigHash: LABEL_JIG_V1.jigHash });
const inputFor = (original, value = target('SPORTS')) => ({ requestId: labelRefreshRequestId(original.id, original.artwork_hash, value),
  expectedLabelHash: original.artwork_hash, expectedRendererProfileHash: value.rendererProfileHash });
function replacement(original, { refresh = true, recipe = target('SPORTS') } = {}) {
  const input = inputFor(original, recipe), reason = refresh ? LABEL_REFRESH_REASON : 'Damaged stock';
  return { ...original, id: randomUUID(), purpose: 'REPRINT', original_item_id: original.id, state: 'PENDING_RENDER',
    snapshot: null, snapshot_hash: null, print_svg: null, preview_svg: null, artwork_hash: null, sheet_id: null, slot: null,
    request_id: input.requestId, reason, request_hash: refresh ? labelRefreshRequestHash(original.id, input, recipe)
      : digest(canonical({ itemId: original.id, requestId: input.requestId, expectedLabelHash: original.artwork_hash, reason })),
    renderer_profile_hash: recipe.rendererProfileHash, material_profile_id: refresh ? recipe.materialProfileId : null,
    jig_hash: recipe.jigHash, attempts: 0, claim_id: null, lease_until: null };
}
async function fixture(cardProfile = 'SPORTS') {
  const identity = cardProfile === 'POKEMON'
    ? { cardName: 'Sylveon ex', year: '2024', manufacturer: 'The Pokémon Company International', productSet: 'Surging Sparks', cardNumber: '086/191' }
    : { playerName: 'Jaxson Dart', year: '2025', manufacturer: 'Panini', productSet: 'Prizm', cardNumber: '1' };
  const f = await publicationFixture({ cardProfile, identity }); f.row.mode = 'PRODUCTION'; await f.publication.publish({}, f.cardId, f.actionId);
  const finishing = createManualFinishing({ repository: f.repository, artifacts: f.artifacts });
  const { packet } = await finishing.loadPacket({}, f.cardId, f.actionId), recipe = target(cardProfile);
  const snapshot = canonical({ identity: packet.report.identity, grade: packet.report.finalGrade, finalGrade: packet.report.finalGrade,
    cardProfile, reportNumber: packet.reportNumber, approvalVersion: packet.approvalVersion,
    reportHref: `https://atlasgrading.com/reports/${packet.publicToken}?v=${packet.approvalVersion}`, previewMaterial: cardProfile === 'POKEMON' ? 'holo' : 'gold' });
  const original = { id: randomUUID(), actor_id: f.actorId, access_version: 1, card_id: f.cardId, action_id: f.actionId,
    approval_version: f.row.version, source_revision: f.row.source_revision, source_hash: f.row.source_hash, report_hash: f.row.report_hash,
    public_hash: f.row.public_hash, purpose: 'ORIGINAL', original_item_id: null, state: 'READY', snapshot, snapshot_hash: digest(snapshot),
    print_svg: '<svg>saved original artwork</svg>', preview_svg: '<svg>saved original preview</svg>', artwork_hash: digest('<svg>saved original artwork</svg>'),
    renderer_profile_hash: digest('previous renderer'), material_profile_id: recipe.materialProfileId, jig_hash: recipe.jigHash,
    sheet_id: randomUUID(), slot: 1, attempts: 1 };
  let pending = true, child = replacement(original, { recipe }), rendered = 0, failures = 0; const results = [], reservations = [];
  const repository = { pendingCandidates: async () => pending ? [{ id: child.id, actor_id: child.actor_id, access_version: 1, kind: 'ITEM' }] : [],
    claimItem: async () => child, item: async () => original, finishItem: async (_staff, _claim, result) => { pending = false; results.push(result); },
    failItem: async () => { failures++; pending = false; }, refreshLayout: async (...args) => { reservations.push(args); return { state: 'PENDING_RENDER' }; } };
  const service = createLabelService({ repository, finishing, boundary: { machineOwner: value => value },
    storage: { write() { assert.fail('No export storage'); }, download() { assert.fail('No download'); } },
    renderer: { label(...args) { rendered++; return renderApprovedBLabel(...args); }, sheet() { assert.fail('No sheet export'); }, individual() { assert.fail('No individual export'); } } });
  return { f, original, recipe, service, repository, reservations, results, get child() { return child; }, set child(value) { child = value; },
    get rendered() { return rendered; }, get failures() { return failures; } };
}

test('ordinary replacement copies exact saved bytes even with crash-populated profile fields', async () => {
  const f = await fixture(); f.child = replacement(f.original, { refresh: false });
  f.child.renderer_profile_hash = digest('crashed newer renderer'); f.child.material_profile_id = 'historic-attempt';
  const before = structuredClone(f.original); assert.equal(labelReplacementIntent(f.child, f.original).kind, 'COPY');
  assert.equal(await f.service.runPending(), 1); assert.equal(f.rendered, 0); assert.equal(f.failures, 0);
  assert.equal(f.results[0].printSvg, before.print_svg); assert.equal(f.results[0].previewSvg, before.preview_svg);
  assert.equal(f.results[0].rendererProfileHash, before.renderer_profile_hash); assert.deepEqual(f.results[0].snapshot, JSON.parse(before.snapshot));
  assert.deepEqual(f.original, before);
});

test('explicit Sports and Pokemon refreshes render the immutable approval without changing grade, identity or report URL', async () => {
  for (const cardProfile of ['SPORTS', 'POKEMON']) {
    const f = await fixture(cardProfile), before = structuredClone(f.original), reportBefore = structuredClone(f.f.row);
    assert.equal(await f.service.runPending(), 1); assert.equal(f.rendered, 1); assert.equal(f.failures, 0);
    const result = f.results[0], saved = JSON.parse(before.snapshot);
    for (const key of ['identity', 'grade', 'finalGrade', 'cardProfile', 'reportNumber', 'approvalVersion', 'reportHref']) assert.deepEqual(result.snapshot[key], saved[key]);
    assert.notEqual(result.artworkHash, before.artwork_hash); assert.equal(result.rendererProfileHash, f.recipe.rendererProfileHash);
    assert.equal(result.materialProfileId, f.recipe.materialProfileId); assert.deepEqual(f.original, before); assert.deepEqual(f.f.row, reportBefore);
    assert.equal(await f.service.runPending(), 0);
  }
});

test('refresh commitment rejects tampered intent/target/source and never falls back to copy', async () => {
  for (const mutate of [
    f => { f.child.request_hash = digest('tampered'); }, f => { f.child.reason = 'Damaged stock'; },
    f => { f.child.renderer_profile_hash = digest('other profile'); }, f => { f.child.material_profile_id = 'other material'; },
    f => { f.child.jig_hash = digest('other jig'); }, f => { f.child.source_hash = digest('other source'); },
    f => { f.original.print_svg += 'tampered'; }, f => { f.original.snapshot_hash = digest('other snapshot'); },
  ]) {
    const f = await fixture(); mutate(f); assert.equal(await f.service.runPending(), 0); assert.equal(f.failures, 1);
    assert.equal(f.rendered, 0); assert.equal(f.results.length, 0);
  }
});

test('valid older target and mismatched saved approval fail closed before rendering', async () => {
  for (const change of ['renderer', 'material', 'jig', 'identity', 'grade', 'reportHref']) {
    const f = await fixture();
    if (['renderer', 'material', 'jig'].includes(change)) {
      const recipe = { ...f.recipe, ...(change === 'renderer' ? { rendererProfileHash: digest('old target') }
        : change === 'material' ? { materialProfileId: 'old-material' } : { jigHash: digest('old jig') }) };
      f.child = replacement(f.original, { recipe });
    } else {
      const snapshot = JSON.parse(f.original.snapshot);
      if (change === 'identity') snapshot.identity.playerName = 'Changed identity';
      else if (change === 'grade') snapshot.grade = 10;
      else snapshot.reportHref += '&changed=true';
      f.original.snapshot = canonical(snapshot); f.original.snapshot_hash = digest(f.original.snapshot);
    }
    assert.equal(await f.service.runPending(), 0); assert.equal(f.failures, 1); assert.equal(f.rendered, 0); assert.equal(f.results.length, 0);
  }
});

test('internal refresh accepts only exact hash intent and supplies material from the approved packet', async () => {
  const f = await fixture('POKEMON'), input = inputFor(f.original, f.recipe);
  await f.service.refreshLayout({}, f.original.id, input); assert.equal(f.reservations.length, 1);
  assert.deepEqual(f.reservations[0].slice(1), [f.original.id, input, f.recipe]);
  for (const extra of [{ grade: 10 }, { reason: 'Changed' }, { materialProfileId: 'gold' }, { printSvg: '<svg/>' }])
    await assert.rejects(f.service.refreshLayout({}, f.original.id, { ...input, ...extra }), { code: 'LABEL_REQUEST_INVALID' });
  assert.equal(f.reservations.length, 1);
});

// Small serialized transaction fixture exercises repository intent and authority
// decisions without opening any database or weakening the production triggers.
function repositoryFixture(original) {
  const rows = new Map([[original.id, structuredClone(original)]]), calls = [], principal = { id: original.actor_id, role: 'REVIEWER', accessVersion: 1 };
  let printed = false, allowed = true, current = true, discarded = false, tail = Promise.resolve();
  const tx = { async $executeRawUnsafe(sql, ...args) { calls.push({ sql, args }); assert.match(sql, /pg_advisory_xact_lock/); return 1; },
    async $queryRawUnsafe(sql, ...args) {
      calls.push({ sql, args });
      if (sql.includes('SELECT owner_id,approvers')) return allowed ? [{ owner_id: principal.id, approvers: [] }] : [];
      if (sql.includes('FROM atlas_manual_intake.discarded_card')) return discarded ? [{ present: 1 }] : [];
      if (sql.includes('FROM atlas_manual.publication p')) return [{ card_id: original.card_id, action_id: original.action_id,
        version: original.approval_version, source_revision: original.source_revision, source_hash: original.source_hash,
        report_hash: original.report_hash, public_hash: original.public_hash, state: 'PUBLISHED', mode: 'PRODUCTION',
        latest_action_id: current ? original.action_id : randomUUID() }];
      if (sql.includes('SELECT i.*')) { const row = rows.get(args[0]); return row && row.actor_id === args[1] ? [structuredClone(row)] : []; }
      if (sql.includes('WHERE actor_id=$1::uuid AND request_id=$2::uuid')) return [...rows.values()].filter(row => row.actor_id === args[0] && row.request_id === args[1]).map(row => structuredClone(row));
      if (sql.includes('label_print_event')) return printed ? [{ present: 1 }] : [];
      if (sql.includes('INSERT INTO atlas_manual_connected.label_item')) {
        const keys = ['id','actor_id','access_version','card_id','action_id','approval_version','source_revision','source_hash','report_hash','public_hash',
          'original_item_id','request_id','request_hash','reason','renderer_profile_hash','material_profile_id','jig_hash'];
        const row = { ...Object.fromEntries(keys.map((key, index) => [key, args[index]])), state: 'PENDING_RENDER', purpose: 'REPRINT',
          snapshot: null, snapshot_hash: null, print_svg: null, preview_svg: null, artwork_hash: null, sheet_id: null, slot: null, attempts: 0 };
        rows.set(row.id, row); return [structuredClone(row)];
      }
      assert.fail(`Unexpected repository query: ${sql}`);
    } };
  const repository = createLabelRepository({ boundary: { transaction(_staff, work) {
    const result = tail.then(() => work({ tx, principal })); tail = result.catch(() => {}); return result;
  } } });
  return { repository, principal, rows, calls, set printed(value) { printed = value; }, set allowed(value) { allowed = value; },
    set current(value) { current = value; }, set discarded(value) { discarded = value; } };
}

test('concurrent same-target refresh requests and exact replay reserve one replacement without updating old history', async () => {
  const f = await fixture(), r = repositoryFixture(f.original), input = inputFor(f.original, f.recipe), before = structuredClone(r.rows.get(f.original.id));
  const results = await Promise.all(Array.from({ length: 3 }, () => r.repository.refreshLayout({}, f.original.id, input, f.recipe)));
  assert.deepEqual(results[0], results[1]); assert.deepEqual(results[1], results[2]); assert.equal(r.rows.size, 2);
  const saved = r.rows.get(results[0].itemId); assert.equal(labelReplacementIntent(saved, f.original).kind, 'REFRESH');
  assert.deepEqual(r.rows.get(f.original.id), before); assert.equal(saved.purpose, 'REPRINT');
  assert.equal(r.calls.filter(call => call.sql.startsWith('INSERT')).length, 1);
  assert.equal(r.calls.some(call => /UPDATE|DELETE|INSERT INTO.*label_print_event/.test(call.sql)), false);
  // A committed request remains replayable after a renderer change or a later
  // physical print; the replay does not reserve another label.
  r.printed = true; assert.deepEqual(await r.repository.refreshLayout({}, f.original.id, input, { ...f.recipe, rendererProfileHash: digest('future renderer') }), results[0]);
  await assert.rejects(r.repository.refreshLayout({}, f.original.id, { ...input, expectedRendererProfileHash: digest('changed request') }, f.recipe), { code: 'LABEL_REQUEST_CONFLICT' });
  await assert.rejects(r.repository.refreshLayout({}, f.original.id, { ...input, requestId: randomUUID() }, f.recipe), { code: 'LABEL_REQUEST_CONFLICT' });
});

test('fresh refresh reservation refuses printed, stale, inaccessible, deleted and noncanonical sources', async () => {
  for (const kind of ['printed','profile','artwork','access','discarded','approval','purpose','same-profile']) {
    const f = await fixture(), r = repositoryFixture(f.original), input = inputFor(f.original, f.recipe);
    if (kind === 'printed') r.printed = true;
    if (kind === 'profile') input.expectedRendererProfileHash = digest('stale');
    if (kind === 'artwork') input.expectedLabelHash = digest('stale artwork');
    if (kind === 'access') r.allowed = false;
    if (kind === 'discarded') r.discarded = true;
    if (kind === 'approval') r.current = false;
    if (kind === 'purpose') r.rows.get(f.original.id).purpose = 'REPRINT';
    if (kind === 'same-profile') r.rows.get(f.original.id).renderer_profile_hash = f.recipe.rendererProfileHash;
    await assert.rejects(r.repository.refreshLayout({}, f.original.id, input, f.recipe));
    assert.equal(r.rows.size, 1); assert.equal(r.calls.some(call => call.sql.startsWith('INSERT')), false);
  }
});
