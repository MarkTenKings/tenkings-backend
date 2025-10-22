import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { requireUserSession, toUserErrorResponse } from "../../../lib/server/session";

const liveRipSchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().optional(),
  description: z.string().optional(),
  videoUrl: z.string().url("Provide a valid video URL"),
  thumbnailUrl: z.string().url("Thumbnail must be a valid URL").optional().or(z.literal("")),
  locationId: z.string().uuid().optional().or(z.literal("")),
  featured: z.boolean().optional(),
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
  if (req.method === "GET") {
    try {
      const locationId = Array.isArray(req.query.locationId) ? req.query.locationId[0] : req.query.locationId;
      const featured = Array.isArray(req.query.featured) ? req.query.featured[0] : req.query.featured;
      const slug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;

      const liveRips = await prisma.liveRip.findMany({
        where: {
          locationId: locationId ? locationId : undefined,
          featured: featured ? featured === "true" : undefined,
          slug: slug ? slug : undefined,
        },
        include: {
          location: true,
        },
        orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
        take: slug ? 1 : undefined,
      });

      if (slug) {
        const liveRip = liveRips[0];
        if (!liveRip) {
          return res.status(404).json({ message: "Live rip not found" });
        }
        return res.status(200).json({ liveRip: withLocation(liveRip) });
      }

      res.status(200).json({ liveRips: liveRips.map(withLocation) });
    } catch (error) {
      const result = toUserErrorResponse(error);
      res.status(result.status).json({ message: result.message });
    }
    return;
  }

  if (req.method === "POST") {
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
        },
        include: {
          location: true,
        },
      });

      res.status(201).json({ liveRip: withLocation(liveRip) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
      }
      const result = toUserErrorResponse(error);
      res.status(result.status).json({ message: result.message });
    }
    return;
  }

  res.status(405).json({ message: "Method not allowed" });
}
