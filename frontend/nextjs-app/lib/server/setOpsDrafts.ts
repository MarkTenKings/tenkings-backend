import { createHash } from "node:crypto";
import { SetDatasetType } from "@tenkings/database";
import {
  buildSetOpsDuplicateKey,
  normalizeSetOpsOddsText,
  normalizeCardNumber,
  normalizeListingId,
  normalizeParallelLabel,
  normalizePlayerSeed,
  normalizeSetLabel,
  parseSetOpsOddsNumeric,
} from "@tenkings/shared";

export type DraftValidationIssue = {
  field: string;
  message: string;
  blocking: boolean;
};

export type SetOpsDraftRow = {
  index: number;
  setId: string;
  cardNumber: string | null;
  parallel: string;
  cardType: string | null;
  odds: string | null;
  serial: string | null;
  format: string | null;
  playerSeed: string;
  listingId: string | null;
  sourceUrl: string | null;
  duplicateKey: string;
  errors: DraftValidationIssue[];
  warnings: string[];
  raw: Record<string, unknown>;
};

export type SetOpsDraftSummary = {
  rowCount: number;
  errorCount: number;
  blockingErrorCount: number;
};

export type SetOpsTaxonomyIngestRow = {
  setId: string;
  cardNumber: string | null;
  cardType: string | null;
  program: string | null;
  programLabel: string | null;
  parallel: string;
  playerName: string;
  playerSeed: string;
  team?: string | null;
  isRookie?: boolean | null;
  metadataJson?: Record<string, unknown> | null;
  odds: string | null;
  oddsNumeric?: number | null;
  serial: string | null;
  finishFamily?: string | null;
  visualCues?: Record<string, unknown> | null;
  format: string | null;
  channel?: string | null;
  sourceUrl: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    return text;
  }
  return "";
}

function normalizeInputKey(key: string) {
  return String(key)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normalizeInputRecord(record: Record<string, unknown>) {
  const normalized: Record<string, unknown> = { ...record };
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeInputKey(key);
    if (!normalizedKey || normalizedKey in normalized) continue;
    normalized[normalizedKey] = value;
  }
  return normalized;
}

