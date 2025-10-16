import Head from "next/head";
import Image from "next/image";
import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { listListings, purchaseListing } from "../lib/api";
import { useSession } from "../hooks/useSession";
import { formatTkd } from "../lib/formatters";

const BUYBACK_RATE = 0.75;
const formatDate = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : "—");

export default function Marketplace() {
  const { ensureSession, session } = useSession();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const { listings } = await listListings();
      setListings(listings);
      setFeedback(null);
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Unable to load listings" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const handlePurchase = async (listingId: string) => {
    try {
      const activeSession = await ensureSession();
      setFeedback(null);
      await purchaseListing(listingId, activeSession.user.id);
      setFeedback({ type: "success", text: `Purchased listing ${listingId}` });
      await load();
    } catch (error) {
      setFeedback({ type: "error", text: error instanceof Error ? error.message : "Purchase failed" });
    }
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Vault Marketplace</title>
        <meta name="description" content="Browse vaulted collectibles and buy instantly with Ten Kings Dollars." />
      </Head>

      <section className="bg-night-900/75 py-16">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6">
          <header className="space-y-4">
            <p className="uppercase tracking-[0.3em] text-violet-300">Instant settlement • Vault protected</p>
            <h1 className="font-heading text-5xl uppercase tracking-[0.16em] text-white">Ten Kings Marketplace</h1>
            <p className="max-w-3xl text-sm text-slate-300">
              Every listing is already in the Ten Kings vault. When you buy, ownership updates instantly and the collectible moves to your collection—no
              shipping required.
            </p>
          </header>

          {feedback && (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                feedback.type === "error"
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              }`}
            >
              {feedback.text}
            </div>
          )}

          <div className="grid gap-6 rounded-[2rem] border border-white/10 bg-slate-900/60 p-6 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                {loading ? "Loading listings…" : `${listings.length} active listings`}
              </p>
              {session && (
                <p className="text-xs text-slate-400">
                  Wallet balance · <span className="text-gold-300">{formatTkd(session.wallet.balance)}</span>
                </p>
              )}
            </div>

            {listings.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-night-900/70 py-16 text-center">
                <p className="font-heading text-3xl uppercase tracking-[0.2em] text-white">Vault is restocking</p>
                <p className="max-w-md text-sm text-slate-400">
                  Approvals are processing. As soon as new chases clear authentication, they’ll surface here with instant buyback options.
                </p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {listings.map((listing) => {
                  const item = listing.item ?? null;
                  const price = listing.price ?? 0;
                  const estimated = item?.estimatedValue ?? null;
                  const buybackBase = estimated !== null ? estimated : price;
                  const buybackOffer = buybackBase > 0 ? Math.floor(buybackBase * BUYBACK_RATE) : 0;

                  return (
                    <article
                      key={listing.id}
                      className="flex flex-col gap-5 rounded-[1.75rem] border border-white/10 bg-night-900/65 p-6 transition hover:border-gold-400/60"
                    >
                      <div className="relative h-48 overflow-hidden rounded-2xl border border-white/10">
                        <Image
                          src={item?.imageUrl ?? "/images/card-pull-1.png"}
                          alt={item?.name ?? "Vaulted collectible"}
                          fill
                          className="object-cover"
                        />
                      </div>
                      <div className="space-y-2">
                        <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">{item?.name ?? "Vaulted Collectible"}</h2>
                        <p className="text-xs text-slate-400">
                          Listing #{listing.id} · Updated {formatDate(listing.updatedAt ?? listing.createdAt)}
                        </p>
                      </div>
                      <dl className="grid gap-3 text-xs text-slate-300">
                        <div className="flex items-center justify-between">
                          <dt>Price</dt>
                          <dd className="text-gold-300">{formatTkd(price)}</dd>
                        </div>
                        {item?.set && (
                          <div className="flex items-center justify-between">
                            <dt>Set · No.</dt>
                            <dd>
                              {item.set}
                              {item.number ? ` · ${item.number}` : ""}
                            </dd>
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <dt>Instant buyback ({Math.round(BUYBACK_RATE * 100)}%)</dt>
                          <dd className="text-gold-300">{buybackOffer > 0 ? formatTkd(buybackOffer) : "Unavailable"}</dd>
                        </div>
                      </dl>

                      <button
                        type="button"
                        onClick={() => handlePurchase(listing.id)}
                        disabled={listing.status !== "ACTIVE"}
                        className="mt-auto rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-white/5 disabled:text-slate-500"
                      >
                        {listing.status === "ACTIVE" ? "Buy now with TKD" : listing.status}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
