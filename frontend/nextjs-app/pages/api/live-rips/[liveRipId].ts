import type { NextApiRequest, NextApiResponse } from "next";
import { Prisma } from "@prisma/client";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { requireUserSession, toUserErrorResponse } from "../../../lib/server/session";

const updateSchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(1, "Slug is required"),
  description: z.string().optional(),
  videoUrl: z.string().url("Provide a valid video URL"),
  thumbnailUrl: z.string().url("Thumbnail must be a valid URL").optional().or(z.literal("")),
  locationId: z.string().uuid().optional().or(z.literal("")),
  featured: z.boolean().optional(),
  viewCount: z.number().int().nonnegative().optional(),
});

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

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
  if (req.method !== "PUT") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const liveRipId = Array.isArray(req.query.liveRipId) ? req.query.liveRipId[0] : req.query.liveRipId;
  if (!liveRipId) {
    return res.status(400).json({ message: "Missing live rip id" });
  }

  try {
    const session = await requireUserSession(req);
    const isAdmin = hasAdminAccess(session.user.id) || hasAdminPhoneAccess(session.user.phone);
    if (!isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const payload = updateSchema.parse(req.body ?? {});
    const normalizedSlug = slugify(payload.slug);
    if (!normalizedSlug) {
      return res.status(400).json({ message: "Unable to derive slug" });
    }

    const locationId = payload.locationId && payload.locationId.length ? payload.locationId : null;

    const existing = await prisma.liveRip.findUnique({ where: { id: liveRipId } });
    if (!existing) {
      return res.status(404).json({ message: "Live rip not found" });
    }

    if (normalizedSlug !== existing.slug) {
      const conflict = await prisma.liveRip.findUnique({ where: { slug: normalizedSlug } });
      if (conflict && conflict.id !== liveRipId) {
        return res.status(409).json({ message: "Slug already in use" });
      }
    }

    const liveRip = await prisma.liveRip.update({
      where: { id: liveRipId },
      data: {
        slug: normalizedSlug,
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

    res.status(200).json({ liveRip: withLocation(liveRip) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return res.status(404).json({ message: "Live rip not available" });
    }
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }
    const result = toUserErrorResponse(error);
    res.status(result.status).json({ message: result.message });
  }
}
