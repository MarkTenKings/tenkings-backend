import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import { useStockerLiveFeed } from "../../../hooks/useStockerLiveFeed";
import type { LiveStockerPosition } from "../../../types/stocker";

const StockerOpsLiveMap = dynamic(() => import("../../../components/admin/stocker-ops/StockerOpsLiveMap"), { ssr: false });

function elapsed(clockInAt: string | null | undefined) {
  if (!clockInAt) return "00:00";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(clockInAt).getTime()) / 60000));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function DetailPanel({ stocker, onClose }: { stocker: LiveStockerPosition | null; onClose: () => void }) {
  return (
    <aside className={`stocker-detail-panel ${stocker ? "open" : ""}`}>
      {stocker ? (
        <div className="p-5">
          <button type="button" onClick={onClose} className="mb-5 text-xs uppercase tracking-[0.18em] text-zinc-500">
            Close
          </button>
          <h2 className="font-heading text-2xl text-white">{stocker.name}</h2>
          <p className="mt-1 text-sm text-zinc-500">{stocker.phone}</p>
          <div className="mt-5 rounded-md border border-zinc-800 bg-black/30 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">Shift Timer</p>
            <p className="mt-2 font-mono text-2xl text-white">{elapsed(stocker.shift?.clockInAt)}</p>
          </div>
          <div className="mt-5 rounded-md border border-zinc-800 bg-black/30 p-4">
            <p className="text-sm text-zinc-400">Progress</p>
            <p className="mt-1 text-xl text-white">
              {stocker.shift?.completedStops ?? 0} of {stocker.shift?.totalStops ?? 0} stops complete
            </p>
            <p className="mt-2 text-sm uppercase tracking-[0.16em] text-[#d4a843]">{stocker.status.replace("_", " ")}</p>
            {stocker.currentLocationName ? <p className="mt-1 text-sm text-zinc-400">{stocker.currentLocationName}</p> : null}
          </div>
          <div className="mt-5 space-y-3">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Timeline</p>
            {(stocker.shift?.stops ?? []).map((stop) => (
              <div key={stop.id} className="rounded-md border border-zinc-800 bg-black/30 p-3">
                <p className="text-sm font-medium text-white">{stop.location.name}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-zinc-500">{stop.status.replace("_", " ")}</p>
                <p className="mt-2 text-xs text-zinc-500">
                  {stop.arrivedAt ? `Arrived ${new Date(stop.arrivedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Arrival pending"}
                  {stop.departedAt ? ` · Departed ${new Date(stop.departedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export default function AdminStockerOpsPage() {
  const { session, loading, ensureSession } = useSession();
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  const { stockers, connectionStatus } = useStockerLiveFeed(isAdmin ? session?.token : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = stockers.find((stocker) => stocker.stockerId === selectedId) ?? null;
  const counts = useMemo(
    () => ({
      active: stockers.length,
      completed: stockers.reduce((sum, stocker) => sum + (stocker.shift?.completedStops ?? 0), 0),
      alerts: stockers.filter((stocker) => Date.now() - new Date(stocker.updatedAt).getTime() > 10 * 60 * 1000).length,
    }),
    [stockers],
  );

  useEffect(() => {
    if (!loading && !session) ensureSession().catch(() => undefined);
  }, [ensureSession, loading, session]);

  return (
    <>
      <Head>
        <title>Stocker Operations | Ten Kings</title>
      </Head>
      <main className="relative h-[100dvh] overflow-hidden bg-[#050505] text-white">
        <StockerOpsLiveMap stockers={stockers} selectedStockerId={selectedId} onSelectStocker={setSelectedId} />
        <header className="absolute left-4 right-4 top-4 z-20 rounded-md border border-zinc-800 bg-black/75 p-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-heading text-xl text-[#d4a843]">STOCKER OPERATIONS</h1>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">{connectionStatus}</p>
            </div>
            <div className="flex gap-2 text-xs uppercase tracking-[0.14em]">
              <span>{counts.active} active</span>
              <span>{counts.completed} completed</span>
              <span>{counts.alerts} alerts</span>
            </div>
            <nav className="flex gap-2 text-xs uppercase tracking-[0.14em] text-zinc-300">
              <Link href="/admin/stocker-ops/stockers">Stockers</Link>
              <Link href="/admin/stocker-ops/routes">Routes</Link>
              <Link href="/admin/stocker-ops/shifts">Shifts</Link>
            </nav>
          </div>
        </header>
        {stockers.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-center text-zinc-500">No active stockers right now</div>
        ) : null}
        <DetailPanel stocker={selected} onClose={() => setSelectedId(null)} />
      </main>
    </>
  );
}
