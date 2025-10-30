import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import type { GetServerSideProps } from "next";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import LiveRipPreview from "../components/LiveRipPreview";
import { fetchCollector, listRecentPulls } from "../lib/api";
import CardDetailModal from "../components/CardDetailModal";
import { formatUsdMinor } from "../lib/formatters";
import { loadRecentPulls } from "../lib/server/recentPulls";

const BUYBACK_RATE = 0.75;

const UNKNOWN_OWNER_LABEL = "Collector";

type PullCard = {
  type: "card";
  itemId: string;
  cardName: string;
  marketValueMinor: number | null;
  image: string | null;
  ownerId: string | null;
  ownerLabel: string;
  ownerAvatar: string | null;
  packLabel: string | null;
};

type LiveRipTile = {
  type: "live";
  id: string;
  title: string;
  videoUrl: string;
  locationLabel: string | null;
  thumbnailUrl: string | null;
  slug: string | null;
  viewCount: number | null;
};

type DisplayTile = PullCard | LiveRipTile;

const fallbackPulls: PullCard[] = Array.from({ length: 3 }).map((_, index) => ({
  type: "card",
  itemId: `placeholder-${index}`,
  cardName: "Card Title",
  marketValueMinor: null,
  image: null,
  ownerId: null,
  ownerLabel: UNKNOWN_OWNER_LABEL,
  ownerAvatar: null,
  packLabel: null,
}));

