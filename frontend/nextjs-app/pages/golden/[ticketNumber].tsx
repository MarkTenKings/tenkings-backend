import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import MuxPlayer from "@mux/mux-player-react";
import AppShell from "../../components/AppShell";

type WinnerDetail = {
  ticketNumber: number;
  winnerProfileUrl: string;
  shareCardUrl: string;
  displayName: string;
  displayHandle: string | null;
  caption: string | null;
  publishedAt: string;
  prize: {
    name: string;
    imageUrl: string | null;
    estimatedValue: number | null;
    description: string | null;
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

const formatCurrency = (value: number | null) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
};

export default function GoldenWinnerProfilePage() {
  const router = useRouter();
  const { ticketNumber } = router.query;
  const [winner, setWinner] = useState<WinnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof ticketNumber !== "string") {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/golden/winners/${encodeURIComponent(ticketNumber)}`)
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { winner?: WinnerDetail; message?: string };
        if (!response.ok || !payload.winner) {
          throw new Error(payload.message ?? "Winner profile not found");
        }
        return payload.winner;
      })
      .then((payload) => {
        if (!cancelled) {
          setWinner(payload);
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : "Winner profile not found");
          setWinner(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ticketNumber]);

  const title = winner ? `Golden Ticket #${winner.ticketNumber} · ${winner.displayName}` : "Golden Ticket Winner";

  return (
    <AppShell background="gilded" brandVariant="collectibles">
      <Head>
        <title>{title} | Ten Kings</title>
      </Head>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
        {loading ? (
          <div className="rounded-[2rem] border border-white/10 bg-black/35 p-8 text-sm text-slate-300">Loading winner profile...</div>
        ) : null}

        {!loading && error ? (
          <div className="rounded-[2rem] border border-rose-400/30 bg-rose-500/10 p-8 text-sm text-rose-100">{error}</div>
        ) : null}

        {!loading && !error && winner ? (
          <>
            <header className="space-y-3">
              <p className="text-xs uppercase tracking-[0.38em] text-gold-300">Golden Ticket #{winner.ticketNumber}</p>
              <h1 className="font-heading text-4xl uppercase tracking-[0.12em] text-white">{winner.displayName}</h1>
              <p className="text-sm text-slate-300">
                Won: {winner.prize.name}
                {winner.sourceLocation ? ` · Found through ${winner.sourceLocation.name}` : ""}
              </p>
            </header>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
              <section className="space-y-4 rounded-[2rem] border border-white/10 bg-black/35 p-5 backdrop-blur">
                <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-black">
                  {winner.liveRip?.muxPlaybackId ? (
                    <MuxPlayer
                      playbackId={winner.liveRip.muxPlaybackId}
                      streamType="on-demand"
                      metadata={{ video_title: winner.liveRip.title }}
                      className="aspect-video w-full"
                    />
                  ) : winner.liveRip?.videoUrl?.endsWith(".mp4") ? (
                    <video
                      controls
                      playsInline
                      className="aspect-video w-full"
                      poster={winner.liveRip.thumbnailUrl ?? undefined}
                      src={winner.liveRip.videoUrl}
                    />
                  ) : winner.liveRip ? (
                    <div className="flex aspect-video items-center justify-center bg-black/70 p-6 text-center text-sm text-slate-300">
                      <a className="text-gold-300 underline" href={winner.liveRip.videoUrl} target="_blank" rel="noreferrer">
                        Watch the reveal
                      </a>
                    </div>
                  ) : (
                    <div className="flex aspect-video items-center justify-center bg-black/70 text-sm text-slate-400">Reveal video is still processing.</div>
                  )}
                </div>
                {winner.caption ? <p className="text-sm text-slate-200">{winner.caption}</p> : null}
              </section>

              <aside className="space-y-4 rounded-[2rem] border border-white/10 bg-black/35 p-5 backdrop-blur">
                {winner.prize.imageUrl ? (
                  <div className="relative aspect-square overflow-hidden rounded-[1.5rem] border border-white/10 bg-black">
                    <Image src={winner.prize.imageUrl} alt={winner.prize.name} fill className="object-cover" sizes="(min-width: 1024px) 25vw, 100vw" />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Prize</p>
                  <h2 className="font-heading text-2xl uppercase tracking-[0.12em] text-white">{winner.prize.name}</h2>
                  {winner.displayHandle ? <p className="text-sm text-gold-200">{winner.displayHandle}</p> : null}
                  {winner.prize.description ? <p className="text-sm text-slate-300">{winner.prize.description}</p> : null}
                  {formatCurrency(winner.prize.estimatedValue) ? (
                    <p className="text-sm text-slate-300">Estimated value: {formatCurrency(winner.prize.estimatedValue)}</p>
                  ) : null}
                </div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">
                  Published {new Date(winner.publishedAt).toLocaleDateString()}
                </p>
                <div className="pt-2">
                  <Link href="/live" className="text-sm text-gold-300 underline">
                    Back to Live
                  </Link>
                </div>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
