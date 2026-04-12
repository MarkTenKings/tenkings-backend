import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useStockerShift } from "../../hooks/useStockerShift";

function formatDate() {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "Time pending";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  return `~${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function StockerDashboardPage() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const { shift, loading: shiftLoading, error, refresh } = useStockerShift(session?.token);
  const [clocking, setClocking] = useState(false);

  useEffect(() => {
    if (!loading && !session) {
      ensureSession().catch(() => router.replace("/stocker"));
    }
  }, [ensureSession, loading, router, session]);

  useEffect(() => {
    if (shift?.status === "active") void router.replace("/stocker/route");
  }, [router, shift?.status]);

  const completedSummary = useMemo(() => {
    if (!shift || shift.status !== "completed") return null;
    const stops = shift.stops ?? [];
    return {
      totalStops: stops.length,
      completed: stops.filter((stop) => stop.status === "completed").length,
      drive: shift.totalDriveTimeMin ?? 0,
      onsite: shift.totalOnSiteTimeMin ?? 0,
    };
  }, [shift]);

  const clockIn = async () => {
    if (!shift || !session?.token) return;
    setClocking(true);
    try {
      const response = await fetch("/api/stocker/shift/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ shiftId: shift.id }),
      });
      if (!response.ok) throw new Error("Unable to clock in");
      await router.push("/stocker/route");
    } finally {
      setClocking(false);
      await refresh();
    }
  };

  return (
    <>
      <Head>
        <title>Stocker Dashboard | Ten Kings</title>
      </Head>
      <main className="min-h-screen bg-[#0a0a0a] px-5 py-7 text-white">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold">{shift?.stocker?.name ?? session?.user.displayName ?? "Stocker"}</h1>
            <p className="mt-1 text-sm text-zinc-500">{formatDate()}</p>
          </div>
          <Link href="/stocker" className="rounded-md border border-zinc-800 px-3 py-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
            Portal
          </Link>
        </header>

        {shiftLoading ? <p className="text-zinc-500">Loading route...</p> : null}
        {error ? <p className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</p> : null}

        {!shift && !shiftLoading ? (
          <section className="flex min-h-[60vh] items-center justify-center text-center text-zinc-500">
            No route assigned for today. Contact your manager.
          </section>
        ) : null}

        {shift?.status === "pending" ? (
          <section className="space-y-6 pb-28">
            <div className="rounded-md border border-zinc-800 bg-[#111] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">Today&apos;s Route</p>
              <h2 className="mt-2 font-heading text-2xl font-semibold">{shift.route?.name ?? "Assigned Route"}</h2>
              <p className="mt-2 text-sm text-zinc-400">
                {(shift.stops ?? []).length} stops · {formatDuration(shift.route?.totalDurationS)} ·{" "}
                {shift.route?.totalDistanceM ? `${Math.round(shift.route.totalDistanceM / 1609)} miles` : "Distance pending"}
              </p>
            </div>
            <ol className="space-y-3">
              {(shift.stops ?? []).map((stop, index) => (
                <li key={stop.id} className="rounded-md border border-zinc-900 bg-[#101010] p-4">
                  <p className="text-sm font-semibold text-white">
                    {index + 1}. {stop.location?.name}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {[stop.location?.city, stop.location?.state].filter(Boolean).join(", ") || stop.location?.address}
                  </p>
                </li>
              ))}
            </ol>
            <div className="fixed inset-x-0 bottom-0 bg-[#0a0a0a]/95 p-5 backdrop-blur">
              <button
                type="button"
                onClick={clockIn}
                disabled={clocking}
                className="h-14 w-full rounded-md bg-[#d4a843] font-heading text-sm font-semibold uppercase tracking-[0.12em] text-black disabled:opacity-60"
              >
                {clocking ? "Starting" : "Clock In & Start Route"}
              </button>
            </div>
          </section>
        ) : null}

        {completedSummary ? (
          <section className="rounded-md border border-zinc-800 bg-[#111] p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">Shift Complete</p>
            <h2 className="mt-2 font-heading text-2xl font-semibold">{completedSummary.completed} stops completed</h2>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-black/40 p-3">
                <p className="text-zinc-500">Total Stops</p>
                <p className="text-xl text-white">{completedSummary.totalStops}</p>
              </div>
              <div className="rounded-md bg-black/40 p-3">
                <p className="text-zinc-500">Drive Time</p>
                <p className="text-xl text-white">{completedSummary.drive}m</p>
              </div>
              <div className="rounded-md bg-black/40 p-3">
                <p className="text-zinc-500">On Site</p>
                <p className="text-xl text-white">{completedSummary.onsite}m</p>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
