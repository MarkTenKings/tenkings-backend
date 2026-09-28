// Synthetic owned fixture only. The combined runner owns creation and cleanup.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMachineStaffBoundary, machineGrantSQL } from '../../atlas-manual-service/src/machine-auth.mjs';
import { createDefectMemory, createDefectMemoryRepository, defectMemoryGrantSQL,
  createLearningPublicationRepository, learningGrantSQL } from '../src/index.mjs';
import { fixtures } from '../test/fixtures.mjs';
import { canonical, digest } from '../src/contract.mjs';
import { readRoleLearning } from '../src/role-repository.mjs';
import { roleFixture, seal } from '../test/role-fixtures.mjs';

export async function runLearningPostgres({ fixture, output }) {
  assert(fixture?.cluster?.directory && fixture.database.name.startsWith('atlas_'));
  for (const grant of [defectMemoryGrantSQL, machineGrantSQL, learningGrantSQL])
    await fixture.cluster.sql(grant('atlas_fixture_manual'), [], fixture.database.name);
  await fixture.cluster.sql('GRANT SELECT ON atlas_manual_intake.card TO atlas_fixture_manual', [], fixture.database.name);
  const connection = fixture.connect(), { auth, boundary, manualClient } = connection, checks = [];
  try {
    const boot = await auth.bootstrap(''), browser = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(browser, boot.csrf, { phone: '+12025550143', requestId: randomUUID() }, 'learning-fixture');
    const verified = await auth.verify(browser, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'learning-fixture');
    const staff = await auth.authenticate(`${browser}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
    const principal = await boundary.transaction(staff, async ({ principal }) => principal);
    const machine = createMachineStaffBoundary({ boundary, auth, manualClient });
    const queue = createLearningPublicationRepository({ boundary: machine });
    const hydrated = new Map(), exemplars = new Map();
    const role = roleFixture('DEFECT');
    const memory = createDefectMemory({ repository: createDefectMemoryRepository({ boundary: machine, learningEnabled: true, learningBindings: role.bindings }),
      hydrate: card => hydrated.get(card.cardId), createExemplar: input => exemplars.get(input.card.cardId)(input) });
    async function provision(options = {}) {
      const f = fixtures(options); hydrated.set(f.cardId, await f.hydrate()); exemplars.set(f.cardId, f.createExemplar);
      f.saved = await connection.repository.provision(staff, { cardId: f.cardId, draft: f.draft }); return f;
    }
    async function confirm(f, actionId = randomUUID()) {
      const current = (await connection.repository.load(staff, f.cardId)).card;
      return connection.repository.commit(staff, { cardId: f.cardId,
        input: { actionId, expectedRevision: current.revision, action: { type: 'CONFIRM_FINDINGS', reviewed: true, base: f.base } },
        baseHash: current.contentHash, draft: current.draft });
    }
    const a = await provision(), b = await provision({ originalHashes: [digest('target-front'), digest('target-back')] });
    const committed = await confirm(a);
    const [record] = await fixture.admin.$queryRawUnsafe('SELECT * FROM atlas_manual.learning_publication_job WHERE card_id=$1::uuid', a.cardId);
    assert.equal(record.actor_id, principal.id); assert.equal(record.access_version, principal.accessVersion); assert.equal(record.state, 'QUEUED');
    await assert.rejects(manualClient.$executeRawUnsafe('UPDATE atlas_manual.learning_publication_job SET access_version=access_version+1 WHERE card_id=$1::uuid', a.cardId), /immutable/);
    assert.equal((await memory.retrieve(staff, { cardId: b.cardId })).freshness.unavailableSources, 1);
    checks.push('confirmation and queue intent commit together; captured reviewer version is immutable; pending source does not block baseline dispatch');
    const claimed = await Promise.all([queue.claim(1), queue.claim(1)]), job = claimed.find(Boolean);
    assert.equal(claimed.filter(Boolean).length, 1); assert.equal(job.actionId, committed.receipt.actionId);
    assert.equal(await queue.renew(job), true);
    assert.equal(await queue.finish({ ...job, claimId: randomUUID() }, { state: 'HELD', code: 'MEMORY_SYNTHETIC_HOLD' }), false);
    const authority = machine.machineOwner({ ownerId: job.actorId, accessVersion: job.accessVersion });
    const prepared = await memory.prepare(authority, job.cardId, job.actionId);
    assert.equal(prepared.publication.status, 'PUBLISHED');
    assert.equal(await queue.finish(job, { state: 'PREPARED', feedback: prepared.feedback }), true);
    const status = await memory.status(staff, a.cardId);
    assert.equal(status.feedbackStatus, 'SAVED'); assert.equal(status.preparationStatus, 'PREPARED'); assert.equal(status.activationStatus, 'INACTIVE');
    await assert.rejects(manualClient.$executeRawUnsafe("UPDATE atlas_manual.learning_publication_job SET feedback='{}',feedback_hash=$2 WHERE card_id=$1::uuid",
      a.cardId, digest('{}')), /immutable/);
    assert.equal((await memory.retrieve(staff, { cardId: b.cardId })).lessons.length, 0);
    const [legacyRows] = await fixture.admin.$queryRawUnsafe('SELECT count(*)::int AS count FROM atlas_manual.defect_memory_publication WHERE card_id=$1::uuid', a.cardId);
    assert.equal(legacyRows.count, 0);
    const legacy = createDefectMemory({ repository: createDefectMemoryRepository({ boundary: machine }),
      hydrate: card => hydrated.get(card.cardId), createExemplar: input => exemplars.get(input.card.cardId)(input) });
    const legacyRead = await legacy.retrieve(staff, { cardId: b.cardId });
    assert.equal(legacyRead.lessons.length, 0); assert.equal(legacyRead.status, 'PUBLICATION_PENDING');
    checks.push('one global lease, renewal and stale-finish fencing; prepared candidates remain inactive against frozen baseline');
    checks.push('legacy binary retrieval cannot see new candidate documents, even against the migrated database');
    const [publication] = await fixture.admin.$queryRawUnsafe('SELECT revision,document_hash FROM atlas_manual.learning_publication WHERE card_id=$1::uuid', a.cardId);
    const revision = Number(publication.revision), releaseId = `fixture-${randomUUID()}`;
    const manifest = canonical({ version: 'atlas-learning-release-v1', kind: 'SYNTHETIC_FIXTURE_ONLY', policy: 'legacy-defect-family-v1',
      publications: [{ revision, sha256: publication.document_hash }] });
    await fixture.admin.$transaction(async tx => {
      await tx.$executeRawUnsafe('INSERT INTO atlas_manual.learning_release(id,manifest,manifest_hash) VALUES($1,$2,$3)', releaseId, manifest, digest(manifest));
      await tx.$executeRawUnsafe('INSERT INTO atlas_manual.learning_release_member(release_id,publication_revision) VALUES($1,$2)', releaseId, revision);
      await tx.$queryRawUnsafe("SELECT set_config('atlas.learning_change_reason','Owned synthetic fixture activation',true)");
      await tx.$executeRawUnsafe('UPDATE atlas_manual.learning_control SET active_release_id=$1 WHERE singleton', releaseId);
    });
    const retrieved = await memory.retrieve(staff, { cardId: b.cardId });
    assert.equal(retrieved.lessons.length, 2); assert.equal(retrieved.freshness.activeReleaseId, releaseId);
    assert.equal((await memory.status(staff, a.cardId)).activationStatus, 'ACTIVE');
    const registry = seal({ version: 'atlas-learning-identity-registry-v1', auditSha256: digest('owned synthetic registry'),
      cards: [a, b].map(f => ({ cardId: f.cardId, specimenId: f.cardId, familyId: 'synthetic family', designId: 'synthetic design',
        originalSha256: ['FRONT', 'BACK'].map(s => f.geometry.sides[s].image.originalSha256) })) });
    const { sha256: _quality, ...qualityBody } = role.quality;
    const quality = seal({ ...qualityBody, reviewers: qualityBody.reviewers.map(r => ({ ...r, actorId: principal.id })) });
    const { sha256: _policy, ...policyBody } = role.policy;
    const policy = seal({ ...policyBody, registrySha256: registry.sha256, reviewerQualitySha256: quality.sha256 });
    const scopedId = `fixture-scope-${randomUUID()}`, scopedManifest = canonical({ ...JSON.parse(manifest),
      learningScopes: { DEFECT: { policy, registry, quality } } }, { maxBytes: 16777216 });
    await fixture.admin.$transaction(async tx => {
      await tx.$executeRawUnsafe('INSERT INTO atlas_manual.learning_release(id,manifest,manifest_hash) VALUES($1,$2,$3)', scopedId, scopedManifest, digest(scopedManifest));
      await tx.$executeRawUnsafe('INSERT INTO atlas_manual.learning_release_member(release_id,publication_revision) VALUES($1,$2)', scopedId, revision);
      await tx.$queryRawUnsafe("SELECT set_config('atlas.learning_change_reason','Owned synthetic role scope',true)");
      await tx.$executeRawUnsafe('UPDATE atlas_manual.learning_control SET active_release_id=$1 WHERE singleton', scopedId);
    });
    const roleTarget = { cardId: b.cardId, side: null, originalSha256: registry.cards[1].originalSha256 };
    const roleRead = await boundary.transaction(staff, ({ tx }) => readRoleLearning(tx, { domain: 'DEFECT', target: roleTarget, bindings: role.bindings, now: role.now }));
    assert.equal(roleRead.selection.status, 'READY'); assert.equal(roleRead.selection.examples.length, 1);
    const expired = await boundary.transaction(staff, ({ tx }) => readRoleLearning(tx, { domain: 'DEFECT', target: roleTarget,
      bindings: role.bindings, now: Date.parse('2027-01-01') }));
    assert.equal(expired.selection.reason, 'POLICY_EXPIRED'); assert.equal(expired.selection.examples.length, 0);
    checks.push('active role SQL reads immutable prepared feedback only; audited specimen/quality quota applies; expired policy records baseline fallback');
    const isolatedId = `fixture-domain-${randomUUID()}`, isolatedManifest = canonical({ ...JSON.parse(scopedManifest),
      learningMembership: { DEFECT: [], CLEAN: [revision], GEOMETRY: [] } });
    await fixture.admin.$transaction(async tx => {
      await tx.$executeRawUnsafe('INSERT INTO atlas_manual.learning_release(id,manifest,manifest_hash) VALUES($1,$2,$3)', isolatedId, isolatedManifest, digest(isolatedManifest));
      await tx.$executeRawUnsafe('INSERT INTO atlas_manual.learning_release_member(release_id,publication_revision) VALUES($1,$2)', isolatedId, revision);
      await tx.$queryRawUnsafe("SELECT set_config('atlas.learning_change_reason','Owned synthetic domain isolation',true)");
      await tx.$executeRawUnsafe('UPDATE atlas_manual.learning_control SET active_release_id=$1 WHERE singleton', isolatedId);
    });
    assert.equal((await memory.retrieve(staff, { cardId: b.cardId })).lessons.length, 0);
    const isolatedRole = await boundary.transaction(staff, ({ tx }) => readRoleLearning(tx, { domain: 'DEFECT', target: roleTarget, bindings: role.bindings, now: role.now }));
    assert.equal(isolatedRole.selection.examples.length, 0);
    checks.push('domain membership prevents clean-only admission of a mixed publication from activating sibling defect lessons in either retrieval path');
    await assert.rejects(manualClient.$executeRawUnsafe("UPDATE atlas_manual.learning_control SET active_release_id='baseline-20260928'"));
    await fixture.admin.$executeRawUnsafe('INSERT INTO atlas_manual.learning_withdrawal(publication_revision,actor_id,reason) VALUES($1,$2::uuid,$3)',
      revision, principal.id, 'Owned synthetic fixture withdrawal');
    assert.equal((await memory.retrieve(staff, { cardId: b.cardId })).lessons.length, 0);
    const c = await provision({ originalHashes: [digest('deletion-front'), digest('deletion-back')] });
    const cConfirmed = await confirm(c), cJob = await queue.claim(1);
    assert.equal(cJob.cardId, c.cardId);
    const cPrepared = await memory.prepare(machine.machineOwner({ ownerId: cJob.actorId, accessVersion: cJob.accessVersion }), c.cardId, cConfirmed.receipt.actionId);
    await queue.finish(cJob, { state: 'PREPARED', feedback: cPrepared.feedback });
    const [cPublication] = await fixture.admin.$queryRawUnsafe('SELECT revision,document_hash FROM atlas_manual.learning_publication WHERE card_id=$1::uuid', c.cardId);
    const deletionRelease = `fixture-${randomUUID()}`, deletionManifest = canonical({ version: 'atlas-learning-release-v1',
      kind: 'SYNTHETIC_FIXTURE_ONLY', policy: 'legacy-defect-family-v1', publications: [{ revision: Number(cPublication.revision), sha256: cPublication.document_hash }] });
    await fixture.admin.$transaction(async tx => {
      await tx.$executeRawUnsafe('INSERT INTO atlas_manual.learning_release(id,manifest,manifest_hash) VALUES($1,$2,$3)', deletionRelease, deletionManifest, digest(deletionManifest));
      await tx.$executeRawUnsafe('INSERT INTO atlas_manual.learning_release_member(release_id,publication_revision) VALUES($1,$2)', deletionRelease, Number(cPublication.revision));
      await tx.$queryRawUnsafe("SELECT set_config('atlas.learning_change_reason','Owned synthetic deletion fixture',true)");
      await tx.$executeRawUnsafe('UPDATE atlas_manual.learning_control SET active_release_id=$1 WHERE singleton', deletionRelease);
    });
    assert.equal((await memory.retrieve(staff, { cardId: b.cardId })).lessons.length, 2);
    const createId = randomUUID(), discardId = randomUUID();
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'Owned synthetic discard')`, c.cardId, randomUUID(), principal.id, createId, digest('fixture-create'));
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discard_request(owner_id,request_id,request,request_hash,receipt,receipt_hash)
      VALUES($1::uuid,$2::uuid,'{}',$3,'{}',$3)`, principal.id, discardId, digest('{}'));
    await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_manual_intake.discarded_card(owner_id,create_request_id,card_id,request_id)
      VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, principal.id, createId, c.cardId, discardId);
    assert.equal((await memory.retrieve(staff, { cardId: b.cardId })).lessons.length, 0);
    checks.push('explicit publication withdrawal and actual workspace deletion each remove previously active lessons without erasing immutable history');
    const newer = await confirm(a), hidden = await memory.retrieve(staff, { cardId: b.cardId });
    assert.equal(hidden.lessons.length, 0); assert.equal(hidden.status, 'EMPTY_REVIEWED_BANK'); assert.equal(hidden.freshness.unavailableSources, 1);
    checks.push('explicit immutable release enables eligible lessons; serving role cannot activate; newer pending confirmation excludes only superseded source');
    const crashJob = await queue.claim(1); assert.equal(crashJob.actionId, newer.receipt.actionId);
    await fixture.admin.$executeRawUnsafe("UPDATE atlas_manual.learning_publication_job SET lease_until=clock_timestamp()-interval '1 second' WHERE card_id=$1::uuid AND action_id=$2::uuid", crashJob.cardId, crashJob.actionId);
    const restarted = createLearningPublicationRepository({ boundary: machine }), reclaimed = await restarted.claim(1);
    assert.notEqual(reclaimed.claimId, crashJob.claimId); assert.equal(reclaimed.attempts, 2);
    assert.equal(await queue.finish(crashJob, { state: 'SUPERSEDED' }), false);
    const restartedAuthority = machine.machineOwner({ ownerId: reclaimed.actorId, accessVersion: reclaimed.accessVersion });
    await fixture.admin.$executeRawUnsafe('UPDATE atlas_staff."StaffIdentity" SET "accessVersion"="accessVersion"+1 WHERE id=$1::uuid', principal.id);
    await assert.rejects(memory.prepare(restartedAuthority, reclaimed.cardId, reclaimed.actionId), { code: 'MANUAL_MACHINE_ACCESS_REVOKED' });
    await restarted.finish(reclaimed, { state: 'HELD', code: 'MANUAL_MACHINE_ACCESS_REVOKED' });
    const [held] = await fixture.admin.$queryRawUnsafe('SELECT state FROM atlas_manual.learning_publication_job WHERE card_id=$1::uuid AND action_id=$2::uuid', reclaimed.cardId, reclaimed.actionId);
    assert.equal(held.state, 'HELD');
    checks.push('new process reclaims expired lease; stale process cannot finish; explicit reviewer-version revocation holds unpublished work');
    const [grants] = await fixture.admin.$queryRawUnsafe(`SELECT has_table_privilege('atlas_fixture_manual','atlas_manual.learning_control','UPDATE') activate,
      has_table_privilege('atlas_fixture_manual','atlas_manual.learning_publication_job','DELETE') delete_job,
      has_table_privilege('atlas_fixture_manual','atlas_staff."StaffIdentity"','SELECT') staff_read`);
    assert.deepEqual(grants, { activate: false, delete_job: false, staff_read: false });
    const receipt = { status: 'LEARNING_POSTGRES_PASS', productionEffects: false, checks };
    await writeFile(join(output, 'learning-postgres.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 }); return receipt;
  } finally { await connection.close(); }
}
