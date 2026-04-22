import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { withAdminCors } from "../../../../../../lib/server/cors";
import {
  buildGoldenTicketClaimUrl,
  buildGoldenTicketPdfFileName,
  buildGoldenTicketPdfStorageKey,
  generateGoldenTicketPdf,
} from "../../../../../../lib/server/goldenTicket";
import { readStorageBuffer } from "../../../../../../lib/server/storage";

async function handler(req: NextApiRequest, res: NextApiResponse<Buffer | { message: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!id) {
      return res.status(400).json({ message: "Ticket id is required" });
    }

    const ticket = await prisma.goldenTicket.findUnique({
      where: { id },
      select: {
        id: true,
        ticketNumber: true,
        code: true,
        prizeItem: {
          select: {
            name: true,
            estimatedValue: true,
            imageUrl: true,
          },
        },
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: "Golden Ticket not found" });
    }

    const fileName = buildGoldenTicketPdfFileName(ticket.ticketNumber);
    const storageKey = buildGoldenTicketPdfStorageKey(ticket.ticketNumber, ticket.code);

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await readStorageBuffer(storageKey);
    } catch (error) {
      console.warn("[golden-ticket] pdf read fallback", { ticketId: ticket.id, storageKey, error });
      pdfBuffer = await generateGoldenTicketPdf({
        ticketNumber: ticket.ticketNumber,
        code: ticket.code,
        title: ticket.prizeItem.name,
        claimUrl: buildGoldenTicketClaimUrl(ticket.code),
        imageUrl: ticket.prizeItem.imageUrl,
        estimatedValue: ticket.prizeItem.estimatedValue,
      });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
