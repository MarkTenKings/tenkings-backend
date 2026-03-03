import { SetDatasetType } from "@tenkings/database";
import type { SetOpsDraftRow, SetOpsDraftSummary } from "./setOpsDrafts";

type CsvContractType = "SET_LIST" | "ODDS_LIST";
type CsvQualityDecision = "PASS" | "WARN" | "REJECT";

type CsvQualityMetric = {
  key: string;
  weight: number;
  score: number;
  passed: boolean;
  note: string;
};

export type SetOpsCsvQualityReport = {
  score: number;
  decision: CsvQualityDecision;
  metrics: CsvQualityMetric[];
  warnings: string[];
};

export type CsvContractAdaptResult = {
  adapted: boolean;
  contractType: CsvContractType | null;
  rawPayload: unknown;
  rowCount: number;
  quality: SetOpsCsvQualityReport | null;
  summary: Record<string, unknown>;
};

export class CsvContractValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "CsvContractValidationError";
  }
}

type CanonicalCsvRow = {
  original: Record<string, unknown>;
  normalized: Record<string, string>;
};

const CSV_HEADER_ALIASES = {
  cardNumber: ["card_number", "cardnumber", "card_no", "cardno", "number", "card"],
  playerName: ["player_name", "playername", "player", "name"],
  team: ["team", "team_name", "teamname", "club", "franchise"],
  subset: ["subset", "program", "program_label", "programlabel", "card_type", "cardtype"],
  rookie: ["rookie", "is_rookie", "isrookie", "rc"],
  cardType: ["card_type", "cardtype", "parallel", "parallel_name", "parallelname"],
} as const;

const PARALLEL_SPLIT_MARKERS = [
  "gold",
  "silver",
  "black",
  "red",
  "blue",
  "green",
  "purple",
  "orange",
  "pink",
  "teal",
  "aqua",
  "rainbow",
  "holo",
  "foil",
  "refractor",
  "fractor",
  "foilfractor",
  "superfractor",
  "shimmer",
  "sparkle",
  "atomic",
  "crackle",
  "crackleboard",
  "foilboard",
  "sandglitter",
  "diamante",
  "platinum",
  "x-fractor",
] as const;

const FINISH_MARKERS: Array<{ match: RegExp; family: string }> = [
  { match: /\brainbow\b/i, family: "rainbow" },
  { match: /\bholo\s*foil\b/i, family: "holo-foil" },
  { match: /\bfoilfractor\b|\bsuperfractor\b/i, family: "foilfractor" },
  { match: /\bfoilboard\b/i, family: "foilboard" },
  { match: /\bcrackleboard\b|\bcrackle\b/i, family: "crackleboard" },
  { match: /\bdiamante\b/i, family: "diamante" },
  { match: /\bsandglitter\b/i, family: "sandglitter" },
  { match: /\bshimmer\b/i, family: "shimmer" },
];

const NON_ODDS_COLUMNS = new Set([
  "set_id",
  "setid",
  "source_url",
  "url",
  "source",
  "player_name",
  "player",
  "name",
  "player_seed",
  "playerseed",
  "card_number",
  "cardnumber",
  "subset",
  "program",
  "program_label",
  "team",
  "rookie",
  "parallel",
  "parallel_name",
]);

