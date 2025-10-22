import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import { fetchCollector, listRecentPulls } from "../lib/api";
import CardDetailModal from "../components/CardDetailModal";
import { formatUsdMinor } from "../lib/formatters";

const BUYBACK_RATE = 0.75;

const UNKNOWN_OWNER_LABEL = "Collector";

type PullCard = {
  itemId: string;
  cardName: string;
  marketValueMinor: number | null;
  image: string | null;
  ownerId: string | null;
  ownerLabel: string;
  ownerAvatar: string | null;
  packLabel: string | null;
};

const fallbackPulls: PullCard[] = Array.from({ length: 3 }).map((_, index) => ({
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

export default function Home() {
  const router = useRouter();
  const [pulls, setPulls] = useState<PullCard[]>(fallbackPulls);
  const [collectorNames, setCollectorNames] = useState<Record<string, string>>({});
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

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
    (event: MouseEvent<HTMLAnchorElement>, ownerId: string | null) => {
      event.stopPropagation();
      if (!ownerId) {
        return;
      }
      router.push(`/collectors/${ownerId}`).catch(() => undefined);
    },
    [router]
  );

  const closeModal = useCallback(() => setActiveItemId(null), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { pulls } = await listRecentPulls({ limit: 16 });
        if (cancelled || !pulls?.length) {
          return;
        }
        const prefetchedNames: Record<string, string> = {};
        const mapped: PullCard[] = pulls.slice(0, 10).map((pull: any, index: number): PullCard => {
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
          const ownerLabelRaw =
            typeof owner?.displayName === "string" && owner.displayName?.trim()
              ? owner.displayName
              : typeof owner?.phone === "string" && owner.phone?.trim()
                ? owner.phone
                : UNKNOWN_OWNER_LABEL;
          const ownerLabel = ownerLabelRaw.trim() ? ownerLabelRaw.trim() : UNKNOWN_OWNER_LABEL;
          const ownerAvatar =
            typeof owner?.avatarUrl === "string" && owner.avatarUrl.trim().length > 0 ? owner.avatarUrl : null;
          const pack = pull?.packDefinition ?? null;
          if (ownerId && ownerLabel !== UNKNOWN_OWNER_LABEL) {
            prefetchedNames[ownerId] = ownerLabel;
          }

          return {
            itemId,
            cardName,
            marketValueMinor,
            image: thumbnail ?? fallbackImage ?? detailsImage,
            ownerId,
            ownerLabel,
            ownerAvatar,
            packLabel:
              typeof pack?.name === "string" && pack.name.trim().length > 0
                ? pack.name
                : pull?.packId ?? null,
          };
        });
        if (mapped.length && !cancelled) {
          setPulls(mapped);
          if (Object.keys(prefetchedNames).length) {
            setCollectorNames((prev) => ({ ...prefetchedNames, ...prev }));
          }
        }
      } catch (error) {
        // Silent fallback to static pulls
      }
    };
    load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const marqueeItems = useMemo(() => {
    if (!pulls.length) {
      return pulls;
    }
    return [...pulls, ...pulls, ...pulls];
  }, [pulls]);

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

  return (
    <AppShell background="hero">
      <Head>
        <title>Ten Kings · Mystery Collectible Packs</title>
        <meta
          name="description"
          content="Sports, Pokémon, and Comic mystery packs. Graded, authenticated, and ready to rip with Ten Kings."
        />
      </Head>

      <section className="relative overflow-hidden bg-night-900/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-14 px-6 pb-16 pt-16 lg:flex-row lg:items-center">
          <div className="relative z-10 max-w-[650px] space-y-6">
            <p className="uppercase tracking-[0.6em] text-slate-500">Same mystery, more control</p>
            <h1 className="font-heading text-[4rem] uppercase leading-none tracking-[0.14em] text-white md:text-[5.75rem]">
              COLLECTIBLE MYSTERY PACKS
            </h1>
            <p className="font-lightning text-2xl uppercase tracking-[0.04em] text-transparent -skew-x-[20deg] whitespace-nowrap md:text-[2.5rem] lg:text-[2.8rem]">
              <span
                className="inline-block text-transparent"
                style={{
                  backgroundImage: "linear-gradient(110deg, #f8fafc 0%, #e0f2fe 25%, #93c5fd 55%, #dbeafe 85%, #ffffff 100%)",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  filter: "drop-shadow(0 0 18px rgba(147, 197, 253, 0.75)) drop-shadow(0 10px 24px rgba(15, 23, 42, 0.45))",
                }}
              >
                Pick It And
              </span>
              {" "}
              <span
                className="inline-block text-transparent"
                style={{
                  backgroundImage: "linear-gradient(110deg, #e0f2fe 0%, #cbd5f5 30%, #a5b4fc 60%, #bfdbfe 90%, #ffffff 100%)",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  filter: "drop-shadow(0 0 18px rgba(165, 180, 252, 0.75)) drop-shadow(0 10px 24px rgba(30, 58, 138, 0.45))",
                }}
              >
                Rip It
              </span>
            </p>
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
                Find a Location
              </button>
            </div>
            <p className="text-sm text-slate-400">Tap your card, the door opens, and you pick your pack—no coils.</p>
          </div>

          <div className="relative hidden flex-1 justify-end lg:flex">
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
          </div>
        </div>

        <div className="border-y border-white/10 bg-night-900/80">
          <div className="relative mx-auto flex w-full max-w-6xl items-center gap-6 overflow-hidden px-6 py-8">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-night-900 via-night-900/80 to-transparent" aria-hidden />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-night-900 via-night-900/80 to-transparent" aria-hidden />
            <div
              className="flex min-w-full gap-6 motion-reduce:animate-none motion-safe:animate-marquee"
              style={{ animationDuration: `${Math.max(18, marqueeItems.length * 2)}s` }}
            >
              {marqueeItems.map((item, index) => {
                const hasValue =
                  typeof item.marketValueMinor === "number" &&
                  Number.isFinite(item.marketValueMinor) &&
                  item.marketValueMinor > 0;
                const canOpen = Boolean(item.itemId && !item.itemId.startsWith("placeholder"));
                const displayOwnerLabel = item.ownerId ? collectorNames[item.ownerId] ?? item.ownerLabel : item.ownerLabel;
                return (
                  <article
                    key={`${item.itemId}-${index}`}
                    className="group flex min-w-[280px] max-w-[280px] flex-col gap-4 rounded-3xl border border-white/10 bg-slate-900/60 p-5 shadow-card transition hover:border-gold-400/60 hover:shadow-glow"
                    role="button"
                    tabIndex={canOpen ? 0 : -1}
                    onClick={() => handleOpenCard(item)}
                    onKeyDown={(event) => handleCardKeyDown(event, item)}
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
                            onClick={(event) => handleCollectorClick(event, item.ownerId)}
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
