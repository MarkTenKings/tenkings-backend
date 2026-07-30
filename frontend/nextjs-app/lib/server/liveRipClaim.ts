import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import { normalizePhoneInput } from "./stocker";
import { sendSms } from "./sms";
import { buildSiteUrl } from "./urls";
import {
  resolveLiveRipCustomerWithClient,
  type AuthenticatedLiveRipCustomer,
} from "./liveRipCustomer";

const SMS_CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const QR_CLAIM_TTL_MS = 15 * 60 * 1000;

export type LiveRipQrClaimStatus = "ready" | "claimed" | "expired" | "unavailable";

export class LiveRipClaimError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "LiveRipClaimError";
  }
}

export const assignLiveRipSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(120, "Customer name is too long"),
  phone: z.string().trim().min(8, "Mobile number is required"),
});

export const liveRipClaimTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{40,128}$/, "Claim token is invalid");

export function hashLiveRipClaimToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function assertLiveRipClaimAccess(params: {
  claimPhone: string | null;
  existingOwnerId: string | null;
  claimantUserId: string;
  claimantPhone: string | null;
}) {
  const claimPhone = normalizePhoneInput(params.claimPhone ?? "");
  if (!claimPhone) {
    if (params.existingOwnerId) {
      throw new LiveRipClaimError(409, "This Live Rip is already assigned to another customer");
    }
    return;
  }

  const claimantPhone = normalizePhoneInput(params.claimantPhone ?? "");
  if (!/^\+[1-9]\d{7,14}$/.test(claimantPhone) || claimantPhone !== claimPhone) {
    throw new LiveRipClaimError(403, "Sign in with the mobile number that received this claim link");
  }
  if (params.existingOwnerId && params.existingOwnerId !== params.claimantUserId) {
    throw new LiveRipClaimError(403, "This Live Rip is assigned to another customer");
  }
}

export function classifyLiveRipQrClaimStatus(
  liveRip: {
    status: string;
    userId: string | null;
    claimTokenHash: string | null;
    claimExpiresAt: Date | null;
    claimedAt: Date | null;
  } | null,
  now = new Date()
): LiveRipQrClaimStatus {
  if (!liveRip || liveRip.status !== "COMPLETE") {
    return "unavailable";
  }
  if (liveRip.userId || liveRip.claimedAt) {
    return "claimed";
  }
  if (!liveRip.claimTokenHash) {
    return "unavailable";
  }
  if (!liveRip.claimExpiresAt || liveRip.claimExpiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  return "ready";
}

function normalizeCustomerPhone(phone: string) {
  const normalized = normalizePhoneInput(phone);
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new LiveRipClaimError(400, "Enter a valid mobile number");
  }
  return normalized;
}

export function buildLiveRipClaimSms(claimUrl: string) {
  return `Your Ten Kings Live Rip is ready! Sign in or create your account to watch and download your video:\n\n${claimUrl}`;
}

