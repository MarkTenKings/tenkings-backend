import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../../../components/AppShell";
import AdminGoldenQueuePlayer from "../../../../components/golden/AdminGoldenQueuePlayer";
import {
  ADMIN_PAGE_FRAME_CLASS,
  AdminPageHeader,
  adminPanelClass,
  adminStatCardClass,
  adminSubpanelClass,
} from "../../../../components/admin/AdminPrimitives";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../../constants/admin";
import { useSession } from "../../../../hooks/useSession";
import type { AdminGoldenQueueResponse, AdminGoldenQueueSession, AdminGoldenQueueStatus } from "../../../../lib/goldenQueue";
import { formatAdminGoldenQueueElapsed } from "../../../../lib/goldenQueue";
import { buildAdminHeaders } from "../../../../lib/adminHeaders";
import { formatUsdMinor } from "../../../../lib/formatters";

const POLL_MS = 3000;

const STAGE_TONE_CLASS: Record<AdminGoldenQueueStatus, string> = {
  COUNTDOWN: "border-amber-400/30 bg-amber-500/10 text-amber-100",
  LIVE: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  REVEAL: "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-100",
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

export default function AdminGoldenQueueSessionPage() {
  const router = useRouter();
  const { session, loading, ensureSession, logout } = useSession();
  const [queueSession, setQueueSession] = useState<AdminGoldenQueueSession | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [polledAt, setPolledAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const sessionId = typeof router.query.sessionId === "string" ? router.query.sessionId : null;
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const adminHeaders = useMemo(() => buildAdminHeaders(session?.token), [session?.token]);

  const loadQueueSession = useCallback(async () => {
    if (!sessionId || !session?.token || !isAdmin) {
      setQueueSession(null);
      setPageError(null);
      setPolledAt(null);
      return;
    }

    setPageLoading(true);

    try {
      const response = await fetch(`/api/admin/golden/queue?sessionId=${encodeURIComponent(sessionId)}`, {
        headers: adminHeaders,
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<AdminGoldenQueueResponse> & { message?: string };
      if (!response.ok || !payload.sessions || !payload.polledAt) {
        throw new Error(payload.message ?? "Failed to load the Golden Ticket session.");
      }

      setQueueSession(payload.sessions[0] ?? null);
      setPolledAt(payload.polledAt);
      setPageError(payload.sessions[0] ? null : "Golden Ticket session is no longer active.");
    } catch (error) {
      setQueueSession(null);
      setPageError(error instanceof Error ? error.message : "Failed to load the Golden Ticket session.");
    } finally {
      setPageLoading(false);
    }
  }, [adminHeaders, isAdmin, session?.token, sessionId]);

  useEffect(() => {
    void loadQueueSession();
  }, [loadQueueSession]);

  useEffect(() => {
    if (!sessionId || !session?.token || !isAdmin) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadQueueSession();
    }, POLL_MS);

    return () => window.clearInterval(interval);
  }, [isAdmin, loadQueueSession, session?.token, sessionId]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

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
          <title>Ten Kings · Golden Ticket Session</title>
          <meta name="robots" content="noindex" />
        </Head>
        {gate}
      </AppShell>
    );
  }

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>Ten Kings · Golden Ticket Session</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/admin/golden/queue"
          backLabel="← Live Queue"
          eyebrow="Golden Ticket"
          title={queueSession ? `${queueSession.ticket.ticketLabel} Session` : "Session Detail"}
          description={
            queueSession
              ? `Full-size live view for ${queueSession.winnerName}. This page polls every 3 seconds while the session remains active.`
              : "This page only shows active Golden Ticket sessions."
          }
          badges={
            queueSession ? (
              <>
                <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${STAGE_TONE_CLASS[queueSession.status]}`}>
                  {queueSession.status}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300">
                  Elapsed {formatAdminGoldenQueueElapsed(queueSession.stageEnteredAt, nowMs)}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-400">
                  Polled {formatDateTime(polledAt)}
                </span>
              </>
            ) : null
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/golden/queue"
                className="rounded-full border border-white/15 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/35 hover:text-white"
              >
                Back to Queue
              </Link>
              <button
                type="button"
                onClick={() => void loadQueueSession()}
                className="rounded-full border border-gold-400/40 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-gold-100 transition hover:border-gold-300 hover:text-white"
              >
                Refresh Now
              </button>
            </div>
          }
        />

        {pageError ? (
          <section className={adminPanelClass("border-rose-400/25 bg-rose-500/10 p-4")}>
            <p className="text-sm text-rose-200">{pageError}</p>
          </section>
        ) : null}

        {pageLoading && !queueSession ? (
          <section className={adminPanelClass("p-6")}>
            <p className="text-sm text-slate-400">Loading Golden Ticket session...</p>
          </section>
        ) : null}

        {queueSession ? (
          <>
            <section className="grid gap-4 xl:grid-cols-4">
              <article className={adminStatCardClass("p-4")}>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Winner</p>
                <p className="mt-3 text-xl font-semibold text-white">{queueSession.winnerName}</p>
              </article>
              <article className={adminStatCardClass("p-4")}>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Ticket</p>
                <p className="mt-3 text-xl font-semibold text-gold-200">{queueSession.ticket.ticketLabel}</p>
              </article>
              <article className={adminStatCardClass("p-4")}>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Prize</p>
                <p className="mt-3 text-xl font-semibold text-white">{queueSession.prize.name}</p>
              </article>
              <article className={adminStatCardClass("p-4")}>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Elapsed</p>
                <p className="mt-3 text-xl font-semibold text-white">{formatAdminGoldenQueueElapsed(queueSession.stageEnteredAt, nowMs)}</p>
              </article>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr),360px]">
              <article className={adminPanelClass("overflow-hidden p-4")}>
                <div className="overflow-hidden rounded-[28px] border border-white/10 bg-black">
                  <div className="mx-auto aspect-[9/16] max-h-[78vh] w-full max-w-[520px] bg-black">
                    <AdminGoldenQueuePlayer
                      title={`Golden Ticket ${queueSession.ticket.ticketLabel}`}
                      muxPlaybackId={queueSession.muxPlaybackId}
                      videoUrl={queueSession.videoUrl}
                      thumbnailUrl={queueSession.thumbnailUrl ?? queueSession.prize.thumbnailUrl}
                      interactive
                      muted={false}
                      autoPlay={false}
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              </article>

              <aside className="space-y-4">
                <section className={adminSubpanelClass("p-4")}>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Session</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-200">
                    <p>Status: {queueSession.status}</p>
                    <p>Code: {queueSession.code}</p>
                    <p>Stage entered: {formatDateTime(queueSession.stageEnteredAt)}</p>
                    <p>Last update: {formatDateTime(queueSession.updatedAt)}</p>
                  </div>
                </section>

                <section className={adminSubpanelClass("p-4")}>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Prize</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-200">
                    <p>{queueSession.prize.name}</p>
                    <p>{queueSession.prize.estimatedValue != null ? formatUsdMinor(queueSession.prize.estimatedValue) : "Value pending"}</p>
                    <p>{queueSession.prize.description ?? "No prize description entered."}</p>
                  </div>
                </section>

                <section className={adminSubpanelClass("p-4")}>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Watch Flow</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-200">
                    <p>This page stays scoped to active sessions only.</p>
                    <p>If the session is cancelled or ends naturally, it will drop out of this view on the next poll.</p>
                  </div>
                </section>
              </aside>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
