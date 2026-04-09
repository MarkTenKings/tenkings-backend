import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { EscalationStatus, Prisma } from "@prisma/client";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { withAdminCors } from "../../../../../lib/server/cors";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const escalationId = typeof req.query.id === "string" ? req.query.id : null;
  if (!escalationId) {
    return res.status(400).json({ message: "Escalation id is required" });
  }

  try {
    await requireAdminSession(req);

    const escalation = await prisma.escalation.update({
      where: { id: escalationId },
      data: {
        status: EscalationStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });

    return res.status(200).json({ escalation });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ message: "Escalation not found" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
