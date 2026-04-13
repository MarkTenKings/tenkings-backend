import Head from "next/head";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AppShell from "../../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import type { StockRouteData, StockerProfileData, StockerShiftData } from "../../../types/stocker";

type StockerRow = StockerProfileData & { _count?: { shifts: number } };
type ShiftRow = StockerShiftData & { _count?: { stops: number }; stopsCompleted?: number };

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function StockerShiftsPage() {
  const { session, loading, ensureSession } = useSession();
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  const [stockers, setStockers] = useState<StockerRow[]>([]);
  const [routes, setRoutes] = useState<StockRouteData[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [stockerId, setStockerId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [assignedDate, setAssignedDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [updatingShiftId, setUpdatingShiftId] = useState<string | null>(null);

  const hasSession = Boolean(session);
  const load = useCallback(async () => {
    if (!session?.token || !isAdmin) return;
    const headers = { Authorization: `Bearer ${session.token}` };
    const [stockerResponse, routeResponse, shiftResponse] = await Promise.all([
      fetch("/api/admin/stocker/list", { headers }),
      fetch("/api/admin/stocker/routes?pageSize=100", { headers }),
      fetch("/api/admin/stocker/shifts", { headers }),
    ]);
    const [stockerPayload, routePayload, shiftPayload] = await Promise.all([stockerResponse.json(), routeResponse.json(), shiftResponse.json()]);
    setStockers(stockerPayload.data ?? []);
    setRoutes(routePayload.data ?? []);
    setShifts(shiftPayload.data ?? []);
  }, [isAdmin, session?.token]);

  useEffect(() => {
    if (!loading && !hasSession) ensureSession().catch(() => undefined);
    void load();
  }, [ensureSession, hasSession, loading, load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/admin/stocker/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.token}` },
      body: JSON.stringify({ stockerId, routeId, assignedDate }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.message ?? "Unable to assign shift");
      return;
    }
    setStockerId("");
    setRouteId("");
    await load();
  };

  const patchShift = async (shiftId: string, body: Record<string, unknown>) => {
    setUpdatingShiftId(shiftId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/stocker/shifts/${shiftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.token}` },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Unable to update shift");
      await load();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Unable to update shift");
    } finally {
      setUpdatingShiftId(null);
    }
  };

  const cancelShift = async (shiftId: string) => {
    if (!window.confirm("Cancel this pending shift?")) return;
    await patchShift(shiftId, { status: "cancelled" });
  };

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>Stocker Shifts | Ten Kings</title>
      </Head>
      <main className="mx-auto w-full max-w-6xl px-6 py-10 text-white">
        <h1 className="font-heading text-3xl text-[#d4a843]">Shift Management</h1>
        {!isAdmin && !loading ? <p className="mt-6 text-red-300">Admin access required.</p> : null}
        <form onSubmit={submit} className="mt-8 grid gap-3 rounded-md border border-zinc-800 bg-[#111] p-5 md:grid-cols-[1fr_1fr_180px_auto]">
          <select value={stockerId} onChange={(event) => setStockerId(event.target.value)} className="rounded-md border border-zinc-800 bg-black px-3 py-3">
            <option value="">Select stocker</option>
            {stockers.map((stocker) => <option key={stocker.id} value={stocker.id}>{stocker.name}</option>)}
          </select>
          <select value={routeId} onChange={(event) => setRouteId(event.target.value)} className="rounded-md border border-zinc-800 bg-black px-3 py-3">
            <option value="">Select route</option>
            {routes.map((route) => <option key={route.id} value={route.id}>{route.name} ({route.locationIds.length})</option>)}
          </select>
          <input type="date" value={assignedDate} onChange={(event) => setAssignedDate(event.target.value)} className="rounded-md border border-zinc-800 bg-black px-3 py-3" />
          <button disabled={!stockerId || !routeId} className="rounded-md bg-[#d4a843] px-5 py-3 font-semibold uppercase tracking-[0.14em] text-black disabled:opacity-50">
            Assign
          </button>
          {error ? <p className="text-sm text-red-300 md:col-span-4">{error}</p> : null}
        </form>

        <section className="mt-8 space-y-3">
          {shifts.map((shift) => (
            <article key={shift.id} className="grid gap-3 rounded-md border border-zinc-800 bg-[#111] p-5 md:grid-cols-[1.2fr_1fr_1fr_1fr_1.2fr]">
              <div>
                <p className="font-heading text-lg">{shift.stocker?.name ?? shift.stockerId}</p>
                <p className="text-sm text-zinc-500">{shift.stocker?.phone}</p>
              </div>
              <div>
                <p className="text-sm text-white">{shift.route?.name}</p>
                <p className="text-sm text-zinc-500">{shift.assignedDate}</p>
              </div>
              <div>
                <p className="text-sm uppercase tracking-[0.14em] text-[#d4a843]">{shift.status}</p>
                <p className="text-sm text-zinc-500">{shift.stopsCompleted ?? 0} / {shift._count?.stops ?? shift.stops?.length ?? 0} stops</p>
              </div>
              <div className="text-sm text-zinc-500">
                <p>In: {shift.clockInAt ? new Date(shift.clockInAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "pending"}</p>
                <p>Out: {shift.clockOutAt ? new Date(shift.clockOutAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "pending"}</p>
              </div>
              <div className="flex flex-col gap-2">
                {shift.status === "pending" ? (
                  <>
                    <select
                      value={shift.stockerId}
                      disabled={updatingShiftId === shift.id}
                      onChange={(event) => patchShift(shift.id, { stockerId: event.target.value })}
                      className="rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
                    >
                      {stockers.map((stocker) => (
                        <option key={stocker.id} value={stocker.id}>{stocker.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={updatingShiftId === shift.id}
                      onClick={() => cancelShift(shift.id)}
                      className="rounded-md border border-red-500/60 px-3 py-2 text-xs uppercase tracking-[0.14em] text-red-400 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <p className="text-xs uppercase tracking-[0.14em] text-zinc-600">Locked</p>
                )}
              </div>
            </article>
          ))}
        </section>
      </main>
    </AppShell>
  );
}
