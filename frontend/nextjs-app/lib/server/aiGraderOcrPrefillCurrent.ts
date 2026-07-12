import {
  extractCardAttributes,
  normalizeCardIdentityPlayerNameBase,
  normalizeCardNumber,
} from "@tenkings/shared";
import type { IdentifySetResult } from "./cardSetIdentification";
import { identifySetByCardIdentity } from "./cardSetIdentification";
import {
  runGoogleVisionDocumentTextDetectionByUrl,
  type OcrResponse,
} from "./googleVisionOcr";
import type { LookupSetParallelOption, LookupSetResult } from "./setLookup";
import { lookupSetByCardIdentity } from "./setLookup";
import {
  runAiGraderOcrStructuredExtraction,
  type AiGraderOcrExtractionState,
  type AiGraderOcrStructuredExtraction,
  type AiGraderOcrStructuredField,
  type AiGraderOcrStructuredValue,
} from "./aiGraderOcrStructuredExtraction";

export type AiGraderOcrPrefillSide = "front" | "back";

export type AiGraderOcrPrefillSourceImage = {
  side: AiGraderOcrPrefillSide;
  url: string;
};

export type AiGraderOcrPrefillFieldValue = string | boolean | null;

export type AiGraderOcrPrefillField<T extends AiGraderOcrPrefillFieldValue = AiGraderOcrPrefillFieldValue> = {
  state: AiGraderOcrExtractionState;
  value: T;
  confidence: number;
  reviewRequired: boolean;
  evidenceRefs: string[];
};

export type AiGraderOcrPrefillFields = {
  category: AiGraderOcrPrefillField<string | null>;
  playerName: AiGraderOcrPrefillField<string | null>;
  cardName: AiGraderOcrPrefillField<string | null>;
  year: AiGraderOcrPrefillField<string | null>;
  manufacturer: AiGraderOcrPrefillField<string | null>;
  sport: AiGraderOcrPrefillField<string | null>;
  game: AiGraderOcrPrefillField<string | null>;
  productSet: AiGraderOcrPrefillField<string | null>;
  cardNumber: AiGraderOcrPrefillField<string | null>;
  insert: AiGraderOcrPrefillField<string | null>;
  parallel: AiGraderOcrPrefillField<string | null>;
  numbered: AiGraderOcrPrefillField<string | null>;
  autograph: AiGraderOcrPrefillField<boolean | null>;
  memorabilia: AiGraderOcrPrefillField<boolean | null>;
};

export type AiGraderOcrPrefillResult = {
  reportId: string;
  status: "prefill_ready";
  humanConfirmationRequired: true;
  inventoryMutationPerformed: false;
  publishMutationPerformed: false;
  sourceSides: AiGraderOcrPrefillSide[];
  fields: AiGraderOcrPrefillFields;
  reviewFieldNames: string[];
  provenance: {
    ocrEngine: "google_vision_document_text_detection_url_only";
    attributeExtractor: "@tenkings/shared/extractCardAttributes";
    structuredExtractor: "openai_responses_strict_json_schema";
    structuredExtractionModel: string;
    setLookupUsed: boolean;
    setIdentificationUsed: boolean;
  };
  warnings: string[];
};

export type AiGraderOcrPrefillRuntimeDependencies = {
  runOcr?: (images: Array<{ id: string; url: string }>) => Promise<OcrResponse>;
  runStructuredExtraction?: typeof runAiGraderOcrStructuredExtraction;
  identifySet?: typeof identifySetByCardIdentity;
  lookupSet?: typeof lookupSetByCardIdentity;
};

const REVIEW_CONFIDENCE_THRESHOLD = 0.8;

function roundedConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function outputField<T extends AiGraderOcrPrefillFieldValue>(
  field: AiGraderOcrStructuredField<T>
): AiGraderOcrPrefillField<T> {
  const confidence = roundedConfidence(field.confidence);
  return {
    state: field.state,
    value: field.state === "supported" ? field.value : null as T,
    confidence,
    reviewRequired: field.state !== "supported" || confidence < REVIEW_CONFIDENCE_THRESHOLD,
    evidenceRefs: Array.from(new Set(field.evidenceRefs)),
  };
}

