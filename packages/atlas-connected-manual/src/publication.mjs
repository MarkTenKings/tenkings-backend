import { digest, canonical, requireThat } from '@atlas/manual-service/contract';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';
import { parseGeometryWorkspace, geometryStatus } from '@atlas/manual-workspace/geometry-actions';
import { parsePublicManualReport } from '@atlas/report-view/manual-public-contract';
import { approvedPublicationSource, publicationStatus } from './publication-repository.mjs';

const SIDES = ['FRONT', 'BACK'];
const clone = value => structuredClone(value);
const physicalQuad = [{ x: 0, y: 0 }, { x: 1269 / 1270, y: 0 }, { x: 1269 / 1270, y: 1777 / 1778 }, { x: 0, y: 1777 / 1778 }];
const pick = (value, names) => Object.fromEntries(names.filter(name => Object.hasOwn(value, name)).map(name => [name, clone(value[name])]));
function publicRegion(region) {
  return { zone: region.zone, canonicalContour: region.canonicalContour.map(({ x, y }) => ({ x, y })),
    measurement: pick(region.measurement, ['widthMm','heightMm','areaMm2','zonePercent','multiplier','weightedAreaMm2','subgradeEffect','pixelCount']) };
}
export function publicManualFinding(finding) {
  const result = { ...pick(finding, ['id','side','defectType','confidence','reviewResult']), sourceViewId: finding.side, supportingViewIds: [] };
  return finding.finalTrace ? { ...result, finalTrace: clone(finding.finalTrace), traceProvenance: { finalTraceSha256: finding.finalTrace.sha256 },
    measurementRegions: finding.measurementRegions.map(publicRegion) }
    : { ...result, ...publicRegion(finding), ...(finding.detectorMask ? { detectorMask: clone(finding.detectorMask) } : {}) };
}
export function projectApprovedManualReport({ row, approval, full, geometry, images }) {
  requireThat(approval.version === 'atlas-manual-report-snapshot-v2' && full.version === 'atlas-manual-draft-report-v2', 409, 'MANUAL_PUBLICATION_VERSION_UNSUPPORTED');
  const expected = { version: approval.version, report: approval.report, identity: full.identity, grade: full.grade,
    finalGrade: full.finalGrade, finalGradePolicy: full.finalGradePolicy, findingCounts: full.findingCounts, ruleVersion: full.ruleVersion };
  requireThat(canonical(expected) === canonical(approval), 503, 'MANUAL_PUBLICATION_REPORT_MISMATCH');
  explainAtlasManualReport(full); // Validate persisted math; never replace its award.
  requireThat(geometryStatus(geometry).confirmed && geometry.profile === full.cardProfile, 503, 'MANUAL_PUBLICATION_GEOMETRY_INVALID');
  const included = full.findings.filter(f => f.reviewResult !== 'REMOVED');
  requireThat(included.every(f => f.reviewResult !== 'UNREVIEWED'), 503, 'MANUAL_PUBLICATION_REVIEW_REQUIRED');
  const report = { ...pick(full, ['version','ruleVersion','cardProfile','identity','draftRevision','inspection','grade','finalGrade','finalGradePolicy']),
    findings: included.map(publicManualFinding), findingCounts: { total: included.length, included: included.length, removed: 0, unreviewed: 0 } };
  const packet = parsePublicManualReport({ version: 'atlas-public-manual-report-v2', publicToken: row.public_token, reportNumber: row.report_number,
    approvalVersion: row.version, approvedAt: new Date(row.approved_at).toISOString(), mode: row.mode, reportHash: row.report_hash,
    report, images, geometry: Object.fromEntries(SIDES.map(side => {
      const slot = geometry.sides[side];
      requireThat(slot.prepared?.frame.inspection.sha256 === full.inspection[side.toLowerCase()].imageSha256 && slot.printed && slot.physical,
        503, 'MANUAL_PUBLICATION_GEOMETRY_INVALID');
      return [side, { physicalQuad: clone(physicalQuad), printedQuad: clone(slot.printed.quad) }];
    })) });
  explainAtlasManualReport(packet.report); // Public allowlist preserves exact score evidence.
  return packet;
}

export function createManualPublication({ repository, artifacts, storage, readSource, timeoutMs = 60000 }) {
  requireThat(timeoutMs > 0 && timeoutMs <= 60000, 500, 'MANUAL_PUBLICATION_CONFIGURATION_INVALID');
  async function read(cardId, kind, saved, signal) {
    requireThat(saved?.ref && /^[a-f0-9]{64}$/.test(saved.sourceHash), 503, 'MANUAL_PUBLICATION_SOURCE_INVALID');
    const value = await artifacts.read(saved.ref, { cardId, kind, sourceHash: saved.sourceHash }, { signal });
    requireThat(digest(JSON.stringify(value)) === saved.sourceHash, 503, 'MANUAL_PUBLICATION_SOURCE_INVALID'); return value;
  }
  async function store(cardId, kind, value, signal) {
    const sourceHash = digest(JSON.stringify(value));
    return { ref: await artifacts.write(value, { cardId, kind, sourceHash }, { signal }), sourceHash };
  }
  return Object.freeze({
    status: (staff, cardId, actionId = null) => repository.status(staff, cardId, actionId),
    async publish(staff, cardId, actionId) {
      const signal = AbortSignal.timeout(timeoutMs), row = await repository.load(staff, cardId, actionId);
      if (row.state === 'PUBLISHED') return publicationStatus(row);
      const { approval, draft } = approvedPublicationSource(row);
      const full = await read(cardId, 'REPORT', approval.report, signal);
      const geometry = parseGeometryWorkspace(await read(cardId, 'GEOMETRY', draft.geometry, signal));
      requireThat(geometry.cardId === cardId, 503, 'MANUAL_PUBLICATION_SOURCE_INVALID');
      const images = {}, privateMedia = {};
      for (const side of SIDES) {
        signal.throwIfAborted();
        const { photo } = await readSource(staff, cardId, draft.source.uploads[side], { signal });
        const prepared = await read(cardId, 'PREPARED_IMAGES', draft.source.prepared[side], signal), descriptor = prepared.images.inspection;
        const slot = geometry.sides[side];
        requireThat(photo.original.content.sha256 === slot.image.originalSha256 && photo.workingFrame.id === slot.image.frameId
          && photo.workingFrame.raster.content.sha256 === slot.image.frameSha256 && prepared.frameId === slot.prepared.frame.id
          && descriptor.purpose === 'inspection', 503, 'MANUAL_PUBLICATION_IMAGE_MISMATCH');
        const media = { descriptor, frame: photo.workingFrame, original: photo.original, decodePlan: photo.decodePlan };
        const found = await storage.readDerivative({ ...media, signal });
        const { content, dimensions } = descriptor.raster;
        requireThat(found.bytes.length === content.byteCount && digest(found.bytes) === content.sha256
          && content.sha256 === full.inspection[side.toLowerCase()].imageSha256, 503, 'MANUAL_PUBLICATION_IMAGE_MISMATCH');
        images[side] = { sha256: content.sha256, byteCount: content.byteCount, width: dimensions.width, height: dimensions.height, contentType: content.mime };
        privateMedia[side] = media;
      }
      const packet = projectApprovedManualReport({ row, approval, full, geometry, images });
      const saved = await store(cardId, 'PUBLIC_REPORT', packet, signal);
      const media = await store(cardId, 'APPROVED_MEDIA', privateMedia, signal);
      signal.throwIfAborted();
      return repository.complete(staff, row, { version: 'atlas-manual-publication-manifest-v1', packet: saved, media, publicHash: saved.ref.sha256 });
    },
  });
}