export async function assignLiveRipAndSend(params: {
  liveRipId: string;
  name: string;
  phone: string;
  assignedByUserId: string;
}) {
  const name = params.name.trim();
  const phone = normalizeCustomerPhone(params.phone);
  const rawToken = randomBytes(32).toString("base64url");
  const claimTokenHash = hashLiveRipClaimToken(rawToken);
  const claimExpiresAt = new Date(Date.now() + SMS_CLAIM_TTL_MS);

  const assignment = await prisma.$transaction(async (tx) => {
    const liveRip = await tx.liveRip.findUnique({
      where: { id: params.liveRipId },
      include: {
        user: {
          select: {
            id: true,
            phone: true,
          },
        },
      },
    });

    if (!liveRip) {
      throw new LiveRipClaimError(404, "Live Rip video not found");
    }
    if (liveRip.status !== "COMPLETE") {
      throw new LiveRipClaimError(409, "Only recorded Live Rips can be assigned");
    }
    if (liveRip.claimedAt) {
      throw new LiveRipClaimError(409, "This Live Rip has already been permanently claimed");
    }

    if (liveRip.userId) {
      const currentOwnerPhone = normalizePhoneInput(liveRip.user?.phone ?? "");
      if (!currentOwnerPhone || currentOwnerPhone !== phone) {
        throw new LiveRipClaimError(409, "This Live Rip is already assigned to another customer");
      }
    }

    const customer = await tx.user.findUnique({
      where: { phone },
      select: { id: true },
    });

    const updated = await tx.liveRip.updateMany({
      where: {
        id: liveRip.id,
        claimedAt: null,
        updatedAt: liveRip.updatedAt,
      },
      data: {
        userId: customer?.id ?? null,
        claimName: name,
        claimPhone: phone,
        claimTokenHash,
        claimExpiresAt,
        assignedByUserId: params.assignedByUserId,
        smsSentAt: null,
      },
    });

    if (updated.count !== 1) {
      throw new LiveRipClaimError(409, "This Live Rip changed while it was being assigned. Try again.");
    }

    return {
      id: liveRip.id,
      customerId: customer?.id ?? null,
      claimStatus: customer ? ("assigned" as const) : ("pending" as const),
    };
  });

  const claimUrl = buildSiteUrl(`/claim/live-rip/${rawToken}`);
  try {
    await sendSms({
      to: phone,
      body: buildLiveRipClaimSms(claimUrl),
    });
  } catch (error) {
    console.error("[live-rip-claim] SMS delivery failed", {
      liveRipId: params.liveRipId,
      error,
    });
    throw new LiveRipClaimError(502, "The Live Rip was assigned, but the customer text could not be sent");
  }

  const smsSentAt = new Date();
  await prisma.liveRip.update({
    where: { id: assignment.id },
    data: { smsSentAt },
  });

  return {
    ...assignment,
    claimExpiresAt: claimExpiresAt.toISOString(),
    smsSentAt: smsSentAt.toISOString(),
  };
}

export async function createLiveRipQrClaim(params: {
  liveRipId: string;
  assignedByUserId: string;
}) {
  const rawToken = randomBytes(32).toString("base64url");
  const claimTokenHash = hashLiveRipClaimToken(rawToken);
  const claimExpiresAt = new Date(Date.now() + QR_CLAIM_TTL_MS);

  const liveRip = await prisma.$transaction(async (tx) => {
    const existing = await tx.liveRip.findUnique({
      where: { id: params.liveRipId },
      select: {
        id: true,
        title: true,
        thumbnailUrl: true,
        status: true,
        userId: true,
        claimedAt: true,
        updatedAt: true,
      },
    });

    if (!existing) {
      throw new LiveRipClaimError(404, "Live Rip video not found");
    }
    if (existing.status !== "COMPLETE") {
      throw new LiveRipClaimError(409, "Only recorded Live Rips can be claimed");
    }
    if (existing.userId || existing.claimedAt) {
      throw new LiveRipClaimError(409, "This Live Rip has already been claimed");
    }

    const updated = await tx.liveRip.updateMany({
      where: {
        id: existing.id,
        userId: null,
        claimedAt: null,
        updatedAt: existing.updatedAt,
      },
      data: {
        claimName: null,
        claimPhone: null,
        claimTokenHash,
        claimExpiresAt,
        assignedByUserId: params.assignedByUserId,
      },
    });

    if (updated.count !== 1) {
      throw new LiveRipClaimError(409, "This Live Rip changed while the QR was being created. Try again.");
    }

    return existing;
  });

  return {
    liveRipId: liveRip.id,
    title: liveRip.title,
    thumbnailUrl: liveRip.thumbnailUrl,
    claimUrl: buildSiteUrl(`/claim/live-rip/${rawToken}`),
    claimExpiresAt: claimExpiresAt.toISOString(),
  };
}

export async function getLiveRipQrClaimStatus(liveRipId: string) {
  const liveRip = await prisma.liveRip.findUnique({
    where: { id: liveRipId },
    select: {
      status: true,
      userId: true,
      claimTokenHash: true,
      claimExpiresAt: true,
      claimedAt: true,
    },
  });

  return {
    status: classifyLiveRipQrClaimStatus(liveRip),
    claimExpiresAt: liveRip?.claimExpiresAt?.toISOString() ?? null,
  };
}

