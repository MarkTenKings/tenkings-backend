import { prisma, SetIngestionJobStatus } from "@tenkings/database";
import { normalizeCardNumber, normalizeParallelLabel, normalizeSetLabel } from "@tenkings/shared";
import { buildTaxonomyCanonicalKey, normalizeParallelId, normalizeProgramId } from "./taxonomyV2Utils";

type IdentityVariantRow = {
  id: string;
  setId: string;
  programId: string;
  cardNumber: string;
  parallelId: string;
};

type IdentityVariantMapRow = {
  cardVariantId: string;
  setId: string;
  canonicalKey: string;
  programId: string | null;
};

type IdentityCardProgramRow = {
  setId: string;
  cardNumber: string;
  programId: string;
};

type IdentityParallelProgramRow = {
  setId: string;
  parallelId: string;
  programId: string;
};

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeSetLookupKey(setId: string) {
  return normalizeSetLabel(setId).toLowerCase();
}

function pushUnique(values: string[], value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized || values.includes(normalized)) return;
  values.push(normalized);
}

function mapPushUnique(map: Map<string, string[]>, key: string, value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return;
  const existing = map.get(key);
  if (existing) {
    if (!existing.includes(normalized)) existing.push(normalized);
    return;
  }
  map.set(key, [normalized]);
}

export function normalizeVariantCardNumberForIdentity(cardNumber: string | null | undefined) {
  return normalizeCardNumber(cardNumber) ?? "ALL";
}

export function normalizeVariantParallelLabelForIdentity(parallelId: string | null | undefined) {
  return normalizeParallelLabel(parallelId);
}

export function normalizeVariantProgramIdForIdentity(programId: string | null | undefined) {
  return normalizeProgramId(String(programId || "").trim() || "base");
}

export function buildLegacyVariantIdentityKey(
  cardNumber: string | null | undefined,
  parallelId: string | null | undefined,
  programId?: string | null
) {
  const normalizedCardNumber = normalizeVariantCardNumberForIdentity(cardNumber);
  const normalizedParallelId = normalizeVariantParallelLabelForIdentity(parallelId).toLowerCase();
  const normalizedProgramId = programId == null ? "__any__" : normalizeVariantProgramIdForIdentity(programId).toLowerCase();
  return `legacy::${normalizedProgramId}::${normalizedCardNumber.toLowerCase()}::${normalizedParallelId}`;
}

export function buildCanonicalVariantIdentityLookupKey(canonicalKey: string) {
  return `canonical::${String(canonicalKey || "").trim()}`;
}

export function extractProgramIdFromCanonicalKey(canonicalKey: string | null | undefined) {
  const parts = String(canonicalKey || "").trim().split("::");
  return parts.length >= 2 ? parts[1] || null : null;
}

export type SetOpsVariantIdentityContext = {
  normalizedSetId: string;
  setIdCandidates: string[];
  setLookupKeys: string[];
  variantIdByCanonicalKey: Map<string, string>;
  variantIdByLegacyKey: Map<string, string>;
  preferredCanonicalKeyByVariantId: Map<string, string>;
  canonicalKeysByLegacyKey: Map<string, string[]>;
  programIdsByScopedCardKey: Map<string, string[]>;
  programIdsByScopedParallelKey: Map<string, string[]>;
};

export type SetOpsResolvedVariantIdentity = {
  programId: string;
  cardNumber: string;
  parallelLabel: string;
  parallelSlug: string;
  legacyFallbackKey: string;
  canonicalKeys: string[];
  preferredCanonicalKey: string | null;
  preferredProgramId: string | null;
};

function scopedHintKey(setLookupKey: string, entityKey: string) {
  return `${setLookupKey}::${entityKey}`;
}

