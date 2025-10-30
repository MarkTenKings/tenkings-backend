import Head from "next/head";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import AppShell from "../components/AppShell";
import { useSession } from "../hooks/useSession";
import { buybackItem } from "../lib/api";

class AuthFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthFailure";
  }
}

const PROCESSING_FEE_MINOR = Number(process.env.NEXT_PUBLIC_SHIPPING_PROCESSING_FEE_MINOR ?? "1200");
const BUYBACK_RATE = 0.75;

interface ShippingRequestSummary {
  id: string;
  status: string;
  processingFeeMinor: number;
  shippingFeeMinor: number;
  totalFeeMinor: number;
  notes: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CollectionItem {
  id: string;
  name: string;
  set: string;
  number: string | null;
  language: string | null;
  foil: boolean;
  estimatedValue: number | null;
  status: string;
  vaultLocation: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  pack: {
    packId: string;
    definitionId: string;
    definitionName: string | null;
    tier: string | null;
    category: string | null;
  } | null;
  shippingRequest: ShippingRequestSummary | null;
}

interface ShippingFormState {
  recipientName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
  shippingFee: string;
  notes: string;
}

const initialForm: ShippingFormState = {
  recipientName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "United States",
  phone: "",
  email: "",
  shippingFee: "0",
  notes: "",
};

const toMinor = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.round(parsed * 100);
};

const formatMinor = (value: number | null) => {
  if (!value) {
    return "—";
  }
  return `${(value / 100).toFixed(2)} TKD`;
};

const placeholderCardImage = "/images/card-pull-1.png";

