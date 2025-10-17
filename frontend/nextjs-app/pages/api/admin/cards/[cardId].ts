import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, Prisma } from "@tenkings/database";
import { buildEbaySoldUrlFromText, type CardAttributes } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

interface CardNotePayload {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

interface SportsDbSummary {
  playerId: string | null;
  matchConfidence: number;
  playerName: string | null;
  teamName: string | null;
  teamLogoUrl: string | null;
  sport: string | null;
  league: string | null;
  snapshot: Record<string, unknown> | null;
}

interface CardResponse {
  id: string;
  batchId: string;
  status: string;
  fileName: string;
  fileSize: number;
  imageUrl: string;
  thumbnailUrl: string | null;
  mimeType: string;
  ocrText: string | null;
  classification: CardAttributes | null;
  customTitle: string | null;
  customDetails: string | null;
  valuationMinor: number | null;
  valuationCurrency: string | null;
  valuationSource: string | null;
  marketplaceUrl: string | null;
  ebaySoldUrl: string | null;
  ebaySoldUrlVariant: string | null;
  ebaySoldUrlHighGrade: string | null;
  ebaySoldUrlPlayerComp: string | null;
  assignedDefinitionId: string | null;
  assignedAt: string | null;
  notes: CardNotePayload[];
  createdAt: string;
  updatedAt: string;
  humanReviewedAt: string | null;
  humanReviewerName: string | null;
  sportsDb: SportsDbSummary;
}


type CardUpdatePayload = {
  ocrText?: string | null;
  customTitle?: string | null;
  customDetails?: string | null;
  valuationMinor?: number | null;
  valuationCurrency?: string | null;
  valuationSource?: string | null;
  marketplaceUrl?: string | null;
  ebaySoldUrl?: string | null;
  humanReviewed?: boolean;
  generateEbaySoldUrl?: boolean;
};

async function fetchCard(cardId: string, uploadedById: string): Promise<CardResponse | null> {
  const card = await prisma.cardAsset.findFirst({
    where: { id: cardId, batch: { uploadedById } },
    include: {
      batch: true,
      notes: {
        orderBy: { createdAt: "desc" },
        include: {
          author: {
            select: { id: true, displayName: true },
          },
        },
      },
      humanReviewer: {
        select: { id: true, displayName: true },
      },
      sportsDbPlayer: {
        select: {
          id: true,
          fullName: true,
          sport: true,
          league: true,
          headshotUrl: true,
          team: {
            select: {
              id: true,
              name: true,
              logoUrl: true,
            },
          },
        },
      },
    },
  });

  if (!card) {
    return null;
  }

  return {
    id: card.id,
    batchId: card.batchId,
    status: card.status,
    fileName: card.fileName,
    fileSize: card.fileSize,
    imageUrl: card.imageUrl,
    thumbnailUrl: card.thumbnailUrl,
    mimeType: card.mimeType,
    ocrText: card.ocrText,
    classification: (card.classificationJson as CardAttributes | null) ?? null,
    customTitle: card.customTitle ?? null,
    customDetails: card.customDetails ?? null,
    valuationMinor: card.valuationMinor ?? null,
    valuationCurrency: card.valuationCurrency ?? null,
    valuationSource: card.valuationSource ?? null,
    marketplaceUrl: card.marketplaceUrl ?? null,
    ebaySoldUrl: card.ebaySoldUrl ?? null,
    ebaySoldUrlVariant: card.ebaySoldUrlVariant ?? null,
    ebaySoldUrlHighGrade: card.ebaySoldUrlHighGrade ?? null,
    ebaySoldUrlPlayerComp: card.ebaySoldUrlPlayerComp ?? null,
    assignedDefinitionId: card.assignedDefinitionId,
    assignedAt: card.assignedAt ? card.assignedAt.toISOString() : null,
    notes: card.notes.map((note) => ({
      id: note.id,
      authorId: note.authorId,
      authorName: note.author?.displayName ?? null,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    })),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    humanReviewedAt: card.humanReviewedAt ? card.humanReviewedAt.toISOString() : null,
    humanReviewerName: card.humanReviewer?.displayName ?? card.humanReviewer?.id ?? null,
    sportsDb: {
      playerId: card.sportsDbPlayerId ?? null,
      matchConfidence: card.sportsDbMatchConfidence ?? 0,
      playerName: card.resolvedPlayerName ?? card.sportsDbPlayer?.fullName ?? null,
      teamName: card.resolvedTeamName ?? card.sportsDbPlayer?.team?.name ?? null,
      teamLogoUrl: card.sportsDbPlayer?.team?.logoUrl ?? null,
      sport: card.sportsDbPlayer?.sport ?? null,
      league: card.sportsDbPlayer?.league ?? null,
      snapshot: (card.playerStatsSnapshot as Record<string, unknown> | null) ?? null,
    },
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CardResponse | { message: string }>
) {
  try {
    const admin = await requireAdminSession(req);
    const { cardId } = req.query;

    if (typeof cardId !== "string" || !cardId.trim()) {
      return res.status(400).json({ message: "cardId is required" });
    }

    if (req.method === "GET") {
      const card = await fetchCard(cardId, admin.user.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      return res.status(200).json(card);
    }

    if (req.method === "PATCH") {
      const body = (req.body ?? {}) as CardUpdatePayload;
      const card = await prisma.cardAsset.findFirst({
        where: { id: cardId, batch: { uploadedById: admin.user.id } },
        select: {
          id: true,
          ocrText: true,
          humanReviewedAt: true,
          humanReviewedById: true,
        },
      });

      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const updateData: Prisma.CardAssetUpdateInput = {};
      const updateDataAny = updateData as Record<string, unknown>;
      let touched = false;

      if (Object.prototype.hasOwnProperty.call(body, "ocrText")) {
        updateData.ocrText = body.ocrText ? body.ocrText.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "customTitle")) {
        updateData.customTitle = body.customTitle ? body.customTitle.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "customDetails")) {
        updateData.customDetails = body.customDetails ? body.customDetails.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "valuationMinor")) {
        updateData.valuationMinor = body.valuationMinor === null ? null : body.valuationMinor ?? null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "valuationCurrency")) {
        updateData.valuationCurrency = body.valuationCurrency ? body.valuationCurrency.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "valuationSource")) {
        updateData.valuationSource = body.valuationSource ? body.valuationSource.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "marketplaceUrl")) {
        updateData.marketplaceUrl = body.marketplaceUrl ? body.marketplaceUrl.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "ebaySoldUrl")) {
        updateDataAny.ebaySoldUrl = body.ebaySoldUrl ? body.ebaySoldUrl.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "humanReviewed")) {
        if (body.humanReviewed) {
          if (!card.humanReviewedAt) {
            updateData.humanReviewedAt = new Date();
            updateData.humanReviewer = { connect: { id: admin.user.id } };
          }
        } else {
          updateData.humanReviewedAt = null;
          updateData.humanReviewer = { disconnect: true };
        }
        touched = true;
      }

      if (body.generateEbaySoldUrl) {
        const sourceText = typeof body.ocrText === "string" ? body.ocrText : card.ocrText;
        const generated = buildEbaySoldUrlFromText(sourceText);
        updateDataAny.ebaySoldUrl = generated;
        touched = true;
      }

      if (!touched) {
        return res.status(400).json({ message: "No fields provided" });
      }

      await prisma.cardAsset.update({
        where: { id: card.id },
        data: updateData,
      });

      const updated = await fetchCard(cardId, admin.user.id);
      if (!updated) {
        return res.status(500).json({ message: "Card updated but could not be retrieved" });
      }

      return res.status(200).json(updated);
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
