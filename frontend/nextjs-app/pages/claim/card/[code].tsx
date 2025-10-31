import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../../../hooks/useSession";

interface ClaimUserSummary {
  id: string;
  displayName: string | null;
  phone: string | null;
}

interface ClaimSessionSummary {
  id: string;
  status: string;
  claimStatus: string | null;
  claimedBy: ClaimUserSummary | null;
}

interface ClaimPackSummary {
  id: string;
  definitionName: string | null;
  definitionTier: string | null;
  locationId: string | null;
  locationName: string | null;
}

interface ClaimItemSummary {
  id: string;
  name: string | null;
  set: string | null;
  number: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  status: string;
  ownerId: string | null;
  estimatedValue: number | null;
}

interface ClaimCodeSummary {
  id: string;
  code: string;
  serial: string | null;
  pairId: string | null;
  state: string;
}

interface ClaimCardRecord {
  code: ClaimCodeSummary;
  item: ClaimItemSummary | null;
  pack: ClaimPackSummary | null;
  session: ClaimSessionSummary | null;
  claimStatus: string | null;
}

const formatCurrency = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const minorUnits = value;
  const dollars = minorUnits / 100;
  return dollars.toLocaleString(undefined, { style: "currency", currency: "USD" });
};

export default function ClaimCardPage() {
  const router = useRouter();
  const { session, ensureSession, loading: sessionLoading } = useSession();
  const { code } = router.query;

  const [record, setRecord] = useState<ClaimCardRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState(false);

  useEffect(() => {
    if (!code || typeof code !== "string") {
      return;
    }

    let aborted = false;
    setLoading(true);
    setError(null);

    fetch(`/api/claim/card/${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Card not found");
        }
        return (await res.json()) as { card: ClaimCardRecord };
      })
      .then((payload) => {
        if (!aborted) {
          setRecord(payload.card);
          setClaimSuccess(false);
          setClaimError(null);
        }
      })
      .catch((fetchError) => {
        if (!aborted) {
          const message = fetchError instanceof Error ? fetchError.message : "Unable to load card";
          setError(message);
          setRecord(null);
        }
      })
      .finally(() => {
        if (!aborted) {
          setLoading(false);
        }
      });

    return () => {
      aborted = true;
    };
  }, [code]);

  const ownershipStatus = useMemo(() => {
    if (!record) {
      return "unknown";
    }
    if (!record.item) {
      return "unbound";
    }
    if (record.session?.claimStatus === "CLAIMED" && record.session.claimedBy?.id) {
      return record.session.claimedBy.id === session?.user.id ? "claimed-by-you" : "claimed";
    }
    if (record.item.ownerId && record.item.ownerId === session?.user.id) {
      return "owned-by-you";
    }
    return "available";
  }, [record, session?.user.id]);

  const cardTitle = useMemo(() => {
    if (!record?.item) {
      return "Ten Kings Mystery Pack";
    }
    const parts = [record.item.name, record.item.set, record.item.number].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : "Ten Kings Mystery Pack";
  }, [record]);

  const packLabel = useMemo(() => {
    if (!record?.pack) {
      return "Online";
    }
    const parts = [record.pack.definitionName, record.pack.locationName].filter(Boolean);
    return parts.length > 0 ? parts.join(" @ ") : record.pack.definitionName ?? "Pack";
  }, [record]);

  const handleClaim = async () => {
    if (!record || claimSuccess) {
      return;
    }
    try {
      const activeSession = await ensureSession();
      setClaiming(true);
      setClaimError(null);

      const response = await fetch(`/api/claim/card/${encodeURIComponent(record.code.code)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.token}`,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Unable to claim this card");
      }

      const payload = (await response.json()) as { card: ClaimCardRecord };
      setRecord(payload.card);
      setClaimSuccess(true);
    } catch (claimErr) {
      const message = claimErr instanceof Error ? claimErr.message : "Unable to claim this card";
      setClaimError(message);
    } finally {
      setClaiming(false);
    }
  };

  const actionable =
    record &&
    (ownershipStatus === "available" || ownershipStatus === "owned-by-you" || ownershipStatus === "claimed-by-you");

  const showClaimButton =
    record &&
    (ownershipStatus === "available" || ownershipStatus === "owned-by-you") &&
    record.session?.claimStatus !== "CLAIMED";

  const estimatedValue = formatCurrency(record?.item?.estimatedValue);

  return (
    <div className="min-h-screen bg-night-950 text-white">
      <Head>
        <title>{loading ? "Claim card" : `${cardTitle} · Claim`} | Ten Kings</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12">
        <header className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Claim your rip</p>
          <h1 className="font-heading text-3xl uppercase tracking-[0.18em] text-white">{cardTitle}</h1>
          <p className="text-sm text-slate-300">Pack: {packLabel}</p>
        </header>

        {loading && <p className="text-sm text-slate-400">Loading card details…</p>}

        {!loading && error && (
          <div className="rounded-3xl border border-rose-400/40 bg-rose-500/10 p-6 text-sm text-rose-200">
            <p>{error}</p>
            <p className="mt-3 text-xs text-rose-300">Check that you scanned the correct QR code or contact Ten Kings support.</p>
          </div>
        )}

        {!loading && !error && record && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/60 p-6">
              <div className="flex flex-col items-center gap-4">
                {record.item?.imageUrl ? (
                  <div className="relative h-80 w-full max-w-xs overflow-hidden rounded-3xl border border-white/10 bg-night-950 shadow-lg">
                    <Image
                      src={record.item.imageUrl}
                      alt={record.item.name ?? "Card image"}
                      fill
                      className="object-cover"
                      sizes="320px"
                    />
                  </div>
                ) : (
                  <div className="flex h-80 w-full max-w-xs items-center justify-center rounded-3xl border border-white/10 bg-night-950 text-sm text-slate-500">
                    Card scan pending
                  </div>
                )}

                <div className="w-full rounded-2xl border border-white/10 bg-night-900/80 p-4 text-xs text-slate-300">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">QR Code</p>
                  <p className="mt-1 break-all font-mono text-slate-200">{record.code.code}</p>
                  {record.code.serial && <p className="text-[11px] text-slate-500">Serial: {record.code.serial}</p>}
                  {record.code.pairId && <p className="text-[11px] text-slate-500">Pair: {record.code.pairId}</p>}
                  <p className="mt-2 text-[11px] text-slate-500">State: {record.code.state}</p>
                </div>
              </div>

              {estimatedValue && (
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                  Estimated value: {estimatedValue}
                </div>
              )}

              <div className="rounded-2xl border border-white/10 bg-night-900/80 p-4 text-xs text-slate-300">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Pack</p>
                <dl className="mt-2 space-y-2">
                  <div>
                    <dt className="text-[11px] text-slate-500">Definition</dt>
                    <dd>{record.pack?.definitionName ?? "TBD"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-slate-500">Tier</dt>
                    <dd>{record.pack?.definitionTier ?? "Unknown"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-slate-500">Location</dt>
                    <dd>{record.pack?.locationName ?? "Online"}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Status</p>
                <h2 className="mt-2 text-lg font-semibold text-white">
                  {ownershipStatus === "claimed-by-you"
                    ? "Already claimed"
                    : ownershipStatus === "claimed"
                    ? "Claimed by another collector"
                    : ownershipStatus === "owned-by-you"
                    ? "Added to your vault"
                    : ownershipStatus === "available"
                    ? "Ready to claim"
                    : "Pending"}
                </h2>
                <p className="mt-3 text-sm text-slate-300">
                  {ownershipStatus === "claimed"
                    ? "Someone else has registered this card. Reach out to Ten Kings support if this is unexpected."
                    : ownershipStatus === "claimed-by-you"
                    ? "This card is already in your collection."
                    : ownershipStatus === "owned-by-you"
                    ? "You already own this card. Claiming again keeps it tied to your account."
                    : ownershipStatus === "available"
                    ? "Claim the card to link it to your Ten Kings account, track value, and receive buyback offers."
                    : record?.item
                    ? "Waiting for operator review. Check back once the card has been processed."
                    : "We haven't matched this QR code to a card yet. Ask the kiosk attendant to complete the rip."
                  }
                </p>
              </div>

              {showClaimButton && (
                <button
                  type="button"
                  onClick={handleClaim}
                  disabled={claiming}
                  className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 px-6 py-3 text-xs font-semibold uppercase tracking-[0.34em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {claiming ? "Claiming…" : "Claim this card"}
                </button>
              )}

              {claimError && (
                <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-xs text-rose-200">
                  {claimError}
                </div>
              )}

              {claimSuccess && (
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-xs text-emerald-200">
                  Card claimed! Head to <Link href="/collection" className="underline">My Collection</Link> to view it.
                </div>
              )}

              {!session && !sessionLoading && actionable && (
                <div className="rounded-2xl border border-white/10 bg-night-900/70 p-4 text-xs text-slate-300">
                  <p className="font-semibold text-white">Need an account?</p>
                  <p className="mt-2 text-slate-400">
                    Claiming requires a Ten Kings login so we know where to send wallet credits and future buyback offers.
                  </p>
                  <button
                    type="button"
                    onClick={() => ensureSession().catch(() => undefined)}
                    className="mt-3 inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                  >
                    Sign in to continue
                  </button>
                </div>
              )}

              <div className="rounded-3xl border border-white/10 bg-night-900/60 p-6 text-xs text-slate-300">
                <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Next steps</p>
                <ol className="mt-3 space-y-2 list-decimal pl-4">
                  <li>Hold onto the physical card or hand it to the kiosk attendant if you choose a buyback.</li>
                  <li>Track value updates inside your Ten Kings collection.</li>
                  <li>Watch for TKD rewards and live rip replays tied to this card.</li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
