import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import type { SerializedKioskSession } from "../../lib/server/kioskSession";
import { useSession } from "../../hooks/useSession";

interface SessionsResponse {
  sessions: SerializedKioskSession[];
}

type Stage = "COUNTDOWN" | "LIVE" | "REVEAL" | "COMPLETE" | "CANCELLED";

export default function AdminKioskPage() {
  const { session, loading, ensureSession, logout } = useSession();
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [actionStates, setActionStates] = useState<Record<string, Stage | null>>({});
  const [sessions, setSessions] = useState<SerializedKioskSession[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => {
    if (!session?.token || !isAdmin) {
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
  }, [isAdmin, loadSessions, session?.token]);

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
      </div>
    </AppShell>
  );
}
