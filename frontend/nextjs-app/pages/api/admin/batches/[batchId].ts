import type { NextApiRequest, NextApiResponse } from "next";
import { CardAssetStatus, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

interface BatchAssetSummary {
  id: string;
  status: string;
  fileName: string;
  fileSize: number;
  imageUrl: string;
  mimeType: string;
  uploadedAt: string;
  ocrText: string | null;
  classification: Record<string, unknown> | null;
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
  humanReviewedAt: string | null;
  humanReviewerName: string | null;
}

interface BatchResponse {
  id: string;
  label: string | null;
  status: string;
  totalCount: number;
  processedCount: number;
  createdAt: string;
  updatedAt: string;
  assets: BatchAssetSummary[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BatchResponse | { message: string }>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { batchId } = req.query;

    if (typeof batchId !== "string" || !batchId.trim()) {
      return res.status(400).json({ message: "batchId is required" });
    }

    const batch = await prisma.cardBatch.findFirst({
      where: { id: batchId, uploadedById: admin.user.id },
      include: {
        cards: {
          orderBy: { createdAt: "desc" },
          include: {
            humanReviewer: {
              select: { id: true, displayName: true },
            },
          },
        },
      },
    });

    if (!batch) {
      return res.status(404).json({ message: "Batch not found" });
    }

    const readyCount = await prisma.cardAsset.count({
      where: { batchId: batch.id, status: CardAssetStatus.READY },
    });

    let computedStatus = "UPLOADING";
    if (readyCount >= batch.totalCount && batch.totalCount > 0) {
      computedStatus = "READY";
    } else if (readyCount > 0) {
      computedStatus = "PROCESSING";
    }

    const payload: BatchResponse = {
      id: batch.id,
      label: batch.label,
      status: computedStatus,
      totalCount: batch.totalCount,
      processedCount: readyCount,
      createdAt: batch.createdAt.toISOString(),
      updatedAt: batch.updatedAt.toISOString(),
      assets: batch.cards.map((asset) => ({
        id: asset.id,
        status: asset.status,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
        imageUrl: asset.imageUrl,
        mimeType: asset.mimeType,
        uploadedAt: asset.createdAt.toISOString(),
        ocrText: typeof asset.ocrText === "string" ? asset.ocrText : null,
        classification: asset.classificationJson as Record<string, unknown> | null,
        customTitle: asset.customTitle ?? null,
        customDetails: asset.customDetails ?? null,
        valuationMinor: asset.valuationMinor ?? null,
        valuationCurrency: asset.valuationCurrency ?? null,
        valuationSource: asset.valuationSource ?? null,
        marketplaceUrl: asset.marketplaceUrl ?? null,
        ebaySoldUrl: asset.ebaySoldUrl ?? null,
        ebaySoldUrlVariant: asset.ebaySoldUrlVariant ?? null,
        ebaySoldUrlHighGrade: asset.ebaySoldUrlHighGrade ?? null,
        ebaySoldUrlPlayerComp: asset.ebaySoldUrlPlayerComp ?? null,
        assignedDefinitionId: asset.assignedDefinitionId ?? null,
        humanReviewedAt: asset.humanReviewedAt ? asset.humanReviewedAt.toISOString() : null,
        humanReviewerName: asset.humanReviewer?.displayName ?? asset.humanReviewer?.id ?? null,
      })),
    };

    return res.status(200).json(payload);
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
