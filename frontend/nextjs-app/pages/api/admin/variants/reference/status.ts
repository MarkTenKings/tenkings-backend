import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

type ResponseBody =
  | { total: number; pending: number; processed: number }
  | { message: string };

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeCommonSetEntities(value: string) {
  return value
    .replace(/&#0*38;/gi, "&")
    .replace(/&#0*038;/gi, "&")
    .replace(/&amp;/gi, "&");
}

function withAmpersandVariants(value: string) {
  if (!value || !value.includes("&")) {
    return [value];
  }
  return [
    value,
    value.replace(/&/g, "&amp;"),
    value.replace(/&/g, "&#038;"),
    value.replace(/&/g, "&#38;"),
  ];
}

function buildSetIdCandidates(rawSetId: string) {
  const raw = compactWhitespace(rawSetId || "");
  if (!raw) return [];

  const normalized = compactWhitespace(normalizeSetLabel(raw));
  const decodedRaw = compactWhitespace(decodeCommonSetEntities(raw));
  const decodedNormalized = compactWhitespace(decodeCommonSetEntities(normalized));
  const baseValues = Array.from(new Set([raw, normalized, decodedRaw, decodedNormalized].filter(Boolean)));
  const candidates = new Set<string>();

  for (const base of baseValues) {
    for (const variant of withAmpersandVariants(base)) {
      const next = compactWhitespace(variant);
      if (next) candidates.add(next);
    }
  }

  return Array.from(candidates);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const rawSetId = typeof req.query.setId === "string" ? req.query.setId : "";
    const setIdCandidates = buildSetIdCandidates(rawSetId);
    const setWhere: Prisma.CardVariantReferenceImageWhereInput | undefined =
      setIdCandidates.length > 0
        ? {
            OR: setIdCandidates.map((setId) => ({
              setId: {
                equals: setId,
                mode: Prisma.QueryMode.insensitive,
              },
            })),
          }
        : undefined;

    const total = await prisma.cardVariantReferenceImage.count({ where: setWhere });
    const pendingWhere: Prisma.CardVariantReferenceImageWhereInput = {
      ...(setWhere
        ? {
            AND: [setWhere],
          }
        : {}),
      OR: [{ qualityScore: null }, { cropEmbeddings: { equals: Prisma.JsonNull } }],
    };
    const pending = await prisma.cardVariantReferenceImage.count({
      where: pendingWhere,
    });
    const processed = Math.max(0, total - pending);

    return res.status(200).json({ total, pending, processed });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
