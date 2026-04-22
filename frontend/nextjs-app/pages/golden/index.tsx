import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import MuxPlayer from "@mux/mux-player-react";
import { startTransition, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";

type GoldenHallWinner = {
  id: string;
  ticketNumber: number;
  winnerProfileUrl: string;
  shareCardUrl: string;
  displayName: string;
  displayHandle: string | null;
  caption: string | null;
  featured: boolean;
  publishedAt: string;
  claimedAt: string | null;
  winnerPhotoUrl: string | null;
  prize: {
    name: string;
    imageUrl: string | null;
    thumbnailUrl: string | null;
  };
  sourceLocation: {
    id: string;
    name: string;
    slug: string;
  } | null;
  liveRip: {
    slug: string;
    title: string;
    videoUrl: string;
    thumbnailUrl: string | null;
    muxPlaybackId: string | null;
  } | null;
};

type GoldenHallPagination = {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
};

type GoldenHallStats = {
  claimedCount: number;
  placedCount: number;
  featuredTicketIds: string[];
};

const HOW_IT_WORKS_STEPS = [
  {
    step: "1",
    title: "Rip The Pack",
    body: "Crack a Ten Kings mystery pack and hunt for the hidden Golden Ticket waiting inside.",
  },
  {
    step: "2",
    title: "Scan The QR",
    body: "Hit the ticket QR on your phone, sign in, and unlock the reveal flow in one page.",
  },
  {
    step: "3",
    title: "Reveal It Live",
    body: "Go camera-on, launch the countdown, and stream your founder reveal moment into the Hall.",
  },
  {
    step: "4",
    title: "Claim The Prize",
    body: "Lock in shipping details, take your crown, and join the Hall of Kings forever.",
  },
];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatClaimDate(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : dateFormatter.format(parsed);
}

function formatHandle(handle: string | null) {
  if (!handle) {
    return null;
  }
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function GoldenFoilFrame({
  children,
  className = "",
  innerClassName = "",
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-[2rem] p-[1px] ${className}`}>
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(115deg,rgba(233,189,72,0.15),rgba(252,231,178,0.95),rgba(209,158,47,0.35),rgba(252,231,178,0.95),rgba(233,189,72,0.12))] bg-[length:200%_100%] animate-shimmer"
      />
      <div className={`relative h-full rounded-[1.95rem] border border-gold-400/20 bg-black/65 backdrop-blur ${innerClassName}`}>{children}</div>
    </div>
  );
}

function GoldenTicketHeroVisual() {
  return (
    <GoldenFoilFrame className="mx-auto w-full max-w-[420px] shadow-[0_28px_90px_rgba(0,0,0,0.5)]" innerClassName="overflow-hidden">
      <div className="relative isolate aspect-[5/3] bg-[radial-gradient(circle_at_top,rgba(245,211,122,0.18),transparent_46%),linear-gradient(135deg,rgba(12,10,6,1),rgba(30,23,10,0.96)_52%,rgba(12,10,6,1))] px-6 py-6 sm:px-8 sm:py-7">
        <div aria-hidden className="absolute -left-4 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full border border-gold-400/25 bg-night-900" />
        <div aria-hidden className="absolute -right-4 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full border border-gold-400/25 bg-night-900" />
        <div aria-hidden className="absolute inset-x-6 top-6 h-px bg-gradient-to-r from-transparent via-gold-400/60 to-transparent" />
        <div aria-hidden className="absolute inset-x-6 bottom-6 h-px bg-gradient-to-r from-transparent via-gold-400/40 to-transparent" />
        <div aria-hidden className="absolute right-6 top-6 rounded-full border border-gold-400/25 px-3 py-1 text-[10px] uppercase tracking-[0.34em] text-gold-300/80">Golden</div>
        <div className="flex h-full flex-col justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.38em] text-gold-200/80">Ten Kings Collectibles</p>
            <h2 className="mt-5 font-heading text-5xl uppercase leading-[0.9] tracking-[0.12em] text-white sm:text-6xl">
              Golden
              <span className="block bg-gradient-to-r from-gold-300 via-gold-500 to-gold-300 bg-clip-text text-transparent">Ticket</span>
            </h2>
            <p className="mt-3 max-w-[15rem] text-sm text-slate-300">
              Hidden in select mystery packs. Find one and take your place in the Hall.
            </p>
          </div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.34em] text-slate-500">Claim Route</p>
              <p className="mt-2 font-mono text-xs text-slate-200">/golden/claim/[code]</p>
            </div>
            <p className="bg-gradient-to-r from-gold-300 via-gold-500 to-gold-300 bg-clip-text font-heading text-4xl tracking-[0.18em] text-transparent">#0001</p>
          </div>
        </div>
      </div>
    </GoldenFoilFrame>
  );
}

function HallWinnerCard({ winner }: { winner: GoldenHallWinner }) {
  const handle = formatHandle(winner.displayHandle);
  const claimDate = formatClaimDate(winner.claimedAt ?? winner.publishedAt);
  const fallbackImage = winner.winnerPhotoUrl ?? winner.prize.thumbnailUrl ?? winner.prize.imageUrl;

  return (
    <GoldenFoilFrame innerClassName="h-full">
      <article className="flex h-full flex-col">
        <div className="relative overflow-hidden rounded-t-[1.95rem] border-b border-white/10 bg-night-900">
          {winner.featured ? (
            <div className="absolute left-4 top-4 z-10 rounded-full border border-gold-400/40 bg-black/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-200">
              Featured
            </div>
          ) : null}
          {winner.liveRip?.muxPlaybackId ? (
            <MuxPlayer
              playbackId={winner.liveRip.muxPlaybackId}
              streamType="on-demand"
              metadataVideoTitle={winner.liveRip.title}
              title={winner.liveRip.title}
              poster={winner.liveRip.thumbnailUrl ?? winner.prize.thumbnailUrl ?? winner.prize.imageUrl ?? undefined}
              className="aspect-video w-full"
            />
          ) : fallbackImage ? (
            <div className="relative aspect-video w-full">
              <Image
                src={fallbackImage}
                alt={winner.prize.name}
                fill
                sizes="(min-width: 1536px) 24vw, (min-width: 1024px) 30vw, 100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center bg-night-900 px-6 text-center text-sm text-slate-400">
              Reveal video is still being crowned.
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.34em] text-gold-200">Golden Ticket #{winner.ticketNumber}</p>
            <h3 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">{winner.displayName}</h3>
            {handle ? <p className="text-sm text-gold-300">{handle}</p> : null}
          </div>

          <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Prize</p>
              <p className="mt-1 text-base text-white">{winner.prize.name}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Found Through</p>
              <p className="mt-1 text-base text-white">{winner.sourceLocation?.name ?? "Location pending"}</p>
            </div>
          </div>

          {winner.caption ? (
            <p className="text-sm leading-6 text-slate-300 [display:-webkit-box] overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
              {winner.caption}
            </p>
          ) : null}

          <div className="mt-auto flex items-center justify-between gap-4 border-t border-white/10 pt-4">
            <div className="flex min-w-0 items-center gap-3">
              {winner.winnerPhotoUrl ? (
                <div className="relative h-11 w-11 overflow-hidden rounded-full border border-gold-400/30 bg-black">
                  <Image
                    src={winner.winnerPhotoUrl}
                    alt={winner.displayName}
                    fill
                    sizes="44px"
                    className="object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-night-900 text-[10px] uppercase tracking-[0.26em] text-slate-500">
                  TK
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.26em] text-slate-500">Claimed</p>
                <p className="truncate text-sm text-slate-200">{claimDate ?? "Awaiting date"}</p>
              </div>
            </div>

            <Link
              href={winner.winnerProfileUrl}
              className="inline-flex items-center justify-center rounded-full border border-gold-400/45 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-gold-100 transition hover:border-gold-300 hover:bg-gold-500/10"
            >
              Enter The Hall
            </Link>
          </div>
        </div>
      </article>
    </GoldenFoilFrame>
  );
}

export default function GoldenHallPage({
  initialWinners,
  initialPagination,
  stats,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const [winners, setWinners] = useState(initialWinners);
  const [pagination, setPagination] = useState(initialPagination);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const featuredCount = stats.featuredTicketIds.length;
  const heroStatusLine = useMemo(() => {
    if (featuredCount > 0) {
      return `${featuredCount} featured ${featuredCount === 1 ? "King" : "Kings"} already hold court in the Hall.`;
    }
    return "The next crown is still waiting in the wild.";
  }, [featuredCount]);

  async function handleLoadMore() {
    if (!pagination.hasMore || loadingMore) {
      return;
    }

    setLoadingMore(true);
    setLoadMoreError(null);

    try {
      const response = await fetch(
        `/api/golden/winners?page=${encodeURIComponent(String(pagination.page + 1))}&limit=${encodeURIComponent(
          String(pagination.limit)
        )}`
      );
      const payload = (await response.json().catch(() => ({}))) as {
        winners?: GoldenHallWinner[];
        pagination?: GoldenHallPagination;
        message?: string;
      };

      if (!response.ok || !Array.isArray(payload.winners) || !payload.pagination) {
        throw new Error(payload.message ?? "Failed to load more Kings");
      }

      startTransition(() => {
        setWinners((current) => [...current, ...payload.winners!]);
        setPagination(payload.pagination!);
      });
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : "Failed to load more Kings");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>The Ten Kings Golden Ticket Hall | Ten Kings</title>
        <meta
          name="description"
          content="Find the Golden Ticket, stream your reveal, and join the Ten Kings Hall of Kings."
        />
      </Head>

      <div className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(circle_at_top,rgba(233,189,72,0.18),transparent_58%)]" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-[-12rem] w-[28rem] bg-[radial-gradient(circle,rgba(233,189,72,0.08),transparent_68%)]" />

        <section className="relative border-b border-white/8">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 pb-16 pt-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-center lg:gap-14 lg:pb-20 lg:pt-16">
            <div className="space-y-6">
              <p className="text-xs uppercase tracking-[0.38em] text-gold-300">The Ten Kings Golden Ticket</p>
              <div className="space-y-4">
                <h1 className="font-heading text-5xl uppercase leading-[0.9] tracking-[0.1em] text-white sm:text-6xl lg:text-7xl">
                  Join The
                  <span className="block bg-gradient-to-r from-gold-300 via-gold-500 to-gold-300 bg-clip-text text-transparent">
                    Hall Of Kings
                  </span>
                </h1>
                <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                  Hidden in select mystery packs. Find one, claim your prize, and etch your reveal into the public Ten Kings Hall.
                </p>
              </div>

              <GoldenFoilFrame className="max-w-xl" innerClassName="px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Golden Ticket Counter</p>
                    <div className="flex flex-wrap items-end gap-5">
                      <div>
                        <p className="font-heading text-5xl tracking-[0.12em] text-white">{stats.claimedCount}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-gold-200">Found</p>
                      </div>
                      <div className="h-12 w-px bg-white/10" aria-hidden />
                      <div>
                        <p className="font-heading text-5xl tracking-[0.12em] text-white">{stats.placedCount}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-gold-200">Still In Circulation</p>
                      </div>
                    </div>
                  </div>
                  <p className="max-w-xs text-sm leading-6 text-slate-300">{heroStatusLine}</p>
                </div>
              </GoldenFoilFrame>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/packs"
                  className="inline-flex items-center justify-center rounded-full bg-gold-500 px-8 py-4 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 transition hover:bg-gold-400"
                >
                  Shop Mystery Packs
                </Link>
                <Link
                  href="/live"
                  className="inline-flex items-center justify-center rounded-full border border-white/12 px-8 py-4 text-xs font-semibold uppercase tracking-[0.28em] text-white transition hover:border-gold-400/50 hover:text-gold-200"
                >
                  Watch Live Reveals
                </Link>
              </div>
            </div>

            <div className="lg:justify-self-end">
              <GoldenTicketHeroVisual />
            </div>
          </div>
        </section>

        <section className="border-b border-white/8 bg-night-900/40">
          <div className="mx-auto w-full max-w-6xl px-6 py-14 sm:py-16">
            <div className="flex flex-col gap-3">
              <p className="text-xs uppercase tracking-[0.34em] text-gold-300">How It Works</p>
              <h2 className="font-heading text-4xl uppercase tracking-[0.12em] text-white sm:text-5xl">Rip. Scan. Reveal. Claim.</h2>
              <p className="max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                The Golden Ticket flow is built for one clean motion: hit the ticket, go live, meet the prize, and lock in the shipment.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {HOW_IT_WORKS_STEPS.map((step) => (
                <GoldenFoilFrame key={step.step} innerClassName="h-full px-5 py-5">
                  <div className="flex h-full flex-col gap-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-heading text-4xl tracking-[0.14em] text-gold-300">{step.step}</span>
                      <span className="rounded-full border border-gold-400/30 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-300">
                        Step {step.step}
                      </span>
                    </div>
                    <h3 className="font-heading text-2xl uppercase tracking-[0.12em] text-white">{step.title}</h3>
                    <p className="text-sm leading-6 text-slate-300">{step.body}</p>
                  </div>
                </GoldenFoilFrame>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto w-full max-w-6xl px-6 py-14 sm:py-16">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.34em] text-gold-300">Hall Of Kings</p>
                <h2 className="font-heading text-4xl uppercase tracking-[0.12em] text-white sm:text-5xl">Every Crowned Reveal</h2>
                <p className="max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                  Featured winners rise first. Every card below points to the public winner page and reveal archive for that Golden Ticket.
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-slate-300">
                {pagination.totalCount} {pagination.totalCount === 1 ? "King" : "Kings"} in the Hall
              </div>
            </div>

            {winners.length === 0 ? (
              <GoldenFoilFrame className="mt-8" innerClassName="px-6 py-12 text-center">
                <p className="text-xs uppercase tracking-[0.34em] text-gold-300">No crowned reveals yet</p>
                <h3 className="mt-4 font-heading text-3xl uppercase tracking-[0.12em] text-white">The next Golden Ticket starts the Hall.</h3>
                <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                  The page is live and waiting. The first claimed ticket will appear here automatically once the reveal and claim finish.
                </p>
              </GoldenFoilFrame>
            ) : (
              <>
                <div className="mt-8 grid grid-cols-1 gap-5 xl:grid-cols-3 lg:grid-cols-2">
                  {winners.map((winner) => (
                    <HallWinnerCard key={winner.id} winner={winner} />
                  ))}
                </div>

                {pagination.hasMore ? (
                  <div className="mt-10 flex flex-col items-center gap-4">
                    {loadMoreError ? <p className="text-sm text-rose-300">{loadMoreError}</p> : null}
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="inline-flex items-center justify-center rounded-full border border-gold-400/45 px-8 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-gold-100 transition hover:border-gold-300 hover:bg-gold-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loadingMore ? "Loading More Kings..." : "Load More Kings"}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps<{
  initialWinners: GoldenHallWinner[];
  initialPagination: GoldenHallPagination;
  stats: GoldenHallStats;
}> = async () => {
  const { getGoldenTicketHallStats, listGoldenTicketWinners } = await import("../../lib/server/goldenClaim");
  const [stats, winnersResult] = await Promise.all([
    getGoldenTicketHallStats(),
    listGoldenTicketWinners({ page: 1, limit: 9 }),
  ]);

  return {
    props: {
      initialWinners: winnersResult.winners,
      initialPagination: winnersResult.pagination,
      stats,
    },
  };
};
