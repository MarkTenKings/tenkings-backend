import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { ConversationStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";
import { supportEscalationCreateSchema } from "../../../../lib/server/support";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const payload = supportEscalationCreateSchema.parse(req.body ?? {});
    const conversation = await prisma.conversation.findUnique({
      where: { id: payload.conversationId },
      select: { id: true },
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const escalation = await prisma.$transaction(async (tx) => {
      const created = await tx.escalation.create({
        data: {
          conversationId: payload.conversationId,
          assignedTo: payload.assignedTo ?? null,
        },
      });

      await tx.conversation.update({
        where: { id: payload.conversationId },
        data: { status: ConversationStatus.ESCALATED },
      });

      return created;
    });

    return res.status(201).json({ escalation });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "An escalation already exists for that conversation" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
