// Explicit owned local PostgreSQL qualification; never accepts an ambient URL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createIntakeRepository, intakeGrantSQL } from '@atlas/manual-intake/repository';
import { createManualIntake } from '@atlas/manual-intake';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createDetailsStore, connectedGrantSQL, geometrySideSettings } from '../src/details.mjs';
import { createEarlyGeometryStore, recordEarlyGeometryIntent } from '../src/early-geometry-store.mjs';
import { geometryCacheInput } from '../src/early-geometry.mjs';
import { createConnectedManual } from '../src/index.mjs';
import { memoryPhotoStorage, sha } from '../../atlas-manual-intake/test/helpers.mjs';
import { rgb16Png } from '../../atlas-photo-runtime/test/helpers.mjs';

export async function runSideMatSettingsPostgres({ fixture, output, pythonExecutable }) {
  assert(fixture?.cluster?.directory && fixture.database.name.startsWith('atlas_'));
  const checks = [];
  for (const grants of [intakeGrantSQL, connectedGrantSQL]) await fixture.cluster.sql(grants('atlas_fixture_manual'), [], fixture.database.name);
  const connection = fixture.connect(), { boundary, manualClient, auth } = connection;
  let connected;
  try {
    const boot = await auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await auth.send(cookie, boot.csrf, { phone: '+12025550141', requestId: randomUUID() }, 'fixture-side-mat');
    const verified = await auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'fixture-side-mat');
    const staff = await auth.authenticate(`${cookie}; ${fixture.config.cookies.session}=${verified.token}`, verified.csrf);
    const { storage } = memoryPhotoStorage();
    const repository = createIntakeRepository({ boundary, keyPrefix: 'intake', maxOriginalBytes: 1000000, sourceCommitted: recordEarlyGeometryIntent });
    const processPhoto = createPhotoProcessor({ storage, keyPrefix: 'intake', decodeLimits: {
      maxInputBytes: 1000000, maxPixels: 1000000, maxRasterBytes: 8000000, maxOutputBytes: 1000000, timeoutMs: 10000 } });
    const intake = createManualIntake({ repository, storage, artifacts: fixture.artifacts, processPhoto });
    const details = createDetailsStore({ boundary, intakeRepository: repository });
    const store = createEarlyGeometryStore({ boundary, intakeRepository: repository, receiptClient: manualClient });
    const engine = { policy: 'atlas-early-photo-geometry-v1', runtime: { identity: { sources: {}, opencv: 'fixture' } }, limits: {} };
    const engineHash = digest(canonical(engine));
    const cardId = (await intake.create(staff, { requestId: randomUUID(), label: 'Mixed mat SQL fixture' })).card.cardId;
    const inputs = {};
    for (const side of ['FRONT','BACK']) {
      const bytes = rgb16Png(12, 16);
      const planned = await intake.plan(staff, cardId, { requestId: randomUUID(), side, expectedVersion: 0, sha256: sha(bytes), byteCount: bytes.length });
      await storage.writeOriginal({ uploadPlan: planned.upload.plan, bytes });
      await intake.complete(staff, cardId, planned.upload.uploadId);
      const result = await intake.prepare(staff, cardId, planned.upload.uploadId);
      const { photo } = await intake.readSource(staff, cardId, planned.upload.uploadId);
      inputs[side] = geometryCacheInput(result.upload, photo, (await details.read(staff, cardId)).details, engine);
      assert.equal(await store.stage(inputs[side]), true);
    }
    assert.equal((await store.pending(engineHash, null, 32)).length, 0);
    const existing = await fixture.admin.$queryRawUnsafe('SELECT key,input,state,result,attempts FROM atlas_manual_connected.early_geometry ORDER BY key');
    const prior = await details.read(staff, cardId);
    await details.save(staff, cardId, { actionId: randomUUID(), expectedRevision: prior.revision, changes: { frontMatColor: 'WHITE', backMatColor: 'BLACK' } });
    const pending = await store.pending(engineHash, null, 32);
    const legacy = await manualClient.$queryRawUnsafe('SELECT * FROM atlas_manual_connected.pending_early_geometry($1,NULL,NULL)', engineHash);
    for (const rows of [pending, legacy]) {
      assert.equal(rows.length, 1); assert.equal(rows[0].side, 'FRONT');
      assert.deepEqual(rows[0].settings, { matColor: 'WHITE', cornerShape: 'ROUNDED_3_18_MM' });
    }
    assert.equal(await store.stage(inputs.FRONT), false, 'stale pair-wide settings must fail the SQL queue fence');
    const front = { ...inputs.FRONT, settings: pending[0].settings };
    assert.equal(await store.stage(front), true); assert.equal(await store.stage(inputs.BACK), true);
    assert.equal((await store.pending(engineHash, null, 32)).length, 0);
    const rows = await fixture.admin.$queryRawUnsafe('SELECT key,input,state,result,attempts FROM atlas_manual_connected.early_geometry ORDER BY key');
    assert.equal(rows.length, 3); assert.deepEqual(rows.filter(r => existing.some(old => old.key === r.key)), existing);
    checks.push('both discovery interfaces and durable queue agree on side overrides; only Front changes and both historical jobs remain byte-for-byte unchanged');
    const current = await details.read(staff, cardId);
    const inherited = await details.save(staff, cardId, { actionId: randomUUID(), expectedRevision: current.revision,
      changes: { matColor: 'MAGENTA', frontMatColor: null } });
    const inheritedRows = await store.pending(engineHash, null, 32);
    assert.equal(inheritedRows.length, 1); assert.equal(inheritedRows[0].side, 'FRONT');
    assert.deepEqual(inheritedRows[0].settings, geometrySideSettings(inherited.details, 'FRONT'));
    assert.equal(inheritedRows[0].settings.matColor, 'MAGENTA'); assert.equal(await store.stage(front), false);
    assert.equal(geometrySideSettings(inherited.details, 'BACK').matColor, 'BLACK');
    checks.push('null override inherits the global mat without changing an explicit opposite-side override; stale queued payload is refused');
    const [privilege] = await fixture.admin.$queryRawUnsafe("SELECT has_function_privilege('atlas_fixture_manual','atlas_manual_connected.geometry_side_settings(jsonb,text)','EXECUTE') AS helper");
    assert.equal(privilege.helper, false);
    const forged = structuredClone(inputs.BACK); forged.photoSource.photoSourceHash = 'f'.repeat(64);
    assert.equal(await store.stage(forged), false);
    checks.push('new pure helper is not publicly/app-role executable; selected-source queue fence still refuses substituted evidence');
    const saved = await details.save(staff, cardId, { actionId: randomUUID(), expectedRevision: inherited.revision,
      changes: { frontMatColor: 'WHITE', profile: 'SPORTS', name: 'Synthetic Player', year: '2026', manufacturer: 'Fixture', set_name: 'Fixture' } });
    connected = createConnectedManual({ boundary, storage, artifacts: fixture.artifacts, keyPrefix: 'intake', pythonExecutable,
      receiptClient: manualClient });
    const pair = await intake.verifiedPair(staff, cardId);
    const initialized = await connected.initialize(staff, cardId, { sourceHash: pair.sourceHash, detailsRevision: saved.revision });
    const state = await connected.workflow.hydrate(initialized.card);
    assert.equal(state.geometry.sides.FRONT.matColor, 'WHITE'); assert.equal(state.geometry.sides.BACK.matColor, 'BLACK');
    assert.equal(initialized.card.draft.source.sourceHash, pair.sourceHash);
    await assert.rejects(details.save(staff, cardId, { actionId: randomUUID(), expectedRevision: saved.revision,
      changes: { backMatColor: 'WHITE' } }), { code: 'MANUAL_USE_WORKSPACE_IDENTITY' });
    const reread = await connected.initialize(staff, cardId, { sourceHash: pair.sourceHash, detailsRevision: saved.revision });
    assert.deepEqual(reread.card, initialized.card);
    checks.push('actual connected initialization adopts separate Front/Back mats; existing workspace is preserved and later details writes remain refused');
    const receipt = { status: 'PASS', productionEffects: false, checks, database: fixture.database.name };
    await writeFile(join(output, 'side-mat-postgres.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    return receipt;
  } finally { await connected?.earlyGeometry.stop(); await connection.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.env.ATLAS_SIDE_MAT_EVIDENCE, pythonExecutable = process.env.ATLAS_FIXTURE_PYTHON;
  assert(output && resolve(output) === output && pythonExecutable && resolve(pythonExecutable) === pythonExecutable);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const fixture = await createOwnedManualFixture(process.argv.slice(2));
  try { console.log(JSON.stringify(await runSideMatSettingsPostgres({ fixture, output, pythonExecutable }))); }
  finally { await fixture.stop(); }
}
