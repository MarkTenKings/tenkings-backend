import { SetDatasetType } from "@tenkings/database";
import { normalizeParallelLabel } from "@tenkings/shared";
import type { TaxonomyAdapterOutput, TaxonomyAdapterParams } from "./taxonomyV2AdapterTypes";
import { TaxonomyArtifactType, TaxonomyEntityType, TaxonomySourceKind } from "./taxonomyV2Enums";
import {
  normalizeChannelKey,
  normalizeFormatKey,
  normalizeTaxonomyCardNumber,
  parseSerialDenominator,
  sanitizeTaxonomyText,
} from "./taxonomyV2Utils";

type RowRecord = Record<string, unknown>;

type ManufacturerAdapterConfig = {
  adapterId: string;
  sourceMatcher: {
    nameTokens: readonly string[];
    domainTokens: readonly string[];
    providerTokens: readonly string[];
  };
};

function asRecord(value: unknown): RowRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as RowRecord;
}

function parseRawRows(rawPayload: unknown): RowRecord[] {
  let input = rawPayload;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return [];
    }
  }

  if (Array.isArray(input)) {
    return input.map((entry) => asRecord(entry)).filter((entry): entry is RowRecord => Boolean(entry));
  }

  const record = asRecord(input);
  if (!record) return [];

  const nested =
    (Array.isArray(record.rows) ? record.rows : null) ??
    (Array.isArray(record.data) ? record.data : null) ??
    (Array.isArray(record.items) ? record.items : null);

  if (nested) {
    return nested.map((entry) => asRecord(entry)).filter((entry): entry is RowRecord => Boolean(entry));
  }

  return [record];
}

function firstText(record: RowRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    const text = sanitizeTaxonomyText(value);
    if (text) return text;
  }
  return "";
}

function inferProgramClass(label: string | null): string | null {
  const text = sanitizeTaxonomyText(label).toLowerCase();
  if (!text) return null;
  if (/auto|autograph|signature/.test(text)) return "autograph";
  if (/relic|memorabilia|patch|jersey/.test(text)) return "relic";
  if (/base/.test(text)) return "base";
  return "insert";
}

const ODDS_TOKEN_RE = /\b\d+\s*:\s*[\d,]+\b/i;
const PARSER_NOISE_TOKENS = [
  "glyphslib",
  "msfontlib",
  "ufo2ft",
  "project git revision",
  "truetype",
  "opentype",
  "fontlib",
  "cyrl",
  "latn",
  "greek",
] as const;

function extractOddsToken(value: unknown): string {
  const text = sanitizeTaxonomyText(value);
  if (!text) return "";
  const match = text.match(ODDS_TOKEN_RE);
  return match ? sanitizeTaxonomyText(match[0]).replace(/\s+/g, "") : "";
}

function looksLikeParserNoiseText(value: unknown): boolean {
  const text = sanitizeTaxonomyText(value).toLowerCase();
  if (!text) return false;
  if (/^\d+(?:\.\d+){1,4}$/.test(text)) return true;
  if (text.length > 40 && !/\s/.test(text)) return true;
  return PARSER_NOISE_TOKENS.some((token) => text.includes(token));
}

function looksLikeOddsRow(record: RowRecord) {
  const oddsText =
    firstText(record, ["odds", "oddsInfo", "packOdds", "pullOdds", "odds_text"]) ||
    extractOddsToken(firstText(record, ["parallel", "parallelId", "parallel_id", "parallelName", "parallelType"]));
  if (oddsText) return true;
  const serialText = firstText(record, ["serial", "serialText", "serialNumber", "numbered"]);
  if (serialText || parseSerialDenominator(serialText) != null) return true;
  const format = firstText(record, ["format", "packType", "boxType", "productFormat"]);
  return Boolean(format && (record.odds || record.oddsInfo || record.packOdds));
}

