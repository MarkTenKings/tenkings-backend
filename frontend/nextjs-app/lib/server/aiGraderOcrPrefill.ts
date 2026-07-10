import { extractCardAttributes } from "@tenkings/shared";
import type { OcrResponse } from "./googleVisionOcr";
import { runGoogleVisionOcr } from "./googleVisionOcr";
import type { IdentifySetResult } from "./cardSetIdentification";
import { identifySetByCardIdentity } from "./cardSetIdentification";
import type { LookupSetResult } from "./setLookup";
import { lookupSetByCardIdentity } from "./setLookup";

export type AiGraderOcrPrefillSide = "front" | "back";

export type AiGraderOcrPrefillSourceImage = {
  side: AiGraderOcrPrefillSide;
  url: string;
};

export type AiGraderOcrPrefillFieldValue = string | boolean | null;

export type AiGraderOcrPrefillField<T extends AiGraderOcrPrefillFieldValue = AiGraderOcrPrefillFieldValue> = {
  value: T;
  confidence: number;
  reviewRequired: boolean;
  sources: string[];
};

export type AiGraderOcrPrefillResult = {
  reportId: string;
  status: "prefill_ready";
  humanConfirmationRequired: true;
  inventoryMutationPerformed: false;
  publishMutationPerformed: false;
  sourceSides: AiGraderOcrPrefillSide[];
  fields: {
    category: AiGraderOcrPrefillField<string | null>;
    playerName: AiGraderOcrPrefillField<string | null>;
    cardName: AiGraderOcrPrefillField<string | null>;
    year: AiGraderOcrPrefillField<string | null>;
    manufacturer: AiGraderOcrPrefillField<string | null>;
    productSet: AiGraderOcrPrefillField<string | null>;
    cardNumber: AiGraderOcrPrefillField<string | null>;
    parallel: AiGraderOcrPrefillField<string | null>;
    insert: AiGraderOcrPrefillField<string | null>;
    numbered: AiGraderOcrPrefillField<string | null>;
    auto: AiGraderOcrPrefillField<boolean | null>;
    mem: AiGraderOcrPrefillField<boolean | null>;
  };
  reviewFieldNames: string[];
  provenance: {
    ocrEngine: "google_vision_document_text_detection";
    attributeExtractor: "@tenkings/shared/extractCardAttributes";
    setLookupUsed: boolean;
    setIdentificationUsed: boolean;
  };
  warnings: string[];
};

export type AiGraderOcrPrefillRuntimeDependencies = {
  runOcr?: typeof runGoogleVisionOcr;
  identifySet?: typeof identifySetByCardIdentity;
  lookupSet?: typeof lookupSetByCardIdentity;
};

const REVIEW_CONFIDENCE_THRESHOLD = 0.8;

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundedConfidence(value: number) {
  return Number(clampConfidence(value).toFixed(3));
}

function safeText(value: string | null | undefined, maxLength = 160) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  if (!normalized) return null;
  if (/^data:/i.test(normalized) || /https?:\/\//i.test(normalized) || /^[a-z]:\\/i.test(normalized)) return null;
  return normalized;
}

function field<T extends AiGraderOcrPrefillFieldValue>(
  value: T,
  confidence: number,
  sources: Array<string | null | undefined>
): AiGraderOcrPrefillField<T> {
  const normalizedConfidence = value == null ? 0 : roundedConfidence(confidence);
  return {
    value,
    confidence: normalizedConfidence,
    reviewRequired: value == null || normalizedConfidence < REVIEW_CONFIDENCE_THRESHOLD,
    sources: Array.from(new Set(sources.filter((source): source is string => Boolean(source)))),
  };
}

function averageOcrConfidence(response: OcrResponse) {
  const confidences = response.results
    .map((result) => clampConfidence(result.confidence))
    .filter((value) => value > 0);
  if (!confidences.length) return 0;
  return confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
}

function textBySide(response: OcrResponse) {
  const result = new Map<AiGraderOcrPrefillSide, string>();
  for (const entry of response.results) {
    if (entry.id !== "front" && entry.id !== "back") continue;
    result.set(entry.id, String(entry.text ?? ""));
  }
  return result;
}

function sourcesForValue(value: string | null, sides: Map<AiGraderOcrPrefillSide, string>) {
  if (!value) return ["ocr"];
  const normalizedValue = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sources: string[] = [];
  for (const [side, text] of sides) {
    const normalizedText = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    if (normalizedValue && normalizedText.includes(normalizedValue)) sources.push(`${side}_ocr`);
  }
  return sources.length ? sources : ["combined_ocr"];
}

