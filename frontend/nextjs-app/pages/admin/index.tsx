import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";

type AdminDestination = {
  label: string;
  href: string;
  posterSrc: string;
  videoSrc: string;
  priority?: boolean;
};

type AdminSection = {
  title: string;
  desktopColumns: 3 | 4;
  routes: AdminDestination[];
};

const ADMIN_SECTIONS: AdminSection[] = [
  {
    title: "Card Intake",
    desktopColumns: 4,
    routes: [
      {
        label: "Add Cards",
        href: "/admin/uploads",
        posterSrc: "/admin/launch/add-cards-poster.jpg",
        videoSrc: "/admin/launch/add-cards.mp4",
        priority: true,
      },
      {
        label: "KingsReview",
        href: "/admin/kingsreview",
        posterSrc: "/admin/launch/kingsreview-poster.jpg",
        videoSrc: "/admin/launch/kingsreview.mp4",
        priority: true,
      },
      {
        label: "Inventory Ready",
        href: "/admin/inventory-ready",
        posterSrc: "/admin/launch/inventory-ready-poster.jpg",
        videoSrc: "/admin/launch/inventory-ready.mp4",
        priority: true,
      },
      {
        label: "Assigned Locations",
        href: "/admin/location-batches",
        posterSrc: "/admin/launch/assigned-locations-poster.jpg",
        videoSrc: "/admin/launch/assigned-locations.mp4",
        priority: true,
      },
    ],
  },
  {
    title: "Set Workflows",
    desktopColumns: 4,
    routes: [
      {
        label: "Set Ops Review",
        href: "/admin/set-ops-review",
        posterSrc: "/admin/launch/set-ops-review-poster.jpg",
        videoSrc: "/admin/launch/set-ops-review.mp4",
      },
      {
        label: "Variant Ref QA",
        href: "/admin/variant-ref-qa",
        posterSrc: "/admin/launch/variant-ref-qa-poster.jpg",
        videoSrc: "/admin/launch/variant-ref-qa.mp4",
      },
      {
        label: "Set Ops",
        href: "/admin/set-ops",
        posterSrc: "/admin/launch/set-ops-poster.jpg",
        videoSrc: "/admin/launch/set-ops.mp4",
      },
    ],
  },
  {
    title: "Monitoring",
    desktopColumns: 4,
    routes: [
      {
        label: "AI Ops",
        href: "/admin/ai-ops",
        posterSrc: "/admin/launch/ai-ops-poster.jpg",
        videoSrc: "/admin/launch/ai-ops.mp4",
      },
    ],
  },
];

function sectionGridClass(columns: AdminSection["desktopColumns"]) {
  if (columns === 4) {
    return "grid gap-4 md:grid-cols-2 xl:grid-cols-4";
  }
  return "grid gap-4 md:grid-cols-2 xl:grid-cols-3";
}

function bindMediaQueryChange(mediaQuery: MediaQueryList, listener: () => void) {
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }

  mediaQuery.addListener(listener);
  return () => mediaQuery.removeListener(listener);
}