function inferArtifactType(params: {
  datasetType: SetDatasetType;
  hasChecklistSignals: boolean;
  hasOddsSignals: boolean;
}): TaxonomyArtifactType {
  if (params.datasetType === SetDatasetType.PARALLEL_DB) {
    return TaxonomyArtifactType.ODDS;
  }
  if (params.datasetType === SetDatasetType.PLAYER_WORKSHEET) {
    return TaxonomyArtifactType.CHECKLIST;
  }
  if (params.hasChecklistSignals && params.hasOddsSignals) return TaxonomyArtifactType.COMBINED;
  if (params.hasOddsSignals) return TaxonomyArtifactType.ODDS;
  return TaxonomyArtifactType.CHECKLIST;
}

function inferSourceKind(params: {
  sourceUrl?: string | null;
  parseSummary?: Record<string, unknown> | null;
  artifactType: TaxonomyArtifactType;
  matcher: ManufacturerAdapterConfig["sourceMatcher"];
}): TaxonomySourceKind {
  const sourceUrl = sanitizeTaxonomyText(params.sourceUrl).toLowerCase();
  const provider = sanitizeTaxonomyText(params.parseSummary?.sourceProvider).toLowerCase();
  const matchesOfficial =
    params.matcher.domainTokens.some((token) => sourceUrl.includes(token)) ||
    params.matcher.providerTokens.some((token) => provider.includes(token));

  if (matchesOfficial) {
    if (params.artifactType === TaxonomyArtifactType.ODDS) {
      return TaxonomySourceKind.OFFICIAL_ODDS;
    }
    return TaxonomySourceKind.OFFICIAL_CHECKLIST;
  }

  if (params.artifactType === TaxonomyArtifactType.MANUAL_PATCH) {
    return TaxonomySourceKind.MANUAL_PATCH;
  }

  return TaxonomySourceKind.TRUSTED_SECONDARY;
}

function addUniqueByKey<T>(target: T[], seen: Set<string>, key: string, value: T) {
  if (!key || seen.has(key)) return;
  seen.add(key);
  target.push(value);
}

export function looksLikeManufacturerSource(
  params: {
    setId: string;
    sourceUrl?: string | null;
    parseSummary?: Record<string, unknown> | null;
  },
  matcher: ManufacturerAdapterConfig["sourceMatcher"]
): boolean {
  const setId = sanitizeTaxonomyText(params.setId).toLowerCase();
  const sourceUrl = sanitizeTaxonomyText(params.sourceUrl).toLowerCase();
  const provider = sanitizeTaxonomyText(params.parseSummary?.sourceProvider).toLowerCase();

  return (
    matcher.nameTokens.some((token) => setId.includes(token)) ||
    matcher.domainTokens.some((token) => sourceUrl.includes(token)) ||
    matcher.providerTokens.some((token) => provider.includes(token))
  );
}

