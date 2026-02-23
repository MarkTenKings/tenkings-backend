import { NextApiRequest, NextApiResponse } from "next";
import { CardPhotoKind, CardReviewStage, enqueueBytebotLiteJob, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const normalizeWhitespace = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const normalizeTokenKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toTitleCase = (value: string): string =>
  value
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .trim();

const stripLeadingSeasonToken = (value: string): string =>
  value.replace(/^\s*(?:19|20)\d{2}(?:-\d{2,4})?\s+/, "").trim();

const normalizeSetForQuery = (rawSetName: string, year: string, manufacturer: string): string => {
  let next = normalizeWhitespace(rawSetName);
  if (!next) {
    return "";
  }
  next = stripLeadingSeasonToken(next);
  const normalizedManufacturer = normalizeWhitespace(manufacturer);
  if (normalizedManufacturer) {
    next = next.replace(new RegExp(`^${escapeRegex(normalizedManufacturer)}\\b\\s*`, "i"), "").trim();
  }
  if (year) {
    next = next.replace(new RegExp(`^${escapeRegex(year)}\\b\\s*`, "i"), "").trim();
  }
  return next;
};

const normalizeDescriptor = (value: string): string => {
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) {
    return "";
  }
  const upper = cleaned.toUpperCase();
  if (
    /\bAUTOGRAPH(?:S)?\b/.test(upper) ||
    /\bAUTO(?:GRAPH)?\b/.test(upper)
  ) {
    return "AUTOGRAPH";
  }
  if (upper.endsWith(" CARDS")) {
    return toTitleCase(cleaned.replace(/\s+cards?$/i, ""));
  }
  return cleaned;
};

const pushUniqueToken = (target: string[], value: string) => {
  const token = normalizeWhitespace(value);
  if (!token) {
    return;
  }
  const key = normalizeTokenKey(token);
  if (!key) {
    return;
  }
  const exists = target.some((entry) => normalizeTokenKey(entry) === key);
  if (!exists) {
    target.push(token);
  }
};

