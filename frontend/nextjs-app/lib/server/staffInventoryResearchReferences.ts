import { createHash } from 'node:crypto';
import { prisma } from '@tenkings/database';
import { Prisma } from '@prisma/client';
import { StaffInventoryResearchReferenceSchema, type StaffInventoryResearchDescription, type StaffInventoryResearchReference, isStaffInventoryResearchSourceUrl } from '../staffInventoryResearch';
import { isExactStaffInventoryResearchReference } from './staffInventoryResearch';

type CatalogRow = {
  cardId: string; setId: string; cardNumber: string; playerName: string | null; metadataJson: unknown;
  parallelId: string; label: string; serialText: string | null; finishFamily: string | null; visualCuesJson: unknown;
  variationId: string | null; variationLabel: string | null; scopeNote: string | null;
  cardSourceId: string; parallelSourceId: string; scopeSourceId: string; sourceUrl: string | null;
  variationSourceId: string | null; variationReviewedAt: Date | null;
  cardReviewedAt: Date | null; parallelReviewedAt: Date | null; scopeReviewedAt: Date | null;
  sourceMetadata: unknown;
};
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Exact aliases only: never match a different year, product, numbered insert,
 * or parallel merely because part of its name resembles the photographed card. */
export function staffInventoryResearchSetKeys(description: StaffInventoryResearchDescription) {
  if (!description.year || !description.manufacturer || !description.set_name || !description.card_number) return [];
  const products = [
    description.set_name,
    `${description.year} ${description.set_name}`,
    `${description.manufacturer} ${description.set_name}`,
    `${description.year} ${description.manufacturer} ${description.set_name}`,
  ];
  return [...new Set([...products, ...(description.card_type ? products.map(product => `${product} ${description.card_type}`) : [])].map(normalized))];
}
function explicitFeatures(row: CatalogRow) {
  const cues = row.visualCuesJson;
  const values = Array.isArray(cues) ? cues : Object.entries(record(cues)).map(([key, value]) => typeof value === 'string' ? `${key}: ${value}` : null);
  return [...values, row.serialText ? `Printed serial: ${row.serialText}` : null,
    row.finishFamily ? `Finish: ${row.finishFamily}` : null, row.scopeNote]
    .filter((value): value is string => typeof value === 'string' && !!value.trim())
    .map(value => value.trim()).filter(value => value.length <= 240 && !/[\u0000-\u001f]|https?:|<\/?[a-z]/i.test(value)).slice(0, 16);
}
export function staffInventoryResearchCatalogReferences(description: StaffInventoryResearchDescription, rows: CatalogRow[]): StaffInventoryResearchReference[] {
  const keys = staffInventoryResearchSetKeys(description), output: StaffInventoryResearchReference[] = [];
  for (const row of rows) {
    const setKey = normalized(row.setId), year = normalized(description.year ?? ''), maker = normalized(description.manufacturer ?? '');
    if (!keys.includes(setKey) || !(` ${setKey} `).includes(` ${year} `) || !(` ${setKey} `).includes(` ${maker} `) || normalized(row.cardNumber) !== normalized(description.card_number ?? '') || !row.playerName) continue;
    const metadata = record(row.metadataJson), sourceMetadata = record(row.sourceMetadata);
    const variantName = row.variationLabel ? `${row.variationLabel}${normalized(row.label) === 'base' ? '' : ` · ${row.label}`}` : row.label;
    const at = [row.cardReviewedAt, row.parallelReviewedAt, row.scopeReviewedAt, ...(row.variationId ? [row.variationReviewedAt] : [])].filter((value): value is Date => value instanceof Date);
    if (at.length !== (row.variationId ? 4 : 3) || row.variationId && !row.variationSourceId) continue;
    // Preserve a private snapshot hash of actual published source rows and
    // approval provenance; no staff-supplied text is promoted to source evidence.
    const sourceHash = createHash('sha256').update(JSON.stringify(row)).digest('hex');
    const parsed = StaffInventoryResearchReferenceSchema.safeParse({
      id: `catalog:${sourceHash.slice(0, 32)}`, kind: 'catalog', trust: 'published_catalog',
      catalog_id: `setops:${createHash('sha256').update(row.setId).digest('hex').slice(0, 32)}`,
      identity: { name: row.playerName, category: typeof metadata.category === 'string' ? metadata.category : typeof sourceMetadata.category === 'string' ? sourceMetadata.category : null,
        year: description.year, manufacturer: description.manufacturer, set_name: row.setId, card_number: row.cardNumber },
      variant_name: variantName, variant_kind: row.variationId ? 'VARIANT' : normalized(row.label) === 'base' ? 'BASE' : 'PARALLEL',
      source_url: isStaffInventoryResearchSourceUrl(row.sourceUrl) ? row.sourceUrl : null,
      source_sha256: sourceHash, captured_at: new Date(Math.max(...at.map(value => value.getTime()))).toISOString(),
      distinguishing_features: explicitFeatures(row), image: null,
    });
    if (parsed.success && isExactStaffInventoryResearchReference(description, parsed.data) && !output.some(item => item.variant_name === parsed.data.variant_name && JSON.stringify(item.distinguishing_features) === JSON.stringify(parsed.data.distinguishing_features))) output.push(parsed.data);
    if (output.length === 24) break;
  }
  return output;
}

