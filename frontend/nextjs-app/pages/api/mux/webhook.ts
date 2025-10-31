import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import {
  buildMuxPlaybackUrl,
  getMuxAsset,
  verifyMuxWebhookSignature,
} from "../../../lib/server/mux";
import { slugify } from "../../../lib/slugify";

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req
      .on("data", (chunk) => {
        data += chunk;
      })
      .on("end", () => resolve(data))
      .on("error", (err) => reject(err));
  });
}

function buildSlug(base: string) {
  let slug = slugify(base);
  if (!slug) {
    slug = slugify(`live-${Date.now()}`) || `live-${Date.now()}`;
  }
  return slug;
}

function extractRevealName(payload: unknown, fallback?: string | null) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const rawName = (payload as Record<string, unknown>).name;
    if (typeof rawName === "string" && rawName.trim()) {
      return rawName.trim();
    }
  }
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }
  return "Live Rip";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["mux-signature"];

  if (!verifyMuxWebhookSignature(rawBody, Array.isArray(signature) ? signature[0] : signature)) {
    return res.status(400).json({ message: "Invalid signature" });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    return res.status(400).json({ message: "Invalid JSON" });
  }

  const eventType: string | undefined = payload?.type;
  const data: any = payload?.data;

  try {
    switch (eventType) {
      case "video.live_stream.active": {
        const sessionId = data?.passthrough as string | undefined;
        const liveStreamId = data?.id as string | undefined;
        if (!sessionId && !liveStreamId) {
          break;
        }
        await prisma.kioskSession.updateMany({
          where: {
            OR: [
              sessionId ? { id: sessionId } : undefined,
              liveStreamId ? { muxStreamId: liveStreamId } : undefined,
            ].filter(Boolean) as any,
          },
          data: {
            status: "LIVE",
            liveStartedAt: new Date(),
          },
        });
        break;
      }
      case "video.live_stream.idle": {
        const sessionId = data?.passthrough as string | undefined;
        const liveStreamId = data?.id as string | undefined;
        if (!sessionId && !liveStreamId) {
          break;
        }
        await prisma.kioskSession.updateMany({
          where: {
            OR: [
              sessionId ? { id: sessionId } : undefined,
              liveStreamId ? { muxStreamId: liveStreamId } : undefined,
            ].filter(Boolean) as any,
          },
          data: {
            status: "REVEAL",
          },
        });
        break;
      }
      case "video.asset.ready": {
        const assetId = data?.id as string | undefined;
        const sessionId = data?.passthrough as string | undefined;
        const liveStreamId = data?.live_stream_id as string | undefined;
        if (!assetId) {
          break;
        }

        const asset = await getMuxAsset(assetId);
        const playbackId = asset.playback_ids?.[0]?.id ?? null;

        const session = await prisma.kioskSession.findFirst({
          where: {
            OR: [
              sessionId ? { id: sessionId } : undefined,
              liveStreamId ? { muxStreamId: liveStreamId } : undefined,
              { muxAssetId: assetId },
            ].filter(Boolean) as any,
          },
          include: {
            location: true,
            revealItem: true,
            liveRip: true,
          },
        });

        if (!session) {
          break;
        }

        const playbackUrl = playbackId ? buildMuxPlaybackUrl(playbackId) : session.videoUrl;

        await prisma.kioskSession.update({
          where: { id: session.id },
          data: {
            muxAssetId: assetId,
            muxPlaybackId: playbackId ?? session.muxPlaybackId,
            videoUrl: playbackUrl ?? session.videoUrl,
            completedAt: session.completedAt ?? new Date(),
          },
        });

        if (session.liveRip) {
          await prisma.liveRip.update({
            where: { id: session.liveRip.id },
            data: {
              videoUrl: playbackUrl ?? session.liveRip.videoUrl,
              muxAssetId: assetId,
              muxPlaybackId: playbackId,
            },
          });
        } else if (playbackUrl) {
          const title = extractRevealName(session.revealPayload, session.revealItem?.name);
          let slugBase = buildSlug(`${session.code}-${title}`);
          let candidateSlug = slugBase;
          let attempt = 1;
          while (await prisma.liveRip.findUnique({ where: { slug: candidateSlug } })) {
            candidateSlug = `${slugBase}-${attempt++}`;
          }

          await prisma.liveRip.create({
            data: {
              slug: candidateSlug,
              title,
              description: null,
              videoUrl: playbackUrl,
              thumbnailUrl: session.thumbnailUrl,
              locationId: session.locationId,
              featured: true,
              kioskSessionId: session.id,
              muxAssetId: assetId,
              muxPlaybackId: playbackId,
            },
          });
        }

        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("Mux webhook processing error", error);
    return res.status(500).json({ message: "Internal error" });
  }

  return res.status(200).json({ received: true });
}
