import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { LiveRipStatus, PackStatus, Prisma, TransactionSource, TransactionType, prisma } from "@tenkings/database";
import { z } from "zod";
import Stripe from "stripe";
import {
  LIVE_RIP_CONSENT_TEXT,
  LIVE_RIP_CONSENT_TEXT_VERSION,
  buildBuyerLiveRipTitle,
  isAtLeastAge,
  parseDateOnly,
  reserveLiveRipSlug,
} from "../../../lib/server/liveRip";
import { buildMuxPlaybackUrl, buildMuxWhipUploadUrl, createMuxLiveStream, disableMuxLiveStream, muxCredentialsConfigured } from "../../../lib/server/mux";
import { requireUserSession, toUserErrorResponse } from "../../../lib/server/session";
import { buildSiteUrl } from "../../../lib/server/urls";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeClient = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2024-06-20",
    })
  : null;

const purchaseSchema = z.object({
  packDefinitionId: z.string().uuid(),
  userId: z.string().uuid(),
  paymentMethod: z.enum(["wallet", "stripe"]).default("wallet"),
  paymentIntentId: z.string().optional(),
  liveRip: z.object({
    enabled: z.literal(true),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    consentTextVersion: z.string().trim().min(1),
    consentTextSnapshot: z.string().min(1),
    consentedAt: z.string().datetime(),
  }),
});

