import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { createOcrRegionTeachEvent } from "../../../../../lib/server/ocrRegionTeachEvents";

type TeachTelemetryResponse = { ok: true } | { message: string };

function getStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<TeachTelemetryResponse>) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
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

    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    await createOcrRegionTeachEvent({
      cardAssetId: cardId,
      setId: getStringValue(body.setId),
      layoutClass: getStringValue(body.layoutClass),
      photoSide: getStringValue(body.photoSide),
      eventType: "CLIENT_ERROR",
      debugPayload: body,
      createdById: admin.user.id,
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
