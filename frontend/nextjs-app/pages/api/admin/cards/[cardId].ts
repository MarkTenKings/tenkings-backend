import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, Prisma } from "@tenkings/database";
import {
  buildComparableEbayUrls,
  buildEbaySoldUrlFromText,
  extractCardAttributes,
  parseClassificationPayload,
  createClassificationPayloadFromAttributes,
  type CardAttributes,
  type NormalizedClassification,
  type ClassificationCategory,
  type NormalizedClassificationSport,
  type NormalizedClassificationTcg,
  type NormalizedClassificationComics,
} from "@tenkings/shared";
import { ensureLabelPairForItem } from "../../../../lib/server/qrCodes";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const defaultCardAttributes: CardAttributes = {
  playerName: null,
  teamName: null,
  year: null,
  brand: null,
  setName: null,
  variantKeywords: [],
  serialNumber: null,
  rookie: false,
  autograph: false,
  memorabilia: false,
  gradeCompany: null,
  gradeValue: null,
};

const cloneCardAttributes = (attributes: CardAttributes): CardAttributes => ({
  playerName: attributes.playerName,
  teamName: attributes.teamName,
  year: attributes.year,
  brand: attributes.brand,
  setName: attributes.setName,
  variantKeywords: [...attributes.variantKeywords],
  serialNumber: attributes.serialNumber,
  rookie: attributes.rookie,
  autograph: attributes.autograph,
  memorabilia: attributes.memorabilia,
  gradeCompany: attributes.gradeCompany,
  gradeValue: attributes.gradeValue,
});

type AttributeUpdatePayload = Partial<CardAttributes> & {
  variantKeywords?: string[] | null;
};

type NormalizedUpdatePayload = {
  categoryType?: ClassificationCategory;
  displayName?: string | null;
  cardNumber?: string | null;
  setName?: string | null;
  setCode?: string | null;
  year?: string | null;
  company?: string | null;
  rarity?: string | null;
  links?: Record<string, string | null | undefined>;
  sport?: Partial<NormalizedClassificationSport> | null;
  tcg?: Partial<NormalizedClassificationTcg> | null;
  comics?: Partial<NormalizedClassificationComics> | null;
};

type ClassificationUpdatePayload = {
  attributes?: AttributeUpdatePayload;
  normalized?: NormalizedUpdatePayload | null;
};


const sanitizeStringInput = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const sanitizeStringOptional = (value: unknown, current: string | null): string | null => {
  if (value === undefined) {
    return current;
  }
  return sanitizeStringInput(value);
};

const sanitizeVariantKeywords = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const keywords: string[] = [];
  value.forEach((entry) => {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        keywords.push(trimmed);
      }
    }
  });
  return keywords;
};

const coerceBooleanInput = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  if (value === null) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "n", "0"].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const readNumberInput = (value: unknown): number | null => {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const readIntegerInput = (value: unknown): number | null => {
  const numeric = readNumberInput(value);
  if (numeric === null) {
    return null;
  }
  return Math.round(numeric);
};

const resolveItemName = (card: {
  id: string;
  customTitle: string | null;
  resolvedPlayerName: string | null;
  fileName: string;
  classificationJson: unknown;
}) => {
  if (card.customTitle?.trim()) {
    return card.customTitle.trim();
  }
  const classification = parseClassificationPayload(card.classificationJson);
  if (classification?.normalized?.displayName?.trim()) {
    return classification.normalized.displayName.trim();
  }
  if (card.resolvedPlayerName?.trim()) {
    return card.resolvedPlayerName.trim();
  }
  return card.fileName || `Card ${card.id}`;
};

const resolveItemSet = (card: { classificationJson: unknown }) => {
  const classification = parseClassificationPayload(card.classificationJson);
  return (
    classification?.normalized?.setName?.trim() ??
    classification?.attributes?.setName?.trim() ??
    "Unknown Set"
  );
};

const ensureInventoryReadyArtifacts = async (cardId: string, userId: string) => {
  const card = await prisma.cardAsset.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      fileName: true,
      imageUrl: true,
      thumbnailUrl: true,
      customTitle: true,
      resolvedPlayerName: true,
      classificationJson: true,
      ocrJson: true,
      valuationMinor: true,
    },
  });

  if (!card) {
    throw new Error("Card not found");
  }

  const owner = await prisma.user.findUnique({ where: { id: userId } });
  if (!owner) {
    throw new Error("Owner account not found");
  }

  let item = await prisma.item.findFirst({ where: { number: card.id } });
  if (!item) {
    const name = resolveItemName(card);
    const set = resolveItemSet(card);
    const detailsJson = (card.classificationJson as Prisma.InputJsonValue | null) ?? (card.ocrJson as Prisma.InputJsonValue | null) ?? undefined;

    item = await prisma.item.create({
      data: {
        name,
        set,
        number: card.id,
        language: null,
        foil: false,
        estimatedValue: card.valuationMinor ?? null,
        ownerId: owner.id,
        imageUrl: card.imageUrl,
        thumbnailUrl: card.thumbnailUrl ?? null,
        detailsJson,
      },
    });

    await prisma.itemOwnership.create({
      data: {
        itemId: item.id,
        ownerId: owner.id,
        note: `Minted from card asset ${card.id} (Inventory Ready)`,
      },
    });
  }

  await ensureLabelPairForItem({
    itemId: item.id,
    createdById: userId,
    locationId: null,
  });
};

