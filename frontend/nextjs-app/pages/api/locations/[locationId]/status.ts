import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { LOCATION_STATUS_VALUES } from "../../../../lib/locationStatus";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

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
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const locationId = typeof req.query.locationId === "string" ? req.query.locationId.trim() : "";
    if (!locationId) {
      return res.status(400).json({ message: "locationId is required" });
    }

    const parsed = updateStatusSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid payload" });
    }

    const location = await prisma.location.update({
      where: { slug: locationId },
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
      return res.status(404).json({ message: "Location not found" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
