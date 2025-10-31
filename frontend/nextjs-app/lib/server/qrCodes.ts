import { customAlphabet } from "nanoid";
import {
  prisma,
  type Prisma,
  QrCodeState,
  QrCodeType,
  PackFulfillmentStatus,
} from "@tenkings/database";
import { buildSiteUrl } from "./urls";

const PAIR_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";

const generatePairId = customAlphabet(PAIR_ALPHABET, 6);
const generateCode = customAlphabet(CODE_ALPHABET, 12);

const isJsonObject = (value: Prisma.JsonValue | null): value is Prisma.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeMetadata = (current: Prisma.JsonValue | null, updates: Record<string, unknown>): Prisma.InputJsonValue => {
  const base = isJsonObject(current) ? { ...current } : {};
  return { ...base, ...updates } as Prisma.InputJsonValue;
};

export interface QrCodeSummary {
  id: string;
  code: string;
  serial: string | null;
  type: QrCodeType;
  state: QrCodeState;
  payloadUrl: string | null;
  pairId?: string;
}

export interface QrCodePair {
  pairId: string;
  card: QrCodeSummary;
  pack: QrCodeSummary;
}

const buildCardUrl = (code: string) => buildSiteUrl(`/claim/card/${code}`);
const buildPackUrl = (code: string) => buildSiteUrl(`/kiosk/start/${code}`);

const toSummary = (record: { id: string; code: string; serial: string | null; type: QrCodeType; state: QrCodeState; payloadUrl: string | null; metadata: Prisma.JsonValue | null }): QrCodeSummary => {
  const metadata = isJsonObject(record.metadata) ? record.metadata : null;
  const pairId = metadata && typeof metadata.pairId === "string" ? metadata.pairId : undefined;
  return {
    id: record.id,
    code: record.code,
    serial: record.serial,
    type: record.type,
    state: record.state,
    payloadUrl: record.payloadUrl,
    pairId,
  };
};

export async function createQrCodePairs({
  count,
  createdById,
  locationId,
}: {
  count: number;
  createdById: string;
  locationId?: string | null;
}): Promise<QrCodePair[]> {
  if (count <= 0) {
    throw new Error("Count must be greater than zero");
  }

  if (count > 200) {
    throw new Error("Cannot generate more than 200 pairs at once");
  }

  const pairs: QrCodePair[] = [];

  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < count; index += 1) {
      const pairId = `TK${generatePairId()}`;
      const cardCode = `tkc_${generateCode()}`;
      const packCode = `tkp_${generateCode()}`;
      const createdAt = new Date();

      const card = await tx.qrCode.create({
        data: {
          code: cardCode,
          serial: `${pairId}-CARD`,
          type: QrCodeType.CARD,
          state: QrCodeState.AVAILABLE,
          payloadUrl: buildCardUrl(cardCode),
          metadata: { pairId, role: "CARD" } as Prisma.InputJsonValue,
          locationId: locationId ?? null,
          createdById,
          createdAt,
          updatedAt: createdAt,
        },
      });

      const pack = await tx.qrCode.create({
        data: {
          code: packCode,
          serial: `${pairId}-PACK`,
          type: QrCodeType.PACK,
          state: QrCodeState.AVAILABLE,
          payloadUrl: buildPackUrl(packCode),
          metadata: { pairId, role: "PACK" } as Prisma.InputJsonValue,
          locationId: locationId ?? null,
          createdById,
          createdAt,
          updatedAt: createdAt,
        },
      });

      pairs.push({
        pairId,
        card: toSummary(card),
        pack: toSummary(pack),
      });
    }
  });

  return pairs;
}

export async function bindCardQrCode({
  code,
  itemId,
  userId,
}: {
  code: string;
  itemId: string;
  userId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { id: true, name: true, imageUrl: true, cardQrCodeId: true },
    });

    if (!item) {
      throw new Error("Card item not found");
    }

    const qr = await tx.qrCode.findUnique({
      where: { code },
      include: { item: { select: { id: true } } },
    });

    if (!qr) {
      throw new Error("QR code not found");
    }

    if (qr.type !== QrCodeType.CARD) {
      throw new Error("QR code is not a card label");
    }

    if (qr.state === QrCodeState.RETIRED) {
      throw new Error("QR code has been retired");
    }

    if (qr.item && qr.item.id !== item.id) {
      throw new Error("QR code already bound to another card");
    }

    if (item.cardQrCodeId && item.cardQrCodeId !== qr.id) {
      throw new Error("Card already has a different QR code");
    }

    const now = new Date();

    await tx.item.update({
      where: { id: item.id },
      data: { cardQrCodeId: qr.id },
    });

    const updated = await tx.qrCode.update({
      where: { id: qr.id },
      data: {
        state: QrCodeState.BOUND,
        boundById: userId,
        boundAt: now,
        metadata: mergeMetadata(qr.metadata, { boundItemId: item.id }),
      },
    });

    return {
      item,
      qrCode: toSummary(updated),
    };
  });
}

export async function bindPackQrCode({
  code,
  packInstanceId,
  userId,
  locationId,
}: {
  code: string;
  packInstanceId: string;
  userId: string;
  locationId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const pack = await tx.packInstance.findUnique({
      where: { id: packInstanceId },
      select: {
        id: true,
        fulfillmentStatus: true,
        packDefinitionId: true,
        packDefinition: { select: { name: true, price: true } },
        locationId: true,
        packedAt: true,
        packQrCodeId: true,
        slots: {
          take: 1,
          select: {
            item: { select: { id: true, name: true, cardQrCodeId: true } },
          },
        },
      },
    });

    if (!pack) {
      throw new Error("Pack not found");
    }

    const location = await tx.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true },
    });

    if (!location) {
      throw new Error("Location not found");
    }

    const qr = await tx.qrCode.findUnique({
      where: { code },
      include: { packInstance: { select: { id: true } } },
    });

    if (!qr) {
      throw new Error("QR code not found");
    }

    if (qr.type !== QrCodeType.PACK) {
      throw new Error("QR code is not a pack label");
    }

    if (qr.state === QrCodeState.RETIRED) {
      throw new Error("QR code has been retired");
    }

    if (qr.packInstance && qr.packInstance.id !== pack.id) {
      throw new Error("QR code already bound to another pack");
    }

    if (pack.packQrCodeId && pack.packQrCodeId !== qr.id) {
      throw new Error("Pack already has a different QR code");
    }

    const slot = pack.slots[0];
    if (!slot || !slot.item.cardQrCodeId) {
      throw new Error("Card QR code must be bound before sealing the pack");
    }

    const now = new Date();

    const updatedPack = await tx.packInstance.update({
      where: { id: pack.id },
      data: {
        packQrCodeId: qr.id,
        locationId: location.id,
        fulfillmentStatus: PackFulfillmentStatus.PACKED,
        packedAt: pack.packedAt ?? now,
        packedById: userId,
      },
      select: {
        id: true,
        fulfillmentStatus: true,
        packedAt: true,
        packDefinition: { select: { name: true, price: true } },
      },
    });

    const updatedQr = await tx.qrCode.update({
      where: { id: qr.id },
      data: {
        state: QrCodeState.BOUND,
        boundById: userId,
        boundAt: now,
        locationId: location.id,
        metadata: mergeMetadata(qr.metadata, { boundPackId: pack.id, locationId: location.id }),
      },
    });

    return {
      pack: updatedPack,
      location,
      qrCode: toSummary(updatedQr),
    };
  });
}