const applyAttributeUpdates = (
  current: CardAttributes,
  updates: AttributeUpdatePayload
): CardAttributes => {
  const next = cloneCardAttributes(current);

  if (Object.prototype.hasOwnProperty.call(updates, "playerName")) {
    next.playerName = sanitizeStringOptional(updates.playerName, next.playerName);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "teamName")) {
    next.teamName = sanitizeStringOptional(updates.teamName, next.teamName);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "year")) {
    next.year = sanitizeStringOptional(updates.year, next.year);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "brand")) {
    next.brand = sanitizeStringOptional(updates.brand, next.brand);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "setName")) {
    next.setName = sanitizeStringOptional(updates.setName, next.setName);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "serialNumber")) {
    next.serialNumber = sanitizeStringOptional(updates.serialNumber, next.serialNumber);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "gradeCompany")) {
    next.gradeCompany = sanitizeStringOptional(updates.gradeCompany, next.gradeCompany);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "gradeValue")) {
    next.gradeValue = sanitizeStringOptional(updates.gradeValue, next.gradeValue);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "variantKeywords")) {
    next.variantKeywords = sanitizeVariantKeywords(updates.variantKeywords ?? []);
  }

  if (Object.prototype.hasOwnProperty.call(updates, "rookie")) {
    next.rookie = coerceBooleanInput(updates.rookie, next.rookie);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "autograph")) {
    next.autograph = coerceBooleanInput(updates.autograph, next.autograph);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "memorabilia")) {
    next.memorabilia = coerceBooleanInput(updates.memorabilia, next.memorabilia);
  }

  return next;
};

const sanitizeLinkUpdates = (
  current: Record<string, string>,
  updates?: Record<string, string | null | undefined>
) => {
  if (!updates) {
    return current;
  }
  const next = { ...current };
  for (const [key, value] of Object.entries(updates)) {
    const trimmedKey = typeof key === "string" ? key.trim() : "";
    if (!trimmedKey) {
      continue;
    }
    if (value === null || value === undefined) {
      delete next[trimmedKey];
      continue;
    }
    if (typeof value === "string") {
      const trimmedValue = value.trim();
      if (trimmedValue.length === 0) {
        delete next[trimmedKey];
      } else {
        next[trimmedKey] = trimmedValue;
      }
    }
  }
  return next;
};

const applyNormalizedSectionUpdate = <T extends object>(
  current: T | undefined,
  updates: Partial<T> | null | undefined
): T | undefined => {
  if (updates === undefined) {
    return current;
  }
  if (updates === null) {
    return undefined;
  }
  const base = { ...(current ?? {}) } as T;
  for (const [key, value] of Object.entries(updates)) {
    const typedKey = key as keyof T;
    if (typeof value === "string") {
      const sanitized = value.trim().length > 0 ? value.trim() : null;
      base[typedKey] = sanitized as T[typeof typedKey];
    } else if (typeof value === "boolean" || typeof value === "number" || value === null) {
      base[typedKey] = value as T[typeof typedKey];
    } else if (value !== undefined) {
      base[typedKey] = value as T[typeof typedKey];
    }
  }
  return base;
};

