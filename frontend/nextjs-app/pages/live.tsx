/* eslint-disable @next/next/no-img-element */
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import MuxPlayer from "@mux/mux-player-react";
import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import { startTransition, useEffect, useRef, useState } from "react";

const GOLD = "#C9A63D";
const LIVE_RED = "#DC2626";
const CURRENT_POLL_MS = 2000;
const SECONDARY_POLL_MS = 5000;
const COUNTDOWN_TOTAL_SECONDS = 5;
const INTERACTION_STORAGE_KEY = "golden-live:interaction-armed";
const PLAYER_UNMUTE_STORAGE_KEY = "golden-live:player-unmuted";

type LiveCurrentSession = {
  id: string;
  status: "COUNTDOWN" | "LIVE" | "REVEAL" | "COMPLETE" | "CANCELLED";
  countdownEndsAt: string;
  liveEndsAt: string | null;
  muxPlaybackId: string | null;
  videoUrl: string | null;
};

type GoldenLiveIdleReveal = {
  id: string;
  slug: string;
  title: string;
  ticketNumber: number | null;
  muxPlaybackId: string | null;
  videoUrl: string;
  thumbnailUrl: string | null;
  prizeImageUrl: string | null;
  winnerPhotoUrl: string | null;
  winnerDisplayName: string | null;
};

type GoldenLiveSnapshot = {
  polledAt: string;
  viewerCount: number | null;
  currentSession: LiveCurrentSession | null;
  idleReveal: GoldenLiveIdleReveal | null;
};

type GoldenLiveStats = {
  claimedCount: number;
  placedCount: number;
  totalMinted: number;
  featuredTicketIds: string[];
};

type GoldenLiveWinner = {
  id: string;
  ticketNumber: number;
  winnerProfileUrl: string;
  displayName: string;
  publishedAt: string;
  claimedAt: string | null;
  winnerPhotoUrl: string | null;
  prize: {
    name: string;
    imageUrl: string | null;
    thumbnailUrl: string | null;
  };
  liveRip: {
    slug: string;
    title: string;
    videoUrl: string;
    thumbnailUrl: string | null;
    muxPlaybackId: string | null;
  } | null;
};

type WinnersResponse = {
  winners: GoldenLiveWinner[];
};

type LiveCurrentResponse = GoldenLiveSnapshot & {
  message?: string;
};

function buildMuxThumbnailUrl(playbackId: string) {
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?time=3&width=540&height=960&fit_mode=smartcrop`;
}

function formatMetric(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function getFirstName(displayName: string | null) {
  if (!displayName) {
    return "KING";
  }
  const [firstToken] = displayName.trim().split(/\s+/);
  return (firstToken || displayName).toUpperCase();
}

function buildRevealCaption(ticketNumber: number) {
  const variants = [
    `GOLDEN TICKET #${ticketNumber} FOUND`,
    `TICKET #${ticketNumber} CLAIMED`,
    `KINGDOM SHOT #${ticketNumber}`,
    `BEST PULL EVER! #${ticketNumber}`,
  ];
  return variants[ticketNumber % variants.length] ?? variants[0];
}

function TicketBanner({
  label,
  large = false,
}: {
  label: string;
  large?: boolean;
}) {
  return (
    <div
      className={`relative inline-flex items-center justify-center overflow-hidden rounded-full border bg-black/85 px-5 text-center shadow-[0_0_30px_rgba(0,0,0,0.6)] ${
        large ? "min-h-[48px] w-[min(92%,26rem)] py-3" : "min-h-[32px] py-1.5"
      }`}
      style={{ borderColor: GOLD }}
    >
      <span aria-hidden className="absolute left-0 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black" />
      <span aria-hidden className="absolute right-0 top-1/2 h-4 w-4 translate-x-1/2 -translate-y-1/2 rounded-full bg-black" />
      <span
        className={`${large ? "text-xl" : "text-sm"} font-heading uppercase tracking-[0.16em] text-[#f5d37a]`}
      >
        {label}
      </span>
    </div>
  );
}

function WatermarkLogo() {
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-20 opacity-70 sm:bottom-5 sm:right-5">
      <div className="relative h-12 w-12">
        <Image src="/brand/tenkings-logo.png" alt="" fill sizes="48px" className="object-contain" />
      </div>
    </div>
  );
}

