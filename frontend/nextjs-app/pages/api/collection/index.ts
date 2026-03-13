import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireUserSession, toUserErrorResponse } from "../../../lib/server/session";
import { sanitizeListImageUrl } from "../../../lib/server/storage";

const stripDataUrls = (value: unknown): unknown => {
  if (typeof value === "string") {
    return /^data:/i.test(value.trim()) ? null : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stripDataUrls(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, stripDataUrls(entry)])
    );
  }
  return value;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await requireUserSession(req);

    const items = await prisma.item.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        shippingRequest: true,
        ingestionTask: true,
        packSlots: {
          include: {
            packInstance: {
              select: {
                id: true,
                packDefinitionId: true,
                packDefinition: { select: { name: true, price: true, tier: true, category: true } },
              },
            },
          },
        },
      },
    });

    const payload = items.map((item) => {
      const slot = item.packSlots[0];
      const ingestionPayload =
        (item.ingestionTask?.rawPayload as { imageUrl?: string; thumbnailUrl?: string } | undefined) ?? undefined;
      return {
        id: item.id,
        name: item.name,
        set: item.set,
        number: item.number,
        language: item.language,
        foil: item.foil,
        estimatedValue: item.estimatedValue,
        status: item.status,
        vaultLocation: item.vaultLocation,
        imageUrl: sanitizeListImageUrl(item.imageUrl) ?? sanitizeListImageUrl(ingestionPayload?.imageUrl),
        thumbnailUrl:
          sanitizeListImageUrl(item.thumbnailUrl) ?? sanitizeListImageUrl(ingestionPayload?.thumbnailUrl),
        cdnHdUrl: item.cdnHdUrl ?? null,
        cdnThumbUrl: item.cdnThumbUrl ?? null,
        details:
          (stripDataUrls(
            item.detailsJson ?? (item.ingestionTask?.rawPayload as Record<string, unknown> | null) ?? null
          ) as Record<string, unknown> | null) ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        pack: slot
          ? {
              packId: slot.packInstanceId,
              definitionId: slot.packInstance.packDefinitionId,
              definitionName: slot.packInstance.packDefinition?.name ?? null,
              tier: slot.packInstance.packDefinition?.tier ?? null,
              category: slot.packInstance.packDefinition?.category ?? null,
            }
          : null,
        shippingRequest: item.shippingRequest
          ? {
              id: item.shippingRequest.id,
              status: item.shippingRequest.status,
              processingFeeMinor: item.shippingRequest.processingFeeMinor,
              shippingFeeMinor: item.shippingRequest.shippingFeeMinor,
              totalFeeMinor: item.shippingRequest.totalFeeMinor,
              notes: item.shippingRequest.notes,
              trackingNumber: item.shippingRequest.trackingNumber,
              carrier: item.shippingRequest.carrier,
              fulfilledAt: item.shippingRequest.fulfilledAt
                ? item.shippingRequest.fulfilledAt.toISOString()
                : null,
              createdAt: item.shippingRequest.createdAt.toISOString(),
              updatedAt: item.shippingRequest.updatedAt.toISOString(),
            }
          : null,
      };
    });

    res.status(200).json({ items: payload });
  } catch (error) {
    const result = toUserErrorResponse(error);
    res.status(result.status).json({ message: result.message });
  }
}
