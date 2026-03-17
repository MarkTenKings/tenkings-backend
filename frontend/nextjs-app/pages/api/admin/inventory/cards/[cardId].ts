import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, Prisma } from "@tenkings/database";
import { CollectibleCategory } from "@prisma/client";
import {
  createClassificationPayloadFromAttributes,
  parseClassificationPayload,
  type CardAttributes,
  type NormalizedClassificationComics,
  type NormalizedClassification,
  type NormalizedClassificationSport,
  type NormalizedClassificationTcg,
} from "@tenkings/shared";
import { z } from "zod";
import type { InventoryCardUpdatePayload } from "../../../../../lib/adminInventory";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  INVENTORY_CARD_SELECT,
  serializeInventoryCardSummary,
} from "../../../../../lib/server/adminInventory";

const updateSchema = z
  .object({
    playerName: z.string().max(200).optional(),
    setName: z.string().max(200).optional(),
    year: z.string().max(40).optional(),
    cardNumber: z.string().max(80).optional(),
    parallel: z.union([z.string().max(120), z.null()]).optional(),
    valuationMinor: z.number().int().min(0).optional(),
    category: z.nativeEnum(CollectibleCategory).optional(),
    subCategory: z.string().max(120).optional(),
    brand: z.string().max(120).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

const defaultCardAttributes: CardAttributes = {
  playerName: null,
  teamName: null,
  year: null,
  brand: null,
  setName: null,
  variantKeywords: [],
  numbered: null,
  rookie: false,
  autograph: false,
  memorabilia: false,
  gradeCompany: null,
  gradeValue: null,
};

const defaultSportSection: NormalizedClassificationSport = {
  playerName: null,
  teamName: null,
  league: null,
  sport: null,
  cardType: null,
  subcategory: null,
  autograph: null,
  foil: null,
  graded: null,
  gradeCompany: null,
  grade: null,
};

const defaultTcgSection: NormalizedClassificationTcg = {
  cardName: null,
  game: null,
  series: null,
  color: null,
  type: null,
  language: null,
  foil: null,
  rarity: null,
  outOf: null,
  subcategory: null,
};

const defaultComicsSection: NormalizedClassificationComics = {
  title: null,
  issueNumber: null,
  date: null,
  originDate: null,
  storyArc: null,
  graded: null,
  gradeCompany: null,
  grade: null,
};

function cloneCardAttributes(attributes: CardAttributes): CardAttributes {
  return {
    playerName: attributes.playerName,
    teamName: attributes.teamName,
    year: attributes.year,
    brand: attributes.brand,
    setName: attributes.setName,
    variantKeywords: [...attributes.variantKeywords],
    numbered: attributes.numbered,
    rookie: attributes.rookie,
    autograph: attributes.autograph,
    memorabilia: attributes.memorabilia,
    gradeCompany: attributes.gradeCompany,
    gradeValue: attributes.gradeValue,
  };
}

function trimToNull(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildEmptyNormalized(existing?: NormalizedClassification | null): NormalizedClassification {
  if (existing) {
    return JSON.parse(JSON.stringify(existing)) as NormalizedClassification;
  }

  return {
    categoryType: "unknown",
    displayName: null,
    cardNumber: null,
    setName: null,
    setCode: null,
    year: null,
    company: null,
    rarity: null,
    links: {},
    pricing: [],
  };
}

function buildUpdatedClassificationJson(
  currentValue: Prisma.JsonValue | null,
  updates: InventoryCardUpdatePayload
) {
  const current = parseClassificationPayload(currentValue);
  const attributes = cloneCardAttributes(current?.attributes ?? defaultCardAttributes);
  let normalized = current?.normalized ? buildEmptyNormalized(current.normalized) : null;
  let changed = false;

  if (Object.prototype.hasOwnProperty.call(updates, "playerName")) {
    const playerName = trimToNull(updates.playerName);
    attributes.playerName = playerName;
    normalized = buildEmptyNormalized(normalized);
    normalized.displayName = playerName ?? normalized.setName ?? null;
    if (normalized.categoryType === "sport" || normalized.sport) {
      normalized.sport = {
        ...defaultSportSection,
        ...(normalized.sport ?? {}),
        playerName,
      };
    }
    if (normalized.categoryType === "tcg" || normalized.tcg) {
      normalized.tcg = {
        ...defaultTcgSection,
        ...(normalized.tcg ?? {}),
        cardName: playerName,
      };
    }
    if (normalized.categoryType === "comics" || normalized.comics) {
      normalized.comics = {
        ...defaultComicsSection,
        ...(normalized.comics ?? {}),
        title: playerName,
      };
    }
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "setName")) {
    const setName = trimToNull(updates.setName);
    attributes.setName = setName;
    normalized = buildEmptyNormalized(normalized);
    normalized.setName = setName;
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "year")) {
    const year = trimToNull(updates.year);
    attributes.year = year;
    normalized = buildEmptyNormalized(normalized);
    normalized.year = year;
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "brand")) {
    const brand = trimToNull(updates.brand);
    attributes.brand = brand;
    normalized = buildEmptyNormalized(normalized);
    normalized.company = brand;
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "cardNumber")) {
    const cardNumber = trimToNull(updates.cardNumber);
    normalized = buildEmptyNormalized(normalized);
    normalized.cardNumber = cardNumber;
    if (normalized.categoryType === "comics" || normalized.comics) {
      normalized.comics = {
        ...defaultComicsSection,
        ...(normalized.comics ?? {}),
        issueNumber: cardNumber,
      };
    }
    changed = true;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "parallel")) {
    const parallel = trimToNull(updates.parallel ?? null);
    attributes.variantKeywords = parallel ? [parallel] : [];
    changed = true;
  }

  if (!changed) {
    return undefined;
  }

  return JSON.parse(
    JSON.stringify(createClassificationPayloadFromAttributes(attributes, normalized ?? null))
  ) as Prisma.InputJsonValue;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const cardId = Array.isArray(req.query.cardId) ? req.query.cardId[0] : req.query.cardId;
    if (!cardId) {
      return res.status(400).json({ message: "Card id is required" });
    }

    const updates = updateSchema.parse(req.body ?? {});

    const payload = await prisma.$transaction(async (tx) => {
      const card = await tx.cardAsset.findUnique({
        where: { id: cardId },
        select: {
          id: true,
          classificationJson: true,
          reviewStage: true,
          inventoryBatchId: true,
        },
      });

      if (!card) {
        return { status: 404 as const, body: { message: "Card not found" } };
      }

      if (card.reviewStage !== "INVENTORY_READY_FOR_SALE") {
        return {
          status: 409 as const,
          body: { message: "Only inventory-ready cards can be edited here" },
        };
      }

      if (card.inventoryBatchId !== null) {
        return {
          status: 409 as const,
          body: { message: "Assigned cards can no longer be edited from Inventory" },
        };
      }

      const data: Prisma.CardAssetUpdateManyMutationInput = {};

      if (Object.prototype.hasOwnProperty.call(updates, "playerName")) {
        data.resolvedPlayerName = trimToNull(updates.playerName);
      }
      if (Object.prototype.hasOwnProperty.call(updates, "valuationMinor")) {
        data.valuationMinor = updates.valuationMinor;
      }
      if (Object.prototype.hasOwnProperty.call(updates, "category")) {
        data.category = updates.category;
      }
      if (Object.prototype.hasOwnProperty.call(updates, "subCategory")) {
        data.subCategory = trimToNull(updates.subCategory);
      }

      const nextClassificationJson = buildUpdatedClassificationJson(card.classificationJson, updates);
      if (nextClassificationJson !== undefined) {
        data.classificationJson = nextClassificationJson;
      }

      const updated = await tx.cardAsset.updateMany({
        where: {
          id: cardId,
          reviewStage: "INVENTORY_READY_FOR_SALE",
          inventoryBatchId: null,
        },
        data,
      });

      if (updated.count !== 1) {
        return {
          status: 409 as const,
          body: { message: "Card changed state before the edit was saved" },
        };
      }

      const nextCard = await tx.cardAsset.findUnique({
        where: { id: cardId },
        select: INVENTORY_CARD_SELECT,
      });

      if (!nextCard) {
        return {
          status: 404 as const,
          body: { message: "Card not found after update" },
        };
      }

      return {
        status: 200 as const,
        body: {
          card: serializeInventoryCardSummary(nextCard),
        },
      };
    });

    return res.status(payload.status).json(payload.body);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