function LiveBadge({ viewerCount }: { viewerCount: number | null }) {
  return (
    <div className="absolute right-4 top-4 z-20 rounded-full border border-white/10 bg-black/78 px-3 py-2 shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
      <div className="flex items-center gap-2">
        <span className="tk-live-dot h-2.5 w-2.5 rounded-full bg-red-600" />
        <span className="font-heading text-sm uppercase tracking-[0.18em] text-white">
          {viewerCount && viewerCount > 0 ? `LIVE · ${viewerCount}` : "LIVE"}
        </span>
      </div>
    </div>
  );
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[1.2rem] border border-[#C9A63D] bg-[#050505] px-3 py-4 text-center shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
      <p className="font-heading text-4xl leading-none tracking-[0.08em] text-[#f5d37a] sm:text-5xl">{formatMetric(value)}</p>
      <p className="mt-2 text-[10px] uppercase tracking-[0.32em] text-[#b99839] sm:text-xs">{label}</p>
    </div>
  );
}

function RevealThumbnail({ winner }: { winner: GoldenLiveWinner }) {
  const sources = [
    winner.liveRip?.muxPlaybackId ? buildMuxThumbnailUrl(winner.liveRip.muxPlaybackId) : null,
    winner.liveRip?.thumbnailUrl ?? null,
    winner.prize.thumbnailUrl ?? null,
    winner.prize.imageUrl ?? null,
    winner.winnerPhotoUrl ?? null,
  ].filter((value): value is string => Boolean(value));

  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => {
    setSourceIndex(0);
  }, [winner.id]);

  const src = sources[sourceIndex] ?? null;

  if (!src) {
    return (
      <div className="flex aspect-[9/16] items-center justify-center bg-black px-4 text-center font-heading text-lg uppercase tracking-[0.12em] text-[#b99839]">
        Golden Ticket
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Golden Ticket #${winner.ticketNumber} reveal`}
      className="aspect-[9/16] h-full w-full object-cover"
      loading="lazy"
      onError={() => {
        if (sourceIndex < sources.length - 1) {
          setSourceIndex(sourceIndex + 1);
        }
      }}
    />
  );
}

function RecentRevealCard({ winner }: { winner: GoldenLiveWinner }) {
  return (
    <Link href={winner.winnerProfileUrl} className="group block">
      <article className="space-y-3">
        <div className="relative overflow-hidden rounded-[1.3rem] border border-[#C9A63D] bg-black shadow-[0_18px_50px_rgba(0,0,0,0.42)]">
          <RevealThumbnail winner={winner} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black via-black/55 to-transparent" />
          <div className="pointer-events-none absolute inset-x-3 bottom-3">
            <p
              className="font-heading text-[1.15rem] uppercase leading-[0.88] tracking-[0.05em] text-[#f8f2cf] sm:text-[1.4rem]"
              style={{
                textShadow:
                  "0 2px 0 rgba(0,0,0,0.92), 0 4px 18px rgba(0,0,0,0.95), 0 0 22px rgba(0,0,0,0.8)",
              }}
            >
              {buildRevealCaption(winner.ticketNumber)}
            </p>
          </div>
        </div>
        <p className="text-center text-[11px] uppercase tracking-[0.28em] text-[#d9bb58] sm:text-xs">
          {getFirstName(winner.displayName)} #{winner.ticketNumber}
        </p>
      </article>
    </Link>
  );
}

