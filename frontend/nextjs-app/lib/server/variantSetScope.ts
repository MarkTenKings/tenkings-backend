import { prisma } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";

const IDENTITY_STOP_WORDS = new Set([
  "checklist",
  "odds",
  "list",
  "worksheet",
  "upload",
  "source",
  "draft",
  "review",
  "version",
]);

const VARIANT_SET_CACHE_TTL_MS = 60_000;

let variantSetIdCache: { expiresAt: number; setIds: string[] } | null = null;

export type VariantScopeSetIds = {
  approvedSetIds: string[];
  legacyEligibleSetIds: string[];
  scopeSetIds: string[];
};

const sanitizeSetId = (value: unknown): string => normalizeSetLabel(String(value ?? "")).trim();

function tokenizeSetIdentity(value: unknown): string[] {
  const normalized = sanitizeSetId(value)
    .toLowerCase()
    .replace(/[_]+/g, " ");
  if (!normalized) return [];
  return normalized
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => {
      if (!token) return false;
      if (IDENTITY_STOP_WORDS.has(token)) return false;
      if (/^v\d{1,4}$/.test(token)) return false;
      return true;
    });
}

export function normalizeSetIdentityKey(value: unknown): string {
  return tokenizeSetIdentity(value).join(" ");
}

function countTokenOverlap(left: Set<string>, right: Set<string>): number {
  let overlap = 0;
  left.forEach((token) => {
    if (right.has(token)) overlap += 1;
  });
  return overlap;
}

function uniqueSetIds(values: string[]): string[] {
  return Array.from(new Set(values.map((entry) => sanitizeSetId(entry)).filter(Boolean)));
}

export function resolveSetIdByIdentity(options: string[], input: string): string | null {
  const candidates = uniqueSetIds(options);
  const cleanedInput = sanitizeSetId(input);
  if (!cleanedInput || candidates.length < 1) {
    return null;
  }

  const inputLower = cleanedInput.toLowerCase();
  const direct = candidates.find((setId) => sanitizeSetId(setId).toLowerCase() === inputLower);
  if (direct) return direct;

  const inputKey = normalizeSetIdentityKey(cleanedInput);
  if (inputKey) {
    const keyMatches = candidates.filter((setId) => normalizeSetIdentityKey(setId) === inputKey);
    if (keyMatches.length > 0) {
      return keyMatches.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    }
  }

  const inputTokens = tokenizeSetIdentity(cleanedInput);
  if (inputTokens.length < 2) {
    return null;
  }
  const inputTokenSet = new Set(inputTokens);

  let best: string | null = null;
  let bestScore = 0;
  candidates.forEach((setId) => {
    const candidateTokens = tokenizeSetIdentity(setId);
    if (candidateTokens.length < 1) return;
    const candidateTokenSet = new Set(candidateTokens);
    const overlap = countTokenOverlap(inputTokenSet, candidateTokenSet);
    if (overlap < 2) return;

    const coverage = overlap / inputTokenSet.size;
    const precision = overlap / candidateTokenSet.size;
    const lexicalBonus =
      setId.toLowerCase().includes(cleanedInput.toLowerCase()) || cleanedInput.toLowerCase().includes(setId.toLowerCase()) ? 0.25 : 0;
    const score = coverage * 1.4 + precision * 1.0 + lexicalBonus;

    if (score > bestScore) {
      bestScore = score;
      best = setId;
    }
  });

  return bestScore >= 1.45 ? best : null;
}

export function filterSetIdsByScopeIdentity(candidateSetIds: string[], scopeSetIds: string[]): string[] {
  const candidates = uniqueSetIds(candidateSetIds);
  const scope = uniqueSetIds(scopeSetIds);
  if (candidates.length < 1 || scope.length < 1) {
    return [];
  }

  const exactScope = new Set(scope);
  const scopeIdentityKeys = new Set(scope.map((setId) => normalizeSetIdentityKey(setId)).filter(Boolean));
  return candidates.filter((setId) => {
    if (exactScope.has(setId)) return true;
    const key = normalizeSetIdentityKey(setId);
    return Boolean(key && scopeIdentityKeys.has(key));
  });
}

async function loadAllVariantSetIds(): Promise<string[]> {
  if (variantSetIdCache && variantSetIdCache.expiresAt > Date.now()) {
    return variantSetIdCache.setIds;
  }

  const rows = await prisma.cardVariant.findMany({
    distinct: ["setId"],
    select: {
      setId: true,
    },
    take: 10000,
  });
  const setIds = uniqueSetIds(rows.map((row) => row.setId)).sort((a, b) => a.localeCompare(b));
  variantSetIdCache = {
    setIds,
    expiresAt: Date.now() + VARIANT_SET_CACHE_TTL_MS,
  };
  return setIds;
}

export async function resolveVariantSetIdsForScope(scopeSetIds: string[]): Promise<string[]> {
  const scoped = uniqueSetIds(scopeSetIds);
  if (scoped.length < 1) {
    return [];
  }

  const allVariantSetIds = await loadAllVariantSetIds();
  if (allVariantSetIds.length < 1) {
    return scoped;
  }

  const exactScoped = new Set(scoped);
  const scopedIdentityKeys = new Set(scoped.map((setId) => normalizeSetIdentityKey(setId)).filter(Boolean));
  const matched = allVariantSetIds.filter((variantSetId) => {
    if (exactScoped.has(variantSetId)) return true;
    const identityKey = normalizeSetIdentityKey(variantSetId);
    return Boolean(identityKey && scopedIdentityKeys.has(identityKey));
  });

  return matched.length > 0 ? matched : scoped;
}

export async function loadVariantScopeSetIds(params: { includeLegacyReviewRequired: boolean }): Promise<VariantScopeSetIds> {
  const approvedRows = await prisma.setDraft.findMany({
    where: {
      status: "APPROVED",
      archivedAt: null,
    },
    select: {
      setId: true,
    },
  });

  const approvedSetIds = uniqueSetIds(approvedRows.map((row) => row.setId));
  let legacyEligibleSetIds: string[] = [];

  if (params.includeLegacyReviewRequired) {
    const reviewRows = await prisma.setDraft.findMany({
      where: {
        status: "REVIEW_REQUIRED",
        archivedAt: null,
      },
      select: {
        setId: true,
      },
    });
    const reviewSetIds = uniqueSetIds(reviewRows.map((row) => row.setId));
    if (reviewSetIds.length > 0) {
      const grouped = await prisma.cardVariant.groupBy({
        by: ["setId"],
        where: {
          setId: { in: reviewSetIds },
        },
        _count: {
          _all: true,
        },
      });
      const liveSetIds = new Set(
        grouped
          .filter((row) => (row._count?._all ?? 0) > 0)
          .map((row) => sanitizeSetId(row.setId))
          .filter(Boolean)
      );
      legacyEligibleSetIds = reviewSetIds.filter((setId) => liveSetIds.has(setId));
    }
  }

  const scopeSetIds = uniqueSetIds([...approvedSetIds, ...legacyEligibleSetIds]);
  return {
    approvedSetIds,
    legacyEligibleSetIds,
    scopeSetIds,
  };
}