export async function loadSetOpsVariantIdentityContext(params: {
  setId: string;
  setIdCandidates?: string[];
}): Promise<SetOpsVariantIdentityContext> {
  const normalizedSetId = normalizeSetLabel(params.setId);
  const setIdCandidates = uniqueNonEmpty([...(params.setIdCandidates || []), params.setId, normalizedSetId]);
  const setLookupKeys = uniqueNonEmpty(setIdCandidates.map((setId) => normalizeSetLookupKey(setId)));

  const inClause = setIdCandidates.map((_, index) => `$${index + 1}`).join(", ");

  const [variants, variantMaps, cards, scopes] = (await Promise.all([
    prisma.cardVariant.findMany({
      where: { setId: { in: setIdCandidates } },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        setId: true,
        programId: true,
        cardNumber: true,
        parallelId: true,
      },
    }),
    prisma.$queryRawUnsafe<IdentityVariantMapRow[]>(
      `select m."cardVariantId", m."setId", m."canonicalKey", m."programId"
         from "CardVariantTaxonomyMap" m
        where "setId" in (${inClause})
        order by m."createdAt" asc`,
      ...setIdCandidates
    ),
    prisma.$queryRawUnsafe<IdentityCardProgramRow[]>(
      `select c."setId", c."cardNumber", c."programId"
         from "SetCard" c
         left join "SetTaxonomySource" cs on cs."id" = c."sourceId"
         left join "SetIngestionJob" cj on cj."id" = cs."ingestionJobId"
        where c."setId" in (${inClause})
          and (
            c."sourceId" is null
            or cs."ingestionJobId" is null
            or cj."status" = '${SetIngestionJobStatus.APPROVED}'
          )
        order by c."createdAt" asc`,
      ...setIdCandidates
    ),
    prisma.$queryRawUnsafe<IdentityParallelProgramRow[]>(
      `select s."setId", s."parallelId", s."programId"
         from "SetParallelScope" s
         left join "SetTaxonomySource" ss on ss."id" = s."sourceId"
         left join "SetIngestionJob" sj on sj."id" = ss."ingestionJobId"
        where s."setId" in (${inClause})
          and (
            s."sourceId" is null
            or ss."ingestionJobId" is null
            or sj."status" = '${SetIngestionJobStatus.APPROVED}'
          )
        order by s."createdAt" asc`,
      ...setIdCandidates
    ),
  ])) as [IdentityVariantRow[], IdentityVariantMapRow[], IdentityCardProgramRow[], IdentityParallelProgramRow[]];

  const variantIdByCanonicalKey = new Map<string, string>();
  const variantIdByLegacyKey = new Map<string, string>();
  const preferredCanonicalKeyByVariantId = new Map<string, string>();
  const canonicalKeysByLegacyKey = new Map<string, string[]>();
  const programIdsByScopedCardKey = new Map<string, string[]>();
  const programIdsByScopedParallelKey = new Map<string, string[]>();
  const variantById = new Map<string, IdentityVariantRow>();
  const allowedProgramIdsBySetLookup = new Map<string, Set<string>>();

  for (const row of variants) {
    variantById.set(row.id, row);
    const specificLegacyKey = buildLegacyVariantIdentityKey(row.cardNumber, row.parallelId, row.programId);
    const fallbackLegacyKey = buildLegacyVariantIdentityKey(row.cardNumber, row.parallelId, null);
    if (!variantIdByLegacyKey.has(specificLegacyKey)) {
      variantIdByLegacyKey.set(specificLegacyKey, row.id);
    }
    if (!variantIdByLegacyKey.has(fallbackLegacyKey)) {
      variantIdByLegacyKey.set(fallbackLegacyKey, row.id);
    }
  }

  for (const row of cards) {
    const setLookupKey = normalizeSetLookupKey(row.setId);
    const entry = allowedProgramIdsBySetLookup.get(setLookupKey) ?? new Set<string>();
    entry.add(String(row.programId || "").trim());
    allowedProgramIdsBySetLookup.set(setLookupKey, entry);
  }

  for (const row of scopes) {
    const setLookupKey = normalizeSetLookupKey(row.setId);
    const entry = allowedProgramIdsBySetLookup.get(setLookupKey) ?? new Set<string>();
    entry.add(String(row.programId || "").trim());
    allowedProgramIdsBySetLookup.set(setLookupKey, entry);
  }

  for (const row of variantMaps) {
    const setLookupKey = normalizeSetLookupKey(row.setId || normalizedSetId);
    const allowedPrograms = allowedProgramIdsBySetLookup.get(setLookupKey) ?? null;
    const rowProgramId = String(row.programId || "").trim();
    // Fail closed: if no approved/legacy program context exists for this set, ignore canonical map rows.
    if (!allowedPrograms || allowedPrograms.size < 1) {
      continue;
    }
    if (!rowProgramId || !allowedPrograms.has(rowProgramId)) {
      continue;
    }

    const canonicalKey = String(row.canonicalKey || "").trim();
    if (!canonicalKey) continue;

    const variant = variantById.get(row.cardVariantId) || null;
    if (variant) {
      const specificLegacyKey = buildLegacyVariantIdentityKey(variant.cardNumber, variant.parallelId, rowProgramId || variant.programId);
      const fallbackLegacyKey = buildLegacyVariantIdentityKey(variant.cardNumber, variant.parallelId, null);
      mapPushUnique(canonicalKeysByLegacyKey, specificLegacyKey, canonicalKey);
      mapPushUnique(canonicalKeysByLegacyKey, fallbackLegacyKey, canonicalKey);
    }

    if (!preferredCanonicalKeyByVariantId.has(row.cardVariantId)) {
      preferredCanonicalKeyByVariantId.set(row.cardVariantId, canonicalKey);
    }
    if (!variantIdByCanonicalKey.has(canonicalKey)) {
      variantIdByCanonicalKey.set(canonicalKey, row.cardVariantId);
    }
  }

  for (const row of cards) {
    const setLookupKey = normalizeSetLookupKey(row.setId);
    const cardNumber = normalizeVariantCardNumberForIdentity(row.cardNumber);
    mapPushUnique(programIdsByScopedCardKey, scopedHintKey(setLookupKey, cardNumber), row.programId);
  }

  for (const row of scopes) {
    const setLookupKey = normalizeSetLookupKey(row.setId);
    const parallelId = normalizeParallelId(row.parallelId);
    mapPushUnique(programIdsByScopedParallelKey, scopedHintKey(setLookupKey, parallelId), row.programId);
  }

  return {
    normalizedSetId,
    setIdCandidates,
    setLookupKeys,
    variantIdByCanonicalKey,
    variantIdByLegacyKey,
    preferredCanonicalKeyByVariantId,
    canonicalKeysByLegacyKey,
    programIdsByScopedCardKey,
    programIdsByScopedParallelKey,
  };
}

