import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";

type WindowSummary = {
  processed: number;
  llmParsed: number;
  llmParseRatePct: number | null;
  fallbackUsed: number;
  fallbackRatePct: number | null;
  multimodalUsed: number;
  multimodalUsedRatePct: number | null;
  multimodalHighDetail: number;
  multimodalHighDetailRatePct: number | null;
  jsonObjectFormat: number;
  jsonObjectRatePct: number | null;
  variantMatchOk: number;
  variantMatchOkRatePct: number | null;
  memoryAppliedCards: number;
  memoryAppliedRatePct: number | null;
  memoryAppliedEntries: number;
  photoFrontOk: number;
  photoBackOk: number;
  photoTiltOk: number;
  photoFrontOkRatePct: number | null;
  photoBackOkRatePct: number | null;
  photoTiltOkRatePct: number | null;
  latency: {
    totalMsP50: number | null;
    totalMsP95: number | null;
    ocrMsP50: number | null;
    ocrMsP95: number | null;
    llmMsP50: number | null;
    llmMsP95: number | null;
  };
};

type AttentionCard = {
  id: string;
  fileName: string;
  reviewStage: string | null;
  updatedAt: string;
  issues: string[];
  model: string | null;
  fallbackUsed: boolean;
};

type OverviewPayload = {
  generatedAt: string;
  config: {
    ocrProvider: "google-vision";
    llmEndpoint: "responses";
    primaryModel: string;
    fallbackModel: string;
  };
  live: {
    last24h: WindowSummary;
    last7d: WindowSummary;
  };
  models: {
    byModel: Array<{ model: string; count: number }>;
    byFormat: Array<{ format: string; count: number }>;
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
      fieldName: string;
      modelValue: string | null;
      humanValue: string | null;
      createdAt: string;
    }>;
  };
  teachRegions: {
    templateSaves24h: number;
    templateSaves7d: number;
    clientErrors24h: number;
    clientErrors7d: number;
    snapshots7d: number;
    templatesUpdated7d: number;
    avgRegionsPerSave7d: number | null;
    recentTemplateSaves: Array<{
      id: string;
      cardId: string | null;
      fileName: string | null;
      setId: string | null;
      layoutClass: string | null;
      photoSide: string | null;
      regionCount: number;
      templatesUpdated: number;
      snapshotImageUrl: string | null;
      createdAt: string;
    }>;
    recentClientErrors: Array<{
      id: string;
      cardId: string | null;
      fileName: string | null;
      setId: string | null;
      layoutClass: string | null;
      photoSide: string | null;
      action: string | null;
      message: string | null;
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
        totalCases?: number;
        passedCases?: number;
        failedCases?: number;
        casePassRatePct?: number | null;
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

type EvalCase = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  cardAssetId: string;
  enabled: boolean;
  tags: string[];
  expected: {
    setName?: string | null;
    insertSet?: string | null;
    parallel?: string | null;
  };
  hints: {
    year?: string | null;
    manufacturer?: string | null;
    sport?: string | null;
    productLine?: string | null;
    setId?: string | null;
    layoutClass?: string | null;
  };
  updatedAt: string;
};

type NewEvalCaseDraft = {
  slug: string;
  title: string;
  cardAssetId: string;
  expectedSetName: string;
  expectedInsertSet: string;
  expectedParallel: string;
  hintSetId: string;
  hintYear: string;
  hintManufacturer: string;
  hintSport: string;
  hintProductLine: string;
  hintLayoutClass: string;
};

const EMPTY_NEW_CASE_DRAFT: NewEvalCaseDraft = {
  slug: "",
  title: "",
  cardAssetId: "",
  expectedSetName: "",
  expectedInsertSet: "",
  expectedParallel: "",
  hintSetId: "",
  hintYear: "",
  hintManufacturer: "",
  hintSport: "",
  hintProductLine: "",
  hintLayoutClass: "",
};

function toPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(1)}%`;
}

function toMs(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${value.toFixed(0)} ms`;
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

