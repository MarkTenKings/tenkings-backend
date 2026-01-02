import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import { ChaseCarousel } from "../components/ChaseCarousel";
import StripeCheckout from "../components/StripeCheckout";
import { useSession, SessionPayload } from "../hooks/useSession";
import {
  buybackItem,
  createStripePackIntent,
  listPacks,
  openPack,
  purchasePack,
} from "../lib/api";
import { formatTkd } from "../lib/formatters";
import type { NormalizedClassification } from "@tenkings/shared";

const BUYBACK_RATE = 0.75;

type CategoryId = "sports" | "pokemon";
type PaymentMethod = "card" | "tkd";

type OddsRow = { range: string; probability: string };

type PackTier = {
  id: string;
  label: string;
  price: number;
  image: string;
  details: string;
  expectedValue: number;
  odds: OddsRow[];
  disclaimer: string;
  comingSoon?: boolean;
};

type PackCategory = {
  id: CategoryId;
  label: string;
  hero: string;
  blurb: string;
  tiers: PackTier[];
  comingSoon?: boolean;
};

type Alert = { type: "success" | "error" | "info"; text: string };

type RevealItem = {
  packId: string;
  slotId?: string;
  itemId?: string | null;
  name: string;
  description: string;
  valueMinor: number;
  image: string;
  packImage: string;
  packLabel: string;
  buybackAvailable: boolean;
  buybackAccepted: boolean;
  normalized: NormalizedClassification | null;
};

const catalog: PackCategory[] = [
  {
    id: "sports",
    label: "Sports",
    hero: "/images/tenkings-vendingmachine-sports.png",
    blurb: "NBA, MLB, NFL, and F1 grails. Certified pulls ready for immediate vault transfer.",
    tiers: [
      {
        id: "sports-500",
        label: "$500 Championship Reserve",
        price: 500,
        image: "/images/pack-tier-500.png",
        details:
          "Platinum-grade slabs and low-numbered ink from championship rosters. Guaranteed serial-numbered hits with spotlight odds on on-card autos.",
        expectedValue: 500,
        comingSoon: true,
        odds: [
          { range: "$300 – $450", probability: "48%" },
          { range: "$450 – $650", probability: "24%" },
          { range: "$650 – $1,000", probability: "18%" },
          { range: "$1,000 – $2,500", probability: "7%" },
          { range: "$2,500 – $5,000", probability: "2.7%" },
          { range: "$5,000+", probability: "0.3%" },
        ],
        disclaimer: "Odds based on sealed inventory audits; Terms apply.",
      },
      {
        id: "sports-100",
        label: "$100 Prime Draft",
        price: 100,
        image: "/images/pack-tier-100.png",
        details:
          "All-star rookies, refractor parallels, and authenticated vintage inserts. Balanced for chase value without filler commons.",
        expectedValue: 100,
        comingSoon: true,
        odds: [
          { range: "$60 – $110", probability: "54%" },
          { range: "$110 – $175", probability: "23%" },
          { range: "$175 – $300", probability: "17%" },
          { range: "$300 – $600", probability: "5%" },
          { range: "$600+", probability: "1%" },
        ],
        disclaimer: "Expected value based on Ten Kings pricing engine; Terms apply.",
      },
      {
        id: "sports-50",
        label: "$50 Courtside",
        price: 50,
        image: "/images/pack-tier-50.png",
        details: "Guaranteed hits include serial-numbered rookies or patch cards from current stars across the major leagues.",
        expectedValue: 50,
        odds: [
          { range: "$30 – $60", probability: "58%" },
          { range: "$60 – $100", probability: "24%" },
          { range: "$100 – $200", probability: "15%" },
          { range: "$200+", probability: "3%" },
        ],
        disclaimer: "Inventory refreshed weekly; Terms apply.",
      },
      {
        id: "sports-25",
        label: "$25 Prospect",
        price: 25,
        image: "/images/pack-tier-25.png",
        details: "Entry-tier mystery with slabbed rookies, numbered parallels, and authenticated memorabilia chips.",
        expectedValue: 25,
        odds: [
          { range: "$15 – $30", probability: "62%" },
          { range: "$30 – $60", probability: "26%" },
          { range: "$60 – $150", probability: "10%" },
          { range: "$150+", probability: "2%" },
        ],
        disclaimer: "Odds verified by quarterly audit; Terms apply.",
      },
    ],
  },
  {
    id: "pokemon",
    label: "Pokémon",
    hero: "/images/tenkings-vendingmachine-pokemon.png",
    blurb: "Vintage holos, modern alt-art chases, and Japanese exclusives in every grid.",
    tiers: [
      {
        id: "pokemon-500",
        label: "$500 Master Ball",
        price: 500,
        image: "/images/pack-tier-500.png",
        details:
          "Enter the high-end vault: Shadowless holos, Gold Star chases, and BGS/PSA 9+ classics. Every pack hides authenticated slabs with premium shine.",
        expectedValue: 500,
        comingSoon: true,
        odds: [
          { range: "$250 – $375", probability: "49%" },
          { range: "$375 – $500", probability: "21%" },
          { range: "$500 – $1,000", probability: "23%" },
          { range: "$1,000 – $2,000", probability: "5.8%" },
          { range: "$2,000 – $4,000", probability: "0.97%" },
          { range: "$4,000 – $8,000", probability: "0.06%" },
        ],
        disclaimer: "Based on sealed-case probability modeling; Terms apply.",
      },
      {
        id: "pokemon-100",
        label: "$100 Ultra Ball",
        price: 100,
        image: "/images/pack-tier-100.png",
        details:
          "Chances at vintage WotC holos, modern alt arts, and Japanese exclusives. Each pack includes at least one graded hit (PSA 8+).",
        expectedValue: 100,
        comingSoon: true,
        odds: [
          { range: "$60 – $120", probability: "50%" },
          { range: "$120 – $175", probability: "20%" },
          { range: "$175 – $300", probability: "23%" },
          { range: "$300 – $600", probability: "6%" },
          { range: "$600 – $1,200", probability: "1.1%" },
          { range: "$1,200+", probability: "0.06%" },
        ],
        disclaimer: "Expected value includes guaranteed graded hit; Terms apply.",
      },
      {
        id: "pokemon-50",
        label: "$50 Great Ball",
        price: 50,
        image: "/images/pack-tier-50.png",
        details:
          "Holos in every rip. Mix of Japanese promos, EX-era foils, and modern chase art with pack-fresh presentation.",
        expectedValue: 50,
        odds: [
          { range: "$30 – $55", probability: "50%" },
          { range: "$55 – $90", probability: "21%" },
          { range: "$90 – $150", probability: "23%" },
          { range: "$150 – $350", probability: "5.7%" },
          { range: "$350 – $650", probability: "0.88%" },
          { range: "$650+", probability: "0.06%" },
        ],
        disclaimer: "Holos guaranteed; Terms apply.",
      },
      {
        id: "pokemon-25",
        label: "$25 Poké Ball",
        price: 25,
        image: "/images/pack-tier-25.png",
        details:
          "Starter-friendly mystery featuring classic holos, modern chase reverses, and sealed promos.",
        expectedValue: 25,
        odds: [
          { range: "$15 – $30", probability: "31%" },
          { range: "$30 – $45", probability: "38%" },
          { range: "$45 – $90", probability: "23%" },
          { range: "$90 – $200", probability: "6.6%" },
          { range: "$200 – $350", probability: "1.3%" },
          { range: "$350+", probability: "0.11%" },
        ],
        disclaimer: "Odds compiled quarterly from sealed pack openings; Terms apply.",
      },
    ],
  },
];

