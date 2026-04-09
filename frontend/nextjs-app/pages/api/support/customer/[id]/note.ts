import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { withAdminCors } from "../../../../../lib/server/cors";
import { supportCustomerNoteCreateSchema } from "../../../../../lib/server/support";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const customerId = typeof req.query.id === "string" ? req.query.id : null;
  if (!customerId) {
    return res.status(400).json({ message: "Customer id is required" });
  }

  try {
    await requireAdminSession(req);

    const payload = supportCustomerNoteCreateSchema.parse(req.body ?? {});
    const customer = await prisma.supportCustomer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });

    if (!customer) {
      return res.status(404).json({ message: "Support customer not found" });
    }

    const note = await prisma.customerNote.create({
      data: {
        customerId,
        note: payload.note,
        source: payload.source,
      },
    });

    return res.status(201).json({ note });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
