import { NextApiRequest, NextApiResponse } from "next";
import { CardPhotoKind, CardReviewStage, enqueueBytebotLiteJob, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";
import { readTaxonomyV2Flags } from "../../../../lib/server/taxonomyV2Flags";
import { resolveScopedParallelToken, resolveTaxonomyProgramAndVariation } from "../../../../lib/server/taxonomyV2Core";

const DEFAULT_KINGSREVIEW_SOURCES = ["ebay_sold"] as const;
const SUPPORTED_KINGSREVIEW_SOURCES = new Set<string>(DEFAULT_KINGSREVIEW_SOURCES);

const normalizeWhitespace = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const normalizeQueryLabel = (value: unknown): string =>
  typeof value === "string"
    ? value
        .replace(/_/g, " ")
        .replace(/\s*([/-])\s*/g, "$1")
        .replace(/\s+/g, " ")
        .trim()
    : "";

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
  let next = normalizeQueryLabel(rawSetName);
  if (!next) {
    return "";
  }
  next = stripLeadingSeasonToken(next);
  const normalizedManufacturer = normalizeQueryLabel(manufacturer);
  if (normalizedManufacturer) {
    next = next.replace(new RegExp(`^${escapeRegex(normalizedManufacturer)}\\b\\s*`, "i"), "").trim();
  }
  if (year) {
    next = next.replace(new RegExp(`^${escapeRegex(year)}\\b\\s*`, "i"), "").trim();
  }
  return next;
};

const normalizeDescriptor = (value: string): string => {
  const cleaned = normalizeQueryLabel(value);
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

const hasDescriptorMatch = (values: string[], pattern: RegExp): boolean =>
  values.some((value) => pattern.test(normalizeQueryLabel(value)));

const buildDeterministicCompQuery = (params: {
  year: string;
  manufacturerRaw: string;
  setNameRaw: string;
  playerName: string;
  cardNumber: string;
  numbered: string;
  descriptorCandidates: string[];
  textPool: string;
  rookieHint?: boolean;
  autographHint?: boolean;
  memorabiliaHint?: boolean;
}) => {
  const year = normalizeWhitespace(params.year);
  const manufacturerRaw = normalizeQueryLabel(params.manufacturerRaw);
  const manufacturer = manufacturerRaw ? toTitleCase(manufacturerRaw) : "";
  const setName = normalizeSetForQuery(params.setNameRaw, year, manufacturerRaw);
  const playerName = normalizeWhitespace(params.playerName);
  const cardNumber = normalizeWhitespace(params.cardNumber);
  const numbered = normalizeWhitespace(params.numbered);
  const descriptorCandidates = params.descriptorCandidates
    .map((entry) => normalizeQueryLabel(entry))
    .filter(Boolean);
  const setIdentityKey = normalizeTokenKey(setName);
  const fullSetIdentityKey = normalizeTokenKey([year, manufacturer, setName].filter(Boolean).join(" "));
  const normalizedDescriptors = descriptorCandidates.map((entry) => normalizeDescriptor(entry)).filter(Boolean);
  const nonSpecialDescriptor =
    normalizedDescriptors.find((entry) => {
      const key = normalizeTokenKey(entry);
      const descriptorSetKey = normalizeTokenKey(normalizeSetForQuery(entry, year, manufacturerRaw));
      const descriptorFullKey = normalizeTokenKey(normalizeQueryLabel(entry));
      if (
        (setIdentityKey && descriptorSetKey === setIdentityKey) ||
        (fullSetIdentityKey && descriptorFullKey === fullSetIdentityKey)
      ) {
        return false;
      }
      return key !== normalizeTokenKey("AUTOGRAPH") && key !== normalizeTokenKey("PATCH");
    }) ?? null;

  const rookieFlag =
    /\b(rookie|rc)\b/i.test(params.textPool) ||
    Boolean(params.rookieHint);
  const gradeMatch = params.textPool.match(/\b(PSA|BGS|SGC|CGC)\s*\d{1,2}\b/i);
  const grade = gradeMatch ? gradeMatch[0].toUpperCase().replace(/\s+/g, " ") : "";
  const memorabiliaFlag =
    /\b(patch|relic|rpa)\b/i.test(params.textPool) ||
    hasDescriptorMatch(descriptorCandidates, /\b(patch|relic|rpa|memorabilia|jersey)\b/i) ||
    Boolean(params.memorabiliaHint);
  const autographFlag =
    /\b(auto|autograph)\b/i.test(params.textPool) ||
    hasDescriptorMatch(descriptorCandidates, /\b(auto|autograph)\b/i) ||
    Boolean(params.autographHint);

  const tokens: string[] = [];
  pushUniqueToken(tokens, year);
  pushUniqueToken(tokens, manufacturer);
  pushUniqueToken(tokens, setName);
  if (autographFlag) {
    pushUniqueToken(tokens, "AUTOGRAPH");
  }
  pushUniqueToken(tokens, playerName);
  pushUniqueToken(tokens, cardNumber);
  pushUniqueToken(tokens, numbered);
  if (nonSpecialDescriptor) {
    pushUniqueToken(tokens, nonSpecialDescriptor);
  }
  if (rookieFlag && !nonSpecialDescriptor) {
    pushUniqueToken(tokens, "Rookie");
  }
  pushUniqueToken(tokens, grade);
  if (memorabiliaFlag) {
    pushUniqueToken(tokens, "Patch");
  }

  return tokens.join(" ").replace(/\s+/g, " ").trim();
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

const queryHasSignal = (value: string): boolean => {
  const query = normalizeWhitespace(value);
  if (!query) {
    return false;
  }
  const tokenCount = query.split(/\s+/).filter(Boolean).length;
  return tokenCount >= 3 && /[a-z]/i.test(query);
};

const fallbackQueryFromText = (value: string | null): string => {
  const query = normalizeQueryLabel(value ?? "");
  if (!query) {
    return "";
  }
  return query.split(/\s+/).slice(0, 18).join(" ").trim();
};

const normalizeRequestedSources = (value: unknown): string[] =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
        )
      )
    : [];

