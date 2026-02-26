import Head from "next/head";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildSetDeleteConfirmationPhrase, normalizeSetLabel } from "@tenkings/shared";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
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
  keys: {
    toAdd: string[];
    toRemove: string[];
  };
  sampleRows: Array<{
    index: number;
    cardNumber: string | null;
    parallel: string;
    playerSeed: string;
    blockingErrorCount: number;
    warningCount: number;
  }>;
  rows: Array<{
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

type LoadResponse =
  | {
      sets: SetSummaryRow[];
      total: number;
    }
  | {
      message: string;
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

function buildSetReplaceConfirmationPhrase(setId: string) {
  return `REPLACE ${normalizeSetLabel(setId)}`;
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

export default function SetOpsPage() {
  const { session, loading, ensureSession, logout } = useSession();
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(true);
  const [rows, setRows] = useState<SetSummaryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);
  const [actionBusySetId, setActionBusySetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [auditSnippet, setAuditSnippet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SetSummaryRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<DeleteImpact | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [replaceTarget, setReplaceTarget] = useState<SetSummaryRow | null>(null);
  const [replaceRows, setReplaceRows] = useState<Array<Record<string, unknown>>>([]);
  const [replaceParserName, setReplaceParserName] = useState<string | null>(null);
  const [replacePreview, setReplacePreview] = useState<ReplacePreview | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceRunBusy, setReplaceRunBusy] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replaceConfirmation, setReplaceConfirmation] = useState("");
  const [replaceReason, setReplaceReason] = useState("");
  const [replaceResult, setReplaceResult] = useState<ReplaceJobRow | null>(null);
  const [replaceFileName, setReplaceFileName] = useState<string | null>(null);
  const [replaceJobs, setReplaceJobs] = useState<ReplaceJobRow[]>([]);
  const [replacePreviewPage, setReplacePreviewPage] = useState(1);
  const [selectedSetIds, setSelectedSetIds] = useState<string[]>([]);
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [permissions, setPermissions] = useState<SetOpsPermissions | null>(null);
  const [replaceWizardEnabled, setReplaceWizardEnabled] = useState(false);

  const loadedRef = useRef(false);
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);
  const canReview = Boolean(permissions?.reviewer);
  const canApprove = Boolean(permissions?.approver);
  const canArchive = Boolean(permissions?.admin);
  const canDelete = Boolean(permissions?.delete);
  const canReplace = replaceWizardEnabled && canReview && canDelete && canApprove;
  const selectedSetIdSet = useMemo(() => new Set(selectedSetIds), [selectedSetIds]);
  const visibleSetIds = useMemo(() => rows.map((row) => row.setId), [rows]);
  const allVisibleSelected = useMemo(
    () => visibleSetIds.length > 0 && visibleSetIds.every((setId) => selectedSetIdSet.has(setId)),
    [selectedSetIdSet, visibleSetIds]
  );
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedSetIdSet.has(row.setId)),
    [rows, selectedSetIdSet]
  );

  useEffect(() => {
    const visible = new Set(rows.map((row) => row.setId));
    setSelectedSetIds((prev) => prev.filter((setId) => visible.has(setId)));
  }, [rows]);

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
  }, [adminHeaders, isAdmin, session?.token]);

  const loadSets = useCallback(
    async (nextQuery = query, nextIncludeArchived = includeArchived, reviewerAllowed = canReview) => {
      if (!session?.token || !isAdmin || !reviewerAllowed) return;
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
    [adminHeaders, canReview, includeArchived, isAdmin, query, session?.token]
  );

  useEffect(() => {
    if (!session?.token || !isAdmin) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    setBusy(true);
    setError(null);
    setStatus(null);
    setAuditSnippet(null);
    void loadAccess()
      .then((nextPermissions) => {
        if (!nextPermissions?.reviewer) {
          setRows([]);
          setTotal(0);
          setStatus("Set Ops reviewer role required to list sets.");
          return Promise.resolve();
        }
        return loadSets(query, includeArchived, true);
      })
      .finally(() => setBusy(false));
  }, [includeArchived, isAdmin, loadAccess, loadSets, query, session?.token]);

  const onSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canReview) {
        setError("Set Ops reviewer role required");
        return;
      }
      const nextQuery = queryInput.trim();
      setQuery(nextQuery);
      void loadSets(nextQuery, includeArchived);
    },
    [canReview, includeArchived, loadSets, queryInput]
  );

  const updateArchiveState = useCallback(
    async (row: SetSummaryRow, nextArchived: boolean) => {
      if (!session?.token || !isAdmin) return;
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
    [adminHeaders, canArchive, isAdmin, session?.token]
  );

  const requestDeleteImpact = useCallback(
    async (setId: string) => {
      if (!session?.token || !isAdmin) return;
      if (!canDelete) {
        setDeleteError("Set Ops delete role required");
        return;
      }
      setDeleteBusy(true);
      setDeleteError(null);
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
        setDeleteImpact(null);
        setDeleteError(impactError instanceof Error ? impactError.message : "Failed to load delete impact");
      } finally {
        setDeleteBusy(false);
      }
    },
    [adminHeaders, canDelete, isAdmin, session?.token]
  );

  const closeDeleteModal = useCallback(() => {
    setDeleteTarget(null);
    setDeleteImpact(null);
    setDeleteError(null);
    setDeleteConfirmation("");
    setDeleteBusy(false);
  }, []);

  const toggleSetSelection = useCallback((setId: string, checked: boolean) => {
    setSelectedSetIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(setId);
      } else {
        next.delete(setId);
      }
      return Array.from(next);
    });
  }, []);

  const toggleSelectAllVisible = useCallback(
    (checked: boolean) => {
      setSelectedSetIds((prev) => {
        const next = new Set(prev);
        if (checked) {
          visibleSetIds.forEach((setId) => next.add(setId));
        } else {
          visibleSetIds.forEach((setId) => next.delete(setId));
        }
        return Array.from(next);
      });
    },
    [visibleSetIds]
  );

  const bulkDeleteSelectedSets = useCallback(async () => {
    if (!session?.token || !isAdmin) return;
    if (!canDelete) {
      setError("Set Ops delete role required");
      return;
    }
    if (selectedRows.length < 1) {
      setError("Select at least one set.");
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    setBulkDeleteBusy(true);
    setError(null);
    setStatus(null);
    setAuditSnippet(null);

    try {
      const dryRuns = await Promise.all(
        selectedRows.map(async (row) => {
          const response = await fetch("/api/admin/set-ops/delete/dry-run", {
            method: "POST",
            headers: {
              ...adminHeaders,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ setId: row.setId }),
          });
          const payload = (await response.json().catch(() => ({}))) as {
            message?: string;
            impact?: DeleteImpact;
          };
          if (!response.ok) {
            throw new Error(payload.message ?? `Failed dry-run for ${row.setId}`);
          }
          return {
            setId: row.setId,
            impact: payload.impact ?? null,
          };
        })
      );

      const totalRows = dryRuns.reduce((sum, entry) => sum + Math.max(0, entry.impact?.totalRowsToDelete ?? 0), 0);
      const setNames = selectedRows.map((row) => row.setId).join("\n");
      const confirmed = window.confirm(
        `Delete ${selectedRows.length} selected set(s)?\n\nTotal rows to delete: ${totalRows}\n\n${setNames}`
      );
      if (!confirmed) {
        return;
      }

      const bulkPhrase = `DELETE ${selectedRows.length} SETS`;
      const typed = window.prompt(`Type exactly to continue:\n${bulkPhrase}`, "") ?? "";
      if (typed.trim() !== bulkPhrase) {
        throw new Error(`Typed confirmation must exactly match: ${bulkPhrase}`);
      }

      const deletedSetIds = new Set<string>();
      let deletedRows = 0;
      const failures: string[] = [];

      for (const row of selectedRows) {
        const response = await fetch("/api/admin/set-ops/delete/confirm", {
          method: "POST",
          headers: {
            ...adminHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            setId: row.setId,
            typedConfirmation: buildSetDeleteConfirmationPhrase(row.setId),
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
          impact?: DeleteImpact;
          audit?: { id?: string } | null;
        };

        if (!response.ok) {
          failures.push(`${row.setId}: ${payload.message ?? "Delete failed"}`);
          continue;
        }

        deletedSetIds.add(row.setId);
        deletedRows += Math.max(0, payload.impact?.totalRowsToDelete ?? 0);
        if (payload.audit?.id) {
          setAuditSnippet(`Last audit event: ${payload.audit.id}`);
        }
      }

      if (deletedSetIds.size > 0) {
        setRows((prev) => prev.filter((row) => !deletedSetIds.has(row.setId)));
        setTotal((prev) => Math.max(0, prev - deletedSetIds.size));
        setSelectedSetIds((prev) => prev.filter((setId) => !deletedSetIds.has(setId)));
      }

      if (failures.length > 0) {
        setStatus(`Deleted ${deletedSetIds.size}/${selectedRows.length} sets (${deletedRows} rows).`);
        setError(failures.slice(0, 5).join(" | "));
        return;
      }

      setStatus(`Deleted ${deletedSetIds.size} set(s) (${deletedRows} rows).`);
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "Failed to bulk delete selected sets");
    } finally {
      setBulkDeleteBusy(false);
    }
  }, [adminHeaders, canDelete, isAdmin, selectedRows, session?.token]);

  const openDeleteModal = useCallback(
    (row: SetSummaryRow) => {
      if (!canDelete) {
        setError("Set Ops delete role required");
        return;
      }
      setDeleteTarget(row);
      setDeleteImpact(null);
      setDeleteError(null);
      setDeleteConfirmation("");
      void requestDeleteImpact(row.setId);
    },
    [canDelete, requestDeleteImpact]
  );

  const confirmDeleteSet = useCallback(async () => {
    if (!deleteTarget || !session?.token || !isAdmin) return;
    if (!canDelete) {
      setDeleteError("Set Ops delete role required");
      return;
    }
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

      const rowsDeleted = payload.impact?.totalRowsToDelete ?? 0;
      setStatus(`Deleted ${deleteTarget.setId} (${rowsDeleted} rows).`);
      if (payload.audit?.id) {
        setAuditSnippet(`Audit event: ${payload.audit.id}`);
      }

      closeDeleteModal();
    } catch (confirmError) {
      setDeleteError(confirmError instanceof Error ? confirmError.message : "Delete failed");
    } finally {
      setDeleteBusy(false);
    }
  }, [adminHeaders, canDelete, closeDeleteModal, deleteConfirmation, deleteTarget, isAdmin, session?.token]);

  const closeReplaceModal = useCallback(() => {
    setReplaceTarget(null);
    setReplaceRows([]);
    setReplaceParserName(null);
    setReplacePreview(null);
    setReplaceError(null);
    setReplaceConfirmation("");
    setReplaceReason("");
    setReplaceResult(null);
    setReplaceFileName(null);
    setReplaceJobs([]);
    setReplacePreviewPage(1);
    setReplaceBusy(false);
    setReplaceRunBusy(false);
  }, []);

  const loadReplaceJobsForSet = useCallback(
    async (setId: string) => {
      if (!session?.token || !isAdmin || !replaceWizardEnabled) {
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
    [adminHeaders, isAdmin, replaceWizardEnabled, session?.token]
  );

  const openReplaceModal = useCallback((row: SetSummaryRow) => {
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
    setReplaceError(null);
    setReplaceConfirmation("");
    setReplaceReason("");
    setReplaceResult(null);
    setReplaceFileName(null);
    setReplaceJobs([]);
    setReplacePreviewPage(1);
    void loadReplaceJobsForSet(row.setId);
  }, [canReplace, loadReplaceJobsForSet, replaceWizardEnabled]);

  const uploadReplaceFile = useCallback(
    async (file: File) => {
      if (!session?.token || !isAdmin || !replaceTarget) return;
      if (!canReplace) {
        setReplaceError("Set replace requires reviewer, delete, and approver roles");
        return;
      }

      setReplaceBusy(true);
      setReplaceError(null);
      setReplacePreview(null);
      setReplaceRows([]);
      setReplaceParserName(null);
      setReplaceResult(null);
      setReplaceFileName(file.name);

      try {
        const bytes = await file.arrayBuffer();
        const response = await fetch(`/api/admin/set-ops/discovery/parse-upload?fileName=${encodeURIComponent(file.name)}`, {
          method: "POST",
          headers: {
            ...adminHeaders,
            "Content-Type": file.type || "application/octet-stream",
          },
          body: bytes,
        });

        const payload = (await response.json().catch(() => ({}))) as
          | {
              rows?: Array<Record<string, unknown>>;
              parserName?: string;
              rowCount?: number;
              message?: string;
            }
          | { message: string };

        if (!response.ok || !("rows" in payload)) {
          throw new Error("message" in payload ? payload.message : "Failed to parse upload");
        }

        const rows = Array.isArray(payload.rows) ? payload.rows : [];
        if (rows.length < 1) {
          throw new Error("Parsed file returned zero rows.");
        }

        setReplaceRows(rows);
        setReplacePreviewPage(1);
        setReplaceParserName(typeof payload.parserName === "string" ? payload.parserName : "unknown");

        const previewResponse = await fetch("/api/admin/set-ops/replace/preview", {
          method: "POST",
          headers: {
            ...adminHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            setId: replaceTarget.setId,
            datasetType: "PARALLEL_DB",
            rows,
          }),
        });

        const previewPayload = (await previewResponse.json().catch(() => ({}))) as
          | {
              preview?: ReplacePreview;
              message?: string;
            }
          | { message: string };

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
    [adminHeaders, canReplace, isAdmin, replaceTarget, session?.token]
  );

  const runReplaceSet = useCallback(async () => {
    if (!session?.token || !isAdmin || !replaceTarget || !replacePreview) return;
    if (!canReplace) {
      setReplaceError("Set replace requires reviewer, delete, and approver roles");
      return;
    }

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
      setStatus(`Replace job queued for ${replaceTarget.setId}. Live progress will update below.`);
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
    isAdmin,
    replaceConfirmation,
    replacePreview,
    replaceReason,
    replaceRows,
    replaceTarget,
    session?.token,
  ]);

  const cancelReplaceSet = useCallback(async () => {
    if (!session?.token || !isAdmin || !replaceResult) return;
    if (!canReplace) {
      setReplaceError("Set replace requires reviewer, delete, and approver roles");
      return;
    }
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
          reason: replaceReason || "cancel_requested_from_ui",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { job?: ReplaceJobRow; message?: string } | { message: string };
      if (!response.ok || !("job" in payload) || !payload.job) {
        throw new Error("message" in payload ? payload.message : "Failed to cancel replace job");
      }
      setReplaceResult(payload.job);
      setReplaceJobs((prev) => [payload.job!, ...prev.filter((entry) => entry.id !== payload.job!.id)]);
      setStatus(`Cancel requested for replace job ${payload.job.id}.`);
    } catch (cancelError) {
      setReplaceError(cancelError instanceof Error ? cancelError.message : "Failed to cancel replace job");
    } finally {
      setReplaceRunBusy(false);
    }
  }, [adminHeaders, canReplace, isAdmin, replaceReason, replaceResult, session?.token]);

  useEffect(() => {
    if (!session?.token || !isAdmin || !replaceTarget || !replaceResult) return;
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
            setStatus(
              `Replace completed for ${replaceTarget.setId}: add ${replacePreview?.diff.toAddCount ?? 0}, remove ${replacePreview?.diff.toRemoveCount ?? 0}, unchanged ${replacePreview?.diff.unchangedCount ?? 0}.`
            );
          } else if (latest.status === "CANCELLED") {
            setStatus(`Replace cancelled for ${replaceTarget.setId}.`);
          } else {
            setReplaceError(latest.errorMessage || "Replace job failed");
          }

          await loadSets(query, includeArchived, true);
          await loadReplaceJobsForSet(replaceTarget.setId);
        }
      } catch {
        // Polling is best-effort; do not interrupt operator workflow.
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
    isAdmin,
    loadReplaceJobsForSet,
    loadSets,
    query,
    replacePreview,
    replaceResult,
    replaceTarget,
    session?.token,
  ]);

  const variantTotal = useMemo(
    () => rows.reduce((sum, row) => sum + Math.max(0, row.variantCount || 0), 0),
    [rows]
  );
  const referenceTotal = useMemo(
    () => rows.reduce((sum, row) => sum + Math.max(0, row.referenceCount || 0), 0),
    [rows]
  );
  const showReplaceColumn = replaceWizardEnabled;
  const tableColumnCount = showReplaceColumn ? 10 : 9;
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
  const replaceResultPayload = useMemo(() => toObject(replaceLatestJob?.result ?? null), [replaceLatestJob]);
  const replaceSeedSummary = useMemo(() => toObject(replaceResultPayload?.seedSummary), [replaceResultPayload]);
  const replaceReferenceImagePreservation = useMemo(
    () => toObject(replaceResultPayload?.referenceImagePreservation),
    [replaceResultPayload]
  );

  useEffect(() => {
    if (replacePreviewPage > replacePreviewPageCount) {
      setReplacePreviewPage(replacePreviewPageCount);
    }
  }, [replacePreviewPage, replacePreviewPageCount]);

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
          <title>Ten Kings · Set Ops</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Set Ops</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex flex-1 flex-col gap-8 px-6 py-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-violet-300">Set Ops</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Set Admin Control Panel</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            Search active sets, inspect variant/reference footprint, and track the latest draft and seed state from production APIs.
          </p>
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
          <Link
            className="inline-flex text-xs uppercase tracking-[0.28em] text-slate-400 transition hover:text-white"
            href="/admin"
          >
            ← Back to console
          </Link>
          <Link
            className="inline-flex text-xs uppercase tracking-[0.28em] text-violet-300 transition hover:text-violet-100"
            href="/admin/set-ops-review"
          >
            Open Review Workspace →
          </Link>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-2xl border border-white/10 bg-night-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Set Rows</p>
            <p className="mt-2 text-2xl font-semibold text-white">{total}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-night-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Variant Count</p>
            <p className="mt-2 text-2xl font-semibold text-white">{variantTotal.toLocaleString()}</p>
          </article>
          <article className="rounded-2xl border border-white/10 bg-night-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Reference Count</p>
            <p className="mt-2 text-2xl font-semibold text-white">{referenceTotal.toLocaleString()}</p>
          </article>
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4 md:p-6">
          <form className="mb-5 flex flex-col gap-3 md:flex-row md:items-center" onSubmit={onSearch}>
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
                  void loadSets(query, nextValue);
                }}
                className="h-4 w-4 rounded border-white/20"
              />
              Include Archived
            </label>
            <button
              type="submit"
              disabled={busy || bulkDeleteBusy || !canReview}
              className="h-11 rounded-xl border border-gold-500/60 bg-gold-500 px-5 text-xs font-semibold uppercase tracking-[0.2em] text-night-900 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Loading..." : "Search"}
            </button>
            <button
              type="button"
              disabled={busy || bulkDeleteBusy || !canReview}
              onClick={() => void loadSets(query, includeArchived)}
              className="h-11 rounded-xl border border-white/20 px-5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Refresh
            </button>
          </form>

          {status && <p className="mb-3 text-xs text-emerald-300">{status}</p>}
          {auditSnippet && <p className="mb-3 text-xs text-sky-300">{auditSnippet}</p>}
          {error && <p className="mb-3 text-xs text-rose-300">{error}</p>}
          {canDelete && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-night-950/60 px-3 py-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-300">
                Selected: <span className="text-white">{selectedSetIds.length}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSetIds([])}
                  disabled={bulkDeleteBusy || selectedSetIds.length < 1}
                  className="rounded-lg border border-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  onClick={() => void bulkDeleteSelectedSets()}
                  disabled={busy || deleteBusy || bulkDeleteBusy || selectedSetIds.length < 1}
                  className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkDeleteBusy ? "Deleting..." : `Delete Selected (${selectedSetIds.length})`}
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm text-slate-200">
              <thead>
                <tr>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      disabled={!canDelete || rows.length < 1 || bulkDeleteBusy}
                      onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                      className="h-4 w-4 rounded border-white/20"
                    />
                  </th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Set</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Variants</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Refs</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Draft</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Last Seed</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Updated</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Archive</th>
                  {showReplaceColumn && <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Replace</th>}
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Delete</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.setId}>
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={selectedSetIdSet.has(row.setId)}
                        disabled={!canDelete || bulkDeleteBusy}
                        onChange={(event) => toggleSetSelection(row.setId, event.target.checked)}
                        className="h-4 w-4 rounded border-white/20"
                      />
                    </td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      <p className="font-medium text-white">{row.label || row.setId}</p>
                      <p className="mt-1 text-xs text-slate-400">{row.setId}</p>
                      {row.archived && (
                        <span className="mt-2 inline-flex rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-300">
                          Archived
                        </span>
                      )}
                    </td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">{row.variantCount.toLocaleString()}</td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">{row.referenceCount.toLocaleString()}</td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">{row.draftStatus ?? "-"}</td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      <p>{row.lastSeedStatus ?? "-"}</p>
                      <p className="mt-1 text-xs text-slate-400">{formatDate(row.lastSeedAt)}</p>
                    </td>
                    <td className="border-b border-white/5 px-3 py-3 align-top text-xs text-slate-300">{formatDate(row.updatedAt)}</td>
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      {canArchive ? (
                        <button
                          type="button"
                          onClick={() => void updateArchiveState(row, !row.archived)}
                          disabled={busy || deleteBusy || bulkDeleteBusy || actionBusySetId === row.setId}
                          className={`rounded-lg border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            row.archived
                              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                              : "border-amber-400/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                          }`}
                        >
                          {actionBusySetId === row.setId ? "Saving..." : row.archived ? "Unarchive" : "Archive"}
                        </button>
                      ) : (
                        <span className="text-xs uppercase tracking-[0.12em] text-slate-500">no access</span>
                      )}
                    </td>
                    {showReplaceColumn && (
                      <td className="border-b border-white/5 px-3 py-3 align-top">
                        {canReplace ? (
                          <button
                            type="button"
                            onClick={() => openReplaceModal(row)}
                            disabled={busy || replaceBusy || replaceRunBusy || deleteBusy || bulkDeleteBusy || actionBusySetId === row.setId}
                            className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-200 transition hover:bg-gold-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Replace
                          </button>
                        ) : (
                          <span className="text-xs uppercase tracking-[0.12em] text-slate-500">no access</span>
                        )}
                      </td>
                    )}
                    <td className="border-b border-white/5 px-3 py-3 align-top">
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => openDeleteModal(row)}
                          disabled={busy || deleteBusy || bulkDeleteBusy || actionBusySetId === row.setId}
                          className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Delete
                        </button>
                      ) : (
                        <span className="text-xs uppercase tracking-[0.12em] text-slate-500">no access</span>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !busy && (
                  <tr>
                    <td colSpan={tableColumnCount} className="px-3 py-8 text-center text-sm text-slate-400">
                      No sets matched this query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {deleteTarget && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 py-6">
            <div className="w-full max-w-2xl rounded-2xl border border-rose-400/25 bg-night-950 p-5 shadow-2xl md:p-6">
              <p className="text-xs uppercase tracking-[0.22em] text-rose-300">Danger Zone</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Delete Set</h2>
              <p className="mt-2 text-sm text-slate-300">
                This permanently deletes variant/reference and Set Ops workflow rows for:
              </p>
              <p className="mt-2 break-all text-sm font-semibold text-rose-200">{deleteTarget.setId}</p>

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

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeDeleteModal}
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
            </div>
          </div>
        )}

        {replaceTarget && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 py-6">
            <div className="max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-gold-500/30 bg-night-950 p-5 shadow-2xl md:p-6">
              <p className="text-xs uppercase tracking-[0.22em] text-gold-300">Replace Set Wizard</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Replace Existing Set Data</h2>
              <p className="mt-2 text-sm text-slate-300">
                Upload a corrected checklist file, review parsed rows/diff, then confirm replacement.
              </p>
              <p className="mt-2 break-all text-sm font-semibold text-gold-200">{replaceTarget.setId}</p>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-night-900/70 p-4">
                  <label className="block text-xs uppercase tracking-[0.2em] text-slate-300">Upload Replacement File</label>
                  <p className="mt-1 text-xs text-slate-400">Supported: PDF, CSV, JSON, checklist text/markdown.</p>
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
                      <p className="text-slate-300">Unchanged: {replacePreview.diff.unchangedCount.toLocaleString()}</p>
                    </div>
                    {replacePreview.labels.suspiciousParallelLabels.length > 0 && (
                      <div className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-2">
                        <p className="text-xs uppercase tracking-[0.15em] text-rose-300">Suspicious Labels</p>
                        <p className="mt-1 text-xs text-rose-200">{replacePreview.labels.suspiciousParallelLabels.join(", ")}</p>
                      </div>
                    )}
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
                        {replacePreviewPageRows.length < 1 && (
                          <tr>
                            <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                              No rows to display.
                            </td>
                          </tr>
                        )}
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
                  placeholder="Example: parser fix for Daily Dribble / No Limit labels"
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

                  {isReplaceJobTerminal(replaceLatestJob.status) && (
                    <div className="mt-3 rounded-lg border border-white/10 bg-night-950/60 p-3 text-xs text-slate-200">
                      <p className="uppercase tracking-[0.14em] text-slate-400">Final Summary</p>
                      <p className="mt-1">Status: {replaceLatestJob.status}</p>
                      <p>Error: {replaceLatestJob.errorMessage || "-"}</p>
                      <p>Inserted: {Number(replaceSeedSummary?.inserted ?? 0).toLocaleString()}</p>
                      <p>Updated: {Number(replaceSeedSummary?.updated ?? 0).toLocaleString()}</p>
                      <p>Skipped: {Number(replaceSeedSummary?.skipped ?? 0).toLocaleString()}</p>
                      <p>Failed: {Number(replaceSeedSummary?.failed ?? 0).toLocaleString()}</p>
                      <p>
                        Ref images preserved:{" "}
                        {Number(replaceReferenceImagePreservation?.preservedCount ?? 0).toLocaleString()}
                      </p>
                      <p>
                        Ref images restored:{" "}
                        {Number(replaceReferenceImagePreservation?.restoredCount ?? 0).toLocaleString()}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {replaceLatestJob.seedJobId && (
                          <Link className="text-gold-200 underline hover:text-gold-100" href="/admin/set-ops-review">
                            View seed workspace ({replaceLatestJob.seedJobId})
                          </Link>
                        )}
                      </div>
                    </div>
                  )}
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

              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeReplaceModal}
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
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
