import Head from "next/head";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";

interface LocationOption {
  id: string;
  name: string;
}

interface QueueEntry {
  id: string;
  createdAt: string;
  packDefinition: {
    id: string;
    name: string;
    price: number;
    tier: string;
  };
  item: {
    id: string;
    name: string;
    imageUrl: string | null;
    cardQrCodeId: string | null;
  } | null;
}

interface QrCodeSummary {
  id: string;
  code: string;
  serial: string | null;
  type: string;
  state: string;
  payloadUrl: string | null;
  pairId: string | null;
}

interface QrCodePair {
  pairId: string;
  card: QrCodeSummary;
  pack: QrCodeSummary;
}

const ONLINE_OPTION = "ONLINE";

export default function AdminPackingConsole() {
  const { session, loading, ensureSession, logout } = useSession();

  useEffect(() => {
    ensureSession().catch(() => undefined);
  }, [ensureSession]);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone]
  );

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsError, setLocationsError] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>(ONLINE_OPTION);

  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  const [cardCode, setCardCode] = useState("");
  const [cardScanMessage, setCardScanMessage] = useState<string | null>(null);
  const [cardScanError, setCardScanError] = useState<string | null>(null);
  const [cardSubmitting, setCardSubmitting] = useState(false);

  const [packCode, setPackCode] = useState("");
  const [packScanMessage, setPackScanMessage] = useState<string | null>(null);
  const [packScanError, setPackScanError] = useState<string | null>(null);
  const [packSubmitting, setPackSubmitting] = useState(false);

  const [pairCount, setPairCount] = useState(10);
  const [pairSubmitting, setPairSubmitting] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairResults, setPairResults] = useState<QrCodePair[]>([]);
  const [pairLocationId, setPairLocationId] = useState<string>(ONLINE_OPTION);

  const loadLocations = useCallback(() => {
    setLocationsLoading(true);
    setLocationsError(null);
    fetch("/api/locations")
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load locations");
        }
        const payload = (await res.json()) as { locations?: Array<{ id: string; name: string }> };
        if (!Array.isArray(payload.locations)) {
          throw new Error("Failed to load locations");
        }
        const mapped = payload.locations.map(({ id, name }) => ({ id, name }));
        setLocations(mapped);
        if (mapped.length > 0) {
          if (selectedLocationId === ONLINE_OPTION) {
            setSelectedLocationId(mapped[0].id);
          }
          if (pairLocationId === ONLINE_OPTION) {
            setPairLocationId(mapped[0].id);
          }
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load locations";
        setLocationsError(message);
      })
      .finally(() => {
        setLocationsLoading(false);
      });
  }, [pairLocationId, selectedLocationId]);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const fetchQueue = useCallback(
    async (locationId: string, signal?: AbortSignal) => {
      if (!session?.token || !isAdmin || !locationId || locationId === ONLINE_OPTION) {
        setQueue([]);
        setQueueError(null);
        setQueueLoading(false);
        return;
      }

      setQueueLoading(true);
      setQueueError(null);
      try {
        const params = new URLSearchParams({ locationId });
        const res = await fetch(`/api/admin/packing/queue?${params.toString()}`, {
          headers: buildAdminHeaders(session.token),
          signal,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Unable to load packing queue");
        }
        const data = (await res.json()) as { packs: QueueEntry[] };
        setQueue(data.packs ?? []);
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to load packing queue";
        setQueueError(message);
      } finally {
        if (!signal?.aborted) {
          setQueueLoading(false);
        }
      }
    },
    [isAdmin, session?.token]
  );

  useEffect(() => {
    if (!selectedLocationId) {
      return;
    }
    const controller = new AbortController();
    fetchQueue(selectedLocationId, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [selectedLocationId, fetchQueue]);

  const currentPack = queue[0] ?? null;
  const currentItem = currentPack?.item ?? null;
  const cardBound = Boolean(currentItem?.cardQrCodeId);

  const handleCardSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.token || !isAdmin || !currentItem || !cardCode.trim()) {
      return;
    }
    setCardSubmitting(true);
    setCardScanMessage(null);
    setCardScanError(null);
    try {
      const res = await fetch("/api/admin/packing/scan-card", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ code: cardCode.trim(), itemId: currentItem.id }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to bind card QR code");
      }
      const payload = (await res.json()) as {
        item: { id: string; name: string | null; imageUrl: string | null };
        qrCode: QrCodeSummary;
      };
      setQueue((prev) => {
        if (prev.length === 0) {
          return prev;
        }
        const [first, ...rest] = prev;
        if (!first.item) {
          return prev;
        }
        if (first.item.id !== payload.item.id) {
          return prev;
        }
        return [
          {
            ...first,
            item: {
              ...first.item,
              cardQrCodeId: payload.qrCode.id,
            },
          },
          ...rest,
        ];
      });
      setCardScanMessage(`Card QR bound (${payload.qrCode.serial ?? payload.qrCode.code})`);
      setCardCode("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to bind card QR code";
      setCardScanError(message);
    } finally {
      setCardSubmitting(false);
    }
  };

  const handlePackSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !session?.token ||
      !isAdmin ||
      !currentPack ||
      !currentItem ||
      !cardBound ||
      !packCode.trim() ||
      !selectedLocationId ||
      selectedLocationId === ONLINE_OPTION
    ) {
      return;
    }

    setPackSubmitting(true);
    setPackScanMessage(null);
    setPackScanError(null);

    try {
      const res = await fetch("/api/admin/packing/scan-pack", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          code: packCode.trim(),
          packInstanceId: currentPack.id,
          locationId: selectedLocationId,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to seal pack");
      }

      const payload = (await res.json()) as {
        pack: { id: string; fulfillmentStatus: string; packedAt: string | null; definitionName: string };
        qrCode: QrCodeSummary;
      };

      setPackScanMessage(
        `Pack sealed (${payload.qrCode.serial ?? payload.qrCode.code}) · status ${payload.pack.fulfillmentStatus}`
      );
      setPackCode("");
      setQueue((prev) => prev.slice(1));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to seal pack";
      setPackScanError(message);
    } finally {
      setPackSubmitting(false);
    }
  };

  const handleGeneratePairs = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session?.token || !isAdmin || pairCount <= 0) {
      return;
    }
    setPairSubmitting(true);
    setPairError(null);
    try {
      const res = await fetch("/api/admin/qr/pairs", {
        method: "POST",
        headers: buildAdminHeaders(session.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          count: pairCount,
          locationId: pairLocationId === ONLINE_OPTION ? undefined : pairLocationId,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Failed to generate QR codes");
      }
      const payload = (await res.json()) as { pairs: QrCodePair[] };
      setPairResults(payload.pairs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate QR codes";
      setPairError(message);
    } finally {
      setPairSubmitting(false);
    }
  };

  const selectedLocationLabel = useMemo(() => {
    if (selectedLocationId === ONLINE_OPTION) {
      return "Online";
    }
    return locations.find((entry) => entry.id === selectedLocationId)?.name ?? "Selected location";
  }, [selectedLocationId, locations]);

  const hasAccess = !loading && isAdmin;

  return (
    <AppShell>
      <Head>
        <title>Location Packing · Ten Kings Admin</title>
      </Head>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-400">Operations</p>
          <h1 className="font-heading text-3xl uppercase tracking-[0.18em] text-white">Location Packing Console</h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Generate QR label pairs, bind slabs to sealed packs, and stage inventory for the kiosk flow. Use a barcode
            scanner in keyboard mode — each scan auto-submits when the input is focused.
          </p>
        </header>

        {!hasAccess && (
          <div className="rounded-3xl border border-rose-400/40 bg-rose-500/10 p-6 text-sm text-rose-200">
            <p>Admin access is required. Ask an administrator to grant permissions to your account.</p>
            <button
              type="button"
              onClick={logout}
              className="mt-4 inline-flex items-center justify-center rounded-full border border-rose-400/40 px-5 py-2 text-xs uppercase tracking-[0.28em] text-rose-200 transition hover:border-rose-300 hover:text-rose-100"
            >
              Sign Out
            </button>
          </div>
        )}

        {hasAccess && (
          <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-6">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Packing Queue</p>
                    <h2 className="font-heading text-2xl uppercase tracking-[0.18em] text-white">{selectedLocationLabel}</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-xs text-slate-300">
                      <span className="mr-2 text-[11px] uppercase tracking-[0.28em] text-slate-400">Location</span>
                      <select
                        value={selectedLocationId}
                        onChange={(event) => setSelectedLocationId(event.currentTarget.value)}
                        className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-white outline-none transition focus:border-emerald-400/60"
                      >
                        <option value={ONLINE_OPTION}>Online (no packing)</option>
                        {locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => fetchQueue(selectedLocationId).catch(() => undefined)}
                      className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.28em] text-slate-200 transition hover:border-white/40 hover:text-white"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
                {locationsLoading && (
                  <p className="text-xs text-slate-400">Loading locations…</p>
                )}
                {locationsError && (
                  <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs uppercase tracking-[0.28em] text-rose-200">
                    {locationsError}
                  </p>
                )}
              </div>

              {selectedLocationId === ONLINE_OPTION && (
                <p className="rounded-2xl border border-white/10 bg-night-900/60 px-4 py-3 text-sm text-slate-300">
                  Select a physical location to view the packing queue. Online inventory skips the packing workflow.
                </p>
              )}

              {selectedLocationId !== ONLINE_OPTION && queueLoading && (
                <p className="text-sm text-slate-400">Loading queue…</p>
              )}

              {selectedLocationId !== ONLINE_OPTION && queueError && (
                <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{queueError}</p>
              )}

              {selectedLocationId !== ONLINE_OPTION && !queueLoading && !queueError && queue.length === 0 && (
                <p className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  No packs are waiting for this location. Assign cards to this location to queue them for packing.
                </p>
              )}

              {selectedLocationId !== ONLINE_OPTION && !queueLoading && !queueError && queue.length > 0 && currentPack && (
                <div className="grid gap-4">
                  <div className="rounded-2xl border border-white/10 bg-night-900/60 p-4">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Next Pack</p>
                    <h3 className="mt-2 font-heading text-xl uppercase tracking-[0.18em] text-white">
                      {currentPack.packDefinition.name}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Created {new Date(currentPack.createdAt).toLocaleString()} · Tier {currentPack.packDefinition.tier}
                    </p>
                  </div>

                  {currentItem ? (
                    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-night-900/60 p-4">
                      <div className="flex items-start gap-3">
                        {currentItem.imageUrl ? (
                          <div className="relative h-32 w-24 overflow-hidden rounded-xl border border-white/10 bg-night-900">
                            <Image
                              src={currentItem.imageUrl}
                              alt={currentItem.name ?? "Card image"}
                              fill
                              sizes="96px"
                              className="object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex h-32 w-24 items-center justify-center rounded-xl border border-white/10 bg-night-900 text-xs text-slate-500">
                            No image
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Card</p>
                          <p className="text-sm text-slate-100">{currentItem.name ?? "Pending metadata"}</p>
                          <p className="text-xs text-slate-500">
                            Item ID {currentItem.id.slice(0, 8)}…
                          </p>
                          <p className="mt-2 text-xs text-slate-300">
                            Status: {cardBound ? "QR bound" : "Needs card QR"}
                          </p>
                        </div>
                      </div>

                      <form onSubmit={handleCardSubmit} className="flex flex-col gap-2 text-xs text-slate-200">
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Scan card QR</span>
                          <input
                            type="text"
                            inputMode="text"
                            autoComplete="off"
                            required
                            value={cardCode}
                            onChange={(event) => setCardCode(event.currentTarget.value)}
                            className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60"
                            placeholder="tkc_…"
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={cardSubmitting || !cardCode.trim()}
                          className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/20 px-5 py-2 text-[11px] uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-300 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {cardSubmitting ? "Binding…" : cardBound ? "Rebind Card" : "Bind Card"}
                        </button>
                        {cardScanMessage && (
                          <p className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-emerald-200">
                            {cardScanMessage}
                          </p>
                        )}
                        {cardScanError && (
                          <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-rose-200">
                            {cardScanError}
                          </p>
                        )}
                      </form>
                    </div>
                  ) : (
                    <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                      This pack is missing a slotted card. Check the admin assignment in case it was unassigned.
                    </p>
                  )}

                  <form onSubmit={handlePackSubmit} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-night-900/60 p-4 text-xs text-slate-200">
                    <span className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Scan pack QR</span>
                    <input
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      required
                      disabled={!cardBound}
                      value={packCode}
                      onChange={(event) => setPackCode(event.currentTarget.value)}
                      className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-sm text-white outline-none transition focus:border-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-50"
                      placeholder="tkp_…"
                    />
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={!cardBound || packSubmitting || !packCode.trim()}
                        className="inline-flex items-center justify-center rounded-full border border-gold-500/40 bg-gold-500/20 px-5 py-2 text-[11px] uppercase tracking-[0.3em] text-gold-200 transition hover:border-gold-400 hover:text-gold-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {packSubmitting ? "Sealing…" : "Seal Pack"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQueue((prev) => prev.slice(1));
                          setCardCode("");
                          setCardScanMessage(null);
                          setCardScanError(null);
                          setPackCode("");
                          setPackScanMessage(null);
                          setPackScanError(null);
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-white/20 px-4 py-2 text-[11px] uppercase tracking-[0.3em] text-slate-200 transition hover:border-white/40 hover:text-white"
                      >
                        Skip Pack
                      </button>
                    </div>
                    {packScanMessage && (
                      <p className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-emerald-200">
                        {packScanMessage}
                      </p>
                    )}
                    {packScanError && (
                      <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-rose-200">
                        {packScanError}
                      </p>
                    )}
                  </form>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 p-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">QR Label Pairs</p>
                <h2 className="font-heading text-2xl uppercase tracking-[0.18em] text-white">Print Queue</h2>
                <p className="mt-2 text-xs text-slate-300">
                  Generate pre-matched card + pack stickers. Print, peel, and apply together during the packing flow.
                </p>
              </div>

              <form onSubmit={handleGeneratePairs} className="flex flex-col gap-3 text-xs text-slate-200">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Count</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={pairCount}
                    onChange={(event) => setPairCount(Number(event.currentTarget.value))}
                    className="w-32 rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-white outline-none transition focus:border-emerald-400/60"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Assign to location (optional)</span>
                  <select
                    value={pairLocationId}
                    onChange={(event) => setPairLocationId(event.currentTarget.value)}
                    className="rounded-2xl border border-white/10 bg-night-800 px-4 py-2 text-white outline-none transition focus:border-emerald-400/60"
                  >
                    <option value={ONLINE_OPTION}>Online / Unassigned</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="submit"
                  disabled={pairSubmitting || pairCount <= 0}
                  className="inline-flex items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/20 px-5 py-2 text-[11px] uppercase tracking-[0.3em] text-sky-200 transition hover:border-sky-300 hover:text-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pairSubmitting ? "Generating…" : "Generate Pairs"}
                </button>

                {pairError && (
                  <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[11px] uppercase tracking-[0.28em] text-rose-200">
                    {pairError}
                  </p>
                )}
              </form>

              {pairResults.length > 0 && (
                <div className="rounded-2xl border border-white/10 bg-night-900/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Latest batch</p>
                  <ul className="mt-3 grid max-h-72 gap-3 overflow-auto text-xs text-slate-200">
                    {pairResults.map((pair) => (
                      <li key={pair.pairId} className="rounded-xl border border-white/10 bg-night-900/70 p-3">
                        <p className="font-semibold uppercase tracking-[0.2em] text-white">{pair.pairId}</p>
                        <div className="mt-2 grid gap-2">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.28em] text-sky-300">Card QR</p>
                            <p className="break-all text-slate-200">{pair.card.code}</p>
                            <p className="text-[10px] text-slate-500">{pair.card.payloadUrl}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.28em] text-gold-300">Pack QR</p>
                            <p className="break-all text-slate-200">{pair.pack.code}</p>
                            <p className="text-[10px] text-slate-500">{pair.pack.payloadUrl}</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
