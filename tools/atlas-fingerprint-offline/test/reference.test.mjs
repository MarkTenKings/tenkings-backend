import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, lstat, chmod, symlink, link, unlink, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { importReference } from '../import-reference.mjs';
import { parseJson, LIMITS, validateImage } from '../contract.mjs';
import { fixture, sha, webpHeader } from './fixture.mjs';

const code = value => error => error.code === value;
async function use(work) { const f = await fixture(); try { await work(f); } finally { await f.dispose(); } }
async function census(directory) {
  const value = {};
  for (const name of ['manifest.json', 'packet.json', 'front.webp', 'back.webp']) {
    const path = join(directory, name), s = await lstat(path, { bigint: true });
    value[name] = { sha256: sha(await readFile(path)), mode: s.mode, size: s.size, mtime: s.mtimeNs, ctime: s.ctimeNs, links: s.nlink };
  } return value;
}

test('copied synthetic package validates exact bytes without changing source or claiming a match/grade/decode', async () => use(async f => {
  const before = await census(f.directory), result = await importReference(f.options);
  assert.deepEqual(await census(f.directory), before); assert.equal(result.status, 'REFERENCE_BYTES_VALIDATED');
  assert.equal(result.approval.publicHash, f.manifest.approval.publicHash); assert.equal(result.approval.version, 1);
  assert.deepEqual(result.decision, { outcome: 'UNAVAILABLE', reason: 'NO_MATCHER_IMPLEMENTED' });
  assert.equal(result.limits.originAuthority, 'HUMAN_DECLARED_NOT_VERIFIED'); assert.equal(result.limits.imageDecode, 'NOT_PERFORMED');
  assert.equal(result.limits.reportHash, 'COPIED_IDENTIFIER_ONLY'); assert.equal(result.limits.rawMasters, 'NOT_SUPPLIED');
  assert.equal(result.availability.traceAvailability, 'COMPLETE'); assert.equal(Object.hasOwn(result, 'grade'), false);
  assert(Object.isFrozen(result) && Object.isFrozen(result.artifacts.images.FRONT));
}));

test('explicit human-copy acknowledgment, separate manifest pin, and absolute canonical directory required', async () => use(async f => {
  for (const changed of [{ acknowledgeHumanSuppliedCopy: false }, { expectedManifestSha256: null }, { directory: '.' },
    { directory: 'https://example.invalid/reference' }, { directory: f.directory + '/.' }, { acquisitionUrl: 'https://example.invalid' }])
    await assert.rejects(importReference({ ...f.options, ...changed }));
  await assert.rejects(importReference({ ...f.options, expectedManifestSha256: '0'.repeat(64) }), code('REFERENCE_MANIFEST_HASH_MISMATCH'));
}));

test('copy provenance, generated roles, unknown fields and path substitution fail closed', async () => {
  for (const change of [m => m.copy.humanSupplied = false, m => m.copy.kind = 'AUTO_FETCH', m => m.copy.sourceClass = 'VERIFIED_AUTHENTIC',
    m => m.copy.copiedAt = '2020-01-01T00:00:00Z', m => m.images.FRONT.role = 'GENERATED_PRESENTATION',
    m => m.images.FRONT.path = '../secret.webp', m => m.packet.path = 'https://example.invalid/packet', m => m.presentation = {},
    m => m.images.FRONT.url = 'https://example.invalid/image', m => delete m.images.BACK]) {
    await use(async f => { change(f.manifest); await f.save(); await assert.rejects(importReference(f.options)); });
  }
});

test('exact approval identity/version/hash, inspection side and geometry cannot be mixed even with a freshly pinned manifest', async () => {
  for (const change of [p => p.approvalVersion++, p => p.publicToken = 'ar_' + 'y'.repeat(24), p => p.reportNumber = 'ATLAS-000000000002',
    p => p.approvedAt = '2026-10-20T00:00:00.000Z', p => p.reportHash = 'e'.repeat(64), p => p.report.identity.cardName = 'Different copy',
    p => p.report.inspection.front.imageSha256 = p.images.BACK.sha256, p => p.images.FRONT = p.images.BACK,
    p => p.geometry.FRONT.printedQuad[0].x = .2, p => p.mode = 'PRODUCTION', p => p.presentation = {},
    p => p.report.finalGrade = .5, p => p.report.finalGrade = 5.3, p => p.report.finalGradePolicy = 'invented-policy']) {
    await use(async f => { change(f.packet); await f.save(); await assert.rejects(importReference(f.options)); });
  }
});

test('tampered packet/image bytes, swapped sides, truncation and changed manifest cannot be adopted', async () => {
  for (const name of ['manifest.json', 'packet.json', 'front.webp', 'back.webp']) await use(async f => {
    const path = join(f.directory, name), bytes = await readFile(path); bytes[bytes.length - 1] ^= 1; await writeFile(path, bytes);
    await assert.rejects(importReference(f.options));
  });
  await use(async f => { await writeFile(join(f.directory, 'front.webp'), f.images.BACK); await assert.rejects(importReference(f.options), code('REFERENCE_IMAGE_HASH_MISMATCH')); });
  await use(async f => { await truncate(join(f.directory, 'back.webp'), 20); await assert.rejects(importReference(f.options), code('REFERENCE_IMAGE_HASH_MISMATCH')); });
});