export default function CollectionPage() {
  const { session, loading, ensureSession, updateWalletBalance, logout } = useSession();
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [form, setForm] = useState<ShippingFormState>(initialForm);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [modalItem, setModalItem] = useState<CollectionItem | null>(null);
  const [showShippingForm, setShowShippingForm] = useState(false);
  const [confirmBuybackItem, setConfirmBuybackItem] = useState<CollectionItem | null>(null);
  const [buybackBusyItems, setBuybackBusyItems] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const processingFeeDisplay = useMemo(
    () => `${(PROCESSING_FEE_MINOR / 100).toFixed(2)} TKD`,
    []
  );

  const walletBalanceDisplay = useMemo(
    () => `${((session?.wallet.balance ?? 0) / 100).toFixed(2)} TKD`,
    [session?.wallet.balance]
  );

  const segments = useMemo(() => {
    const shipped: CollectionItem[] = [];
    const sold: CollectionItem[] = [];
    const owned: CollectionItem[] = [];

    items.forEach((item) => {
      const shippingStatus = item.shippingRequest?.status ?? null;
      const isShipped = shippingStatus === "SHIPPED";
      const isSold = item.status === "SOLD" || item.status === "REDEEMED";

      if (isShipped) {
        shipped.push(item);
        return;
      }

      if (isSold) {
        sold.push(item);
        return;
      }

      owned.push(item);
    });

    return { owned, sold, shipped };
  }, [items]);

  const { owned, sold, shipped } = segments;
  const totals = useMemo(() => {
    const ownedValue = owned.reduce((sum, item) => sum + (item.estimatedValue ?? 0), 0);
    const soldValue = sold.reduce((sum, item) => sum + (item.estimatedValue ?? 0), 0);
    return {
      ownedCount: owned.length,
      ownedValue,
      soldCount: sold.length,
      soldValue,
      shippedCount: shipped.length,
      totalCount: items.length,
    };
  }, [owned, sold, shipped, items]);

  const openItemModal = (item: CollectionItem) => {
    setModalItem(item);
    setSelectedItemId(item.id);
    setForm(initialForm);
    setFormError(null);
    setFormSuccess(null);
    setShowShippingForm(false);
  };

  const closeItemModal = () => {
    setModalItem(null);
    setSelectedItemId(null);
    setForm(initialForm);
    setFormError(null);
    setFormSuccess(null);
    setShowShippingForm(false);
  };

  const getItemImage = (item: CollectionItem) => item.thumbnailUrl ?? item.imageUrl ?? placeholderCardImage;

  const renderSection = (
    title: string,
    subtitle: string,
    data: CollectionItem[],
    emptyMessage: string
  ) => (
    <section key={title} className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">{title}</h2>
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">{data.length} cards</span>
        </div>
        <p className="text-sm text-slate-400">{subtitle}</p>
      </div>
      {data.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-night-900/60 px-6 py-8 text-center text-sm text-slate-400">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((item) => {
            const shippingStatus = item.shippingRequest?.status ?? null;
            const hasPendingShipment = shippingStatus && shippingStatus !== "SHIPPED" && shippingStatus !== "CANCELLED";
            const badgeLabel = shippingStatus === "SHIPPED" ? "Shipped" : item.status.replace(/_/g, " ");
            const cardEstimatedBuyback = item.estimatedValue ? Math.round(item.estimatedValue * BUYBACK_RATE) : null;
            const busy = Boolean(buybackBusyItems[item.id]);
            const buybackDisabled = busy || hasPendingShipment || item.status === "SOLD" || item.status === "REDEEMED";
            const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openItemModal(item);
              }
            };

            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => openItemModal(item)}
                onKeyDown={handleKeyDown}
                className="group flex cursor-pointer flex-col gap-3 rounded-3xl border border-white/10 bg-night-900/70 p-4 text-left transition hover:border-gold-400/40 hover:shadow-glow-gold"
              >
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-night-900/80">
                  <div className="relative aspect-[3/4]">
                    <Image src={getItemImage(item)} alt={item.name} fill className="object-cover" sizes="(min-width: 1024px) 240px, 40vw" />
                  </div>
                  {hasPendingShipment && (
                    <span className="absolute left-3 top-3 rounded-full bg-amber-500/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.28em] text-night-900">
                      Shipping pending
                    </span>
                  )}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.32em] text-slate-500">#{item.id.slice(0, 8)}</p>
                    <h3 className="font-heading text-lg uppercase tracking-[0.18em] text-white group-hover:text-gold-200">{item.name}</h3>
                    <p className="text-xs text-slate-400">{item.set}{item.number ? ` · ${item.number}` : ""}</p>
                  </div>
                  <span className="rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-300">
                    {badgeLabel}
                  </span>
                </div>
                <dl className="grid gap-1 text-xs text-slate-400">
                  <div className="flex justify-between">
                    <dt>Vault value</dt>
                    <dd className="text-slate-200">{formatMinor(item.estimatedValue)}</dd>
                  </div>
                  {item.pack && (
                    <div className="flex justify-between">
                      <dt>Pack</dt>
                      <dd className="text-slate-200">{item.pack.definitionName ?? "Mystery Pack"}</dd>
                    </div>
                  )}
                  {shippingStatus && (
                    <div className="flex justify-between">
                      <dt>Shipping</dt>
                      <dd className="text-slate-200">{shippingStatus}</dd>
                    </div>
                  )}
                </dl>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                    {cardEstimatedBuyback ? `Buyback ${formatMinor(cardEstimatedBuyback)}` : "Instant buyback"}
                  </span>
                  <button
                    type="button"
                    onClick={(event: MouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation();
                      setConfirmBuybackItem(item);
                    }}
                    className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={buybackDisabled}
                  >
                    {busy ? "Processing…" : buybackDisabled ? "Unavailable" : "Instant buyback"}
                  </button>
                </div>
                <span className="text-xs uppercase tracking-[0.3em] text-gold-300">View details</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );

  const loadItems = useCallback(async () => {
    if (!session) {
      return;
    }

    const runFetch = async (token: string) => {
      const res = await fetch("/api/collection", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        const payload = await res.json().catch(() => ({}));
        throw new AuthFailure(payload?.message ?? "Session expired");
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to load collection");
      }

      const payload = (await res.json()) as { items: CollectionItem[] };
      setItems(payload.items);
    };

    setItemsLoading(true);
    setItemsError(null);

    try {
      await runFetch(session.token);
    } catch (error) {
      if (error instanceof AuthFailure) {
        logout();
        try {
          const refreshed = await ensureSession();
          await runFetch(refreshed.token);
          setItemsError(null);
          return;
        } catch (refreshError) {
          const message =
            refreshError instanceof Error && refreshError.message !== "Authentication cancelled"
              ? refreshError.message
              : "Sign in to view your collection";
          setItemsError(message);
          return;
        }
      }

      const message = error instanceof Error ? error.message : "Failed to load collection";
      setItemsError(message);
    } finally {
      setItemsLoading(false);
    }
  }, [ensureSession, logout, session]);

  const handleInstantBuyback = useCallback(
    async (item: CollectionItem): Promise<boolean> => {
      if (item.status === "SOLD" || item.status === "REDEEMED") {
        setFlash({ type: "error", text: "Instant buyback already completed for this card." });
        return false;
      }

      let activeSession = session;
      if (!activeSession) {
        try {
          activeSession = await ensureSession();
        } catch (error) {
          if (error instanceof Error && error.message === "Authentication cancelled") {
            return false;
          }
          setFlash({ type: "error", text: "Sign in to accept instant buybacks." });
          return false;
        }
      }

      if (!activeSession) {
        return false;
      }

      setBuybackBusyItems((prev) => ({ ...prev, [item.id]: true }));

      try {
        const result = await buybackItem(item.id, activeSession.user.id);
        updateWalletBalance(result.walletBalance);
        setItems((prev) =>
          prev.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  status: "SOLD",
                }
              : entry
          )
        );
        setModalItem((prev) =>
          prev && prev.id === item.id
            ? {
                ...prev,
                status: "SOLD",
              }
            : prev
        );
        setFlash({
          type: "success",
          text: `Instant buyback credited ${formatMinor(result.buybackAmount)} to your wallet.`,
        });
        return true;
      } catch (error) {
        if (error instanceof Error && /session/i.test(error.message)) {
          logout();
          try {
            await ensureSession();
            setFlash({ type: "info", text: "Session refreshed. Try the instant buyback again." });
          } catch (reauthError) {
            const message =
              reauthError instanceof Error && reauthError.message !== "Authentication cancelled"
                ? reauthError.message
                : "Sign in to accept instant buybacks.";
            setFlash({ type: "error", text: message });
          }
          return false;
        }
        const message = error instanceof Error ? error.message : "Instant buyback failed";
        setFlash({ type: "error", text: message });
        return false;
      } finally {
        setBuybackBusyItems((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      }
    },
    [ensureSession, logout, session, updateWalletBalance]
  );

  useEffect(() => {
    if (loading) {
      return;
    }
    if (!session) {
      ensureSession().catch(() => undefined);
      return;
    }
    loadItems().catch(() => undefined);
  }, [ensureSession, loadItems, loading, session]);

  useEffect(() => {
    if (!flash) {
      return;
    }
    const timeout = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [flash]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || !selectedItemId) {
      return;
    }
    setFormBusy(true);
    setFormError(null);
    setFormSuccess(null);

    const shippingFeeMinor = toMinor(form.shippingFee);

    try {
      const res = await fetch(`/api/collection/${selectedItemId}/shipping-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          recipientName: form.recipientName,
          addressLine1: form.addressLine1,
          addressLine2: form.addressLine2 || undefined,
          city: form.city,
          state: form.state || undefined,
          postalCode: form.postalCode,
          country: form.country,
          phone: form.phone || undefined,
          email: form.email || undefined,
          shippingFeeMinor,
          notes: form.notes || undefined,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to request shipping");
      }

      const payload = (await res.json()) as {
        request: ShippingRequestSummary;
        walletBalance: number;
      };

      updateWalletBalance(payload.walletBalance);
      setItems((prev) =>
        prev.map((item) =>
          item.id === selectedItemId
            ? { ...item, status: "IN_TRANSFER", shippingRequest: payload.request }
            : item
        )
      );
      setModalItem((prev) =>
        prev && prev.id === selectedItemId
          ? { ...prev, status: "IN_TRANSFER", shippingRequest: payload.request }
          : prev
      );
      setShowShippingForm(false);
      setFormSuccess("Shipping request submitted. Our vault team will process it shortly.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to request shipping";
      setFormError(message);
    } finally {
      setFormBusy(false);
    }
  };



  if (loading) {
    return (
      <AppShell>
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-400">Loading…</p>
        </div>
      </AppShell>
    );
  }

  if (!session) {
    return (
      <AppShell>
        <div className="flex min-h-screen items-center justify-center">
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
          >
            Sign in to view your collection
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · My Collection</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-[0.32em] text-violet-300">Vault</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">My Collection</h1>
          <p className="text-sm text-slate-400">
            Track every pull you own, monitor shipped and sold hits, and request delivery straight from the Ten Kings vault.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">TKD Wallet</p>
            <p className="mt-2 text-3xl font-semibold text-gold-300">{walletBalanceDisplay}</p>
            <p className="mt-2 text-xs text-slate-500">Instant buybacks and redemptions update this balance automatically.</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Active Collectibles</p>
            <p className="mt-2 text-3xl font-semibold text-white">{totals.ownedCount}</p>
            <p className="mt-2 text-xs text-slate-500">Market value {formatMinor(totals.ownedValue)}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Sold / Redeemed</p>
            <p className="mt-2 text-3xl font-semibold text-white">{totals.soldCount}</p>
            <p className="mt-2 text-xs text-slate-500">Value moved to TKD {totals.soldValue ? formatMinor(totals.soldValue) : "—"}</p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Shipped Home</p>
            <p className="mt-2 text-3xl font-semibold text-white">{totals.shippedCount}</p>
            <p className="mt-2 text-xs text-slate-500">Completed deliveries from the vault.</p>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Shipping Processing Fee</p>
          <p className="mt-2 text-2xl font-semibold text-white">{processingFeeDisplay}</p>
          <p className="mt-2 text-xs text-slate-500">Added once per shipment. Set your own additional shipping fee during checkout.</p>
        </div>

        {flash && (
          <div
            className={`rounded-2xl border px-6 py-4 text-sm ${
              flash.type === "success"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/40 bg-rose-500/10 text-rose-200"
            }`}
          >
            {flash.text}
          </div>
        )}

        {itemsError && (
          <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">
            {itemsError}
          </div>
        )}

        {itemsLoading ? (
          <div className="rounded-3xl border border-white/10 bg-night-900/60 px-6 py-10 text-center text-sm text-slate-400">
            Loading collection…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-night-900/60 px-6 py-10 text-center text-sm text-slate-400">
            You haven’t pulled any cards yet. Open a mystery pack to get started!
          </div>
        ) : (
          <div className="space-y-12">
            {renderSection(
              "Vaulted cards",
              "Cards currently stored with Ten Kings. Tap a card to view details, SportsDB intel, and request shipping.",
              owned,
              "No vaulted cards yet—rip a pack to add something special to your collection."
            )}
            {renderSection(
              "Shipped",
              "Cards that have already been dispatched from the vault.",
              shipped,
              "No shipments yet. Once a request is fulfilled it will appear here."
            )}
            {renderSection(
              "Sold / Redeemed",
              "Cards you’ve sold or redeemed through Ten Kings.",
              sold,
              "You haven’t sold or redeemed any cards yet."
            )}
          </div>
        )}
      </div>

      {modalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10">
          <div className="absolute inset-0 bg-black/70" onClick={closeItemModal} />
          <div className="relative z-10 w-full max-w-4xl rounded-3xl border border-white/10 bg-night-900/95 shadow-2xl">
            <button
              type="button"
              onClick={closeItemModal}
              className="absolute right-4 top-4 rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
            >
              Close
            </button>
            <div className="grid gap-6 md:grid-cols-[300px_1fr]">
              <div className="relative">
                <div className="relative m-6 overflow-hidden rounded-3xl border border-white/10 bg-night-900/70">
                  <div className="relative aspect-[3/4]">
                    <Image src={getItemImage(modalItem)} alt={modalItem.name} fill className="object-cover" sizes="(min-width: 768px) 300px, 60vw" />
                  </div>
                </div>
              </div>
              <div className="space-y-6 p-6">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.32em] text-slate-500">#{modalItem.id.slice(0, 8)}</p>
                  <h2 className="font-heading text-3xl uppercase tracking-[0.2em] text-white">{modalItem.name}</h2>
                  <p className="text-sm text-slate-400">{modalItem.set}{modalItem.number ? ` · ${modalItem.number}` : ""}</p>
                  <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.3em] text-slate-300">
                    <span className="rounded-full border border-white/20 px-3 py-1">{modalItem.status.replace(/_/g, " ")}</span>
                    {modalItem.shippingRequest && <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-amber-200">Shipping {modalItem.shippingRequest.status}</span>}
                  </div>
                </div>

                <dl className="grid gap-2 text-sm text-slate-300">
                  <div className="flex justify-between">
                    <dt>Vault value</dt>
                    <dd className="text-gold-300">{formatMinor(modalItem.estimatedValue)}</dd>
                  </div>
                  {modalItem.pack && (
                    <div className="flex justify-between">
                      <dt>Pulled from</dt>
                      <dd>{modalItem.pack.definitionName ?? "Mystery Pack"}</dd>
                    </div>
                  )}
                  {modalItem.vaultLocation && (
                    <div className="flex justify-between">
                      <dt>Vault slot</dt>
                      <dd>{modalItem.vaultLocation}</dd>
                    </div>
                  )}
                  {modalItem.language && (
                    <div className="flex justify-between">
                      <dt>Language</dt>
                      <dd>{modalItem.language}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt>Foil</dt>
                    <dd>{modalItem.foil ? "Yes" : "No"}</dd>
                  </div>
                </dl>

                {(() => {
                  const rawDetails = modalItem.details as any;
                  const normalized = rawDetails?.normalized ?? null;
                  const sportsDetails =
                    normalized?.sport ?? rawDetails?.sport ?? rawDetails?.sports ?? rawDetails?.sportsDb ?? null;
                  if (!sportsDetails) {
                    return null;
                  }
                  return (
                    <div className="rounded-2xl border border-white/10 bg-night-900/60 p-4 text-sm text-slate-300">
                      <p className="text-xs uppercase tracking-[0.3em] text-violet-300">SportsDB Insight</p>
                      <p className="mt-2 font-semibold text-white">{sportsDetails.playerName ?? sportsDetails.name ?? "Player"}</p>
                      {sportsDetails.teamName && <p className="text-xs text-slate-400">{sportsDetails.teamName}</p>}
                      {sportsDetails.snapshot && (
                        <pre className="mt-3 max-h-40 overflow-auto rounded-xl border border-white/10 bg-night-900/80 p-3 text-xs text-slate-400">
{JSON.stringify(sportsDetails.snapshot, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })()}

                {modalItem.status !== "SOLD" && modalItem.status !== "REDEEMED" && (
                  (() => {
                    const estimate = modalItem.estimatedValue ? Math.round(modalItem.estimatedValue * BUYBACK_RATE) : null;
                    const busy = Boolean(buybackBusyItems[modalItem.id]);
                    const disabled = busy || Boolean(modalItem.shippingRequest);
                    return (
                      <button
                        type="button"
                        onClick={() => setConfirmBuybackItem(modalItem)}
                        className="w-full rounded-full border border-emerald-400/40 bg-emerald-500/20 px-6 py-3 text-xs uppercase tracking-[0.32em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={disabled}
                      >
                        {disabled
                          ? modalItem.shippingRequest
                            ? "Shipping in progress"
                            : "Buyback unavailable"
                          : busy
                            ? "Processing…"
                            : estimate
                              ? `Instant buyback ${formatMinor(estimate)}`
                              : "Instant buyback"}
                      </button>
                    );
                  })()
                )}

                {modalItem.shippingRequest && (
                  <div className="rounded-2xl border border-white/10 bg-night-900/60 p-4 text-sm text-slate-300">
                    <p className="text-xs uppercase tracking-[0.3em] text-emerald-300">Shipping request</p>
                    <p className="mt-2 text-xs text-slate-400">Status {modalItem.shippingRequest.status}</p>
                    <p className="text-xs text-slate-400">Processing fee {formatMinor(modalItem.shippingRequest.processingFeeMinor)}</p>
                    <p className="text-xs text-slate-400">Shipping fee {formatMinor(modalItem.shippingRequest.shippingFeeMinor)}</p>
                    {modalItem.shippingRequest.trackingNumber && (
                      <p className="text-xs text-slate-400">Tracking {modalItem.shippingRequest.carrier ?? ""} {modalItem.shippingRequest.trackingNumber}</p>
                    )}
                  </div>
                )}

                {!modalItem.shippingRequest && modalItem.status !== "SOLD" && modalItem.status !== "REDEEMED" && (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedItemId(modalItem.id);
                        setShowShippingForm((prev) => !prev);
                      }}
                      className="w-full rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
                    >
                      {showShippingForm ? "Hide shipping form" : "Request shipping"}
                    </button>
                    {showShippingForm && (
                      <form className="space-y-4" onSubmit={handleSubmit}>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="flex flex-col gap-2 text-xs">
                            <span className="text-slate-300">Recipient name</span>
                            <input
                              type="text"
                              required
                              value={form.recipientName}
                              onChange={(event) => setForm((prev) => ({ ...prev, recipientName: event.target.value }))}
                              className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                            />
                          </label>
                          <label className="flex flex-col gap-2 text-xs">
                            <span className="text-slate-300">Email</span>
                            <input
                              type="email"
                              value={form.email}
                              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                              className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                            />
                          </label>
                          <label className="flex flex-col gap-2 text-xs">
                            <span className="text-slate-300">Phone</span>
                            <input
                              type="tel"
                              value={form.phone}
                              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                              className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                            />
                          </label>
                          <label className="flex flex-col gap-2 text-xs">
                            <span className="text-slate-300">Address line 1</span>
                            <input
                              type="text"
                              required
                              value={form.addressLine1}
                              onChange={(event) => setForm((prev) => ({ ...prev, addressLine1: event.target.value }))}
                              className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                            />
                          </label>
                          <label className="flex flex-col gap-2 text-xs">
                            <span className="text-slate-300">Address line 2</span>
                            <input
                              type="text"
                              value={form.addressLine2}
                              onChange={(event) => setForm((prev) => ({ ...prev, addressLine2: event.target.value }))}
                              className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                            />
                          </label>
                          <label className="flex flex-col gap-2 text-xs">
                            <span className="text-slate-300">City</span>
                            <input
                              type="text"
                              required
                              value={form.city}
                              onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))}
                              className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                            />
                          </label>
                          <label className="flex flex-col gap-2 text-xs">
                            <span className="text-slate-300">State / region</span>
                            <input
                              type="text"
                              value={form.state}
                              onChange={(event) => setForm((prev) => ({ ...prev, state: event.target.value }))}
                              className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                            />
                          </label>
                          <label className="flex flex-col gap-2 text-xs">
                            <span className="text-slate-300">Postal code</span>
                            <input
                              type="text"
                              required
                              value={form.postalCode}
                              onChange={(event) => setForm((prev) => ({ ...prev, postalCode: event.target.value }))}
                              className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                            />
                          </label>
                        </div>

                        <label className="flex flex-col gap-2 text-xs">
                          <span className="text-slate-300">Country</span>
                          <input
                            type="text"
                            required
                            value={form.country}
                            onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))}
                            className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                          />
                        </label>

                        <label className="flex flex-col gap-2 text-xs">
                          <span className="text-slate-300">Additional notes</span>
                          <textarea
                            value={form.notes}
                            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                            className="h-20 rounded-xl border border-white/10 bg-night-900/60 px-4 py-3 text-slate-100 outline-none focus:border-gold-400"
                          />
                        </label>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-night-900/60 p-4 text-xs text-slate-200">
                            <p className="font-semibold text-white">Fees</p>
                            <p className="mt-1 text-slate-400">Processing {processingFeeDisplay}</p>
                            <label className="mt-3 flex flex-col gap-2">
                              <span className="text-slate-400">Additional shipping fee (TKD)</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={form.shippingFee}
                                onChange={(event) => setForm((prev) => ({ ...prev, shippingFee: event.target.value }))}
                                className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                              />
                            </label>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-night-900/60 p-4 text-xs text-slate-200">
                            <p className="font-semibold text-white">Summary</p>
                            <p className="mt-1 text-slate-400">
                              Total debit {((PROCESSING_FEE_MINOR + toMinor(form.shippingFee)) / 100).toFixed(2)} TKD
                            </p>
                          </div>
                        </div>

                        {formError && (
                          <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
                            {formError}
                          </div>
                        )}
                        {formSuccess && (
                          <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
                            {formSuccess}
                          </div>
                        )}

                        <div className="flex items-center gap-3">
                          <button
                            type="submit"
                            className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-slate-500"
                            disabled={formBusy}
                          >
                            {formBusy ? "Submitting…" : "Submit shipping request"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowShippingForm(false)}
                            className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmBuybackItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6 py-10">
          <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmBuybackItem(null)} />
          <div className="relative z-10 w-full max-w-md space-y-6 rounded-3xl border border-white/10 bg-night-900/95 p-6 text-center shadow-2xl">
            <h3 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">Instant Buyback</h3>
            <p className="text-sm text-slate-300">
              You can take {formatMinor(confirmBuybackItem.estimatedValue)} and receive
              {" "}
              <span className="text-emerald-300">
                {formatMinor(
                  confirmBuybackItem.estimatedValue ? Math.round(confirmBuybackItem.estimatedValue * BUYBACK_RATE) : 0
                )}
              </span>
              {" "} in Ten Kings Dollars (TKD). TKD can be used immediately online or at any Ten Kings physical machine.
            </p>
            <div className="grid gap-3 text-left text-xs text-slate-400">
              <div className="flex items-center justify-between">
                <span>Market value</span>
                <span className="text-slate-200">{formatMinor(confirmBuybackItem.estimatedValue)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Buyback rate</span>
                <span className="text-slate-200">75%</span>
              </div>
              <div className="flex items-center justify-between">
                <span>TKD credited</span>
                <span className="text-emerald-300">
                  {formatMinor(
                    confirmBuybackItem.estimatedValue ? Math.round(confirmBuybackItem.estimatedValue * BUYBACK_RATE) : 0
                  )}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => setConfirmBuybackItem(null)}
                className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const item = confirmBuybackItem;
                  const success = await handleInstantBuyback(item);
                  if (success && modalItem?.id === item.id) {
                    closeItemModal();
                  }
                  if (success) {
                    setConfirmBuybackItem(null);
                  }
                }}
                className="rounded-full border border-emerald-400/40 bg-emerald-500/20 px-6 py-2 text-xs uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100"
                disabled={Boolean(buybackBusyItems[confirmBuybackItem.id])}
              >
                {buybackBusyItems[confirmBuybackItem.id] ? "Processing…" : "Accept buyback"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
