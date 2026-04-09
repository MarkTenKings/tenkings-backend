import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { slugify } from "../../../../lib/slugify";
import { buildLocationMapsUrl, geocodeLocationAddress } from "../../../../lib/server/locationGeocoding";

type LocationRow = {
  id: string;
  name: string;
  slug: string;
};

const createLocationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1).optional(),
  address: z.string().min(1, "Address is required"),
});

type ResponseBody =
  | { locations: LocationRow[] }
  | { location: LocationRow & { address: string } }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    if (req.method === "POST") {
      const parsed = createLocationSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid payload" });
      }

      const trimmedName = parsed.data.name.trim();
      const trimmedAddress = parsed.data.address.trim();
      const normalizedSlug = slugify(parsed.data.slug || parsed.data.name);
      if (!normalizedSlug) {
        return res.status(400).json({ message: "Unable to derive slug from location name" });
      }

      const geocoded = await geocodeLocationAddress(trimmedAddress);

      const location = await prisma.location.create({
        data: {
          name: trimmedName,
          slug: normalizedSlug,
          address: trimmedAddress,
          locationStatus: "active",
          mapsUrl: geocoded?.mapsUrl ?? buildLocationMapsUrl({ address: trimmedAddress }),
          latitude: geocoded?.latitude ?? null,
          longitude: geocoded?.longitude ?? null,
          city: geocoded?.city ?? null,
          state: geocoded?.state ?? null,
          zip: geocoded?.zip ?? null,
          recentRips: [],
        },
        select: {
          id: true,
          name: true,
          slug: true,
          address: true,
        },
      });

      return res.status(201).json({ location });
    }

    const locations = await prisma.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    });

    return res.status(200).json({ locations });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ message: "A location with that slug already exists." });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
