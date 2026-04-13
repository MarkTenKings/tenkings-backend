import dynamic from "next/dynamic";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../../../../hooks/useSession";
import type { WalkingGuidanceData } from "../../../../types/stocker";

const TenKingsMap = dynamic(() => import("../../../../components/maps/TenKingsMap"), { ssr: false });

type LatLng = { lat: number; lng: number };

function haversine(a: LatLng, b: LatLng) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export default function StockerStopPage() {
  const router = useRouter();
  const stopId = typeof router.query.stopId === "string" ? router.query.stopId : "";
  const shiftId = typeof router.query.shiftId === "string" ? router.query.shiftId : "";
  const { session, loading, ensureSession } = useSession();
  const [position, setPosition] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [guidance, setGuidance] = useState<WalkingGuidanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (!loading && !session) ensureSession().catch(() => router.replace("/stocker"));
  }, [ensureSession, loading, router, session]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (geo) => {
        setPosition({ lat: geo.coords.latitude, lng: geo.coords.longitude });
        setAccuracy(geo.coords.accuracy);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    if (!stopId || !position || !session?.token) return;
    fetch(`/api/stocker/stop/${stopId}/guidance?lat=${position.lat}&lng=${position.lng}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload?.message ?? payload?.error?.message ?? "Unable to load guidance");
        setGuidance(payload.data);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load guidance"));
  }, [position, session?.token, stopId]);

  const machineDistance = useMemo(() => {
    if (!position || !guidance) return null;
    return haversine(position, guidance.machineLocation);
  }, [guidance, position]);
  const canComplete = machineDistance == null || machineDistance <= 15;

  const completeStop = async () => {
    if (!stopId || !session?.token || !position) return;
    setCompleting(true);
    setError(null);
    try {
      await fetch(`/api/stocker/stop/${stopId}/arrive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ latitude: position.lat, longitude: position.lng, timestamp: Date.now() }),
      });
      const depart = await fetch(`/api/stocker/stop/${stopId}/depart`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ timestamp: Date.now() }),
      });
      if (!depart.ok) {
        const payload = await depart.json().catch(() => null);
        throw new Error(payload?.message ?? "Unable to complete stop");
      }
      await router.replace({ pathname: "/stocker/route", query: shiftId ? { shiftId } : {} });
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Unable to complete stop");
      setCompleting(false);
    }
  };

  const center = position ?? guidance?.machineLocation ?? { lat: 38.5758, lng: -121.4789 };

  return (
    <>
      <Head>
        <title>Indoor Guidance | Ten Kings</title>
      </Head>
      <main className="min-h-screen bg-[#0a0a0a] text-white">
        <section className="relative h-[55dvh] min-h-[24rem]">
          <TenKingsMap
            center={center}
            userPosition={position}
            userAccuracyM={accuracy}
            destination={guidance?.machineLocation ?? null}
            routePolyline={guidance?.encodedPolyline ?? null}
            interactive
            followUser
            heightClassName="h-full min-h-[24rem]"
          />
          <button
            type="button"
            onClick={() => router.push({ pathname: "/stocker/route", query: shiftId ? { shiftId } : {} })}
            className="absolute left-4 top-4 rounded-md border border-zinc-800 bg-black/70 px-3 py-2 text-xs uppercase tracking-[0.16em] text-zinc-300 backdrop-blur"
          >
            Back to Route
          </button>
          <div className="absolute right-4 top-4 rounded-md border border-zinc-800 bg-black/70 px-3 py-2 text-sm text-[#d4a843] backdrop-blur">
            {guidance ? `${guidance.walkingDistanceM}m · ${Math.round(guidance.walkingDurationS / 60)}m` : "GPS pending"}
          </div>
        </section>

        <section className="space-y-5 px-5 py-6">
          {error ? <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
          <div className="rounded-md border border-zinc-800 bg-[#111] p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">Machine Location</p>
            <h1 className="mt-2 font-heading text-2xl font-semibold">{guidance?.locationName ?? "Loading stop"}</h1>
            <p className="mt-3 text-sm text-zinc-300">
              {guidance?.landmarks?.length ? guidance.landmarks.join(" · ") : "Follow the map to the Ten Kings machine."}
            </p>
            {guidance?.locationDescription ? (
              <div className="mt-4 border-l-4 border-[#d4a843] bg-[#d4a843]/10 p-3 text-sm text-zinc-200">
                {guidance.locationDescription}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={completeStop}
            disabled={!canComplete || completing || !position}
            className="h-14 w-full rounded-md bg-[#d4a843] font-heading text-sm font-semibold uppercase tracking-[0.14em] text-black disabled:opacity-50"
          >
            {completing ? "Completing" : canComplete ? "Mark As Complete" : `Move closer (${Math.round(machineDistance ?? 0)}m)`}
          </button>
        </section>
      </main>
    </>
  );
}