function LivePlayer({
  title,
  playbackId,
  videoUrl,
  live,
  muted,
}: {
  title: string;
  playbackId: string | null;
  videoUrl: string | null;
  live: boolean;
  muted: boolean;
}) {
  if (playbackId) {
    return (
      <MuxPlayer
        playbackId={playbackId}
        streamType={live ? "live" : "on-demand"}
        metadataVideoTitle={title}
        title={title}
        autoPlay
        muted={muted}
        loop={!live}
        playsInline
        className="h-full w-full"
      />
    );
  }

  if (videoUrl) {
    return (
      <video
        autoPlay
        muted={muted}
        loop={!live}
        playsInline
        controls={false}
        className="h-full w-full object-cover"
        src={videoUrl}
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-black px-6 text-center font-heading text-2xl uppercase tracking-[0.12em] text-[#b99839]">
      Next Rip Coming Soon
    </div>
  );
}

export default function LivePage({
  initialSnapshot,
  initialStats,
  initialWinners,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const [snapshot, setSnapshot] = useState<GoldenLiveSnapshot>(initialSnapshot);
  const [stats, setStats] = useState<GoldenLiveStats>(initialStats);
  const [winners, setWinners] = useState<GoldenLiveWinner[]>(initialWinners);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [playerMuted, setPlayerMuted] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const audioContextRef = useRef<AudioContext | null>(null);
  const lastCountdownSessionIdRef = useRef<string | null>(null);
  const lastAnnouncedCountdownRef = useRef<number | null>(null);
  const liftoffPlayedForSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedInteraction = window.sessionStorage.getItem(INTERACTION_STORAGE_KEY) === "1";
    const storedUnmuted = window.sessionStorage.getItem(PLAYER_UNMUTE_STORAGE_KEY) === "1";

    if (storedInteraction) {
      setHasUserInteracted(true);
    }
    if (storedUnmuted) {
      setPlayerMuted(false);
    }

    const markInteraction = () => {
      setHasUserInteracted(true);
      window.sessionStorage.setItem(INTERACTION_STORAGE_KEY, "1");
    };

    window.addEventListener("pointerdown", markInteraction, { passive: true });
    window.addEventListener("keydown", markInteraction);

    return () => {
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCurrent = async () => {
      try {
        const response = await fetch("/api/live/current", {
          headers: {
            accept: "application/json",
          },
        });
        const payload = (await response.json().catch(() => ({}))) as LiveCurrentResponse;
        if (!response.ok || !payload.polledAt) {
          throw new Error(payload.message ?? "Failed to refresh live status");
        }
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setSnapshot(payload);
        });
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to refresh /live current snapshot", error);
        }
      }
    };

    void loadCurrent();
    const interval = window.setInterval(() => {
      void loadCurrent();
    }, CURRENT_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSecondary = async () => {
      try {
        const [statsResponse, winnersResponse] = await Promise.all([
          fetch("/api/golden/stats", { headers: { accept: "application/json" } }),
          fetch("/api/golden/winners?limit=4&sort=recent", { headers: { accept: "application/json" } }),
        ]);

        const [statsPayload, winnersPayload] = await Promise.all([
          statsResponse.json().catch(() => ({})),
          winnersResponse.json().catch(() => ({})),
        ]);

        if (!statsResponse.ok || typeof statsPayload?.claimedCount !== "number") {
          throw new Error("Failed to refresh Golden Ticket stats");
        }
        if (!winnersResponse.ok || !Array.isArray(winnersPayload?.winners)) {
          throw new Error("Failed to refresh recent Golden Ticket reveals");
        }

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setStats(statsPayload as GoldenLiveStats);
          setWinners((winnersPayload as WinnersResponse).winners);
        });
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to refresh /live secondary data", error);
        }
      }
    };

    void loadSecondary();
    const interval = window.setInterval(() => {
      void loadSecondary();
    }, SECONDARY_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const currentSession = snapshot.currentSession;
  const currentCountdownValue =
    currentSession?.status === "COUNTDOWN"
      ? Math.min(COUNTDOWN_TOTAL_SECONDS, Math.max(0, Math.ceil((new Date(currentSession.countdownEndsAt).getTime() - now) / 1000)))
      : null;
  const showCountdownOverlay = currentSession?.status === "COUNTDOWN" && currentCountdownValue !== null && currentCountdownValue > 0;
  const isLiveTakeover = currentSession?.status === "LIVE";
  const leftCount = Math.max(stats.totalMinted - stats.claimedCount, 0);

  const activePlayerPlaybackId = currentSession?.muxPlaybackId ?? snapshot.idleReveal?.muxPlaybackId ?? null;
  const activePlayerVideoUrl = currentSession?.videoUrl ?? snapshot.idleReveal?.videoUrl ?? null;
  const activePlayerTitle = isLiveTakeover
    ? "Ten Kings Golden Ticket Reveal"
    : snapshot.idleReveal?.title ?? "Ten Kings Golden Ticket Reveal";

  useEffect(() => {
    if (!hasUserInteracted || typeof window === "undefined") {
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new window.AudioContext();
    }

    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume();
    }
  }, [hasUserInteracted]);

  useEffect(() => {
    const sessionId = currentSession?.id ?? null;
    if (lastCountdownSessionIdRef.current !== sessionId) {
      lastCountdownSessionIdRef.current = sessionId;
      lastAnnouncedCountdownRef.current = null;
      if (liftoffPlayedForSessionRef.current !== sessionId) {
        liftoffPlayedForSessionRef.current = null;
      }
    }
  }, [currentSession?.id]);

  useEffect(() => {
    if (!hasUserInteracted || currentSession?.status !== "COUNTDOWN" || currentCountdownValue === null) {
      return;
    }

    const playTone = async (frequency: number, durationMs: number, bend = false) => {
      if (!audioContextRef.current) {
        return;
      }

      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }

      const context = audioContextRef.current;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      if (bend) {
        oscillator.frequency.linearRampToValueAtTime(frequency * 1.2, context.currentTime + durationMs / 1000);
      }
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationMs / 1000);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + durationMs / 1000 + 0.02);
    };

    if (
      currentCountdownValue > 0 &&
      currentCountdownValue <= COUNTDOWN_TOTAL_SECONDS &&
      currentCountdownValue !== lastAnnouncedCountdownRef.current
    ) {
      lastAnnouncedCountdownRef.current = currentCountdownValue;
      void playTone(440, 150);
      return;
    }

    if (currentCountdownValue === 0 && liftoffPlayedForSessionRef.current !== currentSession.id) {
      liftoffPlayedForSessionRef.current = currentSession.id;
      void playTone(880, 600, true);
    }
  }, [currentCountdownValue, currentSession?.id, currentSession?.status, hasUserInteracted]);

  const handleUnmute = () => {
    setHasUserInteracted(true);
    setPlayerMuted(false);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(INTERACTION_STORAGE_KEY, "1");
      window.sessionStorage.setItem(PLAYER_UNMUTE_STORAGE_KEY, "1");
    }
  };

  return (
    <>
      <Head>
        <title>Ten Kings Live</title>
        <meta
          name="description"
          content="Watch the next Ten Kings Golden Ticket reveal live, then revisit the latest crowned winners."
        />
        <link rel="preconnect" href="https://stream.mux.com" />
        <link rel="dns-prefetch" href="https://stream.mux.com" />
        <link rel="preconnect" href="https://image.mux.com" />
        <link rel="dns-prefetch" href="https://image.mux.com" />
      </Head>

      <main className="golden-live-page min-h-screen bg-black px-4 pb-16 pt-5 text-[#f5d37a] sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center">
          <header className="flex w-full justify-center pb-4">
            <div className="relative h-14 w-14">
              <Image src="/brand/tenkings-logo.png" alt="Ten Kings Collectibles" fill sizes="56px" className="object-contain" priority />
            </div>
          </header>

          <section
            className={`relative flex w-full flex-col items-center ${
              isLiveTakeover ? "min-h-[calc(100vh-110px)] justify-start" : ""
            }`}
          >
            <div
              className={`relative overflow-hidden rounded-[1.8rem] border bg-black shadow-[0_28px_80px_rgba(0,0,0,0.58)] ${
                isLiveTakeover ? "mt-1" : "mt-3"
              }`}
              style={{
                borderColor: GOLD,
                width: isLiveTakeover ? "min(94vw, calc((100vh - 112px) * 9 / 16))" : "min(90vw, calc((100vh - 260px) * 9 / 16))",
                aspectRatio: "9 / 16",
              }}
            >
              {activePlayerPlaybackId || activePlayerVideoUrl ? (
                <LivePlayer
                  title={activePlayerTitle}
                  playbackId={activePlayerPlaybackId}
                  videoUrl={activePlayerVideoUrl}
                  live={Boolean(currentSession)}
                  muted={playerMuted}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-black px-6 text-center font-heading text-[clamp(2rem,6vw,4rem)] uppercase tracking-[0.12em] text-[#b99839]">
                  Next Rip Coming Soon
                </div>
              )}

              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.4),transparent_22%,transparent_72%,rgba(0,0,0,0.6))]" />

              {showCountdownOverlay ? (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/66 px-6 text-center backdrop-blur-[2px]">
                  <TicketBanner label="TEN KINGS GOLDEN TICKET REVEAL" large />
                  <p className="mt-8 font-heading text-[clamp(7rem,28vw,14rem)] leading-none tracking-[0.06em] text-[#f5d37a]">
                    {currentCountdownValue}
                  </p>
                </div>
              ) : (
                <>
                  <div className="absolute left-4 top-4 z-20 sm:left-5 sm:top-5">
                    <TicketBanner
                      label={isLiveTakeover ? "TEN KINGS GOLDEN TICKET REVEAL" : "GOLDEN TICKET REVEAL"}
                      large={isLiveTakeover}
                    />
                  </div>
                  {isLiveTakeover ? <LiveBadge viewerCount={snapshot.viewerCount} /> : null}
                </>
              )}

              {isLiveTakeover ? (
                <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-[#C9A63D]/60 bg-black/76 px-4 py-2 shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
                  <p className="whitespace-nowrap font-heading text-sm uppercase tracking-[0.18em] text-[#f5d37a] sm:text-base">
                    {stats.claimedCount} FOUND · {leftCount} LEFT · LIVE NOW
                  </p>
                </div>
              ) : null}

              <WatermarkLogo />

              {!isLiveTakeover && playerMuted ? (
                <button
                  type="button"
                  onClick={handleUnmute}
                  className="absolute bottom-4 left-4 z-20 rounded-full border border-[#C9A63D]/60 bg-black/78 px-3 py-2 text-[10px] uppercase tracking-[0.28em] text-[#f5d37a] transition hover:border-[#f5d37a] hover:text-[#f8e6ab] sm:bottom-5 sm:left-5"
                >
                  Tap to unmute
                </button>
              ) : null}
            </div>

            {!isLiveTakeover ? (
              <>
                <div className="mt-5 grid w-full max-w-4xl grid-cols-3 gap-3 sm:mt-6 sm:gap-4">
                  <StatCard value={stats.claimedCount} label="Found" />
                  <StatCard value={stats.placedCount} label="In Circulation" />
                  <StatCard value={stats.totalMinted} label="Total" />
                </div>
              </>
            ) : null}
          </section>

          <section className={`w-full max-w-5xl ${isLiveTakeover ? "pt-12" : "pt-10"}`}>
            <h2 className="text-center font-heading text-4xl uppercase tracking-[0.16em] text-[#f5d37a] sm:text-5xl">
              Recent Reveals
            </h2>

            {winners.length === 0 ? (
              <div className="mt-6 rounded-[1.6rem] border border-[#C9A63D]/55 bg-black px-6 py-12 text-center shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
                <p className="font-heading text-2xl uppercase tracking-[0.12em] text-[#b99839]">
                  The next Golden Ticket starts the reel.
                </p>
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 gap-4 sm:gap-5">
                {winners.slice(0, 4).map((winner) => (
                  <RecentRevealCard key={winner.id} winner={winner} />
                ))}
              </div>
            )}

            <div className="mt-8 flex justify-center">
              <Link
                href="/golden"
                className="rounded-full border border-[#C9A63D]/70 px-5 py-3 text-[11px] uppercase tracking-[0.3em] text-[#f5d37a] transition hover:border-[#f5d37a] hover:text-[#fff4cb]"
              >
                Enter the Hall
              </Link>
            </div>
          </section>
        </div>
      </main>

      <style jsx global>{`
        @keyframes tk-live-pulse {
          0% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.65);
          }
          70% {
            transform: scale(1.05);
            box-shadow: 0 0 0 12px rgba(220, 38, 38, 0);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(220, 38, 38, 0);
          }
        }

        .tk-live-dot {
          animation: tk-live-pulse 1.4s ease-out infinite;
        }

        .golden-live-page mux-player {
          --media-control-background: rgba(0, 0, 0, 0.7);
          --media-control-color: #f5d37a;
          --media-live-button-indicator-color: ${LIVE_RED};
          height: 100%;
          width: 100%;
        }
      `}</style>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<{
  initialSnapshot: GoldenLiveSnapshot;
  initialStats: GoldenLiveStats;
  initialWinners: GoldenLiveWinner[];
}> = async () => {
  const [{ getGoldenLiveSnapshot }, { getGoldenTicketHallStats, listGoldenTicketWinners }] = await Promise.all([
    import("../lib/server/goldenLive"),
    import("../lib/server/goldenClaim"),
  ]);

  const [initialSnapshot, initialStats, winners] = await Promise.all([
    getGoldenLiveSnapshot(),
    getGoldenTicketHallStats(),
    listGoldenTicketWinners({ limit: 4, order: "recent" }),
  ]);

  return {
    props: {
      initialSnapshot,
      initialStats,
      initialWinners: winners.winners,
    },
  };
};
