#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const DATASETS = [
  {
    key: "setList",
    label: "SET LIST",
    datasetType: "PLAYER_WORKSHEET",
    pathKeys: ["setCsv", "setCsvPath", "setPath", "checklistCsv", "checklistCsvPath", "checklistPath"],
    sourceUrlKeys: ["setSourceUrl", "checklistSourceUrl", "playerWorksheetSourceUrl"],
  },
  {
    key: "parallelList",
    label: "PARALLEL LIST",
    datasetType: "PARALLEL_DB",
    pathKeys: ["parallelCsv", "parallelCsvPath", "parallelPath", "oddsCsv", "oddsCsvPath", "oddsPath"],
    sourceUrlKeys: ["parallelSourceUrl", "oddsSourceUrl"],
  },
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") continue;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function printUsage() {
  console.log(`
Usage:
  pnpm set-ops:batch-import --manifest <path> --mode <preflight|commit> [--report <path>] [--sample-rows <n>] [--continue-on-error] [--allow-existing-set]
  pnpm set-ops:batch-import --folder <path> --mode <preflight|commit> [--report <path>] [--sample-rows <n>] [--continue-on-error] [--allow-existing-set]

Required environment:
  SET_OPS_API_BASE_URL     Base admin URL. Example: https://collect.tenkings.co
  One auth option:
    SET_OPS_BEARER_TOKEN   Admin bearer token
    SET_OPS_OPERATOR_KEY   Operator key header (or OPERATOR_API_KEY / NEXT_PUBLIC_OPERATOR_KEY)

Manifest columns (CSV) or fields (JSON):
  setId,setCsv,parallelCsv,setSourceUrl,parallelSourceUrl

Folder mode:
  Parent folder contains one subfolder per set.
  Subfolder name = exact setId.
  Inside each set folder, include:
    set.csv
    parallel.csv (optional)

Examples:
  SET_OPS_API_BASE_URL="https://collect.tenkings.co" \\
  SET_OPS_OPERATOR_KEY="***" \\
  pnpm set-ops:batch-import --manifest scripts/set-ops/batch-manifest.example.csv --mode preflight

  SET_OPS_API_BASE_URL="https://collect.tenkings.co" \\
  SET_OPS_OPERATOR_KEY="***" \\
  pnpm set-ops:batch-import --folder batch-imports/run-1 --mode preflight

  SET_OPS_API_BASE_URL="https://collect.tenkings.co" \\
  SET_OPS_OPERATOR_KEY="***" \\
  pnpm set-ops:batch-import --folder batch-imports/run-1 --mode commit --sample-rows 2

Notes:
  - preflight uploads both datasets, builds both drafts, writes a report, and stops before approval.
  - commit performs the same preflight checks, then approves SET LIST followed by PARALLEL LIST.
  - reference-image Step 3 is intentionally not triggered by this script.
  - set.csv-only runs are allowed.
  - later, you can add parallel.csv for an existing set and rerun with --allow-existing-set.
`.trim());
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#0*38;/gi, "&")
    .replace(/&#x0*26;/gi, "&")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function normalizeSetLabel(value) {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function normalizeSetKey(value) {
  return normalizeSetLabel(value).toLowerCase();
}

function safeRelative(targetPath) {
  try {
    return path.relative(process.cwd(), targetPath);
  } catch {
    return targetPath;
  }
}

function normalizeObjectRows(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value;
    const nested =
      (Array.isArray(record.rows) ? record.rows : null) ??
      (Array.isArray(record.data) ? record.data : null) ??
      (Array.isArray(record.items) ? record.items : null) ??
      (Array.isArray(record.sets) ? record.sets : null) ??
      (Array.isArray(record.entries) ? record.entries : null);
    if (nested) {
      return nested.filter((entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
    }
    return [record];
  }
  return [];
}

function parseCsvRows(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (text[i + 1] === "\n") i += 1;
      continue;
    }
    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const normalizedRows = rows.filter((entry) => entry.some((value) => String(value).trim() !== ""));
  if (normalizedRows.length === 0) return [];

  const headers = normalizedRows[0].map((header, index) => String(header || "").trim() || `column_${index + 1}`);
  return normalizedRows
    .slice(1)
    .map((values) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = String(values[index] ?? "").trim();
      });
      return record;
    })
    .filter((entry) => Object.values(entry).some((value) => value !== ""));
}

