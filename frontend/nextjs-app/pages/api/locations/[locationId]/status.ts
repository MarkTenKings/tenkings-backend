import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { LOCATION_STATUS_VALUES } from "../../../../lib/locationStatus";
import { toErrorResponse } from "../../../../lib/server/admin";
import { requireInventoryAdminSession } from "../../../../lib/server/inventoryAdmin";
import { isInternalLocation } from "../../../../lib/locationVisibility";

const updateStatusSchema = z.object({
  status: z.enum(LOCATION_STATUS_VALUES),
});

type ResponseBody =
  | {
      location: {
        id: string;
        slug: string;
        locationStatus: string | null;
      };
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireInventoryAdminSession(req);

    const locationId = typeof req.query.locationId === "string" ? req.query.locationId.trim() : "";
    if (!locationId) {
      return res.status(400).json({ message: "locationId is required" });
    }

    const parsed = updateStatusSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid payload" });
    }

    const current = await prisma.location.findUnique({ where: { slug: locationId }, select: { locationType: true, locationStatus: true } });
    if (!current) return res.status(404).json({ message: "Location not found" });
    if (isInternalLocation(current) && !isInternalLocation({ ...current, locationStatus: parsed.data.status })) {
      return res.status(400).json({ message: "Internal inventory locations must stay private." });
    }

    const location = await prisma.location.update({
      where: { slug: locationId, locationType: current.locationType, locationStatus: current.locationStatus },
      data: {
        locationStatus: parsed.data.status,
      },
      select: {
        id: true,
        slug: true,
        locationStatus: true,
      },
    });

    return res.status(200).json({ location });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(409).json({ message: "The location changed. Reload it before saving." });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.status < 500 ? response.message : "The location status could not be saved." });
  }
}
