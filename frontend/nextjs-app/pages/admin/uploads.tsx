import Head from "next/head";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";

type UploadStatus = "pending" | "recorded" | "error";

interface UploadResult {
  fileName: string;
  assetId: string | null;
  status: UploadStatus;
  message?: string;
  publicUrl?: string;
}

interface BatchAssignmentSummary {
  packDefinitionId: string;
  name: string;
  category: string;
  tier: string;
  price: number;
  count: number;
}

interface BatchSummary {
  id: string;
  label: string | null;
  status: string;
  totalCount: number;
  processedCount: number;
  createdAt: string;
  updatedAt: string;
  latestAssetAt: string | null;
  assignments: BatchAssignmentSummary[];
}

const operatorKey = process.env.NEXT_PUBLIC_OPERATOR_KEY;

const buildAdminHeaders = (token?: string) => {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (operatorKey) {
    headers["X-Operator-Key"] = operatorKey;
  }
  return headers;
};

const CATEGORY_LABELS: Record<string, string> = {
  SPORTS: "Sports",
  POKEMON: "Pokémon",
  COMICS: "Comics",
};

const TIER_LABELS: Record<string, string> = {
  TIER_25: "$25 Pack",
  TIER_50: "$50 Pack",
  TIER_100: "$100 Pack",
  TIER_500: "$500 Pack",
};