const isNormalizedSportEmpty = (sport?: NormalizedClassificationSport): boolean => {
  if (!sport) {
    return true;
  }
  const { playerName, teamName, league, sport: sportName, cardType, subcategory, autograph, foil, graded, gradeCompany, grade } = sport;
  return [playerName, teamName, league, sportName, cardType, subcategory, gradeCompany, grade].every((value) => !value) &&
    autograph == null &&
    foil == null &&
    graded == null;
};

const isNormalizedTcgEmpty = (tcg?: NormalizedClassificationTcg): boolean => {
  if (!tcg) {
    return true;
  }
  const { cardName, game, series, color, type, language, rarity, outOf, subcategory, foil } = tcg;
  return [cardName, game, series, color, type, language, rarity, outOf, subcategory].every((value) => !value) &&
    foil == null;
};

const isNormalizedComicsEmpty = (comics?: NormalizedClassificationComics): boolean => {
  if (!comics) {
    return true;
  }
  const { title, issueNumber, date, originDate, storyArc, graded, gradeCompany, grade } = comics;
  return [title, issueNumber, date, originDate, storyArc, gradeCompany, grade].every((value) => !value) && graded == null;
};

const applyNormalizedUpdates = (
  current: NormalizedClassification | null,
  updates: NormalizedUpdatePayload | null | undefined
): NormalizedClassification | null => {
  if (updates === undefined) {
    return current;
  }
  if (updates === null) {
    return null;
  }

  const base: NormalizedClassification = current
    ? {
        ...current,
        links: { ...current.links },
        pricing: Array.isArray(current.pricing) ? [...current.pricing] : [],
        sport: current.sport ? { ...current.sport } : undefined,
        tcg: current.tcg ? { ...current.tcg } : undefined,
        comics: current.comics ? { ...current.comics } : undefined,
      }
    : {
        categoryType: updates.categoryType ?? "unknown",
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

  if (updates.categoryType) {
    base.categoryType = updates.categoryType;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "displayName")) {
    base.displayName = sanitizeStringOptional(updates.displayName ?? null, base.displayName);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "cardNumber")) {
    base.cardNumber = sanitizeStringOptional(updates.cardNumber ?? null, base.cardNumber);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "setName")) {
    base.setName = sanitizeStringOptional(updates.setName ?? null, base.setName);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "setCode")) {
    base.setCode = sanitizeStringOptional(updates.setCode ?? null, base.setCode);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "year")) {
    base.year = sanitizeStringOptional(updates.year ?? null, base.year);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "company")) {
    base.company = sanitizeStringOptional(updates.company ?? null, base.company);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "rarity")) {
    base.rarity = sanitizeStringOptional(updates.rarity ?? null, base.rarity);
  }

  base.links = sanitizeLinkUpdates(base.links, updates.links);

  base.sport = applyNormalizedSectionUpdate(base.sport, updates.sport);
  if (isNormalizedSportEmpty(base.sport)) {
    base.sport = undefined;
  }

  base.tcg = applyNormalizedSectionUpdate(base.tcg, updates.tcg);
  if (isNormalizedTcgEmpty(base.tcg)) {
    base.tcg = undefined;
  }

  base.comics = applyNormalizedSectionUpdate(base.comics, updates.comics);
  if (isNormalizedComicsEmpty(base.comics)) {
    base.comics = undefined;
  }

  return base;
};