function inferCategoryAndSport(text: string, hasPlayerName: boolean) {
  const normalized = text.toLowerCase();
  const tcgSignals = ["pokemon", "pokémon", "magic the gathering", "yu-gi-oh", "yugioh", "trainer", "mana"];
  const comicsSignals = ["marvel comics", "dc comics", "issue no", "issue #", "cover art"];
  const sports: Array<[string, string[]]> = [
    ["basketball", ["basketball", "nba"]],
    ["baseball", ["baseball", "mlb"]],
    ["football", ["football", "nfl"]],
    ["hockey", ["hockey", "nhl"]],
    ["soccer", ["soccer", "football club", "fc "]],
  ];
  if (tcgSignals.some((signal) => normalized.includes(signal))) {
    return { category: "tcg", sport: null, confidence: 0.9 };
  }
  if (comicsSignals.some((signal) => normalized.includes(signal))) {
    return { category: "comics", sport: null, confidence: 0.88 };
  }
  for (const [sport, signals] of sports) {
    if (signals.some((signal) => normalized.includes(signal))) {
      return { category: "sport", sport, confidence: 0.9 };
    }
  }
  return hasPlayerName
    ? { category: "sport", sport: null, confidence: 0.58 }
    : { category: null, sport: null, confidence: 0 };
}

