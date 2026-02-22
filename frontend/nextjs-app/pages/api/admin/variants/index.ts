import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, SetApprovalDecision } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { getStorageMode, managedStorageKeyFromUrl, presignReadUrl } from "../../../../lib/server/storage";
import { extractDraftRows } from "../../../../lib/server/setOpsDrafts";

type VariantRow = {
  id: string;
  setId: string;
  cardNumber: string;
  parallelId: string;
  parallelFamily: string | null;
  playerLabel: string | null;
  keywords: string[];
  oddsInfo: string | null;
  referenceCount: number;
  qaDoneCount: number;
  previewImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type ResponseBody =
  | { variants: VariantRow[] }
  | { variant: VariantRow }
  | { ok: true }
  | { message: string };

function keyFromStoredImage(value: string | null | undefined) {
  const input = String(value || "").trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    return managedStorageKeyFromUrl(input);
  }
  return input;
}

function normalizeCardToken(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "ALL";
  if (raw.toUpperCase() === "ALL") return "ALL";
  return raw;
}

function dbCardValuesForVariant(cardNumber: string) {
  const normalized = normalizeCardToken(cardNumber);
  if (normalized === "ALL") return ["ALL", null] as const;
  return [normalized, "ALL", null] as const;
}

function keyForRef(setId: string, cardNumber: string | null | undefined, parallelId: string) {
  const card = cardNumber == null ? "__NULL__" : normalizeCardToken(cardNumber);
  return `${setId}::${card}::${parallelId}`;
}

function normalizePlayerLabel(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = raw.split("::")[0]?.trim() ?? "";
  return direct;
}