function compact(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeHeader(header: string) {
  return compact(header)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function headerTokens(header: string) {
  return normalizeHeader(header).replace(/[_-]+/g, " ");
}

function slugify(value: string) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function parseOddsNumeric(oddsText: string): number | null {
  const text = compact(oddsText).replace(/,/g, "");
  if (!text || text === "-") return null;
  const ratio = text.match(/^1\s*:\s*([\d.]+)$/i);
  if (ratio?.[1]) {
    const parsed = Number(ratio[1]);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function looksLikeOddsHeader(header: string) {
  const text = headerTokens(header);
  return /\b(hobby|jumbo|hta|value|mega|fat|display|hanger|box|pack|blaster|retail|distributor|fanatics|costco|target|ea|se|cee|nt|grocery|tins|super)\b/.test(
    text
  );
}

function looksLikeOddsCell(value: string) {
  const text = compact(value).toLowerCase();
  if (!text) return false;
  if (["-", "—", "n/a", "na", "none"].includes(text)) return true;
  if (/^\d+\s*:\s*[\d,]+(?:\.\d+)?$/.test(text)) return true;
  if (/^\d[\d,]*(?:\.\d+)?$/.test(text)) return true;
  return false;
}

function parseSerialDenominator(cardType: string): number | null {
  const normalized = compact(cardType);
  const oneOfOne = normalized.match(/\b1\s*\/\s*1\b/);
  if (oneOfOne) return 1;
  const slash = normalized.match(/\/\s*(\d{1,5})\b/);
  if (!slash?.[1]) return null;
  const parsed = Number(slash[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function inferFinishFamily(label: string): string | null {
  for (const marker of FINISH_MARKERS) {
    if (marker.match.test(label)) return marker.family;
  }
  return null;
}

function coerceRookie(value: string): boolean | null {
  const normalized = compact(value).toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "y", "rookie", "rc"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return null;
}

function detectContractType(rows: CanonicalCsvRow[]): CsvContractType | null {
  if (rows.length < 1) return null;
  const headers = new Set<string>();
  Object.keys(rows[0].normalized).forEach((key) => headers.add(key));
  const hasSetList =
    headers.has("card_number") && headers.has("player_name") && headers.has("team") && headers.has("subset");
  if (hasSetList) {
    return "SET_LIST";
  }
  if (headers.has("card_type")) {
    const formatColumns = Array.from(headers).filter((key) => key !== "card_type" && !NON_ODDS_COLUMNS.has(key));
    const oddsLikeHeaderCount = formatColumns.filter((key) => looksLikeOddsHeader(key)).length;
    const sampleRows = rows.slice(0, 25);
    let oddsLikeCellCount = 0;
    let sampledCellCount = 0;
    for (const row of sampleRows) {
      for (const column of formatColumns) {
        sampledCellCount += 1;
        if (looksLikeOddsCell(row.normalized[column] || "")) {
          oddsLikeCellCount += 1;
        }
      }
    }
    const requiredOddsCells = sampleRows.length <= 2 ? 1 : 2;
    const hasOddsSignals =
      oddsLikeHeaderCount >= 1 &&
      oddsLikeCellCount >= requiredOddsCells &&
      (sampledCellCount < 1 || oddsLikeCellCount / sampledCellCount >= 0.1);
    if (hasOddsSignals) {
      return "ODDS_LIST";
    }
  }
  return null;
}

function normalizeCsvArray(rawPayload: unknown): CanonicalCsvRow[] {
  if (!Array.isArray(rawPayload)) return [];
  const rows: CanonicalCsvRow[] = [];
  for (const entry of rawPayload) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const original = entry as Record<string, unknown>;
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(original)) {
      normalized[normalizeHeader(key)] = compact(value);
    }
    rows.push({ original, normalized });
  }
  return rows;
}

function readAliasValue(row: CanonicalCsvRow, aliases: readonly string[]) {
  for (const alias of aliases) {
    const value = row.normalized[alias];
    if (value) return value;
  }
  return "";
}

function mapFormatKeyAndChannel(header: string) {
  const lower = compact(header).toLowerCase();
  const exactMap: Record<string, { formatKey: string; channelKey: string }> = {
    hobby: { formatKey: "hobby", channelKey: "distributor" },
    "hta jumbo": { formatKey: "hta-jumbo", channelKey: "distributor" },
    "value box se": { formatKey: "value-box-se", channelKey: "retail" },
    "value box ea": { formatKey: "value-box-ea", channelKey: "retail" },
    "value box cee": { formatKey: "value-box-cee", channelKey: "retail" },
    "mega box se": { formatKey: "mega-box-se", channelKey: "retail" },
    "mega box ea": { formatKey: "mega-box-ea", channelKey: "retail" },
    "mega box cee": { formatKey: "mega-box-cee", channelKey: "retail" },
    "fat pack se": { formatKey: "fat-pack-se", channelKey: "retail" },
    "fat pack ea": { formatKey: "fat-pack-ea", channelKey: "retail" },
    "display box nt": { formatKey: "display-box-nt", channelKey: "retail" },
    "display box ea": { formatKey: "display-box-ea", channelKey: "retail" },
    "hanger box se": { formatKey: "hanger-box-se", channelKey: "retail" },
    "hanger box ea": { formatKey: "hanger-box-ea", channelKey: "retail" },
    "black friday target value box": { formatKey: "value-box-bf", channelKey: "target" },
    "costco super box": { formatKey: "super-box", channelKey: "costco" },
    "fanatics value box": { formatKey: "value-box-fan", channelKey: "fanatics" },
  };
  if (exactMap[lower]) {
    return exactMap[lower];
  }
  const channelKey = lower.includes("target")
    ? "target"
    : lower.includes("costco")
    ? "costco"
    : lower.includes("fanatics")
    ? "fanatics"
    : lower.includes("hobby") || lower.includes("hta") || lower.includes("jumbo")
    ? "distributor"
    : "retail";
  return {
    formatKey: slugify(header),
    channelKey,
  };
}

function splitProgramAndParallel(cardType: string) {
  const normalized = compact(cardType);
  const withoutSerial = normalized.replace(/\b1\s*\/\s*1\b/i, "").replace(/\/\s*\d{1,5}\b/, "").trim();
  const lower = withoutSerial.toLowerCase();
  let splitIndex = -1;
  for (const marker of PARALLEL_SPLIT_MARKERS) {
    const markerIndex = lower.search(new RegExp(`\\b${marker.replace(/[-/]/g, "[-/]")}\\b`, "i"));
    if (markerIndex <= 0) continue;
    if (splitIndex < 0 || markerIndex < splitIndex) {
      splitIndex = markerIndex;
    }
  }
  if (splitIndex > 0) {
    return {
      parsedProgram: compact(withoutSerial.slice(0, splitIndex)),
      parsedParallel: compact(withoutSerial.slice(splitIndex)) || "BASE",
    };
  }
  return {
    parsedProgram: withoutSerial || normalized,
    parsedParallel: "BASE",
  };
}

function buildQualityReport(metrics: CsvQualityMetric[]): SetOpsCsvQualityReport {
  const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);
  const weightedScore = metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0);
  const score = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 10000) / 100 : 0;
  const decision: CsvQualityDecision = score >= 85 ? "PASS" : score >= 70 ? "WARN" : "REJECT";
  const warnings = metrics
    .filter((metric) => !metric.passed)
    .map((metric) => `${metric.key}: ${metric.note}`);
  return {
    score,
    decision,
    metrics,
    warnings,
  };
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function createSetListStructuredPayload(params: {
  rows: CanonicalCsvRow[];
  sourceUrl?: string | null;
  parserVersion?: string | null;
}) {
  const programMap = new Map<string, Array<Record<string, unknown>>>();
  const duplicateKeys = new Set<string>();
  let duplicates = 0;
  let playerNonEmpty = 0;
  let totalRows = 0;
  let baseRows = 0;

  for (const row of params.rows) {
    const cardNumber = readAliasValue(row, CSV_HEADER_ALIASES.cardNumber);
    const playerName = readAliasValue(row, CSV_HEADER_ALIASES.playerName);
    const team = readAliasValue(row, CSV_HEADER_ALIASES.team);
    const subset = readAliasValue(row, CSV_HEADER_ALIASES.subset);
    const rookie = readAliasValue(row, CSV_HEADER_ALIASES.rookie);

    if (!cardNumber && !playerName && !team && !subset) continue;
    totalRows += 1;
    if (playerName) playerNonEmpty += 1;
    if (/\bbase\b/i.test(subset)) baseRows += 1;

    const key = `${subset.toLowerCase()}::${cardNumber.toLowerCase()}`;
    if (duplicateKeys.has(key)) {
      duplicates += 1;
    } else {
      duplicateKeys.add(key);
    }

    const nextSubset = subset || "UNSPECIFIED";
    const cards = programMap.get(nextSubset) ?? [];
    cards.push({
      cardNumber,
      playerName: playerName || null,
      team: team || null,
      isRookie: coerceRookie(rookie),
    });
    programMap.set(nextSubset, cards);
  }

  const programEntries = Array.from(programMap.entries()).map(([label, cards]) => ({ label, cards }));
  const playerCoverage = totalRows > 0 ? playerNonEmpty / totalRows : 0;
  const baseRatio = totalRows > 0 ? baseRows / totalRows : 0;
  const metrics: CsvQualityMetric[] = [
    {
      key: "card_count_sanity",
      weight: 20,
      score: totalRows >= 100 ? 1 : totalRows >= 25 ? 0.65 : totalRows > 0 ? 0.25 : 0,
      passed: totalRows >= 25,
      note: `${totalRows} rows`,
    },
    {
      key: "player_name_coverage",
      weight: 20,
      score: clamp(playerCoverage),
      passed: playerCoverage >= 0.95,
      note: `${Math.round(playerCoverage * 100)}%`,
    },
    {
      key: "subset_distribution",
      weight: 15,
      score: clamp((programEntries.length >= 2 ? 0.5 : 0) + (baseRatio >= 0.4 ? 0.5 : 0)),
      passed: programEntries.length >= 2 && baseRatio >= 0.4,
      note: `${programEntries.length} subsets, base ${Math.round(baseRatio * 100)}%`,
    },
    {
      key: "duplicate_check",
      weight: 10,
      score: clamp(duplicates < 1 ? 1 : 1 - duplicates / Math.max(totalRows, 1)),
      passed: duplicates < 1,
      note: `${duplicates} duplicate keys`,
    },
  ];

  return {
    rawPayload: {
      artifactType: "CHECKLIST",
      sourceKind: "OFFICIAL_CHECKLIST",
      sourceUrl: params.sourceUrl || null,
      parserVersion: params.parserVersion || "csv-contract-v1",
      contractType: "SET_LIST",
      programs: programEntries,
    },
    rowCount: totalRows,
    quality: buildQualityReport(metrics),
    summary: {
      contractType: "SET_LIST",
      parsedProgramCount: programEntries.length,
      duplicateRowCount: duplicates,
      playerCoverage,
      baseRatio,
      rowCount: totalRows,
    },
  };
}

function createOddsStructuredPayload(params: {
  rows: CanonicalCsvRow[];
  sourceUrl?: string | null;
  parserVersion?: string | null;
}) {
  const first = params.rows[0];
  const formatHeaders = Object.keys(first.original).filter((header) => normalizeHeader(header) !== "card_type");
  const formats = formatHeaders.map((columnHeader) => {
    const mapped = mapFormatKeyAndChannel(columnHeader);
    return {
      columnHeader,
      formatKey: mapped.formatKey,
      channelKey: mapped.channelKey,
    };
  });
  const headerByFormatKey = new Map(formats.map((entry) => [entry.formatKey, entry.columnHeader]));

  let totalRows = 0;
  let duplicateRows = 0;
  const duplicateKeys = new Set<string>();
  let totalCells = 0;
  let filledCells = 0;
  let serialPatternRows = 0;
  let serialParsedRows = 0;
  let parsedProgramRows = 0;

  const oddsEntries: Array<Record<string, unknown>> = [];

  for (const row of params.rows) {
    const cardType = readAliasValue(row, CSV_HEADER_ALIASES.cardType);
    if (!cardType) continue;
    totalRows += 1;
    const duplicateKey = cardType.toLowerCase();
    if (duplicateKeys.has(duplicateKey)) {
      duplicateRows += 1;
    } else {
      duplicateKeys.add(duplicateKey);
    }

    const split = splitProgramAndParallel(cardType);
    const serialDenominator = parseSerialDenominator(cardType);
    if (/\/\s*\d{1,5}\b|\b1\s*\/\s*1\b/i.test(cardType)) {
      serialPatternRows += 1;
      if (serialDenominator != null) {
        serialParsedRows += 1;
      }
    }
    if (split.parsedProgram) {
      parsedProgramRows += 1;
    }

    const values: Record<string, { text: string; numeric: number | null }> = {};
    for (const format of formats) {
      const originalHeader = headerByFormatKey.get(format.formatKey) || format.columnHeader;
      const text = compact((row.original[originalHeader] as string | undefined) ?? row.normalized[normalizeHeader(originalHeader)] ?? "");
      totalCells += 1;
      if (text && text !== "-") {
        filledCells += 1;
      }
      values[format.formatKey] = {
        text: text || "-",
        numeric: parseOddsNumeric(text),
      };
    }

    oddsEntries.push({
      cardType,
      parsedProgram: split.parsedProgram || cardType,
      parsedParallel: split.parsedParallel || "BASE",
      serialDenominator,
      finishFamily: inferFinishFamily(split.parsedParallel || cardType),
      values,
    });
  }

  const oddsCompleteness = totalCells > 0 ? filledCells / totalCells : 0;
  const serialParseRate = serialPatternRows > 0 ? serialParsedRows / serialPatternRows : 1;
  const crossReferenceRate = totalRows > 0 ? parsedProgramRows / totalRows : 0;
  const metrics: CsvQualityMetric[] = [
    {
      key: "card_count_sanity",
      weight: 20,
      score: totalRows >= 75 ? 1 : totalRows >= 20 ? 0.65 : totalRows > 0 ? 0.25 : 0,
      passed: totalRows >= 20,
      note: `${totalRows} rows`,
    },
    {
      key: "odds_completeness",
      weight: 15,
      score: clamp(oddsCompleteness),
      passed: oddsCompleteness >= 0.7,
      note: `${Math.round(oddsCompleteness * 100)}%`,
    },
    {
      key: "serial_parse_rate",
      weight: 10,
      score: clamp(serialParseRate),
      passed: serialParseRate >= 0.9,
      note: `${Math.round(serialParseRate * 100)}%`,
    },
    {
      key: "cross_reference_program_parse",
      weight: 10,
      score: clamp(crossReferenceRate),
      passed: crossReferenceRate >= 0.7,
      note: `${Math.round(crossReferenceRate * 100)}%`,
    },
    {
      key: "duplicate_check",
      weight: 10,
      score: clamp(duplicateRows < 1 ? 1 : 1 - duplicateRows / Math.max(totalRows, 1)),
      passed: duplicateRows < 1,
      note: `${duplicateRows} duplicate rows`,
    },
  ];

  return {
    rawPayload: {
      artifactType: "ODDS",
      sourceKind: "OFFICIAL_ODDS",
      sourceUrl: params.sourceUrl || null,
      parserVersion: params.parserVersion || "csv-contract-v1",
      contractType: "ODDS_LIST",
      formats,
      odds: oddsEntries,
    },
    rowCount: totalRows,
    quality: buildQualityReport(metrics),
    summary: {
      contractType: "ODDS_LIST",
      rowCount: totalRows,
      totalCells,
      filledCells,
      serialPatternRows,
      serialParsedRows,
      parsedProgramRows,
      duplicateRowCount: duplicateRows,
    },
  };
}

export function adaptCsvContractPayloadForIngestion(params: {
  datasetType: SetDatasetType;
  rawPayload: unknown;
  sourceUrl?: string | null;
  parserVersion?: string | null;
}): CsvContractAdaptResult {
  const rows = normalizeCsvArray(params.rawPayload);
  if (rows.length < 1) {
    return {
      adapted: false,
      contractType: null,
      rawPayload: params.rawPayload,
      rowCount: 0,
      quality: null,
      summary: {},
    };
  }

  const contractType = detectContractType(rows);
  if (!contractType) {
    return {
      adapted: false,
      contractType: null,
      rawPayload: params.rawPayload,
      rowCount: rows.length,
      quality: null,
      summary: {},
    };
  }

  if (contractType === "SET_LIST" && params.datasetType !== SetDatasetType.PLAYER_WORKSHEET) {
    throw new CsvContractValidationError("SET_LIST CSV requires datasetType=PLAYER_WORKSHEET.");
  }
  if (contractType === "ODDS_LIST" && params.datasetType !== SetDatasetType.PARALLEL_DB) {
    throw new CsvContractValidationError("ODDS_LIST CSV requires datasetType=PARALLEL_DB.");
  }

  if (contractType === "SET_LIST") {
    const adapted = createSetListStructuredPayload({
      rows,
      sourceUrl: params.sourceUrl || null,
      parserVersion: params.parserVersion || null,
    });
    return {
      adapted: true,
      contractType,
      rawPayload: adapted.rawPayload,
      rowCount: adapted.rowCount,
      quality: adapted.quality,
      summary: adapted.summary,
    };
  }

  const adapted = createOddsStructuredPayload({
    rows,
    sourceUrl: params.sourceUrl || null,
    parserVersion: params.parserVersion || null,
  });
  return {
    adapted: true,
    contractType,
    rawPayload: adapted.rawPayload,
    rowCount: adapted.rowCount,
    quality: adapted.quality,
    summary: adapted.summary,
  };
}

function assessMetric(key: string, weight: number, score: number, passThreshold: number, note: string): CsvQualityMetric {
  const normalizedScore = clamp(score);
  return {
    key,
    weight,
    score: normalizedScore,
    passed: normalizedScore >= passThreshold,
    note,
  };
}

export function evaluateDraftQuality(params: {
  datasetType: SetDatasetType;
  rows: SetOpsDraftRow[];
  summary: SetOpsDraftSummary;
  precheckQuality?: Record<string, unknown> | null;
}): SetOpsCsvQualityReport {
  const precheckScore = Number(params.precheckQuality?.score ?? NaN);
  const precheckDecision = compact(params.precheckQuality?.decision ?? "").toUpperCase();
  if (Number.isFinite(precheckScore) && (precheckDecision === "PASS" || precheckDecision === "WARN" || precheckDecision === "REJECT")) {
    return {
      score: Math.round(precheckScore * 100) / 100,
      decision: precheckDecision as CsvQualityDecision,
      metrics: [],
      warnings: Array.isArray(params.precheckQuality?.warnings)
        ? (params.precheckQuality?.warnings as unknown[]).map((value) => compact(value)).filter(Boolean)
        : [],
    };
  }

  const rowCount = params.rows.length;
  const duplicateErrors = params.rows.flatMap((row) => row.errors).filter((error) => error.field === "duplicateKey").length;
  const metrics: CsvQualityMetric[] = [];

  const cardCountScore = rowCount >= (params.datasetType === SetDatasetType.PARALLEL_DB ? 20 : 25) ? 1 : rowCount > 0 ? 0.4 : 0;
  metrics.push(assessMetric("card_count_sanity", 20, cardCountScore, 0.65, `${rowCount} rows`));
  metrics.push(
    assessMetric(
      "duplicate_check",
      10,
      duplicateErrors < 1 ? 1 : 1 - duplicateErrors / Math.max(rowCount, 1),
      1,
      `${duplicateErrors} duplicate-key errors`
    )
  );

  if (params.datasetType === SetDatasetType.PLAYER_WORKSHEET) {
    const playerCoverage =
      rowCount > 0 ? params.rows.filter((row) => compact(row.playerSeed).length > 0).length / rowCount : 0;
    const programCounts = new Map<string, number>();
    params.rows.forEach((row) => {
      const key = compact(row.cardType || "UNSPECIFIED").toLowerCase() || "unspecified";
      programCounts.set(key, (programCounts.get(key) ?? 0) + 1);
    });
    const baseRows = params.rows.filter((row) => /\bbase\b/i.test(compact(row.cardType || ""))).length;
    const baseRatio = rowCount > 0 ? baseRows / rowCount : 0;
    const subsetScore = clamp((programCounts.size >= 2 ? 0.5 : 0) + (baseRatio >= 0.4 ? 0.5 : 0));
    metrics.push(assessMetric("player_name_coverage", 20, playerCoverage, 0.95, `${Math.round(playerCoverage * 100)}%`));
    metrics.push(
      assessMetric(
        "subset_distribution",
        15,
        subsetScore,
        1,
        `${programCounts.size} subsets, base ${Math.round(baseRatio * 100)}%`
      )
    );
  } else {
    const oddsCoverage =
      rowCount > 0 ? params.rows.filter((row) => compact(row.odds || "") || compact(row.serial || "")).length / rowCount : 0;
    const serialRows = params.rows.filter((row) => compact(row.serial || "").length > 0).length;
    const serialRate = rowCount > 0 ? serialRows / rowCount : 0;
    const programCoverage =
      rowCount > 0 ? params.rows.filter((row) => compact(row.cardType || "").length > 0).length / rowCount : 0;
    metrics.push(assessMetric("odds_completeness", 15, oddsCoverage, 0.7, `${Math.round(oddsCoverage * 100)}%`));
    metrics.push(assessMetric("serial_parse_rate", 10, serialRate, 0.3, `${Math.round(serialRate * 100)}%`));
    metrics.push(
      assessMetric(
        "cross_reference_program_parse",
        10,
        programCoverage,
        0.7,
        `${Math.round(programCoverage * 100)}% cardType coverage`
      )
    );
  }

  return buildQualityReport(metrics);
}
