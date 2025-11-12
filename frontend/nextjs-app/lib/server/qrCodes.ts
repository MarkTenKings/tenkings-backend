import { customAlphabet } from "nanoid";
import {
  prisma,
  type Prisma,
  QrCodeState,
  QrCodeType,
  PackFulfillmentStatus,
  PackLabelStatus,
  syncBatchStageFromPackStatuses,
} from "@tenkings/database";
import { buildSiteUrl } from "./urls";

const PAIR_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";

const generatePairId = customAlphabet(PAIR_ALPHABET, 6);
const generateCode = customAlphabet(CODE_ALPHABET, 12);

type TransactionClient = Prisma.TransactionClient;

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

export interface PackLabelSummary {
  id: string;
  pairId: string;
  status: PackLabelStatus;
  locationId: string | null;
  batchId: string | null;
  itemId: string | null;
  packInstanceId: string | null;
}

export interface QrCodePair {
  pairId: string;
  card: QrCodeSummary;
  pack: QrCodeSummary;
  label: PackLabelSummary;
}

export interface LabelReservationInput {
  packInstanceId: string;
  itemId: string;
  cardAssetId: string;
  batchId: string | null;
  locationId: string | null;
}

const buildCardUrl = (code: string) => buildSiteUrl(`/claim/card/${code}`);
const buildPackUrl = (code: string) => buildSiteUrl(`/kiosk/start/${code}`);

const toSummary = (record: {
  id: string;
  code: string;
  serial: string | null;
  type: QrCodeType;
  state: QrCodeState;
  payloadUrl: string | null;
  metadata: Prisma.JsonValue | null;
}): QrCodeSummary => {
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

const toLabelSummary = (label: {
  id: string;
  pairId: string;
  status: PackLabelStatus;
  locationId: string | null;
  batchId: string | null;
  itemId: string | null;
  packInstanceId: string | null;
}): PackLabelSummary => ({
  id: label.id,
  pairId: label.pairId,
  status: label.status,
  locationId: label.locationId,
  batchId: label.batchId,
  itemId: label.itemId,
  packInstanceId: label.packInstanceId,
});

const createPairWithLabelTx = async (
  tx: TransactionClient,
  {
    createdById,
    locationId,
  }: {
    createdById: string;
    locationId?: string | null;
  }
) => {
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

  const label = await tx.packLabel.create({
    data: {
      pairId,
      cardQrCodeId: card.id,
      packQrCodeId: pack.id,
      locationId: locationId ?? null,
      status: PackLabelStatus.RESERVED,
    },
  });

  return { pairId, card, pack, label };
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
      const { card, pack, label } = await createPairWithLabelTx(tx, {
        createdById,
        locationId: locationId ?? null,
      });

      pairs.push({
        pairId: label.pairId,
        card: toSummary(card),
        pack: toSummary(pack),
        label: toLabelSummary(label),
      });
    }
  });

  return pairs;
}

