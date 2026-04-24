import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import MuxPlayer from "@mux/mux-player-react";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import type { GoldenTicketWinnerDetail } from "../../lib/server/goldenClaim";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function formatDateLabel(value: string | null) {
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

function formatCurrency(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function extractFirstName(displayName: string) {
  const [firstToken] = displayName.trim().split(/\s+/);
  return firstToken || displayName;
}

function GoldenFoilPanel({
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
      <div className={`relative h-full rounded-[1.95rem] border border-gold-400/20 bg-black/70 backdrop-blur ${innerClassName}`}>{children}</div>
    </div>
  );
}

type PageProps = {
  winner: GoldenTicketWinnerDetail;
  pageUrl: string;
  shareImageUrl: string;
};

export default function GoldenWinnerProfilePage({
  winner,
  pageUrl,
  shareImageUrl,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const [shareFlash, setShareFlash] = useState<string | null>(null);
  const winnerFirstName = useMemo(() => extractFirstName(winner.displayName), [winner.displayName]);
  const handle = useMemo(() => formatHandle(winner.displayHandle), [winner.displayHandle]);
  const claimDate = useMemo(() => formatDateLabel(winner.claimedAt ?? winner.publishedAt), [winner.claimedAt, winner.publishedAt]);
  const estimatedValue = useMemo(() => formatCurrency(winner.prize.estimatedValue), [winner.prize.estimatedValue]);
  const heroSubline = useMemo(() => {
    const segments = [claimDate ? `Claimed ${claimDate}` : null, winner.sourceLocation ? `Claimed through ${winner.sourceLocation.name}` : null].filter(
      Boolean
    ) as string[];
    return segments.join(" · ");
  }, [claimDate, winner.sourceLocation]);
  const previewImage = winner.winnerPhotoUrl ?? winner.prize.imageUrl ?? winner.prize.thumbnailUrl;
  const pageTitle = `Golden Ticket #${winner.ticketNumber} · ${winner.displayName} | Ten Kings`;
  const pageDescription = `${winner.displayName} claimed ${winner.prize.name}${
    winner.sourceLocation ? ` through ${winner.sourceLocation.name}` : ""
  }. Watch the crowned Golden Ticket reveal on Ten Kings.`;

  useEffect(() => {
    if (!shareFlash) {
      return;
    }
    const timeout = window.setTimeout(() => setShareFlash(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [shareFlash]);

  const handleCopyLink = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setShareFlash("Unable to copy link");
      return;
    }

    try {
      await navigator.clipboard.writeText(pageUrl);
      setShareFlash("Winner link copied to clipboard");
    } catch (error) {
      setShareFlash("Unable to copy link");
    }
  };

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:image" content={shareImageUrl} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="twitter:image" content={shareImageUrl} />
      </Head>

      <div className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top,rgba(233,189,72,0.18),transparent_60%)]" />
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex items-center justify-between gap-3">
            <Link href="/golden" className="text-xs uppercase tracking-[0.28em] text-gold-300 transition hover:text-gold-200">
              ← Back to Hall of Kings
            </Link>
            <span className="rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-1 text-[10px] uppercase tracking-[0.28em] text-gold-200">
              Golden Ticket #{winner.ticketNumber}
            </span>
          </div>

          <section className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
            <GoldenFoilPanel innerClassName="p-5 sm:p-6">
              <div className="space-y-6">
                <div className="space-y-4">
                  <p className="text-xs uppercase tracking-[0.34em] text-gold-300">Crowned Winner</p>
                  <div className="space-y-3">
                    <h1 className="font-heading text-5xl uppercase leading-[0.92] tracking-[0.1em] text-white sm:text-6xl">
                      {winnerFirstName}
                      <span className="block bg-gradient-to-r from-gold-300 via-gold-500 to-gold-300 bg-clip-text text-transparent">
                        Took The Crown
                      </span>
                    </h1>
                    {heroSubline ? <p className="text-sm uppercase tracking-[0.22em] text-slate-300 sm:text-base">{heroSubline}</p> : null}
                    {handle ? <p className="text-sm text-gold-200">{handle}</p> : null}
                  </div>
                </div>

                <div className="overflow-hidden rounded-[1.6rem] border border-white/10 bg-night-900">
                  {winner.liveRip?.muxPlaybackId ? (
                    <MuxPlayer
                      playbackId={winner.liveRip.muxPlaybackId}
                      streamType="on-demand"
                      metadataVideoTitle={winner.liveRip.title}
                      title={winner.liveRip.title}
                      poster={winner.liveRip.thumbnailUrl ?? winner.prize.thumbnailUrl ?? winner.prize.imageUrl ?? undefined}
                      autoPlay="muted"
                      muted
                      className="aspect-video w-full"
                    />
                  ) : previewImage ? (
                    <div className="relative aspect-video w-full">
                      <Image
                        src={previewImage}
                        alt={winner.prize.name}
                        fill
                        sizes="(min-width: 1024px) 55vw, 100vw"
                        className="object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                    </div>
                  ) : (
                    <div className="flex aspect-video items-center justify-center px-6 text-center text-sm text-slate-400">
                      Reveal media is still being crowned.
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex items-center justify-center rounded-full border border-gold-400/45 px-5 py-3 text-xs font-semibold uppercase tracking-[0.26em] text-gold-100 transition hover:border-gold-300 hover:bg-gold-500/10"
                  >
                    Share This Crown
                  </button>
                  {shareFlash ? <p className="text-sm text-slate-300">{shareFlash}</p> : null}
                </div>
              </div>
            </GoldenFoilPanel>

            <div className="space-y-6">
              <GoldenFoilPanel innerClassName="p-5 sm:p-6">
                <div className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.3em] text-gold-300">Prize Details</p>
                      <h2 className="font-heading text-3xl uppercase tracking-[0.12em] text-white">{winner.prize.name}</h2>
                    </div>
                    {estimatedValue ? (
                      <span className="rounded-full border border-gold-400/35 bg-gold-500/10 px-4 py-2 text-xs uppercase tracking-[0.24em] text-gold-100">
                        {estimatedValue}
                      </span>
                    ) : null}
                  </div>

                  {winner.prize.imageUrl ? (
                    <div className="relative aspect-square overflow-hidden rounded-[1.5rem] border border-white/10 bg-black">
                      <Image
                        src={winner.prize.imageUrl}
                        alt={winner.prize.name}
                        fill
                        sizes="(min-width: 1024px) 28vw, 100vw"
                        className="object-cover"
                      />
                    </div>
                  ) : null}

                  {winner.prize.description ? <p className="text-sm leading-7 text-slate-300">{winner.prize.description}</p> : null}

                  <div className="grid gap-4 border-t border-white/10 pt-4 text-sm text-slate-300">
                    {winner.sourceLocation ? (
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Found Through</p>
                        <p className="mt-1 text-base text-white">{winner.sourceLocation.name}</p>
                      </div>
                    ) : null}
                    {claimDate ? (
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">Claim Date</p>
                        <p className="mt-1 text-base text-white">{claimDate}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </GoldenFoilPanel>

              {winner.caption ? (
                <GoldenFoilPanel innerClassName="p-5 sm:p-6">
                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-[0.3em] text-gold-300">Hall Note</p>
                    <p className="text-sm leading-7 text-slate-300">{winner.caption}</p>
                  </div>
                </GoldenFoilPanel>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps<PageProps> = async (context) => {
  const rawTicketNumber = Array.isArray(context.params?.ticketNumber) ? context.params?.ticketNumber[0] : context.params?.ticketNumber;
  const ticketNumber = Number.parseInt(rawTicketNumber ?? "", 10);

  if (!Number.isFinite(ticketNumber) || ticketNumber <= 0) {
    return { notFound: true };
  }

  const [{ getPublicGoldenTicketWinnerByTicketNumber }, { buildSiteUrl }] = await Promise.all([
    import("../../lib/server/goldenClaim"),
    import("../../lib/server/urls"),
  ]);

  const winner = await getPublicGoldenTicketWinnerByTicketNumber(ticketNumber);
  if (!winner) {
    return { notFound: true };
  }

  return {
    props: {
      winner,
      pageUrl: buildSiteUrl(winner.winnerProfileUrl),
      shareImageUrl: buildSiteUrl(winner.shareCardUrl),
    },
  };
};