const resolveKingsreviewSources = (value: unknown): string[] => {
  const requestedSources = normalizeRequestedSources(value);
  const supportedSources = requestedSources.filter((source) => SUPPORTED_KINGSREVIEW_SOURCES.has(source));
  const unsupportedSources = requestedSources.filter((source) => !SUPPORTED_KINGSREVIEW_SOURCES.has(source));

  if (unsupportedSources.length > 0) {
    console.warn("[kingsreview/enqueue] filtered unsupported sources", {
      requestedSources,
      unsupportedSources,
    });
  }

  return supportedSources.length > 0 ? supportedSources : [...DEFAULT_KINGSREVIEW_SOURCES];
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
  const textPool = `${card.customTitle ?? ""} ${card.ocrText ?? ""}`;
  return buildDeterministicCompQuery({
    year,
    manufacturerRaw: normalizeQueryLabel(attributes?.brand ?? normalized?.company),
    setNameRaw: normalizeQueryLabel(normalized?.setName),
    playerName: normalizeQueryLabel(card.resolvedPlayerName ?? attributes?.playerName),
    cardNumber: normalizeWhitespace(normalized?.cardNumber ?? attributes?.cardNumber),
    numbered: normalizeWhitespace(attributes?.numbered),
    descriptorCandidates: [
      normalizeQueryLabel(normalized?.setCode ?? attributes?.setName ?? ""),
      normalizeQueryLabel(
        normalized?.parallelName ??
          attributes?.parallel ??
          (Array.isArray(attributes?.variantKeywords) ? attributes.variantKeywords[0] : "") ??
          card.variantId ??
          ""
      ),
    ],
    textPool,
    rookieHint: Boolean((attributes?.rookie as boolean | undefined) ?? false),
    autographHint: Boolean((attributes?.autograph as boolean | undefined) ?? false),
    memorabiliaHint: Boolean((attributes?.memorabilia as boolean | undefined) ?? false),
  });
};