const parseDetailsImage = (raw: unknown): string | null => {
  if (!raw) {
    return null;
  }
  const value = typeof raw === "string" ? (() => {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  })() : raw;

  if (!value || typeof value !== "object") {
    return null;
  }

  const imageCandidates = [
    (value as Record<string, unknown>).thumbnailUrl,
    (value as Record<string, unknown>).imageUrl,
    (value as Record<string, unknown>).cardImage,
    (value as Record<string, unknown>).fullImage,
  ];

  for (const candidate of imageCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
};

type HeroMedia =
  | { type: "video"; src: string }
  | { type: "image"; src: string }
  | { type: "stacked" };

const heroVideoUrl = (process.env.NEXT_PUBLIC_HERO_VIDEO_URL ?? "").trim();
const heroImageOverride = (process.env.NEXT_PUBLIC_HERO_IMAGE_URL ?? "").trim();

const heroMediaConfig: HeroMedia = heroVideoUrl
  ? { type: "video", src: heroVideoUrl }
  : heroImageOverride
      ? { type: "image", src: heroImageOverride }
      : { type: "stacked" };

interface HomePageProps {
  initialPulls: PullCard[];
  initialCollectorNames: Record<string, string>;
  initialLiveRipTiles: LiveRipTile[];
}

const categories = [
  {
    id: "sports",
    label: "Sports",
    image: "/images/tenkings-vendingmachine-sports.png",
    description: "NBA, MLB, NFL, F1—graded and raw chases loaded in every tier.",
  },
  {
    id: "pokemon",
    label: "Pokémon",
    image: "/images/tenkings-vendingmachine-pokemon.png",
    description: "Vintage sets through Scarlet & Violet. Guaranteed holos in every grid.",
  },
  {
    id: "comics",
    label: "Comics",
    image: "/images/tenkings-vendingmachine-comics.png",
    description: "Slabbed keys, variants, and mystery grails. Choose the panel you reveal.",
  },
];

const mapPullsFromApi = (rawPulls: any[]): { pulls: PullCard[]; names: Record<string, string> } => {
  const prefetchedNames: Record<string, string> = {};
  const mapped: PullCard[] = [];

  rawPulls
    .slice(0, 20)
    .forEach((pull: any, index: number) => {
      const item = pull?.item ?? {};
      const itemId = typeof item?.id === "string" && item.id.trim() ? item.id : `recent-${index}`;
      const rawValue = Number(item?.estimatedValue ?? 0);
      const marketValueMinor = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : null;
      const cardName = typeof item?.name === "string" && item.name.trim() ? item.name.trim() : "Card Title";
      const thumbnail = typeof item?.thumbnailUrl === "string" && item.thumbnailUrl.trim() ? item.thumbnailUrl : null;
      const fallbackImage = typeof item?.imageUrl === "string" && item.imageUrl.trim() ? item.imageUrl : null;
      const detailsImage = parseDetailsImage(item?.detailsJson);

      const owner = pull?.owner ?? {};
      const ownerId = typeof owner?.id === "string" && owner.id.trim() ? owner.id : null;
      const ownerDisplay = typeof owner?.displayName === "string" && owner.displayName.trim() ? owner.displayName : null;
      const ownerPhone = typeof owner?.phone === "string" && owner.phone.trim() ? owner.phone : null;
      const ownerLabelRaw = ownerDisplay ?? ownerPhone ?? UNKNOWN_OWNER_LABEL;
      const ownerLabel = ownerLabelRaw.trim() ? ownerLabelRaw.trim() : UNKNOWN_OWNER_LABEL;
      const ownerAvatar =
        typeof owner?.avatarUrl === "string" && owner.avatarUrl.trim().length > 0 ? owner.avatarUrl : null;

      if (ownerId && ownerLabel !== UNKNOWN_OWNER_LABEL) {
        prefetchedNames[ownerId] = ownerLabel;
      }

      const pack = pull?.packDefinition ?? null;
      const packLabel =
        typeof pack?.name === "string" && pack.name.trim().length > 0
          ? pack.name
          : typeof pull?.packId === "string" && pull.packId.trim().length > 0
            ? pull.packId
            : null;

      mapped.push({
        type: "card",
        itemId,
        cardName,
        marketValueMinor,
        image: thumbnail ?? fallbackImage ?? detailsImage,
        ownerId,
        ownerLabel,
        ownerAvatar,
        packLabel,
      });
    });

  return { pulls: mapped, names: prefetchedNames };
};

const mapLiveRipTilesFromApi = (rawLiveRips: any[], limit = 6): LiveRipTile[] =>
  (rawLiveRips ?? [])
    .filter((entry: any) => typeof entry?.videoUrl === "string" && entry.videoUrl.trim())
    .slice(0, limit)
    .map((entry: any) => ({
      type: "live" as const,
      id: entry.id ?? entry.slug ?? entry.title ?? `live-${Math.random().toString(36).slice(2)}`,
      title: entry.title ?? "Live Rip",
      videoUrl: entry.videoUrl,
      locationLabel: entry.location?.name ?? null,
      thumbnailUrl: entry.thumbnailUrl ?? null,
      slug: entry.slug ?? null,
      viewCount: typeof entry.viewCount === "number" ? entry.viewCount : null,
    }));

export default function Home({
  initialPulls,
  initialCollectorNames,
  initialLiveRipTiles,
}: HomePageProps) {
  const router = useRouter();
  const startingPulls = initialPulls.length ? initialPulls : fallbackPulls;
  const [pulls, setPulls] = useState<PullCard[]>(startingPulls);
  const [collectorNames, setCollectorNames] = useState<Record<string, string>>(initialCollectorNames ?? {});
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [liveRipTiles, setLiveRipTiles] = useState<LiveRipTile[]>(initialLiveRipTiles ?? []);
  const heroVideoDesktopRef = useRef<HTMLVideoElement | null>(null);
  const heroVideoMobileRef = useRef<HTMLVideoElement | null>(null);
  const [heroVideoMuted, setHeroVideoMuted] = useState(true);
  const heroMedia = heroMediaConfig;

  useEffect(() => {
    if (heroMedia.type !== "video") {
      return;
    }
    setHeroVideoMuted(true);
    const candidates = [heroVideoDesktopRef.current, heroVideoMobileRef.current];
    candidates.forEach((element) => {
      if (element) {
        element.load();
      }
    });
  }, [heroMedia.type, heroMedia.type === "video" ? heroMedia.src : null]);

  useEffect(() => {
    if (heroMedia.type !== "video") {
      return;
    }
    const candidates = [heroVideoDesktopRef.current, heroVideoMobileRef.current];
    const handleCanPlay = (event: Event) => {
      const target = event.currentTarget as HTMLVideoElement;
      if (!heroVideoMuted) {
        target.play().catch(() => undefined);
      }
    };

    candidates.forEach((element) => {
      if (!element) {
        return;
      }
      element.muted = heroVideoMuted;
      element.defaultMuted = heroVideoMuted;
      if (!heroVideoMuted) {
        element.play().catch(() => undefined);
      }
      element.addEventListener("canplay", handleCanPlay);
      element.addEventListener("loadeddata", handleCanPlay);
    });

    return () => {
      candidates.forEach((element) => {
        if (!element) {
          return;
        }
        element.removeEventListener("canplay", handleCanPlay);
        element.removeEventListener("loadeddata", handleCanPlay);
      });
    };
  }, [heroMedia.type, heroMedia.type === "video" ? heroMedia.src : null, heroVideoMuted]);

  const handleHeroMuteToggle = useCallback(() => {
    setHeroVideoMuted((prev) => !prev);
  }, []);

  const handleHeroFullscreen = useCallback((viewport: "desktop" | "mobile") => {
    const candidate =
      viewport === "desktop"
        ? heroVideoDesktopRef.current ?? heroVideoMobileRef.current
        : heroVideoMobileRef.current ?? heroVideoDesktopRef.current;

    if (!candidate) {
      return;
    }

    const request =
      candidate.requestFullscreen?.bind(candidate) ??
      (candidate as any).webkitEnterFullscreen?.bind(candidate) ??
      null;

    if (request) {
      try {
        void request();
      } catch (error) {
        // ignore
      }
    }
  }, []);

  const renderHeroMedia = useCallback(
    (viewport: "mobile" | "desktop") => {
      if (heroMedia.type === "video") {
        const ref = viewport === "desktop" ? heroVideoDesktopRef : heroVideoMobileRef;
        return (
          <ResponsiveMediaFrame viewport={viewport}>
            <div className="absolute inset-0">
              <video
                ref={ref}
                key={`${heroMedia.src}-${viewport}`}
                src={heroMedia.src}
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                loop
                muted={heroVideoMuted}
                playsInline
                preload="auto"
              />
              <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-4">
                <div className="flex flex-wrap gap-2 pointer-events-auto">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleHeroMuteToggle();
                    }}
                    className="rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-[11px] uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                    aria-pressed={!heroVideoMuted}
                    aria-label={heroVideoMuted ? "Unmute hero video" : "Mute hero video"}
                  >
                    {heroVideoMuted ? "Unmute" : "Mute"}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleHeroFullscreen(viewport);
                    }}
                    className="rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-[11px] uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                    aria-label="Expand hero video"
                  >
                    Expand
                  </button>
                </div>
              </div>
            </div>
          </ResponsiveMediaFrame>
        );
      }

      if (heroMedia.type === "image") {
        return (
          <ResponsiveMediaFrame viewport={viewport}>
            <Image
              src={heroMedia.src}
              alt="Ten Kings collectible machines"
              fill
              priority
              className="object-cover"
            />
          </ResponsiveMediaFrame>
        );
      }

      return viewport === "desktop" ? <StackedHeroMachinesDesktop /> : <StackedHeroMachinesMobile />;
    },
    [handleHeroFullscreen, handleHeroMuteToggle, heroMedia, heroVideoMuted]
  );

  const handleScrollToMachines = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const section = document.getElementById("collectible-machines");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleOpenCard = useCallback((pull: PullCard) => {
    if (!pull.itemId || pull.itemId.startsWith("placeholder")) {
      return;
    }
    setActiveItemId(pull.itemId);
  }, []);

  const handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, pull: PullCard) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleOpenCard(pull);
      }
    },
    [handleOpenCard]
  );

  const handleCollectorClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, ownerId: string) => {
      event.stopPropagation();
      router.push(`/collectors/${ownerId}`).catch(() => undefined);
    },
    [router]
  );

  const closeModal = useCallback(() => setActiveItemId(null), []);

  useEffect(() => {
    let cancelled = false;

    const applyPulls = (rawPulls: any[] | undefined) => {
      if (cancelled || !rawPulls || rawPulls.length === 0) {
        return false;
      }
      const { pulls: mappedPulls, names } = mapPullsFromApi(rawPulls);
      if (!mappedPulls.length) {
        return false;
      }
      setPulls(mappedPulls);
      if (Object.keys(names).length) {
        setCollectorNames((prev) => ({ ...names, ...prev }));
      }
      return true;
    };

    const load = async () => {
      try {
        const recent = await listRecentPulls({ limit: 20 });
        if (applyPulls(recent?.pulls ?? [])) {
          return;
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("recent pulls service fetch failed", error);
        }
      }

      try {
        const response = await fetch("/api/recent-pulls?limit=20");
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { pulls?: Array<any> };
        applyPulls(payload.pulls ?? []);
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("recent pulls api fallback failed", error);
        }
      }
    };

    load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadLiveRips = async () => {
      try {
        const response = await fetch("/api/live-rips?featured=true");
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { liveRips?: Array<any> };
        const tiles = mapLiveRipTilesFromApi(payload.liveRips ?? []);
        if (!cancelled) {
          setLiveRipTiles(tiles);
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("Failed to load live rip tiles", error);
        }
      }
    };
    loadLiveRips().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const { marqueeItems, marqueeDuration } = useMemo(() => {
    const maxItems = 20;
    const standard = pulls.slice(0, maxItems);
    const liveCandidates = liveRipTiles.slice(0, Math.min(6, Math.floor(maxItems / 2)));
    const combined: DisplayTile[] = [];
    let cardIndex = 0;
    let liveIndex = 0;

    while (combined.length < maxItems && (cardIndex < standard.length || liveIndex < liveCandidates.length)) {
      const shouldUseLive =
        liveIndex < liveCandidates.length &&
        ((combined.length % 2 === 1 && cardIndex < standard.length) || cardIndex >= standard.length);

      if (shouldUseLive) {
        combined.push(liveCandidates[liveIndex++]);
      } else if (cardIndex < standard.length) {
        combined.push(standard[cardIndex++]);
      } else if (liveIndex < liveCandidates.length) {
        combined.push(liveCandidates[liveIndex++]);
      } else {
        break;
      }
    }

    let baseSequence = combined.length ? combined : pulls.length ? pulls : fallbackPulls;
    if (!baseSequence.length) {
      baseSequence = fallbackPulls;
    }

    const marqueeBase: DisplayTile[] = [];
    if (baseSequence.length >= maxItems) {
      marqueeBase.push(...baseSequence.slice(0, maxItems));
    } else if (baseSequence.length > 0) {
      for (let i = 0; marqueeBase.length < maxItems; i += 1) {
        marqueeBase.push(baseSequence[i % baseSequence.length]);
      }
    } else {
      marqueeBase.push(...fallbackPulls);
    }

    const repeated = [...marqueeBase, ...marqueeBase];
    const loopCount = Math.max(marqueeBase.length, 1);
    const duration = Math.max(36, loopCount * 2.2);

    return {
      marqueeItems: repeated,
      marqueeDuration: duration,
    };
  }, [pulls, liveRipTiles]);

  const [marqueeSpeedFactor, setMarqueeSpeedFactor] = useState(1);
  const marqueeTrackRef = useRef<HTMLDivElement | null>(null);
  const marqueeAnimationFrameRef = useRef<number | null>(null);
  const marqueeOffsetRef = useRef(0);
  const marqueeHalfWidthRef = useRef(0);
  const marqueeLastTickRef = useRef<number | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const updateFactor = () => {
      const width = window.innerWidth;
      if (width < 768) {
        setMarqueeSpeedFactor(0.975);
      } else {
        setMarqueeSpeedFactor(1.25);
      }
    };
    updateFactor();
    window.addEventListener("resize", updateFactor);
    return () => window.removeEventListener("resize", updateFactor);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setPrefersReducedMotion(query.matches);
    handleChange();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handleChange);
      return () => query.removeEventListener("change", handleChange);
    }
    query.addListener(handleChange);
    return () => query.removeListener(handleChange);
  }, []);

  const marqueeAnimationDuration = marqueeDuration * marqueeSpeedFactor;

  useEffect(() => {
    const missingIds = pulls.reduce<string[]>((acc, pull) => {
      const ownerId = pull.ownerId;
      if (ownerId && !collectorNames[ownerId] && !acc.includes(ownerId)) {
        acc.push(ownerId);
      }
      return acc;
    }, []);

    if (missingIds.length === 0) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      const lookups = await Promise.all(
        missingIds.map(async (id) => {
          try {
            const response = await fetchCollector(id);
            const candidate = response.user?.displayName || response.user?.phone || null;
            return [id, candidate?.trim() ?? null] as const;
          } catch (error) {
            return [id, null] as const;
          }
        })
      );
      if (cancelled) {
        return;
      }
      setCollectorNames((prev) => {
        const next = { ...prev };
        lookups.forEach(([id, name]) => {
          if (name) {
            next[id] = name;
          }
        });
        return next;
      });
    };
    load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pulls, collectorNames]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const track = marqueeTrackRef.current;
    if (!track) {
      return;
    }

    const measure = () => {
      const width = track.scrollWidth;
      marqueeHalfWidthRef.current = width > 0 ? width / 2 : 0;
      if (marqueeHalfWidthRef.current === 0) {
        marqueeOffsetRef.current = 0;
        track.style.transform = "translate3d(0, 0, 0)";
        return;
      }
      if (-marqueeOffsetRef.current >= marqueeHalfWidthRef.current) {
        marqueeOffsetRef.current %= marqueeHalfWidthRef.current;
      }
      track.style.transform = `translate3d(${marqueeOffsetRef.current}px, 0, 0)`;
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [marqueeItems]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const track = marqueeTrackRef.current;
    if (!track) {
      return;
    }

    if (prefersReducedMotion) {
      if (marqueeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(marqueeAnimationFrameRef.current);
        marqueeAnimationFrameRef.current = null;
      }
      marqueeOffsetRef.current = 0;
      marqueeLastTickRef.current = null;
      track.style.transform = "translate3d(0, 0, 0)";
      return;
    }

    marqueeHalfWidthRef.current = track.scrollWidth > 0 ? track.scrollWidth / 2 : 0;
    marqueeOffsetRef.current = 0;
    marqueeLastTickRef.current = null;
    track.style.transform = "translate3d(0, 0, 0)";

    const step = (timestamp: number) => {
      const halfWidth = marqueeHalfWidthRef.current;
      if (!halfWidth || halfWidth <= 0) {
        track.style.transform = "translate3d(0, 0, 0)";
        marqueeAnimationFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      if (marqueeLastTickRef.current === null) {
        marqueeLastTickRef.current = timestamp;
        marqueeAnimationFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      const elapsed = timestamp - marqueeLastTickRef.current;
      marqueeLastTickRef.current = timestamp;

      const durationMs = Math.max(marqueeAnimationDuration, 1) * 1000;
      const distancePerMs = halfWidth / durationMs;
      marqueeOffsetRef.current -= distancePerMs * elapsed;

      while (-marqueeOffsetRef.current >= halfWidth) {
        marqueeOffsetRef.current += halfWidth;
      }

      track.style.transform = `translate3d(${marqueeOffsetRef.current}px, 0, 0)`;
      marqueeAnimationFrameRef.current = window.requestAnimationFrame(step);
    };

    marqueeAnimationFrameRef.current = window.requestAnimationFrame(step);

    return () => {
      if (marqueeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(marqueeAnimationFrameRef.current);
        marqueeAnimationFrameRef.current = null;
      }
      marqueeLastTickRef.current = null;
    };
  }, [prefersReducedMotion, marqueeAnimationDuration, marqueeItems]);

  return (
    <AppShell background="hero">
      <Head>
        <title>Ten Kings · Mystery Collectible Packs</title>
        <meta
          name="description"
          content="Sports, Pokémon, and Comic mystery packs. Graded, authenticated, and ready to rip with Ten Kings."
        />
        {heroMedia.type === "video" ? (
          <link rel="preload" as="video" href={heroMedia.src} type="video/mp4" />
        ) : null}
      </Head>

      <section className="relative overflow-hidden bg-night-900/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pb-16 pt-16 lg:flex-row lg:items-center lg:gap-16">
          <div className="relative z-10 order-1 max-w-[650px] space-y-6">
            <h1 className="hero-heading font-lightning text-[4rem] uppercase tracking-[0.08em] text-transparent -skew-x-[10deg] leading-[0.94] text-left sm:text-[4.8rem] md:text-[5.5rem] lg:text-[6.4rem] xl:text-[7rem]">
              <span className="lightning-line">Pick It</span>
              <span className="lightning-line">
                Rip It <span className="accent-word">Live</span>
              </span>
            </h1>
            <style jsx>{`
              .hero-heading {
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                max-width: min(100%, 28rem);
              }
              .hero-heading .lightning-line {
                display: block;
                padding: 0.04em 0.06em;
                background-image: linear-gradient(110deg, #f8fcff 0%, #dbeafe 26%, #93c5fd 58%, #f8fafc 100%);
                background-size: 220% 100%;
                background-position: 0% 50%;
                background-clip: text;
                -webkit-background-clip: text;
                color: transparent;
                text-shadow: 0 2px 0 rgba(255, 255, 255, 0.18);
                filter: drop-shadow(0 0 6px rgba(147, 197, 253, 0.5));
                animation: lightningFlow 6s linear infinite, lightningPulse 3s ease-in-out infinite;
                transform-origin: left center;
                white-space: nowrap;
              }
              .hero-heading .lightning-line:nth-child(2) {
                background-image: linear-gradient(110deg, #ecfeff 0%, #bae6fd 35%, #60a5fa 70%, #f8fafc 100%);
              }
              .hero-heading .accent-word {
                display: inline-block;
                margin-left: 0.15em;
                padding: 0.02em 0.04em;
                background-image: linear-gradient(110deg, #fff7ed 0%, #fde68a 32%, #facc15 68%, #fff7ed 100%);
                background-size: 220% 100%;
                background-position: 0% 50%;
                background-clip: text;
                -webkit-background-clip: text;
                color: transparent;
                text-shadow: 0 2px 0 rgba(250, 204, 21, 0.3);
                filter: drop-shadow(0 0 8px rgba(250, 204, 21, 0.55));
              }
              @keyframes lightningFlow {
                0% {
                  background-position: 0% 50%;
                }
                100% {
                  background-position: 200% 50%;
                }
              }
              @keyframes lightningPulse {
                0%, 100% {
                  opacity: 0.9;
                }
                10% {
                  opacity: 1;
                }
              }
              .hero-heading .lightning-line:nth-child(1) {
                animation-delay: 0s, 0s;
              }
              .hero-heading .lightning-line:nth-child(2) {
                animation-delay: 0s, 0.4s;
              }
              .hero-heading .lightning-line:nth-child(3) {
                animation-delay: 0s, 0.8s;
              }
            `}</style>
            <p className="text-xl uppercase tracking-[0.24em] text-slate-300 sm:text-2xl">Collectible Mystery Packs</p>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleScrollToMachines}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-gold-500 px-10 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-night-900 shadow-glow transition hover:bg-gold-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-500"
                >
                  Pick & Rip Now
                </button>
              <button
                type="button"
                onClick={() => router.push("/locations")}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-white/20 px-10 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/40 hover:text-gold-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                Rip It Live Locations
              </button>
            </div>
            <p className="text-sm uppercase tracking-[0.22em] text-slate-400">
              Pick and rip packs online or visit a live location near you.
            </p>
            <div className="mt-8 flex justify-center lg:hidden">{renderHeroMedia("mobile")}</div>
          </div>

          <div className="relative order-2 mt-8 hidden w-full flex-1 justify-end lg:flex lg:order-2 lg:mt-0">
            {renderHeroMedia("desktop")}
          </div>
        </div>

        <div className="border-y border-white/10 bg-night-900/80">
          <div className="relative mx-auto flex w-full max-w-6xl items-center gap-6 overflow-hidden px-6 py-8">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-night-900 via-night-900/80 to-transparent" aria-hidden />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-night-900 via-night-900/80 to-transparent" aria-hidden />
            <div
              ref={marqueeTrackRef}
              className="flex w-max flex-nowrap gap-6"
              style={{
                transform: "translate3d(0, 0, 0)",
                willChange: prefersReducedMotion ? undefined : "transform",
              }}
            >
              {marqueeItems.map((item, index) => {
                if (item.type === "live") {
                  return (
                    <article
                      key={`live-${item.id}-${index}`}
                      className="group flex min-w-[280px] max-w-[280px] flex-none flex-col gap-3 rounded-3xl border border-white/10 bg-slate-900/60 p-5 shadow-card transition hover:border-sky-400/60 hover:shadow-glow"
                    >
                      <header className="space-y-2">
                        <p className="text-xs uppercase tracking-[0.3em] text-sky-300">Live Rip</p>
                        <h3 className="font-heading text-xl uppercase tracking-[0.18em] text-white">{item.title}</h3>
                      </header>
                      <LiveRipPreview
                        id={item.id}
                        title={item.title}
                        videoUrl={item.videoUrl}
                        thumbnailUrl={item.thumbnailUrl}
                        muted
                        onToggleMute={() => undefined}
                        viewCount={item.viewCount}
                        className="mt-2 flex-1"
                        aspectClassName="pb-[133%]"
                        showMuteToggle={false}
                      />
                      <footer className="space-y-1">
                        {item.locationLabel && (
                          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">@{item.locationLabel}</p>
                        )}
                        {item.slug ? (
                          <Link
                            href={`/live/${item.slug}`}
                            className="text-xs uppercase tracking-[0.24em] text-sky-300 transition hover:text-sky-100"
                          >
                            Watch on Ten Kings Live →
                          </Link>
                        ) : (
                          <p className="text-xs text-slate-400">Watch on Ten Kings Live</p>
                        )}
                      </footer>
                    </article>
                  );
                }

                const hasValue =
                  typeof item.marketValueMinor === "number" &&
                  Number.isFinite(item.marketValueMinor) &&
                  item.marketValueMinor > 0;
                const canOpen = Boolean(item.itemId && !item.itemId.startsWith("placeholder"));
                const displayOwnerLabel = item.ownerId ? collectorNames[item.ownerId] ?? item.ownerLabel : item.ownerLabel;

                return (
                  <article
                    key={`${item.itemId}-${index}`}
                    className="group flex min-w-[280px] max-w-[280px] flex-none flex-col gap-4 rounded-3xl border border-white/10 bg-slate-900/60 p-5 shadow-card transition hover:border-gold-400/60 hover:shadow-glow"
                    role="button"
                    tabIndex={canOpen ? 0 : -1}
                    onClick={() => canOpen && handleOpenCard(item)}
                    onKeyDown={(event) => canOpen && handleCardKeyDown(event, item)}
                    aria-label={`Recent pull ${item.cardName}`}
                  >
                    <header className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Recent Pull</p>
                      <h3 className="font-heading text-2xl uppercase tracking-[0.18em] text-white">{item.cardName ?? "Card Title"}</h3>
                      <p className="text-3xl font-semibold text-gold-300">
                        {hasValue ? formatUsdMinor(item.marketValueMinor) : "Card value"}
                      </p>
                    </header>
                    <div className="relative mt-2 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-night-900/60">
                      <div className="relative h-0 w-full pb-[133%]">
                        {item.image ? (
                          <Image
                            src={item.image}
                            alt={item.cardName ?? "Card image"}
                            fill
                            className="object-cover"
                            sizes="(max-width: 768px) 280px, 320px"
                            priority={index < 6}
                            fetchPriority={index < 6 ? "high" : undefined}
                            unoptimized
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-night-900/80 text-xs uppercase tracking-[0.3em] text-slate-500">
                            Card image goes here
                          </div>
                        )}
                      </div>
                    </div>
                    <footer className="flex items-center gap-3 pt-2">
                      <div className="relative h-10 w-10 overflow-hidden rounded-full border border-violet-400/40">
                        {item.ownerAvatar ? (
                          <Image
                            src={item.ownerAvatar}
                            alt={`${item.ownerLabel ?? "User"} avatar`}
                            fill
                            className="object-cover"
                            sizes="40px"
                            unoptimized
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-night-900/80 text-[10px] uppercase tracking-[0.28em] text-slate-500">
                            User
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Pulled by</p>
                        {item.ownerId ? (
                          <Link
                            href={`/collectors/${item.ownerId}`}
                            onClick={(event) => handleCollectorClick(event, item.ownerId!)}
                            className="text-sm text-white transition hover:text-gold-200"
                          >
                            {displayOwnerLabel}
                          </Link>
                        ) : (
                          <span className="text-sm text-white">{displayOwnerLabel}</span>
                        )}
                        {item.packLabel && (
                          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">{item.packLabel}</p>
                        )}
                      </div>
                    </footer>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="collectible-machines" className="bg-night-900/80 py-20">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6">
          <header className="flex flex-col gap-3">
            <p className="uppercase tracking-[0.3em] text-violet-300">Choose your arena</p>
            <h2 className="font-heading text-4xl uppercase tracking-[0.14em] text-white sm:text-5xl">PICK A COLLECTIBLE MACHINE</h2>
          </header>

          <div className="grid gap-8 md:grid-cols-3">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => router.push(`/packs?category=${category.id}`)}
                className="group relative mx-auto overflow-hidden rounded-[2.25rem] border border-white/10 bg-slate-900/60 p-6 text-left transition hover:border-gold-400/70 hover:shadow-glow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-500 md:w-[80%]"
              >
                <div className="relative mb-6 flex h-[22rem] w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 sm:h-[24rem] xl:h-[27rem]">
                  <Image
                    src={category.image}
                    alt={`${category.label} vending machine`}
                    width={2813}
                    height={5000}
                    sizes="(max-width: 768px) 70vw, 220px"
                    className="mx-auto h-full w-auto max-w-[75%] object-contain transition duration-500 group-hover:scale-105"
                  />
                </div>
                <h3 className="font-heading text-3xl uppercase tracking-[0.24em] text-white">{category.label}</h3>
                <p className="mt-3 text-sm text-slate-300">{category.description}</p>
                <p className="mt-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.32em] text-gold-400">
                  Enter Machine
                  <span aria-hidden className="text-base">→</span>
                </p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-night-900/70 py-16">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6">
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-8 shadow-card">
            <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Buyback Guarantee</p>
            <div className="mt-4 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="space-y-3">
                <h3 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">Instant Buyback · {Math.round(BUYBACK_RATE * 100)}%</h3>
                <p className="max-w-2xl text-sm text-slate-300">
                  If a pull isn’t for you, Ten Kings offers a {Math.round(BUYBACK_RATE * 100)}% instant buyback in Ten Kings Dollars (TKD). Credits stay in your
                  closed-loop wallet so you can jump straight into the next rip.
                </p>
              </div>
              <button
                type="button"
                onClick={() => router.push("/packs")}
                className="inline-flex items-center justify-center rounded-full border border-gold-500/50 px-6 py-3 text-xs uppercase tracking-[0.32em] text-gold-300 transition hover:border-gold-400 hover:text-gold-200"
              >
                See Tiers
              </button>
            </div>
          </div>
        </div>
      </section>

      {activeItemId && <CardDetailModal itemId={activeItemId} onClose={closeModal} />}
    </AppShell>
  );
}

function ResponsiveMediaFrame({ viewport, children }: { viewport: "mobile" | "desktop"; children: React.ReactNode }) {
  const frameClass = viewport === "desktop" ? "w-[410px] max-w-full" : "w-full max-w-[18rem]";
  const paddingClass = "pb-[100%]";
  return (
    <div className={`relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-night-900/70 shadow-card ${frameClass}`}>
      <div className={`relative h-0 ${paddingClass}`}>
        <div className="absolute inset-0">{children}</div>
      </div>
    </div>
  );
}

function StackedHeroMachinesDesktop() {
  return (
    <div className="relative h-[560px] w-[640px]" style={{ transform: "translateX(100px)" }}>
      <div className="absolute inset-0 rounded-[3rem] border border-white/10 bg-night-900/80 shadow-card" aria-hidden />
      <div className="absolute left-[calc(1.5rem-25px)] top-[calc(7rem-40px)] w-[200px] -rotate-8 drop-shadow-[0_28px_45px_rgba(168,85,247,0.45)] md:left-[calc(2.5rem-25px)] md:w-[230px] lg:left-[calc(3rem-25px)] lg:w-[250px]">
        <Image
          src="/images/tenkings-vendingmachine-pokemon.png"
          alt="Pokémon vending machine"
          width={2813}
          height={5000}
          priority
          className="h-auto w-full"
        />
      </div>
      <div className="absolute left-1/2 top-[100px] z-10 w-[220px] -translate-x-1/2 drop-shadow-[0_45px_70px_rgba(234,179,8,0.4)] md:w-[255px] lg:w-[275px]">
        <Image
          src="/images/tenkings-vendingmachine-sports.png"
          alt="Sports vending machine"
          width={2813}
          height={5000}
          priority
          className="h-auto w-full"
        />
      </div>
      <div className="absolute right-[calc(1.5rem-25px)] top-[calc(8rem-50px)] z-0 w-[200px] rotate-10 drop-shadow-[0_28px_45px_rgba(248,113,113,0.45)] md:right-[calc(2.5rem-25px)] md:w-[230px] lg:right-[calc(3rem-25px)] lg:w-[250px]">
        <Image
          src="/images/tenkings-vendingmachine-comics.png"
          alt="Comics vending machine"
          width={2813}
          height={5000}
          priority
          className="h-auto w-full"
        />
      </div>
    </div>
  );
}

function StackedHeroMachinesMobile() {
  return (
    <div className="relative w-full max-w-md overflow-hidden rounded-[2.5rem] border border-white/10 bg-night-900/80 shadow-card">
      <Image
        src="/images/tenkings-vendingmachine-sports.png"
        alt="Ten Kings collectible vending machines"
        width={2813}
        height={5000}
        priority
        className="h-auto w-full object-contain"
      />
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<HomePageProps> = async () => {
  let initialPulls: PullCard[] = [];
  let initialCollectorNames: Record<string, string> = {};
  let initialLiveRipTiles: LiveRipTile[] = [];

  try {
    const recentPulls = await loadRecentPulls(20);
    const mapped = mapPullsFromApi(recentPulls ?? []);
    initialPulls = mapped.pulls;
    initialCollectorNames = mapped.names;
  } catch (error) {
    initialPulls = [];
    initialCollectorNames = {};
  }

  try {
    const { prisma } = await import("@tenkings/database");
    const liveRips = await prisma.liveRip.findMany({
      where: { featured: true },
      include: { location: true },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: 6,
    });
    initialLiveRipTiles = mapLiveRipTilesFromApi(liveRips);
  } catch (error) {
    initialLiveRipTiles = [];
  }

  if (!initialPulls.length) {
    initialPulls = fallbackPulls;
  }

  return {
    props: {
      initialPulls,
      initialCollectorNames,
      initialLiveRipTiles,
    },
  };
};
