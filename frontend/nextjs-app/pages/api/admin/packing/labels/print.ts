import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import type { CardAttributes } from "@tenkings/shared/cardAttributes";
import type { PrintableLabelEntry } from "../../../../../lib/server/labels";
import { generateLabelSheetPdf } from "../../../../../lib/server/labels";
import type { QrCodeSummary } from "../../../../../lib/server/qrCodes";

const requestSchema = z.object({
  labelIds: z.array(z.string().min(1)).min(1),
});

type ResponseBody =
  | {
      pdf: string;
      filename: string;
      labels: PrintableLabelEntry[];
    }
  | { message: string };

const summarizeQrCode = (record: {
  id: string;
  code: string;
  serial: string | null;
  type: any;
  state: any;
  payloadUrl: string | null;
  metadata: any;
}): QrCodeSummary => {
  const metadata =
    typeof record.metadata === "object" && record.metadata && !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : null;
  const pairId = metadata && typeof metadata.pairId === "string" ? metadata.pairId : undefined;
  return {
    id: record.id,
    code: record.code,
    serial: record.serial,
    type: record.type,
    state: record.state,
    payloadUrl: record.payloadUrl,
    pairId,
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const admin = await requireAdminSession(req);
    const { labelIds } = requestSchema.parse(req.body ?? {});

    const labelRecords = await prisma.packLabel.findMany({
      where: { id: { in: labelIds } },
      include: {
        cardQrCode: true,
        packQrCode: true,
        packInstance: {
          include: {
            slots: {
              take: 1,
              select: {
            item: { select: { id: true, name: true, imageUrl: true, detailsJson: true } },
              },
            },
          },
        },
      },
    });

    const labelMap = new Map(labelRecords.map((label) => [label.id, label]));

    const printable: PrintableLabelEntry[] = labelIds.map((id) => {
      const record = labelMap.get(id);
      if (!record) {
        throw new Error(`Label ${id} not found`);
      }

      return {
        pairId: record.pairId,
        card: summarizeQrCode(record.cardQrCode),
        pack: summarizeQrCode(record.packQrCode),
        label: {
          id: record.id,
          pairId: record.pairId,
          status: record.status,
          locationId: record.locationId,
          batchId: record.batchId,
          itemId: record.itemId,
          packInstanceId: record.packInstanceId,
        },
        item: record.packInstance?.slots[0]?.item
          ? {
              id: record.packInstance.slots[0].item.id,
              name: record.packInstance.slots[0].item.name,
              imageUrl: record.packInstance.slots[0].item.imageUrl,
              attributes: (record.packInstance.slots[0].item.detailsJson as CardAttributes | null) ?? null,
            }
          : null,
      };
    });

    const pdfBuffer = await generateLabelSheetPdf({
      labels: printable,
      generatedBy: admin.user.displayName ?? admin.user.phone ?? admin.user.id,
    });

    const pdf = pdfBuffer.toString("base64");
    const filename = `tenkings-labels-${new Date().toISOString().replace(/[.:]/g, "-")}.pdf`;

    return res.status(200).json({ pdf, filename, labels: printable });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
