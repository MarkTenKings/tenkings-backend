// Explicit nonce-owned PostgreSQL17 qualification. No serving database is accepted.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disposablePostgres } from '../../../frontend/atlas-app/scripts/disposable-postgres.mjs';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../../atlas-standalone-database/migrate.mjs';
import { standaloneRoleSQL } from '../../atlas-standalone-database/grants.mjs';
import { canonical, digest, requireThat } from '../../atlas-manual-service/src/contract.mjs';
import { createIntakeRepository } from '../../atlas-manual-intake/src/repository.mjs';
import { createLabelRepository, labelFailureHash } from '../src/label-sheet-repository.mjs';
import { createLabelService } from '../src/label-sheet-service.mjs';
import { labelRefreshRequestId, labelReplacementIntent } from '../src/label-replacement-intent.mjs';
import { LABEL_JIG_V1 } from '../../atlas-finishing/src/label-sheet-geometry.mjs';
import { renderLabelV4, LABEL_V4_RENDERER_PROFILE_HASH } from '../../atlas-finishing/src/label-v4.mjs';
import { LABEL_EXPORT_PROFILE_V1, LABEL_INDIVIDUAL_EXPORT_PROFILE_V1, LABEL_BLACK_INK_EXPORT_PROFILE_V1, LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1 } from '../../atlas-finishing/src/label-sheet.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.ATLAS_LABEL_AUTO_RECOVERY_EVIDENCE;
assert(output && resolve(output) === output); mkdirSync(output, { recursive: true, mode: 0o700 });
const args = process.argv.slice(2), require = createRequire(import.meta.url);
const { Client } = require(args[args.indexOf('--pg-module') + 1]);
const { PrismaClient, Prisma } = require(resolve(root, 'frontend/atlas-app/.generated/staff-database'));
const cluster = await disposablePostgres(args), checks = [], errors = [], packets = new Map(), loadFailures = new Set();
const sourceFiles = Object.fromEntries(['src/label-sheet-repository.mjs', 'src/label-sheet-service.mjs', 'src/label-replacement-intent.mjs'].map(name => [name,
  createHash('sha256').update(readFileSync(resolve(root, 'packages/atlas-connected-manual', name))).digest('hex')]));
