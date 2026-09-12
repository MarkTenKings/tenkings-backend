import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnectedManual, DEFAULT_LIMITS } from '../src/index.mjs';
import { createConnectedHandler } from '../src/http.mjs';
import { geometryBase, geometryStatus } from '@atlas/manual-workspace/geometry-actions';
import { defectBase, defectStatus } from '@atlas/manual-workspace/defect-actions';
import { memoryPhotoStorage, sha } from '../../atlas-manual-intake/test/helpers.mjs';
import { traceAction } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';

test('cold connected composition accepts explicit resource configuration without dispatch or database work', () => {
  let calls = 0;
  const boundary = { transaction() { calls++; throw new Error('Unexpected database work'); } };
  const { storage } = memoryPhotoStorage();
  const connected = createConnectedManual({ boundary, storage, artifacts: {}, keyPrefix: 'intake',
    pythonExecutable: '/synthetic/not-invoked/python', receiptClient: { $queryRawUnsafe() { calls++; } },
    effects: { async ocr() { calls++; throw new Error('Unexpected OCR'); }, async model() { calls++; throw new Error('Unexpected model'); } } });
  assert.equal(calls, 0); assert.equal(typeof connected.intake.create, 'function');
  assert.equal(typeof connected.workflow.service.execute, 'function');
  assert.equal(typeof connected.initialize, 'function');
});

/** Invoked only by the explicit ownership-checked native runner. This exercises
 * the actual connected composition, HTTP/auth boundary, storage verifiers and
 * CPU engines. Synthetic SMS and exact-byte SDK storage never make paid calls.
 */