function StatRow({
  label,
  left,
  right,
}: {
  label: string;
  left: string | number;
  right: string | number;
}) {
  return (
    <tr className="border-b border-white/5 align-top">
      <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</th>
      <td className="px-3 py-2 text-sm text-slate-100">{left}</td>
      <td className="px-3 py-2 text-sm text-slate-100">{right}</td>
    </tr>
  );
}

export default function AiOpsPage() {
  const { session, loading: sessionLoading, ensureSession, logout } = useSession();
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [runningEval, setRunningEval] = useState(false);
  const [evalCases, setEvalCases] = useState<EvalCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesLoadedOnce, setCasesLoadedOnce] = useState(false);
  const [caseSaving, setCaseSaving] = useState(false);
  const [newEvalCase, setNewEvalCase] = useState<NewEvalCaseDraft>(EMPTY_NEW_CASE_DRAFT);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const loadOverview = useCallback(async () => {
    if (!session?.token) {
      setError("Session token missing. Sign in again.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/ai-ops/overview", {
        headers: adminHeaders,
      });
      const payload = (await response.json()) as OverviewPayload | { message?: string };
      if (!response.ok || !("generatedAt" in payload)) {
        const message = "message" in payload && payload.message ? payload.message : "Failed to load AI Ops data";
        throw new Error(message);
      }
      setData(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load AI Ops data");
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

  const loadEvalCases = useCallback(async () => {
    if (!session?.token) {
      setError("Session token missing. Sign in again.");
      return;
    }
    setCasesLoading(true);
    try {
      const response = await fetch("/api/admin/ai-ops/evals/cases", {
        headers: adminHeaders,
      });
      const payload = (await response.json().catch(() => null)) as
        | { cases?: EvalCase[]; message?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Failed to load eval cases");
      }
      setEvalCases(Array.isArray(payload?.cases) ? payload.cases : []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load eval cases");
    } finally {
      setCasesLoading(false);
      setCasesLoadedOnce(true);
    }
  }, [adminHeaders, session?.token]);

  const toggleEvalCase = useCallback(
    async (slug: string, enabled: boolean) => {
      if (!session?.token) {
        setError("Session token missing. Sign in again.");
        return;
      }
      setCaseSaving(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/ai-ops/evals/cases", {
          method: "PATCH",
          headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ slug, enabled }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { cases?: EvalCase[]; message?: string }
          | null;
        if (!response.ok) {
          throw new Error(payload?.message ?? "Failed to update eval case");
        }
        if (Array.isArray(payload?.cases)) {
          setEvalCases(payload.cases);
        } else {
          await loadEvalCases();
        }
        await loadOverview();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to update eval case");
      } finally {
        setCaseSaving(false);
      }
    },
    [loadEvalCases, loadOverview, session?.token]
  );

  const saveEvalCase = useCallback(async () => {
    if (!session?.token) {
      setError("Session token missing. Sign in again.");
      return;
    }
    if (!newEvalCase.slug.trim() || !newEvalCase.title.trim() || !newEvalCase.cardAssetId.trim()) {
      setError("slug, title, and card asset id are required to save an eval case");
      return;
    }
    setCaseSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/ai-ops/evals/cases", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          slug: newEvalCase.slug,
          title: newEvalCase.title,
          cardAssetId: newEvalCase.cardAssetId,
          enabled: true,
          expected: {
            ...(newEvalCase.expectedSetName.trim() ? { setName: newEvalCase.expectedSetName } : {}),
            ...(newEvalCase.expectedInsertSet.trim() ? { insertSet: newEvalCase.expectedInsertSet } : {}),
            ...(newEvalCase.expectedParallel.trim() ? { parallel: newEvalCase.expectedParallel } : {}),
          },
          hints: {
            ...(newEvalCase.hintSetId.trim() ? { setId: newEvalCase.hintSetId } : {}),
            ...(newEvalCase.hintYear.trim() ? { year: newEvalCase.hintYear } : {}),
            ...(newEvalCase.hintManufacturer.trim() ? { manufacturer: newEvalCase.hintManufacturer } : {}),
            ...(newEvalCase.hintSport.trim() ? { sport: newEvalCase.hintSport } : {}),
            ...(newEvalCase.hintProductLine.trim() ? { productLine: newEvalCase.hintProductLine } : {}),
            ...(newEvalCase.hintLayoutClass.trim() ? { layoutClass: newEvalCase.hintLayoutClass } : {}),
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { caseItem?: EvalCase; message?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "Failed to save eval case");
      }
      setNewEvalCase(EMPTY_NEW_CASE_DRAFT);
      await loadEvalCases();
      await loadOverview();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save eval case");
    } finally {
      setCaseSaving(false);
    }
  }, [loadEvalCases, loadOverview, newEvalCase, session?.token]);

  useEffect(() => {
    if (!sessionLoading && session && isAdmin) {
      if (!data && !loading) {
        void loadOverview();
      }
      if (!casesLoadedOnce && !casesLoading) {
        void loadEvalCases();
      }
    }
  }, [casesLoadedOnce, casesLoading, data, isAdmin, loadEvalCases, loadOverview, loading, session, sessionLoading]);

  const renderSignIn = () => (
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

  const renderDenied = () => (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
      <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
      <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
      <button
        type="button"
        onClick={logout}
        className="rounded-full border border-white/20 px-8 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
      >
        Sign Out
      </button>
    </div>
  );

  const renderMain = () => {
    if (!data && !loading) {
      return (
        <div className="rounded-3xl border border-white/10 bg-night-800/65 p-6">
          <p className="text-sm text-slate-300">Load OCR/LLM health and teach-memory metrics for the last 24 hours and 7 days.</p>
          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
          <button
            type="button"
            onClick={loadOverview}
            className="mt-4 rounded-full border border-gold-500/60 bg-gold-500 px-6 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-night-900 transition hover:bg-gold-400"
          >
            Load Dashboard
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-night-800/65 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Live OCR/LLM Health</p>
              <h1 className="mt-2 font-heading text-3xl uppercase tracking-[0.12em] text-white">AI Ops Dashboard</h1>
              <p className="mt-2 text-sm text-slate-300">Generated {toDateTime(data?.generatedAt)}.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadOverview}
                disabled={loading}
                className="rounded-full border border-slate-500/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Refreshing..." : "Refresh"}
              </button>
              <button
                type="button"
                onClick={runEvalNow}
                disabled={runningEval}
                className="rounded-full border border-emerald-400/55 bg-emerald-400/12 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runningEval ? "Running Eval..." : "Run Eval Now"}
              </button>
              <Link
                href="/admin/uploads"
                className="rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-night-900 transition hover:bg-gold-400"
              >
                Open Add Cards
              </Link>
              <Link
                href="/admin/kingsreview"
                className="rounded-full border border-sky-400/50 bg-sky-400/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-200 transition hover:bg-sky-400/20"
              >
                Open KingsReview
              </Link>
            </div>
          </div>
          {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        </section>

        {data ? (
          <>
            <section className="grid gap-4 lg:grid-cols-3">
              <article className="rounded-3xl border border-white/10 bg-night-800/65 p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">OCR Provider</p>
                <p className="mt-2 text-xl font-semibold text-white">{data.config.ocrProvider}</p>
              </article>
              <article className="rounded-3xl border border-white/10 bg-night-800/65 p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Primary LLM</p>
                <p className="mt-2 text-xl font-semibold text-white">{data.config.primaryModel}</p>
              </article>
              <article className="rounded-3xl border border-white/10 bg-night-800/65 p-4">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Fallback LLM</p>
                <p className="mt-2 text-xl font-semibold text-white">{data.config.fallbackModel}</p>
              </article>
            </section>

            <section className="rounded-3xl border border-white/10 bg-night-800/65 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Eval Gate</p>
                  <p className="mt-1 text-sm text-slate-200">
                    Enabled cases: {data.evals.enabledCases} / {data.evals.totalCases}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Latest run</p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      data.evals.lastRun?.gatePass === true
                        ? "text-emerald-300"
                        : data.evals.lastRun?.gatePass === false
                        ? "text-rose-300"
                        : "text-slate-300"
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
                </div>
              </div>

              {data.evals.lastRun ? (
                <div className="mt-4 space-y-3">
                  <p className="text-xs text-slate-300">
                    Run #{data.evals.lastRun.id.slice(0, 8)} · {data.evals.lastRun.trigger} ·{" "}
                    {toDateTime(data.evals.lastRun.completedAt ?? data.evals.lastRun.createdAt)}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3 text-sm text-slate-200">
                      Set top-1: {toPercent(data.evals.lastRun.summary?.metrics?.setTop1AccuracyPct ?? null)}
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3 text-sm text-slate-200">
                      Insert/parallel top-1:{" "}
                      {toPercent(data.evals.lastRun.summary?.metrics?.insertParallelTop1AccuracyPct ?? null)}
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3 text-sm text-slate-200">
                      Insert/parallel top-3:{" "}
                      {toPercent(data.evals.lastRun.summary?.metrics?.insertParallelTop3AccuracyPct ?? null)}
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3 text-sm text-slate-200">
                      Unknown rate: {toPercent(data.evals.lastRun.summary?.metrics?.unknownRatePct ?? null)}
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3 text-sm text-slate-200">
                      Wrong-set rate: {toPercent(data.evals.lastRun.summary?.metrics?.wrongSetRatePct ?? null)}
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3 text-sm text-slate-200">
                      Cross-set drift: {toPercent(data.evals.lastRun.summary?.metrics?.crossSetMemoryDriftPct ?? null)}
                    </div>
                  </div>

                  {data.evals.lastRun.failedChecks.length > 0 ? (
                    <div className="rounded-2xl border border-rose-400/40 bg-rose-400/10 p-3">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-rose-200">Failed checks</p>
                      <p className="mt-2 text-sm text-rose-100">{data.evals.lastRun.failedChecks.join(", ")}</p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-3 text-sm text-emerald-100">
                      Eval gate checks passed.
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-400">No eval run found yet. Run one now to activate release gating.</p>
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
                          <td className="px-3 py-2 text-sm text-slate-200">#{run.id.slice(0, 8)} · {run.trigger}</td>
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

              <div className="mt-6 rounded-2xl border border-white/10 bg-night-900/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Gold Eval Cases</p>
                  <button
                    type="button"
                    onClick={loadEvalCases}
                    disabled={casesLoading}
                    className="rounded-full border border-slate-500/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {casesLoading ? "Loading..." : "Refresh Cases"}
                  </button>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <input
                    value={newEvalCase.slug}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, slug: event.target.value }))}
                    placeholder="slug (ex: finest-no-limit-nl30)"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.title}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="title"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.cardAssetId}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, cardAssetId: event.target.value }))}
                    placeholder="cardAssetId"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.expectedSetName}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, expectedSetName: event.target.value }))}
                    placeholder="expected setName"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.expectedInsertSet}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, expectedInsertSet: event.target.value }))}
                    placeholder="expected insertSet (optional)"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.expectedParallel}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, expectedParallel: event.target.value }))}
                    placeholder="expected parallel (optional)"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.hintSetId}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, hintSetId: event.target.value }))}
                    placeholder="hint setId (optional)"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.hintYear}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, hintYear: event.target.value }))}
                    placeholder="hint year"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.hintManufacturer}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, hintManufacturer: event.target.value }))}
                    placeholder="hint manufacturer"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.hintSport}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, hintSport: event.target.value }))}
                    placeholder="hint sport"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.hintProductLine}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, hintProductLine: event.target.value }))}
                    placeholder="hint productLine"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                  <input
                    value={newEvalCase.hintLayoutClass}
                    onChange={(event) => setNewEvalCase((prev) => ({ ...prev, hintLayoutClass: event.target.value }))}
                    placeholder="hint layoutClass"
                    className="rounded-lg border border-white/10 bg-night-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-gold-500/60"
                  />
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={saveEvalCase}
                    disabled={caseSaving}
                    className="rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-night-900 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {caseSaving ? "Saving..." : "Save Eval Case"}
                  </button>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Case</th>
                        <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Card</th>
                        <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Expected</th>
                        <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Enabled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evalCases.length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-sm text-slate-400" colSpan={4}>
                            No eval cases loaded.
                          </td>
                        </tr>
                      ) : (
                        evalCases.slice(0, 80).map((evalCase) => (
                          <tr key={evalCase.id} className="border-b border-white/5 align-top">
                            <td className="px-3 py-2 text-sm text-slate-100">
                              <p>{evalCase.title}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">{evalCase.slug}</p>
                            </td>
                            <td className="px-3 py-2 text-sm text-slate-300">{evalCase.cardAssetId}</td>
                            <td className="px-3 py-2 text-xs text-slate-300">
                              set: {evalCase.expected.setName ?? "-"} | insert: {evalCase.expected.insertSet ?? "-"} |
                              parallel: {evalCase.expected.parallel ?? "-"}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => toggleEvalCase(evalCase.slug, !evalCase.enabled)}
                                disabled={caseSaving}
                                className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] transition ${
                                  evalCase.enabled
                                    ? "border border-emerald-400/45 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                                    : "border border-slate-500/45 bg-slate-500/10 text-slate-300 hover:bg-slate-500/20"
                                } disabled:cursor-not-allowed disabled:opacity-60`}
                              >
                                {evalCase.enabled ? "Enabled" : "Disabled"}
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-night-800/65 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Pipeline Health</p>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Metric</th>
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Last 24h</th>
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Last 7d</th>
                    </tr>
                  </thead>
                  <tbody>
                    <StatRow label="Cards processed" left={data.live.last24h.processed} right={data.live.last7d.processed} />
                    <StatRow
                      label="LLM parse rate"
                      left={toPercent(data.live.last24h.llmParseRatePct)}
                      right={toPercent(data.live.last7d.llmParseRatePct)}
                    />
                    <StatRow
                      label="Fallback use rate"
                      left={toPercent(data.live.last24h.fallbackRatePct)}
                      right={toPercent(data.live.last7d.fallbackRatePct)}
                    />
                    <StatRow
                      label="Multimodal use rate"
                      left={toPercent(data.live.last24h.multimodalUsedRatePct)}
                      right={toPercent(data.live.last7d.multimodalUsedRatePct)}
                    />
                    <StatRow
                      label="High-detail share"
                      left={toPercent(data.live.last24h.multimodalHighDetailRatePct)}
                      right={toPercent(data.live.last7d.multimodalHighDetailRatePct)}
                    />
                    <StatRow
                      label="Variant match ok rate"
                      left={toPercent(data.live.last24h.variantMatchOkRatePct)}
                      right={toPercent(data.live.last7d.variantMatchOkRatePct)}
                    />
                    <StatRow
                      label="Teach memory applied rate"
                      left={toPercent(data.live.last24h.memoryAppliedRatePct)}
                      right={toPercent(data.live.last7d.memoryAppliedRatePct)}
                    />
                    <StatRow
                      label="Photo readiness (front/back/tilt)"
                      left={`${toPercent(data.live.last24h.photoFrontOkRatePct)} / ${toPercent(data.live.last24h.photoBackOkRatePct)} / ${toPercent(data.live.last24h.photoTiltOkRatePct)}`}
                      right={`${toPercent(data.live.last7d.photoFrontOkRatePct)} / ${toPercent(data.live.last7d.photoBackOkRatePct)} / ${toPercent(data.live.last7d.photoTiltOkRatePct)}`}
                    />
                    <StatRow
                      label="Latency P50 total"
                      left={toMs(data.live.last24h.latency.totalMsP50)}
                      right={toMs(data.live.last7d.latency.totalMsP50)}
                    />
                    <StatRow
                      label="Latency P95 total"
                      left={toMs(data.live.last24h.latency.totalMsP95)}
                      right={toMs(data.live.last7d.latency.totalMsP95)}
                    />
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <article className="rounded-3xl border border-white/10 bg-night-800/65 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Teach/Train Impact (7d)</p>
                <div className="mt-3 space-y-2 text-sm text-slate-200">
                  <p>Lessons captured: {data.teach.lessons7d}</p>
                  <p>Corrections captured: {data.teach.corrections7d}</p>
                  <p>Accuracy (7d): {toPercent(data.teach.accuracy7dPct)}</p>
                  <p>Accuracy (previous 7d): {toPercent(data.teach.accuracyPrev7dPct)}</p>
                  <p>
                    Accuracy delta: {data.teach.accuracyDeltaPct == null ? "-" : `${data.teach.accuracyDeltaPct.toFixed(1)} pts`}
                  </p>
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
              </article>

              <article className="rounded-3xl border border-white/10 bg-night-800/65 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Model Behavior (7d)</p>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">By model</p>
                    <ul className="mt-2 space-y-2 text-sm text-slate-200">
                      {data.models.byModel.length === 0 ? (
                        <li className="text-slate-400">No model data.</li>
                      ) : (
                        data.models.byModel.map((entry) => (
                          <li key={entry.model} className="flex items-center justify-between gap-3">
                            <span>{entry.model}</span>
                            <span className="font-mono text-slate-300">{entry.count}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">By output format</p>
                    <ul className="mt-2 space-y-2 text-sm text-slate-200">
                      {data.models.byFormat.length === 0 ? (
                        <li className="text-slate-400">No format data.</li>
                      ) : (
                        data.models.byFormat.map((entry) => (
                          <li key={entry.format} className="flex items-center justify-between gap-3">
                            <span>{entry.format}</span>
                            <span className="font-mono text-slate-300">{entry.count}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                </div>
              </article>
            </section>

            <section className="rounded-3xl border border-white/10 bg-night-800/65 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Teach Region Telemetry</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Template saves</p>
                  <p className="mt-1 text-sm text-slate-100">24h: {data.teachRegions.templateSaves24h}</p>
                  <p className="text-sm text-slate-100">7d: {data.teachRegions.templateSaves7d}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Client errors</p>
                  <p className="mt-1 text-sm text-rose-200">24h: {data.teachRegions.clientErrors24h}</p>
                  <p className="text-sm text-rose-200">7d: {data.teachRegions.clientErrors7d}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-night-900/50 p-3">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-400">Snapshot coverage</p>
                  <p className="mt-1 text-sm text-slate-100">Snapshots (7d): {data.teachRegions.snapshots7d}</p>
                  <p className="text-sm text-slate-100">
                    Avg regions/save: {data.teachRegions.avgRegionsPerSave7d == null ? "-" : data.teachRegions.avgRegionsPerSave7d}
                  </p>
                  <p className="text-sm text-slate-100">Templates updated (7d): {data.teachRegions.templatesUpdated7d}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <article className="rounded-2xl border border-white/10 bg-night-900/50 p-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Recent Teach Region Saves</p>
                  <div className="mt-2 max-h-72 overflow-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="px-2 py-1 text-left text-[10px] uppercase tracking-[0.18em] text-slate-400">Card</th>
                          <th className="px-2 py-1 text-left text-[10px] uppercase tracking-[0.18em] text-slate-400">Layout</th>
                          <th className="px-2 py-1 text-left text-[10px] uppercase tracking-[0.18em] text-slate-400">Regions</th>
                          <th className="px-2 py-1 text-left text-[10px] uppercase tracking-[0.18em] text-slate-400">Snapshot</th>
                          <th className="px-2 py-1 text-left text-[10px] uppercase tracking-[0.18em] text-slate-400">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.teachRegions.recentTemplateSaves.length === 0 ? (
                          <tr>
                            <td className="px-2 py-2 text-xs text-slate-400" colSpan={5}>
                              No teach-region save events yet.
                            </td>
                          </tr>
                        ) : (
                          data.teachRegions.recentTemplateSaves.map((event) => (
                            <tr key={event.id} className="border-b border-white/5 align-top">
                              <td className="px-2 py-1.5 text-xs text-slate-100">{event.fileName ?? event.cardId ?? "-"}</td>
                              <td className="px-2 py-1.5 text-xs text-slate-300">
                                {(event.layoutClass ?? "-") + " / " + (event.photoSide ?? "-")}
                              </td>
                              <td className="px-2 py-1.5 text-xs text-slate-300">
                                {event.regionCount} · upd {event.templatesUpdated}
                              </td>
                              <td className="px-2 py-1.5 text-xs text-slate-300">
                                {event.snapshotImageUrl ? (
                                  <a
                                    href={event.snapshotImageUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sky-300 hover:text-sky-200"
                                  >
                                    Open
                                  </a>
                                ) : (
                                  "-"
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-xs text-slate-300">{toDateTime(event.createdAt)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
                <article className="rounded-2xl border border-white/10 bg-night-900/50 p-3">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Recent Teach Region Client Errors</p>
                  <div className="mt-2 max-h-72 space-y-2 overflow-auto pr-1">
                    {data.teachRegions.recentClientErrors.length === 0 ? (
                      <p className="text-xs text-slate-400">No teach-region client errors in this window.</p>
                    ) : (
                      data.teachRegions.recentClientErrors.map((event) => (
                        <article key={event.id} className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-2">
                          <p className="text-xs text-rose-100">
                            {(event.action ?? "client_error").toUpperCase()} · {toDateTime(event.createdAt)}
                          </p>
                          <p className="mt-1 text-xs text-rose-200">{event.message ?? "Unknown error"}</p>
                          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-rose-100/80">
                            {event.fileName ?? event.cardId ?? "-"} · {(event.layoutClass ?? "-") + " / " + (event.photoSide ?? "-")}
                          </p>
                        </article>
                      ))
                    )}
                  </div>
                </article>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-night-800/65 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Recent Human Corrections</p>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Card</th>
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Field</th>
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Model</th>
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">Human</th>
                      <th className="px-3 py-2 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teach.recentCorrections.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-sm text-slate-400" colSpan={5}>
                          No correction rows yet.
                        </td>
                      </tr>
                    ) : (
                      data.teach.recentCorrections.map((row) => (
                        <tr key={`${row.cardId}-${row.fieldName}-${row.createdAt}`} className="border-b border-white/5 align-top">
                          <td className="px-3 py-2 text-sm text-slate-100">{row.fileName ?? row.cardId}</td>
                          <td className="px-3 py-2 text-sm text-slate-100">{row.fieldName}</td>
                          <td className="px-3 py-2 text-sm text-rose-200">{row.modelValue ?? "-"}</td>
                          <td className="px-3 py-2 text-sm text-emerald-200">{row.humanValue ?? "-"}</td>
                          <td className="px-3 py-2 text-sm text-slate-300">{toDateTime(row.createdAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-night-800/65 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Quick Ops Attention Queue</p>
              <div className="mt-4 space-y-3">
                {data.ops.attentionCards.length === 0 ? (
                  <p className="text-sm text-slate-400">No attention cards right now.</p>
                ) : (
                  data.ops.attentionCards.map((card) => (
                    <article key={card.id} className="rounded-2xl border border-white/10 bg-night-900/65 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{card.fileName}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                            {card.reviewStage ?? "Unknown stage"} · {toDateTime(card.updatedAt)}
                          </p>
                          <p className="mt-1 text-xs text-slate-300">Model: {card.model ?? "-"}</p>
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
                            onClick={() => retryCard(card.id)}
                            disabled={retrying[card.id] === true}
                            className="rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-night-900 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {retrying[card.id] === true ? "Retrying..." : "Retry OCR"}
                          </button>
                          <Link
                            href="/admin/uploads"
                            className="rounded-full border border-slate-500/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:border-slate-300"
                          >
                            Open Add Cards
                          </Link>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}
      </div>
    );
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · AI Ops</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
        {sessionLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm uppercase tracking-[0.28em] text-slate-400">Checking access...</p>
          </div>
        ) : !session ? (
          renderSignIn()
        ) : !isAdmin ? (
          renderDenied()
        ) : (
          renderMain()
        )}
      </div>
    </AppShell>
  );
}