function buildDerivedCanonicalKeys(params: {
  context: SetOpsVariantIdentityContext;
  programIdHint?: string | null;
  cardNumber: string;
  parallelLabel: string;
}) {
  const derivedProgramIds: string[] = [];
  const parallelSlug = normalizeParallelId(params.parallelLabel);

  if (params.programIdHint) {
    pushUnique(derivedProgramIds, normalizeVariantProgramIdForIdentity(params.programIdHint));
  }

  for (const setLookupKey of params.context.setLookupKeys) {
    const cardPrograms = params.context.programIdsByScopedCardKey.get(scopedHintKey(setLookupKey, params.cardNumber)) || [];
    for (const programId of cardPrograms) {
      pushUnique(derivedProgramIds, programId);
    }
  }

  for (const setLookupKey of params.context.setLookupKeys) {
    const parallelPrograms =
      params.context.programIdsByScopedParallelKey.get(scopedHintKey(setLookupKey, parallelSlug)) || [];
    for (const programId of parallelPrograms) {
      pushUnique(derivedProgramIds, programId);
    }
  }

  if (derivedProgramIds.length < 1) {
    derivedProgramIds.push("base");
  }

  const canonicalKeys: string[] = [];
  for (const programId of derivedProgramIds) {
    canonicalKeys.push(
      buildTaxonomyCanonicalKey({
        setId: params.context.normalizedSetId,
        programId,
        cardNumber: params.cardNumber,
        variationId: null,
        parallelId: params.parallelLabel,
      })
    );
  }

  return {
    parallelSlug,
    derivedProgramIds,
    canonicalKeys,
  };
}

export function resolveSetOpsVariantIdentity(params: {
  context: SetOpsVariantIdentityContext;
  programId?: string | null | undefined;
  cardNumber: string | null | undefined;
  parallelId: string | null | undefined;
}): SetOpsResolvedVariantIdentity {
  const programId = normalizeVariantProgramIdForIdentity(params.programId);
  const cardNumber = normalizeVariantCardNumberForIdentity(params.cardNumber);
  const parallelLabel = normalizeVariantParallelLabelForIdentity(params.parallelId);
  const specificLegacyKey = buildLegacyVariantIdentityKey(cardNumber, parallelLabel, programId);
  const fallbackLegacyKey = buildLegacyVariantIdentityKey(cardNumber, parallelLabel, null);
  const legacyFallbackKey = specificLegacyKey;
  const canonicalKeys: string[] = [];

  for (const canonicalKey of params.context.canonicalKeysByLegacyKey.get(specificLegacyKey) || []) {
    pushUnique(canonicalKeys, canonicalKey);
  }
  for (const canonicalKey of params.context.canonicalKeysByLegacyKey.get(fallbackLegacyKey) || []) {
    pushUnique(canonicalKeys, canonicalKey);
  }

  const { parallelSlug, derivedProgramIds, canonicalKeys: derivedCanonicalKeys } = buildDerivedCanonicalKeys({
    context: params.context,
    programIdHint: programId,
    cardNumber,
    parallelLabel,
  });

  if (canonicalKeys.length < 1) {
    for (const canonicalKey of derivedCanonicalKeys) {
      pushUnique(canonicalKeys, canonicalKey);
    }
  }

  const preferredCanonicalKey = canonicalKeys[0] ?? null;
  const preferredProgramId = preferredCanonicalKey
    ? extractProgramIdFromCanonicalKey(preferredCanonicalKey)
    : derivedProgramIds[0] ?? null;

  return {
    programId,
    cardNumber,
    parallelLabel,
    parallelSlug,
    legacyFallbackKey,
    canonicalKeys,
    preferredCanonicalKey,
    preferredProgramId,
  };
}

export function buildSetOpsVariantIdentityLookupKeys(identity: SetOpsResolvedVariantIdentity) {
  const keys = identity.canonicalKeys.map((canonicalKey) => buildCanonicalVariantIdentityLookupKey(canonicalKey));
  if (!keys.includes(identity.legacyFallbackKey)) {
    keys.push(identity.legacyFallbackKey);
  }
  return keys;
}

export function buildPreferredSetOpsVariantIdentityLookupKey(identity: SetOpsResolvedVariantIdentity) {
  if (identity.preferredCanonicalKey) {
    return buildCanonicalVariantIdentityLookupKey(identity.preferredCanonicalKey);
  }
  return identity.legacyFallbackKey;
}
