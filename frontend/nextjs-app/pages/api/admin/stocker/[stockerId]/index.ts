import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { methodNotAllowed, normalizePhoneInput, serializeProfile } from "../../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PUT" && req.method !== "DELETE") return methodNotAllowed(res, ["PUT", "DELETE"]);

  try {
    await requireAdminSession(req);
    const stockerId = String(req.query.stockerId ?? "");
    if (!stockerId) return res.status(400).json({ success: false, message: "stockerId is required" });

    if (req.method === "DELETE") {
      await prisma.stockerProfile.update({ where: { id: stockerId }, data: { isActive: false } });
      return res.status(200).json({ success: true, data: { deactivated: true } });
    }

    const data: { name?: string; phone?: string; language?: string; isActive?: boolean } = {};
    if (typeof req.body?.name === "string" && req.body.name.trim()) data.name = req.body.name.trim();
    if (typeof req.body?.phone === "string" && normalizePhoneInput(req.body.phone)) data.phone = normalizePhoneInput(req.body.phone);
    if (req.body?.language === "en" || req.body?.language === "es") data.language = req.body.language;
    if (typeof req.body?.isActive === "boolean") data.isActive = req.body.isActive;

    const profile = await prisma.stockerProfile.update({ where: { id: stockerId }, data });
    if (data.phone) {
      await prisma.user.update({ where: { id: profile.userId }, data: { phone: data.phone, role: "stocker" } });
    }
    return res.status(200).json({ success: true, data: serializeProfile(profile) });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ success: false, message: response.message });
  }
}