const buildCompSearchQuery = (card: {
  customTitle: string | null;
  ocrText: string | null;
  resolvedPlayerName: string | null;
  classificationJson: unknown;
  variantId: string | null;
}) => {
  const normalized =
    typeof card.classificationJson === "object" && card.classificationJson
      ? ((card.classificationJson as any).normalized ?? null)
      : null;
  const attributes =
    typeof card.classificationJson === "object" && card.classificationJson
      ? ((card.classificationJson as any).attributes ?? null)
      : null;

  const year = normalizeWhitespace(normalized?.year ?? attributes?.year);
  const manufacturerRaw = normalizeWhitespace(attributes?.brand ?? normalized?.company);
  const manufacturer = manufacturerRaw ? toTitleCase(manufacturerRaw) : "";
  const setNameRaw = normalizeWhitespace(normalized?.setName);
  const setName = normalizeSetForQuery(setNameRaw, year, manufacturerRaw);
  const playerName = normalizeWhitespace(card.resolvedPlayerName ?? attributes?.playerName);
  const cardNumber = normalizeWhitespace(normalized?.cardNumber ?? attributes?.cardNumber);
  const numbered = normalizeWhitespace(attributes?.numbered);

  const setCode = normalizeDescriptor(normalized?.setCode ?? attributes?.setName ?? "");
  const parallel = normalizeDescriptor(
    normalized?.parallelName ??
      attributes?.parallel ??
      (Array.isArray(attributes?.variantKeywords) ? attributes.variantKeywords[0] : "") ??
      card.variantId ??
      ""
  );

  const descriptorCandidates = [setCode, parallel]
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean);

  const autoDescriptor =
    descriptorCandidates.find((entry) => normalizeTokenKey(entry) === normalizeTokenKey("AUTOGRAPH")) ?? null;
  const nonAutoDescriptor =
    descriptorCandidates.find((entry) => normalizeTokenKey(entry) !== normalizeTokenKey("AUTOGRAPH")) ?? null;

  const textPool = `${card.customTitle ?? ""} ${card.ocrText ?? ""}`;
  const rookieFlag =
    /\b(rookie|rc)\b/i.test(textPool) ||
    Boolean((attributes?.rookie as boolean | undefined) ?? false);

  const gradeMatch = textPool.match(/\b(PSA|BGS|SGC|CGC)\s*\d{1,2}\b/i);
  const grade = gradeMatch ? gradeMatch[0].toUpperCase().replace(/\s+/g, " ") : "";
  const memorabiliaFlag =
    /\b(patch|relic|rpa)\b/i.test(textPool) ||
    Boolean((attributes?.memorabilia as boolean | undefined) ?? false);
  const autographFlag =
    /\b(auto|autograph)\b/i.test(textPool) ||
    Boolean((attributes?.autograph as boolean | undefined) ?? false);

  const tokens: string[] = [];
  pushUniqueToken(tokens, year);
  pushUniqueToken(tokens, manufacturer);
  pushUniqueToken(tokens, setName);
  if (autoDescriptor || autographFlag) {
    pushUniqueToken(tokens, "AUTOGRAPH");
  }
  pushUniqueToken(tokens, playerName);
  pushUniqueToken(tokens, cardNumber);
  pushUniqueToken(tokens, numbered);
  if (nonAutoDescriptor) {
    pushUniqueToken(tokens, nonAutoDescriptor);
  }
  if (rookieFlag && !nonAutoDescriptor) {
    pushUniqueToken(tokens, "Rookie");
  }
  pushUniqueToken(tokens, grade);
  if (memorabiliaFlag) {
    pushUniqueToken(tokens, "Patch");
  }

  return tokens.join(" ").replace(/\s+/g, " ").trim();
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const admin = await requireAdminSession(req);

    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const body = req.body ?? {};
    const rawQuery = typeof body.query === "string" ? body.query.trim() : "";
    const useManual = Boolean(body.useManual);
    const cardAssetId = typeof body.cardAssetId === "string" ? body.cardAssetId : undefined;
    const sources = ["ebay_sold"];
    const categoryType = typeof body.categoryType === "string" ? body.categoryType : null;

    let query = rawQuery;
    if (cardAssetId && !useManual) {
      const card = await prisma.cardAsset.findFirst({
        where: { id: cardAssetId, batch: { uploadedById: admin.user.id } },
        select: {
          customTitle: true,
          ocrText: true,
          resolvedPlayerName: true,
          resolvedTeamName: true,
          classificationJson: true,
          classificationSourcesJson: true,
          variantId: true,
        },
      });
      if (card) {
        const generated = buildCompSearchQuery(card);
        if (generated) {
          query = generated;
        }
      }
    }

    if (!query) {
      return res.status(400).json({ message: "query is required" });
    }

    if (cardAssetId) {
      const card = await prisma.cardAsset.findFirst({
        where: { id: cardAssetId, batch: { uploadedById: admin.user.id } },
        include: { photos: true, batch: true },
      });
      if (!card || !card.batch) {
        return res.status(404).json({ message: "Card asset not found" });
      }
      const hasBack = card.photos.some((photo) => photo.kind === CardPhotoKind.BACK);
      if (!hasBack) {
        return res.status(400).json({ message: "Back photo is required before sending to KingsReview AI." });
      }
      await prisma.cardAsset.update({
        where: { id: card.id },
        data: {
          reviewStage: CardReviewStage.BYTEBOT_RUNNING,
          reviewStageUpdatedAt: new Date(),
        },
      });
    }

    const job = await enqueueBytebotLiteJob({
      searchQuery: query,
      sources,
      maxComps: 20,
      cardAssetId,
      payload: {
        query,
        sources,
        categoryType,
      },
    });

    return res.status(200).json({ job });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