const buildCompSearchQueryV2 = async (card: {
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
  const manufacturerRaw = normalizeQueryLabel(attributes?.brand ?? normalized?.company);
  const setNameRaw = normalizeQueryLabel(normalized?.setName ?? attributes?.setName);
  const normalizedSetName = normalizeSetForQuery(setNameRaw, year, manufacturerRaw);
  const cardNumber = normalizeWhitespace(normalized?.cardNumber ?? attributes?.cardNumber);
  const playerName = normalizeQueryLabel(card.resolvedPlayerName ?? attributes?.playerName);
  const numbered = normalizeWhitespace(attributes?.numbered);

  const rawProgram = normalizeQueryLabel(normalized?.setCode ?? attributes?.setCode ?? attributes?.insertSet);
  const rawVariation = normalizeQueryLabel(normalized?.variationName ?? attributes?.variation);
  const rawParallel = normalizeQueryLabel(
    normalized?.parallelName ??
      attributes?.parallel ??
      (Array.isArray(attributes?.variantKeywords) ? attributes.variantKeywords[0] : "") ??
      card.variantId ??
      ""
  );

  const setCandidates = Array.from(
    new Set(
      [
        normalizeQueryLabel(setNameRaw),
        [year, manufacturerRaw, normalizedSetName].filter(Boolean).join(" ").trim(),
        [year, manufacturerRaw, setNameRaw].filter(Boolean).join(" ").trim(),
      ].filter(Boolean)
    )
  );

  let taxonomyResolution: Awaited<ReturnType<typeof resolveTaxonomyProgramAndVariation>> | null = null;
  for (const candidateSetId of setCandidates) {
    const nextResolution = await resolveTaxonomyProgramAndVariation({
      setId: candidateSetId,
      program: rawProgram || null,
      variation: rawVariation || null,
    });
    if (nextResolution.hasTaxonomy) {
      taxonomyResolution = nextResolution;
      break;
    }
  }

  let scopedParallelLabel: string | null = null;
  if (taxonomyResolution?.hasTaxonomy && taxonomyResolution.setId && rawParallel) {
    const scopedParallel = await resolveScopedParallelToken({
      setId: taxonomyResolution.setId,
      programId: taxonomyResolution.programId,
      variationId: taxonomyResolution.variationId,
      parallel: rawParallel,
    });
    if (scopedParallel?.inScope) {
      scopedParallelLabel = normalizeQueryLabel(scopedParallel.parallelLabel);
    }
  }

  const textPool = `${card.customTitle ?? ""} ${card.ocrText ?? ""}`;
  return buildDeterministicCompQuery({
    year,
    manufacturerRaw,
    setNameRaw: normalizedSetName || setNameRaw,
    playerName,
    cardNumber,
    numbered,
    descriptorCandidates: [
      normalizeQueryLabel(taxonomyResolution?.programLabel ?? rawProgram),
      normalizeQueryLabel(taxonomyResolution?.variationLabel ?? rawVariation),
      normalizeQueryLabel(scopedParallelLabel ?? rawParallel),
    ],
    textPool,
    rookieHint: Boolean((attributes?.rookie as boolean | undefined) ?? false),
    autographHint: Boolean((attributes?.autograph as boolean | undefined) ?? false),
    memorabiliaHint: Boolean((attributes?.memorabilia as boolean | undefined) ?? false),
  });
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const admin = await requireAdminSession(req);

    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const body = req.body ?? {};
    const rawQuery = typeof body.query === "string" ? body.query.trim() : "";
    const useManual = Boolean(body.useManual);
    const cardAssetId = typeof body.cardAssetId === "string" ? body.cardAssetId : undefined;
    const sources = resolveKingsreviewSources(body.sources);
    const categoryType = typeof body.categoryType === "string" ? body.categoryType : null;

    let query = rawQuery;
    if (cardAssetId && !useManual) {
      const flags = readTaxonomyV2Flags();
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
        const useTaxonomyQuery = flags.kingsreviewQuery || !flags.allowLegacyFallback;
        const taxonomyGenerated = useTaxonomyQuery ? await buildCompSearchQueryV2(card) : "";
        const legacyGenerated = buildCompSearchQuery(card);
        const candidateQueries = useTaxonomyQuery
          ? [legacyGenerated, taxonomyGenerated, rawQuery]
          : [legacyGenerated, rawQuery, taxonomyGenerated];
        const selected = candidateQueries.find((candidate) => queryHasSignal(candidate));
        if (selected) {
          query = selected;
        } else {
          query =
            fallbackQueryFromText(card.customTitle) ||
            fallbackQueryFromText(card.ocrText) ||
            normalizeWhitespace(rawQuery);
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
      const hasTilt = card.photos.some((photo) => photo.kind === CardPhotoKind.TILT);
      if (!hasTilt) {
        return res.status(400).json({ message: "TILT photo is required before sending to KingsReview" });
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

export default withAdminCors(handler);
