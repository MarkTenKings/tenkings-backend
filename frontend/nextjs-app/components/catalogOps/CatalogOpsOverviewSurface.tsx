import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { buildSetDeleteConfirmationPhrase, normalizeSetLabel } from "@tenkings/shared";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type SetSummaryRow = {
  setId: string;
  label: string;
  draftStatus: string | null;
  archived: boolean;
  variantCount: number;
  referenceCount: number;
  lastSeedStatus: string | null;
  lastSeedAt: string | null;
  updatedAt: string | null;
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
      featureFlags: {
        replaceWizard: boolean;
      };
    }
  | {
      message: string;
    };

type LoadResponse =
  | {
      sets: SetSummaryRow[];
      total: number;
    }
  | {
      message: string;
    };

type DeleteImpact = {
  setId: string;
  rowsToDelete: {
    cardVariants: number;
    referenceImages: number;
    drafts: number;
    draftVersions: number;
    approvals: number;
    ingestionJobs: number;
    seedJobs: number;
  };
  totalRowsToDelete: number;
  auditEventsForSet: number;
};

type ReplacePreview = {
  setId: string;
  datasetType: string;
  summary: {
    rowCount: number;
    errorCount: number;
    blockingErrorCount: number;
    acceptedRowCount: number;
  };
  diff: {
    existingCount: number;
    incomingCount: number;
    toAddCount: number;
    toRemoveCount: number;
    unchangedCount: number;
  };
  labels: {
    uniqueParallelLabels: string[];
    suspiciousParallelLabels: string[];
  };
  rows: Array<{
    index: number;
    cardNumber: string | null;
    parallel: string;
    playerSeed: string;
    blockingErrorCount: number;
    warningCount: number;
  }>;
  sampleRows: Array<{
    index: number;
    cardNumber: string | null;
    parallel: string;
    playerSeed: string;
    blockingErrorCount: number;
    warningCount: number;
  }>;
  previewHash: string;
};

type ReplaceJobRow = {
  id: string;
  setId: string;
  datasetType: string;
  status: string;
  previewHash: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  runArgs: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  logs: string[];
  ingestionJobId: string | null;
  draftId: string | null;
  draftVersionId: string | null;
  approvalId: string | null;
  seedJobId: string | null;
};

type ReplaceJobsResponse =
  | {
      jobs: ReplaceJobRow[];
      total: number;
    }
  | { message: string };

type ReplaceStartResponse =
  | {
      job: ReplaceJobRow;
      audit?: { id?: string } | null;
    }
  | { message: string };

type CatalogOpsContext = {
  setId?: string;
  programId?: string;
  jobId?: string;
  tab?: string;
  queueFilter?: string;
};

type CatalogOpsOverviewSurfaceProps = {
  context: CatalogOpsContext;
  buildHref: (pathname: string, overrides?: Partial<CatalogOpsContext>) => string;
};

const TAXONOMY_READY_STATUSES = new Set(["APPROVED", "SEEDING", "SEEDED", "COMPLETE"]);
const AMBIGUITY_REVIEW_STATUSES = new Set(["REVIEW_REQUIRED", "REJECTED"]);

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function buildSetReplaceConfirmationPhrase(setId: string) {
  return `REPLACE ${normalizeSetLabel(setId)}`;
}

function withQueryParam(href: string, key: string, value: string) {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function isReplaceJobTerminal(status: string) {
  return status === "COMPLETE" || status === "FAILED" || status === "CANCELLED";
}

function isReplaceJobActive(status: string) {
  return !isReplaceJobTerminal(status);
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function replaceStepStatusClass(status: string) {
  if (status === "complete") return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  if (status === "in_progress") return "border-gold-500/50 bg-gold-500/10 text-gold-200";
  if (status === "failed") return "border-rose-400/50 bg-rose-500/10 text-rose-200";
  if (status === "cancelled") return "border-amber-400/50 bg-amber-500/10 text-amber-200";
  return "border-white/15 bg-night-900/60 text-slate-300";
}

function rowHealthSnapshot(row: SetSummaryRow) {
  const taxonomyReady = TAXONOMY_READY_STATUSES.has(String(row.draftStatus || "").toUpperCase());
  const ambiguityReview = AMBIGUITY_REVIEW_STATUSES.has(String(row.draftStatus || "").toUpperCase());
  const variantCount = Math.max(0, row.variantCount || 0);
  const referenceCount = Math.max(0, row.referenceCount || 0);
  const refCoverage = variantCount > 0 ? Math.round((referenceCount / variantCount) * 100) : 0;
  const refQaLabel =
    variantCount < 1 ? "No variants" : refCoverage >= 100 ? "Strong" : refCoverage >= 50 ? "Partial" : "Low";
  return {
    taxonomyReady,
    ambiguityReview,
    refCoverage,
    refQaLabel,
  };
}

function seedStatusClass(status: string | null) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "COMPLETE") return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  if (normalized === "FAILED") return "border-rose-400/40 bg-rose-500/10 text-rose-200";
  if (normalized === "RUNNING" || normalized === "QUEUED") return "border-gold-500/40 bg-gold-500/10 text-gold-200";
  return "border-white/20 bg-night-900/70 text-slate-300";
}

