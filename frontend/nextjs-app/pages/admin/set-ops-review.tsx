import Head from "next/head";
import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type DatasetType = "PARALLEL_DB" | "PLAYER_WORKSHEET";

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
  throw new Error("No usable rows found. Upload a CSV with headers or a JSON row array.");
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

export default function SetOpsReviewPage() {
  const { session, loading, ensureSession, logout } = useSession();
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);
  const autoLoadedRef = useRef(false);

  const [datasetType, setDatasetType] = useState<DatasetType>("PARALLEL_DB");
  const [setIdInput, setSetIdInput] = useState("");
  const [sourceUrlInput, setSourceUrlInput] = useState("");
  const [parserVersionInput, setParserVersionInput] = useState("manual-v1");
  const [rawPayloadInput, setRawPayloadInput] = useState("[]");
  const [showRawPayloadEditor, setShowRawPayloadEditor] = useState(false);
  const [payloadFileName, setPayloadFileName] = useState<string | null>(null);
  const [payloadRowCount, setPayloadRowCount] = useState<number>(0);
  const [payloadLoading, setPayloadLoading] = useState(false);

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

  const selectedJob = useMemo(
    () => ingestionJobs.find((job) => job.id === selectedJobId) ?? null,
    [ingestionJobs, selectedJobId]
  );
  const canReview = Boolean(permissions?.reviewer);
  const canApprove = Boolean(permissions?.approver);

  const blockingErrorCount = useMemo(
    () => editableRows.flatMap((row) => row.errors).filter((issue) => issue.blocking).length,
    [editableRows]
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
    setIngestionJobs(payload.jobs ?? []);
  }, [adminHeaders, canReview, isAdmin, session?.token]);

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

        const response = await fetch("/api/admin/set-ops/ingestion", {
          method: "POST",
          headers: {
            ...adminHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            setId: setIdInput,
            datasetType,
            sourceUrl: sourceUrlInput || null,
            parserVersion: parserVersionInput || "manual-v1",
            rawPayload: parsedPayload,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          job?: IngestionJob;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? "Failed to enqueue ingestion job");
        }

        setStatus(`Queued ingestion job ${payload.job?.id ?? ""}.`);
        if (payload.job?.id) {
          setSelectedJobId(payload.job.id);
        }
        await fetchIngestionJobs();
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : "Failed to enqueue ingestion job");
      } finally {
        setBusy(false);
      }
    },
    [
      adminHeaders,
      datasetType,
      fetchIngestionJobs,
      canReview,
      isAdmin,
      parserVersionInput,
      rawPayloadInput,
      session?.token,
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
        const text = await file.text();
        const rows = parseRowsFromFileContent(file.name, text);
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
        setStatus(`Loaded ${rows.length} rows from ${file.name}.`);
      } catch (parseError) {
        setPayloadFileName(null);
        setPayloadRowCount(0);
        setError(parseError instanceof Error ? parseError.message : "Failed to parse uploaded file");
      } finally {
        setPayloadLoading(false);
        event.target.value = "";
      }
    },
    [canReview, setIdInput]
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
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Human Review Workspace</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            Ingest datasets, build normalized draft versions, edit rows, approve/reject, and run monitored seed jobs from the UI.
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
          <h2 className="text-lg font-semibold text-white">1. Ingestion Queue</h2>
          <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={createIngestionJob}>
            <input
              value={setIdInput}
              onChange={(event) => setSetIdInput(event.target.value)}
              disabled={!canReview}
              placeholder="Set ID"
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
            />
            <select
              value={datasetType}
              onChange={(event) => setDatasetType(event.target.value as DatasetType)}
              disabled={!canReview}
              className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
            >
              <option value="PARALLEL_DB">parallel_db</option>
              <option value="PLAYER_WORKSHEET">player_worksheet</option>
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
                Upload a CSV or JSON file with rows. No manual JSON editing required.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
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
              {payloadLoading ? "Parsing..." : "Queue Ingestion"}
            </button>
          </form>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm text-slate-200">
              <thead>
                <tr>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Job</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Set</th>
                  <th className="border-b border-white/10 px-2 py-2 text-slate-300">Type</th>
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
                    }}
                  >
                    <td className="border-b border-white/5 px-2 py-2 font-mono text-xs">{job.id.slice(0, 8)}</td>
                    <td className="border-b border-white/5 px-2 py-2">{job.setId}</td>
                    <td className="border-b border-white/5 px-2 py-2">{job.datasetType}</td>
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
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <h2 className="text-lg font-semibold text-white">2. Draft Review + Approval</h2>
          <p className="mt-1 text-xs text-slate-400">Selected set: {selectedSetId || "-"}</p>
          <p className="mt-1 text-xs text-slate-400">Blocking errors: {blockingErrorCount}</p>

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
                </tr>
              </thead>
              <tbody>
                {editableRows.slice(0, 120).map((row, rowIndex) => (
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
                  </tr>
                ))}
                {editableRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-6 text-center text-sm text-slate-400">
                      No draft rows loaded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <h2 className="text-lg font-semibold text-white">3. Seed Runner + Monitor</h2>
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
        </section>
      </div>
    </AppShell>
  );
}
