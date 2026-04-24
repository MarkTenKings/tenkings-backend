import Head from "next/head";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../../components/AppShell";
import AdminGoldenQueuePlayer from "../../../components/golden/AdminGoldenQueuePlayer";
import {
  ADMIN_PAGE_FRAME_CLASS,
  AdminPageHeader,
  adminPanelClass,
  adminStatCardClass,
  adminSubpanelClass,
} from "../../../components/admin/AdminPrimitives";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import type { AdminGoldenQueueResponse, AdminGoldenQueueSession, AdminGoldenQueueStatus } from "../../../lib/goldenQueue";
import { formatAdminGoldenQueueElapsed } from "../../../lib/goldenQueue";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import { formatUsdMinor } from "../../../lib/formatters";

const POLL_MS = 3000;

const STAGE_TONE_CLASS: Record<AdminGoldenQueueStatus, string> = {
  COUNTDOWN: "border-amber-400/30 bg-amber-500/10 text-amber-100",
  LIVE: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  REVEAL: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100",
};

type Notice = {
  tone: "success" | "error";
  message: string;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AdminGoldenQueuePage() {
  const { session, loading, ensureSession, logout } = useSession();
  const [queue, setQueue] = useState<AdminGoldenQueueSession[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [actionStates, setActionStates] = useState<Record<string, boolean>>({});
  const [polledAt, setPolledAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const loadQueue = useCallback(async () => {
    if (!session?.token || !isAdmin) {
      setQueue([]);
      setPageError(null);
      setPolledAt(null);
      return;
    }

    setPageLoading(true);

    try {
      const response = await fetch("/api/admin/golden/queue", {
        headers: adminHeaders,
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<AdminGoldenQueueResponse> & { message?: string };
      if (!response.ok || !payload.sessions || !payload.polledAt) {
        throw new Error(payload.message ?? "Failed to load the Golden Ticket live queue.");
      }

      setQueue(payload.sessions);
      setPolledAt(payload.polledAt);
      setPageError(null);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Failed to load the Golden Ticket live queue.");
    } finally {
      setPageLoading(false);
    }
  }, [adminHeaders, isAdmin, session?.token]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!session?.token || !isAdmin) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadQueue();
    }, POLL_MS);

    return () => window.clearInterval(interval);
  }, [isAdmin, loadQueue, session?.token]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  const handleKill = useCallback(
    async (queueSession: AdminGoldenQueueSession) => {
      if (!window.confirm(`Cancel Golden Ticket ${queueSession.ticket.ticketLabel} for ${queueSession.winnerName}?`)) {
        return;
      }

      let activeSession = session;
      if (!activeSession) {
        activeSession = await ensureSession();
      }

      setActionStates((current) => ({ ...current, [queueSession.id]: true }));
      setNotice(null);

      try {
        const response = await fetch(`/api/admin/golden/queue/${queueSession.id}/kill`, {
          method: "POST",
          headers: buildAdminHeaders(activeSession.token, {
            "Content-Type": "application/json",
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? "Failed to cancel the Golden Ticket session.");
        }

        setNotice({
          tone: "success",
          message: payload.message ?? `Cancelled Golden Ticket ${queueSession.ticket.ticketLabel}.`,
        });
        await loadQueue();
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : "Failed to cancel the Golden Ticket session.",
        });
      } finally {
        setActionStates((current) => ({ ...current, [queueSession.id]: false }));
      }
    },
    [ensureSession, loadQueue, session]
  );

  const stageCounts = useMemo(
    () =>
      queue.reduce<Record<AdminGoldenQueueStatus, number>>(
        (counts, sessionRow) => {
          counts[sessionRow.status] += 1;
          return counts;
        },
        { COUNTDOWN: 0, LIVE: 0, REVEAL: 0 }
      ),
    [queue]
  );

  const gate = (() => {
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-500">Checking access...</p>
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
    }

    return null;
  })();

  if (gate) {
    return (
      <AppShell background="black" brandVariant="collectibles">
        <Head>
          <title>Ten Kings · Golden Ticket Queue</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>Ten Kings · Golden Ticket Queue</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/admin"
          backLabel="← Admin Home"
          eyebrow="Golden Ticket"
          title="Live Queue"
          description="Monitor active Golden Ticket sessions in real time, preview the live Mux feed, and force-cancel a session before it can publish."
          badges={
            <>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200">
                {queue.length} active
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-400">
                Polled {formatDateTime(polledAt)}
              </span>
            </>
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/golden/prizes"
                className="rounded-full border border-white/15 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/35 hover:text-white"
              >
                Prize Minting
              </Link>
              <Link
                href="/admin/golden/winners"
                className="rounded-full border border-white/15 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/35 hover:text-white"
              >
                Winners Moderation
              </Link>
              <button
                type="button"
                onClick={() => void loadQueue()}
                className="rounded-full border border-gold-400/40 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-gold-100 transition hover:border-gold-300 hover:text-white"
              >
                Refresh Now
              </button>
            </div>
          }
        />

        {notice ? (
          <section
            className={adminPanelClass(
              notice.tone === "success"
                ? "border-emerald-400/25 bg-emerald-500/10 p-4"
                : "border-rose-400/25 bg-rose-500/10 p-4"
            )}
          >
            <p className={notice.tone === "success" ? "text-sm text-emerald-100" : "text-sm text-rose-200"}>{notice.message}</p>
          </section>
        ) : null}

        {pageError ? (
          <section className={adminPanelClass("border-rose-400/25 bg-rose-500/10 p-4")}>
            <p className="text-sm text-rose-200">{pageError}</p>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-4">
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Active Sessions</p>
            <p className="mt-3 text-3xl font-semibold text-white">{queue.length}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Countdown</p>
            <p className="mt-3 text-3xl font-semibold text-amber-200">{stageCounts.COUNTDOWN}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Live</p>
            <p className="mt-3 text-3xl font-semibold text-emerald-200">{stageCounts.LIVE}</p>
          </article>
          <article className={adminStatCardClass("p-4")}>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Reveal</p>
            <p className="mt-3 text-3xl font-semibold text-fuchsia-200">{stageCounts.REVEAL}</p>
          </article>
        </section>

        <section className={adminPanelClass("overflow-hidden")}>
          {pageLoading && queue.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">Loading Golden Ticket queue...</div>
          ) : queue.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">No Golden Ticket sessions are currently active.</div>
          ) : (
            <div className="divide-y divide-white/6">
              {queue.map((queueSession) => (
                <article key={queueSession.id} className="grid gap-4 p-4 md:grid-cols-[120px,1fr] xl:grid-cols-[120px,1fr,220px]">
                  <div className={adminSubpanelClass("overflow-hidden")}>
                    <div className="aspect-[9/16] bg-black">
                      <AdminGoldenQueuePlayer
                        title={`Golden Ticket ${queueSession.ticket.ticketLabel}`}
                        muxPlaybackId={queueSession.muxPlaybackId}
                        videoUrl={queueSession.videoUrl}
                        thumbnailUrl={queueSession.thumbnailUrl ?? queueSession.prize.thumbnailUrl}
                        interactive={false}
                        muted
                        autoPlay="muted"
                        className="h-full w-full object-cover"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${STAGE_TONE_CLASS[queueSession.status]}`}>
                        {queueSession.status}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300">
                        Elapsed {formatAdminGoldenQueueElapsed(queueSession.stageEnteredAt, nowMs)}
                      </span>
                    </div>

                    <div>
                      <h2 className="font-heading text-3xl uppercase tracking-[0.1em] text-white">{queueSession.winnerName}</h2>
                      <p className="mt-2 text-sm text-slate-300">
                        {queueSession.ticket.ticketLabel} · {queueSession.prize.name}
                      </p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className={adminSubpanelClass("p-3")}>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Ticket</p>
                        <p className="mt-2 text-sm text-white">{queueSession.ticket.ticketLabel}</p>
                        <p className="mt-1 text-xs text-slate-400">Code: {queueSession.ticket.code}</p>
                      </div>
                      <div className={adminSubpanelClass("p-3")}>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Prize</p>
                        <p className="mt-2 text-sm text-white">{queueSession.prize.name}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {queueSession.prize.estimatedValue != null ? formatUsdMinor(queueSession.prize.estimatedValue) : "Value pending"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <Link
                      href={queueSession.watchHref}
                      className="rounded-full border border-white/15 px-5 py-3 text-center text-[11px] uppercase tracking-[0.22em] text-slate-100 transition hover:border-white/35 hover:text-white"
                    >
                      Watch Full
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleKill(queueSession)}
                      disabled={actionStates[queueSession.id] === true}
                      className="rounded-full border border-rose-400/40 bg-rose-500/10 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-rose-100 transition hover:border-rose-300 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {actionStates[queueSession.id] ? "Cancelling..." : "Kill Switch"}
                    </button>
                    <div className={adminSubpanelClass("p-3")}>
                      <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Updated</p>
                      <p className="mt-2 text-xs text-slate-300">{formatDateTime(queueSession.updatedAt)}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
