import Image from "next/image";
import { useEffect, useState } from "react";
import { PlaceholderImage } from "../PlaceholderImage";
import {
  CATEGORY_OPTIONS,
  formatCategoryLabel,
  formatCurrencyFromMinor,
  type CollectibleCategoryValue,
  type InventoryCardSummary,
  type InventoryCardUpdatePayload,
} from "../../lib/adminInventory";
import { adminCx, adminInputClass, adminSelectClass } from "./AdminPrimitives";

type InventoryCardDetailPanelProps = {
  card: InventoryCardSummary;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (updates: InventoryCardUpdatePayload) => Promise<void> | void;
};

type CardFormState = {
  playerName: string;
  setName: string;
  year: string;
  cardNumber: string;
  parallel: string;
  valuationInput: string;
  category: CollectibleCategoryValue | "";
  subCategory: string;
  brand: string;
};

function formatMinorToCurrencyInput(value: number | null | undefined) {
  if (value == null) {
    return "";
  }
  return (value / 100).toFixed(2);
}

function parseCurrencyInputToMinor(value: string) {
  const normalized = value.replace(/[^0-9.]/g, "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Number.NaN;
  }

  return Math.round(parsed * 100);
}

function toFormState(card: InventoryCardSummary): CardFormState {
  return {
    playerName: card.playerName ?? "",
    setName: card.setName ?? "",
    year: card.year ?? "",
    cardNumber: card.cardNumber ?? "",
    parallel: card.parallel ?? "",
    valuationInput: formatMinorToCurrencyInput(card.valuationMinor),
    category: (card.category as CollectibleCategoryValue | null) ?? "",
    subCategory: card.subCategory ?? "",
    brand: card.brand ?? "",
  };
}

function trimToNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function InventoryCardDetailPanel({
  card,
  busy,
  error,
  onClose,
  onSave,
}: InventoryCardDetailPanelProps) {
  const [form, setForm] = useState<CardFormState>(() => toFormState(card));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setForm(toFormState(card));
    setLocalError(null);
  }, [card]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  const handleSubmit = async () => {
    setLocalError(null);

    const nextValuationMinor = parseCurrencyInputToMinor(form.valuationInput);
    if (Number.isNaN(nextValuationMinor)) {
      setLocalError("Estimated value must be a valid non-negative dollar amount.");
      return;
    }

    const updates: InventoryCardUpdatePayload = {};
    const nextPlayerName = trimToNull(form.playerName);
    const nextSetName = trimToNull(form.setName);
    const nextYear = trimToNull(form.year);
    const nextCardNumber = trimToNull(form.cardNumber);
    const nextParallel = trimToNull(form.parallel);
    const nextSubCategory = trimToNull(form.subCategory);
    const nextBrand = trimToNull(form.brand);
    const nextCategory = form.category || null;

    if (nextPlayerName !== (card.playerName ?? null)) {
      updates.playerName = form.playerName;
    }
    if (nextSetName !== (card.setName ?? null)) {
      updates.setName = form.setName;
    }
    if (nextYear !== (card.year ?? null)) {
      updates.year = form.year;
    }
    if (nextCardNumber !== (card.cardNumber ?? null)) {
      updates.cardNumber = form.cardNumber;
    }
    if (nextParallel !== (card.parallel ?? null)) {
      updates.parallel = nextParallel;
    }
    if (nextSubCategory !== (card.subCategory ?? null)) {
      updates.subCategory = form.subCategory;
    }
    if (nextBrand !== (card.brand ?? null)) {
      updates.brand = form.brand;
    }
    if (nextCategory && nextCategory !== (card.category ?? null)) {
      updates.category = nextCategory;
    }
    if (nextValuationMinor != null && nextValuationMinor !== (card.valuationMinor ?? null)) {
      updates.valuationMinor = nextValuationMinor;
    }

    if (Object.keys(updates).length === 0) {
      setLocalError("No changes to save.");
      return;
    }

    await onSave(updates);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <aside
        className="flex h-full w-full max-w-[460px] flex-col border-l border-white/10 bg-night-950 shadow-[-24px_0_80px_rgba(0,0,0,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-5">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Inventory Card Detail</p>
            <h2 className="font-heading text-2xl uppercase tracking-[0.12em] text-white">
              {card.playerName ?? card.setName ?? "Untitled Card"}
            </h2>
            <p className="text-sm text-slate-400">
              {card.inventoryBatch ? "Assigned cards cannot be edited here." : "Edit the inventory-ready metadata before assignment."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.24em] text-slate-300 transition hover:border-white/25 hover:text-white disabled:opacity-45"
          >
            Close
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="grid gap-3 sm:grid-cols-2">
            {[
              { label: "Front", url: card.frontPhotoUrl },
              { label: "Back", url: card.backPhotoUrl },
            ].map((photo) => (
              <div key={photo.label} className="overflow-hidden rounded-[24px] border border-white/10 bg-black/60">
                <div className="relative aspect-[3/4]">
                  {photo.url ? (
                    <Image
                      src={photo.url}
                      alt={`${photo.label} of ${card.playerName ?? card.setName ?? "inventory card"}`}
                      fill
                      sizes="(min-width: 640px) 220px, calc(100vw - 64px)"
                      className="object-cover"
                    />
                  ) : (
                    <PlaceholderImage label={`No ${photo.label}`} />
                  )}
                </div>
                <div className="border-t border-white/10 px-3 py-2 text-[11px] uppercase tracking-[0.24em] text-slate-400">
                  {photo.label}
                </div>
              </div>
            ))}
          </section>

          <section className="rounded-[24px] border border-white/10 bg-black/40 p-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-slate-400">
              <span className="rounded-full border border-white/10 px-3 py-1.5">{formatCategoryLabel(card.category)}</span>
              <span className="rounded-full border border-white/10 px-3 py-1.5">{formatCurrencyFromMinor(card.valuationMinor)}</span>
              {card.cardNumber ? <span className="rounded-full border border-white/10 px-3 py-1.5">#{card.cardNumber}</span> : null}
            </div>
            <p className="mt-3 text-xs uppercase tracking-[0.22em] text-slate-500">Card ID</p>
            <p className="mt-1 break-all text-sm text-slate-300">{card.id}</p>
          </section>

          <section className="grid gap-4">
            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Player Name</span>
              <input
                value={form.playerName}
                onChange={(event) => setForm((current) => ({ ...current, playerName: event.currentTarget.value }))}
                className={adminInputClass()}
                placeholder="Player name"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Set Name</span>
              <input
                value={form.setName}
                onChange={(event) => setForm((current) => ({ ...current, setName: event.currentTarget.value }))}
                className={adminInputClass()}
                placeholder="Set name"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Year</span>
                <input
                  value={form.year}
                  onChange={(event) => setForm((current) => ({ ...current, year: event.currentTarget.value }))}
                  className={adminInputClass()}
                  placeholder="Year"
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Card Number</span>
                <input
                  value={form.cardNumber}
                  onChange={(event) => setForm((current) => ({ ...current, cardNumber: event.currentTarget.value }))}
                  className={adminInputClass()}
                  placeholder="Card number"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Parallel</span>
                <input
                  value={form.parallel}
                  onChange={(event) => setForm((current) => ({ ...current, parallel: event.currentTarget.value }))}
                  className={adminInputClass()}
                  placeholder="Base, refractor, holo..."
                />
              </label>

              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Estimated Value ($)</span>
                <input
                  value={form.valuationInput}
                  onChange={(event) => setForm((current) => ({ ...current, valuationInput: event.currentTarget.value }))}
                  className={adminInputClass()}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Category</span>
                <select
                  value={form.category}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      category: event.currentTarget.value as CollectibleCategoryValue | "",
                    }))
                  }
                  className={adminSelectClass()}
                >
                  {card.category == null ? <option value="">Select category</option> : null}
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Sub-Category</span>
                <input
                  value={form.subCategory}
                  onChange={(event) => setForm((current) => ({ ...current, subCategory: event.currentTarget.value }))}
                  className={adminInputClass()}
                  placeholder="Baseball, Basketball, Pokemon..."
                />
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm text-slate-200">
              <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Brand</span>
              <input
                value={form.brand}
                onChange={(event) => setForm((current) => ({ ...current, brand: event.currentTarget.value }))}
                className={adminInputClass()}
                placeholder="Topps, Panini, Upper Deck..."
              />
            </label>
          </section>

          {localError || error ? (
            <div
              className={adminCx(
                "rounded-2xl border px-4 py-3 text-sm",
                error ? "border-rose-400/30 bg-rose-500/10 text-rose-200" : "border-amber-400/30 bg-amber-500/10 text-amber-100"
              )}
            >
              {error ?? localError}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-white/12 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:opacity-45"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy}
            className="rounded-full border border-gold-400/60 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </aside>
    </div>
  );
}
