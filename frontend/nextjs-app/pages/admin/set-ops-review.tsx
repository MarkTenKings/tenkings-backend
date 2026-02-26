import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type DatasetType = "PARALLEL_DB" | "PLAYER_WORKSHEET";
type CombinedDatasetMode = DatasetType | "COMBINED";

type IngestionJob = {
  id: string;
  setId: string;
  draftId: string | null;
  datasetType: string;
  sourceUrl: string | null;
  parserVersion: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  parsedAt: string | null;
  reviewedAt: string | null;
  sourceProvider: string | null;
  sourceQuery: Record<string, unknown> | null;
  sourceFetchMeta: Record<string, unknown> | null;
};

type DraftRow = {
  index: number;
  setId: string;
  cardNumber: string | null;
  parallel: string;
  playerSeed: string;
  listingId: string | null;
  sourceUrl: string | null;
  duplicateKey: string;
  errors: Array<{ field: string; message: string; blocking: boolean }>;
  warnings: string[];
};

type DraftVersion = {
  id: string;
  version: number;
  versionHash: string;
  rowCount: number;
  errorCount: number;
  blockingErrorCount: number;
  createdAt: string;
};

type SeedJob = {
  id: string;
  setId: string;
  status: string;
  queueCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  progress: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  logs: string[];
};

type SetOpsPermissions = {
  reviewer: boolean;
  approver: boolean;
  delete: boolean;
  admin: boolean;
};

type AccessResponse =
  | {
      permissions: SetOpsPermissions;
      user: {
        id: string;
        phone: string | null;
        displayName: string | null;
      };
    }
  | {
      message: string;
    };

type DiscoveryResult = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  provider: string;
  domain: string;
  setIdGuess: string;
  score: number;
  discoveredAt: string;
};

type ReviewStepId = "source-intake" | "ingestion-queue" | "draft-approval" | "seed-monitor";

const REVIEW_STEPS: Array<{ id: ReviewStepId; label: string; description: string }> = [
  {
    id: "source-intake",
    label: "Source Intake",
    description: "Discover sources and import URL/file payloads.",
  },
  {
    id: "ingestion-queue",
    label: "Ingestion Queue",
    description: "Queue jobs, select a set, and build draft.",
  },
  {
    id: "draft-approval",
    label: "Draft & Approval",
    description: "Edit rows, save immutable versions, approve/reject.",
  },
  {
    id: "seed-monitor",
    label: "Seed Monitor",
    description: "Start, watch, cancel, and retry seed jobs.",
  },
];

function parseReviewStep(value: string | string[] | undefined): ReviewStepId | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  if (REVIEW_STEPS.some((step) => step.id === raw)) {
    return raw as ReviewStepId;
  }
  return null;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function toJsonPreview(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function normalizeObjectRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nested =
      (Array.isArray(record.rows) ? record.rows : null) ??
      (Array.isArray(record.data) ? record.data : null) ??
      (Array.isArray(record.items) ? record.items : null);
    if (nested) {
      return nested.filter(
        (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      );
    }
    return [record];
  }
  return [];
}

function parseCsvRows(csvText: string): Array<Record<string, string>> {
  const text = csvText.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
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
      if (text[i + 1] === "\n") {
        i += 1;
      }
      continue;
    }
    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const normalizedRows = rows.filter((entry) => entry.some((cellValue) => String(cellValue).trim() !== ""));
  if (normalizedRows.length === 0) return [];

  const headers = normalizedRows[0].map((header, index) => String(header || "").trim() || `column_${index + 1}`);
  const data = normalizedRows.slice(1);
  return data
    .map((values) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = String(values[index] ?? "").trim();
      });
      return record;
    })
    .filter((entry) => Object.values(entry).some((value) => value !== ""));
}

function parseRowsFromFileContent(fileName: string, content: string): Array<Record<string, unknown>> {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const lowerName = fileName.toLowerCase();
  const likelyJson = lowerName.endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{");

  if (likelyJson) {
    try {
      const parsed = JSON.parse(trimmed);
      const rows = normalizeObjectRows(parsed);
      if (rows.length > 0) return rows;
    } catch {
      if (lowerName.endsWith(".json")) {
        throw new Error("JSON file could not be parsed.");
      }
    }
  }

  const csvRows = parseCsvRows(content);
  if (csvRows.length > 0) return csvRows;
  throw new Error("No usable rows found. Upload a CSV with headers, JSON row array, or a checklist/odds PDF.");
}

function inferSetIdFromRows(rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    const candidate =
      String(row.setId ?? row.set ?? row.setName ?? row.set_name ?? "")
        .trim()
        .replace(/\s+/g, " ");
    if (candidate) return candidate;
  }
  return "";
}

function estimateRowCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.rows)) return record.rows.length;
    if (Array.isArray(record.data)) return record.data.length;
    if (Array.isArray(record.items)) return record.items.length;
    return 1;
  }
  return 0;
}

function buildSetIdFromDiscoveryInputs(params: {
  year: string;
  manufacturer: string;
  sport: string;
  query: string;
}) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  const year = normalize(params.year);
  const manufacturer = normalize(params.manufacturer);
  const sport = normalize(params.sport);
  const query = normalize(params.query);
  const genericQuery = /^(cards?|trading cards?|checklist|set|sets)$/i.test(query);
  const queryPart = query && !genericQuery ? query : "";
  return [year, manufacturer, sport, queryPart].filter(Boolean).join(" ");
}

const combinedDatasetImportOrder: DatasetType[] = ["PARALLEL_DB", "PLAYER_WORKSHEET"];

function expandDatasetMode(mode: CombinedDatasetMode): DatasetType[] {
  if (mode === "COMBINED") return combinedDatasetImportOrder;
  return [mode];
}

function formatDatasetLabel(mode: CombinedDatasetMode) {
  if (mode === "COMBINED") return "SET CHECKLIST + ODDS LIST";
  return mode === "PARALLEL_DB" ? "ODDS LIST" : "SET CHECKLIST";
}

function formatDatasetMode(mode: CombinedDatasetMode) {
  return formatDatasetLabel(mode);
}

function formatDatasetTypeValue(value: string) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "PARALLEL_DB") return formatDatasetLabel("PARALLEL_DB");
  if (normalized === "PLAYER_WORKSHEET") return formatDatasetLabel("PLAYER_WORKSHEET");
  return normalized || "-";
}