export async function reserveLabelsForPacks({
  assignments,
  createdById,
  autoBind = false,
  forceUnbind = false,
}: {
  assignments: LabelReservationInput[];
  createdById: string;
  autoBind?: boolean;
  forceUnbind?: boolean;
}): Promise<QrCodePair[]> {
  if (!assignments.length) {
    return [];
  }

  if (autoBind && forceUnbind) {
    throw new Error("autoBind and forceUnbind cannot both be enabled");
  }

  const results: QrCodePair[] = [];

  await prisma.$transaction(async (tx) => {
    const touchedBatchIds = new Set<string>();

    for (const assignment of assignments) {
      let label = await tx.packLabel.findUnique({
        where: { packInstanceId: assignment.packInstanceId },
        include: { cardQrCode: true, packQrCode: true },
      });

      if (!label) {
        label = await tx.packLabel.findFirst({
          where: {
            packInstanceId: null,
            itemId: null,
            status: PackLabelStatus.RESERVED,
            locationId: assignment.locationId ?? undefined,
          },
          orderBy: { createdAt: "asc" },
          include: { cardQrCode: true, packQrCode: true },
        });
      }

      if (!label) {
        const created = await createPairWithLabelTx(tx, {
          createdById,
          locationId: assignment.locationId ?? null,
        });
        label = await tx.packLabel.findUnique({
          where: { id: created.label.id },
          include: { cardQrCode: true, packQrCode: true },
        });
        if (!label) {
          throw new Error("Failed to create QR code label");
        }
      }

      const updatedLabel = await tx.packLabel.update({
        where: { id: label.id },
        data: {
          itemId: assignment.itemId,
          packInstanceId: assignment.packInstanceId,
          batchId: assignment.batchId ?? undefined,
          locationId: assignment.locationId ?? label.locationId,
        },
        include: { cardQrCode: true, packQrCode: true },
      });

      const now = new Date();
      const targetLocationId = forceUnbind ? null : assignment.locationId ?? updatedLabel.locationId ?? null;

      const needsPackRecord = autoBind || forceUnbind;
      let packRecord:
        | {
            id: string;
            packQrCodeId: string | null;
            fulfillmentStatus: PackFulfillmentStatus;
            locationId: string | null;
            packedAt: Date | null;
            packedById: string | null;
            sourceBatchId: string | null;
            slots: Array<{
              item: { id: string; cardQrCodeId: string | null } | null;
            }>;
          }
        | null = null;
      let slotItem: { id: string; cardQrCodeId: string | null } | null = null;

      if (needsPackRecord) {
        packRecord = await tx.packInstance.findUnique({
          where: { id: assignment.packInstanceId },
          select: {
            id: true,
            packQrCodeId: true,
            fulfillmentStatus: true,
            locationId: true,
            packedAt: true,
            packedById: true,
            sourceBatchId: true,
            slots: {
              take: 1,
              select: {
                item: { select: { id: true, cardQrCodeId: true } },
              },
            },
          },
        });

        if (!packRecord) {
          throw new Error(`Pack instance ${assignment.packInstanceId} not found`);
        }

        slotItem = packRecord.slots[0]?.item ?? null;
        if (!slotItem) {
          throw new Error(`Pack ${assignment.packInstanceId} is missing a primary card slot`);
        }

        if (slotItem.id !== assignment.itemId) {
          throw new Error(`Pack ${assignment.packInstanceId} is not linked to item ${assignment.itemId}`);
        }

        if (autoBind && slotItem.cardQrCodeId && slotItem.cardQrCodeId !== updatedLabel.cardQrCodeId) {
          throw new Error("Card already bound to a different QR code");
        }

        const batchKey = assignment.batchId ?? packRecord.sourceBatchId;
        if (batchKey) {
          touchedBatchIds.add(batchKey);
        }
      }

      const cardMetadataUpdates: Record<string, unknown> = {
        pairId: updatedLabel.pairId,
        role: "CARD",
        labelId: updatedLabel.id,
        reservedItemId: assignment.itemId,
        reservedPackInstanceId: assignment.packInstanceId,
        batchId: assignment.batchId,
      };
      if (autoBind) {
        cardMetadataUpdates.autoBound = true;
      }
      if (forceUnbind) {
        cardMetadataUpdates.autoBound = false;
      }

      const cardState = forceUnbind
        ? QrCodeState.RESERVED
        : autoBind
          ? QrCodeState.BOUND
          : updatedLabel.cardQrCode.state === QrCodeState.BOUND
            ? QrCodeState.BOUND
            : QrCodeState.RESERVED;

      const cardUpdateData: Prisma.QrCodeUpdateInput = {
        state: cardState,
        location:
          targetLocationId != null
            ? { connect: { id: targetLocationId } }
            : { disconnect: true },
        metadata: mergeMetadata(updatedLabel.cardQrCode.metadata, cardMetadataUpdates),
      };

      if (autoBind) {
        cardUpdateData.boundBy = { connect: { id: createdById } };
        cardUpdateData.boundAt = now;
      }

      if (forceUnbind) {
        cardUpdateData.boundBy = { disconnect: true };
        cardUpdateData.boundAt = null;
      }

      const cardQr = await tx.qrCode.update({
        where: { id: updatedLabel.cardQrCodeId },
        data: cardUpdateData,
      });

      const packMetadataUpdates: Record<string, unknown> = {
        pairId: updatedLabel.pairId,
        role: "PACK",
        labelId: updatedLabel.id,
        reservedPackInstanceId: assignment.packInstanceId,
        reservedItemId: assignment.itemId,
        batchId: assignment.batchId,
      };
      if (autoBind) {
        packMetadataUpdates.autoBound = true;
      }
      if (forceUnbind) {
        packMetadataUpdates.autoBound = false;
      }

      const packState = forceUnbind
        ? QrCodeState.RESERVED
        : autoBind
          ? QrCodeState.BOUND
          : updatedLabel.packQrCode.state === QrCodeState.BOUND
            ? QrCodeState.BOUND
            : QrCodeState.RESERVED;

      const packUpdateData: Prisma.QrCodeUpdateInput = {
        state: packState,
        location:
          targetLocationId != null
            ? { connect: { id: targetLocationId } }
            : { disconnect: true },
        metadata: mergeMetadata(updatedLabel.packQrCode.metadata, packMetadataUpdates),
      };

      if (autoBind) {
        packUpdateData.boundBy = { connect: { id: createdById } };
        packUpdateData.boundAt = now;
      }

      if (forceUnbind) {
        packUpdateData.boundBy = { disconnect: true };
        packUpdateData.boundAt = null;
      }

      const packQr = await tx.qrCode.update({
        where: { id: updatedLabel.packQrCodeId },
        data: packUpdateData,
      });

      if (packRecord && slotItem) {
        if (autoBind) {
          await tx.item.update({
            where: { id: assignment.itemId },
            data: { cardQrCodeId: updatedLabel.cardQrCodeId },
          });

          const nextStatus =
            packRecord.fulfillmentStatus === PackFulfillmentStatus.LOADED
              ? PackFulfillmentStatus.LOADED
              : PackFulfillmentStatus.PACKED;

          await tx.packInstance.update({
            where: { id: packRecord.id },
            data: {
              packQrCodeId: updatedLabel.packQrCodeId,
              locationId: targetLocationId,
              fulfillmentStatus: nextStatus,
              packedAt: packRecord.packedAt ?? now,
              packedById: createdById,
            },
          });
        }

        if (forceUnbind) {
          await tx.item.update({
            where: { id: assignment.itemId },
            data: { cardQrCodeId: null },
          });

          await tx.packInstance.update({
            where: { id: packRecord.id },
            data: {
              packQrCodeId: null,
              locationId: null,
              fulfillmentStatus: PackFulfillmentStatus.READY_FOR_PACKING,
              packedAt: null,
              packedById: null,
            },
          });
        }

        await syncPackAssetsLocation(tx, {
          packInstanceId: packRecord.id,
          packLabelId: updatedLabel.id,
          cardQrCodeId: updatedLabel.cardQrCodeId,
          packQrCodeId: updatedLabel.packQrCodeId,
          locationId: targetLocationId,
        });
      }

      await updateLabelBindingStatus(tx, updatedLabel.id);

      results.push({
        pairId: updatedLabel.pairId,
        card: toSummary(cardQr),
        pack: toSummary(packQr),
        label: toLabelSummary(updatedLabel),
      });
    }

    if (touchedBatchIds.size > 0) {
      await Promise.all(
        Array.from(touchedBatchIds).map((batchId) =>
          syncBatchStageFromPackStatuses({ tx, batchId, actorId: createdById })
        )
      );
    }
  });

  return results;
}

