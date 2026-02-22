import Head from "next/head";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type LoadResponse =
  | {
      sets: SetSummaryRow[];
      total: number;
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
  const [actionBusySetId, setActionBusySetId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [auditSnippet, setAuditSnippet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadedRef = useRef(false);
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const loadSets = useCallback(
    async (nextQuery = query, nextIncludeArchived = includeArchived) => {
      if (!session?.token || !isAdmin) return;
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

        const nextRows = payload.sets ?? [];
        setRows(nextRows);
        setTotal(payload.total ?? nextRows.length);
        setStatus(`Loaded ${nextRows.length} set rows.`);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load set data");
      } finally {
        setBusy(false);
      }
    },
    [adminHeaders, includeArchived, isAdmin, query, session?.token]
  );

  useEffect(() => {
    if (!session?.token || !isAdmin) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadSets();
  }, [isAdmin, loadSets, session?.token]);

  const onSearch = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nextQuery = queryInput.trim();
      setQuery(nextQuery);
      void loadSets(nextQuery, includeArchived);
    },
    [includeArchived, loadSets, queryInput]
  );

  const updateArchiveState = useCallback(
    async (row: SetSummaryRow, nextArchived: boolean) => {
      if (!session?.token || !isAdmin) return;
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
    [adminHeaders, isAdmin, session?.token]
  );

  const variantTotal = useMemo(
    () => rows.reduce((sum, row) => sum + Math.max(0, row.variantCount || 0), 0),
    [rows]
  );
  const referenceTotal = useMemo(
    () => rows.reduce((sum, row) => sum + Math.max(0, row.referenceCount || 0), 0),
    [rows]
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
          <Link
            className="inline-flex text-xs uppercase tracking-[0.28em] text-slate-400 transition hover:text-white"
            href="/admin"
          >
            ← Back to console
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
                onChange={(event) => {
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
              disabled={busy}
              className="h-11 rounded-xl border border-gold-500/60 bg-gold-500 px-5 text-xs font-semibold uppercase tracking-[0.2em] text-night-900 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Loading..." : "Search"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadSets(query, includeArchived)}
              className="h-11 rounded-xl border border-white/20 px-5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Refresh
            </button>
          </form>

          {status && <p className="mb-3 text-xs text-emerald-300">{status}</p>}
          {auditSnippet && <p className="mb-3 text-xs text-sky-300">{auditSnippet}</p>}
          {error && <p className="mb-3 text-xs text-rose-300">{error}</p>}

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm text-slate-200">
              <thead>
                <tr>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Set</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Variants</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Refs</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Draft</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Last Seed</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Updated</th>
                  <th className="border-b border-white/10 px-3 py-2 font-medium text-slate-300">Archive</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.setId}>
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
                      <button
                        type="button"
                        onClick={() => void updateArchiveState(row, !row.archived)}
                        disabled={busy || actionBusySetId === row.setId}
                        className={`rounded-lg border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          row.archived
                            ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                            : "border-amber-400/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                        }`}
                      >
                        {actionBusySetId === row.setId ? "Saving..." : row.archived ? "Unarchive" : "Archive"}
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !busy && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                      No sets matched this query.
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
