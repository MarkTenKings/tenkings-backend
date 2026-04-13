import Head from "next/head";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AppShell from "../../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import type { LocationSummary, StockRouteData } from "../../../types/stocker";

type RouteRow = StockRouteData & { _count?: { shifts: number }; locations?: LocationSummary[] };

export default function StockerRoutesPage() {
  const { session, loading, ensureSession } = useSession();
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedLocations = useMemo(() => selectedIds.map((id) => locations.find((loc) => loc.id === id)).filter(Boolean) as LocationSummary[], [locations, selectedIds]);

  const hasSession = Boolean(session);
  const load = useCallback(async () => {
    if (!session?.token || !isAdmin) return;
    const authHeaders: HeadersInit = { Authorization: `Bearer ${session.token}` };
    const [routesResponse, locationsResponse] = await Promise.all([
      fetch("/api/admin/stocker/routes", { headers: authHeaders }),
      fetch("/api/locations?mapOnly=true&includeInactive=false"),
    ]);
    const routesPayload = await routesResponse.json();
    const locationsPayload = await locationsResponse.json();
    setRoutes(routesPayload.data ?? []);
    setLocations(
      (locationsPayload.locations ?? []).map((location: any) => ({
        id: location.id,
        slug: location.slug,
        name: location.name,
        address: location.address,
        city: location.city ?? null,
        state: location.state ?? null,
        latitude: location.latitude ?? null,
        longitude: location.longitude ?? null,
        venueCenterLat: location.venueCenterLat ?? null,
        venueCenterLng: location.venueCenterLng ?? null,
        geofenceRadiusM: location.geofenceRadiusM ?? 500,
        machineLat: location.machineLat ?? null,
        machineLng: location.machineLng ?? null,
        machineGeofenceM: location.machineGeofenceM ?? 20,
        description: location.description ?? null,
        landmarks: Array.isArray(location.landmarks) ? location.landmarks : [],
      })),
    );
  }, [isAdmin, session?.token]);

  useEffect(() => {
    if (!loading && !hasSession) ensureSession().catch(() => undefined);
    void load();
  }, [ensureSession, hasSession, loading, load]);

  const toggleLocation = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  };

  const moveSelected = (id: string, direction: -1 | 1) => {
    setSelectedIds((prev) => {
      const index = prev.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  };

  const createRoute = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/stocker/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.token}` },
        body: JSON.stringify({ name, description, locationIds: selectedIds, optimize: true }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.message ?? "Unable to create route");
      setName("");
      setDescription("");
      setSelectedIds([]);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create route");
    } finally {
      setSaving(false);
    }
  };

  const optimizeExisting = async (routeId: string) => {
    await fetch(`/api/admin/stocker/routes/${routeId}/optimize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.token}` },
    });
    await load();
  };

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>Stocker Routes | Ten Kings</title>
      </Head>
      <main className="mx-auto w-full max-w-6xl px-6 py-10 text-white">
        <h1 className="font-heading text-3xl text-[#d4a843]">Route Management</h1>
        {!isAdmin && !loading ? <p className="mt-6 text-red-300">Admin access required.</p> : null}
        <form onSubmit={createRoute} className="mt-8 grid gap-5 rounded-md border border-zinc-800 bg-[#111] p-5 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Route name" className="w-full rounded-md border border-zinc-800 bg-black px-3 py-3 outline-none focus:border-[#d4a843]" />
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Route notes" className="min-h-24 w-full rounded-md border border-zinc-800 bg-black px-3 py-3 outline-none focus:border-[#d4a843]" />
            <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-zinc-900 p-3">
              {locations.map((location) => (
                <label key={location.id} className="flex items-center gap-3 text-sm text-zinc-300">
                  <input type="checkbox" checked={selectedIds.includes(location.id)} onChange={() => toggleLocation(location.id)} />
                  <span>{location.name}</span>
                  <span className="text-zinc-600">{location.city}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">Selected Stops</p>
            {selectedLocations.length === 0 ? <p className="text-sm text-zinc-500">Choose locations to build a route.</p> : null}
            {selectedLocations.map((location, index) => (
              <div key={location.id} className="flex items-center justify-between rounded-md border border-zinc-800 bg-black/40 p-3">
                <span className="text-sm">
                  {index + 1}. {location.name}
                </span>
                <span className="flex gap-2 text-xs text-zinc-400">
                  <button type="button" onClick={() => moveSelected(location.id, -1)}>Up</button>
                  <button type="button" onClick={() => moveSelected(location.id, 1)}>Down</button>
                </span>
              </div>
            ))}
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <button disabled={saving || !name || selectedIds.length === 0} className="h-12 w-full rounded-md bg-[#d4a843] font-semibold uppercase tracking-[0.14em] text-black disabled:opacity-50">
              {saving ? "Optimizing" : "Optimize Order & Save Route"}
            </button>
          </div>
        </form>

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          {routes.map((route) => (
            <article key={route.id} className="rounded-md border border-zinc-800 bg-[#111] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-heading text-xl">{route.name}</h2>
                  <p className="mt-1 text-sm text-zinc-500">{route.locationIds.length} stops · {route.totalDistanceM ? `${Math.round(route.totalDistanceM / 1609)} mi` : "distance pending"}</p>
                </div>
                <button type="button" onClick={() => optimizeExisting(route.id)} className="rounded-md border border-[#d4a843]/50 px-3 py-2 text-xs uppercase tracking-[0.14em] text-[#d4a843]">
                  Re-optimize
                </button>
              </div>
              <ol className="mt-4 space-y-1 text-sm text-zinc-400">
                {(route.locations ?? []).map((location, index) => (
                  <li key={location.id}>{index + 1}. {location.name}</li>
                ))}
              </ol>
            </article>
          ))}
        </section>
      </main>
    </AppShell>
  );
}