export function buildManufacturerTaxonomyAdapterOutput(
  params: TaxonomyAdapterParams,
  config: ManufacturerAdapterConfig
): TaxonomyAdapterOutput {
  const rows = parseRawRows(params.rawPayload);

  const programs: TaxonomyAdapterOutput["programs"] = [];
  const cards: TaxonomyAdapterOutput["cards"] = [];
  const variations: TaxonomyAdapterOutput["variations"] = [];
  const parallels: TaxonomyAdapterOutput["parallels"] = [];
  const scopes: TaxonomyAdapterOutput["scopes"] = [];
  const oddsRows: TaxonomyAdapterOutput["oddsRows"] = [];
  const ambiguities: TaxonomyAdapterOutput["ambiguities"] = [];

  const programSeen = new Set<string>();
  const cardSeen = new Set<string>();
  const variationSeen = new Set<string>();
  const parallelSeen = new Set<string>();
  const scopeSeen = new Set<string>();
  const oddsSeen = new Set<string>();
  const ambiguitySeen = new Set<string>();

  let hasChecklistSignals = false;
  let hasOddsSignals = false;
  const isOddsDataset = params.datasetType === SetDatasetType.PARALLEL_DB;

  rows.forEach((row, index) => {
    const rawProgram = firstText(row, [
      "program",
      "programId",
      "programLabel",
      "cardType",
      "insertSet",
      "subset",
      "section",
      "setCode",
      "series",
      "category",
    ]);
    const cardNumber = normalizeTaxonomyCardNumber(firstText(row, ["cardNumber", "card_number", "cardNo", "number", "card"]));
    const rawParallel = normalizeParallelLabel(firstText(row, ["parallel", "parallelId", "parallel_id", "parallelName", "parallelType"]));
    const rawVariation = firstText(row, ["variation", "variationName", "variant", "variationType"]);
    const playerName = firstText(row, ["playerName", "player", "playerSeed", "name"]);
    const codePrefix = firstText(row, ["codePrefix", "prefix", "programPrefix", "setPrefix"]) || null;

    const oddsText =
      firstText(row, ["odds", "oddsInfo", "packOdds", "pullOdds", "odds_text"]) || extractOddsToken(rawParallel);
    const formatKey = normalizeFormatKey(firstText(row, ["format", "packType", "boxType", "productFormat", "formatType"]));
    const channelKey = normalizeChannelKey(firstText(row, ["channel", "productChannel", "distribution", "retailType"]));

    const serialText = firstText(row, ["serial", "serialText", "serialNumber", "numbered"]) || null;
    const serialDenominator = parseSerialDenominator(serialText || rawParallel);
    const finishFamily = firstText(row, ["finishFamily", "finish", "foil", "surface"]) || null;

    const hasOddsRowSignal = Boolean(oddsText || serialText || serialDenominator != null || looksLikeOddsRow(row));
    if (isOddsDataset && !hasOddsRowSignal) {
      return;
    }

    const nextProgramLabel = sanitizeTaxonomyText(rawProgram || (!isOddsDataset && cardNumber ? "Base" : ""));
    const programLabel = looksLikeParserNoiseText(nextProgramLabel) ? "" : nextProgramLabel;
    const variationLabel = sanitizeTaxonomyText(rawVariation);
    const nextParallelLabel = sanitizeTaxonomyText(rawParallel);
    const parallelLabel = looksLikeParserNoiseText(nextParallelLabel) ? "" : nextParallelLabel;

    if (!isOddsDataset && (programLabel || cardNumber || parallelLabel || variationLabel)) {
      hasChecklistSignals = true;
    }
    if (hasOddsRowSignal || looksLikeOddsRow(row)) {
      hasOddsSignals = true;
    }

    if (programLabel) {
      addUniqueByKey(programs, programSeen, programLabel.toLowerCase(), {
        label: programLabel,
        codePrefix,
        programClass: inferProgramClass(programLabel),
        rowIndex: index,
      });
    }

    if (!isOddsDataset && cardNumber) {
      if (programLabel) {
        addUniqueByKey(cards, cardSeen, `${programLabel.toLowerCase()}::${cardNumber.toLowerCase()}`, {
          programLabel,
          cardNumber,
          playerName: playerName || null,
          rowIndex: index,
        });
      } else {
        const ambiguityKey = `card-missing-program::${cardNumber.toLowerCase()}::row-${index}`;
        addUniqueByKey(ambiguities, ambiguitySeen, ambiguityKey, {
          entityType: TaxonomyEntityType.CARD,
          key: ambiguityKey,
          reason: "Card row missing program/card type label",
          rowIndex: index,
          raw: row,
        });
      }
    }

    if (!isOddsDataset && variationLabel) {
      if (programLabel) {
        addUniqueByKey(variations, variationSeen, `${programLabel.toLowerCase()}::${variationLabel.toLowerCase()}`, {
          programLabel,
          label: variationLabel,
          scopeNote: null,
          rowIndex: index,
        });
      } else {
        const ambiguityKey = `variation-missing-program::${variationLabel.toLowerCase()}::row-${index}`;
        addUniqueByKey(ambiguities, ambiguitySeen, ambiguityKey, {
          entityType: TaxonomyEntityType.VARIATION,
          key: ambiguityKey,
          reason: "Variation row missing program/card type label",
          rowIndex: index,
          raw: row,
        });
      }
    }

    if (parallelLabel) {
      addUniqueByKey(parallels, parallelSeen, parallelLabel.toLowerCase(), {
        label: parallelLabel,
        serialDenominator,
        serialText,
        finishFamily,
        rowIndex: index,
      });
    }

    if (parallelLabel) {
      if (programLabel) {
        const scopeKey = [
          programLabel.toLowerCase(),
          parallelLabel.toLowerCase(),
          variationLabel.toLowerCase(),
          formatKey ?? "",
          channelKey ?? "",
        ].join("::");
        addUniqueByKey(scopes, scopeSeen, scopeKey, {
          programLabel,
          parallelLabel,
          variationLabel: variationLabel || null,
          formatKey,
          channelKey,
          rowIndex: index,
        });
      } else {
        const ambiguityKey = `scope-missing-program::${parallelLabel.toLowerCase()}::row-${index}`;
        addUniqueByKey(ambiguities, ambiguitySeen, ambiguityKey, {
          entityType: TaxonomyEntityType.PARALLEL_SCOPE,
          key: ambiguityKey,
          reason: "Parallel scope row missing program/card type label",
          rowIndex: index,
          raw: row,
        });
      }
    }

    const oddsRowText = sanitizeTaxonomyText(oddsText || serialText || "");
    if (oddsRowText) {
      const oddsKey = [
        programLabel.toLowerCase(),
        parallelLabel.toLowerCase(),
        formatKey ?? "",
        channelKey ?? "",
        oddsRowText.toLowerCase(),
      ].join("::");
      addUniqueByKey(oddsRows, oddsSeen, oddsKey, {
        oddsText: oddsRowText,
        programLabel: programLabel || null,
        parallelLabel: parallelLabel || null,
        formatKey,
        channelKey,
        rowIndex: index,
      });
    }
  });

  const artifactType = inferArtifactType({
    datasetType: params.datasetType,
    hasChecklistSignals,
    hasOddsSignals,
  });
  const sourceKind = inferSourceKind({
    sourceUrl: params.sourceUrl,
    parseSummary: params.parseSummary,
    artifactType,
    matcher: config.sourceMatcher,
  });

  const parserConfidence = sourceKind === TaxonomySourceKind.TRUSTED_SECONDARY ? 0.68 : 0.9;

  return {
    sourceKind,
    artifactType,
    sourceLabel: `${config.adapterId}_adapter_v1`,
    sourceTimestamp: null,
    parserConfidence,
    metadata: {
      adapter: `${config.adapterId}-v1`,
      datasetType: params.datasetType,
      parserVersion: params.parserVersion ?? null,
      rowCount: rows.length,
      programCount: programs.length,
      cardCount: cards.length,
      variationCount: variations.length,
      parallelCount: parallels.length,
      scopeCount: scopes.length,
      oddsCount: oddsRows.length,
      ambiguityCount: ambiguities.length,
      sourceProvider: params.parseSummary?.sourceProvider ?? null,
      sourceUrl: params.sourceUrl ?? null,
    },
    programs,
    cards,
    variations,
    parallels,
    scopes,
    oddsRows,
    ambiguities,
  };
}

export function canRunManufacturerAdapter(params: TaxonomyAdapterParams, matcher: ManufacturerAdapterConfig["sourceMatcher"]): boolean {
  if (params.datasetType === SetDatasetType.PLAYER_WORKSHEET) {
    return false;
  }
  return looksLikeManufacturerSource(
    {
      setId: params.setId,
      sourceUrl: params.sourceUrl,
      parseSummary: params.parseSummary,
    },
    matcher
  );
}
