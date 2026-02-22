import { createHash } from "node:crypto";
import { SetDatasetType } from "@tenkings/database";
import {
  buildSetOpsDuplicateKey,
  normalizeCardNumber,
  normalizeListingId,
  normalizeParallelLabel,
  normalizePlayerSeed,
  normalizeSetLabel,
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

function parseRawRows(rawPayload: unknown): Record<string, unknown>[] {
  let input = rawPayload;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return [];
    }
  }

  if (Array.isArray(input)) {
    return input.map((entry) => asRecord(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  }

  const record = asRecord(input);
  if (!record) return [];

  const nested =
    (Array.isArray(record.rows) ? record.rows : null) ??
    (Array.isArray(record.data) ? record.data : null) ??
    (Array.isArray(record.items) ? record.items : null);

  if (nested) {
    return nested.map((entry) => asRecord(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
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

export function normalizeDraftRows(params: {
  datasetType: SetDatasetType;
  fallbackSetId: string;
  rawPayload: unknown;
}) {
  const fallbackSetId = normalizeSetLabel(params.fallbackSetId);
  const rows = parseRawRows(params.rawPayload);
  const seenKeys = new Set<string>();

  const normalizedRows = rows.map((raw, index): SetOpsDraftRow => {
    const normalizedSetId = normalizeSetLabel(
      firstString(raw, ["setId", "set", "setName", "set_name"]) || fallbackSetId
    );
    const cardNumber = normalizeCardNumber(
      firstString(raw, ["cardNumber", "card_number", "cardNo", "number", "card"])
    );
    const parallel = normalizeParallelLabel(
      firstString(raw, ["parallel", "parallelId", "parallel_id", "parallelName", "name"])
    );
    const playerSeed = normalizePlayerSeed(firstString(raw, ["playerSeed", "playerName", "player"]));
    const sourceUrl = firstString(raw, ["sourceUrl", "url", "source"]) || null;
    const listingId = normalizeListingId(
      firstString(raw, ["listingId", "sourceListingId", "source_listing_id", "listing", "url", "sourceUrl"])
    );

    const errors: DraftValidationIssue[] = [];
    const warnings: string[] = [];

    if (!normalizedSetId) {
      errors.push({ field: "setId", message: "setId is required", blocking: true });
    }

    if (params.datasetType === SetDatasetType.PARALLEL_DB && !parallel) {
      errors.push({ field: "parallel", message: "parallel is required for parallel_db rows", blocking: true });
    }

    if (params.datasetType === SetDatasetType.PLAYER_WORKSHEET && !playerSeed) {
      errors.push({ field: "playerSeed", message: "playerSeed is required for player_worksheet rows", blocking: true });
    }

    if (!cardNumber) {
      warnings.push("cardNumber missing or legacy NULL value");
    }

    if (!listingId) {
      warnings.push("listingId missing");
    }

    const duplicateKey = buildSetOpsDuplicateKey({
      setId: normalizedSetId || fallbackSetId,
      cardNumber,
      parallel,
      playerSeed,
      listingId,
    });

    if (seenKeys.has(duplicateKey)) {
      errors.push({
        field: "duplicateKey",
        message: "duplicate row for setId/cardNumber/parallel/playerSeed/listingId",
        blocking: true,
      });
    } else {
      seenKeys.add(duplicateKey);
    }

    return {
      index,
      setId: normalizedSetId || fallbackSetId,
      cardNumber,
      parallel,
      playerSeed,
      listingId,
      sourceUrl,
      duplicateKey,
      errors,
      warnings,
      raw,
    };
  });

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
