import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { requireUserSession, toUserErrorResponse } from "../../../lib/server/session";

const ripSchema = z
  .object({
    title: z.string().min(1, "Title is required"),
    videoUrl: z.string().url("Video URL must be a valid URL"),
  })
  .array()
  .max(6)
  .optional();

const locationPayloadSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  address: z.string().min(1, "Address is required"),
  mapsUrl: z.string().url().optional().or(z.literal("")),
  mediaUrl: z.string().url().optional().or(z.literal("")),
  recentRips: ripSchema,
});

const normalizedRips = (value: z.infer<typeof ripSchema>) => {
  if (!value || value.length === 0) {
    return [];
  }
  return value.map((entry) => ({
    title: entry.title,
    videoUrl: entry.videoUrl,
  }));
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    try {
      const locations = await prisma.location.findMany({
        orderBy: { name: "asc" },
        include: {
          liveRips: {
            orderBy: { createdAt: "desc" },
            take: 6,
          },
        },
      });
      res.status(200).json({
        locations: locations.map((location) => ({
          ...location,
          recentRips: Array.isArray(location.recentRips) ? (location.recentRips as Array<Record<string, unknown>>) : [],
          liveRips: Array.isArray(location.liveRips)
            ? location.liveRips.map((liveRip) => ({
                id: liveRip.id,
                slug: liveRip.slug,
                title: liveRip.title,
                videoUrl: liveRip.videoUrl,
                thumbnailUrl: liveRip.thumbnailUrl,
                viewCount: liveRip.viewCount,
                createdAt: liveRip.createdAt.toISOString(),
              }))
            : [],
        })),
      });
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

      const payload = locationPayloadSchema.parse(req.body ?? {});
      const slug = payload.slug ? slugify(payload.slug) : slugify(payload.name);

      if (!slug) {
        return res.status(400).json({ message: "Unable to derive slug from location name" });
      }

      const location = await prisma.location.create({
        data: {
          slug,
          name: payload.name,
          description: payload.description,
          address: payload.address,
          mapsUrl: payload.mapsUrl || null,
          mediaUrl: payload.mediaUrl || null,
          recentRips: normalizedRips(payload.recentRips),
        },
      });

      res.status(201).json({
        location: {
          ...location,
          recentRips: Array.isArray(location.recentRips) ? (location.recentRips as Array<Record<string, unknown>>) : [],
        },
      });
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
