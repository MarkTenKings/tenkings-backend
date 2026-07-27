import Head from "next/head";
import Link from "next/link";
import { GetServerSideProps } from "next";
import MuxPlayer from "@mux/mux-player-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { Prisma } from "@prisma/client";
import { prisma } from "@tenkings/database";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";

const embedForMedia = (videoUrl: string) => {
  if (/youtu\.be|youtube\.com/.test(videoUrl)) {
    try {
      const url = new URL(videoUrl);
      const videoId = url.searchParams.get("v") ?? videoUrl.split("/").pop();
      if (videoId) {
        return { type: "youtube" as const, id: videoId };
      }
    } catch (error) {
      // fall back to link
    }
  }
  if (videoUrl.endsWith(".mp4")) {
    return { type: "video" as const, src: videoUrl };
  }
  return { type: "link" as const, href: videoUrl };
};

interface LiveRipPageProps {
  liveRip: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    videoUrl: string;
    thumbnailUrl: string | null;
    muxPlaybackId: string | null;
    status: string;
    isClaimed: boolean;
    location: {
      id: string;
      name: string;
      slug: string;
    } | null;
    createdAt: string;
  };
  more: Array<{ slug: string; title: string }>;
}

type QrClaimState = "creating" | "ready" | "claimed" | "expired" | "unavailable" | "error";

