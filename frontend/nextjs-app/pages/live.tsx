/* eslint-disable @next/next/no-img-element */
import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import MuxPlayer from "@mux/mux-player-react";
import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import { startTransition, useEffect, useState } from "react";
import type { LiveRipSummary, LiveStatePayload } from "../lib/server/liveRip";

const POLL_MS = 5000;
const GOLD = "#C9A63D";
const LIVE_RED = "#DC2626";

function buildMuxThumbnailUrl(playbackId: string) {
  return `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.jpg?time=3&width=540&height=960&fit_mode=smartcrop`;
}

function thumbnailFor(rip: LiveRipSummary) {
  return rip.thumbnailUrl || (rip.muxPlaybackId ? buildMuxThumbnailUrl(rip.muxPlaybackId) : null);
}

function hrefFor(rip: LiveRipSummary) {
  return rip.watchUrl || (rip.slug ? `/live/${rip.slug}` : "/live");
}

function LiveBadge() {
  return (
    <div className="absolute left-3 top-3 z-20 inline-flex items-center gap-2 rounded-full bg-red-600 px-3 py-1.5 shadow-[0_0_24px_rgba(220,38,38,0.55)]">
      <span className="tk-live-dot h-2.5 w-2.5 rounded-full bg-white" />
      <span className="text-[11px] font-black uppercase tracking-[0.22em] text-white">Live</span>
    </div>
  );
}

function SectionHeader({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <header className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="text-[10px] uppercase tracking-[0.36em] text-[#a88932]">{eyebrow}</p> : null}
        <h2 className="font-heading text-2xl uppercase tracking-[0.18em] text-white sm:text-3xl">{title}</h2>
      </div>
    </header>
  );
}

