import { z } from 'zod';

// A public-output allowlist, with no grade calculation or approval authority.
const text = z.string().min(1).max(160), optionalText = z.string().max(120).nullable();
const findingReference = z.string().min(1).max(180);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const score = z.number().min(0).max(10), positive = z.number().min(0);
const balance = z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]);
const damage = z.strictObject({ score, weightedDamagePercent: positive });
const sideGrade = z.strictObject({ centering: z.strictObject({ score, leftRightBalance: balance, topBottomBalance: balance }),
    corners: damage, edges: damage, surface: damage });
const grade = z.strictObject({ front: sideGrade, back: sideGrade,
    subgrades: z.strictObject({ centering: score, corners: score, edges: score, surface: score }),
    overall: z.strictObject({ displayGrade: score, rawGrade: score }) });
const point = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const measurement = z.strictObject({ widthMm: positive, heightMm: positive, areaMm2: positive, zonePercent: positive,
    multiplier: positive, weightedAreaMm2: positive, subgradeEffect: z.number(), pixelCount: z.number().int().min(0).optional() });
const region = z.strictObject({ zone: text, canonicalContour: z.array(point).max(100_000), measurement });
const common = { id: findingReference, side: z.enum(['FRONT', 'BACK']), defectType: text, origin: text.optional(), detectedDefectType: text.optional(),
    confidence: z.number().min(0).max(1), sourceViewId: findingReference, supportingViewIds: z.array(findingReference).max(100),
    reviewResult: z.enum(['ACCEPTED', 'SMART_MARKED', 'TYPE_CORRECTED']) };
const finding = z.union([z.strictObject({ ...common, ...region.shape }),
    z.strictObject({ ...common, traceSha256: hash.optional(), measurementRegions: z.array(region).min(1).max(100) })]);
const report = z.strictObject({ version: z.literal('atlas-graded-report-v1'), ruleVersion: text,
    cardProfile: z.enum(['SPORTS', 'POKEMON']), identity: z.union([
        z.strictObject({ playerName: text, year: z.string().min(1).max(24), manufacturer: text, productSet: text,
            parallel: optionalText, insert: optionalText, cardNumber: optionalText }),
        z.strictObject({ cardName: text, year: z.string().min(1).max(24), productSet: text, parallel: optionalText,
            cardNumber: optionalText, layoutType: z.enum(['POKEMON', 'TRAINER', 'ENERGY']).optional() }),
    ]), detectorVersion: text, grade, findings: z.array(finding).max(10_000), findingCounts: z.strictObject({ included: z.number().int().min(0) }) });
export const publicReportSchema = z.strictObject({ version: z.literal('atlas-public-report-v1'),
    publicToken: z.string().regex(/^ar_[A-Za-z0-9_-]{24}$/), reportNumber: z.string().regex(/^ATLAS-[A-F0-9]{12}$/),
    approvalVersion: z.number().int().positive().max(2147483647), approvedAt: z.iso.datetime(),
    mode: z.enum(['PRODUCTION', 'LOCAL_FIXTURE']), evidenceHash: hash, analysisHash: hash, report });

export function parsePublicReport(value) {
    const parsed = publicReportSchema.parse(value);
    if (parsed.report.findingCounts.included !== parsed.report.findings.length
        || new Set(parsed.report.findings.map(f => f.id)).size !== parsed.report.findings.length
        || (parsed.report.cardProfile === 'SPORTS') !== Object.hasOwn(parsed.report.identity, 'playerName'))
        throw new Error('PUBLIC_REPORT_INVALID');
    return parsed;
}
