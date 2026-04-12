import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { isStockerAdminUser, methodNotAllowed, newId, normalizePhoneInput, serializeProfile } from "../../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    await requireAdminSession(req);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const phone = normalizePhoneInput(req.body?.phone);
    const language = req.body?.language === "es" ? "es" : "en";
    if (!name || !phone) return res.status(400).json({ success: false, message: "Name and phone are required" });

    const profile = await prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { phone } });
      if (user) {
        if (user.role !== "stocker" && !isStockerAdminUser(user)) {
          user = await tx.user.update({ where: { id: user.id }, data: { role: "stocker" } });
        }
      } else {
        user = await tx.user.create({
          data: {
            id: newId(),
            phone,
            phoneVerifiedAt: null,
            displayName: name,
            role: "stocker",
          },
        });
      }

      return tx.stockerProfile.upsert({
        where: { userId: user.id },
        create: {
          id: newId(),
          userId: user.id,
          name,
          phone,
          language,
          isActive: true,
        },
        update: {
          name,
          phone,
          language,
          isActive: true,
        },
      });
    });

    return res.status(201).json({ success: true, data: serializeProfile(profile) });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ success: false, message: response.message });
  }
}