function VideoFill({
  rip,
  muted,
  live,
}: {
  rip: LiveRipSummary;
  muted: boolean;
  live: boolean;
}) {
  if (rip.muxPlaybackId) {
    return (
      <MuxPlayer
        playbackId={rip.muxPlaybackId}
        streamType={live ? "live" : "on-demand"}
        metadataVideoTitle={rip.title}
        title={rip.title}
        autoPlay={live}
        muted={muted}
        loop={!live}
        playsInline
        className="h-full w-full"
      />
    );
  }

  if (rip.videoUrl) {
    return (
      <video
        src={rip.videoUrl}
        autoPlay={live}
        muted={muted}
        loop={!live}
        playsInline
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#080808] px-6 text-center font-heading text-xl uppercase tracking-[0.16em] text-[#b99839]">
      Rip Incoming
    </div>
  );
}

function LiveRipCard({ rip }: { rip: LiveRipSummary }) {
  return (
    <Link href={hrefFor(rip)} className="group block w-[220px] shrink-0 sm:w-[260px]">
      <article className="overflow-hidden rounded-[1.5rem] border border-[#C9A63D]/55 bg-[#050505] shadow-[0_24px_70px_rgba(0,0,0,0.5)] transition duration-300 group-hover:-translate-y-1 group-hover:border-[#f5d37a]">
        <div className="relative aspect-[9/16] overflow-hidden bg-black">
          <VideoFill rip={rip} muted live />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/72 via-transparent to-black/15" />
          <LiveBadge />
          <div className="absolute inset-x-4 bottom-4 z-20">
            <p className="line-clamp-2 font-heading text-xl uppercase leading-none tracking-[0.08em] text-white">
              {rip.title}
            </p>
          </div>
        </div>
      </article>
    </Link>
  );
}

function StaticRipCard({ rip, compact = false }: { rip: LiveRipSummary; compact?: boolean }) {
  const thumbnail = thumbnailFor(rip);
  const card = (
    <article className="overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#070707] shadow-[0_20px_55px_rgba(0,0,0,0.45)] transition duration-300 hover:-translate-y-1 hover:border-[#C9A63D]/75">
      <div className="relative aspect-[9/16] overflow-hidden bg-[#0b0b0b]">
        {thumbnail ? (
          <img src={thumbnail} alt={rip.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-5 text-center font-heading text-lg uppercase tracking-[0.14em] text-[#b99839]">
            Ten Kings Rip
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/82 via-black/10 to-transparent" />
        {rip.isGoldenTicket ? (
          <div className="absolute left-3 top-3 rounded-full border border-[#C9A63D]/70 bg-black/76 px-3 py-1 text-[9px] uppercase tracking-[0.24em] text-[#f5d37a]">
            Golden
          </div>
        ) : null}
        <div className="absolute inset-x-3 bottom-3">
          <p className={`${compact ? "text-base" : "text-lg"} line-clamp-2 font-heading uppercase leading-none tracking-[0.08em] text-white`}>
            {rip.title}
          </p>
          <p className="mt-2 text-[10px] uppercase tracking-[0.24em] text-[#b99839]">
            {new Date(rip.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    </article>
  );

  return (
    <Link href={hrefFor(rip)} className={compact ? "block w-[160px] shrink-0 sm:w-[190px]" : "block"}>
      {card}
    </Link>
  );
}

function HorizontalRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6">
      <div className="flex gap-4">{children}</div>
    </div>
  );
}

function GoldenTicketHero({ rip }: { rip: LiveRipSummary }) {
  const [muted, setMuted] = useState(true);

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col items-center pt-5 text-center">
      <h1 className="font-heading text-[clamp(2.4rem,8vw,6.5rem)] uppercase leading-[0.88] tracking-[0.08em] text-white">
        Golden Ticket
        <span className="block text-[#f5d37a]">Live Reveal</span>
      </h1>
      <button
        type="button"
        onClick={() => setMuted(false)}
        className="group relative mt-7 w-[min(92vw,420px)] overflow-hidden rounded-[2rem] border border-[#C9A63D] bg-black text-left shadow-[0_28px_90px_rgba(201,166,61,0.2)] sm:w-[min(82vw,470px)]"
        style={{ aspectRatio: "9 / 16" }}
        aria-label={muted ? "Unmute Golden Ticket live reveal" : "Golden Ticket live reveal"}
      >
        <VideoFill rip={rip} muted={muted} live />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/76 via-transparent to-black/20" />
        <LiveBadge />
        {muted ? (
          <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full border border-[#C9A63D]/70 bg-black/80 px-5 py-3 text-[10px] uppercase tracking-[0.28em] text-[#f5d37a] transition group-hover:border-white">
            Tap to unmute
          </div>
        ) : null}
      </button>
    </section>
  );
}

export default function LivePage({ initialState }: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const [state, setState] = useState<LiveStatePayload>(initialState);

  useEffect(() => {
    let cancelled = false;

    const loadState = async () => {
      try {
        const response = await fetch("/api/live/state", {
          headers: { accept: "application/json" },
        });
        const payload = (await response.json().catch(() => ({}))) as LiveStatePayload & { message?: string };
        if (!response.ok || !Array.isArray(payload.regularActive)) {
          throw new Error(payload.message ?? "Failed to load live state");
        }
        if (!cancelled) {
          startTransition(() => setState(payload));
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to refresh /api/live/state", error);
        }
      }
    };

    const interval = window.setInterval(() => {
      void loadState();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const goldenActive = state.goldenTicketActive;
  const hasRegularLive = state.regularActive.length > 0;

  return (
    <>
      <Head>
        <title>Ten Kings Live</title>
        <meta
          name="description"
          content="Watch Ten Kings live rips, Golden Ticket reveals, and replay the latest pack openings."
        />
        <link rel="preconnect" href="https://stream.mux.com" />
        <link rel="dns-prefetch" href="https://stream.mux.com" />
        <link rel="preconnect" href="https://image.mux.com" />
        <link rel="dns-prefetch" href="https://image.mux.com" />
      </Head>

      <main className="live-gallery-page min-h-screen bg-black px-4 pb-20 pt-5 text-white sm:px-6">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-center pb-5">
          <Link href="/" className="relative block h-14 w-14">
            <Image src="/brand/tenkings-logo.png" alt="Ten Kings Collectibles" fill sizes="56px" className="object-contain" priority />
          </Link>
        </header>

        {goldenActive ? <GoldenTicketHero rip={goldenActive} /> : null}

        <div className="mx-auto mt-10 flex w-full max-w-6xl flex-col gap-12">
          {hasRegularLive ? (
            <section>
              <SectionHeader title="Live Rips" eyebrow={goldenActive ? "Happening now" : "Live now"} />
              <HorizontalRow>
                {state.regularActive.map((rip) => (
                  <LiveRipCard key={rip.id} rip={rip} />
                ))}
              </HorizontalRow>
            </section>
          ) : null}

          {state.goldenTicketReveals.length > 0 ? (
            <section>
              <SectionHeader title="Golden Ticket Reveals" />
              <HorizontalRow>
                {state.goldenTicketReveals.map((rip) => (
                  <StaticRipCard key={rip.id} rip={rip} compact />
                ))}
              </HorizontalRow>
            </section>
          ) : null}

          <section>
            <SectionHeader title="Rips" />
            {state.pastRips.length > 0 ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {state.pastRips.map((rip) => (
                  <StaticRipCard key={rip.id} rip={rip} />
                ))}
              </div>
            ) : (
              <div className="rounded-[1.5rem] border border-white/10 bg-[#070707] px-6 py-12 text-center">
                <p className="font-heading text-2xl uppercase tracking-[0.14em] text-[#b99839]">
                  Past rips will land here after the first recording.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      <style jsx global>{`
        @keyframes tk-live-pulse {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          65% {
            transform: scale(1.45);
            opacity: 0.45;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        .tk-live-dot {
          animation: tk-live-pulse 1.2s ease-out infinite;
        }

        .live-gallery-page mux-player {
          --media-control-background: rgba(0, 0, 0, 0.78);
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
  initialState: LiveStatePayload;
}> = async () => {
  const { getLiveState } = await import("../lib/server/liveRip");
  const initialState = await getLiveState();

  return {
    props: {
      initialState,
    },
  };
};