let admin, prisma, result, labelCalls = 0, packetCalls = 0, storageCalls = 0;
try {
  await cluster.sql('CREATE DATABASE atlas_auto_recovery');
  admin = new Client({ connectionString: cluster.url('atlas_auto_recovery') }); await admin.connect();
  await applyStandaloneBaseline(admin); await applyStandaloneMigrations(admin);
  const roles = { staff: 'atlas_auto_staff', manual: 'atlas_auto_main', variant: 'atlas_auto_variant', customer: 'atlas_auto_customer', customerPrivate: 'atlas_auto_private' };
  await admin.query(standaloneRoleSQL(roles)); const password = randomBytes(24).toString('hex');
  await admin.query(`ALTER ROLE ${roles.manual} LOGIN PASSWORD '${password}'`);
  const uri = new URL(cluster.url('atlas_auto_recovery')); uri.username = roles.manual; uri.password = password;
  prisma = new PrismaClient({ datasources: { db: { url: uri.href } } }); await prisma.$connect();
  const actor = randomUUID(), other = randomUUID();
  for (const id of [actor, other]) await admin.query('INSERT INTO atlas_staff."StaffIdentity"(id,"phoneHash",role) VALUES($1,$2,\'REVIEWER\')', [id, digest(id)]);
  const staff = { id: actor, role: 'REVIEWER', mode: 'PRODUCTION', accessVersion: 1 };
  const boundary = {
    machineOwner: ({ ownerId, accessVersion }) => ({ ...staff, id: ownerId, accessVersion }),
    async transaction(principal, work) {
      return prisma.$transaction(async tx => {
        const refresh = async () => {
          const row = (await admin.query('SELECT role,"accessVersion","revokedAt" FROM atlas_staff."StaffIdentity" WHERE id=$1', [principal.id])).rows[0];
          requireThat(row && !row.revokedAt && row.role === principal.role && row.accessVersion === principal.accessVersion, 403, 'FIXTURE_ACCESS_REVOKED');
          return { principal };
        };
        await refresh(); return work({ tx, principal, refresh });
      }, { timeout: 15000, maxWait: 15000 }).catch(error => { errors.push({ code: error.code, databaseCode: error.meta?.code ?? null }); throw error; });
    },
    machineTransaction(_staff, work) { return this.transaction(staff, work); },
  };
  const intake = createIntakeRepository({ boundary, keyPrefix: 'owned-fixture', maxOriginalBytes: 1024 });
  const makeRepository = () => createLabelRepository({ boundary, validateAccess: ({ tx, cardId }) => intake.assertActiveInTransaction(tx, cardId) });
  const repo = makeRepository();
  const readItem = async id => (await admin.query('SELECT * FROM atlas_manual_connected.label_item WHERE id=$1', [id])).rows[0];
  const children = async id => (await admin.query("SELECT * FROM atlas_manual_connected.label_item WHERE original_item_id=$1 AND purpose='LAYOUT_RETRY' ORDER BY created_at,id", [id])).rows;
  const approveRows = async () => (await admin.query('SELECT to_jsonb(a) value FROM atlas_manual.approval a ORDER BY card_id,action_id')).rows;
  async function seed({ profile = null, code = 'METADATA_OVERFLOW', pending = false, cardId = randomUUID(), version = 1, owner = actor, identity = null } = {}) {
    const actionId = randomUUID(), id = randomUUID(), text = '{}', h = digest(text), createId = randomUUID();
    identity ??= { cardName: 'Sylveon ex', year: '2024', manufacturer: 'The Pokémon Company International', productSet: 'Scarlet & Violet—Surging Sparks', cardNumber: '086/191', parallel: 'English Holofoil' };
    const report = { identity, finalGrade: 8.5, cardProfile: 'POKEMON' }, reportText = canonical(report), reportHash = digest(reportText);
    if (version === 1) {
      await admin.query('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,approvers) VALUES($1,1,$2,$3,$4,$5)', [cardId, text, h, owner, owner === actor ? [] : [actor]]);
      await admin.query('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1,$2,$3,$4,$5,$6)', [cardId, randomUUID(), actor, createId, digest(createId), identity.cardName]);
      await admin.query('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1,$2,$3)', [cardId, `ar_${randomBytes(18).toString('base64url')}`, `ATLAS-${randomBytes(6).toString('hex').toUpperCase()}`]);
    }
    await admin.query('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1,$2,$3,$6,$7,$4,$5,$5)', [cardId, actionId, actor, h, text, version * 2 - 1, version * 2]);
    await admin.query('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1,$2,$3,$6,$4,$7,$5)', [cardId, actionId, actor, h, reportText, version * 2 - 1, reportHash]);
    await admin.query("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1,$2,$3,'PRODUCTION')", [cardId, actionId, version]);
    await admin.query("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$3,manifest_hash=$4,public_hash=$4,published_at=clock_timestamp() WHERE card_id=$1 AND action_id=$2", [cardId, actionId, text, h]);
    const row = (await admin.query('SELECT p.*,a.source_revision,a.source_hash,a.report_hash FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id) WHERE p.card_id=$1 AND p.action_id=$2', [cardId, actionId])).rows[0];
    const reportIdentity = (await admin.query('SELECT * FROM atlas_manual.public_report_identity WHERE card_id=$1', [cardId])).rows[0];
    const packet = { report, reportNumber: reportIdentity.report_number, publicToken: reportIdentity.public_token, approvalVersion: version };
    packets.set(actionId, { packet, row });
    const source = { identity, finalGrade: 8.5, reportNumber: packet.reportNumber, approvalVersion: version, cardProfile: 'POKEMON' };
    const snapshot = canonical({ identity, grade: 8.5, finalGrade: 8.5, cardProfile: 'POKEMON', source });
    if (version === 1) await admin.query(`INSERT INTO atlas_manual_connected.label_item(id,actor_id,access_version,card_id,action_id,approval_version,source_revision,source_hash,report_hash,public_hash,purpose,state,snapshot,snapshot_hash,attempts,code,renderer_profile_hash)
      VALUES($1,$2,1,$3,$4,1,1,$5,$6,$5,'ORIGINAL',$7,$8,$9,$10,$11,$12)`,
      [id, actor, cardId, actionId, h, reportHash, pending ? 'PENDING_RENDER' : 'NEEDS_LAYOUT', pending ? null : snapshot, pending ? null : digest(snapshot), pending ? 0 : 1, pending ? null : code, profile]);
    return { id, cardId, actionId, source, packet, row };
  }
  const discard = f => intake.discard(staff, { requestId: randomUUID(), scope: 'SELECTED', cardIds: [f.cardId] });
  const makeService = ({ repository = makeRepository(), beforeLoad = null, reauthorizeAfterLoad = false, render = renderLabelV4 } = {}) => createLabelService({ boundary, repository,
    finishing: { async loadPacket(_staff, cardId, actionId) { packetCalls++; if (beforeLoad) await beforeLoad(cardId, actionId);
      if (reauthorizeAfterLoad) await boundary.transaction(_staff, ({ tx }) => intake.assertActiveInTransaction(tx, cardId));
      if (loadFailures.has(cardId)) throw new Error('OWNED_FIXTURE_STORAGE_FAILURE'); return packets.get(actionId); } },
    storage: { async write() { storageCalls++; throw new Error('UNEXPECTED_EXPORT'); }, async download() { throw new Error('UNEXPECTED_DOWNLOAD'); } },
    renderer: { label: async (...args) => { labelCalls++; return render(...args); }, sheet: async () => { throw new Error('UNEXPECTED_SHEET'); }, individual: async () => { throw new Error('UNEXPECTED_INDIVIDUAL'); } },
  });
  const service = makeService({ repository: repo });
  const visibleItem = async id => (await service.list(staff)).items.find(item => item.itemId === id);
  const drain = async (n = 3, selected = service) => { for (let i = 0; i < n; i++) await selected.runPending({ limit: 16 }); };

  const existing = await seed({ pending: true }); await drain(1);
  const readyBefore = await readItem(existing.id); assert.equal(readyBefore.state, 'READY');
  const legacy = await seed(), legacyBefore = await readItem(legacy.id), approvalBefore = await approveRows();
  assert.equal((await visibleItem(legacy.id)).automaticLayoutRecoveryEligible, true);
  assert.equal((await repo.pendingCandidates(16, { rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH })).filter(x => x.kind === 'LAYOUT_RECOVERY').length, 1);
  await drain(3); const [recovered] = await children(legacy.id); assert(recovered); assert.equal((await children(legacy.id)).length, 1); assert.equal(recovered.state, 'READY');
  assert.equal(recovered.renderer_profile_hash, LABEL_V4_RENDERER_PROFILE_HASH); assert.equal(recovered.material_profile_id, 'atlas-v4-holo-v1');
  assert.deepEqual(JSON.parse(recovered.snapshot).source, legacy.source); assert.equal(JSON.parse(recovered.snapshot).finalGrade, 8.5);
  const expected = renderLabelV4(legacy.source, { previewMaterial: 'holo' }); assert.equal(recovered.print_svg, expected.printSvg); assert.equal(recovered.preview_svg, expected.previewSvg);
  const legacyAfter = await readItem(legacy.id); assert.equal(legacyAfter.state, 'SUPERSEDED'); assert.deepEqual({ ...legacyAfter, state: legacyBefore.state, updated_at: legacyBefore.updated_at }, legacyBefore);
  assert.deepEqual(await readItem(existing.id), readyBefore); assert.deepEqual(await approveRows(), approvalBefore);
  assert.equal((await visibleItem(legacy.id)).automaticLayoutRecoveryEligible, false); assert.equal((await visibleItem(recovered.id)).automaticLayoutRecoveryEligible, false);
  checks.push('legacy NULL-profile failure automatically creates one READY successor with exact full identity, grade, SVG and preserved predecessor/READY/approval bytes');

  const same = await seed({ profile: LABEL_V4_RENDERER_PROFILE_HASH }), sameBefore = await readItem(same.id); await drain(6);
  assert.deepEqual(await readItem(same.id), sameBefore); assert.equal((await children(same.id)).length, 0); assert.equal((await visibleItem(same.id)).automaticLayoutRecoveryEligible, false);
  checks.push('same-profile NEEDS_LAYOUT remains unchanged across repeated worker passes');

  const racing = await seed({ profile: digest('old-renderer') }); const a = makeService(), b = makeService();
  await Promise.all([a.runPending(), b.runPending()]); await Promise.all([a.runPending(), b.runPending()]); await drain(2);
  assert.equal((await children(racing.id)).length, 1); assert.equal((await children(racing.id))[0].state, 'READY');
  checks.push('concurrent independent Prisma worker passes create one successor and one sheet assignment');

  const fails = await seed(); loadFailures.add(fails.cardId); await drain(9);
  const failed = (await children(fails.id))[0]; assert.equal((await children(fails.id)).length, 1); assert.equal(failed.state, 'NEEDS_LAYOUT'); assert.equal(failed.attempts, 5);
  assert.equal(failed.code, 'LABEL_RENDER_FAILED'); assert.equal(failed.renderer_profile_hash, LABEL_V4_RENDERER_PROFILE_HASH); const failedBefore = await readItem(failed.id); assert.equal((await visibleItem(failed.id)).automaticLayoutRecoveryEligible, false);
  await drain(5); assert.deepEqual(await readItem(failed.id), failedBefore); assert.equal((await children(failed.id)).length, 0);
  checks.push('five public-packet storage failures stop in the bound generation without automatic regeneration');

  const throws = await seed(); const throwing = makeService({ render: () => { throw new Error('OWNED_FIXTURE_RENDER_FAILURE'); } }); await drain(9, throwing);
  const thrown = (await children(throws.id))[0]; assert.equal(thrown.state, 'NEEDS_LAYOUT'); assert.equal(thrown.attempts, 5); assert.equal((await children(throws.id)).length, 1); await drain(4, throwing);
  assert.equal((await children(thrown.id)).length, 0); checks.push('five renderer exceptions stop without another automatic generation');

  const crashed = await seed({ pending: true });
  const attemptedProfile = { rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH, jigHash: LABEL_JIG_V1.jigHash };
  for (let attempt = 1; attempt <= 5; attempt++) {
    const claim = await repo.claimItem(staff, crashed.id, attemptedProfile);
    assert(claim); assert.equal(claim.attempts, attempt);
    assert.equal(claim.renderer_profile_hash, attemptedProfile.rendererProfileHash); assert.equal(claim.jig_hash, attemptedProfile.jigHash);
    // Simulate process death without failItem; only the owned fixture admin expires the lease.
    await admin.query("UPDATE atlas_manual_connected.label_item SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [crashed.id]);
  }
  const crashCallsBefore = { labelCalls, packetCalls }; await drain(1);
  const exhausted = await readItem(crashed.id); assert.equal(exhausted.state, 'NEEDS_LAYOUT'); assert.equal(exhausted.attempts, 5);
  assert.equal(exhausted.code, 'LABEL_RENDER_FAILED'); assert.equal(exhausted.renderer_profile_hash, attemptedProfile.rendererProfileHash);
  assert.equal(exhausted.jig_hash, attemptedProfile.jigHash); assert.equal(exhausted.claim_id, null); assert.equal(exhausted.lease_until, null);
  assert.equal((await visibleItem(crashed.id)).automaticLayoutRecoveryEligible, false); await drain(4);
  assert.deepEqual(await readItem(crashed.id), exhausted); assert.equal((await children(crashed.id)).length, 0);
  assert.deepEqual({ labelCalls, packetCalls }, crashCallsBefore);
  const oldCrash = await seed({ pending: true });
  await admin.query('UPDATE atlas_manual_connected.label_item SET attempts=5 WHERE id=$1', [oldCrash.id]); await drain(1);
  const oldExhausted = await readItem(oldCrash.id); assert.equal(oldExhausted.state, 'NEEDS_LAYOUT'); assert.equal(oldExhausted.attempts, 5);
  assert.equal(oldExhausted.code, 'LABEL_RENDER_FAILED'); assert.equal(oldExhausted.renderer_profile_hash, attemptedProfile.rendererProfileHash);
  assert.equal(oldExhausted.jig_hash, attemptedProfile.jigHash); await drain(3);
  assert.deepEqual(await readItem(oldCrash.id), oldExhausted); assert.equal((await children(oldCrash.id)).length, 0);
  checks.push('five crashed claims with expired leases stop without rendering or regeneration; new claims and legacy exhaustion both record the attempted renderer and jig');

  const revoked = await seed({ owner: other }); await admin.query('UPDATE atlas_manual.card SET approvers=$2,revision=revision+1 WHERE id=$1', [revoked.cardId, []]);
  const revokedBefore = await readItem(revoked.id); await drain(3); assert.equal((await children(revoked.id)).length, 0); assert.deepEqual(await readItem(revoked.id), revokedBefore);
  const obsolete = await seed(); await seed({ cardId: obsolete.cardId, version: 2 }); const obsoleteBefore = await readItem(obsolete.id); await drain(3);
  assert.equal((await children(obsolete.id)).length, 0); assert.deepEqual(await readItem(obsolete.id), obsoleteBefore);
  assert.equal(await visibleItem(revoked.id), undefined); assert.equal((await visibleItem(obsolete.id)).automaticLayoutRecoveryEligible, false);
  checks.push('revoked card access and newer approval exclude old failed sources without mutation');

  const deleted = await seed(); await discard(deleted); const deletedBefore = await readItem(deleted.id); const callsBefore = { labelCalls, packetCalls };
  await drain(3); assert.equal((await children(deleted.id)).length, 0); assert.deepEqual(await readItem(deleted.id), deletedBefore); assert.deepEqual({ labelCalls, packetCalls }, callsBefore);
  assert.equal(await visibleItem(deleted.id), undefined);
  checks.push('deletion before discovery excludes the card with zero packet loads, renders or successors');

  const between = await seed(); const betweenBefore = await readItem(between.id); let deletedBetween = false; const discoveryRepo = makeRepository();
  const gated = { ...discoveryRepo, async pendingCandidates(...args) { const rows = await discoveryRepo.pendingCandidates(...args);
    if (!deletedBetween && rows.some(r => r.id === between.id)) { deletedBetween = true; await discard(between); } return rows; } };
  await drain(3, makeService({ repository: gated })); assert(deletedBetween); assert.equal((await children(between.id)).length, 0); assert.deepEqual(await readItem(between.id), betweenBefore);
  checks.push('deletion after discovery but before reservation is rechecked through real intake authorization; no successor');

  const midRender = await seed(); await drain(1); const pending = (await children(midRender.id))[0]; assert.equal(pending.state, 'PENDING_RENDER'); let deletedDuringLoad = false;
  const interrupted = makeService({ beforeLoad: async cardId => { if (cardId === midRender.cardId && !deletedDuringLoad) { deletedDuringLoad = true; await discard(midRender); } } });
  await drain(2, interrupted); assert(deletedDuringLoad); const fenced = await readItem(pending.id); assert.notEqual(fenced.state, 'READY'); assert.equal(fenced.print_svg, null); assert.equal(fenced.sheet_id, null);
  const fencedBefore = await readItem(pending.id), callsAfterFence = { labelCalls, packetCalls }; await drain(4, interrupted);
  assert.deepEqual(await readItem(pending.id), fencedBefore); assert.deepEqual({ labelCalls, packetCalls }, callsAfterFence); assert.equal((await children(pending.id)).length, 0);
  assert.equal((await admin.query('SELECT count(*)::int n FROM atlas_manual_intake.discarded_card WHERE card_id=$1', [midRender.cardId])).rows[0].n, 1);
  checks.push('deletion after claim/before finish fences READY/artwork/assignment and later discovery; existing history is retained without revival');

  const duringStorage = await seed(); await drain(1); const storagePending = (await children(duringStorage.id))[0];
  assert.equal(storagePending.state, 'PENDING_RENDER'); let deletedDuringStorage = false; const rendersBeforeStorageDeletion = labelCalls;
  const reauthorized = makeService({ reauthorizeAfterLoad: true, beforeLoad: async cardId => {
    if (cardId === duringStorage.cardId && !deletedDuringStorage) { deletedDuringStorage = true; await discard(duringStorage); }
  } });
  await drain(3, reauthorized); assert(deletedDuringStorage); assert.equal(labelCalls, rendersBeforeStorageDeletion);
  const storageFenced = await readItem(storagePending.id); assert.notEqual(storageFenced.state, 'READY'); assert.equal(storageFenced.print_svg, null); assert.equal(storageFenced.sheet_id, null);
  assert.equal(await visibleItem(storagePending.id), undefined); assert.equal((await children(storagePending.id)).length, 0);
  checks.push('finishing adapter boundary reauthorization after simulated packet storage rejects a deleted source before any renderer call');

  const bounded = await seed(); let tail = await readItem(bounded.id);
  for (let generation = 1; generation <= 16; generation++) {
    const target = { rendererProfileHash: digest('historical-renderer-' + generation), materialProfileId: 'atlas-v4-holo-v1', jigHash: LABEL_JIG_V1.jigHash };
    const next = await repo.retryLayout(staff, tail.id, { requestId: randomUUID(), expectedFailureHash: labelFailureHash(tail), expectedRendererProfileHash: target.rendererProfileHash }, target);
    const claim = await repo.claimItem(staff, next.itemId, attemptedProfile);
    assert.equal(claim.renderer_profile_hash, target.rendererProfileHash); assert.equal(claim.jig_hash, target.jigHash);
    await repo.finishItem(staff, claim, { ...target, row: bounded.row, state: 'NEEDS_LAYOUT', code: 'METADATA_OVERFLOW', snapshot: JSON.parse(tail.snapshot) });
    tail = await readItem(next.itemId);
  }
  assert.equal((await visibleItem(tail.id)).automaticLayoutRecoveryEligible, false); const tailBefore = await readItem(tail.id); await drain(3);
  assert.deepEqual(await readItem(tail.id), tailBefore); assert.equal((await children(tail.id)).length, 0);
  checks.push('16 historical retry generations reach the ancestry limit; UI eligibility and discovery both refuse another generation');

  const boundA = await seed(), boundB = await seed(); const discovered = await repo.pendingCandidates(16, { rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH });
  assert.equal(discovered.filter(row => row.kind === 'LAYOUT_RECOVERY').length, 1); await drain(1);
  assert.equal((await children(boundA.id)).length + (await children(boundB.id)).length, 1); await drain(4);
  assert.equal((await children(boundA.id)).length, 1); assert.equal((await children(boundB.id)).length, 1);
  checks.push('each worker pass reserves at most one automatic recovery even with multiple eligible cards');

  const overlap = await seed(); let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const lockedRepository = createLabelRepository({ boundary, validateAccess: async ({ tx, cardId }) => {
    await intake.assertActiveInTransaction(tx, cardId); if (cardId === overlap.cardId) { enter(); await gate; }
  } });
  const original = await readItem(overlap.id), target = { rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH, materialProfileId: 'atlas-v4-holo-v1', jigHash: LABEL_JIG_V1.jigHash };
  const reservation = lockedRepository.retryLayout(staff, overlap.id, { requestId: randomUUID(), expectedFailureHash: labelFailureHash(original), expectedRendererProfileHash: target.rendererProfileHash }, target, { automatic: true });
  await entered;
  try { await assert.rejects(discard(overlap), { code: 'INTAKE_DISCARD_BUSY' }); } finally { release(); }
  const reserved = await reservation; await discard(overlap); await drain(3);
  const tombstoned = await readItem(reserved.itemId); assert.notEqual(tombstoned.state, 'READY'); assert.equal(tombstoned.print_svg, null); assert.equal(tombstoned.sheet_id, null); assert.equal(await visibleItem(reserved.itemId), undefined);
  checks.push('real intake SHARE lock prevents concurrent deletion from crossing reservation; after deletion commits the child cannot render or assign');

  // DB qualification uses clearly marked local bytes; real PNG semantics are
  // qualified separately by the native finishing and service raster suites.
  const readExport = async id => (await admin.query('SELECT * FROM atlas_manual_connected.label_export WHERE id=$1', [id])).rows[0];
  async function completeFixtureExport(prepared) {
    const claimed = await repo.claimExport(staff, prepared.exportId), bytes = Buffer.from(`OWNED_DISPOSABLE_NOT_PRINTABLE:${prepared.exportProfileId}`);
    await repo.finishExport(staff, claimed, { object: { fixtureBase64: bytes.toString('base64') }, sha256: digest(bytes), byteCount: bytes.length, mapping: { exportProfileId: prepared.exportProfileId, fixtureOnly: true } });
    return readExport(prepared.exportId);
  }
  const singleOldInput = { requestId: randomUUID(), expectedLabelHash: readyBefore.artwork_hash, exportProfileId: LABEL_INDIVIDUAL_EXPORT_PROFILE_V1.id };
  const singleBlackInput = { ...singleOldInput, requestId: randomUUID(), exportProfileId: LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1.id };
  const singleOld = await service.prepareIndividualExport(staff, existing.id, singleOldInput), singleOldReady = await completeFixtureExport(singleOld);
  const singleBlack = await service.prepareIndividualExport(staff, existing.id, singleBlackInput); await completeFixtureExport(singleBlack);
  assert.notEqual(singleOld.exportId, singleBlack.exportId); assert.equal(singleOld.manifestHash, singleBlack.manifestHash);
  for (const [input, prepared] of [[singleOldInput, singleOld], [singleBlackInput, singleBlack]]) {
    const replay = await service.prepareIndividualExport(staff, existing.id, input); assert.equal(replay.exportId, prepared.exportId); assert.equal(replay.state, 'READY');
  }
  await assert.rejects(service.prepareIndividualExport(staff, existing.id, { ...singleOldInput, exportProfileId: singleBlackInput.exportProfileId }), { code: 'LABEL_REQUEST_CONFLICT' });
  assert.deepEqual(await readExport(singleOld.exportId), singleOldReady);
  const currentSheet = async () => (await admin.query('SELECT * FROM atlas_manual_connected.label_sheet WHERE id=$1', [readyBefore.sheet_id])).rows[0];
  const sheetOldInput = { requestId: randomUUID(), expectedSheetRevision: (await currentSheet()).revision, exportProfileId: LABEL_EXPORT_PROFILE_V1.id };
  const sheetOld = await service.prepareSheetExport(staff, readyBefore.sheet_id, sheetOldInput), sheetOldReady = await completeFixtureExport(sheetOld);
  const frozenSheet = await currentSheet(); assert.equal(frozenSheet.state, 'SEALED');
  const sheetBlackInput = { requestId: randomUUID(), expectedSheetRevision: frozenSheet.revision, exportProfileId: LABEL_BLACK_INK_EXPORT_PROFILE_V1.id };
  const sheetBlack = await service.prepareSheetExport(staff, readyBefore.sheet_id, sheetBlackInput); await completeFixtureExport(sheetBlack);
  assert.notEqual(sheetOld.exportId, sheetBlack.exportId); assert.equal(sheetOld.manifestHash, sheetBlack.manifestHash);
  for (const [input, prepared] of [[sheetOldInput, sheetOld], [sheetBlackInput, sheetBlack]]) assert.equal((await service.prepareSheetExport(staff, readyBefore.sheet_id, input)).exportId, prepared.exportId);
  assert.deepEqual(await readExport(sheetOld.exportId), sheetOldReady); assert.deepEqual(await currentSheet(), frozenSheet);
  assert.equal((await admin.query('SELECT count(*)::int n FROM atlas_manual_connected.label_export')).rows[0].n, 4);
  checks.push('legacy and black-only exports coexist as four immutable profile-specific records for the same READY item and frozen sheet; exact request replays preserve old bytes and reject changed semantics');

  const refreshSource = await seed({ pending: true }), oldProfile = digest('owned-previous-compact-recipe');
  const onlyItem = id => ({ ...makeRepository(), pendingCandidates: async () => [{ id, actor_id: actor, access_version: 1, kind: 'ITEM' }] });
  await makeService({ repository: onlyItem(refreshSource.id), render: (...args) => ({ ...renderLabelV4(...args), rendererProfileHash: oldProfile }) }).runPending();
  const refreshParent = await readItem(refreshSource.id); assert.equal(refreshParent.state, 'READY');
  const parentSheet = await repo.sheet(staff, refreshParent.sheet_id);
  const oldExport = await service.prepareSheetExport(staff, refreshParent.sheet_id,
    { requestId: randomUUID(), expectedSheetRevision: parentSheet.revision, exportProfileId: LABEL_BLACK_INK_EXPORT_PROFILE_V1.id });
  const oldExportBefore = await completeFixtureExport(oldExport);
  const oldSingle = await service.prepareIndividualExport(staff, refreshParent.id,
    { requestId: randomUUID(), expectedLabelHash: refreshParent.artwork_hash, exportProfileId: LABEL_BLACK_INK_INDIVIDUAL_EXPORT_PROFILE_V1.id });
  const oldSingleBefore = await completeFixtureExport(oldSingle);
  const frozenBefore = (await admin.query('SELECT * FROM atlas_manual_connected.label_sheet WHERE id=$1', [refreshParent.sheet_id])).rows[0];
  const refreshApprovals = await approveRows(), targetRecipe = { rendererProfileHash: LABEL_V4_RENDERER_PROFILE_HASH,
    materialProfileId: refreshParent.material_profile_id, jigHash: refreshParent.jig_hash };
  const refreshInput = { requestId: labelRefreshRequestId(refreshParent.id, refreshParent.artwork_hash, targetRecipe),
    expectedLabelHash: refreshParent.artwork_hash, expectedRendererProfileHash: targetRecipe.rendererProfileHash };
  const refreshed = await Promise.all([service.refreshLayout(staff, refreshParent.id, refreshInput), makeService().refreshLayout(staff, refreshParent.id, refreshInput)]);
  assert.deepEqual(refreshed[0], refreshed[1]); assert.equal(refreshed[0].purpose, 'REPRINT');
  assert.equal((await admin.query('SELECT count(*)::int n FROM atlas_manual_connected.label_item WHERE original_item_id=$1', [refreshParent.id])).rows[0].n, 1);
  const refreshId = refreshed[0].itemId, refreshClaim = await repo.claimItem(staff, refreshId, attemptedProfile);
  assert.equal(refreshClaim.renderer_profile_hash, targetRecipe.rendererProfileHash); assert.equal(refreshClaim.jig_hash, targetRecipe.jigHash);
  await repo.failItem(staff, refreshClaim, { rendererProfileHash: digest('different-attempt'), materialProfileId: 'different-material', jigHash: digest('different-jig') });
  assert.equal((await readItem(refreshId)).renderer_profile_hash, targetRecipe.rendererProfileHash);
  await makeService({ repository: onlyItem(refreshId) }).runPending();
  const compact = await readItem(refreshId); assert.equal(compact.state, 'READY'); assert.equal(compact.attempts, 2);
  assert.equal(labelReplacementIntent(compact, refreshParent).kind, 'REFRESH'); assert.notEqual(compact.sheet_id, refreshParent.sheet_id);
  for (const key of ['identity','grade','finalGrade','reportNumber','approvalVersion','reportHref'])
    assert.deepEqual(JSON.parse(compact.snapshot)[key], JSON.parse(refreshParent.snapshot)[key]);
  assert.deepEqual(await service.refreshLayout(staff, refreshParent.id, refreshInput), await visibleItem(refreshId).then(({ exports, ...view }) => view));
  await assert.rejects(service.refreshLayout(staff, refreshParent.id, { ...refreshInput, requestId: randomUUID() }), { code: 'LABEL_REQUEST_CONFLICT' });
  await assert.rejects(service.refreshLayout(staff, refreshParent.id, { ...refreshInput, expectedRendererProfileHash: digest('stale') }), { code: 'LABEL_REQUEST_CONFLICT' });
  assert.deepEqual(await readItem(refreshParent.id), refreshParent); assert.deepEqual(await readExport(oldExport.exportId), oldExportBefore);
  assert.deepEqual(await readExport(oldSingle.exportId), oldSingleBefore);
  assert.deepEqual((await admin.query('SELECT * FROM atlas_manual_connected.label_sheet WHERE id=$1', [refreshParent.sheet_id])).rows[0], frozenBefore);
  assert.equal((await repo.export(staff, oldExport.exportId)).row.state, 'READY'); assert.equal((await repo.export(staff, oldSingle.exportId)).row.state, 'READY');
  assert.deepEqual(await approveRows(), refreshApprovals);
  checks.push('concurrent explicit compact refresh reserves one REPRINT, pins target through claim/fail/retry, renders same approval and preserves frozen sheet/individual exports and all approvals');

  const ordinary = await repo.reprint(staff, refreshParent.id, { requestId: randomUUID(), expectedLabelHash: refreshParent.artwork_hash, reason: 'Damaged stock' });
  await admin.query('UPDATE atlas_manual_connected.label_item SET renderer_profile_hash=$2,material_profile_id=$3,jig_hash=$4,attempts=1 WHERE id=$1',
    [ordinary.itemId, digest('crashed-legacy-attempt'), 'crashed-legacy-material', digest('crashed-legacy-jig')]);
  const copyCalls = labelCalls;
  await makeService({ repository: onlyItem(ordinary.itemId), render: () => { throw new Error('ORDINARY_REPRINT_MUST_NOT_RENDER'); } }).runPending();
  const copied = await readItem(ordinary.itemId); assert.equal(copied.state, 'READY'); assert.equal(labelCalls, copyCalls);
  for (const key of ['snapshot','snapshot_hash','print_svg','preview_svg','artwork_hash','renderer_profile_hash','material_profile_id','jig_hash']) assert.equal(copied[key], refreshParent[key]);
  checks.push('ordinary REPRINT with historical crashed attempt fields still copies exact saved snapshot/artwork/profile under real Prisma and installed immutable triggers');
  await repo.confirmPrint(staff, { requestId: randomUUID(), exportId: oldSingleBefore.id, exportSha256: oldSingleBefore.sha256,
    manifestHash: oldSingleBefore.manifest_hash, successfulSlots: [1] });
  const afterSingleTarget = { ...targetRecipe, rendererProfileHash: digest('after-single-print') }, afterSingleInput = {
    requestId: labelRefreshRequestId(refreshParent.id, refreshParent.artwork_hash, afterSingleTarget), expectedLabelHash: refreshParent.artwork_hash,
    expectedRendererProfileHash: afterSingleTarget.rendererProfileHash };
  await assert.rejects(repo.refreshLayout(staff, refreshParent.id, afterSingleInput, afterSingleTarget), { code: 'LABEL_REFRESH_ALREADY_PRINTED' });
  checks.push('recorded successful individual-export slot 1 also blocks a fresh refresh, independently of sheet-print events');

  const finishRace = await seed({ pending: true });
  await makeService({ repository: onlyItem(finishRace.id), render: (...args) => ({ ...renderLabelV4(...args), rendererProfileHash: digest('owned-print-race-recipe') }) }).runPending();
  const raceParent = await readItem(finishRace.id), raceTarget = { ...targetRecipe }, raceInput = {
    requestId: labelRefreshRequestId(raceParent.id, raceParent.artwork_hash, raceTarget), expectedLabelHash: raceParent.artwork_hash, expectedRendererProfileHash: raceTarget.rendererProfileHash };
  const raceRefresh = await service.refreshLayout(staff, raceParent.id, raceInput);
  const raceSheet = await repo.sheet(staff, raceParent.sheet_id), raceExport = await service.prepareSheetExport(staff, raceParent.sheet_id,
    { requestId: randomUUID(), expectedSheetRevision: raceSheet.revision, exportProfileId: LABEL_BLACK_INK_EXPORT_PROFILE_V1.id });
  const raceReady = await completeFixtureExport(raceExport);
  await repo.confirmPrint(staff, { requestId: randomUUID(), exportId: raceReady.id, exportSha256: raceReady.sha256,
    manifestHash: raceReady.manifest_hash, successfulSlots: [raceParent.slot] });
  await makeService({ repository: onlyItem(raceRefresh.itemId) }).runPending();
  const printFenced = await readItem(raceRefresh.itemId); assert.equal(printFenced.state, 'PENDING_RENDER'); assert.equal(printFenced.print_svg, null); assert.equal(printFenced.sheet_id, null);
  const changedTarget = { ...raceTarget, rendererProfileHash: digest('future-explicit-target') }, changedInput = {
    requestId: labelRefreshRequestId(raceParent.id, raceParent.artwork_hash, changedTarget), expectedLabelHash: raceParent.artwork_hash, expectedRendererProfileHash: changedTarget.rendererProfileHash };
  await assert.rejects(repo.refreshLayout(staff, raceParent.id, changedInput, changedTarget), { code: 'LABEL_REFRESH_ALREADY_PRINTED' });
  assert.deepEqual(await readItem(raceParent.id), raceParent);
  checks.push('recorded original print blocks fresh refresh and a print after reservation fences finish before any compact artwork or sheet assignment');

  assert.deepEqual(await readItem(existing.id), readyBefore); assert.equal(storageCalls, 0);
  const approvalRows = await approveRows(); assert(approvalBefore.every(old => approvalRows.some(row => canonical(row) === canonical(old))));
  result = { status: 'ATLAS_LABEL_AUTO_RECOVERY_PRISMA_PASS', prismaVersion: Prisma.prismaVersion, sourceFiles, checks, labelCalls, packetCalls,
    providerCalls: 0, productionConnections: 0, remoteStorageCalls: 0, deletionEffects: 'OWNED_DISPOSABLE_FIXTURE_ONLY', observedTransactionErrors: errors };
} catch (error) {
  result = { status: 'ATLAS_LABEL_AUTO_RECOVERY_PRISMA_FAILED', sourceFiles, checks, error: { name: error.name, code: error.code, meta: error.meta, message: error.message, stack: error.stack }, productionConnections: 0 };
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); await admin?.end(); await cluster.stop(); }
result.cleanup = JSON.parse(readFileSync(resolve(cluster.directory, 'cleanup.json'))); assert.equal(result.cleanup.stoppedVerified, true);
writeFileSync(resolve(output, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); console.log(JSON.stringify(result, null, 2));
