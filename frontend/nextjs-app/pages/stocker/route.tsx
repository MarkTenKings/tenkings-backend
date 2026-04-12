import dynamic from "next/dynamic";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useStockerShift } from "../../hooks/useStockerShift";
import type { GeofenceEvent, LocationSummary, StockerStopData } from "../../types/stocker";

const ActiveRouteMap = dynamic(() => import("../../components/stocker/ActiveRouteMap"), { ssr: false });

type LatLng = { lat: number; lng: number };

function formatElapsed(clockInAt: string | null | undefined) {
  if (!clockInAt) return "00:00";
  const elapsed = Math.max(0, Date.now() - new Date(clockInAt).getTime());
  const totalMinutes = Math.floor(elapsed / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function distanceText(meters: number | null) {
  if (meters == null) return "GPS pending";
  if (meters < 1609) return `${Math.round(meters)} m`;
  return `${(meters / 1609).toFixed(1)} mi`;
}

function haversine(a: LatLng, b: LatLng) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export default function StockerRoutePage() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const { shift, loading: shiftLoading, refresh } = useStockerShift(session?.token);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState("00:00");
  const [ending, setEnding] = useState(false);
  const lastReportAtRef = useRef(0);
  const shiftRef = useRef(shift);

  useEffect(() => {
    shiftRef.current = shift;
  }, [shift]);

  useEffect(() => {
    if (!loading && !session) ensureSession().catch(() => router.replace("/stocker"));
  }, [ensureSession, loading, router, session]);

  useEffect(() => {
    if (!shiftLoading && shift && shift.status !== "active") void router.replace("/stocker/dashboard");
  }, [router, shift, shiftLoading]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(formatElapsed(shiftRef.current?.clockInAt)), 1000);
    return () => clearInterval(timer);
  }, []);

  const stops = useMemo(
    () => ((shift?.stops ?? []).filter((stop) => stop.location) as Array<StockerStopData & { location: LocationSummary }>),
    [shift?.stops],
  );
  const nextStop = useMemo(
    () => stops.find((stop) => stop.status === "in_transit" || stop.status === "arrived" || stop.status === "restocking") ?? stops.find((stop) => stop.status === "pending") ?? null,
    [stops],
  );
  const nextDistance = useMemo(() => {
    if (!position || !nextStop?.location.latitude || !nextStop.location.longitude) return null;
    return haversine(position, { lat: nextStop.location.latitude, lng: nextStop.location.longitude });
  }, [nextStop, position]);

  useEffect(() => {
    if (!session?.token || !shift?.id || typeof navigator === "undefined" || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (geo) => {
        const next = { lat: geo.coords.latitude, lng: geo.coords.longitude };
        setPosition(next);
        setAccuracy(geo.coords.accuracy);
        const now = Date.now();
        if (now - lastReportAtRef.current < 10000) return;
        lastReportAtRef.current = now;
        fetch("/api/stocker/position", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({
            shiftId: shift.id,
            latitude: geo.coords.latitude,
            longitude: geo.coords.longitude,
            speed: geo.coords.speed,
            heading: geo.coords.heading,
            accuracy: geo.coords.accuracy,
            timestamp: geo.timestamp,
          }),
        })
          .then((response) => response.json().catch(() => null))
          .then((payload) => {
            const events = (payload?.data?.geofence ?? []) as GeofenceEvent[];
            const locationEvent = events.find((event) => event.type === "location_entered" || event.type === "machine_reached");
            if (locationEvent?.stopId) void router.push(`/stocker/stop/${locationEvent.stopId}`);
          })
          .catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [router, session?.token, shift?.id]);

  const skipStop = async () => {
    if (!nextStop || !session?.token) return;
    const reason = window.prompt("Why are you skipping this stop?");
    if (!reason?.trim()) return;
    await fetch(`/api/stocker/stop/${nextStop.id}/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ reason }),
    });
    await refresh();
  };

  const endRoute = async () => {
    if (!shift || !session?.token) return;
    setEnding(true);
    await fetch("/api/stocker/shift/clock-out", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ shiftId: shift.id }),
    });
    await router.replace("/stocker/dashboard");
  };

  return (
    <>
      <Head>
        <title>Active Route | Ten Kings</title>
      </Head>
      <main className="relative h-[100dvh] overflow-hidden bg-[#050505] text-white">
        <ActiveRouteMap stops={stops} encodedPolyline={shift?.route?.encodedPolyline ?? null} userPosition={position} nextStopId={nextStop?.id ?? null} />
        <div className="absolute right-4 top-4 rounded-md border border-zinc-800 bg-black/75 px-3 py-2 font-mono text-sm text-[#d4a843] backdrop-blur">
          {elapsed}
        </div>
        <section className="absolute inset-x-3 bottom-3 rounded-md border border-zinc-800 bg-[#111]/90 p-4 shadow-2xl backdrop-blur">
          {shiftLoading ? <p className="text-sm text-zinc-400">Loading route...</p> : null}
          {nextStop ? (
            <>
              <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">
                Stop {nextStop.stopOrder + 1} of {stops.length}
              </p>
              <h1 className="mt-1 font-heading text-xl font-semibold">{nextStop.location.name}</h1>
              <p className="mt-1 text-sm text-zinc-400">
                {distanceText(nextDistance)} · {accuracy ? `GPS +/- ${Math.round(accuracy)}m` : "ETA pending"}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <button type="button" onClick={skipStop} className="rounded-md border border-[#d4a843]/50 px-4 py-2 text-xs uppercase tracking-[0.16em] text-[#d4a843]">
                  Skip Stop
                </button>
                <button type="button" onClick={() => router.push(`/stocker/stop/${nextStop.id}`)} className="rounded-md bg-[#d4a843] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-black">
                  Open Stop
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="font-heading text-xl font-semibold">All stops handled</h1>
              <p className="mt-1 text-sm text-zinc-400">End the route to complete your shift summary.</p>
              <button disabled={ending} type="button" onClick={endRoute} className="mt-4 h-12 w-full rounded-md bg-[#d4a843] text-sm font-semibold uppercase tracking-[0.16em] text-black disabled:opacity-60">
                {ending ? "Ending" : "End Route"}
              </button>
            </>
          )}
        </section>
      </main>
    </>
  );
}