interface CardNotePayload {
  id: string;
  authorId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

interface SportsDbSummary {
  playerId: string | null;
  matchConfidence: number;
  playerName: string | null;
  teamName: string | null;
  teamLogoUrl: string | null;
  sport: string | null;
  league: string | null;
  snapshot: Record<string, unknown> | null;
}

interface CardResponse {
  id: string;
  batchId: string;
  status: string;
  fileName: string;
  fileSize: number;
  imageUrl: string;
  thumbnailUrl: string | null;
  mimeType: string;
  ocrText: string | null;
  classification: CardAttributes | null;
  classificationNormalized: NormalizedClassification | null;
  customTitle: string | null;
  customDetails: string | null;
  valuationMinor: number | null;
  valuationCurrency: string | null;
  valuationSource: string | null;
  marketplaceUrl: string | null;
  ebaySoldUrl: string | null;
  ebaySoldUrlVariant: string | null;
  ebaySoldUrlHighGrade: string | null;
  ebaySoldUrlPlayerComp: string | null;
  ebaySoldUrlAiGrade: string | null;
  assignedDefinitionId: string | null;
  assignedAt: string | null;
  reviewStage: string | null;
  reviewStageUpdatedAt: string | null;
  notes: CardNotePayload[];
  createdAt: string;
  updatedAt: string;
  humanReviewedAt: string | null;
  humanReviewerName: string | null;
  sportsDb: SportsDbSummary;
  aiGrade: {
    final: number | null;
    label: string | null;
    psaEquivalent: number | null;
    rangeLow: number | null;
    rangeHigh: number | null;
    generatedAt: string | null;
    visualizationUrl: string | null;
    exactVisualizationUrl: string | null;
  } | null;
  classificationSources: Record<string, unknown> | null;
  label:
    | {
        id: string;
        pairId: string;
        status: string;
        card: { id: string; code: string; serial: string | null; payloadUrl: string | null };
        pack: { id: string; code: string; serial: string | null; payloadUrl: string | null };
      }
    | null;
}


type CardUpdatePayload = {
  ocrText?: string | null;
  customTitle?: string | null;
  customDetails?: string | null;
  reviewStage?: string | null;
  valuationMinor?: number | null;
  valuationCurrency?: string | null;
  valuationSource?: string | null;
  marketplaceUrl?: string | null;
  ebaySoldUrl?: string | null;
  ebaySoldUrlVariant?: string | null;
  ebaySoldUrlHighGrade?: string | null;
  ebaySoldUrlPlayerComp?: string | null;
  ebaySoldUrlAiGrade?: string | null;
  humanReviewed?: boolean;
  generateEbaySoldUrl?: boolean;
  classificationUpdates?: ClassificationUpdatePayload;
  aiGradeFinal?: number | string | null;
  aiGradeLabel?: string | null;
  aiGradePsaEquivalent?: number | string | null;
  aiGradeRangeLow?: number | string | null;
  aiGradeRangeHigh?: number | string | null;
};

async function fetchCard(cardId: string, uploadedById: string): Promise<CardResponse | null> {
  const card = await prisma.cardAsset.findFirst({
    where: { id: cardId, batch: { uploadedById } },
    include: {
      batch: true,
      notes: {
        orderBy: { createdAt: "desc" },
        include: {
          author: {
            select: { id: true, displayName: true },
          },
        },
      },
      humanReviewer: {
        select: { id: true, displayName: true },
      },
      sportsDbPlayer: {
        select: {
          id: true,
          fullName: true,
          sport: true,
          league: true,
          headshotUrl: true,
          team: {
            select: {
              id: true,
              name: true,
              logoUrl: true,
            },
          },
        },
      },
    },
  });

  if (!card) {
    return null;
  }

  const gradingRaw = (card.aiGradingJson as Record<string, unknown> | null) ?? null;
  const gradingRecord = Array.isArray((gradingRaw as any)?.records)
    ? (gradingRaw as any).records[0]
    : null;

  const classificationPayload = parseClassificationPayload(card.classificationJson);
  const classificationAttributes = classificationPayload?.attributes ?? null;
  const normalizedClassification = classificationPayload?.normalized ?? null;

  const aiGrade = {
    final: card.aiGradeFinal ?? null,
    label: card.aiGradeLabel ?? null,
    psaEquivalent: card.aiGradePsaEquivalent ?? null,
    rangeLow: card.aiGradeRangeLow ?? null,
    rangeHigh: card.aiGradeRangeHigh ?? null,
    generatedAt: card.aiGradeGeneratedAt ? card.aiGradeGeneratedAt.toISOString() : null,
    visualizationUrl:
      typeof gradingRecord?._full_url_card === "string" ? gradingRecord._full_url_card : null,
    exactVisualizationUrl:
      typeof gradingRecord?._exact_url_card === "string" ? gradingRecord._exact_url_card : null,
  };

  const item = await prisma.item.findFirst({
    where: { number: card.id },
    select: {
      id: true,
      cardQrCodeId: true,
      packLabels: {
        take: 1,
        orderBy: { createdAt: "desc" },
        include: {
          cardQrCode: { select: { id: true, code: true, serial: true, payloadUrl: true } },
          packQrCode: { select: { id: true, code: true, serial: true, payloadUrl: true } },
        },
      },
    },
  });

  const labelRecord = item?.packLabels?.[0] ?? null;

  return {
    id: card.id,
    batchId: card.batchId,
    status: card.status,
    fileName: card.fileName,
    fileSize: card.fileSize,
    imageUrl: card.imageUrl,
    thumbnailUrl: card.thumbnailUrl,
    mimeType: card.mimeType,
    ocrText: card.ocrText,
    classification: classificationAttributes,
    classificationNormalized: normalizedClassification,
    customTitle: card.customTitle ?? null,
    customDetails: card.customDetails ?? null,
    valuationMinor: card.valuationMinor ?? null,
    valuationCurrency: card.valuationCurrency ?? null,
    valuationSource: card.valuationSource ?? null,
    marketplaceUrl: card.marketplaceUrl ?? null,
    ebaySoldUrl: card.ebaySoldUrl ?? null,
    ebaySoldUrlVariant: card.ebaySoldUrlVariant ?? null,
    ebaySoldUrlHighGrade: card.ebaySoldUrlHighGrade ?? null,
    ebaySoldUrlPlayerComp: card.ebaySoldUrlPlayerComp ?? null,
    ebaySoldUrlAiGrade: card.ebaySoldUrlAiGrade ?? null,
    assignedDefinitionId: card.assignedDefinitionId,
    assignedAt: card.assignedAt ? card.assignedAt.toISOString() : null,
    reviewStage: card.reviewStage ?? null,
    reviewStageUpdatedAt: card.reviewStageUpdatedAt ? card.reviewStageUpdatedAt.toISOString() : null,
    notes: card.notes.map((note) => ({
      id: note.id,
      authorId: note.authorId,
      authorName: note.author?.displayName ?? null,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    })),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    humanReviewedAt: card.humanReviewedAt ? card.humanReviewedAt.toISOString() : null,
    humanReviewerName: card.humanReviewer?.displayName ?? card.humanReviewer?.id ?? null,
    sportsDb: {
      playerId: card.sportsDbPlayerId ?? null,
      matchConfidence: card.sportsDbMatchConfidence ?? 0,
      playerName: card.resolvedPlayerName ?? card.sportsDbPlayer?.fullName ?? null,
      teamName: card.resolvedTeamName ?? card.sportsDbPlayer?.team?.name ?? null,
      teamLogoUrl: card.sportsDbPlayer?.team?.logoUrl ?? null,
      sport: card.sportsDbPlayer?.sport ?? null,
      league: card.sportsDbPlayer?.league ?? null,
      snapshot: (card.playerStatsSnapshot as Record<string, unknown> | null) ?? null,
    },
    aiGrade:
      card.aiGradeFinal == null && card.aiGradeLabel == null && card.aiGradePsaEquivalent == null
        ? null
        : aiGrade,
    classificationSources: (card.classificationSourcesJson as Record<string, unknown> | null) ?? null,
    label: labelRecord
      ? {
          id: labelRecord.id,
          pairId: labelRecord.pairId,
          status: labelRecord.status,
          card: {
            id: labelRecord.cardQrCode.id,
            code: labelRecord.cardQrCode.code,
            serial: labelRecord.cardQrCode.serial,
            payloadUrl: labelRecord.cardQrCode.payloadUrl,
          },
          pack: {
            id: labelRecord.packQrCode.id,
            code: labelRecord.packQrCode.code,
            serial: labelRecord.packQrCode.serial,
            payloadUrl: labelRecord.packQrCode.payloadUrl,
          },
        }
      : null,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CardResponse | { message: string }>
) {
  try {
    const admin = await requireAdminSession(req);
    const { cardId } = req.query;

    if (typeof cardId !== "string" || !cardId.trim()) {
      return res.status(400).json({ message: "cardId is required" });
    }

    if (req.method === "GET") {
      const card = await fetchCard(cardId, admin.user.id);
      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }
      return res.status(200).json(card);
    }

    if (req.method === "PATCH") {
      const body = (req.body ?? {}) as CardUpdatePayload;
      const card = await prisma.cardAsset.findFirst({
        where: { id: cardId, batch: { uploadedById: admin.user.id } },
        select: {
          id: true,
          ocrText: true,
          humanReviewedAt: true,
          humanReviewedById: true,
          classificationJson: true,
          classificationSourcesJson: true,
          aiGradePsaEquivalent: true,
          aiGradingJson: true,
          aiGradeFinal: true,
          aiGradeLabel: true,
          aiGradeRangeLow: true,
          aiGradeRangeHigh: true,
          aiGradeGeneratedAt: true,
          reviewStage: true,
        },
      });

      if (!card) {
        return res.status(404).json({ message: "Card not found" });
      }

      const updateData: Prisma.CardAssetUpdateInput = {};
      const updateDataAny = updateData as Record<string, unknown>;
      let touched = false;

      if (body.classificationUpdates) {
        const existingPayload = parseClassificationPayload(card.classificationJson);
        let attributes = cloneCardAttributes(existingPayload?.attributes ?? defaultCardAttributes);
        let normalized = existingPayload?.normalized ?? null;
        let classificationTouched = false;

        if (body.classificationUpdates.attributes) {
          attributes = applyAttributeUpdates(attributes, body.classificationUpdates.attributes);
          classificationTouched = true;
        }

        if (Object.prototype.hasOwnProperty.call(body.classificationUpdates, "normalized")) {
          normalized = applyNormalizedUpdates(normalized, body.classificationUpdates.normalized ?? null);
          classificationTouched = true;
        }

        if (classificationTouched) {
          const payload = createClassificationPayloadFromAttributes(attributes, normalized ?? null);
          updateDataAny.classificationJson = JSON.parse(JSON.stringify(payload));
          updateDataAny.resolvedPlayerName = attributes.playerName;
          updateDataAny.resolvedTeamName = attributes.teamName;
          touched = true;
        }
      }

      if (Object.prototype.hasOwnProperty.call(body, "ocrText")) {
        updateData.ocrText = body.ocrText ? body.ocrText.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "customTitle")) {
        updateData.customTitle = body.customTitle ? body.customTitle.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "customDetails")) {
        updateData.customDetails = body.customDetails ? body.customDetails.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "reviewStage")) {
        updateDataAny.reviewStage = body.reviewStage ?? null;
        updateDataAny.reviewStageUpdatedAt = body.reviewStage ? new Date() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "valuationMinor")) {
        updateData.valuationMinor = body.valuationMinor === null ? null : body.valuationMinor ?? null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "valuationCurrency")) {
        updateData.valuationCurrency = body.valuationCurrency ? body.valuationCurrency.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "valuationSource")) {
        updateData.valuationSource = body.valuationSource ? body.valuationSource.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "marketplaceUrl")) {
        updateData.marketplaceUrl = body.marketplaceUrl ? body.marketplaceUrl.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "ebaySoldUrl")) {
        updateDataAny.ebaySoldUrl = body.ebaySoldUrl ? body.ebaySoldUrl.trim() : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "ebaySoldUrlVariant")) {
        updateDataAny.ebaySoldUrlVariant = body.ebaySoldUrlVariant
          ? body.ebaySoldUrlVariant.trim()
          : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "ebaySoldUrlHighGrade")) {
        updateDataAny.ebaySoldUrlHighGrade = body.ebaySoldUrlHighGrade
          ? body.ebaySoldUrlHighGrade.trim()
          : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "ebaySoldUrlPlayerComp")) {
        updateDataAny.ebaySoldUrlPlayerComp = body.ebaySoldUrlPlayerComp
          ? body.ebaySoldUrlPlayerComp.trim()
          : null;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "ebaySoldUrlAiGrade")) {
        updateDataAny.ebaySoldUrlAiGrade = body.ebaySoldUrlAiGrade
          ? body.ebaySoldUrlAiGrade.trim()
          : null;
        touched = true;
      }

      let gradeTouched = false;

      if (Object.prototype.hasOwnProperty.call(body, "aiGradeFinal")) {
        updateDataAny.aiGradeFinal = readNumberInput(body.aiGradeFinal);
        gradeTouched = true;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "aiGradeLabel")) {
        updateDataAny.aiGradeLabel = sanitizeStringInput(body.aiGradeLabel);
        gradeTouched = true;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "aiGradePsaEquivalent")) {
        updateDataAny.aiGradePsaEquivalent = readIntegerInput(body.aiGradePsaEquivalent);
        gradeTouched = true;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "aiGradeRangeLow")) {
        updateDataAny.aiGradeRangeLow = readIntegerInput(body.aiGradeRangeLow);
        gradeTouched = true;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "aiGradeRangeHigh")) {
        updateDataAny.aiGradeRangeHigh = readIntegerInput(body.aiGradeRangeHigh);
        gradeTouched = true;
        touched = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, "humanReviewed")) {
        if (body.humanReviewed) {
          if (!card.humanReviewedAt) {
            updateData.humanReviewedAt = new Date();
            updateData.humanReviewer = { connect: { id: admin.user.id } };
          }
        } else {
          updateData.humanReviewedAt = null;
          updateData.humanReviewer = { disconnect: true };
        }
        touched = true;
      }

      if (gradeTouched) {
        const nextFinal = Object.prototype.hasOwnProperty.call(updateDataAny, "aiGradeFinal")
          ? (updateDataAny.aiGradeFinal as number | null)
          : (card as any).aiGradeFinal ?? null;
        const nextLabel = Object.prototype.hasOwnProperty.call(updateDataAny, "aiGradeLabel")
          ? (updateDataAny.aiGradeLabel as string | null)
          : (card as any).aiGradeLabel ?? null;
        const nextPsa = Object.prototype.hasOwnProperty.call(updateDataAny, "aiGradePsaEquivalent")
          ? (updateDataAny.aiGradePsaEquivalent as number | null)
          : card.aiGradePsaEquivalent ?? null;
        const nextRangeLow = Object.prototype.hasOwnProperty.call(updateDataAny, "aiGradeRangeLow")
          ? (updateDataAny.aiGradeRangeLow as number | null)
          : (card as any).aiGradeRangeLow ?? null;
        const nextRangeHigh = Object.prototype.hasOwnProperty.call(updateDataAny, "aiGradeRangeHigh")
          ? (updateDataAny.aiGradeRangeHigh as number | null)
          : (card as any).aiGradeRangeHigh ?? null;

        if (
          nextFinal == null &&
          nextLabel == null &&
          nextPsa == null &&
          nextRangeLow == null &&
          nextRangeHigh == null
        ) {
          updateDataAny.aiGradeGeneratedAt = null;
        } else {
          updateDataAny.aiGradeGeneratedAt = new Date();
        }
        updateDataAny.aiGradingJson = null;
      }

      if (body.generateEbaySoldUrl) {
        const sourceText = typeof body.ocrText === "string" ? body.ocrText : card.ocrText;
        const generated = buildEbaySoldUrlFromText(sourceText);
        updateDataAny.ebaySoldUrl = generated ?? null;
        touched = true;
      }

      if (!touched) {
        return res.status(400).json({ message: "No fields provided" });
      }

      await prisma.cardAsset.update({
        where: { id: card.id },
        data: updateData,
      });

      if (
        Object.prototype.hasOwnProperty.call(body, "reviewStage") &&
        body.reviewStage === "INVENTORY_READY_FOR_SALE" &&
        card.reviewStage !== "INVENTORY_READY_FOR_SALE"
      ) {
        await ensureInventoryReadyArtifacts(card.id, admin.user.id);
      }

      const updated = await fetchCard(cardId, admin.user.id);
      if (!updated) {
        return res.status(500).json({ message: "Card updated but could not be retrieved" });
      }

      return res.status(200).json(updated);
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const result = toErrorResponse(error);
    return res.status(result.status).json({ message: result.message });
  }
}
