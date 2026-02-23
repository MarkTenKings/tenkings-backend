import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { normalizeCardNumber, normalizeParallelLabel, normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { getStorageMode, managedStorageKeyFromUrl, presignReadUrl } from "../../../../../lib/server/storage";

type ReferenceRow = {
  id: string;
  setId: string;
  cardNumber: string | null;
  parallelId: string;
  displayLabel: string;
  refType: string;
  pairKey: string | null;
  sourceListingId: string | null;
  playerSeed: string | null;
  storageKey: string | null;
  qaStatus: string;
  ownedStatus: string;
  promotedAt: string | null;
  sourceUrl: string | null;
  rawImageUrl: string;
  cropUrls: string[];
  qualityScore: number | null;
  createdAt: string;
  updatedAt: string;
};

type ResponseBody =
  | { references: ReferenceRow[] }
  | { reference: ReferenceRow }
  | { ok: true; deleted?: number }
  | { ok: true }
  | { message: string };

const PARALLEL_ALIAS_TO_CANONICAL: Record<string, string> = {
  SI: "SUDDEN IMPACT",
  FS: "FILM STUDY",
  RR: "ROUNDBALL ROYALTY",
  FSA: "FUTURE STARS AUTOGRAPHS",
  CA: "CERTIFIED AUTOGRAPHS",
  PB: "POWER BOOSTERS",
  DNA: "DNA",
};

const PARALLEL_CANONICAL_TO_ALIAS: Record<string, string> = Object.entries(PARALLEL_ALIAS_TO_CANONICAL).reduce(
  (acc, [alias, canonical]) => {
    const key = canonical.toUpperCase();
    if (!acc[key]) acc[key] = alias;
    return acc;
  },
  {} as Record<string, string>
);

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function canonicalParallelLabel(value: string | null | undefined) {
  const normalized = normalizeParallelLabel(value);
  if (!normalized) return "";
  return PARALLEL_ALIAS_TO_CANONICAL[normalized.toUpperCase()] || normalized;
}

function setIdCandidates(value: string | null | undefined) {
  const raw = String(value || "").trim();
  const normalized = normalizeSetLabel(raw);
  return uniqueStrings([raw, normalized]);
}

function parallelCandidates(value: string | null | undefined) {
  const raw = String(value || "").trim();
  const normalized = normalizeParallelLabel(raw);
  const canonical = canonicalParallelLabel(raw);
  const alias = canonical ? PARALLEL_CANONICAL_TO_ALIAS[canonical.toUpperCase()] || "" : "";
  return uniqueStrings([raw, normalized, canonical, alias]);
}

function cardCandidates(value: string | null | undefined, options?: { includeLegacy?: boolean }) {
  const includeLegacy = options?.includeLegacy !== false;
  const raw = String(value || "").trim();
  const normalized = normalizeCardNumber(raw);
  const normalizedRawUpper = raw.toUpperCase();
  const values: Array<string | null> = [];

  if (normalized && normalized !== "ALL") {
    values.push(normalized);
  } else if (raw && normalizedRawUpper !== "ALL") {
    values.push(raw);
  }
  if (raw && normalizedRawUpper !== "ALL") {
    values.push(raw);
  }

  if (normalizedRawUpper === "ALL" || normalized === "ALL") {
    values.push("ALL");
    if (includeLegacy) values.push(null);
  } else if (includeLegacy) {
    values.push("ALL", null);
  }

  const seen = new Set<string>();
  const output: Array<string | null> = [];
  for (const entry of values) {
    const key = entry == null ? "__NULL__" : entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function toRow(reference: any): ReferenceRow {
  const rawPlayerSeed = String(reference.playerSeed || "").trim();
  const playerLabel = rawPlayerSeed ? rawPlayerSeed.split("::")[0]?.trim() || "" : "";
  const displayLabel = playerLabel || String(reference.parallelId || "");
  return {
    id: reference.id,
    setId: reference.setId,
    cardNumber: reference.cardNumber != null ? String(reference.cardNumber) : null,
    parallelId: reference.parallelId,
    displayLabel,
    refType: String(reference.refType || "front"),
    pairKey: reference.pairKey ?? null,
    sourceListingId: reference.sourceListingId ?? null,
    playerSeed: reference.playerSeed ?? null,
    storageKey: reference.storageKey ?? null,
    qaStatus: String(reference.qaStatus || "pending"),
    ownedStatus: String(reference.ownedStatus || "external"),
    promotedAt: reference.promotedAt ? reference.promotedAt.toISOString?.() ?? String(reference.promotedAt) : null,
    sourceUrl: reference.sourceUrl ?? null,
    rawImageUrl: reference.rawImageUrl,
    cropUrls: Array.isArray(reference.cropUrls) ? reference.cropUrls : [],
    qualityScore: typeof reference.qualityScore === "number" ? reference.qualityScore : null,
    createdAt: reference.createdAt?.toISOString?.() ?? String(reference.createdAt),
    updatedAt: reference.updatedAt?.toISOString?.() ?? String(reference.updatedAt),
  };
}

function parseListingId(url: string | null | undefined) {
  const value = String(url || "").trim();
  if (!value) return null;
  const pathMatch = value.match(/\/itm\/(?:[^/?#]+\/)?(\d{8,20})(?:[/?#]|$)/i);
  if (pathMatch?.[1]) return pathMatch[1];
  const queryMatch = value.match(/[?&](?:item|itemId|itm|itm_id)=(\d{8,20})(?:[&#]|$)/i);
  if (queryMatch?.[1]) return queryMatch[1];
  return null;
}

function keyFromStoredImage(value: string | null | undefined) {
  const input = String(value || "").trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    return managedStorageKeyFromUrl(input);
  }
  return input;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method === "GET") {
      const setId = typeof req.query.setId === "string" ? req.query.setId.trim() : "";
      const parallelId = typeof req.query.parallelId === "string" ? req.query.parallelId.trim() : "";
      const cardNumber = typeof req.query.cardNumber === "string" ? req.query.cardNumber.trim() : "";
      const refType = typeof req.query.refType === "string" ? req.query.refType.trim().toLowerCase() : "";
      const take = Math.min(5000, Math.max(1, Number(req.query.limit ?? 200) || 200));

      const andClauses: Record<string, any>[] = [];
      if (setId) {
        const setIds = setIdCandidates(setId);
        if (setIds.length === 1) {
          andClauses.push({ setId: setIds[0] });
        } else if (setIds.length > 1) {
          andClauses.push({ setId: { in: setIds } });
        }
      }
      if (parallelId) {
        const parallels = parallelCandidates(parallelId);
        if (parallels.length === 1) {
          andClauses.push({ parallelId: parallels[0] });
        } else if (parallels.length > 1) {
          andClauses.push({ parallelId: { in: parallels } });
        }
      }
      if (cardNumber) {
        const cards = cardCandidates(cardNumber, { includeLegacy: true });
        if (cards.length > 0) {
          andClauses.push({
            OR: cards.map((card) => (card == null ? { cardNumber: null } : { cardNumber: card })),
          });
        }
      }
      if (refType === "front" || refType === "back") {
        andClauses.push({ refType });
      }
      const where: Record<string, any> =
        andClauses.length === 0 ? {} : andClauses.length === 1 ? andClauses[0] : { AND: andClauses };

      let references: any[] = [];
      try {
        references = await prisma.cardVariantReferenceImage.findMany({
          where,
          orderBy: [{ createdAt: "desc" }],
          take,
          select: ({
            id: true,
            setId: true,
            cardNumber: true,
            parallelId: true,
            refType: true,
            pairKey: true,
            sourceListingId: true,
            playerSeed: true,
            storageKey: true,
            qaStatus: true,
            ownedStatus: true,
            promotedAt: true,
            sourceUrl: true,
            rawImageUrl: true,
            cropUrls: true,
            qualityScore: true,
            createdAt: true,
            updatedAt: true,
          } as any),
        });
      } catch {
        // Backward-compatible fallback when storage/QA columns are not live yet.
        references = await prisma.cardVariantReferenceImage.findMany({
          where,
          orderBy: [{ createdAt: "desc" }],
          take,
          select: ({
            id: true,
            setId: true,
            cardNumber: true,
            parallelId: true,
            refType: true,
            pairKey: true,
            sourceListingId: true,
            playerSeed: true,
            sourceUrl: true,
            rawImageUrl: true,
            cropUrls: true,
            qualityScore: true,
            createdAt: true,
            updatedAt: true,
          } as any),
        });
      }
      const mode = getStorageMode();
      const rows = await Promise.all(
        references.map(async (reference) => {
          const row = toRow(reference);
          if (mode === "s3") {
            const rawKey = row.storageKey || keyFromStoredImage(row.rawImageUrl);
            if (rawKey) {
              try {
                row.rawImageUrl = await presignReadUrl(rawKey, 60 * 30);
              } catch {
                // Keep persisted URL as fallback.
              }
            }
            if (Array.isArray(row.cropUrls) && row.cropUrls.length) {
              const signedCropUrls: string[] = [];
              for (const cropUrl of row.cropUrls) {
                const cropKey = keyFromStoredImage(cropUrl);
                if (!cropKey) {
                  signedCropUrls.push(cropUrl);
                  continue;
                }
                try {
                  signedCropUrls.push(await presignReadUrl(cropKey, 60 * 30));
                } catch {
                  signedCropUrls.push(cropUrl);
                }
              }
              row.cropUrls = signedCropUrls;
            }
          }
          return row;
        })
      );
      return res.status(200).json({ references: rows });
    }

    if (req.method === "POST") {
      const {
        setId,
        cardNumber,
        parallelId,
        refType,
        pairKey,
        sourceListingId,
        playerSeed,
        storageKey,
        rawImageUrl,
        sourceUrl,
        cropUrls,
        qualityScore,
      } = req.body ?? {};
      if (!setId || !parallelId || !rawImageUrl) {
        return res.status(400).json({ message: "Missing required fields." });
      }

      const normalizedCardNumber = cardNumber ? String(cardNumber).trim() : "ALL";
      const normalizedRefType = String(refType || "front").trim().toLowerCase() === "back" ? "back" : "front";
      const normalizedSourceUrl = sourceUrl ? String(sourceUrl).trim() : null;
      const derivedListingId = sourceListingId
        ? String(sourceListingId).trim()
        : parseListingId(normalizedSourceUrl);
      const normalizedPlayerSeed = playerSeed ? String(playerSeed).trim() : null;
      const normalizedPairKey = pairKey
        ? String(pairKey).trim()
        : derivedListingId
        ? `${String(setId).trim()}::${String(parallelId).trim()}::${normalizedPlayerSeed || "NA"}::${derivedListingId}`
        : null;

      let reference: any;
      try {
        reference = await prisma.cardVariantReferenceImage.create({
          data: ({
            setId: String(setId).trim(),
            cardNumber: normalizedCardNumber,
            parallelId: String(parallelId).trim(),
            refType: normalizedRefType,
            pairKey: normalizedPairKey,
            sourceListingId: derivedListingId,
            playerSeed: normalizedPlayerSeed,
            storageKey: storageKey ? String(storageKey).trim() : null,
            qaStatus: "pending",
            ownedStatus: storageKey ? "owned" : "external",
            promotedAt: storageKey ? new Date() : null,
            rawImageUrl: String(rawImageUrl).trim(),
            sourceUrl: normalizedSourceUrl,
            cropUrls: Array.isArray(cropUrls)
              ? cropUrls.map((entry: unknown) => String(entry).trim()).filter(Boolean)
              : [],
            qualityScore: typeof qualityScore === "number" ? qualityScore : null,
          } as any),
        });
      } catch {
        // Backward-compatible fallback when storageKey/cardNumber columns are not live.
        reference = await prisma.cardVariantReferenceImage.create({
          data: ({
            setId: String(setId).trim(),
            parallelId: String(parallelId).trim(),
            refType: normalizedRefType,
            pairKey: normalizedPairKey,
            sourceListingId: derivedListingId,
            playerSeed: normalizedPlayerSeed,
            rawImageUrl: String(rawImageUrl).trim(),
            sourceUrl: normalizedSourceUrl,
            cropUrls: Array.isArray(cropUrls)
              ? cropUrls.map((entry: unknown) => String(entry).trim()).filter(Boolean)
              : [],
            qualityScore: typeof qualityScore === "number" ? qualityScore : null,
          } as any),
        });
      }
      return res.status(200).json({ reference: toRow(reference) });
    }

    if (req.method === "PUT") {
      const qaStatusRaw = req.body?.qaStatus;
      const qaStatus =
        qaStatusRaw === "keep" || qaStatusRaw === "reject" || qaStatusRaw === "pending"
          ? qaStatusRaw
          : null;
      if (!qaStatus) {
        return res.status(400).json({ message: "qaStatus must be keep, reject, or pending." });
      }

      const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map((value: unknown) => String(value || "").trim()).filter(Boolean)
        : [];
      const targetIds = id ? [id] : ids;
      if (!targetIds.length) {
        return res.status(400).json({ message: "id or ids[] is required." });
      }
      try {
        await prisma.cardVariantReferenceImage.updateMany({
          where: { id: { in: targetIds } },
          data: { qaStatus } as any,
        });
      } catch {
        return res.status(400).json({ message: "QA status columns not available yet. Run latest database migrations." });
      }
      const references = await prisma.cardVariantReferenceImage.findMany({
        where: { id: { in: targetIds } },
      });
      return res.status(200).json({ references: references.map(toRow) } as any);
    }

    if (req.method === "DELETE") {
      const setId = typeof req.query.setId === "string" ? req.query.setId.trim() : "";
      if (setId) {
        const parallelId = typeof req.query.parallelId === "string" ? req.query.parallelId.trim() : "";
        const cardNumber = typeof req.query.cardNumber === "string" ? req.query.cardNumber.trim() : "";
        const includeOwned = String(req.query.includeOwned ?? "")
          .trim()
          .toLowerCase() === "true";

        const setIds = setIdCandidates(setId);
        const where: Record<string, any> = {};
        if (setIds.length === 1) {
          where.setId = setIds[0];
        } else if (setIds.length > 1) {
          where.setId = { in: setIds };
        } else {
          where.setId = setId;
        }
        if (parallelId) {
          const parallels = parallelCandidates(parallelId);
          if (parallels.length === 1) {
            where.parallelId = parallels[0];
          } else if (parallels.length > 1) {
            where.parallelId = { in: parallels };
          } else {
            where.parallelId = parallelId;
          }
        }
        if (cardNumber) {
          const cards = cardCandidates(cardNumber, { includeLegacy: false });
          if (cards.length === 1) {
            where.cardNumber = cards[0];
          } else if (cards.length > 1) {
            where.cardNumber = { in: cards.filter((value): value is string => value != null) };
          } else {
            where.cardNumber = cardNumber;
          }
        }
        if (!includeOwned) {
          where.ownedStatus = { not: "owned" };
        }

        let deleted = 0;
        try {
          const result = await prisma.cardVariantReferenceImage.deleteMany({
            where: where as any,
          });
          deleted = Number(result?.count ?? 0);
        } catch {
          // Backward-compatible fallback if ownedStatus filtering is unavailable.
          const fallbackWhere: Record<string, any> = {
            setId: where.setId,
          };
          if (where.parallelId !== undefined) fallbackWhere.parallelId = where.parallelId;
          if (where.cardNumber !== undefined) fallbackWhere.cardNumber = where.cardNumber;
          if (!includeOwned) {
            fallbackWhere.qaStatus = { in: ["pending", "reject"] };
          }
          const result = await prisma.cardVariantReferenceImage.deleteMany({
            where: fallbackWhere as any,
          });
          deleted = Number(result?.count ?? 0);
        }

        return res.status(200).json({ ok: true, deleted });
      }

      const id = typeof req.query.id === "string" ? req.query.id : "";
      if (!id) {
        return res.status(400).json({ message: "Missing reference id." });
      }
      await prisma.cardVariantReferenceImage.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,PUT,DELETE");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
