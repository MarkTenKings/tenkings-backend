import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { withAdminCors } from "../../../../../lib/server/cors";
import { appendConversationTranscript, supportMessageCreateSchema } from "../../../../../lib/server/support";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const conversationId = typeof req.query.id === "string" ? req.query.id : null;
  if (!conversationId) {
    return res.status(400).json({ message: "Conversation id is required" });
  }

  try {
    await requireAdminSession(req);

    const payload = supportMessageCreateSchema.parse(req.body ?? {});

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        customerId: true,
        transcript: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const timestamp = new Date();
    const nextTranscript = appendConversationTranscript(
      conversation.transcript,
      payload.role,
      payload.content,
      timestamp
    );

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId,
          role: payload.role,
          content: payload.content,
          timestamp,
          sentiment: payload.sentiment ?? null,
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { transcript: nextTranscript },
      });

      await tx.supportCustomer.update({
        where: { id: conversation.customerId },
        data: { lastSeen: timestamp },
      });

      return created;
    });

    return res.status(201).json({ message });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