export async function inspectLiveRipClaimToken(tokenInput: string) {
  const token = liveRipClaimTokenSchema.parse(tokenInput);
  const claimTokenHash = hashLiveRipClaimToken(token);
  const liveRip = await prisma.liveRip.findUnique({
    where: { claimTokenHash },
    select: {
      status: true,
      userId: true,
      claimTokenHash: true,
      claimExpiresAt: true,
      claimedAt: true,
    },
  });

  if (!liveRip || liveRip.status !== "COMPLETE" || liveRip.claimedAt || liveRip.userId) {
    throw new LiveRipClaimError(404, "This Live Rip claim link is invalid or has already been used");
  }
  if (!liveRip.claimExpiresAt || liveRip.claimExpiresAt.getTime() <= Date.now()) {
    throw new LiveRipClaimError(410, "This Live Rip claim link has expired");
  }

  return {
    status: "ready" as const,
    claimExpiresAt: liveRip.claimExpiresAt.toISOString(),
  };
}

export async function claimLiveRipForUser(params: {
  token: string;
  user: AuthenticatedLiveRipCustomer;
}) {
  const token = liveRipClaimTokenSchema.parse(params.token);
  const claimTokenHash = hashLiveRipClaimToken(token);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const liveRip = await tx.liveRip.findUnique({
      where: { claimTokenHash },
      select: {
        id: true,
        slug: true,
        userId: true,
        claimName: true,
        claimPhone: true,
        claimExpiresAt: true,
        claimedAt: true,
      },
    });

    if (!liveRip || liveRip.claimedAt) {
      throw new LiveRipClaimError(404, "This Live Rip claim link is invalid or has already been used");
    }
    if (!liveRip.claimExpiresAt || liveRip.claimExpiresAt.getTime() <= now.getTime()) {
      throw new LiveRipClaimError(410, "This Live Rip claim link has expired");
    }
    const customer = await resolveLiveRipCustomerWithClient(tx, params.user);
    assertLiveRipClaimAccess({
      claimPhone: liveRip.claimPhone,
      existingOwnerId: liveRip.userId,
      claimantUserId: customer.id,
      claimantPhone: customer.phone ?? params.user.phone,
    });

    const claimed = await tx.liveRip.updateMany({
      where: {
        id: liveRip.id,
        claimTokenHash,
        claimedAt: null,
        claimExpiresAt: { gt: now },
        ...(liveRip.claimPhone
          ? {
              OR: [{ userId: null }, { userId: customer.id }],
            }
          : {
              userId: null,
            }),
      },
      data: {
        userId: customer.id,
        claimTokenHash: null,
        claimExpiresAt: null,
        claimedAt: now,
      },
    });

    if (claimed.count !== 1) {
      throw new LiveRipClaimError(409, "This Live Rip claim link was already used");
    }

    if (liveRip.claimName) {
      await tx.user.updateMany({
        where: {
          id: customer.id,
          OR: [{ displayName: null }, { displayName: "" }],
        },
        data: {
          displayName: liveRip.claimName,
        },
      });
    }

    return {
      id: liveRip.id,
      slug: liveRip.slug,
      claimedAt: now.toISOString(),
      redirectTo: "/collection?section=live-rips",
    };
  });
}

export function toLiveRipClaimError(error: unknown) {
  if (error instanceof LiveRipClaimError) {
    return { status: error.statusCode, message: error.message } as const;
  }
  if (error instanceof z.ZodError) {
    return { status: 400, message: error.issues[0]?.message ?? "Invalid request" } as const;
  }
  if (
    error instanceof Error &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  ) {
    return {
      status: (error as { statusCode: number }).statusCode,
      message: error.message,
    } as const;
  }
  console.error("[live-rip-claim] unexpected error", error);
  return { status: 500, message: "Unexpected Live Rip claim error" } as const;
}
