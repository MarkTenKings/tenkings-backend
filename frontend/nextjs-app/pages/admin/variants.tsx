import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { useSession } from "../../hooks/useSession";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type VariantRow = {
  id: string;
  setId: string;
  cardNumber: string;
  parallelId: string;
  parallelFamily: string | null;
  keywords: string[];
  oddsInfo: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReferenceRow = {
  id: string;
  setId: string;
  parallelId: string;
  sourceUrl: string | null;
  rawImageUrl: string;
  cropUrls: string[];
  qualityScore: number | null;
  createdAt: string;
  updatedAt: string;
};

type RecentSetRow = {
  setId: string;
  lastSeedStatus: string | null;
  lastSeedAt: string | null;
  variantCount: number;
};

type StatusMessage = { type: "success" | "error"; message: string } | null;

const parseKeywords = (value: string) =>
  value
    .split(/\s*[|;]\s*|\s*,\s*/g)
    .map((entry) => entry.trim())
    .filter(Boolean);

const SAMPLE_CSV = `setId,cardNumber,parallelId,parallelFamily,keywords,oddsInfo
2025 Panini Prizm Basketball,188,Silver,Refractor,Silver|Prizm,odds hobby 1:11|blaster 1:11
2025 Panini Prizm Basketball,188,Cracked Ice,Cracked Ice,Cracked Ice|Ice,odds hobby 1:69|blaster 1:396
`;

export default function AdminVariants() {
  const { session, loading, ensureSession, logout } = useSession();
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [references, setReferences] = useState<ReferenceRow[]>([]);
  const [referenceStatus, setReferenceStatus] = useState<{
    total: number;
    pending: number;
    processed: number;
  } | null>(null);
  const [refForm, setRefForm] = useState({
    setId: "",
    parallelId: "",
    sourceUrl: "",
  });
  const [seedForm, setSeedForm] = useState({
    setId: "",
    parallelId: "",
    query: "",
    limit: "20",
    tbs: "",
  });
  const [recentSets, setRecentSets] = useState<RecentSetRow[]>([]);
  const [seedSetProgress, setSeedSetProgress] = useState<{
    total: number;
    completed: number;
    inserted: number;
    skipped: number;
    failed: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusMessage>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    setId: "",
    cardNumber: "",
    parallelId: "",
    parallelFamily: "",
    keywords: "",
    oddsInfo: "",
  });
  const [csvText, setCsvText] = useState("");
  const [csvMode, setCsvMode] = useState("upsert");
  const [bulkCsvFile, setBulkCsvFile] = useState<File | null>(null);
  const [bulkZipFile, setBulkZipFile] = useState<File | null>(null);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const buildSeedQuery = (setId: string, cardNumber: string, parallelId: string) => {
    const normalizedCardNumber = String(cardNumber || "").trim();
    const cardToken =
      normalizedCardNumber && normalizedCardNumber.toUpperCase() !== "ALL" ? `#${normalizedCardNumber}` : "";
    return [setId.trim(), cardToken, parallelId.trim(), "trading card"].filter(Boolean).join(" ");
  };

  const fetchVariants = async (search?: string) => {
    if (!session) return;
    setBusy(true);
    try {
      const q = (search ?? query).trim();
      const res = await fetch(`/api/admin/variants?q=${encodeURIComponent(q)}&limit=200`, {
        headers: {
          ...adminHeaders,
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to load variants");
      }
      setVariants(payload.variants ?? []);
      setStatus(null);
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to load variants" });
    } finally {
      setBusy(false);
    }
  };

  const fetchReferences = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/variants/reference?limit=200`, {
        headers: {
          ...adminHeaders,
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to load references");
      }
      setReferences(payload.references ?? []);
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load references",
      });
    } finally {
      setBusy(false);
    }
  };

  const fetchReferenceStatus = async () => {
    if (!session) return;
    try {
      const res = await fetch(`/api/admin/variants/reference/status`, {
        headers: {
          ...adminHeaders,
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to load reference status");
      }
      setReferenceStatus(payload);
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load reference status",
      });
    }
  };

  const fetchRecentSets = async () => {
    if (!session) return;
    try {
      const res = await fetch(`/api/admin/variants/sets?limit=60`, {
        headers: {
          ...adminHeaders,
        },
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to load recent sets");
      }
      setRecentSets(payload.sets ?? []);
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to load recent sets",
      });
    }
  };

  useEffect(() => {
    if (!session?.token || !isAdmin) return;
    let cancelled = false;

    const run = async () => {
      try {
        const [setsRes, refStatusRes] = await Promise.all([
          fetch(`/api/admin/variants/sets?limit=60`, {
            headers: {
              ...adminHeaders,
            },
          }),
          fetch(`/api/admin/variants/reference/status`, {
            headers: {
              ...adminHeaders,
            },
          }),
        ]);

        const [setsPayload, refStatusPayload] = await Promise.all([setsRes.json(), refStatusRes.json()]);
        if (cancelled) return;

        if (setsRes.ok) {
          setRecentSets(setsPayload.sets ?? []);
        }

        if (refStatusRes.ok) {
          setReferenceStatus(refStatusPayload ?? null);
        }
      } catch {
        // Non-blocking bootstrapping fetches.
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [session?.token, isAdmin, adminHeaders]);

  const handleAdd = async () => {
    if (!form.setId || !form.cardNumber || !form.parallelId) {
      setStatus({ type: "error", message: "Set ID, Card #, and Parallel ID are required." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/variants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders,
        },
        body: JSON.stringify({
          setId: form.setId.trim(),
          cardNumber: form.cardNumber.trim(),
          parallelId: form.parallelId.trim(),
          parallelFamily: form.parallelFamily.trim() || null,
          keywords: parseKeywords(form.keywords),
          oddsInfo: form.oddsInfo.trim() || null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Failed to add variant");
      }
      setVariants((prev) => [payload.variant, ...prev]);
      setForm({ setId: "", cardNumber: "", parallelId: "", parallelFamily: "", keywords: "", oddsInfo: "" });
      setStatus({ type: "success", message: "Variant added." });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Failed to add variant" });
    } finally {
      setBusy(false);
    }
  };

  const handleCsvFile = async (file: File) => {
    const text = await file.text();
    setCsvText(text);
  };

  const handleImport = async () => {
    if (!csvText.trim()) {
      setStatus({ type: "error", message: "Paste or upload CSV first." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/variants/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders,
        },
        body: JSON.stringify({ csv: csvText, mode: csvMode }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Import failed");
      }
      setStatus({ type: "success", message: `Imported ${payload.imported} rows, skipped ${payload.skipped}.` });
      await fetchVariants();
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Import failed" });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkImport = async () => {
    if (!bulkCsvFile) {
      setStatus({ type: "error", message: "CSV file is required for bulk import." });
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("csv", bulkCsvFile);
      if (bulkZipFile) {
        form.append("zip", bulkZipFile);
      }
      const res = await fetch("/api/admin/variants/bulk-import", {
        method: "POST",
        headers: {
          ...adminHeaders,
        },
        body: form,
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Bulk import failed");
      }
      setStatus({
        type: "success",
        message: `Imported ${payload.variantsUpserted} variants, ${payload.imagesImported} images (skipped ${payload.imagesSkipped}).`,
      });
      await fetchVariants();
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Bulk import failed" });
    } finally {
      setBusy(false);
    }
  };

  const handleReferenceUpload = async (file: File) => {
    if (!refForm.setId.trim() || !refForm.parallelId.trim()) {
      setStatus({ type: "error", message: "Set ID and Parallel ID are required for reference uploads." });
      return;
    }
    setBusy(true);
    try {
      const presign = await fetch("/api/admin/variants/reference/presign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders,
        },
        body: JSON.stringify({
          setId: refForm.setId.trim(),
          parallelId: refForm.parallelId.trim(),
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      const presignPayload = await presign.json();
      if (!presign.ok) {
        throw new Error(presignPayload?.message ?? "Failed to prepare upload");
      }

      await fetch(presignPayload.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });

      const createRef = await fetch("/api/admin/variants/reference", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders,
        },
        body: JSON.stringify({
          setId: refForm.setId.trim(),
          parallelId: refForm.parallelId.trim(),
          rawImageUrl: presignPayload.publicUrl,
          sourceUrl: refForm.sourceUrl.trim() || null,
        }),
      });
      const createPayload = await createRef.json();
      if (!createRef.ok) {
        throw new Error(createPayload?.message ?? "Failed to save reference");
      }
      setReferences((prev) => [createPayload.reference, ...prev]);
      setStatus({ type: "success", message: "Reference image saved." });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to upload reference image",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSeedImages = async () => {
    if (!seedForm.setId.trim() || !seedForm.parallelId.trim() || !seedForm.query.trim()) {
      setStatus({ type: "error", message: "Set ID, Parallel ID, and query are required for seeding." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/variants/reference/seed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders,
        },
        body: JSON.stringify({
          setId: seedForm.setId.trim(),
          parallelId: seedForm.parallelId.trim(),
          query: seedForm.query.trim(),
          limit: Number(seedForm.limit) || 20,
          tbs: seedForm.tbs.trim() || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message ?? "Seed failed");
      }
      setStatus({
        type: "success",
        message: `Seeded ${payload.inserted} images (skipped ${payload.skipped}).`,
      });
      await fetchReferences();
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Seed failed" });
    } finally {
      setBusy(false);
    }
  };

  const handleRecentSetSelect = (setId: string) => {
    const nextSetId = setId.trim();
    if (!nextSetId) return;
    setSeedForm((prev) => ({
      ...prev,
      setId: nextSetId,
      parallelId: "",
      query: "",
    }));
    setRefForm((prev) => ({
      ...prev,
      setId: nextSetId,
    }));
    setForm((prev) => ({
      ...prev,
      setId: nextSetId,
    }));
    setQuery(nextSetId);
  };

  const handleSeedSetImages = async () => {
    const targetSetId = seedForm.setId.trim();
    if (!targetSetId) {
      setStatus({ type: "error", message: "Select a Set ID first." });
      return;
    }

    setBusy(true);
    setSeedSetProgress({
      total: 0,
      completed: 0,
      inserted: 0,
      skipped: 0,
      failed: 0,
    });

    try {
      const variantRes = await fetch(`/api/admin/variants?q=${encodeURIComponent(targetSetId)}&limit=5000`, {
        headers: {
          ...adminHeaders,
        },
      });
      const variantPayload = await variantRes.json();
      if (!variantRes.ok) {
        throw new Error(variantPayload?.message ?? "Failed to load variants for set.");
      }

      const allVariants = Array.isArray(variantPayload?.variants) ? (variantPayload.variants as VariantRow[]) : [];
      const setVariants = allVariants.filter(
        (variant) => String(variant.setId || "").trim().toLowerCase() === targetSetId.toLowerCase()
      );
      if (setVariants.length === 0) {
        throw new Error("No variants were found for this set.");
      }

      const normalizedLimit = Math.min(50, Math.max(1, Number(seedForm.limit) || 20));
      let completed = 0;
      let inserted = 0;
      let skipped = 0;
      let failed = 0;

      setSeedSetProgress({
        total: setVariants.length,
        completed: 0,
        inserted: 0,
        skipped: 0,
        failed: 0,
      });

      for (const variant of setVariants) {
        const autoQuery = buildSeedQuery(targetSetId, variant.cardNumber, variant.parallelId);
        try {
          const res = await fetch("/api/admin/variants/reference/seed", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...adminHeaders,
            },
            body: JSON.stringify({
              setId: targetSetId,
              cardNumber: variant.cardNumber,
              parallelId: variant.parallelId,
              query: autoQuery,
              limit: normalizedLimit,
              tbs: seedForm.tbs.trim() || undefined,
            }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) {
            failed += 1;
          } else {
            inserted += Number(payload?.inserted ?? 0);
            skipped += Number(payload?.skipped ?? 0);
          }
        } catch {
          failed += 1;
        }

        completed += 1;
        setSeedSetProgress({
          total: setVariants.length,
          completed,
          inserted,
          skipped,
          failed,
        });
      }

      await fetchRecentSets();
      await fetchReferenceStatus();
      await fetchReferences();

      if (failed > 0) {
        setStatus({
          type: "error",
          message: `Seeded set with partial failures: ${completed}/${setVariants.length} variants processed, inserted ${inserted}, skipped ${skipped}, failed variants ${failed}.`,
        });
      } else {
        setStatus({
          type: "success",
          message: `Seeded all variants for ${targetSetId}: ${setVariants.length} variants processed, inserted ${inserted}, skipped ${skipped}.`,
        });
      }
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to seed set images.",
      });
    } finally {
      setBusy(false);
    }
  };

  const renderContent = () => {
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
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
        </div>
      );
    }

    if (!isAdmin) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">
            You do not have admin rights
          </h1>
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

    return (
      <div className="flex flex-1 flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-gold-300">Ten Kings · Variant Taxonomy</p>
          <h1 className="font-heading text-3xl uppercase tracking-[0.18em] text-white">Card Variants</h1>
          <p className="text-sm text-slate-400">
            Manage variant definitions used by the visual matcher and comp pipeline.
          </p>
        </header>

        {status && (
          <div
            className={`rounded-2xl border px-4 py-3 text-xs uppercase tracking-[0.2em] ${
              status.type === "success"
                ? "border-emerald-400/60 text-emerald-200"
                : "border-rose-400/60 text-rose-200"
            }`}
          >
            {status.message}
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
            <h2 className="text-xs uppercase tracking-[0.3em] text-slate-400">Add Variant</h2>
            <div className="mt-4 grid gap-3">
              <input
                placeholder="Set ID (e.g., 2025 Panini Prizm Basketball)"
                value={form.setId}
                onChange={(event) => setForm((prev) => ({ ...prev, setId: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <input
                placeholder="Card # (e.g., 188)"
                value={form.cardNumber}
                onChange={(event) => setForm((prev) => ({ ...prev, cardNumber: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <input
                placeholder="Parallel ID (e.g., Silver)"
                value={form.parallelId}
                onChange={(event) => setForm((prev) => ({ ...prev, parallelId: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <input
                placeholder="Parallel Family (optional)"
                value={form.parallelFamily}
                onChange={(event) => setForm((prev) => ({ ...prev, parallelFamily: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <input
                placeholder="Keywords (comma or | separated)"
                value={form.keywords}
                onChange={(event) => setForm((prev) => ({ ...prev, keywords: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <input
                placeholder="Odds info (optional, not used for comps)"
                value={form.oddsInfo}
                onChange={(event) => setForm((prev) => ({ ...prev, oddsInfo: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={busy}
                className="rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow disabled:opacity-60"
              >
                Add Variant
              </button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
            <h2 className="text-xs uppercase tracking-[0.3em] text-slate-400">CSV Import</h2>
            <p className="mt-2 text-xs text-slate-400">
              Required headers: <span className="font-mono">setId, cardNumber, parallelId</span>. Optional:
              <span className="font-mono"> parallelFamily, keywords, oddsInfo</span>.
            </p>
            <a
              href="/templates/variant-template.csv"
              className="mt-2 inline-flex text-[10px] uppercase tracking-[0.28em] text-sky-300 hover:text-sky-200"
            >
              Download Template
            </a>
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300">
                Upload CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleCsvFile(file).catch(() => undefined);
                  }}
                />
              </label>
              <select
                value={csvMode}
                onChange={(event) => setCsvMode(event.target.value)}
                className="rounded-full border border-white/10 bg-night-800 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-200"
              >
                <option value="upsert">Upsert</option>
                <option value="create">Create Only</option>
              </select>
              <button
                type="button"
                onClick={() => setCsvText(SAMPLE_CSV)}
                className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-200"
              >
                Load Sample
              </button>
              <button
                type="button"
                onClick={() => setCsvText("")}
                className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-200"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={busy}
                className="rounded-full border border-sky-400/60 bg-sky-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-sky-200 disabled:opacity-60"
              >
                Import CSV
              </button>
            </div>
            <textarea
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              placeholder="Paste CSV here…"
              className="mt-3 h-40 w-full rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-xs text-white"
            />
          </div>

          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
            <h2 className="text-xs uppercase tracking-[0.3em] text-slate-400">Reference Image Upload</h2>
            <div className="mt-4 grid gap-3">
              <input
                placeholder="Set ID"
                value={refForm.setId}
                onChange={(event) => setRefForm((prev) => ({ ...prev, setId: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <input
                placeholder="Parallel ID"
                value={refForm.parallelId}
                onChange={(event) => setRefForm((prev) => ({ ...prev, parallelId: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <input
                placeholder="Source URL (optional)"
                value={refForm.sourceUrl}
                onChange={(event) => setRefForm((prev) => ({ ...prev, sourceUrl: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <label className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300">
                Upload Reference Image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleReferenceUpload(file).catch(() => undefined);
                  }}
                />
              </label>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
            <h2 className="text-xs uppercase tracking-[0.3em] text-slate-400">Seed Images (SerpApi)</h2>
            <p className="mt-2 text-xs text-slate-400">
              Select a recent seeded set, then run one-click full-set image seeding or targeted single-parallel seeding.
            </p>
            <div className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <select
                  value={seedForm.setId}
                  onChange={(event) => handleRecentSetSelect(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                >
                  <option value="">Select recent set…</option>
                  {recentSets.map((set) => (
                    <option key={set.setId} value={set.setId}>
                      {set.setId}
                      {set.lastSeedAt ? ` · ${new Date(set.lastSeedAt).toLocaleString()}` : ""}
                      {set.variantCount ? ` · variants ${set.variantCount}` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void fetchRecentSets()}
                  disabled={busy}
                  className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-200 disabled:opacity-60"
                >
                  Refresh Sets
                </button>
              </div>
              <input
                placeholder="Set ID"
                value={seedForm.setId}
                onChange={(event) => setSeedForm((prev) => ({ ...prev, setId: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <input
                placeholder="Parallel ID"
                value={seedForm.parallelId}
                onChange={(event) => setSeedForm((prev) => ({ ...prev, parallelId: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <input
                placeholder="Search query (e.g., 2025 Prizm #188 Silver)"
                value={seedForm.query}
                onChange={(event) => setSeedForm((prev) => ({ ...prev, query: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
              <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                <input
                  placeholder="Limit (default 20)"
                  value={seedForm.limit}
                  onChange={(event) => setSeedForm((prev) => ({ ...prev, limit: event.target.value }))}
                  className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                />
                <input
                  placeholder="tbs (optional, e.g., isz:l)"
                  value={seedForm.tbs}
                  onChange={(event) => setSeedForm((prev) => ({ ...prev, tbs: event.target.value }))}
                  className="rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
                />
              </div>
              {seedSetProgress && (
                <p className="text-xs uppercase tracking-[0.18em] text-emerald-200">
                  Set progress: {seedSetProgress.completed}/{seedSetProgress.total} variants · inserted{" "}
                  {seedSetProgress.inserted} · skipped {seedSetProgress.skipped} · failed {seedSetProgress.failed}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSeedSetImages}
                  disabled={busy || !seedForm.setId.trim()}
                  className="rounded-full border border-gold-400/60 bg-gold-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-gold-200 disabled:opacity-60"
                >
                  Seed Entire Set
                </button>
                <button
                  type="button"
                  onClick={handleSeedImages}
                  disabled={busy}
                  className="rounded-full border border-sky-400/60 bg-sky-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-sky-200 disabled:opacity-60"
                >
                  Seed Single Parallel
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xs uppercase tracking-[0.3em] text-slate-400">Bulk Import (CSV + ZIP)</h2>
              <p className="mt-2 text-xs text-slate-400">
                Upload a CSV and optional ZIP of images. Filenames must match the CSV imageFilename column.
              </p>
            </div>
            <a
              href="/templates/variant-template.csv"
              className="text-[10px] uppercase tracking-[0.28em] text-sky-300 hover:text-sky-200"
            >
              Download Template
            </a>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <label className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300">
              Upload CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => setBulkCsvFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <label className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300">
              Upload ZIP (optional)
              <input
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => setBulkZipFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              onClick={handleBulkImport}
              disabled={busy}
              className="rounded-full border border-emerald-400/60 bg-emerald-500/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-emerald-200 disabled:opacity-60"
            >
              Run Bulk Import
            </button>
          </div>
          <div className="mt-3 text-[10px] uppercase tracking-[0.28em] text-slate-500">
            CSV: {bulkCsvFile?.name ?? "none"} · ZIP: {bulkZipFile?.name ?? "none"}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search set, card #, or parallel"
              className="flex-1 rounded-2xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
            />
            <button
              type="button"
              onClick={() => fetchVariants()}
              disabled={busy}
              className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-200 disabled:opacity-60"
            >
              Search
            </button>
            <button
              type="button"
              onClick={() => fetchVariants("")}
              disabled={busy}
              className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-200 disabled:opacity-60"
            >
              Load All
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                <tr>
                  <th className="py-2">Set</th>
                  <th className="py-2">Card #</th>
                  <th className="py-2">Parallel</th>
                  <th className="py-2">Family</th>
                  <th className="py-2">Keywords</th>
                  <th className="py-2">Odds</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((variant) => (
                  <tr key={variant.id} className="border-t border-white/5">
                    <td className="py-2 pr-4 text-white">{variant.setId}</td>
                    <td className="py-2 pr-4">{variant.cardNumber}</td>
                    <td className="py-2 pr-4">{variant.parallelId}</td>
                    <td className="py-2 pr-4">{variant.parallelFamily ?? "—"}</td>
                    <td className="py-2 pr-4 text-slate-400">
                      {variant.keywords?.length ? variant.keywords.join(", ") : "—"}
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{variant.oddsInfo ?? "—"}</td>
                  </tr>
                ))}
                {variants.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-xs text-slate-500">
                      No variants loaded yet. Use search or import CSV.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-xs uppercase tracking-[0.3em] text-slate-400">Reference Images</h2>
              {referenceStatus && (
                <p className="text-[11px] uppercase tracking-[0.25em] text-slate-500">
                  Total {referenceStatus.total} · Pending {referenceStatus.pending} · Processed {referenceStatus.processed}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/variant-ref-qa"
                className="rounded-full border border-emerald-400/50 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-emerald-200"
              >
                Open QA Page
              </Link>
              <button
                type="button"
                onClick={() => fetchReferenceStatus()}
                disabled={busy}
                className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-200 disabled:opacity-60"
              >
                Refresh Status
              </button>
              <button
                type="button"
                onClick={() => fetchReferences()}
                disabled={busy}
                className="rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-200 disabled:opacity-60"
              >
                Load References
              </button>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                <tr>
                  <th className="py-2">Set</th>
                  <th className="py-2">Parallel</th>
                  <th className="py-2">Image</th>
                  <th className="py-2">Quality</th>
                </tr>
              </thead>
              <tbody>
                {references.map((ref) => (
                  <tr key={ref.id} className="border-t border-white/5">
                    <td className="py-2 pr-4 text-white">{ref.setId}</td>
                    <td className="py-2 pr-4">{ref.parallelId}</td>
                    <td className="py-2 pr-4">
                      <a
                        href={ref.rawImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-300 hover:text-sky-200"
                      >
                        View
                      </a>
                    </td>
                    <td className="py-2 pr-4 text-slate-400">
                      {ref.qualityScore != null ? ref.qualityScore.toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
                {references.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-xs text-slate-500">
                      No reference images yet. Upload one to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Variants</title>
        <meta name="robots" content="noindex" />
      </Head>
      {renderContent()}
    </AppShell>
  );
}
