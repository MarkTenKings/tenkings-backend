import { prisma } from "@tenkings/database";
import { normalizeCardNumber, normalizeParallelLabel, normalizeSetLabel } from "@tenkings/shared";
import { buildTaxonomyCanonicalKey, normalizeParallelId } from "./taxonomyV2Utils";

type IdentityVariantRow = {
  id: string;
  setId: string;
  cardNumber: string;
  parallelId: string;
};

type IdentityVariantMapRow = {
  cardVariantId: string;
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

export function buildLegacyVariantIdentityKey(cardNumber: string | null | undefined, parallelId: string | null | undefined) {
  const normalizedCardNumber = normalizeVariantCardNumberForIdentity(cardNumber);
  const normalizedParallelId = normalizeVariantParallelLabelForIdentity(parallelId).toLowerCase();
  return `legacy::${normalizedCardNumber.toLowerCase()}::${normalizedParallelId}`;
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
        cardNumber: true,
        parallelId: true,
      },
    }),
    prisma.$queryRawUnsafe<IdentityVariantMapRow[]>(
      `select "cardVariantId", "canonicalKey", "programId"
         from "CardVariantTaxonomyMap"
        where "setId" in (${inClause})
        order by "createdAt" asc`,
      ...setIdCandidates
    ),
    prisma.$queryRawUnsafe<IdentityCardProgramRow[]>(
      `select "setId", "cardNumber", "programId"
         from "SetCard"
        where "setId" in (${inClause})
        order by "createdAt" asc`,
      ...setIdCandidates
    ),
    prisma.$queryRawUnsafe<IdentityParallelProgramRow[]>(
      `select "setId", "parallelId", "programId"
         from "SetParallelScope"
        where "setId" in (${inClause})
        order by "createdAt" asc`,
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

  for (const row of variants) {
    variantById.set(row.id, row);
    const legacyKey = buildLegacyVariantIdentityKey(row.cardNumber, row.parallelId);
    if (!variantIdByLegacyKey.has(legacyKey)) {
      variantIdByLegacyKey.set(legacyKey, row.id);
    }
  }

  for (const row of variantMaps) {
    const canonicalKey = String(row.canonicalKey || "").trim();
    if (!canonicalKey) continue;

    const variant = variantById.get(row.cardVariantId) || null;
    if (variant) {
      const legacyKey = buildLegacyVariantIdentityKey(variant.cardNumber, variant.parallelId);
      mapPushUnique(canonicalKeysByLegacyKey, legacyKey, canonicalKey);
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
  cardNumber: string;
  parallelLabel: string;
}) {
  const derivedProgramIds: string[] = [];
  const parallelSlug = normalizeParallelId(params.parallelLabel);

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
  cardNumber: string | null | undefined;
  parallelId: string | null | undefined;
}): SetOpsResolvedVariantIdentity {
  const cardNumber = normalizeVariantCardNumberForIdentity(params.cardNumber);
  const parallelLabel = normalizeVariantParallelLabelForIdentity(params.parallelId);
  const legacyFallbackKey = buildLegacyVariantIdentityKey(cardNumber, parallelLabel);
  const canonicalKeys: string[] = [];

  for (const canonicalKey of params.context.canonicalKeysByLegacyKey.get(legacyFallbackKey) || []) {
    pushUnique(canonicalKeys, canonicalKey);
  }

  const { parallelSlug, derivedProgramIds, canonicalKeys: derivedCanonicalKeys } = buildDerivedCanonicalKeys({
    context: params.context,
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