export async function loadStaffInventoryResearchReferences(description: StaffInventoryResearchDescription, signal: AbortSignal) {
  const keys = staffInventoryResearchSetKeys(description);
  if (signal.aborted || !keys.length) return [];
  // Only published, reviewed, non-archived taxonomy participates. Legacy seed
  // rows, pending jobs and seller-title-only records cannot supply authority.
  const rows = await prisma.$queryRaw<CatalogRow[]>(Prisma.sql`
    SELECT c.id AS "cardId", c."setId", c."cardNumber", c."playerName", c."metadataJson",
      p."parallelId", p.label, p."serialText", p."finishFamily", p."visualCuesJson",
      s."variationId", v.label AS "variationLabel", v."scopeNote",
      cs.id AS "cardSourceId", ps.id AS "parallelSourceId", ss.id AS "scopeSourceId", vs.id AS "variationSourceId", vj."reviewedAt" AS "variationReviewedAt", COALESCE(vs."sourceUrl", ps."sourceUrl") AS "sourceUrl", ps."metadataJson" AS "sourceMetadata",
      cj."reviewedAt" AS "cardReviewedAt", pj."reviewedAt" AS "parallelReviewedAt", sj."reviewedAt" AS "scopeReviewedAt"
    FROM "SetCard" c
    JOIN "SetParallelScope" s ON s."setId" = c."setId" AND s."programId" = c."programId"
    JOIN "SetParallel" p ON p."setId" = s."setId" AND p."parallelId" = s."parallelId"
    LEFT JOIN "SetVariation" v ON v."setId" = s."setId" AND v."programId" = s."programId" AND v."variationId" = s."variationId"
    LEFT JOIN "SetTaxonomySource" vs ON vs.id = v."sourceId"
    LEFT JOIN "SetIngestionJob" vj ON vj.id = vs."ingestionJobId"
    LEFT JOIN "SetDraft" vd ON vd.id = vj."draftId"
    JOIN "SetTaxonomySource" cs ON cs.id = c."sourceId"
    JOIN "SetTaxonomySource" ps ON ps.id = p."sourceId"
    JOIN "SetTaxonomySource" ss ON ss.id = s."sourceId"
    JOIN "SetIngestionJob" cj ON cj.id = cs."ingestionJobId" AND cj.status = 'APPROVED'
    JOIN "SetIngestionJob" pj ON pj.id = ps."ingestionJobId" AND pj.status = 'APPROVED'
    JOIN "SetIngestionJob" sj ON sj.id = ss."ingestionJobId" AND sj.status = 'APPROVED'
    JOIN "SetDraft" cd ON cd.id = cj."draftId" AND cd.status = 'APPROVED' AND cd."archivedAt" IS NULL
    JOIN "SetDraft" pd ON pd.id = pj."draftId" AND pd.status = 'APPROVED' AND pd."archivedAt" IS NULL
    JOIN "SetDraft" sd ON sd.id = sj."draftId" AND sd.status = 'APPROVED' AND sd."archivedAt" IS NULL
    WHERE trim(regexp_replace(lower(c."setId"), '[^a-z0-9]+', ' ', 'g')) IN (${Prisma.join(keys)})
      AND lower(trim(c."cardNumber")) = lower(trim(${description.card_number}))
      AND cs."sourceKind" IN ('OFFICIAL_CHECKLIST', 'TRUSTED_SECONDARY')
      AND ps."sourceKind" IN ('OFFICIAL_CHECKLIST', 'OFFICIAL_ODDS', 'TRUSTED_SECONDARY')
      AND ss."sourceKind" IN ('OFFICIAL_CHECKLIST', 'OFFICIAL_ODDS', 'TRUSTED_SECONDARY')
      AND (s."variationId" IS NULL OR (vs."sourceKind" IN ('OFFICIAL_CHECKLIST', 'TRUSTED_SECONDARY') AND vj.status = 'APPROVED' AND vj."reviewedAt" IS NOT NULL AND vd.status = 'APPROVED' AND vd."archivedAt" IS NULL))
    ORDER BY c.id, p.label, s.id LIMIT 120`);
  if (signal.aborted) return [];
  return staffInventoryResearchCatalogReferences(description, rows);
}
