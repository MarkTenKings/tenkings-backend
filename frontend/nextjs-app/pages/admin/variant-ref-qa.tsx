import Head from "next/head";
import Link from "next/link";
import { ChangeEvent, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type VariantRow = {
  id: string;
  setId: string;
  cardNumber: string;
  parallelId: string;
  parallelFamily: string | null;
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
};

type StatusMessage = { type: "success" | "error"; message: string } | null;

export default function VariantRefQaPage() {
  const { session, loading, ensureSession, logout } = useSession();
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const [query, setQuery] = useState("2025-26 Topps Basketball");
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [refs, setRefs] = useState<ReferenceRow[]>([]);
  const [selectedSetId, setSelectedSetId] = useState("");
  const [selectedParallelId, setSelectedParallelId] = useState("");
  const [selectedRefIds, setSelectedRefIds] = useState<string[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusMessage>(null);

  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const loadVariants = async () => {
    if (!session?.token) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/variants?q=${encodeURIComponent(query.trim())}&limit=500`, {
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
  };

  const loadRefs = async (setId?: string, parallelId?: string) => {
    if (!session?.token) return;
    const currentSetId = (setId ?? selectedSetId).trim();
    const currentParallelId = (parallelId ?? selectedParallelId).trim();
    if (!currentSetId || !currentParallelId) {
      setStatus({ type: "error", message: "Select a variant first." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/variants/reference?setId=${encodeURIComponent(currentSetId)}&parallelId=${encodeURIComponent(currentParallelId)}&limit=500`,
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
  };

  const chooseVariant = async (variant: VariantRow) => {
    setSelectedSetId(variant.setId);
    setSelectedParallelId(variant.parallelId);
    await loadRefs(variant.setId, variant.parallelId);
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

  const deleteSelected = async () => {
    if (!selectedRefIds.length) {
      setStatus({ type: "error", message: "Select at least one reference image." });
      return;
    }
    setBusy(true);
    try {
      for (const id of selectedRefIds) {
        const res = await fetch(`/api/admin/variants/reference?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { ...adminHeaders },
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? `Failed to delete ${id}`);
        }
      }
      setRefs((prev) => prev.filter((row) => !selectedRefIds.includes(row.id)));
      setSelectedRefIds([]);
      setStatus({ type: "success", message: "Deleted selected references." });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Bulk delete failed" });
    } finally {
      setBusy(false);
    }
  };

  const uploadReplacement = async (file: File) => {
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
          rawImageUrl: presignPayload.publicUrl,
          sourceUrl: sourceUrl.trim() || null,
        }),
      });
      const payload = await createRef.json().catch(() => ({}));
      if (!createRef.ok) {
        throw new Error(payload?.message ?? "Failed to save reference");
      }
      setRefs((prev) => [payload.reference as ReferenceRow, ...prev]);
      setStatus({ type: "success", message: "Replacement reference uploaded." });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  };

  const handleReplacementFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadReplacement(file);
    event.target.value = "";
  };

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
            <label className="flex min-w-[320px] flex-1 flex-col gap-2 text-xs uppercase tracking-[0.22em] text-slate-400">
              Variant search
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="rounded-xl border border-white/10 bg-night-800 px-3 py-2 text-sm text-white"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadVariants()}
              disabled={busy}
              className="rounded-full border border-gold-500/60 bg-gold-500 px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-night-900 disabled:opacity-60"
            >
              Load Variants
            </button>
          </div>
          <div className="mt-4 max-h-72 overflow-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-night-800/80 text-[10px] uppercase tracking-[0.26em] text-slate-500">
                <tr>
                  <th className="px-3 py-2">Set</th>
                  <th className="px-3 py-2">Card #</th>
                  <th className="px-3 py-2">Parallel</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((variant) => (
                  <tr key={variant.id} className="border-t border-white/5">
                    <td className="px-3 py-2">{variant.setId}</td>
                    <td className="px-3 py-2">{variant.cardNumber}</td>
                    <td className="px-3 py-2">{variant.parallelId}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void chooseVariant(variant)}
                        className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-slate-200"
                      >
                        QA This
                      </button>
                    </td>
                  </tr>
                ))}
                {variants.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-xs text-slate-500">
                      Load variants to start QA.
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
              Selected: <span className="text-slate-200">{selectedSetId || "—"}</span> ·{" "}
              <span className="text-slate-200">{selectedParallelId || "—"}</span>
            </div>
            <div className="flex gap-2">
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
                onClick={() => void deleteSelected()}
                disabled={busy || selectedRefIds.length === 0}
                className="rounded-full border border-rose-400/60 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-rose-200 disabled:opacity-60"
              >
                Delete Selected ({selectedRefIds.length})
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
            <label className="rounded-full border border-emerald-400/60 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-emerald-200">
              Upload Replacement
              <input type="file" accept="image/*" onChange={handleReplacementFile} className="hidden" />
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {refs.map((ref) => {
              const checked = selectedRefIds.includes(ref.id);
              const preview = ref.cropUrls?.[0] || ref.rawImageUrl;
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
                  <a href={preview} target="_blank" rel="noreferrer">
                    <img src={preview} alt={`${ref.parallelId} ref`} className="h-52 w-full rounded-lg object-cover" />
                  </a>
                  <div className="mt-2 space-y-1 text-[11px] text-slate-400">
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

