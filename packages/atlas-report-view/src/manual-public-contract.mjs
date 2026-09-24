import { z } from 'zod';
import { parseSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';

// A distinct, strict projection. The frozen legacy public-report-v1 reader and
// its original displayGrade semantics are intentionally independent.
const hash = z.string().regex(/^[a-f0-9]{64}$/), text = z.string().min(1).max(180);
const finite = z.number(), positive = finite.nonnegative(), score = finite.min(0).max(10);
const optionalText = z.string().max(120).nullable();
const point = z.strictObject({ x: finite.min(0).max(1), y: finite.min(0).max(1) });
const quad = z.array(point).length(4), side = z.enum(['FRONT', 'BACK']);
const balance = z.tuple([positive.max(100), positive.max(100)]);
const damage = z.strictObject({ score, weightedDamagePercent: positive });
const sideGrade = z.strictObject({ centering: z.strictObject({ score, leftRightBalance: balance, topBottomBalance: balance }), corners: damage, edges: damage, surface: damage });
const grade = z.strictObject({ front: sideGrade, back: sideGrade,
  subgrades: z.strictObject({ centering: score, corners: score, edges: score, surface: score }),
  overall: z.strictObject({ displayGrade: score, rawGrade: score }) });
const identity = z.union([
  z.strictObject({ playerName: text, year: z.string().min(1).max(24), manufacturer: text, productSet: text, parallel: optionalText, insert: optionalText, cardNumber: optionalText }),
  z.strictObject({ cardName: text, year: z.string().min(1).max(24), productSet: text, parallel: optionalText, cardNumber: optionalText, layoutType: z.enum(['POKEMON', 'TRAINER', 'ENERGY']).optional() }),
]);
const inspection = z.strictObject({ inspected: z.literal(true), imageSha256: hash, findingRevision: z.number().int().positive() });
const measurement = z.strictObject({ widthMm: positive, heightMm: positive, areaMm2: positive, zonePercent: positive, multiplier: positive,
  weightedAreaMm2: positive, subgradeEffect: positive, pixelCount: z.number().int().nonnegative().optional() });
const region = z.strictObject({ zone: z.enum(['CORNERS', 'EDGES', 'SURFACE']), canonicalContour: z.array(point).min(3).max(100000), measurement });
const trace = z.strictObject({ format: z.literal('TK_SPEEDSTER_TRACE_RLE_V1'), width: z.literal(1270), height: z.literal(1778),
  origin: z.literal('TOP_LEFT'), order: z.literal('ROW_MAJOR_Y_X'), runs: z.array(z.number().int().nonnegative()).min(1).max(2258061), sha256: hash });
const findingBase = { id: text, side, defectType: text, confidence: positive.max(1), sourceViewId: side, supportingViewIds: z.array(side).max(2),
  reviewResult: z.enum(['ACCEPTED', 'SMART_MARKED', 'TYPE_CORRECTED']) };
const finding = z.union([
  z.strictObject({ ...findingBase, ...region.shape, detectorMask: trace.optional() }),
  z.strictObject({ ...findingBase, finalTrace: trace, traceProvenance: z.strictObject({ finalTraceSha256: hash }), measurementRegions: z.array(region).max(3) }),
]);
const report = z.strictObject({ version: z.literal('atlas-manual-draft-report-v2'), ruleVersion: text, cardProfile: z.enum(['SPORTS', 'POKEMON']), identity,
  draftRevision: z.number().int().positive(), inspection: z.strictObject({ method: z.literal('HUMAN'), front: inspection, back: inspection }), grade,
  finalGrade: score.refine(value => Number.isInteger(value * 2)), finalGradePolicy: z.literal('atlas-final-half-point-v1'),
  findings: z.array(finding).max(400), findingCounts: z.strictObject({ total: z.number().int().nonnegative(), included: z.number().int().nonnegative(), removed: z.literal(0), unreviewed: z.literal(0) }) });
const image = z.strictObject({ sha256: hash, byteCount: z.number().int().positive().max(50 * 1024 * 1024), width: z.literal(1350), height: z.literal(1858), contentType: z.literal('image/webp') });
const geometry = z.strictObject({ physicalQuad: quad, printedQuad: quad });
export const publicManualReportSchema = z.strictObject({ version: z.literal('atlas-public-manual-report-v2'), publicToken: z.string().regex(/^ar_[A-Za-z0-9_-]{24}$/),
  reportNumber: z.string().regex(/^ATLAS-[A-F0-9]{12}$/), approvalVersion: z.number().int().positive().max(2147483647), approvedAt: z.iso.datetime(),
  mode: z.enum(['PRODUCTION', 'LOCAL_FIXTURE']), reportHash: hash, report,
  images: z.strictObject({ FRONT: image, BACK: image }), geometry: z.strictObject({ FRONT: geometry, BACK: geometry }) });
export function parsePublicManualReport(value) {
  const packet = publicManualReportSchema.parse(value), report = packet.report;
  if (report.findingCounts.total !== report.findings.length || report.findingCounts.included !== report.findings.length
    || new Set(report.findings.map(f => f.id)).size !== report.findings.length
    || (report.cardProfile === 'SPORTS') !== Object.hasOwn(report.identity, 'playerName')
    || report.finalGrade !== Math.round(report.grade.overall.rawGrade * 2) / 2) throw new Error('PUBLIC_MANUAL_REPORT_INVALID');
  for (const name of ['FRONT', 'BACK']) if (packet.images[name].sha256 !== report.inspection[name.toLowerCase()].imageSha256) throw new Error('PUBLIC_MANUAL_IMAGE_INVALID');
  for (const finding of report.findings) {
    const mask = finding.finalTrace ?? finding.detectorMask;
    if (mask) parseSpeedsterTraceRleV1(mask);
    if (finding.finalTrace && finding.traceProvenance.finalTraceSha256 !== finding.finalTrace.sha256) throw new Error('PUBLIC_MANUAL_TRACE_INVALID');
  }
  return packet;
}
