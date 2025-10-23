import { useCallback, useEffect, useMemo, useRef, useState, FormEvent } from "react";
import Head from "next/head";
import type { GetServerSideProps } from "next";
import { prisma } from "@tenkings/database";
import { kioskSessionInclude, serializeKioskSession, type SerializedKioskSession } from "../../lib/server/kioskSession";

interface KioskPageProps {
  initialSession: SerializedKioskSession;
  controlToken: string | null;
}

const TIMER_REFRESH_MS = 1000;
const POLL_INTERVAL_MS = 5000;

const formatDuration = (ms: number) => {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

export default function KioskSessionPage({ initialSession, controlToken }: KioskPageProps) {
  const [session, setSession] = useState<SerializedKioskSession>(initialSession);
  const [now, setNow] = useState<number>(() => Date.now());
  const [pollError, setPollError] = useState<string | null>(null);
  const [revealForm, setRevealForm] = useState({ itemId: "", qrLinkUrl: "", buybackLinkUrl: "" });
  const [finalizeForm, setFinalizeForm] = useState({
    title: "",
    description: "",
    videoUrl: "",
    thumbnailUrl: "",
    featured: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const hasControl = Boolean(controlToken);
  const autoLiveTriggered = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TIMER_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const countdownRemaining = useMemo(() => {
    if (!session.countdownEndsAt) {
      return 0;
    }
    return new Date(session.countdownEndsAt).getTime() - now;
  }, [session.countdownEndsAt, now]);

  const liveRemaining = useMemo(() => {
    if (!session.liveEndsAt) {
      return 0;
    }
    return new Date(session.liveEndsAt).getTime() - now;
  }, [session.liveEndsAt, now]);

  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch(`/api/kiosk/${session.id}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to refresh session");
      }
      const payload = (await response.json()) as { session: SerializedKioskSession };
      setSession(payload.session);
      setPollError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to refresh session";
      setPollError(message);
    }
  }, [session.id]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchSession();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [fetchSession]);

  useEffect(() => {
    if (!hasControl) {
      return;
    }
    if (session.status !== "COUNTDOWN") {
      return;
    }
    if (countdownRemaining > 1000) {
      autoLiveTriggered.current = false;
      return;
    }
    if (autoLiveTriggered.current) {
      return;
    }
    autoLiveTriggered.current = true;
    void advanceStage("LIVE").catch((error) => {
      console.error(error);
      autoLiveTriggered.current = false;
    });
  }, [countdownRemaining, hasControl, session.status]);

  const advanceStage = useCallback(
    async (stage: SerializedKioskSession["status"]) => {
      if (!hasControl) {
        return;
      }
      const response = await fetch(`/api/kiosk/${session.id}/stage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(controlToken ? { "x-kiosk-token": controlToken } : {}),
        },
        body: JSON.stringify({ stage }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to update stage");
      }
      const payload = (await response.json()) as { session: SerializedKioskSession };
      setSession(payload.session);
    },
    [controlToken, hasControl, session.id]
  );

  const submitReveal = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!hasControl) {
        return;
      }
      setIsSaving(true);
      try {
        const response = await fetch(`/api/kiosk/${session.id}/reveal`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(controlToken ? { "x-kiosk-token": controlToken } : {}),
          },
          body: JSON.stringify({
            itemId: revealForm.itemId.trim(),
            qrLinkUrl: revealForm.qrLinkUrl.trim() || undefined,
            buybackLinkUrl: revealForm.buybackLinkUrl.trim() || undefined,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load reveal");
        }
        const payload = (await response.json()) as { session: SerializedKioskSession };
        setSession(payload.session);
      } catch (error) {
        console.error(error);
        window.alert(error instanceof Error ? error.message : "Unable to register reveal");
      } finally {
        setIsSaving(false);
      }
    },
    [controlToken, hasControl, revealForm, session.id]
  );

  const submitFinalize = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!hasControl) {
        return;
      }
      setIsSaving(true);
      try {
        const response = await fetch(`/api/kiosk/${session.id}/complete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(controlToken ? { "x-kiosk-token": controlToken } : {}),
          },
          body: JSON.stringify({
            title: finalizeForm.title.trim() || undefined,
            description: finalizeForm.description.trim() || undefined,
            videoUrl: finalizeForm.videoUrl.trim(),
            thumbnailUrl: finalizeForm.thumbnailUrl.trim() || undefined,
            featured: finalizeForm.featured,
            publish: true,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to complete session");
        }
        const payload = (await response.json()) as { session: SerializedKioskSession };
        setSession(payload.session);
      } catch (error) {
        console.error(error);
        window.alert(error instanceof Error ? error.message : "Unable to finish session");
      } finally {
        setIsSaving(false);
      }
    },
    [controlToken, finalizeForm, hasControl, session.id]
  );

  const renderStage = () => {
    switch (session.status) {
      case "COUNTDOWN":
        return (
          <div className="flex flex-col items-start gap-6 text-left">
            <p className="text-lg uppercase tracking-[0.3em] text-slate-300">Get ready</p>
            <p className="font-heading text-[6rem] tracking-[0.1em] text-white">{formatDuration(countdownRemaining)}</p>
            <p className="max-w-xl text-base text-slate-400">
              Hold the pack in view. When the timer hits zero, youre live—rip it with energy and keep the hit centered.
            </p>
          </div>
        );
      case "LIVE":
        return (
          <div className="flex flex-col items-start gap-6 text-left">
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 animate-pulse rounded-full bg-rose-500" />
              <p className="text-sm uppercase tracking-[0.4em] text-rose-300">Live</p>
            </div>
            <p className="font-heading text-[5rem] tracking-[0.1em] text-white">{formatDuration(liveRemaining)}</p>
            <p className="max-w-xl text-base text-slate-400">
              Show the reveal, celebrate the moment. Tap “Push Reveal” once the card is scanned to drop player details on screen.
            </p>
          </div>
        );
      case "REVEAL":
        return (
          <div className="flex flex-col items-start gap-8 text-left">
            <p className="text-sm uppercase tracking-[0.4em] text-emerald-300">Big hit</p>
            <h2 className="font-heading text-5xl uppercase tracking-[0.14em] text-white">
              {session.reveal?.name ?? "Vault Hit"}
            </h2>
            <p className="text-lg text-slate-300">{session.reveal?.set}</p>
            {session.reveal?.imageUrl ? (
              <img
                src={session.reveal.imageUrl}
                alt={session.reveal.name ?? "Live rip"}
                className="max-h-[360px] w-auto rounded-3xl border border-white/10 bg-night-950/80 p-6 shadow-card"
              />
            ) : null}
            {session.reveal?.buybackOffer ? (
              <p className="text-lg text-emerald-300">
                Instant Buyback Offer · {Math.round(session.reveal.buybackOffer).toLocaleString()} TKD
              </p>
            ) : null}
          </div>
        );
      case "COMPLETE":
        return (
          <div className="flex flex-col items-start gap-5 text-left">
            <p className="text-sm uppercase tracking-[0.4em] text-emerald-400">Session complete</p>
            <h2 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Saved to Ten Kings Live</h2>
            {session.liveRip ? (
              <a
                className="text-base uppercase tracking-[0.2em] text-sky-300 hover:text-sky-100"
                href={`/live/${session.liveRip.slug}`}
              >
                View recording →
              </a>
            ) : (
              <p className="text-sm text-slate-400">The clip is saved. Publish it when youre ready.</p>
            )}
          </div>
        );
      case "CANCELLED":
        return (
          <div className="flex flex-col items-start gap-4 text-left">
            <p className="text-sm uppercase tracking-[0.4em] text-slate-400">Session cancelled</p>
            <p className="text-sm text-slate-500">Launch a fresh session to run the next live rip.</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-night-950 text-white">
      <Head>
        <title>Ten Kings Live · Kiosk</title>
      </Head>
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-6 py-10">
        <header className="flex flex-col gap-2 text-left">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Live Session</p>
          <h1 className="font-heading text-3xl uppercase tracking-[0.2em] text-white">
            {session.location?.name ?? "Ten Kings Live"}
          </h1>
          {pollError ? <p className="text-sm text-rose-300">{pollError}</p> : null}
        </header>

        <section className="flex flex-1 flex-col justify-center">
          {renderStage()}
        </section>

        {hasControl ? (
          <section className="mb-10 rounded-3xl border border-white/10 bg-night-900/60 p-6 shadow-card">
            <h2 className="mb-4 font-heading text-xl uppercase tracking-[0.24em] text-white">Operator Console</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Stage Controls</p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-sky-400 hover:text-sky-200"
                    onClick={() => advanceStage("COUNTDOWN")}
                  >
                    Reset Countdown
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-sky-400 hover:text-sky-200"
                    onClick={() => advanceStage("LIVE")}
                  >
                    Force Live
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200"
                    onClick={() => advanceStage("REVEAL")}
                  >
                    Force Reveal
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-rose-400 hover:text-rose-200"
                    onClick={() => advanceStage("CANCELLED")}
                  >
                    Cancel Session
                  </button>
                </div>
              </div>

              <form className="space-y-3" onSubmit={submitReveal}>
                <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Reveal Card</p>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-night-900/80 px-4 py-3 text-sm text-white focus:border-gold-400 focus:outline-none"
                  placeholder="Card / Item ID"
                  value={revealForm.itemId}
                  onChange={(event) => setRevealForm((prev) => ({ ...prev, itemId: event.target.value }))}
                  required
                />
                <input
                  className="w-full rounded-2xl border border-white/10 bg-night-900/80 px-4 py-3 text-sm text-white focus:border-gold-400 focus:outline-none"
                  placeholder="QR Link URL (optional)"
                  value={revealForm.qrLinkUrl}
                  onChange={(event) => setRevealForm((prev) => ({ ...prev, qrLinkUrl: event.target.value }))}
                />
                <input
                  className="w-full rounded-2xl border border-white/10 bg-night-900/80 px-4 py-3 text-sm text-white focus:border-gold-400 focus:outline-none"
                  placeholder="Buyback Link URL (optional)"
                  value={revealForm.buybackLinkUrl}
                  onChange={(event) => setRevealForm((prev) => ({ ...prev, buybackLinkUrl: event.target.value }))}
                />
                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full rounded-full border border-gold-500/60 bg-gold-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Push Reveal
                </button>
              </form>

              <form className="space-y-3 lg:col-span-2" onSubmit={submitFinalize}>
                <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Finalize & Publish</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  <input
                    className="rounded-2xl border border-white/10 bg-night-900/80 px-4 py-3 text-sm text-white focus:border-gold-400 focus:outline-none"
                    placeholder="Video URL"
                    value={finalizeForm.videoUrl}
                    onChange={(event) => setFinalizeForm((prev) => ({ ...prev, videoUrl: event.target.value }))}
                    required
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-night-900/80 px-4 py-3 text-sm text-white focus:border-gold-400 focus:outline-none"
                    placeholder="Thumbnail URL (optional)"
                    value={finalizeForm.thumbnailUrl}
                    onChange={(event) => setFinalizeForm((prev) => ({ ...prev, thumbnailUrl: event.target.value }))}
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-night-900/80 px-4 py-3 text-sm text-white focus:border-gold-400 focus:outline-none"
                    placeholder="Title"
                    value={finalizeForm.title}
                    onChange={(event) => setFinalizeForm((prev) => ({ ...prev, title: event.target.value }))}
                  />
                  <textarea
                    className="rounded-2xl border border-white/10 bg-night-900/80 px-4 py-3 text-sm text-white focus:border-gold-400 focus:outline-none"
                    placeholder="Description (optional)"
                    value={finalizeForm.description}
                    onChange={(event) => setFinalizeForm((prev) => ({ ...prev, description: event.target.value }))}
                    rows={2}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-300">
                  <input
                    type="checkbox"
                    checked={finalizeForm.featured}
                    onChange={(event) => setFinalizeForm((prev) => ({ ...prev, featured: event.target.checked }))}
                    className="h-4 w-4 rounded border border-white/20 bg-night-900/80 text-gold-400 focus:ring-gold-400"
                  />
                  Feature on home page
                </label>
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="rounded-full border border-emerald-500/60 bg-emerald-500 px-6 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Publish Live Rip
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => advanceStage("COMPLETE")}
                    className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                  >
                    Mark Complete
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<KioskPageProps> = async (ctx) => {
  const { sessionId } = ctx.params ?? {};
  if (typeof sessionId !== "string") {
    return { notFound: true };
  }

  const session = await prisma.kioskSession.findUnique({
    where: { id: sessionId },
    include: kioskSessionInclude,
  });

  if (!session) {
    return { notFound: true };
  }

  const controlToken = typeof ctx.query.token === "string" ? ctx.query.token : null;

  return {
    props: {
      initialSession: serializeKioskSession(session),
      controlToken,
    },
  };
};
