import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { listOcrRegionTemplates, upsertOcrRegionTemplates } from "../../../../../lib/server/ocrRegionTemplates";

type RegionTeachResponse =
  | {
      setId: string | null;
      layoutClass: string;
      templatesBySide: Record<"FRONT" | "BACK" | "TILT", Array<Record<string, unknown>>>;
      sampleCountBySide: Record<"FRONT" | "BACK" | "TILT", number>;
      updatedCount?: number;
    }
  | { message: string };

function getStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<RegionTeachResponse>) {
  try {
    const admin = await requireAdminSession(req);
    const cardId = getStringValue(req.query.cardId);
    if (!cardId) {
      return res.status(400).json({ message: "cardId is required" });
    }
    const card = await prisma.cardAsset.findFirst({
      where: { id: cardId },
      select: { id: true },
    });
    if (!card) {
      return res.status(404).json({ message: "Card not found" });
    }

    if (req.method === "GET") {
      const setId = getStringValue(req.query.setId);
      if (!setId) {
        return res.status(400).json({ message: "setId is required" });
      }
      const layoutClass = getStringValue(req.query.layoutClass) ?? "base";
      const templates = await listOcrRegionTemplates({ setId, layoutClass });
      return res.status(200).json({
        setId: templates.setId,
        layoutClass: templates.layoutClass,
        templatesBySide: templates.templatesBySide as Record<"FRONT" | "BACK" | "TILT", Array<Record<string, unknown>>>,
        sampleCountBySide: templates.sampleCountBySide,
      });
    }

    if (req.method === "POST") {
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const setId = getStringValue(body.setId);
      if (!setId) {
        return res.status(400).json({ message: "setId is required" });
      }
      const layoutClass = getStringValue(body.layoutClass) ?? "base";
      const templates = Array.isArray(body.templates) ? (body.templates as Array<Record<string, unknown>>) : [];
      if (!templates.length) {
        return res.status(400).json({ message: "templates are required" });
      }
      const result = await upsertOcrRegionTemplates({
        setId,
        layoutClass,
        createdById: admin.user.id,
        templates: templates.map((entry) => ({
          photoSide: getStringValue(entry.photoSide) ?? "",
          regions: Array.isArray(entry.regions) ? entry.regions : [],
        })),
      });
      return res.status(200).json({
        setId: result.setId,
        layoutClass: result.layoutClass,
        templatesBySide: result.templatesBySide as Record<"FRONT" | "BACK" | "TILT", Array<Record<string, unknown>>>,
        sampleCountBySide: result.sampleCountBySide,
        updatedCount: result.updatedCount,
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
