import { prisma } from "@tenkings/database";
import type { Prisma } from "@prisma/client";
import { buildMuxPlaybackUrl } from "./mux";
import { kioskSessionInclude, serializeKioskSession, type KioskSessionWithRelations } from "./kioskSession";
import { slugify } from "../slugify";

export interface CompleteKioskSessionInput {
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  title?: string | null;
  description?: string | null;
  featured?: boolean | null;
  publish?: boolean;
}

function extractRevealName(payload: unknown, fallback?: string | null): string | undefined {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const maybeName = (payload as Record<string, unknown>).name;
    if (typeof maybeName === "string" && maybeName.trim()) {
      return maybeName.trim();
    }
  }
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  return undefined;
}

async function reserveLiveRipSlug(tx: Prisma.TransactionClient, baseInput: string, fallbackSeed: string) {
  let slugBase = slugify(baseInput);
  if (!slugBase) {
    slugBase = slugify(fallbackSeed) || `tenkings-live-${Date.now()}`;
  }

  let candidateSlug = slugBase;
  let attempt = 1;
  while (await tx.liveRip.findUnique({ where: { slug: candidateSlug } })) {
    candidateSlug = `${slugBase}-${attempt++}`;
  }
  return candidateSlug;
}

function buildCompletionFields(session: KioskSessionWithRelations, payload: CompleteKioskSessionInput) {
  const finalVideoUrl =
    payload.videoUrl ??
    (session.muxPlaybackId ? buildMuxPlaybackUrl(session.muxPlaybackId) : null) ??
    session.videoUrl ??
    null;
  const title =
    payload.title?.trim() ||
    extractRevealName(session.revealPayload, session.revealItem?.name) ||
    "Live Rip";

  return {
    finalVideoUrl,
    title,
    description: payload.description?.trim() || null,
    thumbnailUrl: payload.thumbnailUrl ?? session.thumbnailUrl ?? null,
    featured: payload.featured ?? true,
    publish: payload.publish ?? true,
  };
}

export async function completeKioskSessionTransaction(
  tx: Prisma.TransactionClient,
  sessionId: string,
  payload: CompleteKioskSessionInput
) {
  const session = await tx.kioskSession.findUnique({
    where: { id: sessionId },
    include: kioskSessionInclude,
  });

  if (!session) {
    throw new Error("Session not found");
  }

  const now = new Date();
  const resolved = buildCompletionFields(session, payload);
  const shouldPublish = resolved.publish && session.status !== "CANCELLED";

  if (shouldPublish && resolved.finalVideoUrl) {
    if (session.liveRip) {
      await tx.liveRip.update({
        where: { id: session.liveRip.id },
        data: {
          title: resolved.title,
          description: resolved.description,
          videoUrl: resolved.finalVideoUrl,
          thumbnailUrl: resolved.thumbnailUrl,
          featured: resolved.featured,
          isGoldenTicket: session.isGoldenTicket,
          goldenTicketId: session.goldenTicketId ?? session.liveRip.goldenTicketId ?? null,
        },
      });
    } else {
      const slug = await reserveLiveRipSlug(tx, `${session.code}-${resolved.title}`, resolved.title);
      await tx.liveRip.create({
        data: {
          slug,
          title: resolved.title,
          description: resolved.description,
          videoUrl: resolved.finalVideoUrl,
          thumbnailUrl: resolved.thumbnailUrl,
          locationId: session.locationId,
          featured: resolved.featured,
          kioskSessionId: session.id,
          isGoldenTicket: session.isGoldenTicket,
          goldenTicketId: session.goldenTicketId ?? null,
        },
      });
    }
  }

  await tx.kioskSession.update({
    where: { id: session.id },
    data: {
      status: shouldPublish ? "COMPLETE" : session.status,
      videoUrl: resolved.finalVideoUrl ?? session.videoUrl,
      thumbnailUrl: resolved.thumbnailUrl,
      completedAt: now,
    },
  });

  if (session.packInstanceId) {
    await tx.packInstance.update({
      where: { id: session.packInstanceId },
      data: { status: "OPENED" },
    });
  }

  const updated = await tx.kioskSession.findUnique({
    where: { id: session.id },
    include: kioskSessionInclude,
  });

  if (!updated) {
    throw new Error("Failed to reload completed kiosk session");
  }

  return {
    session: updated,
    serialized: serializeKioskSession(updated),
  };
}

export async function completeKioskSession(sessionId: string, payload: CompleteKioskSessionInput) {
  return prisma.$transaction((tx) => completeKioskSessionTransaction(tx, sessionId, payload));
}
