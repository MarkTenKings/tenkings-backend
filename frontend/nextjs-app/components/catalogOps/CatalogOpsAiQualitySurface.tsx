import Link from "next/link";
import { useRouter } from "next/router";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type WindowSummary = {
  processed: number;
  llmParsed: number;
  llmParseRatePct: number | null;
  fallbackUsed: number;
  fallbackRatePct: number | null;
  variantMatchOk: number;
  variantMatchOkRatePct: number | null;
  memoryAppliedCards: number;
  memoryAppliedRatePct: number | null;
};

type AttentionCard = {
  id: string;
  fileName: string;
  reviewStage: string | null;
  updatedAt: string;
  issues: string[];
  model: string | null;
  fallbackUsed: boolean;
  setId: string | null;
  programId: string | null;
};

type OverviewPayload = {
  generatedAt: string;
  live: {
    last24h: WindowSummary;
    last7d: WindowSummary;
  };
  teach: {
    lessons7d: number;
    corrections7d: number;
    accuracy7dPct: number | null;
    accuracyPrev7dPct: number | null;
    accuracyDeltaPct: number | null;
    topCorrectedFields: Array<{ field: string; count: number }>;
    recentCorrections: Array<{
      cardId: string;
      fileName: string | null;
      setId: string | null;
      programId: string | null;
      fieldName: string;
      modelValue: string | null;
      humanValue: string | null;
      createdAt: string;
    }>;
  };
  ops: {
    attentionCards: AttentionCard[];
  };
  evals: {
    totalCases: number;
    enabledCases: number;
    lastRun: {
      id: string;
      status: string;
      trigger: string;
      createdAt: string;
      completedAt: string | null;
      gatePass: boolean | null;
      failedChecks: string[];
      summary: {
        metrics?: {
          setTop1AccuracyPct?: number | null;
          insertParallelTop1AccuracyPct?: number | null;
          insertParallelTop3AccuracyPct?: number | null;
          unknownRatePct?: number | null;
          wrongSetRatePct?: number | null;
          crossSetMemoryDriftPct?: number | null;
        };
      } | null;
    } | null;
    recentRuns: Array<{
      id: string;
      status: string;
      trigger: string;
      createdAt: string;
      completedAt: string | null;
      gatePass: boolean | null;
      failedChecks: string[];
    }>;
  };
};

type CatalogOpsContext = {
  setId?: string;
  programId?: string;
  jobId?: string;
  tab?: string;
  queueFilter?: string;
};

type CatalogOpsAiQualitySurfaceProps = {
  context: CatalogOpsContext;
  buildHref: (pathname: string, overrides?: Partial<CatalogOpsContext>) => string;
};

function toPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(1)}%`;
}

function toDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function normalizeFilter(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function matchesFilter(candidate: string | null | undefined, filterValue: string): boolean {
  if (!filterValue) return true;
  const normalizedCandidate = normalizeFilter(candidate);
  return normalizedCandidate.includes(filterValue);
}

function withQueryParam(href: string, key: string, value: string) {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export default function CatalogOpsAiQualitySurface({ context, buildHref }: CatalogOpsAiQualitySurfaceProps) {
  const router = useRouter();
  const { session } = useSession();
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [runningEval, setRunningEval] = useState(false);

  const [setIdInput, setSetIdInput] = useState(context.setId || "");
  const [programIdInput, setProgramIdInput] = useState(context.programId || "");

  useEffect(() => {
    setSetIdInput(context.setId || "");
  }, [context.setId]);

  useEffect(() => {
    setProgramIdInput(context.programId || "");
  }, [context.programId]);

  const loadOverview = useCallback(async () => {
    if (!session?.token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/ai-ops/overview", {
        headers: adminHeaders,
      });
      const payload = (await response.json().catch(() => null)) as OverviewPayload | { message?: string } | null;
      if (!response.ok || !payload || !("generatedAt" in payload)) {
        throw new Error((payload && "message" in payload && payload.message) || "Failed to load AI quality data");
      }
      setData(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load AI quality data");
    } finally {
      setLoading(false);
    }
  }, [adminHeaders, session?.token]);

  const retryCard = useCallback(
    async (cardId: string) => {
      if (!session?.token) {
        setError("Session token missing. Sign in again.");
        return;
      }
      setRetrying((prev) => ({ ...prev, [cardId]: true }));
      try {
        const response = await fetch(`/api/admin/cards/${cardId}/ocr-suggest`, {
          headers: adminHeaders,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(payload?.message ?? "Retry failed");
        }
        await loadOverview();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Retry failed");
      } finally {
        setRetrying((prev) => ({ ...prev, [cardId]: false }));
      }
    },
    [adminHeaders, loadOverview, session?.token]
  );

  const runEvalNow = useCallback(async () => {
    if (!session?.token) {
      setError("Session token missing. Sign in again.");
      return;
    }
    setRunningEval(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/ai-ops/evals/run", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ trigger: "manual" }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Eval run failed");
      }
      await loadOverview();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Eval run failed");
    } finally {
      setRunningEval(false);
    }
  }, [loadOverview, session?.token]);

  useEffect(() => {
    if (!data && !loading && session?.token) {
      void loadOverview();
    }
  }, [data, loadOverview, loading, session?.token]);

  const applyContext = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextHref = buildHref("/admin/catalog-ops/ai-quality", {
      setId: setIdInput.trim() || undefined,
      programId: programIdInput.trim() || undefined,
    });
    void router.replace(nextHref, undefined, { shallow: true });
  };

  const clearContext = () => {
    const nextHref = buildHref("/admin/catalog-ops/ai-quality", {
      setId: undefined,
      programId: undefined,
      jobId: undefined,
      tab: undefined,
      queueFilter: undefined,
    });
    void router.replace(nextHref, undefined, { shallow: true });
  };

  const activeSetFilter = useMemo(() => normalizeFilter(context.setId), [context.setId]);
  const activeProgramFilter = useMemo(() => normalizeFilter(context.programId), [context.programId]);

  const filteredAttentionCards = useMemo(() => {
    if (!data) return [];
    return data.ops.attentionCards.filter((card) => {
      const setMatch = matchesFilter(card.setId, activeSetFilter);
      const programMatch = matchesFilter(card.programId, activeProgramFilter);
      return setMatch && programMatch;
    });
  }, [activeProgramFilter, activeSetFilter, data]);

  const filteredCorrections = useMemo(() => {
    if (!data) return [];
    return data.teach.recentCorrections.filter((row) => {
      const setMatch = matchesFilter(row.setId, activeSetFilter);
      const programMatch = matchesFilter(row.programId, activeProgramFilter);
      return setMatch && programMatch;
    });
  }, [activeProgramFilter, activeSetFilter, data]);

  const ingestHref = useMemo(
    () =>
      withQueryParam(
        buildHref("/admin/catalog-ops/ingest-draft", {
          setId: context.setId,
          programId: context.programId,
        }),
        "step",
        "draft-approval"
      ),
    [buildHref, context.programId, context.setId]
  );

  const variantStudioHref = useMemo(
    () =>
      buildHref("/admin/catalog-ops/variant-studio", {
        setId: context.setId,
        programId: context.programId,
        tab: "reference-qa",
      }),
    [buildHref, context.programId, context.setId]
  );

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-violet-300">AI Quality Integration</p>
            <h2 className="mt-1 font-heading text-2xl uppercase tracking-[0.12em] text-white">Failure Analysis + Ops Routing</h2>
            <p className="mt-1 text-sm text-slate-300">
              Analyze eval failures, corrections, and attention queue with shared set/program context.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadOverview()}
              disabled={loading}
              className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => void runEvalNow()}
              disabled={runningEval}
              className="rounded-full border border-emerald-400/55 bg-emerald-400/12 px-4 py-2 text-xs uppercase tracking-[0.16em] text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runningEval ? "Running Eval..." : "Run Eval"}
            </button>
            <Link
              href={buildHref("/admin/ai-ops")}
              className="rounded-full border border-gold-500/55 bg-gold-500/15 px-4 py-2 text-xs uppercase tracking-[0.16em] text-gold-100 transition hover:bg-gold-500/25"
            >
              Open Legacy AI Ops
            </Link>
          </div>
        </div>

        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={applyContext}>
          <input
            value={setIdInput}
            onChange={(event) => setSetIdInput(event.target.value)}
            placeholder="Set filter (exact or partial)"
            className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
          />
          <input
            value={programIdInput}
            onChange={(event) => setProgramIdInput(event.target.value)}
            placeholder="Program/Card Type filter (insert set)"
            className="h-11 rounded-xl border border-white/15 bg-night-950/70 px-3 text-sm text-white outline-none focus:border-gold-500/70"
          />
          <div className="md:col-span-2 flex flex-wrap gap-2">
            <button
              type="submit"
              className="h-10 rounded-xl border border-gold-500/60 bg-gold-500 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-night-900 transition hover:bg-gold-400"
            >
              Apply Filters
            </button>
            <button
              type="button"
              onClick={clearContext}
              className="h-10 rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40"
            >
              Clear Filters
            </button>
            <Link
              href={ingestHref}
              className="inline-flex h-10 items-center rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40"
            >
              Open Ingest & Draft
            </Link>
            <Link
              href={variantStudioHref}
              className="inline-flex h-10 items-center rounded-xl border border-white/20 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:border-white/40"
            >
              Open Variant Studio
            </Link>
          </div>
        </form>

        <p className="mt-3 text-xs text-slate-400">
          Active filters: set=<span className="text-slate-200">{context.setId || "-"}</span> · program=
          <span className="text-slate-200">{context.programId || "-"}</span>
        </p>
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      </section>

      {data ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Eval Gate</p>
              <p
                className={`mt-2 text-2xl font-semibold ${
                  data.evals.lastRun?.gatePass === true
                    ? "text-emerald-200"
                    : data.evals.lastRun?.gatePass === false
                    ? "text-rose-200"
                    : "text-slate-200"
                }`}
              >
                {data.evals.lastRun?.gatePass === true
                  ? "PASS"
                  : data.evals.lastRun?.gatePass === false
                  ? "FAIL"
                  : data.evals.lastRun
                  ? "UNKNOWN"
                  : "NO RUN"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Enabled cases: {data.evals.enabledCases}/{data.evals.totalCases}
              </p>
            </article>
            <article className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Failure Focus</p>
              <p className="mt-2 text-2xl font-semibold text-amber-200">{filteredAttentionCards.length}</p>
              <p className="mt-1 text-xs text-slate-400">Attention cards matching active filters.</p>
            </article>
            <article className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Correction Rows</p>
              <p className="mt-2 text-2xl font-semibold text-sky-200">{filteredCorrections.length}</p>
              <p className="mt-1 text-xs text-slate-400">Recent human corrections matching active filters.</p>
            </article>
            <article className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Variant Match OK</p>
              <p className="mt-2 text-2xl font-semibold text-white">{toPercent(data.live.last7d.variantMatchOkRatePct)}</p>
              <p className="mt-1 text-xs text-slate-400">7d pipeline quality baseline.</p>
            </article>
          </section>

          <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Eval Gate + Recent Runs</p>
                <p className="mt-1 text-sm text-slate-300">
                  Latest run:{" "}
                  {data.evals.lastRun
                    ? `#${data.evals.lastRun.id.slice(0, 8)} · ${toDateTime(
                        data.evals.lastRun.completedAt ?? data.evals.lastRun.createdAt
                      )}`
                    : "none"}
                </p>
              </div>
            </div>

            {data.evals.lastRun ? (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3 text-sm text-slate-200">
                    Set top-1: {toPercent(data.evals.lastRun.summary?.metrics?.setTop1AccuracyPct ?? null)}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3 text-sm text-slate-200">
                    Insert/parallel top-1:{" "}
                    {toPercent(data.evals.lastRun.summary?.metrics?.insertParallelTop1AccuracyPct ?? null)}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3 text-sm text-slate-200">
                    Insert/parallel top-3:{" "}
                    {toPercent(data.evals.lastRun.summary?.metrics?.insertParallelTop3AccuracyPct ?? null)}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3 text-sm text-slate-200">
                    Unknown rate: {toPercent(data.evals.lastRun.summary?.metrics?.unknownRatePct ?? null)}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3 text-sm text-slate-200">
                    Wrong-set rate: {toPercent(data.evals.lastRun.summary?.metrics?.wrongSetRatePct ?? null)}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-night-950/60 p-3 text-sm text-slate-200">
                    Cross-set drift: {toPercent(data.evals.lastRun.summary?.metrics?.crossSetMemoryDriftPct ?? null)}
                  </div>
                </div>

                {data.evals.lastRun.failedChecks.length > 0 ? (
                  <div className="rounded-2xl border border-rose-400/40 bg-rose-400/10 p-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-rose-200">Failed checks</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {data.evals.lastRun.failedChecks.map((check) => (
                        <span
                          key={check}
                          className="rounded-full border border-rose-400/45 bg-rose-500/10 px-3 py-1 text-xs uppercase tracking-[0.14em] text-rose-100"
                        >
                          {check}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-100">
                    Eval gate checks passed.
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">No eval run found yet. Run one to activate release gating.</p>
            )}

            {data.evals.recentRuns.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Run</th>
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Status</th>
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">When</th>
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Gate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.evals.recentRuns.map((run) => (
                      <tr key={run.id} className="border-b border-white/5">
                        <td className="px-3 py-2 text-sm text-slate-200">
                          #{run.id.slice(0, 8)} · {run.trigger}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-200">{run.status}</td>
                        <td className="px-3 py-2 text-sm text-slate-300">{toDateTime(run.completedAt ?? run.createdAt)}</td>
                        <td
                          className={`px-3 py-2 text-sm ${
                            run.gatePass === true ? "text-emerald-300" : run.gatePass === false ? "text-rose-300" : "text-slate-300"
                          }`}
                        >
                          {run.gatePass === true ? "PASS" : run.gatePass === false ? "FAIL" : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Correction Telemetry</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <article className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Lessons 7d</p>
                <p className="mt-1 text-lg font-semibold text-white">{data.teach.lessons7d}</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Corrections 7d</p>
                <p className="mt-1 text-lg font-semibold text-white">{data.teach.corrections7d}</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Accuracy 7d</p>
                <p className="mt-1 text-lg font-semibold text-white">{toPercent(data.teach.accuracy7dPct)}</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-night-950/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Accuracy Delta</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {data.teach.accuracyDeltaPct == null ? "-" : `${data.teach.accuracyDeltaPct.toFixed(1)} pts`}
                </p>
              </article>
            </div>

            <div className="mt-4">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Top corrected fields</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {data.teach.topCorrectedFields.length === 0 ? (
                  <span className="text-sm text-slate-400">No corrections in this window.</span>
                ) : (
                  data.teach.topCorrectedFields.map((item) => (
                    <span
                      key={item.field}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.15em] text-slate-200"
                    >
                      {item.field} ({item.count})
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Card</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Set</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Program</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Field</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Model</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Human</th>
                    <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCorrections.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-sm text-slate-400" colSpan={7}>
                        No correction rows matched the active filters.
                      </td>
                    </tr>
                  ) : (
                    filteredCorrections.map((row) => {
                      const ingestRowHref = withQueryParam(
                        buildHref("/admin/catalog-ops/ingest-draft", {
                          setId: row.setId || undefined,
                          programId: row.programId || undefined,
                        }),
                        "step",
                        "draft-approval"
                      );
                      const variantRowHref = buildHref("/admin/catalog-ops/variant-studio", {
                        setId: row.setId || undefined,
                        programId: row.programId || undefined,
                        tab: "reference-qa",
                      });
                      return (
                        <tr key={`${row.cardId}-${row.fieldName}-${row.createdAt}`} className="border-b border-white/5 align-top">
                          <td className="px-3 py-2 text-sm text-slate-100">{row.fileName ?? row.cardId}</td>
                          <td className="px-3 py-2 text-sm text-slate-300">{row.setId ?? "-"}</td>
                          <td className="px-3 py-2 text-sm text-slate-300">{row.programId ?? "-"}</td>
                          <td className="px-3 py-2 text-sm text-slate-100">{row.fieldName}</td>
                          <td className="px-3 py-2 text-sm text-rose-200">{row.modelValue ?? "-"}</td>
                          <td className="px-3 py-2 text-sm text-emerald-200">{row.humanValue ?? "-"}</td>
                          <td className="px-3 py-2 text-xs text-slate-300">
                            <div className="flex flex-wrap gap-2">
                              <Link className="text-gold-200 underline hover:text-gold-100" href={ingestRowHref}>
                                Ingest & Draft
                              </Link>
                              <Link className="text-sky-200 underline hover:text-sky-100" href={variantRowHref}>
                                Variant Studio
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-night-900/70 p-4 shadow-card">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Attention Queue</p>
            <div className="mt-4 space-y-3">
              {filteredAttentionCards.length === 0 ? (
                <p className="text-sm text-slate-400">No attention cards matched the active filters.</p>
              ) : (
                filteredAttentionCards.map((card) => {
                  const ingestCardHref = withQueryParam(
                    buildHref("/admin/catalog-ops/ingest-draft", {
                      setId: card.setId || undefined,
                      programId: card.programId || undefined,
                    }),
                    "step",
                    "draft-approval"
                  );
                  const variantCardHref = buildHref("/admin/catalog-ops/variant-studio", {
                    setId: card.setId || undefined,
                    programId: card.programId || undefined,
                    tab: "reference-qa",
                  });
                  return (
                    <article key={card.id} className="rounded-2xl border border-white/10 bg-night-950/65 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{card.fileName}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                            {card.reviewStage ?? "Unknown stage"} · {toDateTime(card.updatedAt)}
                          </p>
                          <p className="mt-1 text-xs text-slate-300">
                            Set: {card.setId ?? "-"} · Program: {card.programId ?? "-"} · Model: {card.model ?? "-"}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {card.issues.map((issue) => (
                              <span
                                key={`${card.id}-${issue}`}
                                className="rounded-full border border-rose-400/40 bg-rose-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-rose-200"
                              >
                                {issue}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void retryCard(card.id)}
                            disabled={retrying[card.id] === true}
                            className="rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-night-900 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {retrying[card.id] === true ? "Retrying..." : "Retry OCR"}
                          </button>
                          <Link
                            href={ingestCardHref}
                            className="rounded-full border border-white/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-white/40"
                          >
                            Ingest & Draft
                          </Link>
                          <Link
                            href={variantCardHref}
                            className="rounded-full border border-white/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-white/40"
                          >
                            Variant Studio
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-night-900/70 p-6 shadow-card">
          <p className="text-sm text-slate-300">Load OCR/LLM health and failure-analysis metrics.</p>
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="mt-4 rounded-full border border-gold-500/60 bg-gold-500 px-6 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-night-900 transition hover:bg-gold-400"
          >
            Load AI Quality
          </button>
        </section>
      )}
    </div>
  );
}
