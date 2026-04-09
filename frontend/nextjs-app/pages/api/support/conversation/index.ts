import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";
import { supportConversationCreateSchema } from "../../../../lib/server/support";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const payload = supportConversationCreateSchema.parse(req.body ?? {});

    const customer = await prisma.supportCustomer.findUnique({
      where: { id: payload.customerId },
      select: { id: true },
    });

    if (!customer) {
      return res.status(404).json({ message: "Support customer not found" });
    }

    if (payload.locationId) {
      const location = await prisma.location.findUnique({
        where: { id: payload.locationId },
        select: { id: true },
      });

      if (!location) {
        return res.status(404).json({ message: "Location not found" });
      }
    }

    const conversation = await prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          customerId: payload.customerId,
          channel: payload.channel,
          summary: payload.summary ?? null,
          transcript: payload.transcript ?? null,
          agentId: payload.agentId ?? null,
          locationId: payload.locationId ?? null,
        },
        select: { id: true },
      });

      await tx.supportCustomer.update({
        where: { id: payload.customerId },
        data: { lastSeen: new Date() },
      });

      return created;
    });

    return res.status(201).json({ id: conversation.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return res.status(400).json({ message: "Invalid relation reference in payload" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
