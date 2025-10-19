import Head from "next/head";
import { FormEvent, useEffect, useMemo, useState } from "react";
import AppShell from "../components/AppShell";
import { useSession } from "../hooks/useSession";

const PROCESSING_FEE_MINOR = Number(process.env.NEXT_PUBLIC_SHIPPING_PROCESSING_FEE_MINOR ?? "1200");

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

export default function CollectionPage() {
  const { session, loading, ensureSession, updateWalletBalance } = useSession();
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [form, setForm] = useState<ShippingFormState>(initialForm);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const processingFeeDisplay = useMemo(
    () => `${(PROCESSING_FEE_MINOR / 100).toFixed(2)} TKD`,
    []
  );

  const loadItems = () => {
    if (!session) {
      return;
    }
    setItemsLoading(true);
    setItemsError(null);
    fetch("/api/collection", {
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    })
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load collection");
        }
        const payload = (await res.json()) as { items: CollectionItem[] };
        setItems(payload.items);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load collection";
        setItemsError(message);
      })
      .finally(() => setItemsLoading(false));
  };

  useEffect(() => {
    if (loading) {
      return;
    }
    if (!session) {
      ensureSession().catch(() => undefined);
      return;
    }
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session?.token]);

  const handleSelectItem = (itemId: string) => {
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
      setForm(initialForm);
      setFormError(null);
      setFormSuccess(null);
      return;
    }
    setSelectedItemId(itemId);
    setForm(initialForm);
    setFormError(null);
    setFormSuccess(null);
  };

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
      setFormSuccess("Shipping request submitted. Our vault team will process it shortly.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to request shipping";
      setFormError(message);
    } finally {
      setFormBusy(false);
    }
  };

  const renderItem = (item: CollectionItem) => {
    const shipping = item.shippingRequest;
    const pendingRequest = shipping && shipping.status !== "SHIPPED" && shipping.status !== "CANCELLED";

    return (
      <div key={item.id} className="rounded-3xl border border-white/10 bg-night-900/70 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">#{item.id.slice(0, 8)}</p>
            <h3 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">{item.name}</h3>
            <p className="text-sm text-slate-400">{item.set}{item.number ? ` · ${item.number}` : ""}</p>
            <p className="text-xs text-slate-400">Value: {formatMinor(item.estimatedValue)}</p>
            {item.pack && (
              <p className="text-xs text-slate-500">
                Pulled from {item.pack.definitionName ?? "Mystery Pack"} ({item.pack.tier})
              </p>
            )}
          </div>
          <div className="text-right text-xs uppercase tracking-[0.28em] text-slate-400">
            <p>Status: {item.status}</p>
            {shipping && <p>Shipping: {shipping.status}</p>}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => handleSelectItem(item.id)}
            className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-500"
            disabled={pendingRequest || item.status === "IN_TRANSFER" || item.status === "REDEEMED"}
          >
            {selectedItemId === item.id ? "Hide shipping form" : "Request shipping"}
          </button>
        </div>

        {shipping && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-300">
            <p>
              Requested on {new Date(shipping.createdAt).toLocaleString()} – Status {shipping.status}
            </p>
            <p>Processing fee: {formatMinor(shipping.processingFeeMinor)}</p>
            <p>Shipping fee: {formatMinor(shipping.shippingFeeMinor)}</p>
            <p>Total: {formatMinor(shipping.totalFeeMinor)}</p>
            {shipping.trackingNumber && (
              <p>Tracking: {shipping.carrier ?? ""} {shipping.trackingNumber}</p>
            )}
            {shipping.notes && <p>Notes: {shipping.notes}</p>}
          </div>
        )}

        {selectedItemId === item.id && !pendingRequest && item.status !== "IN_TRANSFER" && (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Recipient name</span>
                <input
                  type="text"
                  required
                  value={form.recipientName}
                  onChange={(event) => setForm((prev) => ({ ...prev, recipientName: event.target.value }))}
                  className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Contact email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Contact phone</span>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                  className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Address line 1</span>
                <input
                  type="text"
                  required
                  value={form.addressLine1}
                  onChange={(event) => setForm((prev) => ({ ...prev, addressLine1: event.target.value }))}
                  className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Address line 2</span>
                <input
                  type="text"
                  value={form.addressLine2}
                  onChange={(event) => setForm((prev) => ({ ...prev, addressLine2: event.target.value }))}
                  className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">City</span>
                <input
                  type="text"
                  required
                  value={form.city}
                  onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))}
                  className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">State / Region</span>
                <input
                  type="text"
                  value={form.state}
                  onChange={(event) => setForm((prev) => ({ ...prev, state: event.target.value }))}
                  className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Postal code</span>
                <input
                  type="text"
                  required
                  value={form.postalCode}
                  onChange={(event) => setForm((prev) => ({ ...prev, postalCode: event.target.value }))}
                  className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="text-slate-300">Country</span>
                <input
                  type="text"
                  required
                  value={form.country}
                  onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))}
                  className="rounded-xl border border-white/10 bg-night-900/60 px-4 py-2 text-slate-100 outline-none focus:border-gold-400"
                />
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm">
              <span className="text-slate-300">Additional notes</span>
              <textarea
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                className="h-24 rounded-xl border border-white/10 bg-night-900/60 px-4 py-3 text-slate-100 outline-none focus:border-gold-400"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-200">
                <p className="font-semibold text-white">Fees</p>
                <p className="text-xs text-slate-400">Processing fee: {processingFeeDisplay}</p>
                <label className="mt-3 flex flex-col gap-2 text-xs">
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
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-200">
                <p className="font-semibold text-white">Summary</p>
                <p className="text-xs text-slate-400">
                  Total debit: {((PROCESSING_FEE_MINOR + toMinor(form.shippingFee)) / 100).toFixed(2)} TKD
                </p>
              </div>
            </div>

            {formError && (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {formSuccess}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-full border border-gold-500/60 bg-gold-500 px-8 py-3 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-white/10 disabled:text-slate-500"
                disabled={formBusy}
              >
                {formBusy ? "Submitting…" : "Submit shipping request"}
              </button>
              <button
                type="button"
                onClick={() => handleSelectItem(item.id)}
                className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    );
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-[0.32em] text-violet-300">Vault</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">My Collection</h1>
          <p className="text-sm text-slate-400">
            Review the cards you’ve pulled and request shipping from the Ten Kings vault whenever you’re ready.
          </p>
        </header>

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
          <div className="grid gap-5">
            {items.map(renderItem)}
          </div>
        )}
      </div>
    </AppShell>
  );
}