export default function CatalogOpsOverviewSurface({ context, buildHref }: CatalogOpsOverviewSurfaceProps) {
  const { session } = useSession();
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const [queryInput, setQueryInput] = useState(context.setId || "");
  const [query, setQuery] = useState(context.setId || "");
  const [includeArchived, setIncludeArchived] = useState(true);
  const [rows, setRows] = useState<SetSummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditSnippet, setAuditSnippet] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [actionBusySetId, setActionBusySetId] = useState<string | null>(null);

  const [permissions, setPermissions] = useState<SetOpsPermissions | null>(null);
  const [replaceWizardEnabled, setReplaceWizardEnabled] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SetSummaryRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<DeleteImpact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  const [replaceTarget, setReplaceTarget] = useState<SetSummaryRow | null>(null);
  const [replaceRows, setReplaceRows] = useState<Array<Record<string, unknown>>>([]);
  const [replaceParserName, setReplaceParserName] = useState<string | null>(null);
  const [replacePreview, setReplacePreview] = useState<ReplacePreview | null>(null);
  const [replaceFileName, setReplaceFileName] = useState<string | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceRunBusy, setReplaceRunBusy] = useState(false);
  const [replaceConfirmation, setReplaceConfirmation] = useState("");
  const [replaceReason, setReplaceReason] = useState("");
  const [replaceJobs, setReplaceJobs] = useState<ReplaceJobRow[]>([]);
  const [replaceResult, setReplaceResult] = useState<ReplaceJobRow | null>(null);
  const [replacePreviewPage, setReplacePreviewPage] = useState(1);

  const canReview = Boolean(permissions?.reviewer);
  const canApprove = Boolean(permissions?.approver);
  const canArchive = Boolean(permissions?.admin);
  const canDelete = Boolean(permissions?.delete);
  const canReplace = replaceWizardEnabled && canReview && canApprove && canDelete;

  const loadAccess = useCallback(async () => {
    if (!session?.token) return null;
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
      setReplaceWizardEnabled(Boolean(payload.featureFlags?.replaceWizard));
      return payload.permissions;
    } catch (accessError) {
      setPermissions(null);
      setReplaceWizardEnabled(false);
      setError(accessError instanceof Error ? accessError.message : "Failed to load role permissions");
      return null;
    } finally {
      setAccessBusy(false);
    }
  }, [adminHeaders, session?.token]);

  const loadSets = useCallback(
    async (nextQuery = query, nextIncludeArchived = includeArchived, reviewerAllowed = canReview) => {
      if (!session?.token || !reviewerAllowed) return;
      setBusy(true);
      setError(null);
      setStatus(null);
      setAuditSnippet(null);
      try {
        const params = new URLSearchParams({
          q: nextQuery,
          limit: "500",
          includeArchived: String(nextIncludeArchived),
        });
        const response = await fetch(`/api/admin/set-ops/sets?${params.toString()}`, {
          headers: adminHeaders,
        });
        const payload = (await response.json().catch(() => ({}))) as LoadResponse;
        if (!response.ok) {
          throw new Error("message" in payload ? payload.message : "Failed to load set data");
        }
        const nextRows = "sets" in payload ? payload.sets ?? [] : [];
        const nextTotal = "total" in payload ? payload.total ?? nextRows.length : nextRows.length;
        setRows(nextRows);
        setTotal(nextTotal);
        setStatus(`Loaded ${nextRows.length} set rows.`);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load set data");
      } finally {
        setBusy(false);
      }
    },
    [adminHeaders, canReview, includeArchived, query, session?.token]
  );

  useEffect(() => {
    if (!session?.token) return;
    let cancelled = false;

    const run = async () => {
      setBusy(true);
      setError(null);
      const nextPermissions = await loadAccess();
      if (cancelled) return;
      if (!nextPermissions?.reviewer) {
        setRows([]);
        setTotal(0);
        setStatus("Set Ops reviewer role required to view overview data.");
        setBusy(false);
        return;
      }
      await loadSets(query, includeArchived, true);
      if (!cancelled) {
        setBusy(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [includeArchived, loadAccess, loadSets, query, session?.token]);

  useEffect(() => {
    if (!context.setId) return;
    setQueryInput(context.setId);
    setQuery((prev) => (prev ? prev : context.setId!));
  }, [context.setId]);

  const onSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canReview) {
        setError("Set Ops reviewer role required");
        return;
      }
      const nextQuery = queryInput.trim();
      setQuery(nextQuery);
      void loadSets(nextQuery, includeArchived, true);
    },
    [canReview, includeArchived, loadSets, queryInput]
  );

  const updateArchiveState = useCallback(
    async (row: SetSummaryRow, nextArchived: boolean) => {
      if (!session?.token) return;
      if (!canArchive) {
        setError("Set Ops admin role required");
        return;
      }
      setActionBusySetId(row.setId);
      setError(null);
      setStatus(null);
      setAuditSnippet(null);
      try {
        const response = await fetch("/api/admin/set-ops/archive", {
          method: "POST",
          headers: {
            ...adminHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            setId: row.setId,
            archived: nextArchived,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          draft?: {
            status?: string;
            archivedAt?: string | null;
            updatedAt?: string | null;
          };
          audit?: { id?: string } | null;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? "Failed to update archive state");
        }

        setRows((prev) =>
          prev.map((entry) => {
            if (entry.setId !== row.setId) return entry;
            const archived = Boolean(payload.draft?.archivedAt || payload.draft?.status === "ARCHIVED");
            return {
              ...entry,
              archived,
              draftStatus: payload.draft?.status ?? entry.draftStatus,
              updatedAt: payload.draft?.updatedAt ?? entry.updatedAt,
            };
          })
        );

        const verb = nextArchived ? "Archived" : "Unarchived";
        setStatus(`${verb} ${row.setId}.`);
        if (payload.audit?.id) {
          setAuditSnippet(`Audit event: ${payload.audit.id}`);
        }
      } catch (archiveError) {
        setError(archiveError instanceof Error ? archiveError.message : "Failed to update archive state");
      } finally {
        setActionBusySetId(null);
      }
    },
    [adminHeaders, canArchive, session?.token]
  );

  const closeDeletePanel = useCallback(() => {
    setDeleteTarget(null);
    setDeleteImpact(null);
    setDeleteError(null);
    setDeleteConfirmation("");
    setDeleteBusy(false);
  }, []);

  const requestDeleteImpact = useCallback(
    async (setId: string) => {
      if (!session?.token || !canDelete) return;
      setDeleteBusy(true);
      setDeleteError(null);
      setDeleteImpact(null);
      try {
        const response = await fetch("/api/admin/set-ops/delete/dry-run", {
          method: "POST",
          headers: {
            ...adminHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ setId }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          impact?: DeleteImpact;
          audit?: { id?: string } | null;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? "Failed to load delete impact");
        }
        setDeleteImpact(payload.impact ?? null);
        if (payload.audit?.id) {
          setAuditSnippet(`Audit event: ${payload.audit.id}`);
        }
      } catch (impactError) {
        setDeleteError(impactError instanceof Error ? impactError.message : "Failed to load delete impact");
      } finally {
        setDeleteBusy(false);
      }
    },
    [adminHeaders, canDelete, session?.token]
  );

  const openDeletePanel = useCallback(
    (row: SetSummaryRow) => {
      if (!canDelete) {
        setError("Set Ops delete role required");
        return;
      }
      setDeleteTarget(row);
      setDeleteConfirmation("");
      setDeleteError(null);
      void requestDeleteImpact(row.setId);
    },
    [canDelete, requestDeleteImpact]
  );

  const confirmDeleteSet = useCallback(async () => {
    if (!session?.token || !deleteTarget || !canDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    setError(null);
    setStatus(null);
    setAuditSnippet(null);
    try {
      const response = await fetch("/api/admin/set-ops/delete/confirm", {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          setId: deleteTarget.setId,
          typedConfirmation: deleteConfirmation,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        impact?: DeleteImpact;
        audit?: { id?: string } | null;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "Delete failed");
      }
      setRows((prev) => prev.filter((entry) => entry.setId !== deleteTarget.setId));
      setTotal((prev) => Math.max(0, prev - 1));
      setStatus(`Deleted ${deleteTarget.setId} (${payload.impact?.totalRowsToDelete ?? 0} rows).`);
      if (payload.audit?.id) {
        setAuditSnippet(`Audit event: ${payload.audit.id}`);
      }
      closeDeletePanel();
    } catch (confirmError) {
      setDeleteError(confirmError instanceof Error ? confirmError.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  }, [adminHeaders, canDelete, closeDeletePanel, deleteConfirmation, deleteTarget, session?.token]);

  const closeReplacePanel = useCallback(() => {
    setReplaceTarget(null);
    setReplaceRows([]);
    setReplaceParserName(null);
    setReplacePreview(null);
    setReplaceFileName(null);
    setReplaceError(null);
    setReplaceBusy(false);
    setReplaceRunBusy(false);
    setReplaceConfirmation("");
    setReplaceReason("");
    setReplaceJobs([]);
    setReplaceResult(null);
    setReplacePreviewPage(1);
  }, []);

  const loadReplaceJobsForSet = useCallback(
    async (setId: string) => {
      if (!session?.token || !replaceWizardEnabled) {
        setReplaceJobs([]);
        return;
      }
      try {
        const params = new URLSearchParams({
          setId,
          limit: "20",
        });
        const response = await fetch(`/api/admin/set-ops/replace/jobs?${params.toString()}`, {
          headers: adminHeaders,
        });
        const payload = (await response.json().catch(() => ({}))) as ReplaceJobsResponse;
        if (!response.ok || !("jobs" in payload)) {
          throw new Error("message" in payload ? payload.message : "Failed to load replace jobs");
        }
        setReplaceJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
      } catch (replaceJobsError) {
        setReplaceError(replaceJobsError instanceof Error ? replaceJobsError.message : "Failed to load replace jobs");
      }
    },
    [adminHeaders, replaceWizardEnabled, session?.token]
  );

  const openReplacePanel = useCallback(
    (row: SetSummaryRow) => {
      if (!replaceWizardEnabled) {
        setError("Set replace wizard is currently disabled");
        return;
      }
      if (!canReplace) {
        setError("Set replace requires reviewer, delete, and approver roles");
        return;
      }
      setReplaceTarget(row);
      setReplaceRows([]);
      setReplaceParserName(null);
      setReplacePreview(null);
      setReplaceFileName(null);
      setReplaceError(null);
      setReplaceBusy(false);
      setReplaceRunBusy(false);
      setReplaceConfirmation("");
      setReplaceReason("");
      setReplaceJobs([]);
      setReplaceResult(null);
      setReplacePreviewPage(1);
      void loadReplaceJobsForSet(row.setId);
    },
    [canReplace, loadReplaceJobsForSet, replaceWizardEnabled]
  );

  const uploadReplaceFile = useCallback(
    async (file: File) => {
      if (!session?.token || !replaceTarget || !canReplace) return;
      setReplaceBusy(true);
      setReplaceError(null);
      setReplacePreview(null);
      setReplaceRows([]);
      setReplaceParserName(null);
      setReplaceResult(null);
      setReplaceFileName(file.name);

      try {
        const bytes = await file.arrayBuffer();
        const response = await fetch(
          `/api/admin/set-ops/discovery/parse-upload?fileName=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            headers: {
              ...adminHeaders,
              "Content-Type": file.type || "application/octet-stream",
            },
            body: bytes,
          }
        );

        const payload = (await response.json().catch(() => ({}))) as
          | {
              rows?: Array<Record<string, unknown>>;
              parserName?: string;
              message?: string;
            }
          | {
              message: string;
            };

        if (!response.ok || !("rows" in payload)) {
          throw new Error("message" in payload ? payload.message : "Failed to parse upload");
        }
        const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
        if (nextRows.length < 1) {
          throw new Error("Parsed file returned zero rows.");
        }
        setReplaceRows(nextRows);
        setReplaceParserName(typeof payload.parserName === "string" ? payload.parserName : "unknown");
        setReplacePreviewPage(1);

        const previewResponse = await fetch("/api/admin/set-ops/replace/preview", {
          method: "POST",
          headers: {
            ...adminHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            setId: replaceTarget.setId,
            datasetType: "PARALLEL_DB",
            rows: nextRows,
          }),
        });

        const previewPayload = (await previewResponse.json().catch(() => ({}))) as
          | {
              preview?: ReplacePreview;
              message?: string;
            }
          | {
              message: string;
            };

        if (!previewResponse.ok || !("preview" in previewPayload) || !previewPayload.preview) {
          throw new Error("message" in previewPayload ? previewPayload.message : "Failed to generate replace preview");
        }

        setReplacePreview(previewPayload.preview);
      } catch (replaceUploadError) {
        setReplaceError(replaceUploadError instanceof Error ? replaceUploadError.message : "Failed to process replacement file");
      } finally {
        setReplaceBusy(false);
      }
    },
    [adminHeaders, canReplace, replaceTarget, session?.token]
  );

  const runReplaceSet = useCallback(async () => {
    if (!session?.token || !replaceTarget || !replacePreview || !canReplace) return;
    setReplaceRunBusy(true);
    setReplaceError(null);
    setError(null);
    setStatus(null);
    setAuditSnippet(null);
    try {
      const response = await fetch("/api/admin/set-ops/replace/jobs", {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          setId: replaceTarget.setId,
          datasetType: "PARALLEL_DB",
          rows: replaceRows,
          previewHash: replacePreview.previewHash,
          typedConfirmation: replaceConfirmation,
          reason: replaceReason || undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as ReplaceStartResponse;
      if (!response.ok || !("job" in payload)) {
        throw new Error("message" in payload ? payload.message : "Replace run failed");
      }

      setReplaceResult(payload.job);
      setReplaceJobs((prev) => [payload.job, ...prev.filter((entry) => entry.id !== payload.job.id)]);
      setStatus(`Replace job queued for ${replaceTarget.setId}.`);
      if (payload.audit?.id) {
        setAuditSnippet(`Audit event: ${payload.audit.id}`);
      }
    } catch (replaceRunError) {
      setReplaceError(replaceRunError instanceof Error ? replaceRunError.message : "Failed to run replace job");
    } finally {
      setReplaceRunBusy(false);
    }
  }, [
    adminHeaders,
    canReplace,
    replaceConfirmation,
    replacePreview,
    replaceReason,
    replaceRows,
    replaceTarget,
    session?.token,
  ]);

  const cancelReplaceSet = useCallback(async () => {
    if (!session?.token || !replaceResult || !canReplace) return;
    if (isReplaceJobTerminal(replaceResult.status)) return;
    setReplaceRunBusy(true);
    try {
      const response = await fetch(`/api/admin/set-ops/replace/jobs/${encodeURIComponent(replaceResult.id)}/cancel`, {
        method: "POST",
        headers: {
          ...adminHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: replaceReason || "cancel_requested_from_overview",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        job?: ReplaceJobRow;
        message?: string;
      };
      if (!response.ok || !payload.job) {
        throw new Error(payload.message ?? "Failed to cancel replace job");
      }
      setReplaceResult(payload.job);
      setReplaceJobs((prev) => [payload.job!, ...prev.filter((entry) => entry.id !== payload.job!.id)]);
      setStatus(`Cancel requested for replace job ${payload.job.id}.`);
    } catch (cancelError) {
      setReplaceError(cancelError instanceof Error ? cancelError.message : "Failed to cancel replace job");
    } finally {
      setReplaceRunBusy(false);
    }
  }, [adminHeaders, canReplace, replaceReason, replaceResult, session?.token]);

  useEffect(() => {
    if (!session?.token || !replaceTarget || !replaceResult) return;
    if (!isReplaceJobActive(replaceResult.status)) return;

    let cancelled = false;
    let terminalHandled = false;

    const poll = async () => {
      try {
        const params = new URLSearchParams({
          jobId: replaceResult.id,
          limit: "1",
        });
        const response = await fetch(`/api/admin/set-ops/replace/jobs?${params.toString()}`, {
          headers: adminHeaders,
        });
        const payload = (await response.json().catch(() => ({}))) as ReplaceJobsResponse;
        if (!response.ok || !("jobs" in payload) || !Array.isArray(payload.jobs) || payload.jobs.length < 1) {
          return;
        }
        const latest = payload.jobs[0];
        if (cancelled) return;

        setReplaceResult(latest);
        setReplaceJobs((prev) => [latest, ...prev.filter((entry) => entry.id !== latest.id)]);

        if (!terminalHandled && isReplaceJobTerminal(latest.status)) {
          terminalHandled = true;
          if (latest.status === "COMPLETE") {
            setStatus(`Replace completed for ${replaceTarget.setId}.`);
          } else if (latest.status === "CANCELLED") {
            setStatus(`Replace cancelled for ${replaceTarget.setId}.`);
          } else {
            setReplaceError(latest.errorMessage || "Replace job failed");
          }
          await loadSets(query, includeArchived, true);
          await loadReplaceJobsForSet(replaceTarget.setId);
        }
      } catch {
        // Polling remains best-effort.
      }
    };

    void poll();
    const intervalId = window.setInterval(() => {
      void poll();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    adminHeaders,
    includeArchived,
    loadReplaceJobsForSet,
    loadSets,
    query,
    replaceResult,
    replaceTarget,
    session?.token,
  ]);

  const replacePreviewRows = useMemo(
    () => replacePreview?.rows ?? replacePreview?.sampleRows ?? [],
    [replacePreview]
  );
  const replaceRowsPerPage = 25;
  const replacePreviewPageCount = Math.max(1, Math.ceil(replacePreviewRows.length / replaceRowsPerPage));
  const replacePreviewPageRows = useMemo(() => {
    const page = Math.max(1, Math.min(replacePreviewPage, replacePreviewPageCount));
    const start = (page - 1) * replaceRowsPerPage;
    return replacePreviewRows.slice(start, start + replaceRowsPerPage);
  }, [replacePreviewPage, replacePreviewPageCount, replacePreviewRows]);
  const replaceLatestJob = useMemo(() => replaceResult ?? replaceJobs[0] ?? null, [replaceJobs, replaceResult]);
  const replaceProgressSteps = useMemo(() => {
    const progress = toObject(replaceLatestJob?.progress ?? null);
    const rawSteps = Array.isArray(progress?.steps) ? progress.steps : [];
    return rawSteps
      .map((entry) => toObject(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        key: String(entry.key ?? ""),
        label: String(entry.label ?? entry.key ?? ""),
        status: String(entry.status ?? "pending"),
        detail: typeof entry.detail === "string" ? entry.detail : null,
      }));
  }, [replaceLatestJob]);

  useEffect(() => {
    if (replacePreviewPage > replacePreviewPageCount) {
      setReplacePreviewPage(replacePreviewPageCount);
    }
  }, [replacePreviewPage, replacePreviewPageCount]);

  const variantTotal = useMemo(
    () => rows.reduce((sum, row) => sum + Math.max(0, row.variantCount || 0), 0),
    [rows]
  );
  const referenceTotal = useMemo(
    () => rows.reduce((sum, row) => sum + Math.max(0, row.referenceCount || 0), 0),
    [rows]
  );
  const taxonomyReadyCount = useMemo(
    () => rows.filter((row) => rowHealthSnapshot(row).taxonomyReady).length,
    [rows]
  );
  const ambiguityCount = useMemo(
    () => rows.filter((row) => rowHealthSnapshot(row).ambiguityReview).length,
    [rows]
  );
  const seedCompleteCount = useMemo(
    () => rows.filter((row) => String(row.lastSeedStatus || "").toUpperCase() === "COMPLETE").length,
    [rows]
  );
  const seedFailedCount = useMemo(
    () => rows.filter((row) => String(row.lastSeedStatus || "").toUpperCase() === "FAILED").length,
    [rows]
  );
  const refCoverage = variantTotal > 0 ? Math.round((referenceTotal / variantTotal) * 100) : 0;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Taxonomy Coverage</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {taxonomyReadyCount}/{rows.length || 0}
          </p>
          <p className="mt-1 text-xs text-slate-400">Sets with approved/seed-ready draft status.</p>
        </article>
        <article className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Unresolved Ambiguities</p>
          <p className={`mt-2 text-2xl font-semibold ${ambiguityCount > 0 ? "text-amber-200" : "text-emerald-200"}`}>
            {ambiguityCount}
          </p>
          <p className="mt-1 text-xs text-slate-400">Proxy from `Review Required` / `Rejected` draft states.</p>
        </article>
        <article className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Ref QA Status</p>
          <p className="mt-2 text-2xl font-semibold text-white">{refCoverage}%</p>
          <p className="mt-1 text-xs text-slate-400">
            Coverage proxy: {referenceTotal.toLocaleString()} refs / {variantTotal.toLocaleString()} variants.
          </p>
        </article>
        <article className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Last Seed Result</p>
          <p className="mt-2 text-2xl font-semibold text-white">{seedCompleteCount}</p>
          <p className="mt-1 text-xs text-slate-400">Complete: {seedCompleteCount} · Failed: {seedFailedCount}</p>
        </article>
      </section>

      <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-violet-300">Set Health Table</p>
            <p className="mt-1 text-sm text-slate-300">
              Overview routing surface for set-level operations, with panel-based replace/delete flows.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em]">
            <span className={`rounded-full border px-2 py-1 ${canReview ? "border-emerald-400/50 text-emerald-200" : "border-white/20 text-slate-400"}`}>
              reviewer: {canReview ? "yes" : "no"}
            </span>
            <span className={`rounded-full border px-2 py-1 ${canApprove ? "border-emerald-400/50 text-emerald-200" : "border-white/20 text-slate-400"}`}>
              approver: {canApprove ? "yes" : "no"}
            </span>
            <span className={`rounded-full border px-2 py-1 ${canArchive ? "border-emerald-400/50 text-emerald-200" : "border-white/20 text-slate-400"}`}>
              admin: {canArchive ? "yes" : "no"}
            </span>
            <span className={`rounded-full border px-2 py-1 ${canDelete ? "border-emerald-400/50 text-emerald-200" : "border-white/20 text-slate-400"}`}>
              delete: {canDelete ? "yes" : "no"}
            </span>
            <span
              className={`rounded-full border px-2 py-1 ${
                replaceWizardEnabled
                  ? canReplace
                    ? "border-gold-500/60 text-gold-200"
                    : "border-amber-400/40 text-amber-200"
                  : "border-white/20 text-slate-400"
              }`}
            >
              replace: {replaceWizardEnabled ? (canReplace ? "ready" : "roles missing") : "flag off"}
            </span>
            {accessBusy && <span className="text-slate-400">loading roles...</span>}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={buildHref("/admin/set-ops")}
            className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-200 transition hover:border-white/40"
          >
            Open Legacy Set Ops
          </Link>
          <Link
            href={withQueryParam(buildHref("/admin/catalog-ops/ingest-draft", { setId: context.setId }), "step", "source-intake")}
            className="rounded-full border border-gold-500/40 bg-gold-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-gold-200 transition hover:bg-gold-500/20"
          >
            Open Ingest & Draft
          </Link>
          <Link
            href={buildHref("/admin/catalog-ops/variant-studio", { setId: context.setId, tab: "reference-qa" })}
            className="rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-sky-200 transition hover:bg-sky-500/20"
          >
            Open Variant Studio
          </Link>
        </div>

        <form className="mt-4 flex flex-col gap-3 md:flex-row md:items-center" onSubmit={onSearch}>
          <input
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="Search set id"
            className="h-11 flex-1 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none transition focus:border-gold-500/70"
          />
          <label className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-300">
            <input
              type="checkbox"
              checked={includeArchived}
              disabled={!canReview}
              onChange={(event) => {
                if (!canReview) {
                  setError("Set Ops reviewer role required");
                  return;
                }
                const nextValue = event.target.checked;
                setIncludeArchived(nextValue);
                void loadSets(query, nextValue, true);
              }}
              className="h-4 w-4 rounded border-white/20"
            />
            Include Archived
          </label>
          <button
            type="submit"
            disabled={busy || !canReview}
            className="h-11 rounded-xl border border-gold-500/60 bg-gold-500 px-5 text-xs font-semibold uppercase tracking-[0.2em] text-night-900 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Loading..." : "Search"}
          </button>
          <button
            type="button"
            disabled={busy || !canReview}
            onClick={() => void loadSets(query, includeArchived, true)}
            className="h-11 rounded-xl border border-white/20 px-5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Refresh
          </button>
        </form>

        {status && <p className="mt-3 text-xs text-emerald-300">{status}</p>}
        {auditSnippet && <p className="mt-1 text-xs text-sky-300">{auditSnippet}</p>}
        {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}

        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm text-slate-200">
            <thead className="bg-night-950/70">
              <tr>
                <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Set</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Taxonomy</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Ambiguities</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Ref QA</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Last Seed</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Updated</th>
                <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const health = rowHealthSnapshot(row);
                const ingestBase = buildHref("/admin/catalog-ops/ingest-draft", {
                  setId: row.setId,
                  programId: undefined,
                  jobId: undefined,
                  tab: undefined,
                  queueFilter: undefined,
                });
                const ingestHref = withQueryParam(ingestBase, "step", "source-intake");
                const variantHref = buildHref("/admin/catalog-ops/variant-studio", {
                  setId: row.setId,
                  programId: undefined,
                  jobId: undefined,
                  tab: "reference-qa",
                  queueFilter: undefined,
                });

                return (
                  <tr key={row.setId}>
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      <p className="font-medium text-white">{row.label || row.setId}</p>
                      <p className="mt-1 text-xs text-slate-400">{row.setId}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {row.variantCount.toLocaleString()} variants · {row.referenceCount.toLocaleString()} refs
                      </p>
                      {row.archived && (
                        <span className="mt-2 inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-300">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      <span
                        className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.12em] ${
                          health.taxonomyReady
                            ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                            : "border-amber-400/40 bg-amber-500/10 text-amber-200"
                        }`}
                      >
                        {health.taxonomyReady ? "Ready" : row.draftStatus || "Pending"}
                      </span>
                    </td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      <span
                        className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.12em] ${
                          health.ambiguityReview
                            ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                            : "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                        }`}
                      >
                        {health.ambiguityReview ? "Review Required" : "None Detected"}
                      </span>
                    </td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      <p className="text-sm text-white">{health.refQaLabel}</p>
                      <p className="text-xs text-slate-400">{health.refCoverage}% coverage</p>
                    </td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      <span
                        className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-[0.12em] ${seedStatusClass(
                          row.lastSeedStatus
                        )}`}
                      >
                        {row.lastSeedStatus || "No runs"}
                      </span>
                      <p className="mt-1 text-xs text-slate-400">{formatDate(row.lastSeedAt)}</p>
                    </td>
                    <td className="border-b border-white/5 px-3 py-3 align-top text-xs text-slate-300">{formatDate(row.updatedAt)}</td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={ingestHref}
                          className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-gold-200 transition hover:bg-gold-500/20"
                        >
                          Open Ingest & Draft
                        </Link>
                        <Link
                          href={variantHref}
                          className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-sky-200 transition hover:bg-sky-500/20"
                        >
                          Open Variant Studio
                        </Link>
                        {canArchive ? (
                          <button
                            type="button"
                            onClick={() => void updateArchiveState(row, !row.archived)}
                            disabled={busy || deleteBusy || replaceBusy || replaceRunBusy || actionBusySetId === row.setId}
                            className={`rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
                              row.archived
                                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                                : "border-amber-400/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                            }`}
                          >
                            {actionBusySetId === row.setId ? "Saving..." : row.archived ? "Unarchive" : "Archive"}
                          </button>
                        ) : (
                          <span className="text-xs uppercase tracking-[0.12em] text-slate-500">archive no access</span>
                        )}
                        {replaceWizardEnabled ? (
                          canReplace ? (
                            <button
                              type="button"
                              onClick={() => openReplacePanel(row)}
                              disabled={busy || deleteBusy || replaceBusy || replaceRunBusy}
                              className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-200 transition hover:bg-gold-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Replace
                            </button>
                          ) : (
                            <span className="text-xs uppercase tracking-[0.12em] text-slate-500">replace no access</span>
                          )
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => openDeletePanel(row)}
                            disabled={busy || deleteBusy || replaceBusy || replaceRunBusy}
                            className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Delete
                          </button>
                        ) : (
                          <span className="text-xs uppercase tracking-[0.12em] text-slate-500">delete no access</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length < 1 && !busy && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                    No sets matched this query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">Total set rows: {total}</p>
      </section>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/70">
          <button
            type="button"
            aria-label="Close delete panel"
            onClick={closeDeletePanel}
            className="absolute inset-0"
          />
          <aside className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto border-l border-rose-400/30 bg-night-950 p-5 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.22em] text-rose-300">Delete Danger Panel</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Delete Set</h2>
            <p className="mt-2 text-sm text-slate-300">Permanent destructive action for:</p>
            <p className="mt-1 break-all text-sm font-semibold text-rose-200">{deleteTarget.setId}</p>

            <div className="mt-4 rounded-xl border border-white/10 bg-night-900/70 p-4">
              {deleteBusy && !deleteImpact ? (
                <p className="text-sm text-slate-300">Loading dry-run impact…</p>
              ) : (
                <>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Dry-Run Impact</p>
                  <div className="mt-2 grid gap-2 text-sm text-slate-200 sm:grid-cols-2">
                    <p>Card Variants: {deleteImpact?.rowsToDelete.cardVariants ?? 0}</p>
                    <p>Reference Images: {deleteImpact?.rowsToDelete.referenceImages ?? 0}</p>
                    <p>Set Drafts: {deleteImpact?.rowsToDelete.drafts ?? 0}</p>
                    <p>Draft Versions: {deleteImpact?.rowsToDelete.draftVersions ?? 0}</p>
                    <p>Approvals: {deleteImpact?.rowsToDelete.approvals ?? 0}</p>
                    <p>Ingestion Jobs: {deleteImpact?.rowsToDelete.ingestionJobs ?? 0}</p>
                    <p>Seed Jobs: {deleteImpact?.rowsToDelete.seedJobs ?? 0}</p>
                    <p>Audit Events (retained): {deleteImpact?.auditEventsForSet ?? 0}</p>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-rose-200">
                    Total rows to delete: {deleteImpact?.totalRowsToDelete ?? 0}
                  </p>
                </>
              )}
            </div>

            <label className="mt-4 block text-xs uppercase tracking-[0.2em] text-slate-300">
              Type exactly: <span className="text-rose-200">{buildSetDeleteConfirmationPhrase(deleteTarget.setId)}</span>
            </label>
            <input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder={buildSetDeleteConfirmationPhrase(deleteTarget.setId)}
              className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-night-900/80 px-3 text-sm text-white outline-none transition focus:border-rose-400/70"
            />

            {deleteError && <p className="mt-3 text-sm text-rose-300">{deleteError}</p>}

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeDeletePanel}
                disabled={deleteBusy}
                className="h-10 rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteSet()}
                disabled={deleteBusy || deleteConfirmation.trim() !== buildSetDeleteConfirmationPhrase(deleteTarget.setId)}
                className="h-10 rounded-xl border border-rose-400/40 bg-rose-500/20 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-rose-100 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleteBusy ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </aside>
        </div>
      )}

      {replaceTarget && (
        <div className="fixed inset-0 z-50 bg-black/70">
          <button
            type="button"
            aria-label="Close replace panel"
            onClick={closeReplacePanel}
            className="absolute inset-0"
          />
          <aside className="absolute inset-y-0 right-0 w-full max-w-[54rem] overflow-y-auto border-l border-gold-500/30 bg-night-950 p-5 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.22em] text-gold-300">Replace Action Panel</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Replace Existing Set Data</h2>
            <p className="mt-2 text-sm text-slate-300">
              Upload corrected checklist rows, review preview diff, and run replacement without leaving Overview.
            </p>
            <p className="mt-2 break-all text-sm font-semibold text-gold-200">{replaceTarget.setId}</p>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-night-900/70 p-4">
                <label className="block text-xs uppercase tracking-[0.2em] text-slate-300">Upload Replacement File</label>
                <p className="mt-1 text-xs text-slate-400">PDF, CSV, JSON, markdown/text checklist formats.</p>
                <input
                  type="file"
                  accept=".pdf,.csv,.json,.txt,.md,.markdown,.html,.htm"
                  disabled={replaceBusy || replaceRunBusy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void uploadReplaceFile(file);
                  }}
                  className="mt-2 block w-full text-sm text-slate-200 file:mr-3 file:rounded-lg file:border file:border-white/20 file:bg-night-900 file:px-3 file:py-2 file:text-xs file:uppercase file:tracking-[0.12em] file:text-slate-100 hover:file:border-white/40"
                />
                {replaceFileName && (
                  <p className="mt-2 text-xs text-slate-400">
                    file: <span className="text-slate-200">{replaceFileName}</span>
                    {replaceParserName ? (
                      <>
                        {" "}
                        | parser: <span className="text-slate-200">{replaceParserName}</span>
                      </>
                    ) : null}
                  </p>
                )}
              </div>

              {replacePreview && (
                <div className="rounded-xl border border-white/10 bg-night-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Preview Summary</p>
                  <div className="mt-2 grid gap-1 text-sm text-slate-200">
                    <p>Rows parsed: {replacePreview.summary.rowCount.toLocaleString()}</p>
                    <p>Blocking errors: {replacePreview.summary.blockingErrorCount.toLocaleString()}</p>
                    <p>Accepted rows: {replacePreview.summary.acceptedRowCount.toLocaleString()}</p>
                    <p>Current variants: {replacePreview.diff.existingCount.toLocaleString()}</p>
                    <p>Incoming variants: {replacePreview.diff.incomingCount.toLocaleString()}</p>
                    <p className="text-emerald-300">Will add: {replacePreview.diff.toAddCount.toLocaleString()}</p>
                    <p className="text-amber-300">Will remove: {replacePreview.diff.toRemoveCount.toLocaleString()}</p>
                  </div>
                </div>
              )}

              {replacePreview && (
                <div className="rounded-xl border border-white/10 bg-night-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Unique Labels</p>
                  <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-white/10 bg-night-950/50 p-2 text-xs text-slate-200">
                    {replacePreview.labels.uniqueParallelLabels.length > 0 ? (
                      replacePreview.labels.uniqueParallelLabels.map((label) => (
                        <p
                          key={label}
                          className={`py-0.5 ${
                            replacePreview.labels.suspiciousParallelLabels.includes(label) ? "text-rose-300" : "text-slate-200"
                          }`}
                        >
                          {label}
                        </p>
                      ))
                    ) : (
                      <p className="text-slate-500">No labels parsed.</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {replacePreview && (
              <div className="mt-4 rounded-xl border border-white/10 bg-night-900/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Parsed Rows Preview</p>
                  <p className="text-xs text-slate-400">
                    Page {replacePreviewPage} / {replacePreviewPageCount}
                  </p>
                </div>
                <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
                  <table className="min-w-full text-left text-xs text-slate-200">
                    <thead className="bg-night-950/70">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Card #</th>
                        <th className="px-3 py-2">Parallel / Insert</th>
                        <th className="px-3 py-2">Player</th>
                        <th className="px-3 py-2">Blocking</th>
                        <th className="px-3 py-2">Warnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {replacePreviewPageRows.map((row) => (
                        <tr key={`${row.index}-${row.cardNumber}-${row.parallel}-${row.playerSeed}`} className="border-t border-white/5">
                          <td className="px-3 py-2">{row.index + 1}</td>
                          <td className="px-3 py-2">{row.cardNumber || "ALL"}</td>
                          <td className="px-3 py-2">{row.parallel || "-"}</td>
                          <td className="px-3 py-2">{row.playerSeed || "-"}</td>
                          <td className={`px-3 py-2 ${row.blockingErrorCount > 0 ? "text-rose-300" : "text-slate-300"}`}>
                            {row.blockingErrorCount}
                          </td>
                          <td className="px-3 py-2 text-slate-300">{row.warningCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReplacePreviewPage((page) => Math.max(1, page - 1))}
                    disabled={replacePreviewPage <= 1}
                    className="rounded-lg border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplacePreviewPage((page) => Math.min(replacePreviewPageCount, page + 1))}
                    disabled={replacePreviewPage >= replacePreviewPageCount}
                    className="rounded-lg border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-300">Reason (optional)</label>
              <input
                value={replaceReason}
                onChange={(event) => setReplaceReason(event.target.value)}
                placeholder="Example: parser fix for set labels"
                disabled={replaceBusy || replaceRunBusy}
                className="h-10 rounded-xl border border-white/15 bg-night-900/80 px-3 text-sm text-white outline-none transition focus:border-gold-500/70"
              />
            </div>

            <div className="mt-4">
              <label className="block text-xs uppercase tracking-[0.2em] text-slate-300">
                Type exactly: <span className="text-gold-200">{buildSetReplaceConfirmationPhrase(replaceTarget.setId)}</span>
              </label>
              <input
                value={replaceConfirmation}
                onChange={(event) => setReplaceConfirmation(event.target.value)}
                placeholder={buildSetReplaceConfirmationPhrase(replaceTarget.setId)}
                className="mt-2 h-11 w-full rounded-xl border border-white/15 bg-night-900/80 px-3 text-sm text-white outline-none transition focus:border-gold-500/70"
              />
            </div>

            {replaceLatestJob && (
              <div className="mt-4 rounded-xl border border-white/10 bg-night-900/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Replace Progress</p>
                  <p className="text-xs text-slate-300">
                    Job {replaceLatestJob.id} · {replaceLatestJob.status}
                  </p>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-5">
                  {(replaceProgressSteps.length > 0
                    ? replaceProgressSteps
                    : [
                        { key: "validate_preview", label: "Validate preview", status: "pending", detail: null },
                        { key: "delete_existing_set", label: "Delete existing set data", status: "pending", detail: null },
                        { key: "create_draft_version", label: "Create and build draft", status: "pending", detail: null },
                        { key: "approve_draft", label: "Approve draft", status: "pending", detail: null },
                        { key: "seed_set", label: "Seed set", status: "pending", detail: null },
                      ]
                  ).map((step) => (
                    <div
                      key={step.key}
                      className={`rounded-lg border px-2 py-2 text-[11px] ${replaceStepStatusClass(String(step.status || "pending"))}`}
                    >
                      <p className="font-semibold uppercase tracking-[0.13em]">{step.label}</p>
                      <p className="mt-1 uppercase tracking-[0.1em]">{step.status}</p>
                      {step.detail && <p className="mt-1 text-[10px] normal-case tracking-normal">{step.detail}</p>}
                    </div>
                  ))}
                </div>

                <div className="mt-3 max-h-32 overflow-auto rounded-lg border border-white/10 bg-night-950/60 p-2 text-xs text-slate-200">
                  {(replaceLatestJob.logs || []).length > 0 ? (
                    replaceLatestJob.logs.slice(-80).map((line, index) => (
                      <p key={`${replaceLatestJob.id}-log-${index}`} className="py-0.5">
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className="text-slate-500">No logs yet.</p>
                  )}
                </div>
              </div>
            )}

            {replaceJobs.length > 0 && (
              <div className="mt-4 rounded-xl border border-white/10 bg-night-900/70 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Recent Replace Jobs</p>
                <div className="mt-2 max-h-32 overflow-auto text-xs text-slate-200">
                  {replaceJobs.slice(0, 10).map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setReplaceResult(job)}
                      className="flex w-full items-center justify-between border-b border-white/5 py-1 text-left transition hover:text-gold-200"
                    >
                      <span>{job.id}</span>
                      <span>{job.status}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {replaceError && <p className="mt-3 text-sm text-rose-300">{replaceError}</p>}

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeReplacePanel}
                disabled={replaceBusy || replaceRunBusy}
                className="h-10 rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Close
              </button>
              {replaceLatestJob && isReplaceJobActive(replaceLatestJob.status) && !replaceLatestJob.cancelRequestedAt && (
                <button
                  type="button"
                  onClick={() => void cancelReplaceSet()}
                  disabled={replaceRunBusy}
                  className="h-10 rounded-xl border border-amber-400/50 bg-amber-500/20 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {replaceRunBusy ? "Cancelling..." : "Cancel Replace"}
                </button>
              )}
              <button
                type="button"
                onClick={() => void runReplaceSet()}
                disabled={
                  replaceBusy ||
                  replaceRunBusy ||
                  !replacePreview ||
                  replacePreview.summary.blockingErrorCount > 0 ||
                  replaceConfirmation.trim() !== buildSetReplaceConfirmationPhrase(replaceTarget.setId) ||
                  (replaceLatestJob ? isReplaceJobActive(replaceLatestJob.status) : false)
                }
                className="h-10 rounded-xl border border-gold-500/60 bg-gold-500/20 px-4 text-xs font-semibold uppercase tracking-[0.18em] text-gold-100 transition hover:bg-gold-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {replaceRunBusy ? "Starting..." : "Run Replace"}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
