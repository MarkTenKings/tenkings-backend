import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type SetRow = {
  setId: string;
  lastSeedStatus: string | null;
  lastSeedAt: string | null;
  variantCount: number;
};

type VariantRow = {
  id: string;
  setId: string;
  cardNumber: string;
  parallelId: string;
  parallelFamily: string | null;
  playerLabel: string | null;
  referenceCount: number;
  qaDoneCount: number;
  previewImageUrl: string | null;
};

type ReferenceRow = {
  id: string;
  setId: string;
  cardNumber: string | null;
  parallelId: string;
  displayLabel: string;
  refType: string;
  pairKey: string | null;
  sourceListingId: string | null;
  playerSeed: string | null;
  storageKey: string | null;
  qaStatus: string;
  ownedStatus: string;
  promotedAt: string | null;
  sourceUrl: string | null;
  rawImageUrl: string;
  cropUrls: string[];
  qualityScore: number | null;
  createdAt: string;
};

type StatusMessage = { type: "success" | "error"; message: string } | null;

function decodeHtml(value: string) {
  return value
    .replace(/&#0*38;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"');
}

function displayParallelLabel(value: string) {
  const decoded = decodeHtml(String(value || ""));
  const trimmed = decoded.trim();
  if (!trimmed.startsWith("{") || !trimmed.includes('"name"')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed);
    const names = Array.isArray(parsed?.name) ? parsed.name : [];
    const joined = names.map((entry: unknown) => String(entry || "").trim()).filter(Boolean).join(" / ");
    return joined || trimmed;
  } catch {
    return trimmed;
  }
}

function fileFromBlob(blob: Blob, fallbackName: string) {
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `${fallbackName}.${ext}`, {
    type: blob.type || "image/png",
  });
}

