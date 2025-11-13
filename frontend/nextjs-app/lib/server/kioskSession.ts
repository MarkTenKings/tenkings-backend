import type { Prisma } from "@prisma/client";

const secondsToMs = (seconds: number | null | undefined) => (seconds ?? 0) * 1000;

export const kioskSessionInclude = {
  packInstance: {
    include: {
      packDefinition: true,
      packQrCode: true,
    },
  },
  packQrCode: true,
  location: true,
  revealItem: true,
  liveRip: true,
  claimedBy: {
    select: {
      id: true,
      displayName: true,
      phone: true,
    },
  },
} satisfies Prisma.KioskSessionInclude;

export type KioskSessionWithRelations = Prisma.KioskSessionGetPayload<{
  include: typeof kioskSessionInclude;
}>;

export function serializeKioskSession(session: KioskSessionWithRelations) {
  const countdownEnds = new Date(session.countdownStartedAt.getTime() + secondsToMs(session.countdownSeconds));
  const liveEnds = session.liveStartedAt
    ? new Date(session.liveStartedAt.getTime() + secondsToMs(session.liveSeconds))
    : null;
  const revealEnds = session.revealStartedAt
    ? new Date(session.revealStartedAt.getTime() + secondsToMs(session.revealSeconds))
    : null;

  return {
    id: session.id,
    code: session.code,
    status: session.status,
    countdownSeconds: session.countdownSeconds,
    liveSeconds: session.liveSeconds,
    revealSeconds: session.revealSeconds,
    countdownStartedAt: session.countdownStartedAt.toISOString(),
    countdownEndsAt: countdownEnds.toISOString(),
    liveStartedAt: session.liveStartedAt ? session.liveStartedAt.toISOString() : null,
    liveEndsAt: liveEnds ? liveEnds.toISOString() : null,
    revealStartedAt: session.revealStartedAt ? session.revealStartedAt.toISOString() : null,
    revealEndsAt: revealEnds ? revealEnds.toISOString() : null,
    videoUrl: session.videoUrl,
    thumbnailUrl: session.thumbnailUrl,
    muxPlaybackId: session.muxPlaybackId ?? null,
    qrLinkUrl: session.qrLinkUrl,
    buybackLinkUrl: session.buybackLinkUrl,
    claimStatus: session.claimStatus,
    claimedBy: session.claimedBy
      ? {
          id: session.claimedBy.id,
          displayName: session.claimedBy.displayName,
          phone: session.claimedBy.phone,
        }
      : null,
    packQrCode: session.packQrCode
      ? {
          id: session.packQrCode.id,
          code: session.packQrCode.code,
          serial: session.packQrCode.serial,
        }
      : session.packInstance?.packQrCode
        ? {
            id: session.packInstance.packQrCode.id,
            code: session.packInstance.packQrCode.code,
            serial: session.packInstance.packQrCode.serial,
          }
        : null,
    packResetVersion: session.packResetVersion ?? 0,
    packQrCodeSerial: session.packQrCodeSerial,
    completedAt: session.completedAt ? session.completedAt.toISOString() : null,
    updatedAt: session.updatedAt.toISOString(),
    reveal: session.revealPayload ?? (session.revealItem
      ? {
          itemId: session.revealItem.id,
          name: session.revealItem.name,
          set: session.revealItem.set,
          number: session.revealItem.number,
          estimatedValue: session.revealItem.estimatedValue,
          imageUrl: session.revealItem.imageUrl,
          thumbnailUrl: session.revealItem.thumbnailUrl,
        }
      : null),
    pack: session.packInstance
      ? {
          id: session.packInstance.id,
          status: session.packInstance.status,
          fulfillmentStatus: session.packInstance.fulfillmentStatus,
          definition: session.packInstance.packDefinition
            ? {
                id: session.packInstance.packDefinition.id,
                name: session.packInstance.packDefinition.name,
                price: session.packInstance.packDefinition.price,
                tier: session.packInstance.packDefinition.tier,
                category: session.packInstance.packDefinition.category,
              }
            : null,
        }
      : null,
    location: session.location
      ? {
          id: session.location.id,
          name: session.location.name,
          slug: session.location.slug,
        }
      : null,
    liveRip: session.liveRip
      ? {
          id: session.liveRip.id,
          slug: session.liveRip.slug,
          title: session.liveRip.title,
          videoUrl: session.liveRip.videoUrl,
          thumbnailUrl: session.liveRip.thumbnailUrl,
          createdAt: session.liveRip.createdAt.toISOString(),
          viewCount: session.liveRip.viewCount ?? null,
        }
      : null,
  };
}

export type SerializedKioskSession = ReturnType<typeof serializeKioskSession>;
