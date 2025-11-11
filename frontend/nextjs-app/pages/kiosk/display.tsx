import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import { useRouter } from "next/router";
import type { SerializedKioskSession } from "../../lib/server/kioskSession";

interface DisplayResponse {
  location: {
    id: string;
    name: string;
    slug: string;
  };
  session: SerializedKioskSession | null;
}

const POLL_INTERVAL_MS = 4000;
const TIMER_TICK_MS = 1000;
const ATTRACT_VIDEO_URL = process.env.NEXT_PUBLIC_KIOSK_ATTRACT_VIDEO_URL ?? "";

const formatDuration = (ms: number) => {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const extractRevealDetails = (session: SerializedKioskSession | null) => {
  if (!session?.reveal || typeof session.reveal !== "object" || Array.isArray(session.reveal)) {
    return null;
  }

  const payload = session.reveal as Record<string, unknown>;
  return {
    name: (payload.name as string) ?? null,
    set: (payload.set as string) ?? null,
    number: (payload.number as string) ?? null,
    imageUrl: (payload.imageUrl as string) ?? (payload.thumbnailUrl as string) ?? null,
  };
};

export default function KioskDisplayPage() {
  const router = useRouter();
  const locationIdParam = router.query.locationId;
  const slugParam = router.query.slug ?? router.query.location;
  const locationId = typeof locationIdParam === "string" ? locationIdParam : Array.isArray(locationIdParam) ? locationIdParam[0] : undefined;
  const slug = typeof slugParam === "string" ? slugParam : Array.isArray(slugParam) ? slugParam[0] : undefined;

  const [display, setDisplay] = useState<DisplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const session = display?.session ?? null;
  const reveal = useMemo(() => extractRevealDetails(session), [session]);

  const countdownRemaining = useMemo(() => {
    if (!session?.countdownEndsAt) {
      return 0;
    }
    return new Date(session.countdownEndsAt).getTime() - now;
  }, [session?.countdownEndsAt, now]);

  const liveRemaining = useMemo(() => {
    if (!session?.liveEndsAt) {
      return 0;
    }
    return new Date(session.liveEndsAt).getTime() - now;
  }, [session?.liveEndsAt, now]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TIMER_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    if (!locationId && !slug) {
      setError("Add ?locationId=… or ?slug=… to target a kiosk location.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    let poll: number | null = null;

    const fetchDisplay = async () => {
      if (cancelled) {
        return;
      }
      try {
        const params = new URLSearchParams();
        if (locationId) {
          params.set("locationId", locationId);
        } else if (slug) {
          params.set("slug", slug);
        }
        const response = await fetch(`/api/kiosk/display?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<DisplayResponse> & {
          message?: string;
        };
        if (!response.ok || !payload || !payload.location) {
          throw new Error(payload?.message ?? "Failed to load kiosk display");
        }
        if (cancelled) {
          return;
        }
        setDisplay(payload as DisplayResponse);
        setLastUpdated(Date.now());
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : "Unable to reach kiosk display";
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchDisplay();
    poll = window.setInterval(() => {
      void fetchDisplay();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (poll) {
        window.clearInterval(poll);
      }
    };
  }, [router.isReady, locationId, slug]);

  const renderCountdown = () => (
    <div className="flex flex-col items-center gap-6 text-center">
      <p className="text-sm uppercase tracking-[0.4em] text-slate-300">Countdown</p>
      <p className="font-heading text-[clamp(4rem,12vw,12rem)] tracking-[0.08em] text-white">
        {formatDuration(countdownRemaining)}
      </p>
      <p className="max-w-2xl text-lg text-slate-300">
        When the timer hits zero the stream is live. Keep the pack centered on camera and get ready to rip.
      </p>
    </div>
  );

  const renderLive = () => (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex items-center gap-3 text-rose-300">
        <span className="h-3 w-3 animate-pulse rounded-full bg-rose-500" />
        <p className="text-sm uppercase tracking-[0.45em]">Live</p>
      </div>
      <p className="font-heading text-[clamp(3.5rem,10vw,10rem)] tracking-[0.08em] text-white">
        {formatDuration(liveRemaining)}
      </p>
      <p className="max-w-2xl text-lg text-slate-200">
        The countdown is over—Ten Kings Live is airing. Show the cards, celebrate the hit, and keep energy high.
      </p>
    </div>
  );

  const renderReveal = () => (
    <div className="flex flex-col items-center gap-6 text-center">
      <p className="text-sm uppercase tracking-[0.45em] text-emerald-300">Highlighted Hit</p>
      <h2 className="font-heading text-[clamp(2.5rem,6vw,5rem)] uppercase tracking-[0.12em] text-white">
        {reveal?.name ?? "Vault Hit"}
      </h2>
      {reveal?.set ? <p className="text-lg text-slate-200">{reveal.set}</p> : null}
      {reveal?.imageUrl ? (
        <Image
          src={reveal.imageUrl}
          alt={reveal.name ?? "Reveal"}
          width={840}
          height={600}
          className="max-h-[420px] w-auto rounded-[3rem] border border-white/10 bg-night-900/80 p-6 shadow-card"
          sizes="(max-width: 768px) 80vw, 720px"
          priority
          unoptimized
        />
      ) : null}
    </div>
  );

  const renderStandby = () => (
    <div className="flex flex-col items-center gap-8 text-center">
      <p className="text-sm uppercase tracking-[0.4em] text-slate-300">Ten Kings Live</p>
      <h1 className="font-heading text-[clamp(2.5rem,6vw,5rem)] uppercase tracking-[0.16em] text-white">
        Scan a pack to start the show
      </h1>
      <p className="max-w-3xl text-lg text-slate-300">
        Waiting for the next rip at {display?.location.name ?? "this kiosk"}. Trigger a pack from the operator console and
        this screen will switch to the countdown automatically.
      </p>
      {ATTRACT_VIDEO_URL ? (
        <video
          className="mt-4 w-full max-w-4xl rounded-[3rem] border border-white/10 bg-black/40 shadow-card"
          autoPlay
          muted
          loop
          playsInline
        >
          <source src={ATTRACT_VIDEO_URL} />
        </video>
      ) : null}
    </div>
  );

  const renderStage = () => {
    if (!session) {
      return renderStandby();
    }
    switch (session.status) {
      case "COUNTDOWN":
        return renderCountdown();
      case "LIVE":
        return renderLive();
      case "REVEAL":
        return renderReveal();
      default:
        return renderStandby();
    }
  };

  const locationLabel = display?.location?.name ?? "Ten Kings Live";

  return (
    <div className="min-h-screen bg-night-950 text-white">
      <Head>
        <title>Ten Kings · Kiosk Display</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-10 px-6 py-10">
        <header className="flex flex-col gap-3 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Stage Display</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">{locationLabel}</h1>
          {session?.pack?.definition ? (
            <p className="text-sm uppercase tracking-[0.28em] text-slate-300">
              {session.pack.definition.name}
            </p>
          ) : null}
          {session?.packQrCode ? (
            <p className="text-xs font-mono uppercase tracking-[0.3em] text-slate-500">
              Pack {session.packQrCode.serial ?? session.packQrCode.code}
            </p>
          ) : null}
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {!error && lastUpdated ? (
            <p className="text-xs text-slate-500">
              Auto-updated at {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          ) : null}
        </header>

        <section className="flex flex-1 items-center justify-center text-center">
          {loading ? (
            <p className="text-slate-300">Loading display…</p>
          ) : (
            renderStage()
          )}
        </section>

        <footer className="pb-6 text-center text-xs uppercase tracking-[0.32em] text-slate-500">
          Display refreshes automatically every {Math.round(POLL_INTERVAL_MS / 1000)}s
        </footer>
      </main>
    </div>
  );
}