function AdminLaunchCard({
  route,
  touchMotion,
  reduceMotion,
}: {
  route: AdminDestination;
  touchMotion: boolean;
  reduceMotion: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(false);
  const [videoReady, setVideoReady] = useState(false);

  const posterLive = touchMotion || active;
  const showMotion = !reduceMotion && videoReady && posterLive;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (touchMotion && !reduceMotion) {
      const autoplay = video.play();
      if (autoplay && typeof autoplay.catch === "function") {
        autoplay.catch(() => undefined);
      }
      setActive(true);
      return;
    }

    video.pause();
    video.currentTime = 0;
    setActive(false);
  }, [touchMotion, reduceMotion, route.videoSrc]);

  const startMotion = () => {
    if (touchMotion || reduceMotion) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    const playback = video.play();
    if (playback && typeof playback.catch === "function") {
      playback.catch(() => undefined);
    }
    setActive(true);
  };

  const stopMotion = () => {
    if (touchMotion || reduceMotion) return;
    const video = videoRef.current;
    if (!video) {
      setActive(false);
      return;
    }
    video.pause();
    video.currentTime = 0;
    setActive(false);
  };

  return (
    <Link
      href={route.href}
      onMouseEnter={startMotion}
      onMouseLeave={stopMotion}
      onFocus={startMotion}
      onBlur={stopMotion}
      className="group relative aspect-[16/10] overflow-hidden rounded-[30px] border border-white/10 bg-[#101010] shadow-[0_24px_60px_rgba(0,0,0,0.28)] transition duration-500 hover:-translate-y-1 hover:border-white/20 focus-visible:-translate-y-1 focus-visible:border-white/24 focus-visible:outline-none"
    >
      <Image
        src={route.posterSrc}
        alt=""
        fill
        priority={route.priority}
        sizes="(min-width: 1280px) 24vw, (min-width: 768px) 45vw, 92vw"
        className={[
          "object-cover transition duration-700",
          posterLive ? "grayscale-0 brightness-[1.02]" : "grayscale brightness-[0.74]",
          showMotion ? "scale-[1.03] opacity-0" : "scale-100 opacity-100",
        ].join(" ")}
      />
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        preload="metadata"
        poster={route.posterSrc}
        autoPlay={touchMotion && !reduceMotion}
        onCanPlay={() => setVideoReady(true)}
        className={[
          "absolute inset-0 h-full w-full object-cover transition duration-700",
          showMotion ? "scale-[1.03] opacity-100" : "scale-100 opacity-0",
        ].join(" ")}
      >
        <source src={route.videoSrc} type="video/mp4" />
      </video>
      <div
        className={[
          "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_55%)] transition duration-700",
          showMotion ? "opacity-100" : "opacity-55",
        ].join(" ")}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/72 via-black/18 to-black/42" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/50 to-transparent" />
      <div className="absolute left-5 top-5 z-10 max-w-[78%]">
        <span className="font-heading text-[1.45rem] uppercase tracking-[0.14em] text-white drop-shadow-[0_10px_24px_rgba(0,0,0,0.75)] sm:text-[1.55rem]">
          {route.label}
        </span>
      </div>
      <div
        className={[
          "pointer-events-none absolute inset-0 rounded-[30px] ring-1 ring-inset transition duration-700",
          showMotion ? "ring-white/14" : "ring-white/8",
        ].join(" ")}
      />
    </Link>
  );
}

export default function AdminHome() {
  const { session, loading, ensureSession, logout } = useSession();
  const [touchMotion, setTouchMotion] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );
  const showMissingConfig =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_ADMIN_USER_IDS === undefined &&
    process.env.NEXT_PUBLIC_ADMIN_PHONES === undefined;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const touchQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMediaModes = () => {
      setTouchMotion(touchQuery.matches);
      setReduceMotion(reduceQuery.matches);
    };

    syncMediaModes();

    const removeTouchListener = bindMediaQueryChange(touchQuery, syncMediaModes);
    const removeReduceListener = bindMediaQueryChange(reduceQuery, syncMediaModes);
    return () => {
      removeTouchListener();
      removeReduceListener();
    };
  }, []);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Checking access…</p>
        </div>
      );
    }

    if (!session) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Admin Access Only</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Sign in to continue</h1>
          <p className="max-w-md text-sm text-slate-400">
            Use your Ten Kings phone number. Only approved operators will gain entry to the processing console.
          </p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign In
          </button>
          {showMissingConfig && (
            <p className="mt-6 max-w-md text-xs text-rose-300/80">
              Set <code className="font-mono">NEXT_PUBLIC_ADMIN_USER_IDS</code> to a comma-separated list of admin user IDs to enable access control.
            </p>
          )}
        </div>
      );
    }

    if (!isAdmin) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-rose-300">Access Denied</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">You do not have admin rights</h1>
          <p className="max-w-md text-sm text-slate-400">
            This console is restricted to Ten Kings operators. Contact an administrator if you need elevated permissions.
          </p>
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

    return (
      <div className="mx-auto flex w-full max-w-[1700px] flex-1 flex-col gap-10 px-4 py-8 lg:px-6">
        {ADMIN_SECTIONS.map((section) => (
          <section key={section.title} className="space-y-4">
            <p className="text-xs uppercase tracking-[0.34em] text-slate-400">{section.title}</p>
            <div className={sectionGridClass(section.desktopColumns)}>
              {section.routes.map((route) => (
                <AdminLaunchCard key={route.href} route={route} touchMotion={touchMotion} reduceMotion={reduceMotion} />
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Admin</title>
        <meta name="robots" content="noindex" />
      </Head>
      {renderContent()}
    </AppShell>
  );
}