function extractCardNumber(text: string) {
  const patterns = [
    /(?:CARD\s*(?:NO\.?|NUMBER|#)|NO\.?|#)\s*[:.-]?\s*([A-Z]{0,4}-?\d{1,5}[A-Z]?)/i,
    /\b([A-Z]{1,4}-\d{1,5}[A-Z]?)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = safeText(match?.[1] ?? "", 24)?.toUpperCase() ?? null;
    if (candidate && !candidate.includes("/")) return candidate;
  }
  return null;
}

function normalizedMatchText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parallelFromLookup(text: string, lookup: LookupSetResult | null, variantKeywords: string[]) {
  const normalizedText = normalizedMatchText(text);
  const options = lookup?.scopedParallels?.length ? lookup.scopedParallels : lookup?.parallels ?? [];
  const matches = options
    .map((option) => ({ option, key: normalizedMatchText(option.label) }))
    .filter(({ key }) => key.length >= 3 && normalizedText.includes(key))
    .sort((left, right) => right.key.length - left.key.length);
  if (matches[0]?.option.label) {
    return { value: safeText(matches[0].option.label), confidence: lookup?.match === "exact" ? 0.91 : 0.78, source: "set_variant_lookup" };
  }
  const keyword = variantKeywords
    .map((value) => safeText(value))
    .find((value) => value && !/^(AUTO|AUTOGRAPH|SIGNATURE|PATCH|NUMBERED)$/i.test(value));
  return keyword
    ? { value: keyword, confidence: 0.66, source: "shared_attribute_extractor" }
    : { value: null, confidence: 0, source: null };
}

async function resolveSetEvidence(input: {
  year: string | null;
  manufacturer: string | null;
  sport: string | null;
  playerName: string | null;
  cardNumber: string | null;
  frontText: string;
  combinedText: string;
  identifySet: typeof identifySetByCardIdentity;
  lookupSet: typeof lookupSetByCardIdentity;
}) {
  const complete = Boolean(input.year && input.manufacturer && input.sport && input.playerName && input.cardNumber);
  if (!complete) {
    return { identified: null as IdentifySetResult | null, lookup: null as LookupSetResult | null, warnings: [] as string[] };
  }
  const warnings: string[] = [];
  let identified: IdentifySetResult | null = null;
  let lookup: LookupSetResult | null = null;
  try {
    identified = await input.identifySet({
      year: input.year,
      manufacturer: input.manufacturer,
      sport: input.sport,
      playerName: input.playerName,
      cardNumber: input.cardNumber,
      frontCardText: input.frontText,
      combinedText: input.combinedText,
    });
  } catch {
    warnings.push("Existing Ten Kings set identification was unavailable; OCR fields still require review.");
  }
  try {
    lookup = await input.lookupSet({
      year: input.year!,
      manufacturer: input.manufacturer!,
      sport: input.sport!,
      playerName: input.playerName!,
      cardNumber: input.cardNumber!,
    });
  } catch {
    warnings.push("Existing Ten Kings set/variant lookup was unavailable; OCR fields still require review.");
  }
  return { identified, lookup, warnings };
}

export async function runAiGraderOcrPrefillRuntime(
  input: { reportId: string; images: AiGraderOcrPrefillSourceImage[] },
  dependencies: AiGraderOcrPrefillRuntimeDependencies = {}
): Promise<AiGraderOcrPrefillResult> {
  const runOcr = dependencies.runOcr ?? runGoogleVisionOcr;
  const identifySet = dependencies.identifySet ?? identifySetByCardIdentity;
  const lookupSet = dependencies.lookupSet ?? lookupSetByCardIdentity;
  const response = await runOcr(input.images.map((image) => ({ id: image.side, url: image.url })));
  const combinedText = String(response.combined_text ?? "").trim();
  const sideText = textBySide(response);
  const attributes = extractCardAttributes(combinedText);
  const ocrConfidence = averageOcrConfidence(response);
  const extractedPlayerName = safeText(attributes.playerName);
  const categoryEvidence = inferCategoryAndSport(combinedText, Boolean(extractedPlayerName));
  const year = safeText(attributes.year, 16);
  const manufacturer = safeText(attributes.brand);
  const extractedSet = safeText(attributes.setName);
  const extractedCardNumber = extractCardNumber(combinedText);
  const setEvidence = await resolveSetEvidence({
    year,
    manufacturer,
    sport: categoryEvidence.sport,
    playerName: extractedPlayerName,
    cardNumber: extractedCardNumber,
    frontText: sideText.get("front") ?? "",
    combinedText,
    identifySet,
    lookupSet,
  });
  const identifiedConfidence =
    setEvidence.identified?.confidence === "exact" ? 0.95 : setEvidence.identified?.confidence === "fuzzy" ? 0.82 : 0;
  const lookupConfidence = setEvidence.lookup?.match === "exact" ? 0.94 : setEvidence.lookup?.match === "multiple" ? 0.72 : 0;
  // Set lookup IDs are internal taxonomy identifiers, not operator-facing set
  // names. Use the existing card-identification label or OCR text and reserve
  // set lookup for insert/parallel enrichment.
  const productSet = safeText(setEvidence.identified?.setName) ?? extractedSet;
  const cardNumber = safeText(setEvidence.identified?.cardNumber, 24) ?? extractedCardNumber;
  const insert = safeText(setEvidence.identified?.programLabel) ?? safeText(setEvidence.lookup?.insertLabel);
  const parallel = parallelFromLookup(combinedText, setEvidence.lookup, attributes.variantKeywords);
  const identifiedPlayerName = safeText(setEvidence.identified?.playerName);
  const playerName =
    categoryEvidence.category === "tcg" || categoryEvidence.category === "comics"
      ? null
      : identifiedPlayerName ?? extractedPlayerName;
  const cardName = categoryEvidence.category === "tcg" || categoryEvidence.category === "comics" ? extractedPlayerName : null;
  const fields: AiGraderOcrPrefillResult["fields"] = {
    category: field(
      categoryEvidence.category,
      Math.min(ocrConfidence > 0 ? ocrConfidence : 0.45, categoryEvidence.confidence),
      ["ocr_category_signals"]
    ),
    playerName: field(
      playerName,
      Math.max(identifiedPlayerName ? identifiedConfidence : 0, ocrConfidence * 0.86),
      [identifiedPlayerName ? "card_set_identification" : null, ...sourcesForValue(playerName, sideText)]
    ),
    cardName: field(cardName, ocrConfidence * 0.82, sourcesForValue(cardName, sideText)),
    year: field(year, ocrConfidence * 0.92, sourcesForValue(year, sideText)),
    manufacturer: field(manufacturer, ocrConfidence * 0.86, sourcesForValue(manufacturer, sideText)),
    productSet: field(
      productSet,
      Math.max(identifiedConfidence, lookupConfidence, ocrConfidence * 0.72),
      [identifiedConfidence ? "card_set_identification" : null, lookupConfidence ? "set_lookup" : null, ...sourcesForValue(extractedSet, sideText)]
    ),
    cardNumber: field(
      cardNumber,
      Math.max(identifiedConfidence, lookupConfidence, ocrConfidence * 0.8),
      [identifiedConfidence ? "card_set_identification" : null, lookupConfidence ? "set_lookup" : null, ...sourcesForValue(extractedCardNumber, sideText)]
    ),
    parallel: field(parallel.value, parallel.confidence * (ocrConfidence > 0 ? ocrConfidence : 0.45), [parallel.source]),
    insert: field(insert, Math.max(identifiedConfidence, lookupConfidence), [identifiedConfidence ? "card_set_identification" : null, lookupConfidence ? "set_lookup" : null]),
    numbered: field(safeText(attributes.numbered, 32), ocrConfidence * 0.9, ["shared_attribute_extractor"]),
    auto: field(attributes.autograph ? true : null, attributes.autograph ? ocrConfidence * 0.9 : 0, ["shared_attribute_extractor"]),
    mem: field(attributes.memorabilia ? true : null, attributes.memorabilia ? ocrConfidence * 0.9 : 0, ["shared_attribute_extractor"]),
  };
  const reviewFieldNames = Object.entries(fields)
    .filter(([, value]) => value.reviewRequired)
    .map(([name]) => name);
  const warnings = [...setEvidence.warnings];
  if (!combinedText) warnings.push("No OCR text was detected in the normalized front/back images.");
  if (reviewFieldNames.length) warnings.push("Low-confidence or missing OCR fields require operator review.");
  return {
    reportId: input.reportId,
    status: "prefill_ready",
    humanConfirmationRequired: true,
    inventoryMutationPerformed: false,
    publishMutationPerformed: false,
    sourceSides: input.images.map((image) => image.side),
    fields,
    reviewFieldNames,
    provenance: {
      ocrEngine: "google_vision_document_text_detection",
      attributeExtractor: "@tenkings/shared/extractCardAttributes",
      setLookupUsed: Boolean(setEvidence.lookup),
      setIdentificationUsed: Boolean(setEvidence.identified),
    },
    warnings,
  };
}
