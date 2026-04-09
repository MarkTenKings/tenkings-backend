import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { ConversationStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";
import { supportConversationUpdateSchema } from "../../../../lib/server/support";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const conversationId = typeof req.query.id === "string" ? req.query.id : null;
  if (!conversationId) {
    return res.status(400).json({ message: "Conversation id is required" });
  }

  try {
    await requireAdminSession(req);

    const payload = supportConversationUpdateSchema.parse(req.body ?? {});
    const data: Prisma.ConversationUncheckedUpdateInput = {};

    if (payload.status !== undefined) {
      data.status = payload.status;
      if (payload.status === ConversationStatus.RESOLVED || payload.status === ConversationStatus.ESCALATED) {
        data.endedAt = new Date();
      } else if (payload.status === ConversationStatus.OPEN) {
        data.endedAt = null;
      }
    }

    if (payload.summary !== undefined) {
      data.summary = payload.summary;
    }

    if (payload.transcript !== undefined) {
      data.transcript = payload.transcript;
    }

    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data,
    });

    return res.status(200).json({ conversation });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