const tierImageOverrides: Record<string, string> = {
  "sports-500": "/images/500-sports-pack-tier.png",
  "sports-100": "/images/100-sports-pack-tier.png",
  "pokemon-500": "/images/500-pokemon-pack-tier.png",
  "pokemon-100": "/images/100-pokemon-pack-tier.png",
  "pokemon-50": "/images/50-pokemon-pack-tier.png",
  "pokemon-25": "/images/25-pokemon-pack-tier.png",
};

const canonical = (value: string | null | undefined) =>
  value ? value.replace(/[^a-z0-9]/gi, "").toLowerCase() : "";

const categoryEnumById: Record<CategoryId, string> = {
  sports: "SPORTS",
  pokemon: "POKEMON",
};

const tierEnumByPrice: Record<number, string> = {
  25: "TIER_25",
  50: "TIER_50",
  100: "TIER_100",
  500: "TIER_500",
};

type Fact = { label: string; value: string };
type LinkFact = { label: string; href: string };
type NormalizedFacts = {
  core: Fact[];
  sport: Fact[];
  tcg: Fact[];
  links: LinkFact[];
};

const extractNormalizedClassification = (item: any): NormalizedClassification | null => {
  if (!item) {
    return null;
  }

  const direct = item.classificationNormalized;
  if (direct && typeof direct === "object") {
    return direct as NormalizedClassification;
  }

  const fromDetailsJson = item.detailsJson;
  if (fromDetailsJson && typeof fromDetailsJson === "object") {
    const candidate =
      (fromDetailsJson as Record<string, unknown>).classificationNormalized ??
      (fromDetailsJson as Record<string, unknown>).normalized ??
      null;
    if (candidate && typeof candidate === "object") {
      return candidate as NormalizedClassification;
    }
  }

  const fromDetails = item.details;
  if (fromDetails && typeof fromDetails === "object") {
    const candidate =
      (fromDetails as Record<string, unknown>).classificationNormalized ??
      (fromDetails as Record<string, unknown>).normalized ??
      null;
    if (candidate && typeof candidate === "object") {
      return candidate as NormalizedClassification;
    }
  }

  const ingestion = (item as Record<string, unknown>)?.ingestionTask;
  if (ingestion && typeof ingestion === "object") {
    const directIngestion =
      (ingestion as Record<string, unknown>).classificationNormalized ??
      (ingestion as Record<string, unknown>).normalized ??
      null;
    if (directIngestion && typeof directIngestion === "object") {
      return directIngestion as NormalizedClassification;
    }

    const rawPayload = (ingestion as Record<string, unknown>).rawPayload;
    if (rawPayload && typeof rawPayload === "object") {
      const candidate =
        (rawPayload as Record<string, unknown>).classificationNormalized ??
        (rawPayload as Record<string, unknown>).normalized ??
        null;
      if (candidate && typeof candidate === "object") {
        return candidate as NormalizedClassification;
      }
    }
  }

  return null;
};

const boolToLabel = (value: boolean | null | undefined) =>
  value === true ? "Yes" : value === false ? "No" : "";

const pushFact = (facts: Fact[], label: string, raw: unknown) => {
  if (raw === null || raw === undefined) {
    return;
  }
  const value = String(raw).trim();
  if (value.length === 0) {
    return;
  }
  facts.push({ label, value });
};

const buildNormalizedFacts = (normalized: NormalizedClassification | null): NormalizedFacts => {
  const facts: NormalizedFacts = {
    core: [],
    sport: [],
    tcg: [],
    links: [],
  };

  if (!normalized) {
    return facts;
  }

  pushFact(facts.core, "Display Name", normalized.displayName);
  pushFact(facts.core, "Set", normalized.setName);
  pushFact(facts.core, "Card Number", normalized.cardNumber);
  pushFact(facts.core, "Year", normalized.year);
  pushFact(facts.core, "Company", normalized.company);
  pushFact(facts.core, "Rarity", normalized.rarity);

  const sport = normalized.sport ?? null;
  if (sport) {
    pushFact(facts.sport, "Player", sport.playerName);
    pushFact(facts.sport, "Team", sport.teamName);
    pushFact(facts.sport, "League", sport.league);
    pushFact(facts.sport, "Sport", sport.sport);
    pushFact(facts.sport, "Card Type", sport.cardType);
    pushFact(facts.sport, "Subcategory", sport.subcategory);
    const autograph = boolToLabel(sport.autograph ?? null);
    if (autograph) pushFact(facts.sport, "Autograph", autograph);
    const foil = boolToLabel(sport.foil ?? null);
    if (foil) pushFact(facts.sport, "Foil", foil);
    const graded = boolToLabel(sport.graded ?? null);
    if (graded) pushFact(facts.sport, "Graded", graded);
    pushFact(facts.sport, "Grade Company", sport.gradeCompany);
    pushFact(facts.sport, "Grade", sport.grade);
  }

  const tcg = normalized.tcg ?? null;
  if (tcg) {
    pushFact(facts.tcg, "Card Name", tcg.cardName);
    pushFact(facts.tcg, "Game", tcg.game);
    pushFact(facts.tcg, "Series", tcg.series);
    pushFact(facts.tcg, "Color", tcg.color);
    pushFact(facts.tcg, "Type", tcg.type);
    pushFact(facts.tcg, "Language", tcg.language);
    const foil = boolToLabel(tcg.foil ?? null);
    if (foil) pushFact(facts.tcg, "Foil", foil);
    pushFact(facts.tcg, "Rarity", tcg.rarity);
    pushFact(facts.tcg, "Out Of", tcg.outOf);
    pushFact(facts.tcg, "Subcategory", tcg.subcategory);
  }

  const links = normalized.links ?? {};
  Object.entries(links).forEach(([label, href]) => {
    if (typeof href === "string" && href.trim().length > 0) {
      facts.links.push({ label, href });
    }
  });

  return facts;
};