function joinPlayerLabels(labels: Set<string>) {
  return Array.from(labels)
    .map((label) => String(label || "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" / ");
}

function filterLegacyAllVariants(variants: any[]) {
  const specificBySetParallel = new Set<string>();
  for (const variant of variants) {
    if (normalizeCardToken(variant.cardNumber) === "ALL") continue;
    specificBySetParallel.add(
      `${String(variant.setId || "").trim().toLowerCase()}::${String(variant.parallelId || "").trim().toLowerCase()}`
    );
  }
  return variants.filter((variant) => {
    const card = normalizeCardToken(variant.cardNumber);
    if (card !== "ALL") return true;
    const key = `${String(variant.setId || "").trim().toLowerCase()}::${String(variant.parallelId || "").trim().toLowerCase()}`;
    return !specificBySetParallel.has(key);
  });
}

function toRow(
  variant: any,
  extras?: {
    referenceCount?: number;
    qaDoneCount?: number;
    previewImageUrl?: string | null;
    playerLabel?: string | null;
  }
): VariantRow {
  return {
    id: variant.id,
    setId: variant.setId,
    cardNumber: variant.cardNumber,
    parallelId: variant.parallelId,
    parallelFamily: variant.parallelFamily ?? null,
    playerLabel: extras?.playerLabel ?? null,
    keywords: Array.isArray(variant.keywords) ? variant.keywords : [],
    oddsInfo: variant.oddsInfo ?? null,
    referenceCount: Math.max(0, Number(extras?.referenceCount ?? 0) || 0),
    qaDoneCount: Math.max(0, Number(extras?.qaDoneCount ?? 0) || 0),
    previewImageUrl: extras?.previewImageUrl ?? null,
    createdAt: variant.createdAt?.toISOString?.() ?? String(variant.createdAt),
    updatedAt: variant.updatedAt?.toISOString?.() ?? String(variant.updatedAt),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method === "GET") {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const setIdFilter = typeof req.query.setId === "string" ? req.query.setId.trim() : "";
      const take = Math.min(2000, Math.max(1, Number(req.query.limit ?? 1000) || 1000));
      const gapOnly = String(req.query.gapOnly || "").trim().toLowerCase() === "true";
      const minRefs = Math.max(1, Number(req.query.minRefs ?? 2) || 2);
      const whereClauses: Prisma.CardVariantWhereInput[] = [];
      if (setIdFilter) {
        whereClauses.push({ setId: setIdFilter });
      }
      if (q) {
        whereClauses.push({
          OR: [
            { setId: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { cardNumber: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { parallelId: { contains: q, mode: Prisma.QueryMode.insensitive } },
          ],
        });
      }
      const where =
        whereClauses.length === 0
          ? {}
          : whereClauses.length === 1
          ? whereClauses[0]
          : { AND: whereClauses };

      const variants = await prisma.cardVariant.findMany({
        where,
        orderBy: [{ setId: "asc" }, { cardNumber: "asc" }, { parallelId: "asc" }],
        take,
      });
      const filteredVariants = filterLegacyAllVariants(variants);
      const keys = filteredVariants.map((variant) => ({
        setId: variant.setId,
        cardNumber: variant.cardNumber,
        parallelId: variant.parallelId,
      }));
      const countOr = keys.flatMap((key) =>
        dbCardValuesForVariant(key.cardNumber).map((card) => ({
          setId: key.setId,
          cardNumber: card,
          parallelId: key.parallelId,
        }))
      );
      const referenceCounts = countOr.length
        ? await prisma.cardVariantReferenceImage.groupBy({
            by: ["setId", "cardNumber", "parallelId"],
            where: { OR: countOr },
            _count: { _all: true },
          })
        : [];
      let qaDoneRows: Array<{
        setId: string;
        cardNumber: string | null;
        parallelId: string;
      }> = [];
      if (countOr.length) {
        try {
          qaDoneRows = await prisma.cardVariantReferenceImage.findMany({
            where: ({
              AND: [
                { OR: countOr },
                {
                  OR: [{ qaStatus: "keep" }, { ownedStatus: "owned" }],
                },
              ],
            } as any),
            distinct: ["setId", "cardNumber", "parallelId"],
            select: ({
              setId: true,
              cardNumber: true,
              parallelId: true,
            } as any),
          });
        } catch {
          qaDoneRows = [];
        }
      }
      let latestRefs: any[] = [];
      if (countOr.length) {
        try {
          latestRefs = await prisma.cardVariantReferenceImage.findMany({
            where: { OR: countOr },
            orderBy: [{ updatedAt: "desc" }],
            distinct: ["setId", "cardNumber", "parallelId"],
            select: ({
              setId: true,
              cardNumber: true,
              parallelId: true,
              playerSeed: true,
              storageKey: true,
              cropUrls: true,
              rawImageUrl: true,
            } as any),
          });
        } catch {
          // Backward-compatible fallback when storageKey column/schema is not live.
          latestRefs = await prisma.cardVariantReferenceImage.findMany({
            where: { OR: keys },
            orderBy: [{ updatedAt: "desc" }],
            distinct: ["setId", "cardNumber", "parallelId"],
            select: ({
              setId: true,
              cardNumber: true,
              parallelId: true,
              playerSeed: true,
              cropUrls: true,
              rawImageUrl: true,
            } as any),
          });
        }
      }

      const countByKey = new Map<string, number>();
      for (const row of referenceCounts) {
        countByKey.set(keyForRef(row.setId, (row as any).cardNumber ?? null, row.parallelId), row._count._all);
      }
      const qaDoneByKey = new Map<string, number>();
      for (const row of qaDoneRows) {
        qaDoneByKey.set(keyForRef(row.setId, row.cardNumber ?? null, row.parallelId), 1);
      }
      const previewByKey = new Map<string, string>();
      const refPlayerByKey = new Map<string, string>();
      const mode = getStorageMode();
      for (const row of latestRefs) {
        const cropUrls = Array.isArray((row as any).cropUrls) ? ((row as any).cropUrls as string[]) : [];
        const rawImageUrl = String((row as any).rawImageUrl || "");
        const storageKey = String((row as any).storageKey || "").trim();
        let preview = cropUrls[0] || rawImageUrl;
        const keyForPreview = storageKey || keyFromStoredImage(preview);
        if (mode === "s3" && keyForPreview) {
          try {
            preview = await presignReadUrl(keyForPreview, 60 * 30);
          } catch {
            // Keep persisted URL fallback.
          }
        }
        if (!preview) continue;
        const key = keyForRef(row.setId, (row as any).cardNumber ?? null, row.parallelId);
        previewByKey.set(key, preview);
        const refPlayerLabel = normalizePlayerLabel((row as any).playerSeed);
        if (refPlayerLabel) {
          refPlayerByKey.set(key, refPlayerLabel);
        }
      }

      const draftPlayerByKey = new Map<string, string>();
      const setIds = Array.from(new Set(filteredVariants.map((variant) => normalizeSetLabel(variant.setId))));
      if (setIds.length > 0) {
        const drafts = await prisma.setDraft.findMany({
          where: {
            setId: {
              in: setIds,
            },
          },
          select: {
            id: true,
            setId: true,
          },
        });
        const draftIds = drafts.map((draft) => draft.id);

        if (draftIds.length > 0) {
          const approvals = await prisma.setApproval.findMany({
            where: {
              draftId: {
                in: draftIds,
              },
              decision: SetApprovalDecision.APPROVED,
            },
            orderBy: [{ createdAt: "desc" }],
            select: {
              draftId: true,
              draftVersionId: true,
            },
          });

          const latestVersionByDraftId = new Map<string, string>();
          for (const approval of approvals) {
            if (!latestVersionByDraftId.has(approval.draftId)) {
              latestVersionByDraftId.set(approval.draftId, approval.draftVersionId);
            }
          }

          const versionIds = Array.from(new Set(Array.from(latestVersionByDraftId.values())));
          const versions =
            versionIds.length > 0
              ? await prisma.setDraftVersion.findMany({
                  where: {
                    id: {
                      in: versionIds,
                    },
                  },
                  select: {
                    id: true,
                    dataJson: true,
                  },
                })
              : [];

          const versionById = new Map(versions.map((version) => [version.id, version]));
          const playersByVariantKey = new Map<string, Set<string>>();

          for (const draft of drafts) {
            const versionId = latestVersionByDraftId.get(draft.id);
            if (!versionId) continue;
            const version = versionById.get(versionId);
            if (!version) continue;

            const normalizedSetId = normalizeSetLabel(draft.setId);
            const rows = extractDraftRows(version.dataJson);
            for (const row of rows) {
              if (normalizeSetLabel(row.setId) !== normalizedSetId) continue;
              const playerLabel = normalizePlayerLabel(row.playerSeed);
              if (!playerLabel) continue;
              const key = keyForRef(normalizedSetId, row.cardNumber, row.parallel);
              if (!playersByVariantKey.has(key)) {
                playersByVariantKey.set(key, new Set<string>());
              }
              playersByVariantKey.get(key)?.add(playerLabel);
            }
          }

          for (const [key, labels] of playersByVariantKey.entries()) {
            const joined = joinPlayerLabels(labels);
            if (joined) {
              draftPlayerByKey.set(key, joined);
            }
          }
        }
      }

      const rows = filteredVariants.map((variant) => {
        const candidateCards = dbCardValuesForVariant(variant.cardNumber);
        const exactCard = normalizeCardToken(variant.cardNumber);
        const exactCount =
          countByKey.get(keyForRef(variant.setId, exactCard === "ALL" ? "ALL" : exactCard, variant.parallelId)) ?? 0;
        const legacyCount =
          (countByKey.get(keyForRef(variant.setId, "ALL", variant.parallelId)) ?? 0) +
          (countByKey.get(keyForRef(variant.setId, null, variant.parallelId)) ?? 0);
        const referenceCount = exactCount > 0 ? exactCount : legacyCount;
        const exactDoneCount =
          qaDoneByKey.get(keyForRef(variant.setId, exactCard === "ALL" ? "ALL" : exactCard, variant.parallelId)) ?? 0;
        const legacyDoneCount =
          (qaDoneByKey.get(keyForRef(variant.setId, "ALL", variant.parallelId)) ?? 0) +
          (qaDoneByKey.get(keyForRef(variant.setId, null, variant.parallelId)) ?? 0);
        const qaDoneCount = exactDoneCount > 0 ? exactDoneCount : legacyDoneCount;
        const previewImageUrl =
          previewByKey.get(
            keyForRef(variant.setId, exactCard === "ALL" ? "ALL" : exactCard, variant.parallelId)
          ) ||
          candidateCards.map((card) => previewByKey.get(keyForRef(variant.setId, card, variant.parallelId)) || null).find(Boolean) ||
          null;
        const playerLabel =
          draftPlayerByKey.get(keyForRef(variant.setId, exactCard === "ALL" ? "ALL" : exactCard, variant.parallelId)) ||
          candidateCards
            .map((card) => draftPlayerByKey.get(keyForRef(variant.setId, card, variant.parallelId)) || null)
            .find(Boolean) ||
          refPlayerByKey.get(keyForRef(variant.setId, exactCard === "ALL" ? "ALL" : exactCard, variant.parallelId)) ||
          candidateCards
            .map((card) => refPlayerByKey.get(keyForRef(variant.setId, card, variant.parallelId)) || null)
            .find(Boolean) ||
          null;
        return toRow(variant, {
          referenceCount,
          qaDoneCount,
          previewImageUrl,
          playerLabel,
        });
      });
      const filtered = gapOnly ? rows.filter((row) => row.referenceCount < minRefs) : rows;
      filtered.sort((a, b) => {
        const aDone = a.qaDoneCount > 0;
        const bDone = b.qaDoneCount > 0;
        if (aDone !== bDone) return aDone ? 1 : -1;
        const diff = a.referenceCount - b.referenceCount;
        if (diff !== 0) return diff;
        return (
          a.setId.localeCompare(b.setId) ||
          a.cardNumber.localeCompare(b.cardNumber) ||
          a.parallelId.localeCompare(b.parallelId)
        );
      });

      return res.status(200).json({ variants: filtered });
    }

    if (req.method === "POST") {
      const { setId, cardNumber, parallelId, parallelFamily, keywords, oddsInfo } = req.body ?? {};
      if (!setId || !cardNumber || !parallelId) {
        return res.status(400).json({ message: "Missing required fields." });
      }
      const variant = await prisma.cardVariant.create({
        data: {
          setId: String(setId).trim(),
          cardNumber: String(cardNumber).trim(),
          parallelId: String(parallelId).trim(),
          parallelFamily: parallelFamily ? String(parallelFamily).trim() : null,
          keywords: Array.isArray(keywords)
            ? keywords.map((entry: unknown) => String(entry).trim()).filter(Boolean)
            : [],
          oddsInfo: oddsInfo ? String(oddsInfo).trim() : null,
        },
      });
      return res.status(200).json({ variant: toRow(variant) });
    }

    if (req.method === "PUT") {
      const { id, setId, cardNumber, parallelId, parallelFamily, keywords, oddsInfo } = req.body ?? {};
      if (!id) {
        return res.status(400).json({ message: "Missing variant id." });
      }
      const variant = await prisma.cardVariant.update({
        where: { id: String(id) },
        data: {
          ...(setId ? { setId: String(setId).trim() } : {}),
          ...(cardNumber ? { cardNumber: String(cardNumber).trim() } : {}),
          ...(parallelId ? { parallelId: String(parallelId).trim() } : {}),
          ...(parallelFamily !== undefined
            ? { parallelFamily: parallelFamily ? String(parallelFamily).trim() : null }
            : {}),
          ...(keywords !== undefined
            ? {
                keywords: Array.isArray(keywords)
                  ? keywords.map((entry: unknown) => String(entry).trim()).filter(Boolean)
                  : [],
              }
            : {}),
          ...(oddsInfo !== undefined ? { oddsInfo: oddsInfo ? String(oddsInfo).trim() : null } : {}),
        },
      });
      return res.status(200).json({ variant: toRow(variant) });
    }

    if (req.method === "DELETE") {
      const id = typeof req.query.id === "string" ? req.query.id : "";
      if (!id) {
        return res.status(400).json({ message: "Missing variant id." });
      }
      await prisma.cardVariant.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,PUT,DELETE");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
