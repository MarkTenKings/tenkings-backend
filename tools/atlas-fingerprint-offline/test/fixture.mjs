// Synthetic data only. These headers are not decodable photos and do not
// establish that a real card/approval or export ever existed.
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(sorted).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${sorted(value[key])}`).join(',')}}`;
export function webpHeader(width = 1350, height = 1858, tag = 0) {
  const bytes = Buffer.alloc(30); bytes.write('RIFF', 0); bytes.writeUInt32LE(22, 4); bytes.write('WEBPVP8 ', 8);
  bytes.writeUInt32LE(10, 16); bytes[22] = tag; bytes.set([157, 1, 42], 23); bytes.writeUInt16LE(width, 26); bytes.writeUInt16LE(height, 28); return bytes;
}
export async function fixture() {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'atlas-fingerprint-offline-test-'));
  const images = { FRONT: webpHeader(), BACK: webpHeader(1350, 1858, 1) };
  const geometry = { physicalQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    printedQuad: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }] };
  const mask = { format: 'TK_SPEEDSTER_TRACE_RLE_V1', width: 1270, height: 1778, origin: 'TOP_LEFT', order: 'ROW_MAJOR_Y_X', runs: [0, 1, 2258059],
    sha256: sha('TK_SPEEDSTER_TRACE_RLE_V1\n1270\n1778\nTOP_LEFT\nROW_MAJOR_Y_X\n0\n0,1,2258059\n') };
  const packet = { version: 'atlas-public-manual-report-v2', publicToken: 'ar_' + 'x'.repeat(24), reportNumber: 'ATLAS-000000000001',
    approvalVersion: 1, approvedAt: '2026-10-21T00:00:00.000Z', mode: 'LOCAL_FIXTURE', reportHash: sha('SYNTHETIC PRIVATE REPORT IDENTIFIER ONLY'),
    report: { version: 'atlas-manual-draft-report-v2', ruleVersion: 'SYNTHETIC-NOT-A-GRADE', cardProfile: 'POKEMON',
      identity: { cardName: 'Synthetic reference fixture', year: null, productSet: null, parallel: null, insert: null, cardNumber: null },
      draftRevision: 1, inspection: { method: 'HUMAN', front: { inspected: true, imageSha256: sha(images.FRONT), findingRevision: 1 },
        back: { inspected: true, imageSha256: sha(images.BACK), findingRevision: 1 } }, grade: { opaqueSyntheticData: true },
      finalGrade: 1, finalGradePolicy: 'atlas-final-whole-point-v1',
      findings: [{ id: 'SYNTHETIC:FRONT:1', side: 'FRONT', defectType: 'SYNTHETIC_ONLY', confidence: 1, sourceViewId: 'FRONT', supportingViewIds: [],
        reviewResult: 'ACCEPTED', zone: 'SURFACE', canonicalContour: [{ x: 0, y: 0 }, { x: .1, y: 0 }, { x: 0, y: .1 }], measurement: { synthetic: true }, detectorMask: mask }],
      findingCounts: { total: 1, included: 1, removed: 0, unreviewed: 0 } },
    images: Object.fromEntries(Object.entries(images).map(([side, bytes]) => [side, { sha256: sha(bytes), byteCount: bytes.length, width: 1350, height: 1858, contentType: 'image/webp' }])),
    geometry: { FRONT: structuredClone(geometry), BACK: structuredClone(geometry) } };
  const manifest = { schema: 'atlas-fingerprint-offline-reference-v1',
    copy: { kind: 'OFFLINE_COPY', humanSupplied: true, copyReference: 'SYNTHETIC TEST ONLY', copiedAt: '2026-10-21T01:00:00.000Z', sourceClass: 'SYNTHETIC_FIXTURE' },
    approval: { publicToken: packet.publicToken, reportNumber: packet.reportNumber, version: packet.approvalVersion, approvedAt: packet.approvedAt,
      publicHash: '', reportHash: packet.reportHash, identitySha256: sha(sorted(packet.report.identity)) },
    packet: { path: 'packet.json', sha256: '', byteCount: 1 },
    images: Object.fromEntries(Object.entries(packet.images).map(([side, value]) => [side, { path: `${side.toLowerCase()}.webp`, role: 'APPROVED_INSPECTION_DERIVATIVE', ...value }])),
    geometrySha256: sha(sorted(packet.geometry)), traces: [{ findingId: 'SYNTHETIC:FRONT:1', side: 'FRONT', sha256: mask.sha256 }] };
  const current = { directory, packet, manifest, images, options: null,
    async save() {
      const bytes = Buffer.from(JSON.stringify(packet)); manifest.packet.byteCount = bytes.length; manifest.packet.sha256 = sha(bytes); manifest.approval.publicHash = sha(bytes);
      const encoded = Buffer.from(JSON.stringify(manifest));
      for (const [name, content] of [['manifest.json', encoded], ['packet.json', bytes], ['front.webp', images.FRONT], ['back.webp', images.BACK]]) await writeFile(join(directory, name), content, { mode: 0o600 });
      current.options = { directory, expectedManifestSha256: sha(encoded), acknowledgeHumanSuppliedCopy: true }; return current.options;
    }, async dispose() { await rm(directory, { recursive: true, force: true }); } };
  await current.save(); return current;
}
