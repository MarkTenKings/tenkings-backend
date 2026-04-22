import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../../constants/admin";
import { slugify } from "../../../../lib/slugify";
import { requireUserSession, toUserErrorResponse } from "../../../../lib/server/session";

const liveRipSchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().optional(),
  description: z.string().optional(),
  videoUrl: z.string().url("Provide a valid video URL"),
  thumbnailUrl: z.string().url("Thumbnail must be a valid URL").optional().or(z.literal("")),
  locationId: z.string().uuid().optional().or(z.literal("")),
  featured: z.boolean().optional(),
  viewCount: z.number().int().nonnegative().optional(),
});

const withLocation = (liveRip: any) => ({
  ...liveRip,
  location: liveRip.location
    ? {
        id: liveRip.location.id,
        name: liveRip.location.name,
        slug: liveRip.location.slug,
      }
    : null,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await requireUserSession(req);
    const isAdmin = hasAdminAccess(session.user.id) || hasAdminPhoneAccess(session.user.phone);
    if (!isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const payload = liveRipSchema.parse(req.body ?? {});
    const baseSlug = payload.slug ? slugify(payload.slug) : slugify(payload.title);
    if (!baseSlug) {
      return res.status(400).json({ message: "Unable to derive slug from title" });
    }

    let uniqueSlug = baseSlug;
    let attempt = 1;
    while (await prisma.liveRip.findUnique({ where: { slug: uniqueSlug } })) {
      uniqueSlug = `${baseSlug}-${attempt++}`;
    }

    const locationId = payload.locationId && payload.locationId.length ? payload.locationId : null;

    const liveRip = await prisma.liveRip.create({
      data: {
        slug: uniqueSlug,
        title: payload.title,
        description: payload.description?.trim() || null,
        videoUrl: payload.videoUrl,
        thumbnailUrl: payload.thumbnailUrl?.trim() || null,
        locationId,
        featured: payload.featured ?? false,
        viewCount: payload.viewCount ?? null,
      },
      include: {
        location: true,
      },
    });

    return res.status(201).json({ liveRip: withLocation(liveRip) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return res.status(404).json({ message: "Live rip not available" });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    const result = toUserErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
