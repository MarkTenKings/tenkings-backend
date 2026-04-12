import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { methodNotAllowed, serializeProfile } from "../../../../../lib/server/stocker";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    await requireAdminSession(req);
    const isActive = req.query.isActive === "false" ? false : req.query.isActive === "all" ? undefined : true;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const stockers = await prisma.stockerProfile.findMany({
      where: {
        ...(isActive === undefined ? {} : { isActive }),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        _count: { select: { shifts: true } },
        shifts: { orderBy: { assignedDate: "desc" }, take: 1, select: { assignedDate: true } },
      },
      orderBy: { name: "asc" },
    });
    return res.status(200).json({
      success: true,
      data: stockers.map((stocker) => ({
        ...serializeProfile(stocker),
        _count: stocker._count,
        lastShiftDate: stocker.shifts[0]?.assignedDate.toISOString().slice(0, 10) ?? null,
      })),
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ success: false, message: response.message });
  }
}