const placeholderReveal = (category: PackCategory, tier: PackTier): RevealItem => ({
  packId: "placeholder",
  name: `${category.label} Vault Hit`,
  description: tier.details,
  valueMinor: tier.expectedValue * 100,
  image: tier.image,
  packImage: tier.image,
  packLabel: `${category.label} · ${tier.label}`,
  buybackAvailable: tier.expectedValue > 0,
  buybackAccepted: false,
  normalized: null,
});

interface RevealModalProps {
  reveal: RevealItem;
  stage: "intro" | "rip" | "card";
  onClose: () => void;
  onAcceptBuyback: () => void;
  onSaveToCollection: () => void;
  buybackBusy: boolean;
  canAcceptBuyback: boolean;
  buybackAccepted: boolean;
  collectionSaved: boolean;
}

const PROSPECT_LINE = "Entry-tier mystery with slabbed rookies, numbered parallels, and authenticated memorabilia chips.";

function RevealModal({
  reveal,
  stage,
  onClose,
  onAcceptBuyback,
  onSaveToCollection,
  buybackBusy,
  canAcceptBuyback,
  buybackAccepted,
  collectionSaved,
}: RevealModalProps) {
  const cardImage = reveal.image || reveal.packImage;

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const shouldShowDescription =
    stage === "card" && Boolean(reveal.description?.trim()) && reveal.description?.trim() !== PROSPECT_LINE;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 sm:py-8">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className="relative z-10 w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-night-900/95 shadow-2xl md:max-h-none md:overflow-hidden"
        style={{ maxHeight: "calc(100vh - 2rem)" }}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
        >
          Close
        </button>
        <div className="flex flex-col items-center gap-6 p-6 sm:p-8">
          <div className="relative flex h-[22rem] w-full items-center justify-center sm:h-80" style={{ perspective: "1200px" }}>
            {stage !== "card" && (
              <div
                className="relative h-56 w-40 sm:h-64 sm:w-48 md:h-72 md:w-52"
                style={{
                  animation:
                    stage === "intro"
                      ? "packSpinFloat 1.6s ease-in-out infinite"
                      : stage === "rip"
                        ? "packRip 0.6s ease forwards"
                        : undefined,
                  transformStyle: "preserve-3d",
                  backfaceVisibility: "hidden",
                }}
              >
                <Image src={reveal.packImage} alt={reveal.packLabel} fill className="object-contain" sizes="192px" priority unoptimized />
              </div>
            )}
            {stage === "card" && (
              <div className="card-reveal relative h-[20rem] w-[14rem] sm:h-80 sm:w-56">
                <div className="absolute inset-0 rounded-[2rem] border border-gold-400/50 bg-night-900/70 shadow-[0_0_55px_rgba(250,204,21,0.35)]" />
                <Image
                  src={cardImage}
                  alt={reveal.name}
                  fill
                  className="rounded-[2rem] object-cover"
                  sizes="224px"
                  unoptimized
                />
              </div>
            )}
          </div>
          <div className="space-y-3 text-center">
            <p className="text-xs uppercase tracking-[0.32em] text-slate-400">{reveal.packLabel}</p>
            {stage === "card" ? (
              <>
                <h2 className="font-heading text-3xl uppercase tracking-[0.2em] text-white">{reveal.name}</h2>
                {shouldShowDescription && (
                  <p className="mx-auto max-w-xl whitespace-pre-line text-sm text-slate-300">{reveal.description}</p>
                )}
                <div className="flex flex-wrap justify-center gap-8 pt-4 text-sm text-slate-300">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Estimated Value</p>
                    <p className="text-xl text-gold-300">{formatTkd(reveal.valueMinor)}</p>
                  </div>
                  {reveal.buybackAvailable && (
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Instant Buyback (75%)</p>
                      <p className="text-xl text-emerald-300">{formatTkd(Math.round(reveal.valueMinor * BUYBACK_RATE))}</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <h2 className="font-heading text-3xl uppercase tracking-[0.2em] text-white">Pack Ripping…</h2>
            )}
          </div>
          {stage === "card" && (
            <div className="mt-4 flex w-full flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
              {reveal.buybackAvailable && (
                <button
                  type="button"
                  onClick={onAcceptBuyback}
                  disabled={!canAcceptBuyback || buybackBusy || buybackAccepted}
                  className="w-full rounded-full border border-emerald-400/40 bg-emerald-500/20 px-6 py-3 text-xs uppercase tracking-[0.32em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  {buybackAccepted ? "Buyback accepted" : buybackBusy ? "Processing…" : "Accept buyback"}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.32em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200 sm:w-auto"
              >
                VIEW CARD DETAILS
              </button>
              <button
                type="button"
                onClick={onSaveToCollection}
                disabled={collectionSaved}
                className="w-full rounded-full border border-gold-400/50 px-6 py-3 text-xs uppercase tracking-[0.32em] text-gold-200 transition hover:border-gold-300 hover:text-gold-100 disabled:cursor-not-allowed disabled:border-white/15 disabled:text-slate-500 sm:w-auto"
              >
                {collectionSaved ? "SAVED TO YOUR COLLECTION" : "SAVE TO YOUR COLLECTION"}
              </button>
            </div>
          )}
        </div>
      </div>
      <style jsx>{`
        @keyframes packFloat {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-12px);
          }
        }
        @keyframes packSpinFloat {
          0% {
            transform: translateY(0) rotateY(0deg);
          }
          25% {
            transform: translateY(-8px) rotateY(90deg);
          }
          50% {
            transform: translateY(-16px) rotateY(180deg);
          }
          75% {
            transform: translateY(-8px) rotateY(270deg);
          }
          100% {
            transform: translateY(0) rotateY(360deg);
          }
        }
        @keyframes packRip {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          60% {
            transform: scale(1.1);
            opacity: 0.8;
          }
          100% {
            transform: scale(0.6);
            opacity: 0;
          }
        }
        @keyframes cardReveal {
          0% {
            transform: translateY(40px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .card-reveal {
          animation: cardReveal 0.5s ease forwards;
        }
      `}</style>
    </div>
  );
}

export default function Packs() {
  const router = useRouter();
  const { ensureSession, updateWalletBalance, logout } = useSession();

  const [definitions, setDefinitions] = useState<any[]>([]);
  const [definitionsLoading, setDefinitionsLoading] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [step, setStep] = useState<"category" | "tier" | "pick" | "checkout" | "reveal">("category");
  const [categoryId, setCategoryId] = useState<CategoryId | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [ctaBusy, setCtaBusy] = useState(false);
  const [buybackBusy, setBuybackBusy] = useState(false);
  const [stripeIntent, setStripeIntent] = useState<
    { clientSecret: string; paymentIntentId: string } | null
  >(null);
  const [activePack, setActivePack] = useState<any | null>(null);
  const [reveal, setReveal] = useState<RevealItem | null>(null);
  const [resolution, setResolution] = useState<"collection" | "buyback" | null>(null);
  const [showRevealModal, setShowRevealModal] = useState(false);
  const [revealStage, setRevealStage] = useState<"intro" | "rip" | "card">("intro");
  const revealSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadDefinitions = async () => {
      try {
        setDefinitionsLoading(true);
        const { definitions } = await listPacks();
        if (!cancelled) {
          setDefinitions(definitions);
        }
      } catch (error) {
        if (!cancelled) {
          const raw = error instanceof Error ? error.message : "Unable to load pack definitions";
          const message = raw.toLowerCase() === "failed to fetch"
            ? "Pack catalog API is offline. Start the backend services to load live pricing."
            : raw;
          setAlert({ type: "error", text: message });
        }
      } finally {
        if (!cancelled) {
          setDefinitionsLoading(false);
        }
      }
    };

    loadDefinitions().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (paymentMethod !== "card") {
      setStripeIntent(null);
    }
  }, [paymentMethod]);

  useEffect(() => {
    setStripeIntent(null);
  }, [categoryId, tierId]);

  const finalizePurchase = async (
    session: SessionPayload,
    matchedDefinition: any,
    currentCategory: PackCategory,
    currentTier: PackTier,
    payment:
      | { method: "wallet" }
      | { method: "stripe"; paymentIntentId: string }
  ) => {
    const response = await purchasePack({
      packDefinitionId: matchedDefinition.id,
      userId: session.user.id,
      paymentMethod: payment.method,
      ...(payment.method === "stripe"
        ? { paymentIntentId: payment.paymentIntentId }
        : {}),
    });

    if (response.walletBalance !== null && response.walletBalance !== undefined) {
      updateWalletBalance(response.walletBalance);
    }

    const opened = await openPack(response.pack.id, session.user.id);
    const slots: any[] = opened.pack?.slots ?? [];
    const highlightSlot =
      slots.find((slot) => slot.item) ??
      slots[0] ??
      null;

    setActivePack(opened.pack);

    if (highlightSlot?.item) {
      const estimated = Number(
        highlightSlot.item.estimatedValue ?? highlightSlot.item.marketValue ?? 0
      );
      const normalized = extractNormalizedClassification(highlightSlot.item);
      setResolution(null);
      setReveal({
        packId: opened.pack.id,
        slotId: highlightSlot.id,
        itemId: highlightSlot.itemId ?? highlightSlot.item.id ?? null,
        name: highlightSlot.item.name ?? currentTier.label,
        description: highlightSlot.item.description ?? currentTier.details,
        valueMinor: Number.isFinite(estimated)
          ? estimated
          : currentTier.expectedValue * 100,
        image:
          highlightSlot.item.thumbnailUrl ??
          highlightSlot.item.imageUrl ??
          (highlightSlot.item.ingestionTask?.rawPayload as { imageUrl?: string } | undefined)?.imageUrl ??
          currentTier.image,
        packImage: currentTier.image,
        packLabel: `${currentCategory.label} · ${currentTier.label}`,
        buybackAvailable: Boolean(
          (highlightSlot.itemId ?? highlightSlot.item.id) && estimated > 0
        ),
        buybackAccepted: false,
        normalized,
      });
    } else {
      setReveal(placeholderReveal(currentCategory, currentTier));
      setResolution("collection");
    }

    setShowRevealModal(true);
    setRevealStage("intro");
    setAlert({
      type: "success",
      text: `Pack ${opened.pack.id} ripped! Enjoy the reveal.`,
    });
    setStep("reveal");
  };

  const category = useMemo(() => catalog.find((entry) => entry.id === categoryId) ?? null, [categoryId]);
  const tier = useMemo(() => category?.tiers.find((entry) => entry.id === tierId) ?? null, [category, tierId]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    const rawParam = router.query.category;
    const requested = Array.isArray(rawParam) ? rawParam[0] : rawParam;
    if (!requested) {
      return;
    }
    const normalized = requested.toString().toLowerCase();
    if (categoryId === normalized) {
      return;
    }
    const matchedCategory = catalog.find((entry) => entry.id === normalized);
    if (!matchedCategory) {
      return;
    }

    setAlert(null);
    setCategoryId(matchedCategory.id);
    setTierId(null);
    setSelectedSlot(null);
    setPaymentMethod("card");
    setActivePack(null);
    setReveal(null);
    setShowRevealModal(false);
    setRevealStage("intro");
    setStep(matchedCategory.comingSoon ? "category" : "tier");
  }, [router.isReady, router.query.category, categoryId]);

  useEffect(() => {
    if (!showRevealModal) {
      return;
    }

    const ripDelay = 1300;
    const cardDelay = 2800;

    setRevealStage("intro");
    const ripTimer = window.setTimeout(() => setRevealStage("rip"), ripDelay);
    const cardTimer = window.setTimeout(() => setRevealStage("card"), cardDelay);
    return () => {
      window.clearTimeout(ripTimer);
      window.clearTimeout(cardTimer);
    };
  }, [showRevealModal]);

  const resolveDefinition = useCallback(
    (currentCategory: PackCategory | null, currentTier: PackTier | null) => {
      if (!currentCategory || !currentTier) {
        return null;
      }
      if (!definitions.length) {
        return null;
      }
      const categoryEnum = categoryEnumById[currentCategory.id];
      const tierEnum = tierEnumByPrice[currentTier.price];

      if (categoryEnum && tierEnum) {
        const enumMatch = definitions.find(
          (definition) => definition.category === categoryEnum && definition.tier === tierEnum
        );
        if (enumMatch) {
          return enumMatch;
        }
      }

      const categoryKey = canonical(currentCategory.label);
      const tierKey = canonical(currentTier.label);

      const directMatch = definitions.find((definition) => canonical(definition.name) === tierKey);
      if (directMatch) {
        return directMatch;
      }

      const categoryMatch = definitions.find((definition) =>
        canonical(definition.metadata?.category ?? definition.category) === categoryKey &&
        canonical(definition.name).includes(tierKey)
      );
      if (categoryMatch) {
        return categoryMatch;
      }

      const priceMatch = definitions.find((definition) => {
        const price = Number(definition.price ?? 0);
        return price === currentTier.price || price === currentTier.price * 100;
      });
      if (priceMatch) {
        return priceMatch;
      }

      return definitions[0] ?? null;
    },
    [definitions]
  );

  const definition = useMemo(() => resolveDefinition(category, tier), [category, tier, resolveDefinition]);

  const normalizedFacts = useMemo(() => buildNormalizedFacts(reveal?.normalized ?? null), [reveal?.normalized]);

  const normalizedFactSections = useMemo(
    () =>
      (
        [
          { key: "core", title: "Card Facts", facts: normalizedFacts.core },
          { key: "sport", title: "Sport Details", facts: normalizedFacts.sport },
          { key: "tcg", title: "TCG Details", facts: normalizedFacts.tcg },
        ] as Array<{ key: string; title: string; facts: Fact[] }>
      ).filter((section) => section.facts.length > 0),
    [normalizedFacts]
  );

  const hasNormalizedFacts = normalizedFactSections.length > 0 || normalizedFacts.links.length > 0;

  const handleSelectCategory = (id: CategoryId) => {
    const nextCategory = catalog.find((entry) => entry.id === id);
    setAlert(null);
    setCategoryId(id);
    setTierId(null);
    setSelectedSlot(null);
    setPaymentMethod("card");
    setActivePack(null);
    setReveal(null);
    setResolution(null);
    setShowRevealModal(false);
    setRevealStage("intro");
    setStep(nextCategory?.comingSoon ? "category" : "tier");
    if (nextCategory && !nextCategory.comingSoon) {
      router.replace({ pathname: router.pathname, query: { category: id } }, undefined, { shallow: true }).catch(() => undefined);
    }
  };

  const handleSelectTier = (id: string) => {
    if (!category) {
      return;
    }
    const nextTier = category.tiers.find((entry) => entry.id === id);
    if (nextTier?.comingSoon) {
      setAlert({ type: "info", text: "That tier is stocking now. Check back when it goes live." });
      return;
    }
    setAlert(null);
    setTierId(id);
    setSelectedSlot(null);
    setPaymentMethod("card");
    setActivePack(null);
    setReveal(null);
    setResolution(null);
    setShowRevealModal(false);
    setRevealStage("intro");
    setStep("pick");
  };

  const handleReturn = (target: typeof step) => {
    setAlert(null);
    setStripeIntent(null);
    if (step === "reveal" && reveal && resolution === null) {
      keepInCollection({
        message:
          "Saved to your collection by default. You can review or request buyback anytime from My Collection.",
        type: "info",
        annotate: true,
      });
    }
    if (target === "category") {
      setCategoryId(null);
      setTierId(null);
      router
        .replace({ pathname: router.pathname }, undefined, { shallow: true })
        .catch(() => undefined);
    }
    if (target === "tier") {
      setTierId(null);
    }
    if (target === "pick") {
      setSelectedSlot(null);
    }
    setActivePack(null);
    setReveal(null);
    setResolution(null);
    setShowRevealModal(false);
    setRevealStage("intro");
    setStep(target);
  };

  const closeRevealModal = useCallback(() => {
    setShowRevealModal(false);
    window.setTimeout(() => {
      revealSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  }, []);

  const proceedToCheckout = async () => {
    if (!category || !tier) {
      return;
    }
    const matchedDefinition = resolveDefinition(category, tier);
    if (!matchedDefinition) {
      setAlert({ type: "error", text: "Pack definitions have not synced yet. Create definitions in the operator console." });
      return;
    }
    try {
      setCtaBusy(true);
      await ensureSession();
      setStep("checkout");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication required";
      setAlert({ type: "error", text: message });
    } finally {
      setCtaBusy(false);
    }
  };

  const completePurchase = async () => {
    if (!category || !tier) {
      return;
    }
    const matchedDefinition = resolveDefinition(category, tier);
    if (!matchedDefinition) {
      setAlert({ type: "error", text: "No pack definition found for this tier. Refresh inventory or create a definition first." });
      return;
    }
    if (paymentMethod === "card") {
      try {
        setCtaBusy(true);
        const session = await ensureSession();
        if (!stripeIntent) {
          const intent = await createStripePackIntent(
            matchedDefinition.id,
            session.user.id
          );
          setStripeIntent(intent);
          setAlert({
            type: "success",
            text: "Card checkout ready. Enter your payment details below to finish.",
          });
        } else {
          setAlert({
            type: "success",
            text: "Enter your card details below to complete checkout.",
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to start card checkout";
        setAlert({ type: "error", text: message });
      } finally {
        setCtaBusy(false);
      }
      return;
    }

    try {
      setCtaBusy(true);
      const session = await ensureSession();
      await finalizePurchase(session, matchedDefinition, category, tier, {
        method: "wallet",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to purchase pack";
      setAlert({ type: "error", text: message });
    } finally {
      setCtaBusy(false);
    }
  };

  const finalizeStripePayment = async (paymentIntentId: string) => {
    if (!category || !tier) {
      return;
    }
    const matchedDefinition = resolveDefinition(category, tier);
    if (!matchedDefinition) {
      setAlert({
        type: "error",
        text: "Pack definition unavailable. Refresh and try again.",
      });
      return;
    }

    try {
      setCtaBusy(true);
      const session = await ensureSession();
      await finalizePurchase(session, matchedDefinition, category, tier, {
        method: "stripe",
        paymentIntentId,
      });
      setStripeIntent(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to confirm card payment";
      setAlert({ type: "error", text: message });
    } finally {
      setCtaBusy(false);
    }
  };

  const redirectToCollection = useCallback(() => {
    router.push("/collection").catch(() => undefined);
  }, [router]);

  const requireFreshSession = useCallback(
    async (fallbackMessage: string) => {
      logout();
      try {
        await ensureSession();
      } catch (error) {
        const message =
          error instanceof Error && error.message !== "Authentication cancelled"
            ? error.message
            : fallbackMessage;
        setAlert({ type: "error", text: message });
      }
    },
    [ensureSession, logout]
  );

  const acceptBuyback = async () => {
    if (!reveal?.itemId) {
      setAlert({ type: "error", text: "Buyback unavailable for this pull." });
      return;
    }
    try {
      setBuybackBusy(true);
      const session = await ensureSession();
      const result = await buybackItem(reveal.itemId, session.user.id);
      if (result.walletBalance !== null && result.walletBalance !== undefined) {
        updateWalletBalance(result.walletBalance);
      }
      setReveal((prev) =>
        prev
          ? {
              ...prev,
              buybackAccepted: true,
              description: `${prev.description}\n\nInstant buyback accepted. ${formatTkd(result.buybackAmount)} added to your TKD balance.`,
            }
          : prev
      );
      setResolution("buyback");
      setAlert({ type: "success", text: `Instant buyback credited ${formatTkd(result.buybackAmount)} to your wallet.` });
      setShowRevealModal(false);
      setRevealStage("intro");
      window.setTimeout(() => {
        redirectToCollection();
      }, 250);
    } catch (error) {
      if (error instanceof Error && /session/i.test(error.message)) {
        await requireFreshSession("Sign in again to continue with instant buyback.");
      } else {
        const message = error instanceof Error ? error.message : "Buyback failed";
        setAlert({ type: "error", text: message });
      }
    } finally {
      setBuybackBusy(false);
    }
  };

  function keepInCollection(options?: { message?: string; type?: Alert["type"]; annotate?: boolean }) {
    if (!reveal) {
      setAlert({ type: "error", text: "No pull to save right now." });
      return;
    }
    setResolution("collection");
    if (options?.annotate) {
      setReveal((prev) =>
        prev
          ? {
              ...prev,
              description: prev.description.includes("Saved to your collection")
                ? prev.description
                : `${prev.description}\n\nSaved to your collection.`,
            }
          : prev
      );
    }
    const message = options?.message ?? "Saved to your collection. You can review it anytime under My Collection.";
    const type = options?.type ?? "success";
    setAlert({ type, text: message });
  }

  const handleSaveToCollection = () => {
    keepInCollection({ annotate: true });
    setShowRevealModal(false);
    setRevealStage("intro");
    redirectToCollection();
  };

  const alertBanner =
    alert && (
      <div
        className={`mx-auto mt-6 w-full max-w-6xl rounded-2xl border px-5 py-4 text-sm ${
          alert.type === "error"
            ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
            : alert.type === "success"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-sky-500/40 bg-sky-500/10 text-sky-200"
        }`}
      >
        {alert.text}
      </div>
    );

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Pick Your Pack</title>
        <meta name="description" content="Choose your mystery collectible pack: select a machine, tier, and the pack you rip." />
      </Head>

      <section className="bg-night-900/80 py-16">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6">
          <header className="space-y-4">
            <h1 className="font-heading text-5xl uppercase tracking-[0.14em] text-white">Pick Your Pack</h1>
          </header>

          <nav aria-label="Progress" className="flex flex-col gap-4">
            <ol className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-[0.35em] text-slate-500">
              <li className={step !== "category" ? "text-gold-400" : "text-white"}>Category</li>
              <span className="text-slate-700">•</span>
              <li className={step !== "category" ? "text-gold-400" : "text-white/60"}>Tier</li>
              <span className="text-slate-700">•</span>
              <li className={step === "pick" || step === "checkout" || step === "reveal" ? "text-gold-400" : "text-white/60"}>Pick</li>
              <span className="text-slate-700">•</span>
              <li className={step === "checkout" || step === "reveal" ? "text-gold-400" : "text-white/60"}>Checkout</li>
              <span className="text-slate-700">•</span>
              <li className={step === "reveal" ? "text-gold-400" : "text-white/60"}>Reveal</li>
            </ol>
          </nav>
        </div>
        {alertBanner}
      </section>

      {step === "category" && (
        <section className="bg-night-900/70 py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6">
            <header className="space-y-2">
              <h2 className="font-heading text-4xl uppercase tracking-[0.16em] text-white">Choose Your Machine</h2>
              <p className="text-sm text-slate-400">Tap a machine to preview the tiers inside. Machines marked “coming soon” are in final stocking.</p>
            </header>
            <div className="grid gap-8 md:grid-cols-3">
              {catalog.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => !entry.comingSoon && handleSelectCategory(entry.id)}
                  className={`group relative overflow-hidden rounded-[2.25rem] border border-white/10 bg-slate-900/60 p-6 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-500 ${
                    entry.comingSoon ? "cursor-not-allowed opacity-60" : "hover:border-gold-400/70 hover:shadow-glow"
                  }`}
                >
                  <div className="relative mb-6 h-60 w-full overflow-hidden rounded-2xl border border-white/10">
                    <Image
                      src={entry.hero}
                      alt={`${entry.label} vending machine`}
                      fill
                      sizes="(max-width: 768px) 80vw, 320px"
                      className="object-cover transition duration-500 group-hover:scale-105"
                    />
                  </div>
                  <h3 className="font-heading text-3xl uppercase tracking-[0.24em] text-white">{entry.label}</h3>
                  <p className="mt-3 text-sm text-slate-300">{entry.blurb}</p>
                  <p className="mt-6 inline-flex items-center gap-2 text-xs uppercase tracking-[0.32em] text-gold-400">
                    {entry.comingSoon ? "Coming Soon" : "Enter Machine"}
                    {!entry.comingSoon && <span aria-hidden className="text-base">→</span>}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {step === "tier" && category && (
        <section className="bg-night-900/75 py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="uppercase tracking-[0.3em] text-violet-300">{category.label} Machine</p>
                <h2 className="font-heading text-4xl uppercase tracking-[0.18em] text-white">Select a tier</h2>
              </div>
              <button
                type="button"
                onClick={() => handleReturn("category")}
                className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                Back to machines
              </button>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
              {category.tiers.map((currentTier) => {
                const overrideImage = tierImageOverrides[currentTier.id] ?? currentTier.image;
                const tierComingSoon = Boolean(currentTier.comingSoon);
                const showChaseCarousel = ["pokemon", "sports"].includes(category.id);
                const placeholderChases = Array.from({ length: 5 }, (_, index) => `Chase Card ${index + 1}`);

                return (
                  <article
                    key={currentTier.id}
                    className={`relative w-full rounded-[2rem] border border-white/10 bg-slate-900/60 p-7 shadow-card transition ${
                      tierComingSoon ? "opacity-70" : "hover:border-gold-400/70 hover:shadow-glow"
                    }`}
                  >
                    <div className="flex flex-col gap-6 lg:flex-row">
                      <div className="flex w-full flex-col gap-4 lg:w-56">
                        <div className="relative flex h-52 w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10">
                          <Image
                            src={overrideImage}
                            alt={`${currentTier.label} pack art`}
                            width={320}
                            height={320}
                            sizes="(max-width: 768px) 70vw, 240px"
                            className="h-auto w-[75%] max-w-[240px] object-contain"
                          />
                        </div>
                        {showChaseCarousel && (
                          <div className="hidden md:block">
                            <ChaseCarousel labels={placeholderChases} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 space-y-4">
                        <header className="space-y-1">
                          <h3 className="font-heading text-3xl uppercase tracking-[0.24em] text-white">{currentTier.label}</h3>
                          <p className="text-sm text-slate-400">Expected value · ${currentTier.expectedValue.toLocaleString()}</p>
                        </header>
                        <p className="text-sm text-slate-300">{currentTier.details}</p>
                        <ul className="grid gap-2 rounded-2xl border border-white/5 bg-night-900/60 p-4 text-xs text-slate-300">
                          {currentTier.odds.length ? (
                            currentTier.odds.map((row) => (
                              <li key={row.range} className="flex items-center justify-between">
                                <span>{row.range}</span>
                                <span className="text-gold-300">{row.probability}</span>
                              </li>
                            ))
                          ) : (
                            <li className="text-slate-500">Odds release soon. Join the waitlist.</li>
                          )}
                        </ul>
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <p className="text-xs text-slate-500">
                            {currentTier.disclaimer}{" "}
                            <Link className="text-gold-400 underline" href="/terms">
                              Terms apply
                            </Link>
                            .
                          </p>
                          <button
                            type="button"
                            onClick={() => !tierComingSoon && handleSelectTier(currentTier.id)}
                            disabled={tierComingSoon}
                            className={`w-full rounded-full border px-6 py-3 text-center text-xs font-semibold uppercase tracking-[0.32em] transition sm:w-auto ${
                              tierComingSoon
                                ? "cursor-not-allowed border-white/15 bg-white/5 text-slate-500"
                                : "border-gold-500/60 bg-gold-500 text-night-900 shadow-glow hover:bg-gold-400"
                            }`}
                          >
                            {tierComingSoon ? "Coming Soon" : "Choose Tier"}
                          </button>
                        </div>
                      </div>
                    </div>
                    {tierComingSoon && (
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[2rem] bg-gold-500/12 backdrop-blur-[1px]">
                        <span className="rounded-full border border-gold-400/60 bg-night-900/80 px-6 py-2 text-xs uppercase tracking-[0.32em] text-gold-200 shadow-glow">
                          Coming Soon
                        </span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {step === "pick" && category && tier && (
        <section className="bg-night-900/80 py-20">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="uppercase tracking-[0.3em] text-violet-300">{category.label} · {tier.label}</p>
                <h2 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">Pick 1 of 9 packs</h2>
                <p className="text-sm text-slate-400">Every pack is sealed and randomized. Hover to inspect, then lock in your selection.</p>
              </div>
              <button
                type="button"
                onClick={() => handleReturn("tier")}
                className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                Change tier
              </button>
            </div>

            <div className="grid grid-cols-3 gap-4 sm:grid-cols-3 lg:grid-cols-3">
              {Array.from({ length: 9 }).map((_, index) => {
                const selected = selectedSlot === index;
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setSelectedSlot(index)}
                    className={`group relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-[2.1rem] border border-white/10 bg-slate-900/70 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold-500 ${
                      selected ? "border-gold-400/80 shadow-glow" : "hover:border-gold-300/40"
                    }`}
                  >
                    <Image
                      src={tier.image}
                      alt={`${tier.label} mystery pack ${index + 1}`}
                      fill
                      className={`object-cover transition duration-300 group-hover:scale-105 ${selected ? "scale-105" : ""}`}
                    />
                    <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-night-900/80 px-4 py-1 text-xs uppercase tracking-[0.3em] text-slate-200">
                      Slot {index + 1}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
              <p className="text-sm text-slate-400">
                Selected slot: <span className="text-white">{selectedSlot !== null ? `#${selectedSlot + 1}` : "Pick a pack"}</span>
              </p>
              <button
                type="button"
                onClick={proceedToCheckout}
                disabled={selectedSlot === null || ctaBusy || definitionsLoading}
                className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-slate-500"
              >
                {ctaBusy ? "Loading" : "Continue to checkout"}
              </button>
            </div>
          </div>
        </section>
      )}

      {step === "checkout" && category && tier && (
        <section className="bg-night-900/80 py-20">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <header>
                <p className="uppercase tracking-[0.3em] text-violet-300">Confirm your pack</p>
                <h2 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">Checkout</h2>
                <p className="text-sm text-slate-400">Slot #{(selectedSlot ?? 0) + 1} from the {category.label} machine · {tier.label}</p>
              </header>
              <button
                type="button"
                onClick={() => handleReturn("pick")}
                className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                Pick another pack
              </button>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-slate-900/60 p-8 shadow-card">
              <div className="flex flex-col gap-6 lg:flex-row">
                <div className="relative h-48 w-full overflow-hidden rounded-2xl border border-white/10 lg:w-60">
                  <Image src={tier.image} alt={`${tier.label} pack art`} fill className="object-cover" />
                </div>
                <div className="flex-1 space-y-4">
                  <div>
                    <h3 className="font-heading text-3xl uppercase tracking-[0.24em] text-white">{tier.label}</h3>
                    <p className="text-sm text-slate-400">Price · ${tier.price.toLocaleString()}</p>
                  </div>
                  <p className="text-sm text-slate-300">{tier.details}</p>
                  <details className="group rounded-2xl border border-white/5 bg-night-900/70">
                    <summary className="cursor-pointer list-none px-5 py-4 text-xs uppercase tracking-[0.32em] text-slate-300 transition group-open:text-gold-300">
                      Details & Odds
                    </summary>
                    <div className="space-y-3 px-5 pb-5 text-sm text-slate-300">
                      <p className="text-xs text-slate-400">Expected value ${tier.expectedValue.toLocaleString()}</p>
                      <ul className="grid gap-2 rounded-xl border border-white/5 bg-night-900/70 p-4 text-xs text-slate-200">
                        {tier.odds.length ? (
                          tier.odds.map((row) => (
                            <li key={row.range} className="flex items-center justify-between">
                              <span>{row.range}</span>
                              <span className="text-gold-300">{row.probability}</span>
                            </li>
                          ))
                        ) : (
                          <li className="text-slate-500">Odds available at launch.</li>
                        )}
                      </ul>
                      <p className="text-xs text-slate-500">
                        {tier.disclaimer}{" "}
                        <Link className="text-gold-400 underline" href="/terms">
                          Terms apply
                        </Link>
                        .
                      </p>
                    </div>
                  </details>
                </div>
              </div>

              <div className="mt-6 border-t border-white/10 pt-6">
                <h4 className="text-xs uppercase tracking-[0.3em] text-slate-400">Payment</h4>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("card")}
                    className={`rounded-2xl border px-5 py-4 text-left transition ${
                      paymentMethod === "card"
                        ? "border-gold-400/80 bg-gold-500/10 text-gold-200"
                        : "border-white/10 bg-night-900/70 text-slate-200 hover:border-white/20"
                    }`}
                  >
                    <span className="block text-xs uppercase tracking-[0.3em]">Credit / Debit</span>
                    <span className="mt-2 block text-sm text-slate-300">Tap to pay on machine · Receipts stored to your account.</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("tkd")}
                    className={`rounded-2xl border px-5 py-4 text-left transition ${
                      paymentMethod === "tkd"
                        ? "border-gold-400/80 bg-gold-500/10 text-gold-200"
                        : "border-white/10 bg-night-900/70 text-slate-200 hover:border-white/20"
                    }`}
                  >
                    <span className="block text-xs uppercase tracking-[0.3em]">Pay with TKD</span>
                    <span className="mt-2 block text-sm text-slate-300">Closed-loop wallet balance applies instantly.</span>
                  </button>
                </div>
                {paymentMethod === "card" && (
                  <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-night-900/60 p-4">
                    {stripeIntent ? (
                      <>
                        <p className="text-xs text-slate-300">
                          Enter your card details to confirm. Charges capture automatically once Stripe verifies the payment.
                        </p>
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <StripeCheckout
                            clientSecret={stripeIntent.clientSecret}
                            paymentIntentId={stripeIntent.paymentIntentId}
                            onSuccess={finalizeStripePayment}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-slate-300">
                        Tap “Start Card Checkout” to secure this pack and open the payment form.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
                <p className="text-xs text-slate-500">
                  TKD buyback guarantee at {Math.round(BUYBACK_RATE * 100)}% of market value. See {" "}
                  <Link className="text-gold-400 underline" href="/terms">
                    Terms
                  </Link>
                  .
                </p>
                <button
                  type="button"
                  onClick={completePurchase}
                  className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-white/10 disabled:text-slate-500"
                  disabled={ctaBusy || (paymentMethod === "card" && stripeIntent !== null)}
                >
                  {ctaBusy
                    ? "Processing…"
                    : paymentMethod === "card"
                      ? stripeIntent
                        ? "Card checkout ready"
                        : "Start Card Checkout"
                      : "Use TKD Balance"}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {step === "reveal" && reveal && tier && category && (
        <section ref={revealSectionRef} className="bg-night-900/85 py-20">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="uppercase tracking-[0.3em] text-violet-300">Your pull</p>
                <h2 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">{reveal.name}</h2>
                <p className="text-sm text-slate-400">{category.label} · {tier.label}</p>
              </div>
              <button
                type="button"
                onClick={() => handleReturn("category")}
                className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                Rip another pack
              </button>
            </div>

            <div className="overflow-hidden rounded-[2.5rem] border border-white/10 bg-slate-900/70 shadow-card">
              <div className="grid gap-0 md:grid-cols-[320px_1fr]">
                <div className="relative h-80 md:h-full">
                  <Image src={reveal.image} alt={reveal.name} fill className="object-cover" />
                </div>
                <div className="space-y-6 p-8">
                  <p className="whitespace-pre-line text-sm text-slate-300">{reveal.description}</p>
                  <div className="rounded-2xl border border-white/5 bg-night-900/70 p-5">
                    <dl className="grid gap-3 text-sm text-slate-200">
                      <div className="flex items-center justify-between">
                        <dt>Market Value</dt>
                        <dd className="text-gold-300">{formatTkd(reveal.valueMinor)}</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt>Instant Buyback ({Math.round(BUYBACK_RATE * 100)}%)</dt>
                        <dd className="text-gold-300">{formatTkd(Math.round(reveal.valueMinor * BUYBACK_RATE))}</dd>
                      </div>
                    </dl>
                  </div>
                  {hasNormalizedFacts ? (
                    <div className="rounded-2xl border border-white/5 bg-night-900/70 p-5">
                      <p className="text-[10px] uppercase tracking-[0.28em] text-sky-300">Normalized Metadata</p>
                      <div className="mt-3 grid gap-4 md:grid-cols-2">
                        {normalizedFactSections.map((section) => (
                          <div
                            key={section.key}
                            className="rounded-xl border border-white/5 bg-night-900/60 p-4"
                          >
                            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">{section.title}</p>
                            <dl className="mt-3 space-y-2 text-xs">
                              {section.facts.map((fact) => (
                                <div
                                  key={`${section.key}-${fact.label}-${fact.value}`}
                                  className="flex items-start justify-between gap-3"
                                >
                                  <dt className="text-slate-400">{fact.label}</dt>
                                  <dd className="max-w-[60%] break-words text-right text-slate-100">{fact.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        ))}
                        {normalizedFacts.links.length ? (
                          <div className="rounded-xl border border-white/5 bg-night-900/60 p-4">
                            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-400">Research Links</p>
                            <ul className="mt-3 space-y-2 text-xs">
                              {normalizedFacts.links.map((link) => (
                                <li key={`${link.label}-${link.href}`}>
                                  <a
                                    href={link.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sky-300 transition hover:text-sky-100"
                                  >
                                    {link.label}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={acceptBuyback}
                      className="rounded-full border border-gold-500/60 bg-gold-500 px-7 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-white/10 disabled:text-slate-500"
                      disabled={
                        !reveal.buybackAvailable ||
                        reveal.buybackAccepted ||
                        buybackBusy ||
                        resolution === "collection"
                      }
                    >
                      {reveal.buybackAccepted ? "Buyback accepted" : buybackBusy ? "Processing…" : "Accept buyback"}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveToCollection}
                      className={`rounded-full border px-7 py-3 text-xs uppercase tracking-[0.3em] transition ${
                        resolution === "collection"
                          ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
                          : "border-white/20 text-slate-300 hover:border-white/40 hover:text-white"
                      }`}
                      disabled={resolution === "collection" || reveal.buybackAccepted}
                    >
                      {resolution === "collection" ? "Saved to collection" : "Save to collection"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {activePack?.slots?.length ? (
              <div className="rounded-[2rem] border border-white/10 bg-slate-900/60 p-6 shadow-card">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Pack Slots</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {activePack.slots.map((slot: any, index: number) => {
                    const item = slot.item ?? null;
                    const estimated = Number(item?.estimatedValue ?? item?.marketValue ?? 0);
                    const sold = Boolean(slot.sold);
                    const position = (slot.position ?? slot.index ?? index) + 1;
                    return (
                      <div key={slot.id ?? index} className="rounded-2xl border border-white/10 bg-night-900/70 p-4">
                        <div className="flex items-center justify-between text-xs text-slate-400">
                          <span>Slot {position}</span>
                          <span>{sold ? "Transferred" : "Available"}</span>
                        </div>
                        <h3 className="mt-2 text-sm text-white">{item?.name ?? "Vaulted Item"}</h3>
                        <p className="text-xs text-slate-500">{item?.set}{item?.number ? ` · ${item.number}` : ""}</p>
                        <p className="mt-2 text-xs text-slate-300">
                          Value: {estimated > 0 ? formatTkd(estimated) : "—"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {showRevealModal && reveal && (
        <RevealModal
          reveal={reveal}
          stage={revealStage}
          onClose={closeRevealModal}
          onAcceptBuyback={acceptBuyback}
          onSaveToCollection={handleSaveToCollection}
          buybackBusy={buybackBusy}
          canAcceptBuyback={reveal.buybackAvailable && !reveal.buybackAccepted}
          buybackAccepted={reveal.buybackAccepted}
          collectionSaved={resolution === "collection"}
        />
      )}
    </AppShell>
  );
}
