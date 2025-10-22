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

const updateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
  description: z.string().optional(),
  address: z.string().min(1, "Address is required"),
  mapsUrl: z.string().url().optional().or(z.literal("")),
  mediaUrl: z.string().url().optional().or(z.literal("")),
  recentRips: ripSchema,
});

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const normalizeRips = (value: z.infer<typeof ripSchema>) => {
  if (!value || value.length === 0) {
    return [];
  }
  return value.map((entry) => ({
    title: entry.title,
    videoUrl: entry.videoUrl,
  }));
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PUT") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const id = Array.isArray(req.query.locationId) ? req.query.locationId[0] : req.query.locationId;
  if (!id) {
    return res.status(400).json({ message: "Missing location id" });
  }

  try {
    const session = await requireUserSession(req);
    const isAdmin = hasAdminAccess(session.user.id) || hasAdminPhoneAccess(session.user.phone);
    if (!isAdmin) {
      return res.status(403).json({ message: "Admin access required" });
    }

    const payload = updateSchema.parse(req.body ?? {});
    const slug = slugify(payload.slug);
    if (!slug) {
      return res.status(400).json({ message: "Unable to derive slug" });
    }

    const location = await prisma.location.update({
      where: { id },
      data: {
        name: payload.name,
        slug,
        description: payload.description,
        address: payload.address,
        mapsUrl: payload.mapsUrl || null,
        mediaUrl: payload.mediaUrl || null,
        recentRips: normalizeRips(payload.recentRips),
      },
    });

    res.status(200).json({
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
}
