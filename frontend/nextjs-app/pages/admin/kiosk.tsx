import Head from "next/head";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import type { SerializedKioskSession } from "../../lib/server/kioskSession";
import { useSession } from "../../hooks/useSession";

interface SessionsResponse {
  sessions: SerializedKioskSession[];
}

type Stage = "COUNTDOWN" | "LIVE" | "REVEAL" | "COMPLETE" | "CANCELLED";

interface LabelRecord {
  id: string;
  code: string;
  serial: string | null;
  resetVersion: number;
  location: { id: string; name: string; slug: string } | null;
  pack: { id: string; name: string | null; price: number | null; status: string } | null;
  latestSession: SerializedKioskSession | null;
}

type AdminTab = "sessions" | "labels";

export default function AdminKioskPage() {
  const { session, loading, ensureSession, logout } = useSession();
  const [activeTab, setActiveTab] = useState<AdminTab>("sessions");
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [actionStates, setActionStates] = useState<Record<string, Stage | null>>({});
  const [sessions, setSessions] = useState<SerializedKioskSession[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [labelQueryInput, setLabelQueryInput] = useState("");
  const [labelQuery, setLabelQuery] = useState("");
  const [labels, setLabels] = useState<LabelRecord[]>([]);
  const [labelsLoading, setLabelsLoading] = useState(false);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [labelResetting, setLabelResetting] = useState<Record<string, boolean>>({});
  const [labelNotice, setLabelNotice] = useState<string | null>(null);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const loadSessions = useCallback(async () => {
    if (!session?.token || !isAdmin) {
      setSessions([]);
      setFetchError(null);
      return;
    }

    const query = includeCompleted ? "?includeCompleted=true" : "";
    setRefreshing(true);
    try {
      const response = await fetch(`/api/admin/kiosk/sessions${query}`,
        {
          headers: buildAdminHeaders(session.token),
        }
      );
      const body = (await response.json().catch(() => ({}))) as Partial<SessionsResponse> & { message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "Failed to load sessions");
      }
      setSessions(body.sessions ?? []);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setRefreshing(false);
    }
  }, [includeCompleted, isAdmin, session?.token]);

  const loadLabels = useCallback(
    async (query: string) => {
      if (!session?.token || !isAdmin) {
        setLabels([]);
        setLabelsError(null);
        return;
      }
      setLabelsLoading(true);
      try {
        const params = new URLSearchParams();
        if (query.trim()) {
          params.set("q", query.trim());
        }
        const response = await fetch(`/api/admin/kiosk/labels${params.toString() ? `?${params.toString()}` : ""}`, {
          headers: buildAdminHeaders(session.token),
        });
        const body = (await response.json().catch(() => ({}))) as { labels?: LabelRecord[]; message?: string };
        if (!response.ok) {
          throw new Error(body.message ?? "Failed to load pack labels");
        }
        setLabels(body.labels ?? []);
        setLabelsError(null);
      } catch (err) {
        setLabelsError(err instanceof Error ? err.message : "Failed to load pack labels");
      } finally {
        setLabelsLoading(false);
      }
    },
    [isAdmin, session?.token]
  );

  useEffect(() => {
    if (activeTab !== "sessions" || !session?.token || !isAdmin) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await loadSessions();
    };

    run();
    const interval = setInterval(run, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTab, isAdmin, loadSessions, session?.token]);

  useEffect(() => {
    if (activeTab !== "labels") {
      return;
    }
    void loadLabels(labelQuery);
  }, [activeTab, labelQuery, loadLabels]);

  const action = useCallback(
    async (sessionId: string, stage: Stage) => {
      if (!session?.token) {
        await ensureSession().catch(() => undefined);
        return;
      }

      setActionStates((prev) => ({ ...prev, [sessionId]: stage }));
      try {
        const response = await fetch(`/api/admin/kiosk/${sessionId}/stage`, {
          method: "POST",
          headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ stage }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.message ?? "Failed to update session");
        }

        await loadSessions();
      } catch (err) {
        console.error("admin kiosk action error", err);
        alert(err instanceof Error ? err.message : "Failed to update session");
      } finally {
        setActionStates((prev) => ({ ...prev, [sessionId]: null }));
      }
    },
    [ensureSession, loadSessions, session?.token]
  );

  const handleLabelSearch = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      setLabelQuery(labelQueryInput.trim());
    },
    [labelQueryInput]
  );

  const handleLabelReset = useCallback(
    async (identifier: string) => {
      if (!identifier) {
        alert("Pack label identifier is missing.");
        return;
      }
      let token: string | undefined = session?.token ?? undefined;
      if (!token) {
        await ensureSession().catch(() => undefined);
        token = session?.token ?? undefined;
        if (!token) {
          return;
        }
      }

      setLabelResetting((prev) => ({ ...prev, [identifier]: true }));
      setLabelNotice(null);
      try {
        const response = await fetch("/api/admin/kiosk/labels/reset", {
          method: "POST",
          headers: buildAdminHeaders(token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ identifier }),
        });
        const body = (await response.json().catch(() => ({}))) as { resetVersion?: number; message?: string };
        if (!response.ok) {
          throw new Error(body.message ?? "Failed to reset pack label");
        }
        setLabelNotice(`Label reset. New version ${body.resetVersion}.`);
        if (body.resetVersion !== undefined) {
          setLabels((prev) =>
            prev.map((label) =>
              label.serial === identifier || label.code === identifier
                ? { ...label, resetVersion: body.resetVersion!, latestSession: null }
                : label
            )
          );
        }
        await loadLabels(labelQuery);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to reset pack label");
      } finally {
        setLabelResetting((prev) => ({ ...prev, [identifier]: false }));
      }
    },
    [ensureSession, labelQuery, loadLabels, session]
  );

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
            Use your Ten Kings phone number. Only approved operators will gain entry to the live rip controls.
          </p>
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
          <title>Ten Kings · Kiosk Control</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      COUNTDOWN: "bg-slate-800 text-slate-200",
      LIVE: "bg-rose-600/20 text-rose-200",
      REVEAL: "bg-amber-500/20 text-amber-200",
      COMPLETE: "bg-emerald-600/20 text-emerald-200",
      CANCELLED: "bg-slate-700 text-slate-300",
    };
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${colors[status] ?? "bg-slate-800"}`}>
        {status}
      </span>
    );
  };

  const renderTimestamp = (value: string | null) => {
    if (!value) return "—";
    const date = new Date(value);
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Live Rip Control</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="flex flex-1 flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.32em] text-violet-300">Operations · Live Rip</p>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Kiosk Session Control</h1>
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-600 bg-night-900"
                checked={includeCompleted}
                onChange={(event) => setIncludeCompleted(event.target.checked)}
              />
              Show completed sessions
            </label>
          </div>
          <p className="max-w-3xl text-sm text-slate-400">
            Monitor every kiosk session in flight and manually advance the countdown, trigger live, reveal cards, or cancel stale runs.
            Data refreshes automatically every few seconds.
          </p>
        </header>
        <div className="flex flex-wrap gap-3">
          {[
            { id: "sessions", label: "Active Sessions" },
            { id: "labels", label: "Pack Label Resets" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as AdminTab)}
              className={`rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                activeTab === tab.id
                  ? "border-gold-500/60 bg-gold-500 text-night-900"
                  : "border border-white/20 text-slate-200 hover:border-white/40"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "sessions" && (
          <section className="rounded-3xl border border-white/10 bg-night-900/60 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-400">
              <span>{refreshing ? "Refreshing…" : `Sessions · ${sessions.length}`}</span>
              {fetchError && <span className="text-rose-300">{fetchError}</span>}
            </div>
            <div className="grid gap-4">
              {sessions.length === 0 && (
                <p className="text-sm text-slate-400">No sessions match this filter.</p>
              )}
              {sessions.map((item) => {
                const busyStage = actionStates[item.id];
                const buttons = [
                  { label: "Force Countdown", stage: "COUNTDOWN" as const },
                  { label: "Force Live", stage: "LIVE" as const },
                  { label: "Force Reveal", stage: "REVEAL" as const },
                  { label: "Complete", stage: "COMPLETE" as const },
                  { label: "Cancel", stage: "CANCELLED" as const },
                ];

                return (
                  <div key={item.id} className="rounded-2xl border border-white/5 bg-night-950/80 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm uppercase tracking-[0.32em] text-slate-400">{item.location?.name ?? "Unassigned"}</p>
                        <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">
                          {item.packQrCode?.serial ?? item.pack?.definition?.name ?? "Unknown Pack"}
                        </h2>
                        <p className="text-xs text-slate-400">Session {item.code}</p>
                      </div>
                      {renderStatusBadge(item.status)}
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-4">
                      <div>
                        <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Countdown Ends</dt>
                        <dd className="font-mono text-base text-slate-100">{renderTimestamp(item.countdownEndsAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Live Ends</dt>
                        <dd className="font-mono text-base text-slate-100">{renderTimestamp(item.liveEndsAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Updated</dt>
                        <dd className="font-mono text-base text-slate-100">{renderTimestamp(item.updatedAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Status</dt>
                        <dd className="font-mono text-base text-slate-100">{item.status}</dd>
                      </div>
                    </dl>
                    <div className="mt-5 flex flex-wrap gap-3">
                      {buttons.map((btn) => (
                        <button
                          key={btn.stage}
                          type="button"
                          onClick={() => action(item.id, btn.stage)}
                          disabled={!!busyStage && busyStage !== btn.stage}
                          className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] transition ${
                            busyStage === btn.stage
                              ? "border-slate-500/50 bg-slate-700 text-slate-300"
                              : btn.stage === "CANCELLED"
                                ? "border-rose-500/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                                : btn.stage === "COMPLETE"
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                                  : "border-gold-500/40 bg-gold-500/10 text-gold-100 hover:bg-gold-500/25"
                          }`}
                        >
                          {busyStage === btn.stage ? "Working…" : btn.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {activeTab === "labels" && (
          <section className="rounded-3xl border border-white/10 bg-night-900/60 p-6 shadow-xl">
            <div className="mb-4 space-y-3">
              <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleLabelSearch}>
                <input
                  type="text"
                  value={labelQueryInput}
                  onChange={(event) => setLabelQueryInput(event.target.value)}
                  placeholder="Enter pack serial (e.g., TKXXXX) or tkp_ code"
                  className="flex-1 rounded-2xl border border-white/15 bg-night-950 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-gold-500 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-2xl border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
                >
                  Search
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLabelQueryInput("");
                    setLabelQuery("");
                  }}
                  className="rounded-2xl border border-white/15 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200 hover:border-white/40"
                >
                  Clear
                </button>
              </form>
              {labelNotice && <p className="text-sm text-emerald-300">{labelNotice}</p>}
              {labelsError && <p className="text-sm text-rose-300">{labelsError}</p>}
            </div>
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-slate-400">
              <span>{labelsLoading ? "Loading labels…" : `Labels · ${labels.length}`}</span>
            </div>
            <div className="mt-4 grid gap-4">
              {labels.length === 0 && !labelsLoading && (
                <p className="text-sm text-slate-400">No pack labels found.</p>
              )}
              {labels.map((label) => {
                const identifier = label.serial ?? label.code;
                const busyKey = identifier ?? label.id;
                const busy = !!labelResetting[busyKey];
                return (
                  <div key={label.id} className="rounded-2xl border border-white/5 bg-night-950/80 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm uppercase tracking-[0.32em] text-slate-400">{label.location?.name ?? "Unassigned"}</p>
                        <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">
                          {label.serial ?? label.code}
                        </h2>
                        <p className="text-xs text-slate-400">Reset version {label.resetVersion}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => identifier && handleLabelReset(identifier)}
                        disabled={!identifier || busy}
                        className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] transition ${
                          busy
                            ? "border-slate-500/50 bg-slate-700 text-slate-300"
                            : "border-gold-500/40 bg-gold-500/10 text-gold-100 hover:bg-gold-500/25"
                        }`}
                      >
                        {busy ? "Resetting…" : "Reset Label"}
                      </button>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm text-slate-300 md:grid-cols-3">
                      <div>
                        <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Latest Status</dt>
                        <dd className="font-mono text-base text-slate-100">{label.latestSession?.status ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Updated</dt>
                        <dd className="font-mono text-base text-slate-100">
                          {label.latestSession?.updatedAt ? renderTimestamp(label.latestSession.updatedAt) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Pack</dt>
                        <dd className="font-mono text-base text-slate-100">
                          {label.pack?.name ?? label.latestSession?.pack?.definition?.name ?? "—"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
