import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualFinishing } from '../src/finishing.mjs';
import { publicationFixture } from './publication-fixture.mjs';
import { canonical, digest } from '@atlas/manual-service/contract';

async function fixture() {
  const f = await publicationFixture(); await f.publication.publish({}, f.cardId, f.actionId);
  let loads = 0; const actualLoad = f.repository.load;
  const repository = { load: async (...args) => { loads++; return structuredClone(await actualLoad(...args)); } };
  return { ...f, repository, loader: createManualFinishing({ repository, artifacts: f.artifacts }), loads: () => loads };
}
test('authenticated immutable approval becomes exact repeatable label and paired intents', async () => {
  const f = await fixture(), before = structuredClone(f.row), plan = await f.loader.load({}, f.cardId, f.actionId);
  assert.equal(f.loads(), 2); assert.equal(plan.binding.approvalActionId, f.actionId); assert.equal(plan.binding.sourceHash, f.row.source_hash);
  assert.equal(plan.binding.publicHash, f.row.public_hash); assert.equal(plan.label.finalGrade, f.full.finalGrade); assert.deepEqual(plan.label.identity, f.full.identity);
  assert.deepEqual(await f.loader.load({}, f.cardId, f.actionId), plan); assert.deepEqual(f.row, before);
  assert.equal(JSON.stringify(plan).includes('private/'), false); assert.equal(JSON.stringify(plan).includes('actorId'), false);
});
test('private packet loader retains the same immutable source and reauthenticates without preparing output', async () => {
  const f = await fixture(), before = structuredClone(f.row);
  const source = await f.loader.loadPacket({}, f.cardId, f.actionId);
  assert.equal(f.loads(), 2); assert.equal(source.publicHash, f.row.public_hash);
  assert.equal(digest(JSON.stringify(source.packet)), source.publicHash);
  assert.equal(source.packet.reportHash, f.row.report_hash); assert.deepEqual(source.row, before);
  assert.equal(source.packet.report.finalGrade, f.full.finalGrade); assert.equal(source.print, undefined);
  assert.deepEqual(f.row, before);
});
test('unpublished, changed manifest or approval source refuses finishing before output', async () => {
  for (const change of [f => { f.row.state = 'PENDING'; }, f => { f.row.manifest_hash = 'f'.repeat(64); }, f => { f.row.report_hash = '0'.repeat(64); }]) {
    const f = await fixture(); change(f);
    for (const method of ['load', 'loadPacket']) await assert.rejects(f.loader[method]({}, f.cardId, f.actionId));
  }
});
test('packet must remain bound to the actual approval even if a new object hash is supplied', async () => {
  const f = await fixture(), manifest = JSON.parse(f.row.manifest);
  const raw = await f.artifacts.read(manifest.packet.ref, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash: manifest.packet.sourceHash });
  raw.report.identity.playerName = 'Different card'; const sourceHash = digest(JSON.stringify(raw));
  const ref = await f.artifacts.write(raw, { cardId: f.cardId, kind: 'PUBLIC_REPORT', sourceHash });
  manifest.packet = { ref, sourceHash }; manifest.publicHash = sourceHash; f.row.public_hash = sourceHash;
  f.row.manifest = canonical(manifest); f.row.manifest_hash = digest(f.row.manifest);
  await assert.rejects(f.loader.load({}, f.cardId, f.actionId), { code: 'MANUAL_FINISHING_APPROVAL_MISMATCH' });
  await assert.rejects(f.loader.loadPacket({}, f.cardId, f.actionId), { code: 'MANUAL_FINISHING_APPROVAL_MISMATCH' });
});
test('revoked access or changed published authority during artifact read prevents label output', async () => {
  for (const method of ['load', 'loadPacket']) for (const revoked of [true, false]) {
    const f = await fixture(); let calls = 0;
    const repository = { load: async (...args) => { const row = await f.repository.load(...args); if (++calls === 2) {
      if (revoked) throw Object.assign(new Error('Access revoked'), { status: 403 }); row.source_hash = 'a'.repeat(64);
    } return row; } };
    await assert.rejects(createManualFinishing({ repository, artifacts: f.artifacts })[method]({}, f.cardId, f.actionId));
    assert.equal(calls, 2);
  }
});