function parseRowsFromFileContent(fileName, content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) return [];

  const lowerName = String(fileName || "").toLowerCase();
  const likelyJson = lowerName.endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{");

  if (likelyJson) {
    try {
      const parsed = JSON.parse(trimmed);
      const rows = normalizeObjectRows(parsed);
      if (rows.length > 0) return rows;
    } catch (error) {
      if (lowerName.endsWith(".json")) {
        throw new Error(`JSON file could not be parsed: ${fileName}`);
      }
    }
  }

  const csvRows = parseCsvRows(content);
  if (csvRows.length > 0) return csvRows;
  throw new Error(`No usable rows found in ${fileName}.`);
}

function firstValue(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function resolveManifestPath(baseDir, rawPath) {
  if (!rawPath) return "";
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.resolve(baseDir, rawPath);
}

function timestampKey(date = new Date()) {
  return date.toISOString().replace(/[:]/g, "-").replace(/\..+$/, "Z");
}

function defaultReportPath() {
  return path.resolve(process.cwd(), "logs", "set-ops", "batch-import", `${timestampKey()}.json`);
}

async function ensureParentDir(targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

function buildAuthHeaders() {
  const bearerToken = process.env.SET_OPS_BEARER_TOKEN || "";
  const operatorKey =
    process.env.SET_OPS_OPERATOR_KEY || process.env.OPERATOR_API_KEY || process.env.NEXT_PUBLIC_OPERATOR_KEY || "";
  const headers = {
    Accept: "application/json",
  };

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
  if (operatorKey) {
    headers["X-Operator-Key"] = operatorKey;
  }

  if (!headers.Authorization && !headers["X-Operator-Key"]) {
    throw new Error(
      "Missing auth. Set SET_OPS_BEARER_TOKEN or SET_OPS_OPERATOR_KEY (or OPERATOR_API_KEY / NEXT_PUBLIC_OPERATOR_KEY)."
    );
  }

  return headers;
}

async function requestJson(baseUrl, requestPath, options = {}) {
  const response = await fetch(`${baseUrl}${requestPath}`, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = text ? { raw: text } : {};
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload.message === "string" && payload.message) ||
      (payload && typeof payload.raw === "string" && payload.raw) ||
      `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function loadManifest(manifestPath) {
  const raw = await fs.readFile(manifestPath, "utf8");
  const baseDir = path.dirname(manifestPath);
  const rows = normalizeObjectRows(
    manifestPath.toLowerCase().endsWith(".json") ? JSON.parse(raw) : parseCsvRows(raw)
  );

  if (!Array.isArray(rows) || rows.length < 1) {
    throw new Error(`Manifest did not contain any rows: ${manifestPath}`);
  }

  return rows.map((row, index) => {
    const setId = normalizeSetLabel(firstValue(row, ["setId", "set_id", "set", "setName"]));
    const setCsvPath = resolveManifestPath(baseDir, firstValue(row, DATASETS[0].pathKeys));
    const parallelCsvPath = resolveManifestPath(baseDir, firstValue(row, DATASETS[1].pathKeys));

    if (!setId) {
      throw new Error(`Manifest row ${index + 1} is missing setId`);
    }
    if (!setCsvPath && !parallelCsvPath) {
      throw new Error(`Manifest row ${index + 1} must include at least one CSV path`);
    }

    return {
      rowNumber: index + 1,
      setId,
      setCsvPath,
      parallelCsvPath,
      setSourceUrl: firstValue(row, DATASETS[0].sourceUrlKeys) || null,
      parallelSourceUrl: firstValue(row, DATASETS[1].sourceUrlKeys) || null,
    };
  });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveSetFolderCsv(setDir, candidates) {
  for (const candidate of candidates) {
    const target = path.join(setDir, candidate);
    if (await pathExists(target)) {
      return target;
    }
  }
  return "";
}

async function loadFolderEntries(folderPath) {
  const dirents = await fs.readdir(folderPath, { withFileTypes: true });
  const setDirs = dirents
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (setDirs.length < 1) {
    throw new Error(`Folder mode found no set subfolders in ${folderPath}`);
  }

  const entries = [];
  for (let index = 0; index < setDirs.length; index += 1) {
    const dirName = setDirs[index];
    const setDir = path.join(folderPath, dirName);
    const setCsvPath = await resolveSetFolderCsv(setDir, ["set.csv", "checklist.csv"]);
    const parallelCsvPath = await resolveSetFolderCsv(setDir, ["parallel.csv", "odds.csv"]);

    if (!setCsvPath && !parallelCsvPath) {
      throw new Error(`Missing import files in ${setDir}; expected set.csv and/or parallel.csv`);
    }

    entries.push({
      rowNumber: index + 1,
      setId: normalizeSetLabel(dirName),
      setCsvPath,
      parallelCsvPath,
      setSourceUrl: null,
      parallelSourceUrl: null,
    });
  }

  return entries;
}

function distinctRowSetIds(rows) {
  const values = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const candidate = normalizeSetLabel(
      String(row.setId ?? row.set ?? row.setName ?? row.set_name ?? "").trim()
    );
    if (candidate) values.add(candidate);
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function toRowPreview(row) {
  if (!row || typeof row !== "object") return row;
  return {
    index: row.index,
    setId: row.setId,
    cardNumber: row.cardNumber,
    parallel: row.parallel,
    cardType: row.cardType,
    playerSeed: row.playerSeed,
    listingId: row.listingId,
    errors: Array.isArray(row.errors) ? row.errors : [],
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
  };
}

async function fetchExactSetSummary(baseUrl, headers, setId) {
  const params = new URLSearchParams({
    q: setId,
    includeArchived: "true",
    limit: "50",
  });
  const payload = await requestJson(baseUrl, `/api/admin/set-ops/sets?${params.toString()}`, {
    method: "GET",
    headers,
  });
  const exact = Array.isArray(payload.sets)
    ? payload.sets.find((row) => normalizeSetKey(row.setId) === normalizeSetKey(setId)) || null
    : null;
  return exact;
}

async function queueIngestionJob(baseUrl, headers, params) {
  const payload = await requestJson(baseUrl, "/api/admin/set-ops/ingestion", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      setId: params.setId,
      datasetType: params.datasetType,
      sourceUrl: params.sourceUrl,
      parserVersion: "batch-cli-v1",
      sourceProvider: "BATCH_MANIFEST",
      sourceQuery: {
        manifestPath: params.manifestPath,
        manifestRowNumber: params.manifestRowNumber,
        datasetLabel: params.datasetLabel,
        mode: params.mode,
      },
      sourceFetchMeta: {
        batchRunId: params.batchRunId,
        fileName: params.fileName,
        rowCount: params.rowCount,
        importedAt: new Date().toISOString(),
      },
      rawPayload: params.rows,
    }),
  });
  return payload.job;
}

async function buildDraft(baseUrl, headers, ingestionJobId) {
  return requestJson(baseUrl, "/api/admin/set-ops/drafts/build", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ingestionJobId }),
  });
}

async function fetchDraft(baseUrl, headers, setId, datasetType) {
  const params = new URLSearchParams({
    setId,
    datasetType,
  });
  return requestJson(baseUrl, `/api/admin/set-ops/drafts?${params.toString()}`, {
    method: "GET",
    headers,
  });
}

async function approveDraft(baseUrl, headers, setId, draftVersionId) {
  return requestJson(baseUrl, "/api/admin/set-ops/approval", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      setId,
      draftVersionId,
      decision: "APPROVED",
    }),
  });
}

async function readDatasetRows(datasetConfig, manifestEntry) {
  const filePath = datasetConfig.key === "setList" ? manifestEntry.setCsvPath : manifestEntry.parallelCsvPath;
  const fileName = path.basename(filePath);
  const content = await fs.readFile(filePath, "utf8");
  const rows = parseRowsFromFileContent(fileName, content);
  const embeddedSetIds = distinctRowSetIds(rows);
  return {
    filePath,
    fileName,
    rows,
    embeddedSetIds,
    sourceUrl: datasetConfig.key === "setList" ? manifestEntry.setSourceUrl : manifestEntry.parallelSourceUrl,
  };
}

function createEmptyDatasetResult(datasetConfig) {
  return {
    label: datasetConfig.label,
    datasetType: datasetConfig.datasetType,
    filePath: null,
    fileName: null,
    rowCount: 0,
    embeddedSetIds: [],
    queuedJobId: null,
    build: null,
    previewRows: [],
    latestVersionId: null,
    skipped: false,
    error: null,
  };
}

function hasDatasetFile(manifestEntry, datasetConfig) {
  return Boolean(datasetConfig.key === "setList" ? manifestEntry.setCsvPath : manifestEntry.parallelCsvPath);
}

function isSafePreflightOnlyExistingSet(existingSet) {
  if (!existingSet || typeof existingSet !== "object") return false;
  const draftStatus = String(existingSet.draftStatus || "").trim().toUpperCase();
  const variantCount = Number(existingSet.variantCount || 0);
  return draftStatus === "REVIEW_REQUIRED" && variantCount === 0;
}

async function processSetEntry(manifestEntry, context) {
  const result = {
    rowNumber: manifestEntry.rowNumber,
    setId: manifestEntry.setId,
    mode: context.mode,
    status: "pending",
    existingSet: null,
    validationErrors: [],
    datasets: {
      setList: createEmptyDatasetResult(DATASETS[0]),
      parallelList: createEmptyDatasetResult(DATASETS[1]),
    },
    approvals: [],
    finalSetSummary: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  console.log(`\n[batch] ${manifestEntry.rowNumber}/${context.totalEntries} ${manifestEntry.setId}`);

  const availableDatasets = DATASETS.filter((datasetConfig) => hasDatasetFile(manifestEntry, datasetConfig));
  if (availableDatasets.length < 1) {
    result.status = "invalid_entry";
    result.validationErrors.push("No dataset files present for this set");
    result.completedAt = new Date().toISOString();
    return result;
  }

  const existingSet = await fetchExactSetSummary(context.baseUrl, context.headers, manifestEntry.setId).catch((error) => {
    result.validationErrors.push(`Failed to query existing set summary: ${error.message}`);
    return null;
  });
  result.existingSet = existingSet;

  if (!existingSet && !manifestEntry.setCsvPath && manifestEntry.parallelCsvPath) {
    result.status = "parallel_only_new_set_blocked";
    result.validationErrors.push(
      "parallel.csv-only import is blocked for brand-new sets. Import set.csv first, then add parallel.csv later."
    );
    result.completedAt = new Date().toISOString();
    return result;
  }

  if (
    existingSet &&
    !context.allowExistingSet &&
    !existingSet.archived &&
    !isSafePreflightOnlyExistingSet(existingSet)
  ) {
    result.status = "blocked_existing_set";
    result.validationErrors.push(
      `Set already exists in Set Ops (${existingSet.setId}; draftStatus=${existingSet.draftStatus ?? "null"}; variantCount=${existingSet.variantCount}). Use --allow-existing-set to bypass.`
    );
    result.completedAt = new Date().toISOString();
    return result;
  }

  for (const datasetConfig of DATASETS) {
    const datasetKey = datasetConfig.key;
    const datasetResult = result.datasets[datasetKey];
    if (!availableDatasets.find((entry) => entry.key === datasetKey)) {
      datasetResult.skipped = true;
      continue;
    }
    try {
      const loaded = await readDatasetRows(datasetConfig, manifestEntry);
      datasetResult.filePath = safeRelative(loaded.filePath);
      datasetResult.fileName = loaded.fileName;
      datasetResult.rowCount = loaded.rows.length;
      datasetResult.embeddedSetIds = loaded.embeddedSetIds;

      if (loaded.rows.length < 1) {
        throw new Error(`${datasetConfig.label} file has no usable rows`);
      }

      if (loaded.embeddedSetIds.length > 0) {
        const mismatched = loaded.embeddedSetIds.filter(
          (candidate) => normalizeSetKey(candidate) !== normalizeSetKey(manifestEntry.setId)
        );
        if (mismatched.length > 0) {
          throw new Error(
            `${datasetConfig.label} row-level setId values do not match manifest setId. Found: ${mismatched.join(", ")}`
          );
        }
      }

      const job = await queueIngestionJob(context.baseUrl, context.headers, {
        setId: manifestEntry.setId,
        datasetType: datasetConfig.datasetType,
        sourceUrl: loaded.sourceUrl,
        rows: loaded.rows,
        rowCount: loaded.rows.length,
        fileName: loaded.fileName,
        manifestPath: context.manifestPathForAudit,
        manifestRowNumber: manifestEntry.rowNumber,
        datasetLabel: datasetConfig.label,
        mode: context.mode,
        batchRunId: context.batchRunId,
      });
      datasetResult.queuedJobId = job?.id ?? null;
      console.log(`[batch]   queued ${datasetConfig.label}: ${datasetResult.queuedJobId || "unknown-job-id"}`);

      const built = await buildDraft(context.baseUrl, context.headers, datasetResult.queuedJobId);
      datasetResult.build = {
        draftId: built.draftId ?? null,
        versionId: built.version?.id ?? null,
        version: built.version?.version ?? null,
        rowCount: built.summary?.rowCount ?? built.version?.rowCount ?? null,
        errorCount: built.summary?.errorCount ?? built.version?.errorCount ?? null,
        blockingErrorCount: built.summary?.blockingErrorCount ?? built.version?.blockingErrorCount ?? null,
      };
      datasetResult.latestVersionId = datasetResult.build.versionId;
      console.log(
        `[batch]   built ${datasetConfig.label}: rows=${datasetResult.build.rowCount ?? 0}, blocking=${datasetResult.build.blockingErrorCount ?? 0}`
      );

      const draft = await fetchDraft(context.baseUrl, context.headers, manifestEntry.setId, datasetConfig.datasetType);
      const latestRows = Array.isArray(draft.latestVersion?.rows) ? draft.latestVersion.rows : [];
      datasetResult.previewRows = latestRows.slice(0, context.sampleRows).map(toRowPreview);
      if (!datasetResult.latestVersionId && draft.latestVersion?.id) {
        datasetResult.latestVersionId = draft.latestVersion.id;
      }
    } catch (error) {
      datasetResult.error = error.message;
      result.validationErrors.push(`${datasetConfig.label}: ${error.message}`);
    }
  }

  const blockingDataset = availableDatasets.find((datasetConfig) => {
    const build = result.datasets[datasetConfig.key].build;
    return result.datasets[datasetConfig.key].error || !build || Number(build.blockingErrorCount || 0) > 0;
  });

  if (blockingDataset) {
    result.status = "preflight_failed";
    const build = result.datasets[blockingDataset.key].build;
    if (build && Number(build.blockingErrorCount || 0) > 0) {
      result.validationErrors.push(
        `${blockingDataset.label}: blockingErrorCount=${build.blockingErrorCount}. Inspect draft preview before approval.`
      );
    }
    result.completedAt = new Date().toISOString();
    return result;
  }

  if (context.mode === "preflight") {
    result.status = "preflight_complete";
    result.completedAt = new Date().toISOString();
    return result;
  }

  for (const datasetConfig of availableDatasets) {
    const datasetResult = result.datasets[datasetConfig.key];
    try {
      const approval = await approveDraft(
        context.baseUrl,
        context.headers,
        manifestEntry.setId,
        datasetResult.latestVersionId
      );
      result.approvals.push({
        label: datasetConfig.label,
        draftVersionId: datasetResult.latestVersionId,
        approvalId: approval.approval?.id ?? null,
        variantSync: approval.variantSync ?? null,
      });
      const sync = approval.variantSync;
      console.log(
        `[batch]   approved ${datasetConfig.label}: sync=${sync?.status ?? "unknown"} inserted=${sync?.inserted ?? 0} updated=${sync?.updated ?? 0} failed=${sync?.failed ?? 0}`
      );
    } catch (error) {
      result.approvals.push({
        label: datasetConfig.label,
        draftVersionId: datasetResult.latestVersionId,
        approvalId: null,
        variantSync: null,
        error: error.message,
      });
      result.status = "commit_failed";
      result.validationErrors.push(`Approval failed for ${datasetConfig.label}: ${error.message}`);
      result.completedAt = new Date().toISOString();
      result.finalSetSummary = await fetchExactSetSummary(context.baseUrl, context.headers, manifestEntry.setId).catch(() => null);
      return result;
    }
  }

  result.finalSetSummary = await fetchExactSetSummary(context.baseUrl, context.headers, manifestEntry.setId).catch(() => null);
  result.status = "commit_complete";
  result.completedAt = new Date().toISOString();
  return result;
}

async function persistReport(reportPath, report) {
  await ensureParentDir(reportPath);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }

  const manifestPathArg = String(args.manifest || "").trim();
  const folderPathArg = String(args.folder || "").trim();
  const mode = String(args.mode || "").trim().toLowerCase();
  if ((manifestPathArg && folderPathArg) || (!manifestPathArg && !folderPathArg)) {
    printUsage();
    throw new Error("Provide exactly one of --manifest or --folder");
  }
  if (!["preflight", "commit"].includes(mode)) {
    printUsage();
    throw new Error("--mode must be preflight or commit");
  }

  const inputMode = manifestPathArg ? "manifest" : "folder";
  const manifestPath = manifestPathArg ? path.resolve(process.cwd(), manifestPathArg) : null;
  const folderPath = folderPathArg ? path.resolve(process.cwd(), folderPathArg) : null;
  const reportPath = path.resolve(process.cwd(), String(args.report || defaultReportPath()));
  const sampleRows = Math.max(1, Math.min(20, Number(args["sample-rows"] || 3) || 3));
  const continueOnError = Boolean(args["continue-on-error"]);
  const allowExistingSet = Boolean(args["allow-existing-set"]);
  const baseUrl = String(process.env.SET_OPS_API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const headers = buildAuthHeaders();
  const manifest = manifestPath ? await loadManifest(manifestPath) : await loadFolderEntries(folderPath);
  const batchRunId = `batch-${timestampKey()}`;

  const report = {
    batchRunId,
    mode,
    inputMode,
    manifestPath: manifestPath ? safeRelative(manifestPath) : null,
    folderPath: folderPath ? safeRelative(folderPath) : null,
    reportPath: safeRelative(reportPath),
    baseUrl,
    sampleRows,
    continueOnError,
    allowExistingSet,
    startedAt: new Date().toISOString(),
    completedAt: null,
    totalEntries: manifest.length,
    results: [],
  };

  console.log(
    `[batch] mode=${mode} ${inputMode}=${safeRelative(manifestPath || folderPath)} entries=${manifest.length}`
  );
  console.log(`[batch] report=${safeRelative(reportPath)}`);

  for (let index = 0; index < manifest.length; index += 1) {
    const entry = manifest[index];
    const result = await processSetEntry(entry, {
      mode,
      baseUrl,
      headers,
      sampleRows,
      continueOnError,
      allowExistingSet,
      batchRunId,
      manifestPathForAudit: safeRelative(manifestPath || folderPath),
      totalEntries: manifest.length,
    });
    report.results.push(result);
    await persistReport(reportPath, report);

    if (Array.isArray(result.validationErrors) && result.validationErrors.length > 0) {
      for (const message of result.validationErrors) {
        console.error(`[batch]   issue: ${message}`);
      }
    }

    const shouldStop =
      ["blocked_existing_set", "preflight_failed", "commit_failed"].includes(result.status) && !continueOnError;
    if (shouldStop) {
      console.error(`[batch] stopping after ${result.setId}: ${result.status}`);
      break;
    }
  }

  report.completedAt = new Date().toISOString();
  await persistReport(reportPath, report);

  const statusCounts = report.results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`\n[batch] complete ${JSON.stringify(statusCounts)}`);
  console.log(`[batch] report saved to ${safeRelative(reportPath)}`);

  const hasFailures = report.results.some((result) =>
    ["blocked_existing_set", "preflight_failed", "commit_failed"].includes(result.status)
  );
  if (hasFailures) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[batch] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