function sourceHostFromUrl(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const host = new URL(raw).hostname.trim().toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function readQueryValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

export default function VariantRefQaPage() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const [setSearch, setSetSearch] = useState("");
  const [setRows, setSetRows] = useState<SetRow[]>([]);
  const [selectedSetFilter, setSelectedSetFilter] = useState("");
  const [query, setQuery] = useState("");
  const [gapOnly, setGapOnly] = useState(false);
  const [minRefs, setMinRefs] = useState(2);
  const [variantTypeFilter, setVariantTypeFilter] = useState<"all" | "insert" | "parallel">("all");
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [refs, setRefs] = useState<ReferenceRow[]>([]);
  const [selectedSetId, setSelectedSetId] = useState("");
  const [selectedCardNumber, setSelectedCardNumber] = useState("");
  const [selectedParallelId, setSelectedParallelId] = useState("");
  const [newRefType, setNewRefType] = useState<"front" | "back">("front");
  const [selectedRefIds, setSelectedRefIds] = useState<string[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);

  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);
  const querySetId = useMemo(() => readQueryValue(router.query.setId), [router.query.setId]);
  const queryProgramId = useMemo(() => readQueryValue(router.query.programId), [router.query.programId]);

  const loadSetRows = useCallback(async (search = "") => {
    if (!session?.token) return;
    try {
      const params = new URLSearchParams({
        limit: "120",
      });
      if (search.trim()) {
        params.set("q", search.trim());
      }
      const res = await fetch(`/api/admin/variants/sets?${params.toString()}`, {
        headers: { ...adminHeaders },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to load sets");
      }
      const rows = (payload.sets ?? []) as SetRow[];
      setSetRows(rows);
      if (!rows.length) {
        setSelectedSetFilter("");
        return;
      }
      const selectedExists = rows.some((row) => row.setId === selectedSetFilter);
      if (!selectedSetFilter || !selectedExists) {
        setSelectedSetFilter(rows[0]?.setId || "");
      }
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to load sets" });
    }
  }, [adminHeaders, selectedSetFilter, session?.token]);

  const loadVariants = useCallback(async () => {
    if (!session?.token) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({
        q: query.trim(),
        limit: "2000",
        gapOnly: gapOnly ? "true" : "false",
        minRefs: String(Math.max(1, minRefs || 1)),
      });
      if (selectedSetFilter.trim()) {
        params.set("setId", selectedSetFilter.trim());
      }
      const res = await fetch(`/api/admin/variants?${params.toString()}`, {
        headers: { ...adminHeaders },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to load variants");
      }
      const rows = (payload.variants ?? []) as VariantRow[];
      setVariants(rows);
      setStatus({ type: "success", message: `Loaded ${rows.length} variants.` });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to load variants" });
    } finally {
      setBusy(false);
    }
  }, [adminHeaders, gapOnly, minRefs, query, selectedSetFilter, session?.token]);

  const displayedVariants = useMemo(() => {
    if (variantTypeFilter === "all") return variants;
    return variants.filter((variant) => {
      const family = String(variant.parallelFamily || "").toLowerCase();
      const isInsert = family.includes("insert");
      return variantTypeFilter === "insert" ? isInsert : !isInsert;
    });
  }, [variantTypeFilter, variants]);

  const queueStats = useMemo(() => {
    const total = displayedVariants.length;
    const done = displayedVariants.filter((variant) => (variant.qaDoneCount || 0) > 0).length;
    const remaining = Math.max(0, total - done);
    return { total, done, remaining };
  }, [displayedVariants]);

  const selectedVariant = useMemo(() => {
    if (!selectedSetId || !selectedParallelId) return null;
    return (
      variants.find(
        (variant) =>
          variant.setId === selectedSetId &&
          variant.parallelId === selectedParallelId &&
          variant.cardNumber === selectedCardNumber
      ) ?? null
    );
  }, [selectedCardNumber, selectedParallelId, selectedSetId, variants]);

  useEffect(() => {
    if (!session?.token) return;
    void loadSetRows();
  }, [loadSetRows, session?.token]);

  useEffect(() => {
    if (!router.isReady) return;
    if (querySetId) {
      setSetSearch((prev) => (prev ? prev : querySetId));
      setSelectedSetFilter((prev) => (prev === querySetId ? prev : querySetId));
    }
    if (queryProgramId) {
      setQuery((prev) => (prev ? prev : queryProgramId));
    }
  }, [queryProgramId, querySetId, router.isReady]);

  useEffect(() => {
    if (!session?.token || !selectedSetFilter) return;
    void loadVariants();
  }, [loadVariants, selectedSetFilter, session?.token]);

  useEffect(() => {
    if (!selectedSetFilter) return;
    if (!selectedSetId) return;
    if (selectedSetId === selectedSetFilter) return;
    setSelectedSetId("");
    setSelectedCardNumber("");
    setSelectedParallelId("");
    setRefs([]);
    setSelectedRefIds([]);
  }, [selectedSetFilter, selectedSetId]);

  const loadRefs = useCallback(async (setId?: string, parallelId?: string, cardNumber?: string) => {
    if (!session?.token) return;
    const currentSetId = (setId ?? selectedSetId).trim();
    const currentParallelId = (parallelId ?? selectedParallelId).trim();
    const currentCardNumber = (cardNumber ?? selectedCardNumber).trim();
    if (!currentSetId || !currentParallelId) {
      setStatus({ type: "error", message: "Select a variant first." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/variants/reference?setId=${encodeURIComponent(currentSetId)}&cardNumber=${encodeURIComponent(
          currentCardNumber
        )}&parallelId=${encodeURIComponent(currentParallelId)}&limit=500`,
        { headers: { ...adminHeaders } }
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to load references");
      }
      const rows = (payload.references ?? []) as ReferenceRow[];
      setRefs(rows);
      setSelectedRefIds([]);
      setStatus({ type: "success", message: `Loaded ${rows.length} references.` });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to load references" });
    } finally {
      setBusy(false);
    }
  }, [adminHeaders, selectedCardNumber, selectedParallelId, selectedSetId, session?.token]);

  const clearSetExternalRefs = useCallback(async () => {
    if (!session?.token) return;
    const setId = selectedSetFilter.trim();
    if (!setId) {
      setStatus({ type: "error", message: "Choose an active set first." });
      return;
    }
    const confirmed = window.confirm(
      `Delete external reference images for "${setId}"?\n\nThis does not delete the set or its variants. Owned/saved refs are kept.`
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/variants/reference?setId=${encodeURIComponent(setId)}`, {
        method: "DELETE",
        headers: { ...adminHeaders },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to clear external references");
      }
      setSelectedRefIds([]);
      if (selectedSetId && selectedSetId === setId && selectedParallelId) {
        await loadRefs(selectedSetId, selectedParallelId, selectedCardNumber);
      } else {
        setRefs([]);
      }
      await loadVariants();
      setStatus({
        type: "success",
        message: `Deleted ${Number(payload?.deleted ?? 0)} external refs for ${setId}. You can reseed now.`,
      });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to clear references" });
    } finally {
      setBusy(false);
    }
  }, [
    adminHeaders,
    loadRefs,
    loadVariants,
    selectedCardNumber,
    selectedParallelId,
    selectedSetFilter,
    selectedSetId,
    session?.token,
  ]);

  const chooseVariant = async (variant: VariantRow) => {
    setSelectedSetFilter(variant.setId);
    setSelectedSetId(variant.setId);
    setSelectedCardNumber(variant.cardNumber);
    setSelectedParallelId(variant.parallelId);
    await loadRefs(variant.setId, variant.parallelId, variant.cardNumber);
  };

  const deleteRef = async (id: string) => {
    if (!session?.token) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/variants/reference?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { ...adminHeaders },
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to delete reference");
      }
      setRefs((prev) => prev.filter((row) => row.id !== id));
      setSelectedRefIds((prev) => prev.filter((refId) => refId !== id));
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to delete reference" });
    } finally {
      setBusy(false);
    }
  };

  const updateSelectedQaStatus = async (qaStatus: "keep" | "pending" | "reject") => {
    if (!selectedRefIds.length) {
      setStatus({ type: "error", message: "Select at least one reference image." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/variants/reference", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...adminHeaders },
        body: JSON.stringify({ ids: selectedRefIds, qaStatus }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to update QA status");
      }
      await loadRefs();
      await loadVariants();
      setStatus({
        type: "success",
        message:
          qaStatus === "keep"
            ? "Marked selected images as done."
            : qaStatus === "reject"
            ? "Marked selected images as rejected."
            : "Re-opened selected images to pending.",
      });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to update QA status" });
    } finally {
      setBusy(false);
    }
  };

  const processSelected = async () => {
    if (!selectedRefIds.length) {
      setStatus({ type: "error", message: "Select at least one reference image." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/variants/reference/process", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders },
        body: JSON.stringify({ ids: selectedRefIds }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message ?? "PhotoRoom processing failed");
      }
      await loadRefs();
      setStatus({
        type: "success",
        message: `PhotoRoom processed ${payload?.processed ?? 0}, skipped ${payload?.skipped ?? 0}.`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "PhotoRoom processing failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const promoteSelected = async () => {
    if (!selectedRefIds.length) {
      setStatus({ type: "error", message: "Select at least one reference image." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/variants/reference/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders },
        body: JSON.stringify({ ids: selectedRefIds }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.message ?? "Promote to owned failed");
      }
      await loadRefs();
      await loadVariants();
      setStatus({
        type: "success",
        message: `Saved ${payload?.promoted ?? 0} refs. Already owned ${payload?.alreadyOwned ?? 0}. Skipped ${payload?.skipped ?? 0}.`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Promote to owned failed",
      });
    } finally {
      setBusy(false);
    }
  };

  const uploadReplacement = useCallback(async (file: File) => {
    if (!session?.token) return;
    if (!selectedSetId.trim() || !selectedParallelId.trim()) {
      setStatus({ type: "error", message: "Select a variant first." });
      return;
    }
    setBusy(true);
    try {
      const presign = await fetch("/api/admin/variants/reference/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders },
        body: JSON.stringify({
          setId: selectedSetId.trim(),
          parallelId: selectedParallelId.trim(),
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      const presignPayload = await presign.json().catch(() => ({}));
      if (!presign.ok) {
        throw new Error(presignPayload?.message ?? "Failed to prepare upload");
      }

      const upload = await fetch(presignPayload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!upload.ok) {
        throw new Error("Failed to upload image");
      }

      const createRef = await fetch("/api/admin/variants/reference", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders },
        body: JSON.stringify({
          setId: selectedSetId.trim(),
          parallelId: selectedParallelId.trim(),
          cardNumber: selectedCardNumber.trim() || "ALL",
          playerSeed: selectedVariant?.playerLabel || null,
          refType: newRefType,
          storageKey: presignPayload.storageKey,
          rawImageUrl: presignPayload.publicUrl,
          sourceUrl: sourceUrl.trim() || null,
        }),
      });
      const payload = await createRef.json().catch(() => ({}));
      if (!createRef.ok) {
        throw new Error(payload?.message ?? "Failed to save reference");
      }
      setStatus({ type: "success", message: "Replacement reference uploaded." });
      await loadRefs(selectedSetId.trim(), selectedParallelId.trim());
      await loadVariants();
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  }, [
    adminHeaders,
    loadRefs,
    loadVariants,
    newRefType,
    selectedCardNumber,
    selectedParallelId,
    selectedSetId,
    selectedVariant?.playerLabel,
    session?.token,
    sourceUrl,
  ]);

  const handleReplacementFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadReplacement(file);
    event.target.value = "";
  };

  useEffect(() => {
    if (!selectedSetId || !selectedParallelId) return;
    const handler = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []);
      const imageFromFiles = files.find((file) => file.type.startsWith("image/"));
      const imageFromItems =
        Array.from(event.clipboardData?.items || [])
          .filter((item) => item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .find(Boolean) ?? null;
      const blob = imageFromFiles ?? imageFromItems;
      if (!blob) return;
      event.preventDefault();
      const file = fileFromBlob(blob, `pasted-variant-ref-${Date.now()}`);
      setStatus({ type: "success", message: "Pasted image detected. Uploading..." });
      void uploadReplacement(file);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [selectedSetId, selectedParallelId, selectedCardNumber, uploadReplacement]);

  useEffect(() => {
    if (!selectedSetId || !selectedParallelId) return;
    void loadRefs(selectedSetId, selectedParallelId, selectedCardNumber);
  }, [loadRefs, selectedCardNumber, selectedParallelId, selectedSetId]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex flex-1 items-center justify-center text-sm uppercase tracking-[0.3em] text-slate-400">
          Checking access…
        </div>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Admin Access Only</p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow"
          >
            Sign In
          </button>
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-rose-300">Access Denied</p>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.28em] text-slate-200"
          >
            Sign Out
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Variant Ref QA</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="flex flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-between gap-4">
          <Link href="/admin/variants" className="text-xs uppercase tracking-[0.28em] text-slate-400 hover:text-white">
            ← Variants
          </Link>
          <h1 className="font-heading text-2xl uppercase tracking-[0.18em] text-white">Variant Ref QA</h1>
          <span className="text-xs uppercase tracking-[0.24em] text-slate-500">Clean bad reference images</span>
        </div>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[260px] flex-1 flex-col gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
              Set Search
              <input
                value={setSearch}
                onChange={(event) => setSetSearch(event.target.value)}
                placeholder="Search seeded sets..."
                className="rounded-xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadSetRows(setSearch)}
              disabled={busy}
              className="rounded-full border border-white/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-100 disabled:opacity-60"
            >
              Find Sets
            </button>
            <label className="flex min-w-[300px] flex-1 flex-col gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
              Active Set
              <select
                value={selectedSetFilter}
                onChange={(event) => setSelectedSetFilter(event.target.value)}
                className="rounded-xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              >
                {setRows.map((row) => (
                  <option key={row.setId} value={row.setId}>
                    {decodeHtml(row.setId)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {setRows.slice(0, 20).map((row) => {
              const active = row.setId === selectedSetFilter;
              return (
                <button
                  key={row.setId}
                  type="button"
                  onClick={() => setSelectedSetFilter(row.setId)}
                  className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.2em] ${
                    active
                      ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-100"
                      : "border-white/15 text-slate-300"
                  }`}
                >
                  {decodeHtml(row.setId)}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="flex min-w-[320px] flex-1 flex-col gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
              Variant Search (inside selected set)
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Player, card #, or parallel"
                className="rounded-xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadVariants()}
              disabled={busy || !selectedSetFilter}
              className="rounded-full border border-gold-500/60 bg-gold-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-night-900 disabled:opacity-60"
            >
              Load Variants
            </button>
            <button
              type="button"
              onClick={() => void clearSetExternalRefs()}
              disabled={busy || !selectedSetFilter}
              className="rounded-full border border-rose-400/60 bg-rose-500/10 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-rose-200 disabled:opacity-60"
            >
              Clear External Refs (Set)
            </button>
            <select
              value={variantTypeFilter}
              onChange={(event) => setVariantTypeFilter(event.target.value as "all" | "insert" | "parallel")}
              className="rounded-full border border-white/20 bg-night-800 px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200"
            >
              <option value="all">All Types</option>
              <option value="insert">Inserts</option>
              <option value="parallel">Parallels</option>
            </select>
            <label className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200">
              <input
                type="checkbox"
                checked={gapOnly}
                onChange={(event) => setGapOnly(event.target.checked)}
                className="h-4 w-4 accent-gold-400"
              />
              Gap Queue (&lt; Min Refs)
            </label>
            <label className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-200">
              Min Refs
              <input
                type="number"
                min={1}
                value={minRefs}
                onChange={(event) => setMinRefs(Math.max(1, Number(event.target.value) || 1))}
                className="w-16 rounded border border-white/20 bg-night-900 px-2 py-1 text-[11px] text-white"
              />
            </label>
          </div>
          <p className="mt-3 text-xs uppercase tracking-[0.22em] text-slate-400">
            Queue:{" "}
            <span className="text-emerald-200">
              {queueStats.remaining} remaining
            </span>{" "}
            · <span className="text-slate-200">{queueStats.done} done</span> ·{" "}
            <span className="text-slate-200">{queueStats.total} total</span>
          </p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-slate-500">
            Tip: after switching to eBay-only seeding, use <span className="text-rose-200">Clear External Refs (Set)</span>{" "}
            once to purge old Google/Amazon/Walmart rows before reseeding.
          </p>
          <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-night-800/80 text-[10px] uppercase tracking-[0.26em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Set</th>
                  <th className="px-3 py-2">Card #</th>
                  <th className="px-3 py-2">Parallel</th>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Photos</th>
                  <th className="px-3 py-2">Image</th>
                </tr>
              </thead>
              <tbody>
                {displayedVariants.map((variant) => {
                  const active =
                    variant.setId === selectedSetId &&
                    variant.parallelId === selectedParallelId &&
                    variant.cardNumber === selectedCardNumber;
                  const done = (variant.qaDoneCount || 0) > 0;
                  return (
                  <tr
                    key={variant.id}
                    className={`border-t border-white/5 ${done ? "bg-white/[0.03]" : ""} ${
                      active ? "bg-emerald-400/10 ring-1 ring-emerald-400/40" : ""
                    }`}
                  >
                    <td className="px-3 py-2">{decodeHtml(variant.setId)}</td>
                    <td className="px-3 py-2">{variant.cardNumber}</td>
                    <td className="px-3 py-2">{displayParallelLabel(variant.parallelId)}</td>
                    <td className="px-3 py-2 text-slate-300">{variant.playerLabel || "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${
                          done
                            ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
                            : "border-amber-400/50 bg-amber-500/10 text-amber-200"
                        }`}
                      >
                        {done ? "Done" : "Queue"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void chooseVariant(variant)}
                        className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.22em] ${
                          active
                            ? "border-emerald-400/80 bg-emerald-500/20 text-emerald-100"
                            : "border-white/20 text-slate-200"
                        }`}
                      >
                        QA This
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-200">{variant.referenceCount ?? 0}</td>
                    <td className="px-3 py-2">
                      {variant.previewImageUrl ? (
                        <a href={variant.previewImageUrl} target="_blank" rel="noreferrer">
                          <img
                            src={variant.previewImageUrl}
                            alt={`${displayParallelLabel(variant.parallelId)} thumb`}
                            className="h-10 w-10 rounded-md object-cover"
                          />
                        </a>
                      ) : (
                        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">No image</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {displayedVariants.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-500">
                      No rows for this filter yet. Pick a set and click Load Variants.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-400">
              Selected: <span className="text-slate-200">{decodeHtml(selectedSetId) || "—"}</span> ·{" "}
              <span className="text-slate-200">{displayParallelLabel(selectedParallelId) || "—"}</span> ·{" "}
              <span className="text-slate-200">#{selectedCardNumber || "—"}</span> ·{" "}
              <span className="text-slate-200">{selectedVariant?.playerLabel || "—"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadRefs()}
                disabled={busy || !selectedSetId || !selectedParallelId}
                className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-slate-200 disabled:opacity-60"
              >
                Refresh Refs
              </button>
              <button
                type="button"
                onClick={() => void promoteSelected()}
                disabled={busy || selectedRefIds.length === 0}
                className="rounded-full border border-violet-400/60 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-violet-200 disabled:opacity-60"
              >
                Save Image
              </button>
              <button
                type="button"
                onClick={() => void updateSelectedQaStatus("keep")}
                disabled={busy || selectedRefIds.length === 0}
                className="rounded-full border border-emerald-400/60 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-emerald-200 disabled:opacity-60"
              >
                Mark Selected Done
              </button>
              <button
                type="button"
                onClick={() => void updateSelectedQaStatus("pending")}
                disabled={busy || selectedRefIds.length === 0}
                className="rounded-full border border-amber-400/60 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-amber-200 disabled:opacity-60"
              >
                Reopen Selected
              </button>
              <button
                type="button"
                onClick={() => void processSelected()}
                disabled={busy || selectedRefIds.length === 0}
                className="rounded-full border border-sky-400/60 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-sky-200 disabled:opacity-60"
              >
                Process Selected (PhotoRoom)
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-night-800/60 p-3">
            <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-[10px] uppercase tracking-[0.22em] text-slate-500">
              Source URL (optional)
              <input
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://www.ebay.com/itm/..."
                className="rounded-lg border border-white/10 bg-night-900 px-3 py-2 text-xs text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.22em] text-slate-500">
              Ref Side
              <select
                value={newRefType}
                onChange={(event) => setNewRefType(event.target.value as "front" | "back")}
                className="rounded-lg border border-white/10 bg-night-900 px-3 py-2 text-xs text-white"
              >
                <option value="front">Front</option>
                <option value="back">Back</option>
              </select>
            </label>
            <label className="rounded-full border border-emerald-400/60 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-emerald-200">
              Upload Replacement
              <input type="file" accept="image/*" onChange={handleReplacementFile} className="hidden" />
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {refs.map((ref) => {
              const checked = selectedRefIds.includes(ref.id);
              const preview = ref.cropUrls?.[0] || ref.rawImageUrl;
              const playerLabelFromRef = String(ref.playerSeed || "").trim().split("::")[0]?.trim() || null;
              const playerLabel = playerLabelFromRef || selectedVariant?.playerLabel || null;
              const sourceHost = sourceHostFromUrl(ref.sourceUrl);
              const isEbaySource = sourceHost.endsWith("ebay.com");
              return (
                <article key={ref.id} className="rounded-xl border border-white/10 bg-night-800/60 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedRefIds((prev) =>
                            checked ? prev.filter((id) => id !== ref.id) : [...prev, ref.id]
                          )
                        }
                        className="h-4 w-4 accent-gold-400"
                      />
                      Select
                    </label>
                    <button
                      type="button"
                      onClick={() => void deleteRef(ref.id)}
                      className="rounded-full border border-rose-400/60 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-rose-200"
                    >
                      Remove
                    </button>
                  </div>
                  <a href={preview} target="_blank" rel="noreferrer" className="block">
                    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-night-900/70">
                      <img
                        src={preview}
                        alt={`${ref.displayLabel || ref.parallelId} ref`}
                        className="h-full w-full object-contain"
                      />
                    </div>
                  </a>
                  <div className="mt-3 space-y-2 text-[11px] text-slate-400">
                    <p className="text-sm font-semibold text-white">
                      Label: <span className="text-white">{ref.displayLabel || ref.parallelId}</span>
                    </p>
                    <p className="text-sm font-semibold text-white">
                      Card #: <span className="text-white">{ref.cardNumber || "—"}</span>
                    </p>
                    <p className="text-sm font-semibold text-white">
                      Player: <span className="text-white">{playerLabel || "—"}</span>
                    </p>
                    <p>
                      QA:{" "}
                      <span
                        className={
                          ref.qaStatus === "keep"
                            ? "text-emerald-300"
                            : ref.qaStatus === "reject"
                            ? "text-orange-300"
                            : "text-slate-300"
                        }
                      >
                        {ref.qaStatus || "pending"}
                      </span>
                    </p>
                    <p>
                      Owned: <span className="text-slate-300">{ref.ownedStatus || "external"}</span>
                    </p>
                    <p>
                      Side: <span className="text-slate-300">{ref.refType || "front"}</span>
                    </p>
                    <p>
                      Pair: <span className="font-mono text-slate-300">{ref.pairKey || "—"}</span>
                    </p>
                    <p>
                      Listing: <span className="font-mono text-slate-300">{ref.sourceListingId || "—"}</span>
                    </p>
                    <p>
                      Source Host:{" "}
                      <span className={isEbaySource ? "text-emerald-300" : "text-rose-300"}>
                        {sourceHost || "—"}
                      </span>
                    </p>
                    <p>ID: <span className="font-mono text-slate-300">{ref.id}</span></p>
                    <p>Quality: <span className="text-slate-300">{ref.qualityScore != null ? ref.qualityScore.toFixed(2) : "—"}</span></p>
                    {ref.sourceUrl ? (
                      <a href={ref.sourceUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:text-sky-200">
                        Source URL
                      </a>
                    ) : (
                      <p>Source: —</p>
                    )}
                  </div>
                </article>
              );
            })}
            {refs.length === 0 && (
              <div className="col-span-full rounded-xl border border-white/10 bg-night-800/40 p-6 text-center text-xs text-slate-500">
                No reference images for selected variant.
              </div>
            )}
          </div>
        </section>

        {status && (
          <p
            className={`rounded-xl border px-4 py-3 text-sm ${
              status.type === "success"
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                : "border-rose-400/40 bg-rose-500/10 text-rose-200"
            }`}
          >
            {status.message}
          </p>
        )}
      </div>
    </AppShell>
  );
}