function firstOddsValue(record: Record<string, unknown>) {
  const direct = firstString(record, ["odds", "oddsInfo", "packOdds", "pullOdds", "odds_text"]);
  if (direct) return direct;
  for (const [key, value] of Object.entries(record)) {
    const normalizedKey = normalizeInputKey(key);
    if (normalizedKey !== "odds" && !normalizedKey.startsWith("odds_")) continue;
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

const rowSignalFields = [
  "cardNumber",
  "card_number",
  "cardNo",
  "number",
  "card",
  "parallel",
  "parallelId",
  "parallel_id",
  "parallelName",
  "cardType",
  "card_type",
  "program",
  "programLabel",
  "playerSeed",
  "playerName",
  "player",
  "team",
  "teamName",
  "team_name",
  "rookie",
  "isRookie",
  "parsedProgram",
  "parsedParallel",
  "odds",
  "oddsNumeric",
  "oddsInfo",
  "packOdds",
  "serial",
  "serialNumber",
  "format",
  "channel",
  "listingId",
  "sourceListingId",
  "source_listing_id",
  "listing",
  "sourceUrl",
  "url",
  "source",
];

function isEffectivelyEmptyDraftRow(record: Record<string, unknown>) {
  return !rowSignalFields.some((field) => {
    const value = record[field];
    if (value == null) return false;
    return String(value).trim() !== "";
  });
}

function parseRawRows(rawPayload: unknown, datasetType: SetDatasetType): Record<string, unknown>[] {
  let input = rawPayload;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return [];
    }
  }

  if (Array.isArray(input)) {
    return input
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => normalizeInputRecord(entry));
  }

  const record = asRecord(input);
  if (!record) return [];

  const structuredPrograms = Array.isArray(record.programs) ? record.programs : null;
  const structuredOdds = Array.isArray(record.odds) ? record.odds : null;
  if (structuredPrograms || structuredOdds) {
    const includePrograms = datasetType === SetDatasetType.PLAYER_WORKSHEET;
    const includeOdds = datasetType === SetDatasetType.PARALLEL_DB;
    const rows: Record<string, unknown>[] = [];
    const sourceUrl = firstString(record, ["sourceUrl", "url", "source"]) || null;
    const rootSetId = firstString(record, ["setId", "set", "setName", "set_name"]) || null;
    const formatMap = new Map<string, { formatKey: string | null; channelKey: string | null }>();
    if (Array.isArray(record.formats)) {
      for (const value of record.formats) {
        const entry = asRecord(value);
        if (!entry) continue;
        const key = firstString(entry, ["formatKey", "columnHeader", "key", "name"]);
        if (!key) continue;
        formatMap.set(key, {
          formatKey: firstString(entry, ["formatKey", "columnHeader", "key", "name"]) || null,
          channelKey: firstString(entry, ["channelKey", "channel"]) || null,
        });
      }
    }

    if (structuredPrograms && includePrograms) {
      for (const programValue of structuredPrograms) {
        const program = asRecord(programValue);
        if (!program) continue;
        const programLabel = firstString(program, ["label", "program", "programLabel", "subset", "cardType"]);
        const cards = Array.isArray(program.cards) ? program.cards : [];
        for (const cardValue of cards) {
          const card = asRecord(cardValue);
          if (!card) continue;
          rows.push({
            setId: firstString(card, ["setId", "set", "setName", "set_name"]) || rootSetId,
            cardNumber: firstString(card, ["cardNumber", "card_number", "cardNo", "number", "card"]),
            playerName: firstString(card, ["playerName", "player", "name"]),
            playerSeed: firstString(card, ["playerSeed", "playerName", "player", "name"]),
            team: firstString(card, ["team", "teamName", "team_name"]),
            isRookie: card.isRookie ?? card.rookie ?? card.rookieFlag ?? null,
            metadataJson: asRecord(card.metadataJson) ?? asRecord(card.metadata) ?? null,
            cardType: programLabel,
            program: programLabel,
            programLabel,
            sourceUrl,
          });
        }
      }
    }

    if (structuredOdds && includeOdds) {
      for (const oddValue of structuredOdds) {
        const odd = asRecord(oddValue);
        if (!odd) continue;
        const parsedProgram = firstString(odd, ["parsedProgram", "program", "programLabel", "cardType"]);
        const parsedParallel = firstString(odd, ["parsedParallel", "parallel", "parallelId", "parallel_id"]);
        const fallbackCardType = firstString(odd, ["cardType", "card_type"]);
        const serialDenominator = Number(odd.serialDenominator);
        const serialText =
          firstString(odd, ["serialText", "serial", "serial_number"]) ||
          (Number.isFinite(serialDenominator) && serialDenominator > 0 ? `/${serialDenominator}` : "");
        const finishFamily = firstString(odd, ["finishFamily", "finish", "foil", "surface"]) || null;
        const visualCues = asRecord(odd.visualCues) ?? asRecord(odd.visualCuesJson) ?? null;
        const values = asRecord(odd.values);
        const entries: Array<[string, unknown]> = values
          ? Object.entries(values)
          : [[firstString(odd, ["format", "formatKey", "columnHeader"]) || "default", odd]];
        const oddsByFormat: Array<{
          format: string | null;
          channel: string | null;
          oddsText: string;
          oddsNumeric: number | null;
        }> = [];
        const parallelCatalog = Boolean(odd.parallelCatalog ?? odd.isParallelCatalog);

        for (const [formatRaw, oddsValue] of entries) {
          const mapped = formatMap.get(formatRaw) ?? null;
          const oddsRecord = asRecord(oddsValue);
          const oddsText = normalizeOddsValue(
            firstString(oddsRecord ?? {}, ["text", "odds", "oddsText"]) || (oddsRecord ? "" : String(oddsValue ?? "").trim())
          );
          const numericRaw = oddsRecord?.numeric ?? oddsRecord?.oddsNumeric ?? null;
          const oddsNumeric = Number(numericRaw);
          if (!oddsText) {
            continue;
          }
          oddsByFormat.push({
            format: mapped?.formatKey ?? formatRaw,
            channel: mapped?.channelKey ?? (firstString(oddsRecord ?? {}, ["channelKey", "channel"]) || null),
            oddsText,
            oddsNumeric: Number.isFinite(oddsNumeric) ? oddsNumeric : parseSetOpsOddsNumeric(oddsText),
          });
        }

        const primaryOdds = oddsByFormat[0] ?? null;
        if (!primaryOdds && !serialText && !parallelCatalog) {
          continue;
        }

        rows.push({
          setId: rootSetId,
          cardType: parsedProgram || fallbackCardType,
          program: parsedProgram || fallbackCardType,
          programLabel: parsedProgram || fallbackCardType,
          parallel: parsedParallel || fallbackCardType,
          odds: primaryOdds?.oddsText ?? null,
          oddsNumeric: primaryOdds?.oddsNumeric ?? null,
          serial: serialText || null,
          finishFamily,
          visualCues: visualCues ?? null,
          format: primaryOdds?.format ?? null,
          channel: primaryOdds?.channel ?? null,
          oddsByFormat,
          parallelCatalog,
          hasPublishedOdds: Boolean(odd.hasPublishedOdds ?? primaryOdds),
          sourceUrl,
        });
      }
    }

    return rows;
  }

  const nested =
    (Array.isArray(record.rows) ? record.rows : null) ??
    (Array.isArray(record.data) ? record.data : null) ??
    (Array.isArray(record.items) ? record.items : null);

  if (nested) {
    return nested
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => normalizeInputRecord(entry));
  }

  return [record];
}