function reviewedField<T extends AiGraderOcrPrefillFieldValue>(
  field: AiGraderOcrPrefillField<T>,
  input: {
    state: AiGraderOcrExtractionState;
    value: T;
    confidence?: number;
    evidenceRef: string;
  }
): AiGraderOcrPrefillField<T> {
  const confidence = roundedConfidence(input.confidence ?? field.confidence);
  return {
    state: input.state,
    value: input.state === "supported" ? input.value : null as T,
    confidence,
    reviewRequired: input.state !== "supported" || confidence < REVIEW_CONFIDENCE_THRESHOLD,
    evidenceRefs: Array.from(new Set([...field.evidenceRefs, input.evidenceRef])),
  };
}

function normalizedWords(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedAlias(value: string | null | undefined) {
  return normalizedWords(value).replace(/[^a-z0-9]+/g, "");
}

export type AiGraderCatalogOptionResolution = {
  match: "exact" | "alias" | "multiple" | "none";
  value: string | null;
};

export function resolveAiGraderCatalogOption(
  proposed: string | null | undefined,
  options: Array<{ label: string }>
): AiGraderCatalogOptionResolution {
  const words = normalizedWords(proposed);
  const alias = normalizedAlias(proposed);
  if (!words || !alias) return { match: "none", value: null };
  const exact = options.filter((option) => normalizedWords(option.label) === words);
  if (exact.length === 1) return { match: "exact", value: exact[0]!.label };
  if (exact.length > 1) return { match: "multiple", value: null };
  const aliases = options.filter((option) => normalizedAlias(option.label) === alias);
  if (aliases.length === 1) return { match: "alias", value: aliases[0]!.label };
  if (aliases.length > 1) return { match: "multiple", value: null };
  return { match: "none", value: null };
}

function canonicalStringField(
  field: AiGraderOcrPrefillField<string | null>,
  canonicalValue: string | null | undefined,
  input: {
    normalize?: (value: string | null | undefined) => string;
    evidenceRef: string;
    unresolvedState?: "unknown" | "disagreement";
  }
) {
  if (field.state !== "supported" || typeof field.value !== "string") {
    return reviewedField(field, {
      state: field.state,
      value: null,
      evidenceRef: input.evidenceRef,
    });
  }
  if (!canonicalValue) {
    return reviewedField(field, {
      state: input.unresolvedState ?? "disagreement",
      value: null,
      confidence: Math.max(field.confidence, 0.8),
      evidenceRef: input.evidenceRef,
    });
  }
  const normalize = input.normalize ?? normalizedAlias;
  if (!normalize(field.value) || normalize(field.value) !== normalize(canonicalValue)) {
    return reviewedField(field, {
      state: "disagreement",
      value: null,
      confidence: Math.max(field.confidence, 0.8),
      evidenceRef: input.evidenceRef,
    });
  }
  return reviewedField(field, {
    state: "supported",
    value: canonicalValue,
    confidence: Math.max(field.confidence, 0.9),
    evidenceRef: input.evidenceRef,
  });
}

function unsupportedCatalogField(
  field: AiGraderOcrPrefillField<string | null>,
  state: "unknown" | "disagreement",
  evidenceRef: string
) {
  return reviewedField(field, {
    state,
    value: null,
    confidence: state === "disagreement" ? Math.max(field.confidence, 0.8) : field.confidence,
    evidenceRef,
  });
}

function validateNumberedField(
  field: AiGraderOcrPrefillField<string | null>,
  parallel: LookupSetParallelOption | null
) {
  if (field.state !== "supported" || typeof field.value !== "string") return field;
  const match = field.value.replace(/\s+/g, "").match(/^(\d{1,6})\/(\d{1,6})$/);
  if (!match) return unsupportedCatalogField(field, "disagreement", "catalog.numbered.format");
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (numerator < 1 || denominator < 1 || numerator > denominator ||
      (parallel?.serialDenominator != null && parallel.serialDenominator !== denominator)) {
    return unsupportedCatalogField(field, "disagreement", "catalog.numbered.denominator");
  }
  return reviewedField(field, {
    state: "supported",
    value: `${numerator}/${denominator}`,
    confidence: field.confidence,
    evidenceRef: "catalog.numbered.validated",
  });
}

export function canonicalizeAiGraderOcrCatalog(input: {
  fields: AiGraderOcrPrefillFields;
  category: "sport" | "tcg" | "comics" | null;
  identified: IdentifySetResult | null;
  lookup: LookupSetResult | null;
}): AiGraderOcrPrefillFields {
  const fields: AiGraderOcrPrefillFields = { ...input.fields };
  const identityKey = input.category === "sport" ? "playerName" : "cardName";
  const otherIdentityKey = identityKey === "playerName" ? "cardName" : "playerName";
  fields[otherIdentityKey] = unsupportedCatalogField(fields[otherIdentityKey], "unknown", "catalog.identity.not_applicable");

  if (!input.identified || input.identified.confidence === "none") {
    const state = (input.identified?.candidateCount ?? 0) > 1 ? "disagreement" : "unknown";
    fields[identityKey] = unsupportedCatalogField(fields[identityKey], state, "catalog.identity.unresolved");
    fields.productSet = unsupportedCatalogField(fields.productSet, state, "catalog.set.unresolved");
    fields.cardNumber = unsupportedCatalogField(fields.cardNumber, state, "catalog.card_number.unresolved");
    fields.insert = unsupportedCatalogField(fields.insert, state, "catalog.insert.unresolved");
    fields.parallel = unsupportedCatalogField(fields.parallel, state, "catalog.parallel.unresolved");
    fields.numbered = validateNumberedField(fields.numbered, null);
    return fields;
  }

  const lookupMismatch = input.lookup?.match === "exact" && input.lookup.setId &&
    input.identified.setId && input.lookup.setId !== input.identified.setId;
  if (lookupMismatch) {
    for (const key of [identityKey, "productSet", "cardNumber", "insert", "parallel"] as const) {
      fields[key] = unsupportedCatalogField(fields[key], "disagreement", "catalog.identity.lookup_disagreement");
    }
    fields.numbered = validateNumberedField(fields.numbered, null);
    return fields;
  }

  fields[identityKey] = canonicalStringField(fields[identityKey], input.identified.playerName, {
    normalize: normalizeCardIdentityPlayerNameBase,
    evidenceRef: "catalog.identity",
  });
  fields.productSet = canonicalStringField(fields.productSet, input.identified.setName, {
    evidenceRef: "catalog.set",
  });
  fields.cardNumber = canonicalStringField(fields.cardNumber, input.identified.cardNumber, {
    normalize: (value) => normalizeCardNumber(String(value ?? "")) ?? "",
    evidenceRef: "catalog.card_number",
  });

  const catalogInsert = input.identified.programLabel ?? (input.lookup?.match === "exact" ? input.lookup.insertLabel : null);
  fields.insert = input.lookup?.match === "multiple"
    ? unsupportedCatalogField(fields.insert, "disagreement", "catalog.insert.multiple")
    : canonicalStringField(fields.insert, catalogInsert, { evidenceRef: "catalog.insert" });

  const parallelOptions = input.lookup?.match === "exact"
    ? (input.lookup.scopedParallels.length ? input.lookup.scopedParallels : input.lookup.parallels)
    : [];
  const parallelResolution = resolveAiGraderCatalogOption(fields.parallel.value, parallelOptions);
  let matchedParallel: LookupSetParallelOption | null = null;
  if (fields.parallel.state !== "supported") {
    fields.parallel = unsupportedCatalogField(fields.parallel, fields.parallel.state, "catalog.parallel");
  } else if (parallelResolution.match === "exact" || parallelResolution.match === "alias") {
    matchedParallel = parallelOptions.find((option) => option.label === parallelResolution.value) ?? null;
    fields.parallel = reviewedField(fields.parallel, {
      state: "supported",
      value: parallelResolution.value,
      confidence: Math.max(fields.parallel.confidence, parallelResolution.match === "exact" ? 0.95 : 0.9),
      evidenceRef: `catalog.parallel.${parallelResolution.match}`,
    });
  } else {
    fields.parallel = unsupportedCatalogField(
      fields.parallel,
      parallelResolution.match === "multiple" ? "disagreement" : "disagreement",
      `catalog.parallel.${parallelResolution.match}`
    );
  }
  fields.numbered = validateNumberedField(fields.numbered, matchedParallel);
  return fields;
}

function supportedString(field: AiGraderOcrStructuredField<AiGraderOcrStructuredValue>) {
  return field.state === "supported" && typeof field.value === "string" ? field.value : null;
}

function heuristicHints(response: OcrResponse) {
  const attributes = extractCardAttributes(String(response.combined_text ?? ""));
  return {
    playerName: attributes.playerName,
    year: attributes.year,
    manufacturer: attributes.brand,
    productSet: attributes.setName,
    numbered: attributes.numbered,
    autograph: attributes.autograph,
    memorabilia: attributes.memorabilia,
    variantKeywords: attributes.variantKeywords.join(" ") || null,
  };
}

export async function runAiGraderOcrPrefillRuntime(
  input: { reportId: string; images: AiGraderOcrPrefillSourceImage[] },
  dependencies: AiGraderOcrPrefillRuntimeDependencies = {}
): Promise<AiGraderOcrPrefillResult> {
  const images = [...input.images].sort((left, right) => (left.side === right.side ? 0 : left.side === "front" ? -1 : 1));
  if (images.length !== 2 || images[0]?.side !== "front" || images[1]?.side !== "back") {
    throw new Error("AI Grader OCR requires exactly one verified normalized front image and one verified normalized back image.");
  }
  const runOcr = dependencies.runOcr ?? runGoogleVisionDocumentTextDetectionByUrl;
  const ocr = await runOcr(images.map((image) => ({ id: image.side, url: image.url })));
  const runStructured = dependencies.runStructuredExtraction ?? runAiGraderOcrStructuredExtraction;
  const structured = await runStructured({ images, ocr, heuristicHints: heuristicHints(ocr) });
  const baseFields: AiGraderOcrPrefillFields = {
    category: outputField(structured.fields.category),
    playerName: outputField(structured.fields.playerName),
    cardName: outputField(structured.fields.cardName),
    year: outputField(structured.fields.year),
    manufacturer: outputField(structured.fields.manufacturer),
    sport: outputField(structured.fields.sport),
    game: outputField(structured.fields.game),
    productSet: outputField(structured.fields.productSet),
    cardNumber: outputField(structured.fields.cardNumber),
    insert: outputField(structured.fields.insert),
    parallel: outputField(structured.fields.parallel),
    numbered: outputField(structured.fields.numbered),
    autograph: outputField(structured.fields.autograph),
    memorabilia: outputField(structured.fields.memorabilia),
  };
  const categoryValue = supportedString(structured.fields.category);
  const category = categoryValue === "sport" || categoryValue === "tcg" || categoryValue === "comics"
    ? categoryValue
    : null;
  const identityName = category === "sport"
    ? supportedString(structured.fields.playerName)
    : supportedString(structured.fields.cardName);
  const domain = category === "sport"
    ? supportedString(structured.fields.sport)
    : category === "tcg"
      ? supportedString(structured.fields.game)
      : null;
  const year = supportedString(structured.fields.year);
  const manufacturer = supportedString(structured.fields.manufacturer);
  const cardNumber = supportedString(structured.fields.cardNumber);
  const canResolveCatalog = Boolean(category && domain && year && manufacturer && identityName && cardNumber);
  const identifySet = dependencies.identifySet ?? identifySetByCardIdentity;
  const lookupSet = dependencies.lookupSet ?? lookupSetByCardIdentity;
  let identified: IdentifySetResult | null = null;
  let lookup: LookupSetResult | null = null;
  if (canResolveCatalog) {
    identified = await identifySet({
      year,
      manufacturer,
      sport: domain,
      playerName: identityName,
      cardNumber,
      insertSet: supportedString(structured.fields.insert),
      frontCardText: ocr.results.find((result) => result.id === "front")?.text ?? "",
      combinedText: ocr.combined_text,
    });
    lookup = await lookupSet({
      year: year!,
      manufacturer: manufacturer!,
      sport: domain!,
      playerName: identityName!,
      cardNumber: cardNumber!,
    });
  }
  const fields = canonicalizeAiGraderOcrCatalog({ fields: baseFields, category, identified, lookup });
  const reviewFieldNames = Object.entries(fields)
    .filter(([, field]) => field.reviewRequired)
    .map(([name]) => name);
  const warnings = reviewFieldNames.length
    ? ["Unknown or conflicting OCR fields require operator review."]
    : [];
  return {
    reportId: input.reportId,
    status: "prefill_ready",
    humanConfirmationRequired: true,
    inventoryMutationPerformed: false,
    publishMutationPerformed: false,
    sourceSides: images.map((image) => image.side),
    fields,
    reviewFieldNames,
    provenance: {
      ocrEngine: "google_vision_document_text_detection_url_only",
      attributeExtractor: "@tenkings/shared/extractCardAttributes",
      structuredExtractor: "openai_responses_strict_json_schema",
      structuredExtractionModel: structured.model,
      setLookupUsed: Boolean(lookup),
      setIdentificationUsed: Boolean(identified),
    },
    warnings,
  };
}
