import Head from "next/head";
import Image from "next/image";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import CardDetailModal from "../../components/CardDetailModal";
import { fetchCollector, listCollectorItems } from "../../lib/api";
import { formatUsdMinor } from "../../lib/formatters";

interface CollectorProfile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface CollectorItem {
  id: string;
  name: string;
  set: string;
  number: string | null;
  estimatedValue: number | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  status: string;
  createdAt: string;
}

const fallbackImage = "/images/card-pull-1.png";

export default function CollectorPage() {
  const router = useRouter();
  const { userId } = router.query;

  const [profile, setProfile] = useState<CollectorProfile | null>(null);
  const [items, setItems] = useState<CollectorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [profileResponse, itemsResponse] = await Promise.all([
          fetchCollector(userId),
          listCollectorItems(userId),
        ]);
        if (cancelled) {
          return;
        }
        setProfile(profileResponse.user);
        const mapped: CollectorItem[] = (itemsResponse.items ?? []).map((item: any) => ({
          id: item.id,
          name: item.name,
          set: item.set,
          number: item.number ?? null,
          estimatedValue: item.estimatedValue ?? null,
          imageUrl: item.imageUrl ?? item.thumbnailUrl ?? null,
          thumbnailUrl: item.thumbnailUrl ?? null,
          status: item.status,
          createdAt: item.createdAt,
        }));
        setItems(mapped);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load collector";
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
  }, [userId]);

  const collectorName = profile?.displayName ?? "Collector";

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · {collectorName}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-night-900/70 px-6 py-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative h-20 w-20 overflow-hidden rounded-full border border-violet-400/40">
              {profile?.avatarUrl ? (
                <Image
                  src={profile.avatarUrl}
                  alt={`${collectorName} avatar`}
                  fill
                  className="object-cover"
                  sizes="80px"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-night-900/80 text-[10px] uppercase tracking-[0.28em] text-slate-500">
                  User
                </div>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-violet-300">Collector</p>
              <h1 className="font-heading text-3xl uppercase tracking-[0.18em] text-white">{collectorName}</h1>
              <p className="text-xs text-slate-500">Vaulted hits shared from the Ten Kings ecosystem.</p>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-night-900/60 px-6 py-10 text-center text-sm text-slate-400">
            Loading collection…
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-rose-400/40 bg-rose-500/10 px-6 py-10 text-center text-sm text-rose-200">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-night-900/60 px-6 py-10 text-center text-sm text-slate-400">
            No public cards yet. Check back after their next rip!
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveItemId(item.id)}
                className="group flex flex-col gap-3 rounded-3xl border border-white/10 bg-night-900/70 p-5 text-left transition hover:border-gold-400/60 hover:shadow-glow"
              >
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-night-900/60">
                  <div className="relative aspect-[3/4]">
                    {item.imageUrl ? (
                      <Image src={item.imageUrl} alt={item.name} fill className="object-cover" sizes="(max-width: 768px) 100vw, 260px" />
                    ) : (
                      <Image src={fallbackImage} alt="Placeholder card" fill className="object-cover" />
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{item.set}</p>
                    <h2 className="font-heading text-xl uppercase tracking-[0.18em] text-white">{item.name}</h2>
                    {item.number && <p className="text-xs text-slate-500">#{item.number}</p>}
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>Status</span>
                    <span className="uppercase tracking-[0.3em] text-gold-300">{item.status.replace(/_/g, " ")}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>Vault value</span>
                    <span className="text-gold-300">{formatUsdMinor(item.estimatedValue)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {activeItemId && <CardDetailModal itemId={activeItemId} onClose={() => setActiveItemId(null)} />}
    </AppShell>
  );
}