function countErrors(rows: SetOpsDraftRow[]) {
  const issues = rows.flatMap((row) => row.errors);
  return {
    errorCount: issues.length,
    blockingErrorCount: issues.filter((issue) => issue.blocking).length,
  };
}

function looksLikeMarkupNoise(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (text.length > 180) return true;
  if (/<[^>]+>/.test(text)) return true;
  if (/\b(class|href|src|style|data-[a-z-]+)\s*=/i.test(text)) return true;
  if (/(googletagmanager|gtm\.js|menu-item|navbar|dropdown|paszone|wppas|buy-it-now|affiliate)/i.test(text)) return true;
  if ((text.match(/https?:\/\//gi) ?? []).length >= 2) return true;
  return false;
}

function normalizeOddsValue(value: string | null | undefined) {
  return normalizeSetOpsOddsText(value);
}

function hasParallelCatalogSignal(record: Record<string, unknown>) {
  const value = record.parallelCatalog ?? record.isParallelCatalog ?? record.catalogOnly;
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes"].includes(text);
}

function derivePlayerSeed(
  raw: Record<string, unknown>,
  datasetType: SetDatasetType,
  cardType: string
): { playerSeed: string; inferredFromTeam: boolean } {
  const directPlayerSeed = normalizePlayerSeed(firstString(raw, ["playerSeed", "playerName", "player"]));
  if (directPlayerSeed) {
    return {
      playerSeed: directPlayerSeed,
      inferredFromTeam: false,
    };
  }

  if (datasetType === SetDatasetType.PARALLEL_DB) {
    return {
      playerSeed: cardType,
      inferredFromTeam: false,
    };
  }

  const teamFallback = normalizePlayerSeed(firstString(raw, ["team", "teamName", "team_name"]));
  if (teamFallback) {
    return {
      playerSeed: teamFallback,
      inferredFromTeam: true,
    };
  }

  return {
    playerSeed: "",
    inferredFromTeam: false,
  };
}

function buildOddsSignature(raw: Record<string, unknown>, fallbackOdds: string | null, fallbackFormat: string | null) {
  const oddsByFormatRaw = Array.isArray(raw.oddsByFormat) ? raw.oddsByFormat : [];
  const entries: string[] = [];

  for (const oddsEntryRaw of oddsByFormatRaw) {
    const oddsEntry = asRecord(oddsEntryRaw);
    if (!oddsEntry) continue;
    const oddsText = normalizeOddsValue(
      firstString(oddsEntry, ["oddsText", "text", "odds", "oddsInfo", "packOdds", "pullOdds", "odds_text"])
    );
    if (!oddsText) continue;
    const format = normalizePlayerSeed(firstString(oddsEntry, ["format", "formatKey", "columnHeader"])) || "default";
    const channel = normalizePlayerSeed(firstString(oddsEntry, ["channel", "channelKey"])) || "none";
    entries.push(`${format}|${channel}|${oddsText}`);
  }

  if (entries.length > 0) {
    return entries.sort().join("||");
  }

  if (hasParallelCatalogSignal(raw)) {
    return "catalog-only";
  }

  if (!fallbackOdds && !fallbackFormat) {
    return null;
  }

  return `${fallbackFormat || "default"}|none|${fallbackOdds || "none"}`;
}

function buildExactRowSignature(params: {
  datasetType: SetDatasetType;
  setId: string;
  cardNumber: string | null;
  parallel: string;
  cardType: string;
  playerSeed: string;
  team: string | null;
  listingId: string | null;
  sourceUrl: string | null;
  format: string | null;
  oddsSignature: string | null;
  serial: string | null;
}) {
  return JSON.stringify([
    params.datasetType,
    params.setId,
    params.cardNumber || "",
    params.parallel,
    params.cardType,
    params.playerSeed,
    params.team || "",
    params.listingId || "",
    params.sourceUrl || "",
    params.format || "",
    params.oddsSignature || "",
    params.serial || "",
  ]);
}

export function normalizeDraftRows(params: {
  datasetType: SetDatasetType;
  fallbackSetId: string;
  rawPayload: unknown;
}) {
  const fallbackSetId = normalizeSetLabel(params.fallbackSetId);
  const rows = parseRawRows(params.rawPayload, params.datasetType).filter((row) => !isEffectivelyEmptyDraftRow(row));
  const seenKeys = new Set<string>();
  const seenExactRows = new Set<string>();
  const normalizedRows: SetOpsDraftRow[] = [];

  for (const [index, raw] of rows.entries()) {
    const normalizedSetId = normalizeSetLabel(
      firstString(raw, ["setId", "set", "setName", "set_name"]) || fallbackSetId
    );
    const cardNumber = normalizeCardNumber(
      firstString(raw, ["cardNumber", "card_number", "cardNo", "number", "card"])
    );
    const cardType = normalizePlayerSeed(
      firstString(raw, ["cardType", "card_type", "program", "programLabel", "insertSet", "insert"])
    );
    const odds = normalizeOddsValue(firstOddsValue(raw));
    const serial = normalizeParallelLabel(firstString(raw, ["serial", "serialNumber", "serial_number", "printRun"])) || null;
    const format = normalizePlayerSeed(firstString(raw, ["format", "channel", "boxType", "packType", "productType"])) || null;
    const parallel = normalizeParallelLabel(
      firstString(raw, ["parallel", "parallelId", "parallel_id", "parallelName"])
    );
    const team = normalizePlayerSeed(firstString(raw, ["team", "teamName", "team_name"])) || null;
    const { playerSeed, inferredFromTeam } = derivePlayerSeed(raw, params.datasetType, cardType);
    const sourceUrl = firstString(raw, ["sourceUrl", "url", "source"]) || null;
    const listingId = normalizeListingId(
      firstString(raw, ["listingId", "sourceListingId", "source_listing_id", "listing", "url", "sourceUrl"])
    );
    const oddsSignature = params.datasetType === SetDatasetType.PARALLEL_DB ? buildOddsSignature(raw, odds, format) : null;
    const parallelCatalog = hasParallelCatalogSignal(raw);

    const duplicateParallelKey =
      params.datasetType === SetDatasetType.PLAYER_WORKSHEET
        ? normalizeParallelLabel(parallel || cardType || firstString(raw, ["subset", "program", "programLabel", "cardType"]))
        : parallel;

    const errors: DraftValidationIssue[] = [];
    const warnings: string[] = [];

    if (!normalizedSetId) {
      errors.push({ field: "setId", message: "setId is required", blocking: true });
    }

    if (params.datasetType === SetDatasetType.PARALLEL_DB && !parallel) {
      errors.push({ field: "parallel", message: "parallel is required for parallel_db rows", blocking: true });
    }
    if (params.datasetType === SetDatasetType.PARALLEL_DB && !odds && !serial && !parallelCatalog) {
      continue;
    }
    if (params.datasetType === SetDatasetType.PARALLEL_DB && parallelCatalog && !odds && !serial) {
      warnings.push("parallel retained without published odds because it is a catalog-only row");
    }

    if (params.datasetType === SetDatasetType.PLAYER_WORKSHEET && !playerSeed) {
      errors.push({ field: "playerSeed", message: "playerSeed is required for player_worksheet rows", blocking: true });
    }
    if (inferredFromTeam) {
      warnings.push("playerSeed inferred from team because playerName was blank");
    }

    if (looksLikeMarkupNoise(cardNumber)) {
      errors.push({ field: "cardNumber", message: "cardNumber appears to contain HTML/navigation/script content", blocking: true });
    }
    if (looksLikeMarkupNoise(parallel)) {
      errors.push({ field: "parallel", message: "parallel appears to contain HTML/navigation/script content", blocking: true });
    }
    if (looksLikeMarkupNoise(cardType)) {
      errors.push({ field: "cardType", message: "cardType appears to contain HTML/navigation/script content", blocking: true });
    }
    if (looksLikeMarkupNoise(playerSeed)) {
      errors.push({ field: "playerSeed", message: "playerSeed appears to contain HTML/navigation/script content", blocking: true });
    }
    if (looksLikeMarkupNoise(odds)) {
      errors.push({ field: "odds", message: "odds appears to contain HTML/navigation/script content", blocking: true });
    }

    if (!cardNumber && params.datasetType === SetDatasetType.PLAYER_WORKSHEET) {
      warnings.push("cardNumber missing or legacy NULL value");
    }
    if (params.datasetType === SetDatasetType.PARALLEL_DB && !cardType) {
      warnings.push("cardType missing");
    }

    const exactRowSignature = buildExactRowSignature({
      datasetType: params.datasetType,
      setId: normalizedSetId || fallbackSetId,
      cardNumber,
      parallel,
      cardType,
      playerSeed,
      team,
      listingId,
      sourceUrl,
      format,
      oddsSignature,
      serial,
    });
    if (seenExactRows.has(exactRowSignature)) {
      continue;
    }
    seenExactRows.add(exactRowSignature);

    const duplicateKey = buildSetOpsDuplicateKey({
      setId: normalizedSetId || fallbackSetId,
      cardNumber,
      parallel: duplicateParallelKey,
      playerSeed,
      team,
      listingId,
      format: params.datasetType === SetDatasetType.PARALLEL_DB ? format : null,
      odds: params.datasetType === SetDatasetType.PARALLEL_DB ? oddsSignature : null,
      serial: params.datasetType === SetDatasetType.PARALLEL_DB ? serial : null,
    });

    if (seenKeys.has(duplicateKey)) {
      if (params.datasetType === SetDatasetType.PARALLEL_DB) {
        continue;
      }
      errors.push({
        field: "duplicateKey",
        message: "duplicate row for the normalized set/card/parallel/player/listing/odds identity",
        blocking: true,
      });
    } else {
      seenKeys.add(duplicateKey);
    }

    normalizedRows.push({
      index,
      setId: normalizedSetId || fallbackSetId,
      cardNumber,
      parallel,
      cardType: cardType || null,
      odds,
      serial,
      format,
      playerSeed,
      listingId,
      sourceUrl,
      duplicateKey,
      errors,
      warnings,
      raw,
    });
  }

  const { errorCount, blockingErrorCount } = countErrors(normalizedRows);
  return {
    rows: normalizedRows,
    summary: {
      rowCount: normalizedRows.length,
      errorCount,
      blockingErrorCount,
    } satisfies SetOpsDraftSummary,
  };
}

export function buildTaxonomyIngestRows(rows: SetOpsDraftRow[]): SetOpsTaxonomyIngestRow[] {
  const output: SetOpsTaxonomyIngestRow[] = [];

  for (const row of rows) {
    if (row.errors.some((issue) => issue.blocking)) {
      continue;
    }

    const base = {
      setId: row.setId,
      cardNumber: row.cardNumber,
      cardType: row.cardType,
      program: row.cardType,
      programLabel: row.cardType,
      parallel: row.parallel,
      playerName: row.playerSeed,
      playerSeed: row.playerSeed,
      team: firstString(row.raw, ["team", "teamName", "team_name"]) || null,
      isRookie:
        typeof row.raw.isRookie === "boolean"
          ? row.raw.isRookie
          : typeof row.raw.rookie === "boolean"
          ? row.raw.rookie
          : typeof row.raw.isRookie === "string"
          ? ["true", "1", "yes", "rookie", "rc"].includes(row.raw.isRookie.toLowerCase())
          : typeof row.raw.rookie === "string"
          ? ["true", "1", "yes", "rookie", "rc"].includes(row.raw.rookie.toLowerCase())
          : null,
      metadataJson: asRecord(row.raw.metadataJson) ?? asRecord(row.raw.metadata) ?? asRecord(row.raw.cardMetadata) ?? null,
      serial: row.serial,
      finishFamily: firstString(row.raw, ["finishFamily", "finish", "foil", "surface"]) || null,
      visualCues: asRecord(row.raw.visualCues) ?? asRecord(row.raw.visualCuesJson) ?? null,
      sourceUrl: row.sourceUrl,
    };

    const oddsByFormatRaw = Array.isArray(row.raw.oddsByFormat) ? row.raw.oddsByFormat : [];
    let pushedPerFormat = 0;
    for (const oddsEntryRaw of oddsByFormatRaw) {
      const oddsEntry = asRecord(oddsEntryRaw);
      if (!oddsEntry) continue;
      const oddsText = normalizeOddsValue(
        firstString(oddsEntry, ["oddsText", "text", "odds", "oddsInfo", "packOdds", "pullOdds", "odds_text"])
      );
      if (!oddsText && !row.serial) continue;
      const numericRaw = Number(oddsEntry.oddsNumeric ?? oddsEntry.numeric ?? NaN);
      const oddsNumeric = Number.isFinite(numericRaw) ? numericRaw : parseSetOpsOddsNumeric(oddsText);
      const format =
        normalizePlayerSeed(firstString(oddsEntry, ["format", "formatKey", "columnHeader"])) ||
        row.format ||
        null;
      const channel =
        normalizePlayerSeed(firstString(oddsEntry, ["channel", "channelKey"])) ||
        firstString(row.raw, ["channel", "channelKey"]) ||
        null;

      output.push({
        ...base,
        odds: oddsText,
        oddsNumeric,
        format,
        channel,
      });
      pushedPerFormat += 1;
    }

    if (pushedPerFormat > 0) {
      continue;
    }

    output.push({
      ...base,
      odds: row.odds,
      oddsNumeric:
        Number.isFinite(Number(row.raw.oddsNumeric)) ? Number(row.raw.oddsNumeric) : parseSetOpsOddsNumeric(row.odds),
      format: row.format,
      channel: firstString(row.raw, ["channel", "channelKey"]) || null,
    });
  }

  return output;
}

export function createDraftVersionPayload(params: {
  setId: string;
  datasetType: SetDatasetType;
  rows: SetOpsDraftRow[];
}) {
  const summary = countErrors(params.rows);
  const dataRows = params.rows.map((row) => ({
    index: row.index,
    setId: row.setId,
    cardNumber: row.cardNumber,
    parallel: row.parallel,
    cardType: row.cardType,
    odds: row.odds,
    serial: row.serial,
    format: row.format,
    playerSeed: row.playerSeed,
    listingId: row.listingId,
    sourceUrl: row.sourceUrl,
    duplicateKey: row.duplicateKey,
    errors: row.errors,
    warnings: row.warnings,
    raw: row.raw,
  }));

  const hashPayload = {
    setId: normalizeSetLabel(params.setId),
    datasetType: params.datasetType,
    rows: dataRows.map((row) => ({
      setId: row.setId,
      cardNumber: row.cardNumber,
      parallel: row.parallel,
      cardType: row.cardType,
      odds: row.odds,
      serial: row.serial,
      format: row.format,
      playerSeed: row.playerSeed,
      listingId: row.listingId,
      sourceUrl: row.sourceUrl,
      duplicateKey: row.duplicateKey,
      errors: row.errors,
      warnings: row.warnings,
    })),
  };

  const versionHash = createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex");

  return {
    versionHash,
    rowCount: dataRows.length,
    errorCount: summary.errorCount,
    blockingErrorCount: summary.blockingErrorCount,
    dataJson: {
      setId: normalizeSetLabel(params.setId),
      datasetType: params.datasetType,
      rows: dataRows,
      generatedAt: new Date().toISOString(),
    },
    validationJson: {
      errorCount: summary.errorCount,
      blockingErrorCount: summary.blockingErrorCount,
    },
  };
}

export function extractDraftRows(dataJson: unknown): SetOpsDraftRow[] {
  const record = asRecord(dataJson);
  if (!record || !Array.isArray(record.rows)) {
    return [];
  }

  return record.rows
    .map((value, index) => {
      const row = asRecord(value);
      if (!row) return null;

      const errors = Array.isArray(row.errors)
        ? row.errors
            .map((issue) => asRecord(issue))
            .filter((issue): issue is Record<string, unknown> => Boolean(issue))
            .map((issue) => ({
              field: String(issue.field || "unknown"),
              message: String(issue.message || "Invalid value"),
              blocking: Boolean(issue.blocking),
            }))
        : [];

      const warnings = Array.isArray(row.warnings)
        ? row.warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
        : [];

      return {
        index: Number(row.index ?? index),
        setId: normalizeSetLabel(String(row.setId || "")),
        cardNumber: normalizeCardNumber(String(row.cardNumber ?? "")),
        parallel: normalizeParallelLabel(String(row.parallel || "")),
        cardType: normalizePlayerSeed(String(row.cardType || "")) || null,
        odds: normalizeOddsValue(String(row.odds ?? "")),
        serial: normalizeParallelLabel(String(row.serial || "")) || null,
        format: normalizePlayerSeed(String(row.format || "")) || null,
        playerSeed: normalizePlayerSeed(String(row.playerSeed || "")),
        listingId: normalizeListingId(String(row.listingId ?? "")),
        sourceUrl: String(row.sourceUrl ?? "").trim() || null,
        duplicateKey: String(row.duplicateKey || ""),
        errors,
        warnings,
        raw: asRecord(row.raw) ?? {},
      } satisfies SetOpsDraftRow;
    })
    .filter((row): row is SetOpsDraftRow => Boolean(row));
}

function rowSignature(row: SetOpsDraftRow) {
  return JSON.stringify({
    setId: row.setId,
    cardNumber: row.cardNumber,
    parallel: row.parallel,
    cardType: row.cardType,
    odds: row.odds,
    serial: row.serial,
    format: row.format,
    playerSeed: row.playerSeed,
    listingId: row.listingId,
    sourceUrl: row.sourceUrl,
    errors: row.errors,
    warnings: row.warnings,
  });
}

export function summarizeDraftDiff(previousRows: SetOpsDraftRow[], nextRows: SetOpsDraftRow[]) {
  const previousByKey = new Map(previousRows.map((row) => [row.duplicateKey, row]));
  const nextByKey = new Map(nextRows.map((row) => [row.duplicateKey, row]));

  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const [key, row] of nextByKey.entries()) {
    const previous = previousByKey.get(key);
    if (!previous) {
      added += 1;
      continue;
    }
    if (rowSignature(previous) === rowSignature(row)) {
      unchanged += 1;
    } else {
      changed += 1;
    }
  }

  for (const key of previousByKey.keys()) {
    if (!nextByKey.has(key)) {
      removed += 1;
    }
  }

  return {
    added,
    removed,
    changed,
    unchanged,
    previousCount: previousRows.length,
    nextCount: nextRows.length,
  };
}
