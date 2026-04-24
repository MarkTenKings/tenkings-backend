import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { CollectibleCategory, GoldenTicketStatus, QrCodeState, QrCodeType } from "@prisma/client";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";
import {
  buildGoldenTicketClaimUrl,
  buildGoldenTicketPdfStorageKey,
  buildGoldenTicketPrizeDetails,
  generateGoldenTicketCodeBatch,
  generateGoldenTicketPdf,
  getGoldenTicketSetName,
  groupGoldenTicketPrizes,
  type GoldenTicketPrizeListRow,
} from "../../../../lib/server/goldenTicket";
import { uploadBuffer } from "../../../../lib/server/storage";

const assetUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.startsWith("/") || /^https?:\/\//i.test(value), "Provide a valid asset URL");

const requestSchema = z
  .object({
    title: z.string().trim().min(1, "Prize name is required").max(160, "Prize name is too long"),
    description: z.string().trim().max(4000, "Prize description is too long").optional().default(""),
    photoUrls: z.array(assetUrlSchema).min(1, "Upload at least one prize photo"),
    estimatedValueMinor: z.number().int().nonnegative("Estimated value must be zero or greater"),
    category: z.nativeEnum(CollectibleCategory).optional().default(CollectibleCategory.GOLDEN_TICKET_PRIZE),
    requiresSize: z.boolean().optional().default(false),
    sizeOptions: z.array(z.string().trim().min(1).max(60)).optional().default([]),
    revealVideoAssetUrl: assetUrlSchema,
    revealVideoPoster: assetUrlSchema.optional().or(z.literal("")).default(""),
    ticketCount: z.number().int().min(1, "Create at least one ticket").max(100, "Create at most 100 tickets"),
  })
  .superRefine((value, ctx) => {
    if (value.requiresSize && value.sizeOptions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sizeOptions"],
        message: "Add at least one size option when size is required.",
      });
    }
  });

type PrizeListResponse = {
  prizes: ReturnType<typeof groupGoldenTicketPrizes>;
  stats: {
    prizeCount: number;
    ticketCount: number;
    mintedCount: number;
    claimedCount: number;
  };
};

type ResponseBody =
  | PrizeListResponse
  | {
      prize: ReturnType<typeof groupGoldenTicketPrizes>[number];
      message: string;
    }
  | { message: string };

const prizeSelect = {
  id: true,
  ticketNumber: true,
  code: true,
  status: true,
  createdAt: true,
  claimedAt: true,
  revealVideoAssetUrl: true,
  revealVideoPoster: true,
  prizeItem: {
    select: {
      id: true,
      name: true,
      set: true,
      estimatedValue: true,
      imageUrl: true,
      thumbnailUrl: true,
      detailsJson: true,
    },
  },
} as const;

