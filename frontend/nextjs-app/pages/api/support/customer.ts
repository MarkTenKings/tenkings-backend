import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../lib/server/admin";
import { withAdminCors } from "../../../lib/server/cors";
import {
  findSupportCustomerIdentityMatches,
  normalizeSupportEmail,
  normalizeSupportPhone,
  supportCustomerLookupSchema,
  supportCustomerUpsertSchema,
  toNullableJsonInput,
} from "../../../lib/server/support";

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET,POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    if (req.method === "GET") {
      const parsed = supportCustomerLookupSchema.parse({ phone: req.query.phone });
      const normalizedPhone = normalizeSupportPhone(parsed.phone);

      if (!normalizedPhone) {
        return res.status(400).json({ message: "phone is required" });
      }

      const customer = await prisma.supportCustomer.findUnique({
        where: { phone: normalizedPhone },
        include: {
          conversations: {
            orderBy: { startedAt: "desc" },
            take: 3,
            select: {
              id: true,
              channel: true,
              status: true,
              startedAt: true,
              endedAt: true,
              summary: true,
              agentId: true,
              locationId: true,
            },
          },
          customerNotes: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!customer) {
        return res.status(200).json({ customer: null });
      }

      const { conversations, customerNotes, ...customerRow } = customer;
      return res.status(200).json({
        customer: {
          ...customerRow,
          recentConversationSummaries: conversations,
          customerNotes,
        },
      });
    }

    const payload = supportCustomerUpsertSchema.parse(req.body ?? {});
    const normalizedPhone = normalizeSupportPhone(payload.phone ?? null);
    const normalizedEmail = normalizeSupportEmail(payload.email ?? null);

    if (!normalizedPhone && !normalizedEmail) {
      return res.status(400).json({ message: "phone or email is required" });
    }

    const matches = await findSupportCustomerIdentityMatches({
      phone: normalizedPhone,
      email: normalizedEmail,
    });
    const distinctMatches = Array.from(new Map(matches.map((match) => [match.id, match])).values());

    if (distinctMatches.length > 1) {
      return res.status(409).json({
        message: "phone and email already belong to different support customers",
      });
    }

    if (distinctMatches.length === 1) {
      const updateData: Prisma.SupportCustomerUncheckedUpdateInput = {
        lastSeen: new Date(),
      };

      if (payload.phone !== undefined) {
        updateData.phone = normalizedPhone;
      }
      if (payload.email !== undefined) {
        updateData.email = normalizedEmail;
      }
      if (payload.name !== undefined) {
        updateData.name = payload.name;
      }
      if (payload.preferredLang !== undefined) {
        updateData.preferredLang = payload.preferredLang;
      }
      if (payload.linkedUserId !== undefined) {
        updateData.linkedUserId = payload.linkedUserId;
      }
      if (payload.notes !== undefined) {
        updateData.notes = toNullableJsonInput(payload.notes);
      }

      const customer = await prisma.supportCustomer.update({
        where: { id: distinctMatches[0].id },
        data: updateData,
      });

      return res.status(200).json({ customer });
    }

    const createData: Prisma.SupportCustomerUncheckedCreateInput = {
      phone: normalizedPhone,
      email: normalizedEmail,
      name: payload.name ?? null,
      linkedUserId: payload.linkedUserId ?? null,
    };

    if (payload.preferredLang !== undefined) {
      createData.preferredLang = payload.preferredLang;
    }
    if (payload.notes !== undefined) {
      createData.notes = toNullableJsonInput(payload.notes);
    }

    const customer = await prisma.supportCustomer.create({
      data: createData,
    });

    return res.status(201).json({ customer });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "A support customer with that phone or email already exists" });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return res.status(400).json({ message: "Invalid linked user reference" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