async function cleanupMuxStream(streamId: string | null) {
  if (!streamId) {
    return;
  }
  await disableMuxLiveStream(streamId).catch((error) => {
    console.warn("[live-rip] Failed to disable orphaned Mux stream", error);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let muxStreamId: string | null = null;

  try {
    const session = await requireUserSession(req);
    const payload = purchaseSchema.parse(req.body ?? {});

    if (payload.userId !== session.user.id) {
      return res.status(403).json({ message: "Live rip purchase user mismatch" });
    }

    const dob = parseDateOnly(payload.liveRip.dob);
    if (!dob || !isAtLeastAge(dob)) {
      return res.status(400).json({ message: "You must be 18 or older to stream a live rip." });
    }

    if (payload.liveRip.consentTextVersion !== LIVE_RIP_CONSENT_TEXT_VERSION) {
      return res.status(409).json({ message: "Live rip consent text has changed. Review the latest consent before continuing." });
    }

    if (payload.liveRip.consentTextSnapshot !== LIVE_RIP_CONSENT_TEXT) {
      return res.status(409).json({ message: "Live rip consent text snapshot does not match the current server copy." });
    }

    if (!muxCredentialsConfigured()) {
      return res.status(500).json({ message: "Mux credentials are not configured" });
    }

    const definition = await prisma.packDefinition.findUnique({
      where: { id: payload.packDefinitionId },
    });
    if (!definition) {
      return res.status(404).json({ message: "Pack definition not found" });
    }

    if (payload.paymentMethod === "stripe") {
      if (!stripeClient) {
        return res.status(503).json({ message: "Stripe not configured" });
      }
      if (!payload.paymentIntentId) {
        return res.status(400).json({ message: "paymentIntentId required" });
      }
      const intent = await stripeClient.paymentIntents.retrieve(payload.paymentIntentId);
      if (intent.status !== "succeeded") {
        return res.status(400).json({ message: "payment not completed" });
      }
      if (intent.amount !== definition.price) {
        return res.status(400).json({ message: "payment amount mismatch" });
      }
      if (
        intent.metadata?.packDefinitionId !== payload.packDefinitionId ||
        intent.metadata?.userId !== payload.userId
      ) {
        return res.status(400).json({ message: "payment metadata mismatch" });
      }
    }

    const liveRipId = randomUUID();
    const muxStream = await createMuxLiveStream({
      passthrough: `liveRip:${liveRipId}`,
      livestreamName: buildBuyerLiveRipTitle(definition.name, session.user.displayName),
    });
    muxStreamId = muxStream.id;
    const muxPlaybackId = muxStream.playback_ids?.[0]?.id ?? null;
    const playbackUrl = muxPlaybackId ? buildMuxPlaybackUrl(muxPlaybackId) : "";
    const whipUploadUrl = buildMuxWhipUploadUrl(muxStream.stream_key);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const purchaser = await tx.user.upsert({
        where: { id: payload.userId },
        update: {
          dateOfBirth: dob,
        },
        create: {
          id: payload.userId,
          dateOfBirth: dob,
        },
      });

      const purchaserWallet = await tx.wallet.upsert({
        where: { userId: purchaser.id },
        update: {},
        create: { userId: purchaser.id },
      });

      const pack = await tx.packInstance.findFirst({
        where: { packDefinitionId: payload.packDefinitionId, status: PackStatus.UNOPENED, ownerId: null },
        include: {
          slots: {
            include: {
              item: {
                include: {
                  ingestionTask: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      if (!pack) {
        throw Object.assign(new Error("no inventory available"), { statusCode: 409 });
      }

      let walletBalance: number | null = null;

      if (payload.paymentMethod === "wallet") {
        if (purchaserWallet.balance < definition.price) {
          throw Object.assign(new Error("insufficient balance"), { statusCode: 400 });
        }

        const updatedWallet = await tx.wallet.update({
          where: { id: purchaserWallet.id },
          data: { balance: { decrement: definition.price } },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: updatedWallet.id,
            amount: definition.price,
            type: TransactionType.DEBIT,
            source: TransactionSource.PACK_PURCHASE,
            referenceId: pack.id,
            note: `Pack purchase ${definition.name}`,
          },
        });

        walletBalance = updatedWallet.balance;
      }

      const claimedPack = await tx.packInstance.update({
        where: { id: pack.id },
        data: { ownerId: purchaser.id },
        include: {
          slots: {
            include: {
              item: {
                include: {
                  ingestionTask: true,
                },
              },
            },
          },
        },
      });

      await tx.packDefinition.update({
        where: { id: definition.id },
        data: { inventoryCount: { decrement: 1 } },
      });

      const title = buildBuyerLiveRipTitle(definition.name, session.user.displayName);
      const slug = await reserveLiveRipSlug(tx, `${title}-${pack.id}`, title);

      const liveRip = await tx.liveRip.create({
        data: {
          id: liveRipId,
          slug,
          title,
          description: `Buyer-side Rip It Live session for ${definition.name}.`,
          videoUrl: playbackUrl,
          thumbnailUrl: muxPlaybackId
            ? `https://image.mux.com/${encodeURIComponent(muxPlaybackId)}/thumbnail.jpg?time=3&width=540&height=960&fit_mode=smartcrop`
            : null,
          userId: purchaser.id,
          status: LiveRipStatus.PENDING,
          featured: false,
          muxStreamId: muxStream.id,
          muxStreamKey: muxStream.stream_key,
          muxPlaybackId,
          whipUploadUrl,
          isGoldenTicket: false,
        },
      });

      const consentedAt = new Date(payload.liveRip.consentedAt);
      await tx.liveRipConsent.create({
        data: {
          userId: purchaser.id,
          liveRipId: liveRip.id,
          dob,
          consentTextVersion: LIVE_RIP_CONSENT_TEXT_VERSION,
          consentTextSnapshot: LIVE_RIP_CONSENT_TEXT,
          consentedAt,
        },
      });

      return {
        definition,
        pack: claimedPack,
        walletBalance,
        liveRip,
      };
    });

    muxStreamId = null;

    return res.status(200).json({
      definition: result.definition,
      pack: result.pack,
      walletBalance: result.walletBalance,
      liveRip: {
        id: result.liveRip.id,
        slug: result.liveRip.slug,
        status: result.liveRip.status,
        streamKey: result.liveRip.muxStreamKey,
        muxPlaybackId: result.liveRip.muxPlaybackId,
        playbackUrl,
        whipUploadUrl,
        watchUrl: buildSiteUrl(`/live/${result.liveRip.slug}`),
      },
    });
  } catch (error) {
    await cleanupMuxStream(muxStreamId);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid live rip purchase payload" });
    }
    const candidate = error as { statusCode?: number };
    if (candidate.statusCode && typeof candidate.statusCode === "number") {
      return res.status(candidate.statusCode).json({ message: error instanceof Error ? error.message : "Live rip purchase failed" });
    }
    const result = toUserErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