export default function SetOpsReviewPage() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);
  const autoLoadedRef = useRef(false);

  const [datasetType, setDatasetType] = useState<DatasetType>("PARALLEL_DB");
  const [queueDatasetMode, setQueueDatasetMode] = useState<CombinedDatasetMode>("PARALLEL_DB");
  const [setIdInput, setSetIdInput] = useState("");
  const [sourceUrlInput, setSourceUrlInput] = useState("");
  const [parserVersionInput, setParserVersionInput] = useState("manual-v1");
  const [rawPayloadInput, setRawPayloadInput] = useState("[]");
  const [showRawPayloadEditor, setShowRawPayloadEditor] = useState(false);
  const [payloadFileName, setPayloadFileName] = useState<string | null>(null);
  const [payloadRowCount, setPayloadRowCount] = useState<number>(0);
  const [payloadLoading, setPayloadLoading] = useState(false);
  const [discoveryYearInput, setDiscoveryYearInput] = useState(String(new Date().getFullYear()));
  const [discoveryManufacturerInput, setDiscoveryManufacturerInput] = useState("");
  const [discoverySportInput, setDiscoverySportInput] = useState("");
  const [discoveryQueryInput, setDiscoveryQueryInput] = useState("");
  const [discoverySetIdOverrideInput, setDiscoverySetIdOverrideInput] = useState("");
  const [discoverySourceUrlInput, setDiscoverySourceUrlInput] = useState("");
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryResult[]>([]);
  const [discoveryImportBusyId, setDiscoveryImportBusyId] = useState<string | null>(null);

  const [ingestionJobs, setIngestionJobs] = useState<IngestionJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");

  const [selectedSetId, setSelectedSetId] = useState("");
  const [latestVersion, setLatestVersion] = useState<DraftVersion | null>(null);
  const [versions, setVersions] = useState<DraftVersion[]>([]);
  const [latestApprovedVersionId, setLatestApprovedVersionId] = useState<string | null>(null);
  const [editableRows, setEditableRows] = useState<DraftRow[]>([]);

  const [seedJobs, setSeedJobs] = useState<SeedJob[]>([]);

  const [busy, setBusy] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<SetOpsPermissions | null>(null);
  const [activeStep, setActiveStep] = useState<ReviewStepId>("source-intake");

  const selectedJob = useMemo(
    () => ingestionJobs.find((job) => job.id === selectedJobId) ?? null,
    [ingestionJobs, selectedJobId]
  );
  const canReview = Boolean(permissions?.reviewer);
  const canApprove = Boolean(permissions?.approver);
  const discoverySetIdSuggestion = useMemo(
    () =>
      buildSetIdFromDiscoveryInputs({
        year: discoveryYearInput,
        manufacturer: discoveryManufacturerInput,
        sport: discoverySportInput,
        query: discoveryQueryInput,
      }),
    [discoveryManufacturerInput, discoveryQueryInput, discoverySportInput, discoveryYearInput]
  );

  const blockingErrorCount = useMemo(
    () => editableRows.flatMap((row) => row.errors).filter((issue) => issue.blocking).length,
    [editableRows]
  );

  const stepCompletion = useMemo<Record<ReviewStepId, boolean>>(
    () => ({
      "source-intake":
        discoveryResults.length > 0 || Boolean(discoverySourceUrlInput.trim()) || Boolean(discoverySetIdOverrideInput.trim()),
      "ingestion-queue": ingestionJobs.length > 0 || Boolean(selectedJobId),
      "draft-approval": Boolean(latestApprovedVersionId || (latestVersion?.id && blockingErrorCount === 0)),
      "seed-monitor": seedJobs.some((job) => job.status === "COMPLETE"),
    }),
    [
      blockingErrorCount,
      discoveryResults.length,
      discoverySetIdOverrideInput,
      discoverySourceUrlInput,
      ingestionJobs.length,
      latestApprovedVersionId,
      latestVersion?.id,
      seedJobs,
      selectedJobId,
    ]
  );

  const activeStepIndex = useMemo(() => REVIEW_STEPS.findIndex((step) => step.id === activeStep), [activeStep]);

  const setActiveStepWithUrl = useCallback(
    (nextStep: ReviewStepId) => {
      setActiveStep(nextStep);
      if (!router.isReady) return;
      const current = parseReviewStep(router.query.step);
      if (current === nextStep) return;
      const nextQuery = {
        ...router.query,
        step: nextStep,
      };
      void router.replace(
        {
          pathname: router.pathname,
          query: nextQuery,
        },
        undefined,
        { shallow: true }
      );
    },
    [router]
  );

  const addDraftRow = useCallback(() => {
    if (!canReview) return;
    setEditableRows((prev) => {
      const maxIndex = prev.reduce((max, row) => Math.max(max, row.index), -1);
      const nextSetId = selectedSetId || setIdInput || prev[0]?.setId || "";
      const nextSourceUrl = sourceUrlInput.trim() || null;
      return [
        ...prev,
        {
          index: maxIndex + 1,
          setId: nextSetId,
          cardNumber: null,
          parallel: "",
          playerSeed: "",
          listingId: null,
          sourceUrl: nextSourceUrl,
          duplicateKey: `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          errors: [],
          warnings: [],
        },
      ];
    });
  }, [canReview, selectedSetId, setIdInput, sourceUrlInput]);

  const removeDraftRow = useCallback(
    (rowIndex: number) => {
      if (!canReview) return;
      setEditableRows((prev) =>
        prev
          .filter((_, index) => index !== rowIndex)
          .map((row, index) => ({
            ...row,
            index,
          }))
      );
    },
    [canReview]
  );

  const loadAccess = useCallback(async () => {
    if (!session?.token || !isAdmin) return null;
    setAccessBusy(true);
    try {
      const response = await fetch("/api/admin/set-ops/access", {
        headers: adminHeaders,
      });
      const payload = (await response.json().catch(() => ({}))) as AccessResponse;
      if (!response.ok || !("permissions" in payload)) {
        throw new Error("message" in payload ? payload.message : "Failed to load role permissions");
      }
      setPermissions(payload.permissions);
      return payload.permissions;
    } catch (accessError) {
      setPermissions(null);
      setError(accessError instanceof Error ? accessError.message : "Failed to load role permissions");
      return null;
    } finally {
      setAccessBusy(false);
    }
  }, [adminHeaders, isAdmin, session?.token]);

  const fetchIngestionJobs = useCallback(async () => {
    if (!session?.token || !isAdmin || !canReview) return;
    const params = new URLSearchParams({ limit: "120" });
    const response = await fetch(`/api/admin/set-ops/ingestion?${params.toString()}`, {
      headers: adminHeaders,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      jobs?: IngestionJob[];
    };
    if (!response.ok) {
      throw new Error(payload.message ?? "Failed to load ingestion queue");
    }
    const nextJobs = payload.jobs ?? [];
    setIngestionJobs(nextJobs);
    if (selectedJobId && !nextJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId("");
      setSelectedSetId("");
      setLatestVersion(null);
      setVersions([]);
      setEditableRows([]);
      setSeedJobs([]);
    }
  }, [adminHeaders, canReview, isAdmin, selectedJobId, session?.token]);

  const fetchDraft = useCallback(
    async (setId: string, nextDatasetType: DatasetType) => {
      if (!session?.token || !isAdmin || !canReview || !setId) return;
      const params = new URLSearchParams({
        setId,
        datasetType: nextDatasetType,
      });
      const response = await fetch(`/api/admin/set-ops/drafts?${params.toString()}`, {
        headers: adminHeaders,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        versions?: DraftVersion[];
        latestVersion?: (DraftVersion & { rows?: DraftRow[] }) | null;
        latestApprovedVersionId?: string | null;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to load draft workspace");
      }

      setVersions(payload.versions ?? []);
      setLatestVersion(payload.latestVersion ?? null);
      setLatestApprovedVersionId(payload.latestApprovedVersionId ?? null);
      setEditableRows((payload.latestVersion?.rows ?? []) as DraftRow[]);
    },
    [adminHeaders, canReview, isAdmin, session?.token]
  );

  const fetchSeedJobs = useCallback(
    async (setId: string) => {
      if (!session?.token || !isAdmin || !canApprove || !setId) return;
      const params = new URLSearchParams({ setId, limit: "40" });
      const response = await fetch(`/api/admin/set-ops/seed/jobs?${params.toString()}`, {
        headers: adminHeaders,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        jobs?: SeedJob[];
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to load seed jobs");
      }
      setSeedJobs(payload.jobs ?? []);
    },
    [adminHeaders, canApprove, isAdmin, session?.token]
  );

  useEffect(() => {
    if (!session?.token || !isAdmin) return;
    if (autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);
    void loadAccess()
      .then((nextPermissions) => {
        if (!nextPermissions?.reviewer) {
          setIngestionJobs([]);
          setEditableRows([]);
          setVersions([]);
          setLatestVersion(null);
          setLatestApprovedVersionId(null);
          setSeedJobs([]);
          setStatus("Set Ops reviewer role required for ingestion and draft workspace.");
          return Promise.resolve();
        }
        return fetchIngestionJobs().then(() => {
          if (!nextPermissions.approver) {
            setSeedJobs([]);
          }
          setStatus("Loaded ingestion queue.");
        });
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Failed to load data");
      })
      .finally(() => {
        setBusy(false);
      });
  }, [fetchIngestionJobs, isAdmin, loadAccess, session?.token]);

  useEffect(() => {
    const stepFromQuery = parseReviewStep(router.query.step);
    if (!stepFromQuery) return;
    setActiveStep(stepFromQuery);
  }, [router.query.step]);

  const createIngestionJob = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!session?.token || !isAdmin) return;
      if (!canReview) {
        setError("Set Ops reviewer role required");
        return;
      }

      setBusy(true);
      setError(null);
      setStatus(null);

      try {
        const parsedPayload = JSON.parse(rawPayloadInput || "[]");
        const rowCount = estimateRowCount(parsedPayload);
        if (rowCount < 1) {
          throw new Error("No ingestion rows found. Upload a CSV/JSON file first.");
        }
        const sourceProvider = payloadFileName ? "FILE_UPLOAD" : "MANUAL_JSON";

        const datasetPlan = expandDatasetMode(queueDatasetMode);
        const createdJobs: IngestionJob[] = [];

        for (const datasetTypeForImport of datasetPlan) {
          const response = await fetch("/api/admin/set-ops/ingestion", {
            method: "POST",
            headers: {
              ...adminHeaders,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              setId: setIdInput,
              datasetType: datasetTypeForImport,
              sourceUrl: sourceUrlInput || null,
              parserVersion: parserVersionInput || "manual-v1",
              sourceProvider,
              sourceFetchMeta: {
                rowCount,
                fileName: payloadFileName || null,
                importedAt: new Date().toISOString(),
                datasetMode: queueDatasetMode,
              },
              rawPayload: parsedPayload,
            }),
          });
          const payload = (await response.json().catch(() => ({}))) as {
            message?: string;
            job?: IngestionJob;
          };
          if (!response.ok || !payload.job) {
            if (createdJobs.length > 0) {
              setStatus(
                `Queued ${createdJobs.length} of ${datasetPlan.length} ingestion jobs before failure (${createdJobs
                  .map((job) => `${job.datasetType}:${job.id.slice(0, 8)}`)
                  .join(", ")}).`
              );
            }
            throw new Error(payload.message ?? "Failed to enqueue ingestion job");
          }
          createdJobs.push(payload.job);
        }

        const latestJob = createdJobs[createdJobs.length - 1];
        if (latestJob?.id) {
          setSelectedJobId(latestJob.id);
          setDatasetType(latestJob.datasetType as DatasetType);
          setQueueDatasetMode(latestJob.datasetType as CombinedDatasetMode);
          setSetIdInput(latestJob.setId);
          setSourceUrlInput(latestJob.sourceUrl ?? sourceUrlInput);
        }
        if (createdJobs.length === 1) {
          setStatus(`Queued ingestion job ${createdJobs[0]?.id ?? ""}.`);
        } else {
          setStatus(
            `Queued ${createdJobs.length} ingestion jobs (${createdJobs
              .map((job) => `${job.datasetType}:${job.id.slice(0, 8)}`)
              .join(", ")}).`
          );
        }
        await fetchIngestionJobs();
        setActiveStepWithUrl("ingestion-queue");
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : "Failed to enqueue ingestion job");
      } finally {
        setBusy(false);
      }
    },
    [
      adminHeaders,
      fetchIngestionJobs,
      canReview,
      isAdmin,
      parserVersionInput,
      payloadFileName,
      queueDatasetMode,
      rawPayloadInput,
      session?.token,
      setActiveStepWithUrl,
      setIdInput,
      sourceUrlInput,
    ]
  );

  const handlePayloadFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (!canReview) {
        setError("Set Ops reviewer role required");
        return;
      }

      setPayloadLoading(true);
      setError(null);
      setStatus(null);
      try {
        const lowerName = file.name.toLowerCase();
        const isPdf = file.type.toLowerCase().includes("pdf") || lowerName.endsWith(".pdf");
        let rows: Array<Record<string, unknown>> = [];
        let parserName = "";

        if (isPdf) {
          const response = await fetch(`/api/admin/set-ops/discovery/parse-upload?fileName=${encodeURIComponent(file.name)}`, {
            method: "POST",
            headers: {
              ...adminHeaders,
              "Content-Type": "application/octet-stream",
              "X-File-Name": encodeURIComponent(file.name),
            },
            body: await file.arrayBuffer(),
          });
          const payload = (await response.json().catch(() => ({}))) as {
            message?: string;
            rows?: Array<Record<string, unknown>>;
            parserName?: string;
          };
          if (!response.ok) {
            throw new Error(payload.message ?? "Failed to parse uploaded PDF.");
          }
          rows = Array.isArray(payload.rows) ? payload.rows : [];
          parserName = String(payload.parserName || "");
        } else {
          const text = await file.text();
          rows = parseRowsFromFileContent(file.name, text);
        }

        if (rows.length < 1) {
          throw new Error("No rows found in uploaded file.");
        }

        const inferredSetId = inferSetIdFromRows(rows);
        if (!setIdInput.trim() && inferredSetId) {
          setSetIdInput(inferredSetId);
        }

        setRawPayloadInput(JSON.stringify(rows, null, 2));
        setPayloadFileName(file.name);
        setPayloadRowCount(rows.length);
        if (parserName) {
          setStatus(`Loaded ${rows.length} rows from ${file.name} via ${parserName}.`);
        } else {
          setStatus(`Loaded ${rows.length} rows from ${file.name}.`);
        }
      } catch (parseError) {
        setPayloadFileName(null);
        setPayloadRowCount(0);
        setError(parseError instanceof Error ? parseError.message : "Failed to parse uploaded file");
      } finally {
        setPayloadLoading(false);
        event.target.value = "";
      }
    },
    [adminHeaders, canReview, setIdInput]
  );

  const runDiscoverySearch = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!session?.token || !isAdmin) return;
      if (!canReview) {
        setError("Set Ops reviewer role required");
        return;
      }

      setDiscoveryBusy(true);
      setError(null);
      setStatus(null);

      try {
        const params = new URLSearchParams({ limit: "20" });
        if (discoveryYearInput.trim()) params.set("year", discoveryYearInput.trim());
        if (discoveryManufacturerInput.trim()) params.set("manufacturer", discoveryManufacturerInput.trim());
        if (discoverySportInput.trim()) params.set("sport", discoverySportInput.trim());
        if (discoveryQueryInput.trim()) params.set("q", discoveryQueryInput.trim());

        const response = await fetch(`/api/admin/set-ops/discovery/search?${params.toString()}`, {
          headers: adminHeaders,
        });
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          results?: DiscoveryResult[];
          total?: number;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? "Failed to search online set sources");
        }

        const nextResults = payload.results ?? [];
        setDiscoveryResults(nextResults);
        setDiscoverySetIdOverrideInput(discoverySetIdSuggestion || nextResults[0]?.setIdGuess || "");
        setDiscoverySourceUrlInput(nextResults[0]?.url || "");
        setStatus(`Found ${payload.total ?? nextResults.length} source candidates.`);
      } catch (searchError) {
        setDiscoveryResults([]);
        setError(searchError instanceof Error ? searchError.message : "Failed to search online set sources");
      } finally {
        setDiscoveryBusy(false);
      }
    },
    [
      adminHeaders,
      canReview,
      discoveryManufacturerInput,
      discoveryQueryInput,
      discoverySetIdSuggestion,
      discoverySportInput,
      discoveryYearInput,
      isAdmin,
      session?.token,
    ]
  );

  const importDiscoveredResult = useCallback(
    async (result: DiscoveryResult, datasetMode: CombinedDatasetMode) => {
      if (!session?.token || !isAdmin) return;
      if (!canReview) {
        setError("Set Ops reviewer role required");
        return;
      }

      setDiscoveryImportBusyId(result.id);
      setError(null);
      setStatus(null);

      try {
        const datasetPlan = expandDatasetMode(datasetMode);
        const requestedSetId =
          discoverySetIdOverrideInput.trim() || discoverySetIdSuggestion || result.setIdGuess || undefined;
        const importedJobs: IngestionJob[] = [];
        let totalRows = 0;

        for (const datasetTypeForImport of datasetPlan) {
          const response = await fetch("/api/admin/set-ops/discovery/import", {
            method: "POST",
            headers: {
              ...adminHeaders,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              setId: requestedSetId,
              datasetType: datasetTypeForImport,
              sourceUrl: result.url,
              sourceProvider: result.provider,
              sourceTitle: result.title,
              parserVersion: `source-discovery-v1`,
              discoveryQuery: {
                year: discoveryYearInput.trim() || null,
                manufacturer: discoveryManufacturerInput.trim() || null,
                sport: discoverySportInput.trim() || null,
                query: discoveryQueryInput.trim() || null,
                datasetMode,
              },
            }),
          });
          const payload = (await response.json().catch(() => ({}))) as {
            message?: string;
            job?: IngestionJob;
            preview?: { rowCount?: number; setId?: string };
          };
          if (!response.ok || !payload.job) {
            if (importedJobs.length > 0) {
              setStatus(
                `Imported ${importedJobs.length} of ${datasetPlan.length} datasets before failure (${importedJobs
                  .map((job) => `${job.datasetType}:${job.id.slice(0, 8)}`)
                  .join(", ")}).`
              );
            }
            throw new Error(payload.message ?? "Failed to import discovered source");
          }
          importedJobs.push(payload.job);
          totalRows += Number(payload.preview?.rowCount ?? 0);
        }

        await fetchIngestionJobs();
        const latestJob = importedJobs[importedJobs.length - 1];
        if (latestJob) {
          setSelectedJobId(latestJob.id);
          setSelectedSetId(latestJob.setId);
          setDatasetType(latestJob.datasetType as DatasetType);
          setQueueDatasetMode(latestJob.datasetType as CombinedDatasetMode);
          setSetIdInput(latestJob.setId);
          setSourceUrlInput(latestJob.sourceUrl ?? result.url);
          setDiscoverySourceUrlInput(latestJob.sourceUrl ?? result.url);
        }

        if (importedJobs.length === 1) {
          setStatus(
            `Imported ${totalRows.toLocaleString()} rows from ${result.provider} and queued ingestion job ${importedJobs[0]?.id}.`
          );
        } else {
          setStatus(
            `Imported ${totalRows.toLocaleString()} rows from ${result.provider} and queued ${importedJobs.length} jobs (${importedJobs
              .map((job) => `${job.datasetType}:${job.id.slice(0, 8)}`)
              .join(", ")}).`
          );
        }
        setActiveStepWithUrl("ingestion-queue");
      } catch (importError) {
        setError(importError instanceof Error ? importError.message : "Failed to import discovered source");
      } finally {
        setDiscoveryImportBusyId(null);
      }
    },
    [
      adminHeaders,
      canReview,
      discoveryManufacturerInput,
      discoveryQueryInput,
      discoverySetIdOverrideInput,
      discoverySetIdSuggestion,
      discoverySportInput,
      discoveryYearInput,
      fetchIngestionJobs,
      isAdmin,
      session?.token,
      setActiveStepWithUrl,
    ]
  );

  const importDirectSourceUrl = useCallback(
    async (datasetMode: CombinedDatasetMode) => {
      if (!session?.token || !isAdmin) return;
      if (!canReview) {
        setError("Set Ops reviewer role required");
        return;
      }
      const sourceUrl = discoverySourceUrlInput.trim();
      if (!sourceUrl) {
        setError("Paste a source URL before import.");
        return;
      }
      if (!/^https?:\/\//i.test(sourceUrl)) {
        setError("Source URL must start with http:// or https://");
        return;
      }

      const busyId = `direct:${datasetMode}`;
      setDiscoveryImportBusyId(busyId);
      setError(null);
      setStatus(null);

      try {
        const datasetPlan = expandDatasetMode(datasetMode);
        const requestedSetId = discoverySetIdOverrideInput.trim() || discoverySetIdSuggestion || undefined;
        const importedJobs: IngestionJob[] = [];
        let totalRows = 0;

        for (const datasetTypeForImport of datasetPlan) {
          const response = await fetch("/api/admin/set-ops/discovery/import", {
            method: "POST",
            headers: {
              ...adminHeaders,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              setId: requestedSetId,
              datasetType: datasetTypeForImport,
              sourceUrl,
              sourceProvider: "MANUAL_SOURCE_URL",
              sourceTitle: requestedSetId || sourceUrl,
              parserVersion: "source-discovery-v1",
              discoveryQuery: {
                year: discoveryYearInput.trim() || null,
                manufacturer: discoveryManufacturerInput.trim() || null,
                sport: discoverySportInput.trim() || null,
                query: discoveryQueryInput.trim() || null,
                datasetMode,
              },
            }),
          });

          const payload = (await response.json().catch(() => ({}))) as {
            message?: string;
            job?: IngestionJob;
            preview?: { rowCount?: number };
          };
          if (!response.ok || !payload.job) {
            if (importedJobs.length > 0) {
              setStatus(
                `Imported ${importedJobs.length} of ${datasetPlan.length} datasets before failure (${importedJobs
                  .map((job) => `${job.datasetType}:${job.id.slice(0, 8)}`)
                  .join(", ")}).`
              );
            }
            throw new Error(payload.message ?? "Failed to import source URL");
          }
          importedJobs.push(payload.job);
          totalRows += Number(payload.preview?.rowCount ?? 0);
        }

        await fetchIngestionJobs();
        const latestJob = importedJobs[importedJobs.length - 1];
        if (latestJob) {
          setSelectedJobId(latestJob.id);
          setSelectedSetId(latestJob.setId);
          setDatasetType(latestJob.datasetType as DatasetType);
          setQueueDatasetMode(latestJob.datasetType as CombinedDatasetMode);
          setSetIdInput(latestJob.setId);
          setSourceUrlInput(latestJob.sourceUrl ?? sourceUrl);
        }

        if (importedJobs.length === 1) {
          setStatus(
            `Imported ${totalRows.toLocaleString()} rows from direct URL and queued ingestion job ${importedJobs[0]?.id}.`
          );
        } else {
          setStatus(
            `Imported ${totalRows.toLocaleString()} rows from direct URL and queued ${importedJobs.length} jobs (${importedJobs
              .map((job) => `${job.datasetType}:${job.id.slice(0, 8)}`)
              .join(", ")}).`
          );
        }
        setActiveStepWithUrl("ingestion-queue");
      } catch (importError) {
        setError(importError instanceof Error ? importError.message : "Failed to import source URL");
      } finally {
        setDiscoveryImportBusyId(null);
      }
    },
    [
      adminHeaders,
      canReview,
      discoveryManufacturerInput,
      discoveryQueryInput,
      discoverySetIdOverrideInput,
      discoverySetIdSuggestion,
      discoverySourceUrlInput,
      discoverySportInput,
      discoveryYearInput,
      fetchIngestionJobs,
      isAdmin,
      session?.token,
      setActiveStepWithUrl,
    ]
  );

  const buildDraftFromJob = useCallback(async () => {
    if (!session?.token || !isAdmin || !selectedJobId || !selectedJob) return;
    if (!canReview) {
      setError("Set Ops reviewer role required");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch("/api/admin/set-ops/drafts/build", {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ingestionJobId: selectedJobId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        summary?: { rowCount: number; blockingErrorCount: number };
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to build draft");
      }

      setSelectedSetId(selectedJob.setId);
      await fetchDraft(selectedJob.setId, selectedJob.datasetType as DatasetType);
      if (canApprove) {
        await fetchSeedJobs(selectedJob.setId);
      } else {
        setSeedJobs([]);
      }
      await fetchIngestionJobs();
      setStatus(
        `Built draft from ${selectedJobId} (${payload.summary?.rowCount ?? 0} rows, blocking=${payload.summary?.blockingErrorCount ?? 0}).`
      );
      setActiveStepWithUrl("draft-approval");
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Failed to build draft");
    } finally {
      setBusy(false);
    }
  }, [
    adminHeaders,
    fetchDraft,
    fetchIngestionJobs,
    fetchSeedJobs,
    canApprove,
    canReview,
    isAdmin,
    selectedJob,
    selectedJobId,
    session?.token,
    setActiveStepWithUrl,
  ]);

  const saveDraftVersion = useCallback(async () => {
    if (!session?.token || !isAdmin || !selectedSetId) return;
    if (!canReview) {
      setError("Set Ops reviewer role required");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch("/api/admin/set-ops/drafts/version", {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          setId: selectedSetId,
          datasetType,
          rows: editableRows.map((row) => ({
            setId: row.setId,
            cardNumber: row.cardNumber,
            parallel: row.parallel,
            playerSeed: row.playerSeed,
            listingId: row.listingId,
            sourceUrl: row.sourceUrl,
          })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        summary?: { rowCount: number; blockingErrorCount: number };
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to save draft version");
      }

      await fetchDraft(selectedSetId, datasetType);
      setStatus(
        `Saved new draft version (${payload.summary?.rowCount ?? 0} rows, blocking=${payload.summary?.blockingErrorCount ?? 0}).`
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save draft version");
    } finally {
      setBusy(false);
    }
  }, [adminHeaders, canReview, datasetType, editableRows, fetchDraft, isAdmin, selectedSetId, session?.token]);

  const applyApproval = useCallback(
    async (decision: "APPROVED" | "REJECTED") => {
      if (!session?.token || !isAdmin || !selectedSetId || !latestVersion?.id) return;
      if (!canApprove) {
        setError("Set Ops approver role required");
        return;
      }

      setBusy(true);
      setError(null);
      setStatus(null);

      try {
        const response = await fetch("/api/admin/set-ops/approval", {
          method: "POST",
          headers: {
            ...adminHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            setId: selectedSetId,
            draftVersionId: latestVersion.id,
            decision,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          diffSummary?: { added: number; removed: number; changed: number; unchanged: number };
          blockingErrorCount?: number;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? "Approval request failed");
        }

        await fetchDraft(selectedSetId, datasetType);
        await fetchIngestionJobs();
        setStatus(
          `${decision} complete (blocking=${payload.blockingErrorCount ?? 0}, added=${payload.diffSummary?.added ?? 0}, changed=${payload.diffSummary?.changed ?? 0}).`
        );
        if (decision === "APPROVED") {
          setActiveStepWithUrl("seed-monitor");
        }
      } catch (approvalError) {
        setError(approvalError instanceof Error ? approvalError.message : "Approval request failed");
      } finally {
        setBusy(false);
      }
    },
    [
      adminHeaders,
      canApprove,
      datasetType,
      fetchDraft,
      fetchIngestionJobs,
      isAdmin,
      latestVersion?.id,
      selectedSetId,
      session?.token,
      setActiveStepWithUrl,
    ]
  );

  const startSeedRun = useCallback(async () => {
    if (!session?.token || !isAdmin || !selectedSetId) return;
    if (!canApprove) {
      setError("Set Ops approver role required");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      const response = await fetch("/api/admin/set-ops/seed/jobs", {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          setId: selectedSetId,
          draftVersionId: latestApprovedVersionId ?? latestVersion?.id,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        job?: SeedJob;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to start seed run");
      }

      await fetchSeedJobs(selectedSetId);
      setStatus(`Seed run ${payload.job?.id ?? ""} started.`);
    } catch (seedError) {
      setError(seedError instanceof Error ? seedError.message : "Failed to start seed run");
    } finally {
      setBusy(false);
    }
  }, [
    adminHeaders,
    canApprove,
    fetchSeedJobs,
    isAdmin,
    latestApprovedVersionId,
    latestVersion?.id,
    selectedSetId,
    session?.token,
  ]);

  const runSeedAction = useCallback(
    async (jobId: string, action: "cancel" | "retry") => {
      if (!session?.token || !isAdmin || !selectedSetId) return;
      if (!canApprove) {
        setError("Set Ops approver role required");
        return;
      }

      setBusy(true);
      setError(null);
      setStatus(null);

      try {
        const response = await fetch(`/api/admin/set-ops/seed/jobs/${encodeURIComponent(jobId)}/${action}`, {
          method: "POST",
          headers: {
            ...adminHeaders,
          },
        });
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          job?: { id: string; status: string };
        };
        if (!response.ok) {
          throw new Error(payload.message ?? `Failed to ${action} seed job`);
        }

        await fetchSeedJobs(selectedSetId);
        setStatus(`${action === "cancel" ? "Cancelled" : "Retried"} seed job ${payload.job?.id ?? jobId}.`);
      } catch (seedActionError) {
        setError(seedActionError instanceof Error ? seedActionError.message : `Failed to ${action} seed job`);
      } finally {
        setBusy(false);
      }
    },
    [adminHeaders, canApprove, fetchSeedJobs, isAdmin, selectedSetId, session?.token]
  );

  const showMissingConfig =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_ADMIN_USER_IDS === undefined &&
    process.env.NEXT_PUBLIC_ADMIN_PHONES === undefined;

  const renderGate = () => {
    if (loading) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Checking access…</p>
        </div>
      );
    }

    if (!session) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <p className="max-w-md text-sm text-slate-400">
            Use your Ten Kings phone number. Only approved operators will gain entry to the processing console.
          </p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
          {showMissingConfig && (
            <p className="mt-6 max-w-md text-xs text-rose-300/80">
              Set <code className="font-mono">NEXT_PUBLIC_ADMIN_USER_IDS</code> or{" "}
              <code className="font-mono">NEXT_PUBLIC_ADMIN_PHONES</code> to authorize operators.
            </p>
          )}
        </div>
      );
    }

    if (!isAdmin) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
          <p className="max-w-md text-sm text-slate-400">
            This console is restricted to Ten Kings operators. Contact an administrator if you need elevated permissions.
          </p>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-8 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
          >
            Sign Out
          </button>
        </div>
      );
    }

    return null;
  };

  const gate = renderGate();
  if (gate) {
    return (
      <AppShell>
        <Head>
          <title>Ten Kings · Set Ops Review</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Set Ops Review</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex flex-1 flex-col gap-8 px-6 py-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-violet-300">Set Ops</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Ingest & Draft Workspace</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            Guided stepper flow: source intake, ingestion queue, draft approval, then seed monitor. Existing APIs/actions are unchanged.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em]">
            <span className={`rounded-full border px-2 py-1 ${canReview ? "border-emerald-400/50 text-emerald-200" : "border-white/20 text-slate-400"}`}>
              reviewer: {canReview ? "yes" : "no"}
            </span>
            <span className={`rounded-full border px-2 py-1 ${canApprove ? "border-emerald-400/50 text-emerald-200" : "border-white/20 text-slate-400"}`}>
              approver: {canApprove ? "yes" : "no"}
            </span>
            {accessBusy && <span className="text-slate-400">loading roles...</span>}
          </div>
          <div className="flex flex-wrap gap-4">
            <Link
              className="inline-flex text-xs uppercase tracking-[0.28em] text-slate-400 transition hover:text-white"
              href="/admin/set-ops"
            >
              ← Back to Set Admin
            </Link>
            <button
              type="button"
              disabled={busy || accessBusy}
              onClick={() => {
                setBusy(true);
                setError(null);
                setStatus(null);
                void Promise.all([
                  canReview ? fetchIngestionJobs() : Promise.resolve(),
                  canReview && selectedSetId ? fetchDraft(selectedSetId, datasetType) : Promise.resolve(),
                  canApprove && selectedSetId ? fetchSeedJobs(selectedSetId) : Promise.resolve(),
                ])
                  .then(() => setStatus("Workspace refreshed."))
                  .catch((refreshError) =>
                    setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh workspace")
                  )
                  .finally(() => setBusy(false));
              }}
              className="inline-flex rounded-lg border border-white/20 px-3 py-2 text-xs uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
        </header>

        {status && <p className="text-xs text-emerald-300">{status}</p>}
        {error && <p className="text-xs text-rose-300">{error}</p>}

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {REVIEW_STEPS.map((step, index) => {
              const isActive = step.id === activeStep;
              const isComplete = stepCompletion[step.id];
              const isPast = activeStepIndex > index;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActiveStepWithUrl(step.id)}
                  className={`rounded-2xl border p-3 text-left transition ${
                    isActive
                      ? "border-gold-500/60 bg-gold-500/15"
                      : isComplete || isPast
                        ? "border-emerald-400/40 bg-emerald-500/10 hover:border-emerald-300/60"
                        : "border-white/15 bg-night-950/50 hover:border-white/35"
                  }`}
                >
                  <p className="text-[10px] uppercase tracking-[0.24em] text-slate-300">Step {index + 1}</p>
                  <p className="mt-1 text-sm font-semibold uppercase tracking-[0.12em] text-white">{step.label}</p>
                  <p className="mt-1 text-xs text-slate-300">{step.description}</p>
                  <p
                    className={`mt-2 text-[10px] uppercase tracking-[0.18em] ${
                      isActive ? "text-gold-100" : isComplete ? "text-emerald-200" : "text-slate-400"
                    }`}
                  >
                    {isActive ? "Open" : isComplete ? "Complete" : "Pending"}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">1. Source Intake</h2>
              <p className="mt-1 text-xs text-slate-400">
                Search the web by year/manufacturer/sport, then import a discovered source directly into ingestion queue.
              </p>
            </div>
            {activeStep !== "source-intake" && (
              <button
                type="button"
                onClick={() => setActiveStepWithUrl("source-intake")}
                className="rounded-lg border border-white/20 px-3 py-2 text-xs uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40"
              >
                Open Step
              </button>
            )}
          </div>
          {activeStep === "source-intake" ? (
            <>
          <form className="mt-4 grid gap-3 md:grid-cols-4" onSubmit={runDiscoverySearch}>
            <input
              value={discoveryYearInput}
              onChange={(event) => setDiscoveryYearInput(event.target.value)}
              disabled={!canReview || discoveryBusy}
              placeholder="Year (ex: 2020)"
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
            />
            <input
              value={discoveryManufacturerInput}
              onChange={(event) => setDiscoveryManufacturerInput(event.target.value)}
              disabled={!canReview || discoveryBusy}
              placeholder="Manufacturer (ex: Panini)"
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
            />
            <input
              value={discoverySportInput}
              onChange={(event) => setDiscoverySportInput(event.target.value)}
              disabled={!canReview || discoveryBusy}
              placeholder="Sport (ex: Baseball)"
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
            />
            <input
              value={discoveryQueryInput}
              onChange={(event) => setDiscoveryQueryInput(event.target.value)}
              disabled={!canReview || discoveryBusy}
              placeholder="Extra query (optional)"
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
            />
            <button
              type="submit"
              disabled={!canReview || discoveryBusy}
              className="h-11 rounded-xl border border-sky-400/60 bg-sky-500/20 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100 transition hover:bg-sky-500/30 disabled:opacity-60"
            >
              {discoveryBusy ? "Searching..." : "Search Sources"}
            </button>
          </form>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <input
              value={discoverySetIdOverrideInput}
              onChange={(event) => setDiscoverySetIdOverrideInput(event.target.value)}
              disabled={!canReview || discoveryBusy}
              placeholder={
                discoverySetIdSuggestion
                  ? `Set ID override (optional). Suggested: ${discoverySetIdSuggestion}`
                  : "Set ID override (optional)"
              }
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70 md:col-span-2"
            />
            <input
              value={discoverySourceUrlInput}
              onChange={(event) => setDiscoverySourceUrlInput(event.target.value)}
              disabled={!canReview || discoveryBusy}
              placeholder="Paste exact checklist/source URL here for direct import"
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70 md:col-span-2"
            />
            <button
              type="button"
              disabled={busy || !canReview || Boolean(discoveryImportBusyId?.startsWith("direct:")) || !discoverySourceUrlInput.trim()}
              onClick={() => void importDirectSourceUrl("PARALLEL_DB")}
              className="h-11 rounded-xl border border-violet-400/50 bg-violet-500/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-60"
            >
              {discoveryImportBusyId === "direct:PARALLEL_DB" ? "Importing..." : "Import URL as ODDS LIST"}
            </button>
            <button
              type="button"
              disabled={busy || !canReview || Boolean(discoveryImportBusyId?.startsWith("direct:")) || !discoverySourceUrlInput.trim()}
              onClick={() => void importDirectSourceUrl("PLAYER_WORKSHEET")}
              className="h-11 rounded-xl border border-gold-500/50 bg-gold-500/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-gold-100 transition hover:bg-gold-500/30 disabled:opacity-60"
            >
              {discoveryImportBusyId === "direct:PLAYER_WORKSHEET" ? "Importing..." : "Import URL as SET CHECKLIST"}
            </button>
            <button
              type="button"
              disabled={busy || !canReview || Boolean(discoveryImportBusyId?.startsWith("direct:")) || !discoverySourceUrlInput.trim()}
              onClick={() => void importDirectSourceUrl("COMBINED")}
              className="h-11 rounded-xl border border-emerald-500/50 bg-emerald-500/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-60"
            >
              {discoveryImportBusyId === "direct:COMBINED" ? "Importing..." : "Import URL as SET CHECKLIST + ODDS LIST"}
            </button>
            <button
              type="button"
              disabled={!canReview}
              onClick={() => {
                setDiscoverySetIdOverrideInput(discoverySetIdSuggestion);
                setStatus(discoverySetIdSuggestion ? `Set ID override set to ${discoverySetIdSuggestion}.` : "Set ID override cleared.");
              }}
              className="h-11 rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40 disabled:opacity-60"
            >
              Use Suggested Set ID
            </button>
            <button
              type="button"
              disabled={!canReview}
              onClick={() => {
                setDiscoverySetIdOverrideInput("");
                setDiscoverySourceUrlInput("");
              }}
              className="h-11 rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40 disabled:opacity-60"
            >
              Clear URL/Override
            </button>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm text-slate-200">
              <thead>
                <tr>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Provider</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Title</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Set Guess</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Source</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Import</th>
                </tr>
              </thead>
              <tbody>
                {discoveryResults.map((result) => (
                  <tr key={result.id}>
                    <td className="border-b border-white/5 px-2 py-2 text-xs">{result.provider}</td>
                    <td className="border-b border-white/5 px-2 py-2">
                      <p className="font-medium text-white">{result.title}</p>
                    </td>
                    <td className="border-b border-white/5 px-2 py-2 text-xs">{result.setIdGuess || "-"}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-xs">
                      <a href={result.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:text-sky-200">
                        Open Source
                      </a>
                    </td>
                    <td className="border-b border-white/5 px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!canReview}
                          onClick={() => {
                            setDiscoverySourceUrlInput(result.url);
                            if (!discoverySetIdOverrideInput.trim() && result.setIdGuess) {
                              setDiscoverySetIdOverrideInput(result.setIdGuess);
                            }
                            setStatus("Loaded source URL into direct import box. You can edit it before importing.");
                          }}
                          className="rounded border border-white/30 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-100 disabled:opacity-60"
                        >
                          Use URL
                        </button>
                        <button
                          type="button"
                          disabled={busy || !canReview || discoveryImportBusyId === result.id}
                          onClick={() => void importDiscoveredResult(result, "PARALLEL_DB")}
                          className="rounded border border-violet-400/50 bg-violet-500/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-violet-100 disabled:opacity-60"
                        >
                          {discoveryImportBusyId === result.id ? "Importing..." : "Import ODDS LIST"}
                        </button>
                        <button
                          type="button"
                          disabled={busy || !canReview || discoveryImportBusyId === result.id}
                          onClick={() => void importDiscoveredResult(result, "PLAYER_WORKSHEET")}
                          className="rounded border border-gold-500/50 bg-gold-500/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-gold-100 disabled:opacity-60"
                        >
                          {discoveryImportBusyId === result.id ? "Importing..." : "Import SET CHECKLIST"}
                        </button>
                        <button
                          type="button"
                          disabled={busy || !canReview || discoveryImportBusyId === result.id}
                          onClick={() => void importDiscoveredResult(result, "COMBINED")}
                          className="rounded border border-emerald-500/50 bg-emerald-500/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-emerald-100 disabled:opacity-60"
                        >
                          {discoveryImportBusyId === result.id ? "Importing..." : "Import SET CHECKLIST + ODDS LIST"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {discoveryResults.length === 0 && !discoveryBusy && (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-sm text-slate-400">
                      No source candidates yet. Run a discovery search above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setActiveStepWithUrl("ingestion-queue")}
              className="h-10 rounded-xl border border-gold-500/50 bg-gold-500/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-gold-100 transition hover:bg-gold-500/30"
            >
              Continue to Step 2
            </button>
          </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-400">Step collapsed. Reopen to run discovery and source imports.</p>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">2. Ingestion Queue</h2>
              <p className="mt-1 text-xs text-slate-400">Queue/import jobs, choose a job, then build draft from the selected row.</p>
            </div>
            {activeStep !== "ingestion-queue" && (
              <button
                type="button"
                onClick={() => setActiveStepWithUrl("ingestion-queue")}
                className="rounded-lg border border-white/20 px-3 py-2 text-xs uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40"
              >
                Open Step
              </button>
            )}
          </div>
          {activeStep === "ingestion-queue" ? (
            <>
          <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={createIngestionJob}>
            <input
              value={setIdInput}
              onChange={(event) => setSetIdInput(event.target.value)}
              disabled={!canReview}
              placeholder="Set ID"
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
            />
            <select
              value={queueDatasetMode}
              onChange={(event) => setQueueDatasetMode(event.target.value as CombinedDatasetMode)}
              disabled={!canReview}
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
            >
              <option value="PARALLEL_DB">ODDS LIST</option>
              <option value="PLAYER_WORKSHEET">SET CHECKLIST</option>
              <option value="COMBINED">SET CHECKLIST + ODDS LIST</option>
            </select>
            <input
              value={sourceUrlInput}
              onChange={(event) => setSourceUrlInput(event.target.value)}
              disabled={!canReview}
              placeholder="Source URL (optional)"
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
            />
            <input
              value={parserVersionInput}
              onChange={(event) => setParserVersionInput(event.target.value)}
              disabled={!canReview}
              placeholder="Parser version"
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
            />
            <div className="md:col-span-2 rounded-xl border border-white/10 bg-night-950/40 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-300">Upload Source File</p>
              <p className="mt-1 text-xs text-slate-400">
                Upload CSV/JSON/PDF checklist files. No manual JSON editing required.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept=".csv,.json,.pdf,text/csv,application/json,application/pdf"
                  disabled={!canReview || payloadLoading}
                  onChange={(event) => void handlePayloadFileChange(event)}
                  className="block text-xs text-slate-200 file:mr-3 file:rounded-lg file:border file:border-gold-500/40 file:bg-gold-500/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-[0.16em] file:text-gold-100 hover:file:bg-gold-500/20"
                />
                {payloadLoading && <p className="text-xs text-slate-400">Parsing upload...</p>}
                {payloadFileName && !payloadLoading && (
                  <p className="text-xs text-emerald-300">
                    Loaded {payloadRowCount.toLocaleString()} rows from {payloadFileName}
                  </p>
                )}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowRawPayloadEditor((prev) => !prev)}
                  disabled={!canReview}
                  className="rounded-lg border border-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-white/40 disabled:opacity-60"
                >
                  {showRawPayloadEditor ? "Hide Advanced JSON" : "Show Advanced JSON"}
                </button>
              </div>
              {showRawPayloadEditor && (
                <textarea
                  value={rawPayloadInput}
                  onChange={(event) => setRawPayloadInput(event.target.value)}
                  disabled={!canReview}
                  rows={7}
                  className="mt-3 w-full rounded-xl border border-white/15 bg-night-950/70 p-3 font-mono text-xs text-slate-100 outline-none focus:border-gold-500/70"
                />
              )}
            </div>
            <button
              type="submit"
              disabled={busy || !canReview || payloadLoading}
              className="h-11 rounded-xl border border-gold-500/60 bg-gold-500 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-night-900 transition hover:bg-gold-400 disabled:opacity-60"
            >
              {payloadLoading ? "Parsing..." : `Queue ${formatDatasetMode(queueDatasetMode)}`}
            </button>
          </form>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm text-slate-200">
              <thead>
                <tr>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Job</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Set</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Type</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Provider</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Status</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Created</th>
                </tr>
              </thead>
              <tbody>
                {ingestionJobs.map((job) => (
                  <tr
                    key={job.id}
                    className={`${canReview ? "cursor-pointer transition" : ""} ${selectedJobId === job.id ? "bg-violet-500/10" : "hover:bg-white/5"}`}
                    onClick={() => {
                      if (!canReview) return;
                      setSelectedJobId(job.id);
                      setSelectedSetId(job.setId);
                      setDatasetType(job.datasetType as DatasetType);
                      setQueueDatasetMode(job.datasetType as CombinedDatasetMode);
                      setSetIdInput(job.setId);
                      setSourceUrlInput(job.sourceUrl ?? "");
                    }}
                  >
                    <td className="border-b border-white/5 px-2 py-2 font-mono text-xs">{job.id.slice(0, 8)}</td>
                    <td className="border-b border-white/5 px-2 py-2">{job.setId}</td>
                    <td className="border-b border-white/5 px-2 py-2">{formatDatasetTypeValue(job.datasetType)}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-xs">{job.sourceProvider ?? "-"}</td>
                    <td className="border-b border-white/5 px-2 py-2">{job.status}</td>
                    <td className="border-b border-white/5 px-2 py-2 text-xs text-slate-400">{formatDate(job.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || !canReview || !selectedJobId}
              onClick={() => void buildDraftFromJob()}
              className="h-10 rounded-xl border border-violet-400/50 bg-violet-500/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-violet-100 transition hover:bg-violet-500/30 disabled:opacity-60"
            >
              Build Draft From Selected Job
            </button>
            <button
              type="button"
              disabled={busy || !canReview || !selectedJobId}
              onClick={() => {
                setSelectedJobId("");
                setSelectedSetId("");
                setVersions([]);
                setLatestVersion(null);
                setLatestApprovedVersionId(null);
                setEditableRows([]);
                setSeedJobs([]);
                setStatus("Cleared selected ingestion job.");
              }}
              className="h-10 rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40 disabled:opacity-60"
            >
              Clear Selected Job
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setActiveStepWithUrl("draft-approval")}
              disabled={!selectedSetId}
              className="h-10 rounded-xl border border-gold-500/50 bg-gold-500/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-gold-100 transition hover:bg-gold-500/30 disabled:opacity-60"
            >
              Continue to Step 3
            </button>
          </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-400">Step collapsed. Reopen to queue rows and build a draft version.</p>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">3. Draft & Approval</h2>
              <p className="mt-1 text-xs text-slate-400">Selected set: {selectedSetId || "-"}</p>
              <p className="mt-1 text-xs text-slate-400">Blocking errors: {blockingErrorCount}</p>
            </div>
            {activeStep !== "draft-approval" && (
              <button
                type="button"
                onClick={() => setActiveStepWithUrl("draft-approval")}
                className="rounded-lg border border-white/20 px-3 py-2 text-xs uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40"
              >
                Open Step
              </button>
            )}
          </div>
          {activeStep === "draft-approval" ? (
            <>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || !canReview || !selectedSetId}
              onClick={() => void fetchDraft(selectedSetId, datasetType)}
              className="h-10 rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40 disabled:opacity-60"
            >
              Reload Draft
            </button>
            <button
              type="button"
              disabled={busy || !canReview || !selectedSetId}
              onClick={() => void saveDraftVersion()}
              className="h-10 rounded-xl border border-gold-500/60 bg-gold-500 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-night-900 transition hover:bg-gold-400 disabled:opacity-60"
            >
              Save New Draft Version
            </button>
            <button
              type="button"
              disabled={busy || !canReview || !selectedSetId}
              onClick={addDraftRow}
              className="h-10 rounded-xl border border-sky-300/40 bg-sky-400/10 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-sky-100 transition hover:bg-sky-400/20 disabled:opacity-60"
            >
              Add Row
            </button>
            <button
              type="button"
              disabled={busy || !canApprove || !selectedSetId || !latestVersion?.id || blockingErrorCount > 0}
              onClick={() => void applyApproval("APPROVED")}
              className="h-10 rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-emerald-500/30 disabled:opacity-60"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy || !canApprove || !selectedSetId || !latestVersion?.id}
              onClick={() => void applyApproval("REJECTED")}
              className="h-10 rounded-xl border border-rose-400/50 bg-rose-500/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-rose-100 transition hover:bg-rose-500/30 disabled:opacity-60"
            >
              Reject
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-night-950/40 p-3 text-xs text-slate-300">
            <p>Latest version: {latestVersion ? `v${latestVersion.version} (${latestVersion.id.slice(0, 8)})` : "-"}</p>
            <p>Latest approved version id: {latestApprovedVersionId ?? "-"}</p>
            <p>Total versions: {versions.length}</p>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-xs text-slate-200">
              <thead>
                <tr>
                  <th className="border-b border-white/10 px-2 py-2">#</th>
                  <th className="border-b border-white/10 px-2 py-2">Card #</th>
                  <th className="border-b border-white/10 px-2 py-2">Parallel</th>
                  <th className="border-b border-white/10 px-2 py-2">Player Seed</th>
                  <th className="border-b border-white/10 px-2 py-2">Listing ID</th>
                  <th className="border-b border-white/10 px-2 py-2">Source URL</th>
                  <th className="border-b border-white/10 px-2 py-2">Issues</th>
                  <th className="border-b border-white/10 px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {editableRows.map((row, rowIndex) => (
                  <tr key={`${row.duplicateKey}-${row.index}`}>
                    <td className="border-b border-white/5 px-2 py-2">{row.index + 1}</td>
                    <td className="border-b border-white/5 px-2 py-2">
                      <input
                        value={row.cardNumber ?? ""}
                        onChange={(event) => {
                          const next = event.target.value;
                          setEditableRows((prev) => {
                            const copy = [...prev];
                            copy[rowIndex] = { ...copy[rowIndex], cardNumber: next || null };
                            return copy;
                          });
                        }}
                        disabled={!canReview}
                        className="h-8 w-24 rounded border border-white/15 bg-night-950/70 px-2 text-xs text-white outline-none"
                      />
                    </td>
                    <td className="border-b border-white/5 px-2 py-2">
                      <input
                        value={row.parallel ?? ""}
                        onChange={(event) => {
                          const next = event.target.value;
                          setEditableRows((prev) => {
                            const copy = [...prev];
                            copy[rowIndex] = { ...copy[rowIndex], parallel: next };
                            return copy;
                          });
                        }}
                        disabled={!canReview}
                        className="h-8 w-48 rounded border border-white/15 bg-night-950/70 px-2 text-xs text-white outline-none"
                      />
                    </td>
                    <td className="border-b border-white/5 px-2 py-2">
                      <input
                        value={row.playerSeed ?? ""}
                        onChange={(event) => {
                          const next = event.target.value;
                          setEditableRows((prev) => {
                            const copy = [...prev];
                            copy[rowIndex] = { ...copy[rowIndex], playerSeed: next };
                            return copy;
                          });
                        }}
                        disabled={!canReview}
                        className="h-8 w-40 rounded border border-white/15 bg-night-950/70 px-2 text-xs text-white outline-none"
                      />
                    </td>
                    <td className="border-b border-white/5 px-2 py-2">
                      <input
                        value={row.listingId ?? ""}
                        onChange={(event) => {
                          const next = event.target.value;
                          setEditableRows((prev) => {
                            const copy = [...prev];
                            copy[rowIndex] = { ...copy[rowIndex], listingId: next || null };
                            return copy;
                          });
                        }}
                        disabled={!canReview}
                        className="h-8 w-36 rounded border border-white/15 bg-night-950/70 px-2 text-xs text-white outline-none"
                      />
                    </td>
                    <td className="border-b border-white/5 px-2 py-2">
                      <input
                        value={row.sourceUrl ?? ""}
                        onChange={(event) => {
                          const next = event.target.value;
                          setEditableRows((prev) => {
                            const copy = [...prev];
                            copy[rowIndex] = { ...copy[rowIndex], sourceUrl: next || null };
                            return copy;
                          });
                        }}
                        disabled={!canReview}
                        className="h-8 w-56 rounded border border-white/15 bg-night-950/70 px-2 text-xs text-white outline-none"
                      />
                    </td>
                    <td className="border-b border-white/5 px-2 py-2 text-[11px]">
                      {row.errors.length > 0 && (
                        <p className="text-rose-300">{row.errors.filter((issue) => issue.blocking).length} blocking errors</p>
                      )}
                      {row.warnings.length > 0 && <p className="text-amber-300">{row.warnings.length} warnings</p>}
                      {row.errors.length === 0 && row.warnings.length === 0 && <p className="text-emerald-300">OK</p>}
                    </td>
                    <td className="border-b border-white/5 px-2 py-2">
                      <button
                        type="button"
                        onClick={() => removeDraftRow(rowIndex)}
                        disabled={!canReview}
                        className="h-8 rounded border border-rose-300/30 bg-rose-500/10 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {editableRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-2 py-6 text-center text-sm text-slate-400">
                      No draft rows loaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setActiveStepWithUrl("seed-monitor")}
              disabled={!selectedSetId}
              className="h-10 rounded-xl border border-gold-500/50 bg-gold-500/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-gold-100 transition hover:bg-gold-500/30 disabled:opacity-60"
            >
              Continue to Step 4
            </button>
          </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-400">Step collapsed. Reopen to edit rows and run approval actions.</p>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">4. Seed Monitor</h2>
              <p className="mt-1 text-xs text-slate-400">Start and monitor seed jobs for the selected set.</p>
            </div>
            {activeStep !== "seed-monitor" && (
              <button
                type="button"
                onClick={() => setActiveStepWithUrl("seed-monitor")}
                className="rounded-lg border border-white/20 px-3 py-2 text-xs uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40"
              >
                Open Step
              </button>
            )}
          </div>
          {activeStep === "seed-monitor" ? (
            <>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || !canApprove || !selectedSetId}
              onClick={() => void startSeedRun()}
              className="h-10 rounded-xl border border-sky-400/50 bg-sky-500/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-sky-100 transition hover:bg-sky-500/30 disabled:opacity-60"
            >
              Start Seed Run
            </button>
            <button
              type="button"
              disabled={busy || !canApprove || !selectedSetId}
              onClick={() => void fetchSeedJobs(selectedSetId)}
              className="h-10 rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40 disabled:opacity-60"
            >
              Refresh Seed Jobs
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-xs text-slate-200">
              <thead>
                <tr>
                  <th className="border-b border-white/10 px-2 py-2">Job</th>
                  <th className="border-b border-white/10 px-2 py-2">Status</th>
                  <th className="border-b border-white/10 px-2 py-2">Progress</th>
                  <th className="border-b border-white/10 px-2 py-2">Queue</th>
                  <th className="border-b border-white/10 px-2 py-2">Created</th>
                  <th className="border-b border-white/10 px-2 py-2">Completed</th>
                  <th className="border-b border-white/10 px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {seedJobs.map((job) => (
                  <tr key={job.id}>
                    <td className="border-b border-white/5 px-2 py-2 font-mono text-[11px]">{job.id.slice(0, 8)}</td>
                    <td className="border-b border-white/5 px-2 py-2">{job.status}</td>
                    <td className="border-b border-white/5 px-2 py-2">{toJsonPreview(job.progress)}</td>
                    <td className="border-b border-white/5 px-2 py-2">{job.queueCount ?? "-"}</td>
                    <td className="border-b border-white/5 px-2 py-2">{formatDate(job.createdAt)}</td>
                    <td className="border-b border-white/5 px-2 py-2">{formatDate(job.completedAt)}</td>
                    <td className="border-b border-white/5 px-2 py-2">
                      <div className="flex gap-2">
                        {(job.status === "QUEUED" || job.status === "IN_PROGRESS") && (
                          <button
                            type="button"
                            disabled={busy || !canApprove}
                            onClick={() => void runSeedAction(job.id, "cancel")}
                            className="rounded border border-amber-400/50 bg-amber-500/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-amber-100 disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        )}
                        {(job.status === "FAILED" || job.status === "CANCELLED") && (
                          <button
                            type="button"
                            disabled={busy || !canApprove}
                            onClick={() => void runSeedAction(job.id, "retry")}
                            className="rounded border border-violet-400/50 bg-violet-500/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-violet-100 disabled:opacity-60"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {seedJobs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-sm text-slate-400">
                      No seed jobs for selected set.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-400">Step collapsed. Reopen to run and monitor seed jobs.</p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