export default function AdminUploads() {
  const { session, loading, ensureSession, logout } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [batchesError, setBatchesError] = useState<string | null>(null);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const missingConfig =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_ADMIN_USER_IDS === undefined &&
    process.env.NEXT_PUBLIC_ADMIN_PHONES === undefined;

  const fetchBatches = useCallback(
    async (signal?: AbortSignal) => {
      if (!session?.token || !isAdmin) {
        return;
      }

      setBatchesLoading(true);
      setBatchesError(null);
      try {
        const res = await fetch("/api/admin/batches?limit=20", {
          headers: buildAdminHeaders(session.token),
          signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load batches");
        }
        const data = (await res.json()) as { batches: BatchSummary[] };
        setBatches(data.batches);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load batches";
        setBatchesError(message);
      } finally {
        if (!signal?.aborted) {
          setBatchesLoading(false);
        }
      }
    },
    [session?.token, isAdmin]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchBatches(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [fetchBatches]);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) {
      setFiles([]);
      return;
    }
    setFiles(Array.from(event.target.files));
    setResults([]);
    setFlash(null);
    setBatchId(null);
  };

  const submitUploads = async (event: FormEvent) => {
    event.preventDefault();
    if (!files.length) {
      setFlash("Select one or more images first.");
      return;
    }

    const token = session?.token;
    if (!token) {
      setFlash("Your session expired. Sign in again and retry.");
      return;
    }

    setSubmitting(true);
    setFlash(null);
    const nextResults: UploadResult[] = [];
    let activeBatchId: string | null = null;

    for (const file of files) {
      const base: UploadResult = { fileName: file.name, assetId: null, status: "pending" };
      try {
        const presignBody: {
          fileName: string;
          size: number;
          mimeType: string;
          batchId?: string;
        } = {
          fileName: file.name,
          size: file.size,
          mimeType: file.type,
        };

        if (activeBatchId) {
          presignBody.batchId = activeBatchId;
        }

        const presignRes = await fetch("/api/admin/uploads/presign", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildAdminHeaders(token),
          },
          body: JSON.stringify(presignBody),
        });

        if (!presignRes.ok) {
          const payload = await presignRes.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to generate upload URL");
        }

        const presignPayload: {
          assetId: string;
          batchId: string;
          uploadUrl: string;
          fields: Record<string, string>;
          publicUrl: string;
          storageMode: string;
        } = await presignRes.json();

        activeBatchId = presignPayload.batchId;

        if (presignPayload.storageMode === "local") {
          const uploadRes = await fetch(presignPayload.uploadUrl, {
            method: "PUT",
            headers: {
              ...buildAdminHeaders(token),
              "Content-Type": file.type,
            },
            body: file,
          });

          if (!uploadRes.ok) {
            const text = await uploadRes.text().catch(() => "");
            throw new Error(text || "Failed to store file");
          }
        } else {
          throw new Error("Unsupported storage mode returned by server");
        }

        const completeRes = await fetch("/api/admin/uploads/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildAdminHeaders(token),
          },
          body: JSON.stringify({
            assetId: presignPayload.assetId,
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
          }),
        });

        if (!completeRes.ok) {
          const payload = await completeRes.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to record upload");
        }

        nextResults.push({
          ...base,
          assetId: presignPayload.assetId,
          status: "recorded",
          publicUrl: presignPayload.publicUrl,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        nextResults.push({ ...base, status: "error", message });
      }
    }

    setResults(nextResults);
    setSubmitting(false);
    setBatchId(activeBatchId);
    setFlash(nextResults.every((result) => result.status === "recorded") ? "Upload complete." : "Uploads finished with some errors.");
    fetchBatches().catch(() => undefined);
  };

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
            Use your Ten Kings phone number. Only approved operators can enter the processing console.
          </p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
          {missingConfig && (
            <p className="mt-6 max-w-md text-xs text-rose-300/80">
              Set <code className="font-mono">NEXT_PUBLIC_ADMIN_USER_IDS</code> or <code className="font-mono">NEXT_PUBLIC_ADMIN_PHONES</code> to authorize operators.
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
          <title>Ten Kings · Admin Uploads</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Admin Uploads</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="flex flex-1 flex-col gap-10 px-6 py-12">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.32em] text-violet-300">Processing Console</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Upload Batches</h1>
          <p className="max-w-3xl text-sm text-slate-300">
            Upload raw card imagery, create batches, and review intake history. OCR, AI classification, and valuation will plug into
            these batches next.
          </p>
          <Link className="inline-flex text-xs uppercase tracking-[0.28em] text-slate-400 transition hover:text-white" href="/admin">
            ← Back to console
          </Link>
        </header>

        <section className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-night-900/70 p-6">
          <form className="flex flex-col gap-4" onSubmit={submitUploads}>
            <label className="flex flex-col gap-2 text-sm uppercase tracking-[0.24em] text-slate-300">
              Select card images
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={onFileChange}
                className="rounded-2xl border border-dashed border-slate-500/60 bg-night-900/60 p-6 text-xs uppercase tracking-[0.3em] text-slate-400"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-fit items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-white/10 disabled:text-slate-500"
            >
              {submitting ? "Uploading…" : "Upload (mock)"}
            </button>
          </form>

          {flash && <p className="text-sm text-slate-300">{flash}</p>}

          {batchId && (
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
              Batch ID: <span className="font-mono tracking-normal text-slate-200">{batchId}</span>
            </p>
          )}

          {files.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Selected files</p>
              <ul className="grid gap-2 text-sm text-slate-300">
                {files.map((file) => (
                  <li key={file.name} className="rounded-2xl border border-white/10 bg-night-800/70 px-4 py-3">
                    {file.name} <span className="text-xs text-slate-500">· {Math.round(file.size / 1024)} KB</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Upload results (mock)</p>
              <ul className="grid gap-2 text-sm text-slate-300">
                {results.map((result, index) => (
                  <li
                    key={`${result.fileName}-${index}`}
                    className="rounded-2xl border border-white/10 bg-night-800/70 px-4 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <span>{result.fileName}</span>
                      <span
                        className={
                          result.status === "recorded"
                            ? "text-emerald-300"
                            : result.status === "error"
                              ? "text-rose-300"
                              : "text-slate-400"
                        }
                      >
                        {result.status}
                      </span>
                    </div>
                    {result.assetId && <p className="text-xs text-slate-500">assetId: {result.assetId}</p>}
                    {result.publicUrl && (
                      <p className="text-xs text-slate-500">
                        preview: <span className="break-all">{result.publicUrl}</span>
                      </p>
                    )}
                    {result.message && <p className="text-xs text-rose-300">{result.message}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/50 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Recent uploads</p>
              <h2 className="font-heading text-2xl uppercase tracking-[0.18em] text-white">Batches</h2>
            </div>
            <Link
              href="/admin"
              className="text-xs uppercase tracking-[0.28em] text-slate-500 transition hover:text-slate-200"
            >
              Dashboard
            </Link>
          </div>

          {batchesLoading && <p className="text-sm text-slate-400">Loading batches…</p>}
          {batchesError && <p className="text-sm text-rose-300">{batchesError}</p>}

          {!batchesLoading && !batchesError && batches.length === 0 && (
            <p className="text-sm text-slate-400">No batches yet. Upload card images to start a new batch.</p>
          )}

          {!batchesLoading && batches.length > 0 && (
            <ul className="grid gap-3">
              {batches.map((batch) => (
                <li key={batch.id} className="rounded-2xl border border-white/10 bg-night-900/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
                          {batch.label ?? "Untitled Batch"}
                        </p>
                        <h3 className="font-heading text-lg uppercase tracking-[0.18em] text-white">{batch.id.slice(0, 8)}</h3>
                        <p className="text-xs text-slate-500">
                          Created {new Date(batch.createdAt).toLocaleString()} · {batch.totalCount} uploads
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right text-xs text-slate-400">
                          <p>
                            Status: <span className={`text-slate-200 ${batch.status === "READY" ? "text-emerald-300" : "text-slate-200"}`}>
                              {batch.status}
                            </span>
                          </p>
                          <p>
                            {batch.status === "ASSIGNED" ? "Assigned" : "Processed"} {batch.processedCount}/{batch.totalCount}
                          </p>
                          {batch.latestAssetAt && (
                            <p>Last upload {new Date(batch.latestAssetAt).toLocaleString()}</p>
                          )}
                        </div>
                        <Link
                          href={`/admin/batches/${batch.id}`}
                          className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                        >
                          View
                        </Link>
                      </div>
                    </div>
                    {batch.assignments.length > 0 && (
                      <div className="mt-3 rounded-2xl border border-white/10 bg-night-900/60 p-3 text-xs text-slate-300">
                        <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Pack Assignments</p>
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {batch.assignments.map((assignment) => (
                            <li
                              key={`${batch.id}-${assignment.packDefinitionId}`}
                              className="rounded-full border border-emerald-400/30 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-emerald-200"
                            >
                              {CATEGORY_LABELS[assignment.category] ?? assignment.category} · {TIER_LABELS[assignment.tier] ?? assignment.tier}
                              <span className="ml-2 text-slate-300">×{assignment.count}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
