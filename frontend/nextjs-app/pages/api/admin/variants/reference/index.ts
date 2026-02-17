import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

type ReferenceRow = {
  id: string;
  setId: string;
  parallelId: string;
  refType: string;
  pairKey: string | null;
  sourceListingId: string | null;
  playerSeed: string | null;
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
  | { ok: true }
  | { message: string };

function toRow(reference: any): ReferenceRow {
  return {
    id: reference.id,
    setId: reference.setId,
    parallelId: reference.parallelId,
    refType: String(reference.refType || "front"),
    pairKey: reference.pairKey ?? null,
    sourceListingId: reference.sourceListingId ?? null,
    playerSeed: reference.playerSeed ?? null,
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

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method === "GET") {
      const setId = typeof req.query.setId === "string" ? req.query.setId.trim() : "";
      const parallelId = typeof req.query.parallelId === "string" ? req.query.parallelId.trim() : "";
      const refType = typeof req.query.refType === "string" ? req.query.refType.trim().toLowerCase() : "";
      const take = Math.min(500, Math.max(1, Number(req.query.limit ?? 200) || 200));

      const where: Record<string, any> = {};
      if (setId) where.setId = setId;
      if (parallelId) where.parallelId = parallelId;
      if (refType === "front" || refType === "back") where.refType = refType;

      const references = await prisma.cardVariantReferenceImage.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        take,
      });
      return res.status(200).json({ references: references.map(toRow) });
    }

    if (req.method === "POST") {
      const {
        setId,
        parallelId,
        refType,
        pairKey,
        sourceListingId,
        playerSeed,
        rawImageUrl,
        sourceUrl,
        cropUrls,
        qualityScore,
      } = req.body ?? {};
      if (!setId || !parallelId || !rawImageUrl) {
        return res.status(400).json({ message: "Missing required fields." });
      }

      const normalizedRefType = String(refType || "front").trim().toLowerCase() === "back" ? "back" : "front";
      const normalizedSourceUrl = sourceUrl ? String(sourceUrl).trim() : null;
      const derivedListingId = sourceListingId
        ? String(sourceListingId).trim()
        : parseListingId(normalizedSourceUrl);
      const normalizedPairKey = pairKey
        ? String(pairKey).trim()
        : derivedListingId
        ? `${String(setId).trim()}::${String(parallelId).trim()}::${derivedListingId}`
        : null;

      const reference = await prisma.cardVariantReferenceImage.create({
        data: {
          setId: String(setId).trim(),
          parallelId: String(parallelId).trim(),
          refType: normalizedRefType,
          pairKey: normalizedPairKey,
          sourceListingId: derivedListingId,
          playerSeed: playerSeed ? String(playerSeed).trim() : null,
          rawImageUrl: String(rawImageUrl).trim(),
          sourceUrl: normalizedSourceUrl,
          cropUrls: Array.isArray(cropUrls)
            ? cropUrls.map((entry: unknown) => String(entry).trim()).filter(Boolean)
            : [],
          qualityScore: typeof qualityScore === "number" ? qualityScore : null,
        },
      });
      return res.status(200).json({ reference: toRow(reference) });
    }

    if (req.method === "DELETE") {
      const id = typeof req.query.id === "string" ? req.query.id : "";
      if (!id) {
        return res.status(400).json({ message: "Missing reference id." });
      }
      await prisma.cardVariantReferenceImage.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET,POST,DELETE");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
