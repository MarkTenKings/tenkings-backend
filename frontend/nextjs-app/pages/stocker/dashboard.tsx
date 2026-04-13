import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useStockerShift } from "../../hooks/useStockerShift";
import type { StockerShiftData } from "../../types/stocker";

function formatDate() {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "Time pending";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `~${minutes} min`;
  return `~${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDistance(meters: number | null | undefined) {
  if (!meters) return "Distance pending";
  return `${Math.max(1, Math.round(meters / 1609))} miles`;
}

function formatStatus(status: StockerShiftData["status"]) {
  if (status === "active") return "In Progress";
  if (status === "completed") return "Complete";
  if (status === "cancelled") return "Cancelled";
  return "Ready";
}

function completedSummary(shift: StockerShiftData) {
  const stops = shift.stops ?? [];
  return {
    totalStops: stops.length,
    completed: stops.filter((stop) => stop.status === "completed").length,
    drive: shift.totalDriveTimeMin ?? 0,
    onsite: shift.totalOnSiteTimeMin ?? 0,
  };
}

export default function StockerDashboardPage() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const { shifts, loading: shiftLoading, error, refresh } = useStockerShift(session?.token);
  const [clockingShiftId, setClockingShiftId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !session) {
      ensureSession().catch(() => router.replace("/stocker"));
    }
  }, [ensureSession, loading, router, session]);

  const availableShifts = useMemo(() => shifts.filter((shift) => shift.status === "pending" || shift.status === "active"), [shifts]);
  const completedShifts = useMemo(() => shifts.filter((shift) => shift.status === "completed"), [shifts]);
  const stockerName = useMemo(
    () => shifts.find((shift) => shift.stocker?.name)?.stocker?.name ?? session?.user.displayName ?? "Stocker",
    [session?.user.displayName, shifts],
  );

  const openShift = async (selectedShift: StockerShiftData) => {
    if (!session?.token) return;
    setActionError(null);

    if (selectedShift.status === "active") {
      await router.push({ pathname: "/stocker/route", query: { shiftId: selectedShift.id } });
      return;
    }

    if (selectedShift.status !== "pending") return;
    setClockingShiftId(selectedShift.id);
    try {
      const response = await fetch("/api/stocker/shift/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ shiftId: selectedShift.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? payload?.error?.message ?? "Unable to clock in");
      await router.push({ pathname: "/stocker/route", query: { shiftId: selectedShift.id } });
    } catch (clockInError) {
      setActionError(clockInError instanceof Error ? clockInError.message : "Unable to clock in");
    } finally {
      setClockingShiftId(null);
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
            <h1 className="font-heading text-2xl font-semibold">{stockerName}</h1>
            <p className="mt-1 text-sm text-zinc-500">{formatDate()}</p>
          </div>
          <Link href="/stocker" className="rounded-md border border-zinc-800 px-3 py-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
            Portal
          </Link>
        </header>

        {shiftLoading ? <p className="text-zinc-500">Loading route...</p> : null}
        {error ? <p className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</p> : null}
        {actionError ? <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">{actionError}</p> : null}

        {!shifts.length && !shiftLoading ? (
          <section className="flex min-h-[60vh] items-center justify-center text-center text-zinc-500">
            No route assigned for today. Contact your manager.
          </section>
        ) : null}

        {availableShifts.length ? (
          <section className="space-y-4 pb-10">
            <div className="rounded-md border border-zinc-800 bg-[#111] p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">Today&apos;s Shifts</p>
              <h2 className="mt-2 font-heading text-2xl font-semibold">
                {availableShifts.length} route{availableShifts.length === 1 ? "" : "s"} ready
              </h2>
              <p className="mt-2 text-sm text-zinc-400">Choose the route you want to work now.</p>
            </div>

            {availableShifts.map((assignedShift, shiftIndex) => {
              const isClocking = clockingShiftId === assignedShift.id;
              return (
                <article key={assignedShift.id} className="rounded-md border border-zinc-800 bg-[#101010] p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">
                        Shift {shiftIndex + 1} · {formatStatus(assignedShift.status)}
                      </p>
                      <h3 className="mt-2 font-heading text-xl font-semibold">{assignedShift.route?.name ?? "Assigned Route"}</h3>
                    </div>
                    <span className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-400">
                      {(assignedShift.stops ?? []).length} stops
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-zinc-400">
                    {formatDuration(assignedShift.route?.totalDurationS)} · {formatDistance(assignedShift.route?.totalDistanceM)}
                  </p>
                  <ol className="mt-4 space-y-2">
                    {(assignedShift.stops ?? []).map((stop, index) => (
                      <li key={stop.id} className="rounded-md border border-zinc-900 bg-black/30 p-3">
                        <p className="text-sm font-semibold text-white">
                          {index + 1}. {stop.location?.name}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {[stop.location?.city, stop.location?.state].filter(Boolean).join(", ") || stop.location?.address}
                        </p>
                      </li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    onClick={() => void openShift(assignedShift)}
                    disabled={Boolean(clockingShiftId)}
                    className="mt-5 h-14 w-full rounded-md bg-[#d4a843] px-4 font-heading text-sm font-semibold uppercase tracking-[0.12em] text-black disabled:opacity-60"
                  >
                    {assignedShift.status === "active" ? "Resume Route" : isClocking ? "Starting" : "Clock In & Start Route"}
                  </button>
                </article>
              );
            })}
          </section>
        ) : null}

        {completedShifts.length ? (
          <section className="space-y-4 pb-10">
            {completedShifts.map((completedShift) => {
              const summary = completedSummary(completedShift);
              return (
                <article key={completedShift.id} className="rounded-md border border-zinc-800 bg-[#111] p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">Shift Complete</p>
                  <h2 className="mt-2 font-heading text-2xl font-semibold">{completedShift.route?.name ?? "Completed Route"}</h2>
                  <p className="mt-1 text-sm text-zinc-400">{summary.completed} stops completed</p>
                  <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-black/40 p-3">
                      <p className="text-zinc-500">Total Stops</p>
                      <p className="text-xl text-white">{summary.totalStops}</p>
                    </div>
                    <div className="rounded-md bg-black/40 p-3">
                      <p className="text-zinc-500">Drive Time</p>
                      <p className="text-xl text-white">{summary.drive}m</p>
                    </div>
                    <div className="rounded-md bg-black/40 p-3">
                      <p className="text-zinc-500">On Site</p>
                      <p className="text-xl text-white">{summary.onsite}m</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
      </main>
    </>
  );
}