export default function LiveRipPage({ liveRip, more }: LiveRipPageProps) {
  const { session } = useSession();
  const media = embedForMedia(liveRip.videoUrl);
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  const canManageClaim = isAdmin && liveRip.status === "COMPLETE";
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimState, setClaimState] = useState<QrClaimState>(
    liveRip.isClaimed ? "claimed" : "creating"
  );
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [claimExpiresAt, setClaimExpiresAt] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [copyComplete, setCopyComplete] = useState(false);
  const [isClaimed, setIsClaimed] = useState(liveRip.isClaimed);
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const generateClaimQr = useCallback(async () => {
    if (!session || !canManageClaim || isClaimed) {
      return;
    }

    setClaimState("creating");
    setClaimMessage(null);
    setClaimUrl(null);
    setClaimExpiresAt(null);
    setCopyComplete(false);
    try {
      const response = await fetch(
        `/api/live-rip/clips/${encodeURIComponent(liveRip.id)}/claim-link`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.token}`,
          },
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        claim?: {
          claimUrl?: string;
          claimExpiresAt?: string;
        };
      };
      if (!response.ok) {
        if (response.status === 409 && /already.*claimed/i.test(payload.message ?? "")) {
          setIsClaimed(true);
          setClaimState("claimed");
          return;
        }
        if (response.status === 404) {
          setClaimState("unavailable");
          setClaimMessage(payload.message ?? "This Live Rip video is unavailable.");
          return;
        }
        throw new Error(payload.message ?? "Unable to create the customer claim QR");
      }
      if (!payload.claim?.claimUrl || !payload.claim.claimExpiresAt) {
        throw new Error("The secure claim link was not returned");
      }
      setClaimUrl(payload.claim.claimUrl);
      setClaimExpiresAt(payload.claim.claimExpiresAt);
      setClaimState("ready");
    } catch (error) {
      setClaimState("error");
      setClaimMessage(
        error instanceof Error ? error.message : "Unable to create the customer claim QR"
      );
    }
  }, [canManageClaim, isClaimed, liveRip.id, session]);

  useEffect(() => {
    const canvas = qrCanvasRef.current;
    if (!canvas || claimState !== "ready" || !claimUrl) {
      return;
    }

    QRCode.toCanvas(canvas, claimUrl, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    }).catch((error) => {
      console.error("[live-rip-claim] failed to render QR", error);
      setClaimState("error");
      setClaimMessage("Unable to display the customer claim QR");
    });
  }, [claimState, claimUrl]);

  useEffect(() => {
    if (!claimOpen || claimState !== "ready" || !session) {
      return;
    }

    let cancelled = false;
    const loadStatus = async () => {
      try {
        const response = await fetch(
          `/api/live-rip/clips/${encodeURIComponent(liveRip.id)}/claim-link`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${session.token}`,
              Accept: "application/json",
            },
          }
        );
        const payload = (await response.json().catch(() => ({}))) as {
          claim?: { status?: QrClaimState };
        };
        if (!response.ok || cancelled) {
          return;
        }
        if (payload.claim?.status === "claimed") {
          setIsClaimed(true);
          setClaimState("claimed");
        } else if (payload.claim?.status === "expired") {
          setClaimState("expired");
        } else if (payload.claim?.status === "unavailable") {
          setClaimState("unavailable");
        }
      } catch (error) {
        // Keep the QR visible through transient polling failures.
      }
    };

    const interval = window.setInterval(() => {
      void loadStatus();
    }, 2000);
    void loadStatus();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [claimOpen, claimState, liveRip.id, session]);

  const renderMedia = () => {
    if (liveRip.muxPlaybackId) {
      return (
        <div className="overflow-hidden rounded-[2.5rem] border border-white/10 bg-night-900/70 shadow-card">
          <MuxPlayer
            playbackId={liveRip.muxPlaybackId}
            streamType={liveRip.status === "LIVE" ? "live" : "on-demand"}
            metadataVideoTitle={liveRip.title}
            title={liveRip.title}
            autoPlay={liveRip.status === "LIVE"}
            muted={false}
            poster={liveRip.thumbnailUrl ?? undefined}
            className="h-full w-full"
          />
        </div>
      );
    }

    switch (media.type) {
      case "youtube":
        return (
          <div className="relative w-full overflow-hidden rounded-[2.5rem] border border-white/10 bg-night-900/70 pt-[56.25%] shadow-card">
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube.com/embed/${media.id}`}
              title={liveRip.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        );
      case "video":
        return (
          <video
            controls
            className="w-full rounded-[2.5rem] border border-white/10 bg-night-900/70 shadow-card"
          >
            <source src={media.src} type="video/mp4" />
            Your browser does not support embedded video.
          </video>
        );
      default:
        return (
          <div className="rounded-[2.5rem] border border-white/10 bg-night-900/70 p-10 text-center shadow-card">
            <p className="text-sm text-slate-300">
              This video is hosted externally. Follow the link below to watch the rip.
            </p>
            <Link
              href={media.href}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
            >
              Watch video
            </Link>
          </div>
        );
    }
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings Live · {liveRip.title}</title>
        <meta
          name="description"
          content={`Watch ${liveRip.title} from the Ten Kings live rip series.`}
        />
      </Head>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-violet-300">
            {liveRip.location?.name ?? "Ten Kings Live"}
          </p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white md:text-5xl">
            {liveRip.title}
          </h1>
          <p className="text-xs text-slate-400">
            {liveRip.status === "LIVE" ? "Live now" : `Recorded ${new Date(liveRip.createdAt).toLocaleString()}`}
          </p>
        </header>

        {renderMedia()}

        {liveRip.description && (
          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6 text-sm text-slate-200">
            {liveRip.description}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={async () => {
              if (typeof window === "undefined") {
                return;
              }
              try {
                await navigator.clipboard.writeText(window.location.href);
              } catch (error) {
                // noop
              }
            }}
            className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200"
          >
            Copy link
          </button>
          <Link
            href="/live"
            className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200"
          >
            Back to live rips
          </Link>
          {canManageClaim && (
            <button
              type="button"
              disabled={isClaimed}
              onClick={() => {
                setClaimOpen(true);
                if (isClaimed) {
                  setClaimState("claimed");
                  return;
                }
                void generateClaimQr();
              }}
              className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-white/10 disabled:text-slate-500"
            >
              {isClaimed ? "Live Rip Claimed" : "Show Customer Claim QR"}
            </button>
          )}
          {liveRip.location && (
            <Link
              href={`/locations#${liveRip.location.slug}`}
              className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200"
            >
              Visit location page
            </Link>
          )}
        </div>

        {more.length > 0 && (
          <section className="space-y-4">
            <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">More live rips</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {more.map((entry) => (
                <Link
                  key={entry.slug}
                  href={`/live/${entry.slug}`}
                  className="rounded-2xl border border-white/10 bg-night-900/70 px-4 py-3 text-sm text-slate-200 transition hover:border-gold-400/60 hover:text-gold-200"
                >
                  {entry.title}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      {claimOpen && canManageClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-sm">
          <section className="relative max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-gold-500/30 bg-night-900 p-8 text-center shadow-card">
            <button
              type="button"
              onClick={() => setClaimOpen(false)}
              className="absolute right-5 top-5 rounded-full border border-white/10 px-3 py-1 text-sm text-slate-400 transition hover:text-white"
              aria-label="Close customer claim QR"
            >
              ×
            </button>
            <p className="text-xs uppercase tracking-[0.34em] text-gold-300">Recorded Live Rip</p>
            <h2 className="mt-3 font-heading text-3xl uppercase tracking-[0.16em] text-white">
              Scan to Save Your Live Rip
            </h2>
            <p className="mt-3 text-sm text-slate-400">
              Scan this QR code to add the video to your Ten Kings account.
            </p>

            <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black/30 text-left">
              {liveRip.thumbnailUrl ? (
                <div
                  className="aspect-video bg-cover bg-center"
                  style={{
                    backgroundImage: `url("${liveRip.thumbnailUrl.replaceAll('"', "%22")}")`,
                  }}
                />
              ) : null}
              <div className="p-4">
                <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                  Selected recording
                </p>
                <p className="mt-2 font-heading text-xl uppercase tracking-[0.12em] text-white">
                  {liveRip.title}
                </p>
              </div>
            </div>

            <div className="mt-6 flex min-h-[360px] flex-col items-center justify-center">
              {claimState === "creating" ? (
                <>
                  <div className="h-12 w-12 animate-spin rounded-full border-2 border-gold-500/20 border-t-gold-400" />
                  <p className="mt-5 text-sm text-slate-300">Creating secure claim QR…</p>
                </>
              ) : null}

              {claimState === "ready" && claimUrl ? (
                <>
                  <canvas
                    ref={qrCanvasRef}
                    className="h-[320px] w-[320px] max-w-full rounded-2xl bg-white"
                    aria-label="Customer Live Rip claim QR code"
                  />
                  <p className="mt-4 text-xs uppercase tracking-[0.24em] text-slate-500">
                    Secure single-use link · expires in 15 minutes
                  </p>
                  {claimExpiresAt ? (
                    <p className="mt-2 text-xs text-slate-600">
                      Valid until {new Date(claimExpiresAt).toLocaleTimeString()}
                    </p>
                  ) : null}
                </>
              ) : null}

              {claimState === "claimed" ? (
                <div className="w-full rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-8 text-emerald-100">
                  <p className="font-heading text-2xl uppercase tracking-[0.14em]">
                    This Live Rip has already been claimed.
                  </p>
                  <p className="mt-3 text-sm text-emerald-200/80">
                    The video is now in the customer&apos;s Live Rips collection.
                  </p>
                </div>
              ) : null}

              {claimState === "expired" ? (
                <div className="w-full rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-8 text-amber-100">
                  <p className="font-heading text-2xl uppercase tracking-[0.14em]">
                    Claim QR expired
                  </p>
                  <p className="mt-3 text-sm text-amber-200/80">
                    Create a fresh QR while the customer is ready to scan.
                  </p>
                </div>
              ) : null}

              {claimState === "unavailable" ? (
                <div className="w-full rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-8 text-rose-100">
                  <p className="font-heading text-2xl uppercase tracking-[0.14em]">
                    Video unavailable
                  </p>
                  <p className="mt-3 text-sm text-rose-200/80">
                    {claimMessage ?? "This recording cannot be claimed right now."}
                  </p>
                </div>
              ) : null}

              {claimState === "error" ? (
                <div className="w-full rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-8 text-rose-100">
                  <p className="font-heading text-2xl uppercase tracking-[0.14em]">
                    Unable to create QR
                  </p>
                  <p className="mt-3 text-sm text-rose-200/80">
                    {claimMessage ?? "Unexpected server error"}
                  </p>
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {claimState === "ready" && claimUrl ? (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(claimUrl);
                      setCopyComplete(true);
                    } catch (error) {
                      setClaimMessage("Unable to copy the claim link");
                    }
                  }}
                  className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400"
                >
                  {copyComplete ? "Claim Link Copied" : "Copy Claim Link"}
                </button>
              ) : null}
              {(claimState === "expired" || claimState === "error") && !isClaimed ? (
                <button
                  type="button"
                  onClick={() => void generateClaimQr()}
                  className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-night-900 shadow-glow transition hover:bg-gold-400"
                >
                  Generate New QR
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setClaimOpen(false)}
                className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps<LiveRipPageProps> = async (context) => {
  const slug = Array.isArray(context.params?.slug) ? context.params?.slug[0] : context.params?.slug;

  if (!slug) {
    return { notFound: true };
  }

  let liveRip;
  try {
    liveRip = await prisma.liveRip.findUnique({
      where: { slug },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return {
        redirect: {
          destination: "/live",
          permanent: false,
        },
      };
    }
    throw error;
  }

  if (!liveRip) {
    return { notFound: true };
  }

  let more: Array<{ slug: string; title: string }>;
  try {
    more = await prisma.liveRip.findMany({
      where: {
        slug: { not: slug },
      },
      select: {
        slug: true,
        title: true,
      },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      more = [];
    } else {
      throw error;
    }
  }

  return {
    props: {
      liveRip: {
        id: liveRip.id,
        slug: liveRip.slug,
        title: liveRip.title,
        description: liveRip.description,
        videoUrl: liveRip.videoUrl,
        thumbnailUrl: liveRip.thumbnailUrl,
        muxPlaybackId: liveRip.muxPlaybackId ?? null,
        status: liveRip.status,
        isClaimed: Boolean(liveRip.claimedAt || liveRip.userId),
        location: liveRip.location,
        createdAt: liveRip.createdAt.toISOString(),
      },
      more: more.map((entry) => ({ slug: entry.slug, title: entry.title })),
    },
  };
};