async function listPrizes(): Promise<PrizeListResponse> {
  const rows = await prisma.goldenTicket.findMany({
    select: prizeSelect,
    orderBy: [{ createdAt: "desc" }, { ticketNumber: "desc" }],
  });
  const prizes = groupGoldenTicketPrizes(rows satisfies GoldenTicketPrizeListRow[]);
  return {
    prizes,
    stats: {
      prizeCount: prizes.length,
      ticketCount: rows.length,
      mintedCount: rows.filter((row) => row.status === GoldenTicketStatus.MINTED).length,
      claimedCount: rows.filter((row) => row.status === GoldenTicketStatus.CLAIMED).length,
    },
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    const admin = await requireAdminSession(req);

    if (req.method === "GET") {
      const response = await listPrizes();
      return res.status(200).json(response);
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET,POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const payload = requestSchema.parse(req.body ?? {});
    const houseUserId = process.env.TEN_KINGS_HOUSE_USER_ID?.trim();
    if (!houseUserId) {
      return res.status(500).json({ message: "TEN_KINGS_HOUSE_USER_ID is not configured" });
    }

    const houseUser = await prisma.user.findUnique({
      where: { id: houseUserId },
      select: { id: true },
    });
    if (!houseUser) {
      return res.status(500).json({ message: "Configured house user was not found" });
    }

    const prizeGroupId = randomUUID();
    const photoUrls = [...new Set(payload.photoUrls.map((entry) => entry.trim()).filter(Boolean))];
    const sizeOptions = [...new Set(payload.sizeOptions.map((entry) => entry.trim()).filter(Boolean))];
    const revealVideoPoster = payload.revealVideoPoster?.trim() || null;
    const created = await prisma.$transaction(async (tx) => {
      const codes = generateGoldenTicketCodeBatch(payload.ticketCount);
      const tickets: Array<
        GoldenTicketPrizeListRow & {
          prizeItem: GoldenTicketPrizeListRow["prizeItem"] & { ownerId: string };
          qrCodeId: string;
        }
      > = [];

      for (const code of codes) {
        const prizeItem = await tx.item.create({
          data: {
            name: payload.title,
            set: getGoldenTicketSetName(),
            estimatedValue: payload.estimatedValueMinor,
            imageUrl: photoUrls[0] ?? null,
            thumbnailUrl: photoUrls[0] ?? null,
            ownerId: houseUser.id,
            detailsJson: buildGoldenTicketPrizeDetails({
              prizeGroupId,
              description: payload.description,
              category: payload.category,
              photoGallery: photoUrls,
              requiresSize: payload.requiresSize,
              sizeOptions,
            }),
          },
          select: {
            id: true,
            name: true,
            set: true,
            estimatedValue: true,
            imageUrl: true,
            thumbnailUrl: true,
            detailsJson: true,
            ownerId: true,
          },
        });

        await tx.itemOwnership.create({
          data: {
            itemId: prizeItem.id,
            ownerId: prizeItem.ownerId,
            note: "Golden Ticket prize minted to house inventory",
          },
        });

        const qrCode = await tx.qrCode.create({
          data: {
            code,
            serial: `GT-${code.toUpperCase()}`,
            type: QrCodeType.GOLDEN_TICKET,
            state: QrCodeState.AVAILABLE,
            payloadUrl: buildGoldenTicketClaimUrl(code),
            metadata: {
              role: "GOLDEN_TICKET",
              prizeGroupId,
              createdById: admin.user.id,
            },
            createdById: admin.user.id,
          },
          select: { id: true },
        });

        const ticket = await tx.goldenTicket.create({
          data: {
            code,
            qrCodeId: qrCode.id,
            prizeItemId: prizeItem.id,
            revealVideoAssetUrl: payload.revealVideoAssetUrl,
            revealVideoPoster,
            status: GoldenTicketStatus.MINTED,
          },
          select: prizeSelect,
        });

        await tx.qrCode.update({
          where: { id: qrCode.id },
          data: {
            serial: `GT-${String(ticket.ticketNumber).padStart(4, "0")}`,
            metadata: {
              role: "GOLDEN_TICKET",
              prizeGroupId,
              ticketId: ticket.id,
              ticketNumber: ticket.ticketNumber,
              prizeTitle: payload.title,
            },
          },
        });

        tickets.push({
          ...ticket,
          qrCodeId: qrCode.id,
          prizeItem,
        });
      }

      return tickets;
    });

    try {
      for (const ticket of created) {
        const pdfBuffer = await generateGoldenTicketPdf({
          ticketNumber: ticket.ticketNumber,
          code: ticket.code,
          title: ticket.prizeItem.name,
          claimUrl: buildGoldenTicketClaimUrl(ticket.code),
          imageUrl: ticket.prizeItem.imageUrl,
          estimatedValue: ticket.prizeItem.estimatedValue,
        });
        await uploadBuffer(buildGoldenTicketPdfStorageKey(ticket.ticketNumber, ticket.code), pdfBuffer, "application/pdf", {
          cacheControl: "public, max-age=31536000, immutable",
        });
      }
    } catch (error) {
      try {
        await prisma.$transaction([
          prisma.goldenTicket.deleteMany({ where: { id: { in: created.map((ticket) => ticket.id) } } }),
          prisma.qrCode.deleteMany({ where: { id: { in: created.map((ticket) => ticket.qrCodeId) } } }),
          prisma.item.deleteMany({ where: { id: { in: created.map((ticket) => ticket.prizeItem.id) } } }),
        ]);
      } catch (cleanupError) {
        console.warn("[golden-ticket] cleanup failed after prize mint error", cleanupError);
      }
      throw error;
    }

    const prize = groupGoldenTicketPrizes(created)[0];
    if (!prize) {
      return res.status(500).json({ message: "Prize was created, but response serialization failed" });
    }

    return res.status(201).json({
      prize,
      message: `Created ${created.length} Golden Ticket${created.length === 1 ? "" : "s"} for ${payload.title}.`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