export async function runConnectedIntegration({ fixture, pythonExecutable, output }) {
  const checks = [], record = (name, evidence = true) => checks.push({ name, evidence });
  const connection = fixture.connect(), { boundary } = connection;
  const { storage, objects } = memoryPhotoStorage();
  let afterArtifactWrite = null;
  const artifacts = { read: (...args) => fixture.artifacts.read(...args), async write(...args) {
    const result = await fixture.artifacts.write(...args); if (afterArtifactWrite) await afterArtifactWrite(args[1]); return result;
  } };
  const shared = { boundary, storage, artifacts, keyPrefix: 'intake', pythonExecutable,
    receiptClient: connection.manualClient };
  const connected = createConnectedManual(shared);
  const fallback = createConnectedManual({ ...shared, limits: { ...DEFAULT_LIMITS,
    preparation: { ...DEFAULT_LIMITS.preparation, maxPixels: 1 } } });
  const handler = createConnectedHandler({ connected, boundary, origin: fixture.config.origin,
    assertRequest: async req => { assert.equal(req.fixtureHost, true); } });
  const denied = (promise, code) => assert.rejects(promise, error => error.code === code);
  async function login(phone) {
    const boot = await connection.auth.bootstrap(''), cookie = `${fixture.config.cookies.browser}=${boot.browserToken}`;
    const challenge = await connection.auth.send(cookie, boot.csrf, { phone, requestId: randomUUID() }, 'fixture-connected');
    const verified = await connection.auth.verify(cookie, boot.csrf, { challengeId: challenge.challengeId, code: '424242' }, 'fixture-connected');
    const signedCookie = `${cookie}; ${fixture.config.cookies.session}=${verified.token}`;
    return { cookie: signedCookie, csrf: verified.csrf, staff: await connection.auth.authenticate(signedCookie, verified.csrf) };
  }
  async function request(login, url, body = undefined) {
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; },
      status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; }, send(value) { this.body = value; } };
    const handled = await handler({ url, method: body === undefined ? 'GET' : 'POST', body, fixtureHost: true,
      headers: { cookie: login.cookie, origin: fixture.config.origin, 'content-type': 'application/json', 'x-atlas-csrf': login.csrf } }, res);
    assert.equal(handled, true); return res;
  }
  const imagesDirectory = join(fixture.cluster.directory, 'connected-synthetic-images');
  await mkdir(imagesDirectory, { mode: 0o700 });
  execFileSync(pythonExecutable, [fileURLToPath(new URL('../../atlas-manual-workspace/scripts/generate-preview.py', import.meta.url)), imagesDirectory],
    { timeout: 30000, stdio: 'pipe' });
  const samples = JSON.parse(await readFile(join(imagesDirectory, 'fixture.json')));
  const bytes = Object.fromEntries(await Promise.all(['FRONT', 'BACK'].map(async side => [side, await readFile(join(imagesDirectory, `${side.toLowerCase()}-original.png`))])));
  const owner = await login('+12025550141'), other = await login('+12025550143');
  const created = await connected.intake.create(owner.staff, { requestId: randomUUID(), label: 'Connected native fixture' }), cardId = created.card.cardId;
  const base = `/api/staff/manual-connected/cards/${cardId}`, manual = connected.workflow.service;
  async function upload(side, expectedVersion, { prepare = true } = {}) {
    const result = await connected.intake.plan(owner.staff, cardId, { requestId: randomUUID(), side, expectedVersion,
      sha256: sha(bytes[side]), byteCount: bytes[side].length });
    if (prepare) {
      await storage.writeOriginal({ uploadPlan: result.upload.plan, bytes: bytes[side] });
      await connected.intake.complete(owner.staff, cardId, result.upload.uploadId);
      return connected.intake.prepare(owner.staff, cardId, result.upload.uploadId);
    }
    return result;
  }
  async function state() { const card = await manual.read(owner.staff, cardId); return { card, ...(await connected.workflow.hydrate(card)) }; }
  async function execute(action, options = {}) {
    const card = await manual.read(owner.staff, cardId);
    return manual.execute(owner.staff, cardId, { actionId: options.actionId ?? randomUUID(), expectedRevision: card.revision, action });
  }
  async function confirmGeometry() {
    const { geometry } = await state();
    return execute({ type: 'CONFIRM_GEOMETRY', reviewed: true,
      base: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, geometryBase(geometry, side, 'REVIEW')])) });
  }
  async function inspectAndConfirm() {
    for (const side of ['FRONT', 'BACK']) {
      const { defects } = await state();
      if (!defects.sides[side].inspection) await execute({ type: 'INSPECT_SIDE', side, inspected: true, base: defectBase(defects, side) });
    }
    const { defects } = await state();
    return execute({ type: 'CONFIRM_FINDINGS', reviewed: true,
      base: Object.fromEntries(['FRONT', 'BACK'].map(side => [side, defectBase(defects, side)])) });
  }
  try {
    await Promise.all([upload('FRONT', 0), upload('BACK', 0)]);
    const pair = await connected.intake.verifiedPair(owner.staff, cardId);
    assert(pair.sourceHash); assert.equal((await connected.open(owner.staff, cardId)).manual, null);
    assert.equal((await request(other, base)).statusCode, 404);
    const open = await connected.open(owner.staff, cardId);
    const detailsCommand = { actionId: randomUUID(), expectedRevision: open.revision,
      changes: { name: 'Synthetic Player', year: '2026', manufacturer: 'Fixture', set_name: 'Connected test', card_number: '19',
        category: 'Sports cards', profile: 'SPORTS', cornerShape: 'SQUARE', matColor: 'BLACK' } };
    const details = await request(owner, `${base}/details`, detailsCommand);
    assert.equal(details.statusCode, 200);
    record('actual staff auth, native pair verification/rich+SDR storage, per-card HTTP denial and canonical details before initialization');

    const initialized = await fallback.initialize(owner.staff, cardId, { sourceHash: pair.sourceHash, detailsRevision: details.body.revision });
    assert.equal(initialized.card.draft.version, 'atlas-manual-workflow-v2'); assert.equal(initialized.card.draft.defects, null);
    const initialState = await state();
    for (const side of ['FRONT', 'BACK']) {
      assert.equal(initialState.geometry.sides[side].physical, null); assert.equal(initialState.geometry.sides[side].prepared, null);
    }
    await denied(manual.previewReport(owner.staff, cardId), 'MANUAL_GEOMETRY_REVIEW_REQUIRED');
    record('preparation-resource refusal saves truthful manual geometry fallback with no invented outline, preparation, defects or report');

    for (const side of ['FRONT', 'BACK']) {
      const { geometry } = await state();
      await execute({ type: 'GEOMETRY_EDIT', edit: { side, kind: 'PHYSICAL', base: geometryBase(geometry, side, 'PHYSICAL'), quad: samples[side].physical } });
      await execute({ type: 'PREPARE_SIDE', side });
      const prepared = (await state()).geometry;
      assert(prepared.sides[side].prepared);
      // A human can also set a printed border when automatic proposal has no
      // accepted result; manual tool authority never fabricates engine success.
      await execute({ type: 'GEOMETRY_EDIT', edit: { side, kind: 'PRINTED', base: geometryBase(prepared, side, 'PRINTED'), quad: samples[side].printed } });
    }
    await confirmGeometry();
    const preparedState = await state(); assert(geometryStatus(preparedState.geometry).confirmed); assert(preparedState.defects);
    const descriptors = await connected.imageDescriptors({ ...preparedState, state: preparedState, staff: owner.staff });
    for (const side of ['FRONT', 'BACK']) {
      const image = await connected.image(owner.staff, cardId, side, 'inspection', descriptors[side].inspection.sha256);
      assert.equal(sha(image.bytes), descriptors[side].inspection.sha256);
    }
    record('actual saved human outlines, CPU preparation and stored derivative readback; paired geometry confirmation enables manual findings');

    const earlierDetails = await connected.details.read(owner.staff, cardId);
    const refused = await request(owner, `${base}/details`, { actionId: randomUUID(), expectedRevision: earlierDetails.revision,
      changes: { name: 'Must not silently change report' } });
    assert.equal(refused.statusCode, 409); assert.equal(refused.body.error, 'MANUAL_USE_WORKSPACE_IDENTITY');
    await denied(connected.details.save(owner.staff, cardId, { actionId: randomUUID(), expectedRevision: earlierDetails.revision,
      changes: { name: 'Store must independently enforce the same authority' } }), 'MANUAL_USE_WORKSPACE_IDENTITY');
    assert.deepEqual(await connected.details.save(owner.staff, cardId, detailsCommand), details.body);
    const detailsReplay = await request(owner, `${base}/details`, detailsCommand);
    assert.equal(detailsReplay.statusCode, 200); assert.deepEqual(detailsReplay.body, details.body);
    const beforeIdentity = await state();
    await execute({ type: 'IDENTITY_EDIT', identity: { ...beforeIdentity.card.draft.identity, playerName: 'Reviewed Fixture Player' } });
    assert.equal((await state()).card.draft.identity.playerName, 'Reviewed Fixture Player');
    assert.deepEqual((await state()).defects, beforeIdentity.defects);
    record('post-initialization HTTP and in-transaction store details edits refused, historical action replay retained; versioned authoritative manual identity edit preserves valid findings');

    const currentDefects = (await state()).defects, trace = traceAction('BACK', null, [620, 640, 10, 12], 'BACK:connected-human-trace');
    const staged = await connected.workflow.stageTrace(owner.staff, cardId, { side: 'BACK', base: defectBase(currentDefects, 'BACK'),
      findingId: null, trace: trace.trace });
    await execute(staged); await execute({ type: 'MEASURE_SIDE', side: 'BACK' });
    let measured = await state();
    assert.equal(measured.defects.sides.BACK.findings.length, 1); assert(measured.defects.sides.BACK.measurement);
    await inspectAndConfirm(); measured = await state(); assert(defectStatus(measured.defects).confirmed);
    const preview = await manual.previewReport(owner.staff, cardId), approvalAction = randomUUID();
    const approved = await execute({ type: 'APPROVE_REPORT', reportHash: preview.reportHash, reviewed: true }, { actionId: approvalAction });
    assert.equal(approved.receipt.approval.sourceHash, measured.card.contentHash);
    const savedApproval = await manual.readApproval(owner.staff, cardId, approvalAction);
    assert.equal(savedApproval.reportHash, preview.reportHash);
    record('actual staged trace and checked CPU Back measurement, findings confirmation and separate exact trained-human approval');

    const beforeReplace = await state(), backGeometry = beforeReplace.geometry.sides.BACK, backDefects = beforeReplace.defects.sides.BACK;
    const savedBackSource = beforeReplace.card.draft.source.prepared.BACK;
    await upload('FRONT', 1, { prepare: false }); // unfinished version2 is retained
    await upload('FRONT', 2); // directly adopt current verified version3
    const newer = await connected.intake.verifiedPair(owner.staff, cardId);
    assert.notEqual(newer.sourceHash, pair.sourceHash);
    await denied(manual.previewReport(owner.staff, cardId), 'MANUAL_PHOTOS_CHANGED');
    await denied(execute({ type: 'APPROVE_REPORT', reportHash: preview.reportHash, reviewed: true }), 'MANUAL_PHOTOS_CHANGED');
    await denied(execute({ type: 'IDENTITY_EDIT', identity: beforeReplace.card.draft.identity }), 'INTAKE_PAIR_STALE');
    assert.deepEqual(await manual.readApproval(owner.staff, cardId, approvalAction), savedApproval);
    const replacement = await execute({ type: 'REPLACE_SOURCES', sourceHash: newer.sourceHash });
    const afterReplace = await state(); assert.equal(afterReplace.geometry.sides.FRONT.image.version, 3);
    assert.deepEqual(afterReplace.geometry.sides.BACK, backGeometry);
    assert.deepEqual(afterReplace.defects.sides.BACK, backDefects);
    assert.deepEqual(afterReplace.card.draft.source.prepared.BACK, savedBackSource);
    assert.equal(afterReplace.card.draft.identity.playerName, 'Reviewed Fixture Player');
    assert.equal(geometryStatus(afterReplace.geometry).confirmed, false);
    assert.notEqual(replacement.card.contentHash, savedApproval.sourceHash);
    assert.deepEqual(await manual.readApproval(owner.staff, cardId, approvalAction), savedApproval);
    record('Front version1→3 replacement across skipped upload preserves exact Back geometry, measured finding, inspection and prepared artifacts; old report/ordinary actions fenced and approval history retained');

    // Preparation may legitimately need manual geometry again. Either result
    // must preserve Back and prevent approval until current Front is reviewed.
    let changed = await state();
    if (!changed.geometry.sides.FRONT.physical) {
      await execute({ type: 'GEOMETRY_EDIT', edit: { side: 'FRONT', kind: 'PHYSICAL',
        base: geometryBase(changed.geometry, 'FRONT', 'PHYSICAL'), quad: samples.FRONT.physical } });
    }
    changed = await state();
    if (!changed.geometry.sides.FRONT.prepared) await execute({ type: 'PREPARE_SIDE', side: 'FRONT' });
    changed = await state();
    if (!changed.geometry.sides.FRONT.printed) await execute({ type: 'GEOMETRY_EDIT', edit: { side: 'FRONT', kind: 'PRINTED',
      base: geometryBase(changed.geometry, 'FRONT', 'PRINTED'), quad: samples.FRONT.printed } });
    assert.deepEqual((await state()).defects.sides.BACK, backDefects);
    await confirmGeometry(); await inspectAndConfirm();
    const currentPreview = await manual.previewReport(owner.staff, cardId);
    assert.notEqual(currentPreview.sourceHash, savedApproval.sourceHash);
    await denied(execute({ type: 'APPROVE_REPORT', reportHash: preview.reportHash, reviewed: true }), 'MANUAL_REPORT_STALE');
    await execute({ type: 'APPROVE_REPORT', reportHash: currentPreview.reportHash, reviewed: true });
    assert.deepEqual(await manual.readApproval(owner.staff, cardId, approvalAction), savedApproval);
    const approvals = await fixture.admin.$queryRawUnsafe('SELECT source_hash,report_hash FROM atlas_manual.approval WHERE card_id=$1::uuid ORDER BY source_revision', cardId);
    assert.equal(approvals.length, 2); assert.notEqual(approvals[0].source_hash, approvals[1].source_hash);
    const commercial = await fixture.admin.$queryRawUnsafe('SELECT count(*)::int AS count FROM public."CollectibleCardV2"');
    assert.equal(commercial[0].count, 0);
    record('new source requires current review/exact new report approval; both approvals immutable; no permanent card/company inventory created', { objectCount: objects.size });

    let entered, release;
    const enteredGate = new Promise(done => { entered = done; }), releaseGate = new Promise(done => { release = done; });
    afterArtifactWrite = async source => { if (source.kind === 'REPORT') { entered(); await releaseGate; } };
    const racing = execute({ type: 'APPROVE_REPORT', reportHash: currentPreview.reportHash, reviewed: true });
    // BuildReport has already authenticated the old source and generated/stored
    // the exact report when this gate opens; only the commit guard remains.
    await enteredGate;
    await upload('FRONT', 3, { prepare: false });
    release(); await denied(racing, 'INTAKE_PAIR_STALE'); afterArtifactWrite = null;
    const afterRace = await fixture.admin.$queryRawUnsafe('SELECT count(*)::int AS count FROM atlas_manual.approval WHERE card_id=$1::uuid', cardId);
    assert.equal(afterRace[0].count, 2); assert.deepEqual(await manual.readApproval(owner.staff, cardId, approvalAction), savedApproval);
    record('photo replacement after report generation but before approval commit is fenced by the actual same-transaction source guard; no third approval saved');

    await writeFile(join(output, 'connected-result.json'), JSON.stringify({ status: 'PASS', checks, cardId,
      sourceHash: newer.sourceHash, originalApprovalHash: savedApproval.reportHash, currentReportHash: currentPreview.reportHash }, null, 2));
    return { status: 'PASS', assertions: checks.length, checks };
  } catch (error) {
    await writeFile(join(output, 'connected-failure.json'), JSON.stringify({ code: error.code, message: error.message, stack: error.stack, checks }, null, 2));
    throw error;
  } finally { await connection.close(); }
}