test('trace hash, RLE geometry, accepted finding membership and provenance are independently checked', async () => {
  for (const change of [f => f.packet.report.findings[0].detectorMask.runs[1]++, f => f.packet.report.findings[0].detectorMask.width++,
    f => f.packet.report.findings[0].detectorMask.sha256 = 'e'.repeat(64), f => f.packet.report.findings[0].reviewResult = 'REMOVED',
    f => f.packet.report.findings[0].sourceViewId = 'BACK', f => f.manifest.traces[0].side = 'BACK',
    f => f.manifest.traces[0].sha256 = null, f => f.packet.report.findingCounts.unreviewed = 1,
    f => { const item = f.packet.report.findings[0]; item.finalTrace = item.detectorMask; delete item.detectorMask;
      item.traceProvenance = { finalTraceSha256: 'e'.repeat(64) }; item.measurementRegions = [{ zone: item.zone, canonicalContour: item.canonicalContour, measurement: item.measurement }];
      delete item.zone; delete item.canonicalContour; delete item.measurement; }]) {
    await use(async f => { change(f); await f.save(); await assert.rejects(importReference(f.options)); });
  }
});

test('absent complete masks and no recorded defects remain explicit unavailable evidence, never invented matches', async () => {
  await use(async f => { delete f.packet.report.findings[0].detectorMask; f.manifest.traces[0].sha256 = null; await f.save();
    const result = await importReference(f.options); assert.equal(result.availability.traceAvailability, 'UNAVAILABLE'); assert.equal(result.decision.outcome, 'UNAVAILABLE'); });
  await use(async f => { f.packet.report.findings = []; f.packet.report.findingCounts = { total: 0, included: 0, removed: 0, unreviewed: 0 }; f.manifest.traces = []; await f.save();
    const result = await importReference(f.options); assert.equal(result.availability.traceAvailability, 'NO_RECORDED_DEFECTS'); assert.equal(result.decision.outcome, 'UNAVAILABLE'); });
});

test('malformed, crossing and degenerate geometry refuses instead of supplying a transform', async () => {
  for (const quad of [[{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]]) await use(async f => {
    f.packet.geometry.FRONT.physicalQuad = quad; await f.save(); await assert.rejects(importReference(f.options), code('REFERENCE_GEOMETRY_INVALID'));
  });
});

test('duplicate keys, unsafe keys, malformed UTF8, trailing JSON, deep and nonfinite values refuse', () => {
  for (const text of ['{"version":1,"version":2}', '{"__proto__":{}}', '{"a":{"x":1,"x":2}}', '{"v":1e999}', '{}{}', '[1,]', '"bad\nstring"', '['.repeat(34) + '0' + ']'.repeat(34)])
    assert.throws(() => parseJson(Buffer.from(text), 65536));
  assert.throws(() => parseJson(Buffer.from([0xc0, 0xaf]), 65536));
  assert.throws(() => parseJson(Buffer.from('{}'), 1));
  assert.deepEqual(parseJson(Buffer.from('{"safe":[0,false,null,"a\\\"b"]}'), 65536), { safe: [0, false, null, 'a"b'] });
});

test('extra files, missing files, executables, symbolic links and hard links refuse before source bytes are accepted', async () => {
  await use(async f => { await writeFile(join(f.directory, '.env'), 'SYNTHETIC FORBIDDEN EXTRA'); await assert.rejects(importReference(f.options), code('REFERENCE_DIRECTORY_CONTENTS_INVALID')); });
  await use(async f => { await unlink(join(f.directory, 'back.webp')); await assert.rejects(importReference(f.options), code('REFERENCE_DIRECTORY_CONTENTS_INVALID')); });
  await use(async f => { await chmod(join(f.directory, 'front.webp'), 0o700); await assert.rejects(importReference(f.options), code('REFERENCE_FILE_UNSAFE_OR_OVERSIZED')); });
  await use(async f => { await unlink(join(f.directory, 'back.webp')); await symlink('front.webp', join(f.directory, 'back.webp')); await assert.rejects(importReference(f.options), code('REFERENCE_DIRECTORY_CONTENTS_INVALID')); });
  await use(async f => { await unlink(join(f.directory, 'back.webp')); await link(join(f.directory, 'front.webp'), join(f.directory, 'back.webp')); await assert.rejects(importReference(f.options), code('REFERENCE_FILE_UNSAFE_OR_OVERSIZED')); });
});

test('oversized sparse sources refuse before allocation and static image header limits do not imply successful decoding', async () => {
  await use(async f => { await truncate(join(f.directory, 'front.webp'), LIMITS.imageBytes + 1); await assert.rejects(importReference(f.options), code('REFERENCE_FILE_UNSAFE_OR_OVERSIZED')); });
  for (const bytes of [webpHeader(2, 2), Buffer.from('not webp bytes padded to thirty!'), (() => { const b = webpHeader(); b.write('ANIM', 12); return b; })()])
    assert.throws(() => validateImage(bytes, { byteCount: bytes.length, sha256: sha(bytes), width: 1350, height: 1858 }));
});
