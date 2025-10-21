import { useEffect, useState } from "react";
import Image from "next/image";
import { fetchVaultItem } from "../lib/api";
import { formatUsdMinor } from "../lib/formatters";

interface CardDetailModalProps {
  itemId: string;
  onClose: () => void;
}

interface CardOwner {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface CardDetail {
  id: string;
  name: string;
  set: string;
  number: string | null;
  language: string | null;
  foil: boolean;
  estimatedValue: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  details: Record<string, unknown> | null;
  owner: CardOwner | null;
}

const fallbackImage = "/images/card-pull-1.png";

export default function CardDetailModal({ itemId, onClose }: CardDetailModalProps) {
  const [card, setCard] = useState<CardDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { item } = await fetchVaultItem(itemId);
        if (cancelled) {
          return;
        }
        const detail: CardDetail = {
          id: item.id,
          name: item.name,
          set: item.set,
          number: item.number ?? null,
          language: item.language ?? null,
          foil: Boolean(item.foil),
          estimatedValue: item.estimatedValue ?? null,
          imageUrl: item.imageUrl ?? item.thumbnailUrl ?? null,
          thumbnailUrl: item.thumbnailUrl ?? null,
          details: item.detailsJson ?? null,
          owner: item.owner
            ? {
                id: item.owner.id,
                displayName: item.owner.displayName ?? null,
                avatarUrl: item.owner.avatarUrl ?? null,
              }
            : null,
        };
        setCard(detail);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load card";
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-night-900/95 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40 hover:text-white"
        >
          Close
        </button>
        <div className="grid gap-6 md:grid-cols-[320px_1fr]">
          <div className="relative bg-night-900/80 p-6">
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-night-900/80">
              <div className="relative aspect-[3/4]">
                {card?.imageUrl ? (
                  <Image
                    src={card.imageUrl}
                    alt={card.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 80vw, 320px"
                  />
                ) : (
                  <Image src={fallbackImage} alt="Placeholder card" fill className="object-cover" />
                )}
              </div>
            </div>
          </div>
          <div className="space-y-6 p-6">
            {loading ? (
              <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Loading card…</p>
            ) : error ? (
              <p className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
            ) : card ? (
              <>
                <header className="space-y-2">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">#{card.id.slice(0, 8)}</p>
                  <h2 className="font-heading text-3xl uppercase tracking-[0.2em] text-white">{card.name}</h2>
                  <p className="text-sm text-slate-400">
                    {card.set}
                    {card.number ? ` · ${card.number}` : ""}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.3em] text-slate-300">
                    <span className="rounded-full border border-white/20 px-3 py-1">{card.foil ? "Foil" : "Base"}</span>
                    {card.language && <span className="rounded-full border border-white/20 px-3 py-1">{card.language}</span>}
                  </div>
                </header>

                <dl className="space-y-2 text-sm text-slate-300">
                  <div className="flex justify-between">
                    <dt>Estimated value</dt>
                    <dd className="text-gold-300">{formatUsdMinor(card.estimatedValue)}</dd>
                  </div>
                  {card.owner && (
                    <div className="flex items-center gap-3 pt-2">
                      <div className="relative h-12 w-12 overflow-hidden rounded-full border border-violet-400/40">
                        {card.owner.avatarUrl ? (
                          <Image
                            src={card.owner.avatarUrl}
                            alt={`${card.owner.displayName ?? "Collector"} avatar`}
                            fill
                            className="object-cover"
                            sizes="48px"
                            unoptimized
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-night-900/80 text-[10px] uppercase tracking-[0.28em] text-slate-500">
                            User
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Owner</p>
                        <p className="text-sm text-white">{card.owner.displayName ?? "Collector"}</p>
                      </div>
                    </div>
                  )}
                </dl>

                {card.details && Object.keys(card.details).length > 0 && (
                  <div className="max-h-48 overflow-auto rounded-2xl border border-white/10 bg-night-900/70 p-4 text-xs text-slate-300">
                    <pre className="whitespace-pre-wrap break-words">
{JSON.stringify(card.details, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Card not found.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
