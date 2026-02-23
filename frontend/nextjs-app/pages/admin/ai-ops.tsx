import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";

type WindowSummary = {
  processed: number;
  llmParsed: number;
  llmParseRatePct: number | null;
  fallbackUsed: number;
  fallbackRatePct: number | null;
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
  ops: {
    attentionCards: AttentionCard[];
  };
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

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/ai-ops/overview");
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
  }, []);

  const retryCard = useCallback(
    async (cardId: string) => {
      setRetrying((prev) => ({ ...prev, [cardId]: true }));
      try {
        const response = await fetch(`/api/admin/cards/${cardId}/ocr-suggest`);
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
    [loadOverview]
  );

  useEffect(() => {
    if (!sessionLoading && session && isAdmin && !data && !loading) {
      void loadOverview();
    }
  }, [data, isAdmin, loadOverview, loading, session, sessionLoading]);

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