const updateLabelBindingStatus = async (tx: TransactionClient, labelId: string) => {
  const label = await tx.packLabel.findUnique({
    where: { id: labelId },
    include: {
      cardQrCode: { select: { state: true } },
      packQrCode: { select: { state: true } },
    },
  });

  if (!label) {
    return;
  }

  const bothBound =
    label.cardQrCode.state === QrCodeState.BOUND && label.packQrCode.state === QrCodeState.BOUND;
  const desired = bothBound ? PackLabelStatus.BOUND : PackLabelStatus.RESERVED;

  if (desired !== label.status) {
    await tx.packLabel.update({
      where: { id: label.id },
      data: { status: desired },
    });
  }
};

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
      include: { item: { select: { id: true } }, packLabelCard: { select: { id: true } } },
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

    const labelId = qr.packLabelCard?.id ?? null;
    if (labelId) {
      await tx.packLabel.update({
        where: { id: labelId },
        data: { itemId: item.id },
      });
      await updateLabelBindingStatus(tx, labelId);
    }

    return {
      item,
      qrCode: toSummary(updated),
    };
  });
}

export async function syncPackAssetsLocation(
  tx: TransactionClient,
  params: {
    packInstanceId: string;
    packLabelId: string | null;
    cardQrCodeId: string | null;
    packQrCodeId: string | null;
    locationId: string | null;
  }
) {
  const { packInstanceId, packLabelId, cardQrCodeId, packQrCodeId, locationId } = params;

  await tx.packInstance.update({
    where: { id: packInstanceId },
    data: { locationId },
  });

  if (packLabelId) {
    await tx.packLabel.update({ where: { id: packLabelId }, data: { locationId } });
  }

  const qrLocationUpdate: Prisma.QrCodeUpdateInput = locationId
    ? { location: { connect: { id: locationId } } }
    : { location: { disconnect: true } };

  const qrIds: string[] = [];
  if (cardQrCodeId) {
    qrIds.push(cardQrCodeId);
  }
  if (packQrCodeId) {
    qrIds.push(packQrCodeId);
  }

  for (const qrId of qrIds) {
    await tx.qrCode.update({ where: { id: qrId }, data: qrLocationUpdate });
  }
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
        sourceBatchId: true,
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
      include: { packInstance: { select: { id: true } }, packLabelPack: { select: { id: true } } },
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

    const labelId = qr.packLabelPack?.id ?? null;
    if (labelId) {
      await tx.packLabel.update({
        where: { id: labelId },
        data: {
          packInstanceId,
          locationId: location.id,
        },
      });
      await updateLabelBindingStatus(tx, labelId);
    }

    if (pack.sourceBatchId) {
      await syncBatchStageFromPackStatuses({
        tx,
        batchId: pack.sourceBatchId,
        actorId: userId,
      });
    }

    return {
      pack: updatedPack,
      location,
      qrCode: toSummary(updatedQr),
    };
  });
}
