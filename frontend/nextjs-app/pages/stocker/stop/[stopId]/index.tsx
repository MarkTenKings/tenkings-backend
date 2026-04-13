import dynamic from "next/dynamic";
import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../../../hooks/useSession";
import type { WalkingGuidanceData } from "../../../../types/stocker";

const TenKingsMap = dynamic(() => import("../../../../components/maps/TenKingsMap"), { ssr: false });

type LatLng = { lat: number; lng: number };

const WALKING_SPEED_MPS = 1.4;
const ROUTE_REFRESH_MS = 30000;
const ROUTE_REFRESH_DISTANCE_M = 30;

function haversine(a: LatLng, b: LatLng) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

function formatDistance(distanceM: number | null) {
  if (distanceM == null) return "GPS pending";
  if (distanceM >= 1000) return `${(distanceM / 1000).toFixed(1)}km`;
  return `${Math.round(distanceM)}m`;
}

function formatDuration(durationS: number | null) {
  if (durationS == null) return "";
  return `${Math.max(1, Math.round(durationS / 60))}min`;
}

function formatLandmarks(landmarks: string[]) {
  const cleaned = landmarks.map((landmark) => landmark.trim()).filter(Boolean);
  if (cleaned.length >= 2) return `Between ${cleaned[0]} & ${cleaned[1]}`;
  return cleaned[0] ?? "Follow the map to the Ten Kings machine.";
}

export default function StockerStopPage() {
  const router = useRouter();
  const stopId = typeof router.query.stopId === "string" ? router.query.stopId : "";
  const shiftId = typeof router.query.shiftId === "string" ? router.query.shiftId : "";
  const { session, loading, ensureSession } = useSession();
  const positionRef = useRef<LatLng | null>(null);
  const accuracyRef = useRef<number | null>(null);
  const guidanceRef = useRef<WalkingGuidanceData | null>(null);
  const lastGuidanceRequestRef = useRef<{ at: number; position: LatLng } | null>(null);
  const guidanceRequestIdRef = useRef(0);
  const [positionSnapshot, setPositionSnapshot] = useState<LatLng | null>(null);
  const [accuracySnapshot, setAccuracySnapshot] = useState<number | null>(null);
  const [guidance, setGuidance] = useState<WalkingGuidanceData | null>(null);
  const [liveDistanceM, setLiveDistanceM] = useState<number | null>(null);
  const [liveDurationS, setLiveDurationS] = useState<number | null>(null);
  const [routeStatus, setRouteStatus] = useState("Waiting for GPS");
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (!loading && !session) ensureSession().catch(() => router.replace("/stocker"));
  }, [ensureSession, loading, router, session]);

  const updateLiveMetrics = useCallback((nextPosition: LatLng, nextGuidance: WalkingGuidanceData | null = guidanceRef.current) => {
    if (!nextGuidance) {
      setLiveDistanceM(null);
      setLiveDurationS(null);
      return;
    }

    const distanceM = haversine(nextPosition, nextGuidance.machineLocation);
    setLiveDistanceM(distanceM);
    setLiveDurationS(distanceM / WALKING_SPEED_MPS);
  }, []);

  const loadGuidance = useCallback(
    async (nextPosition: LatLng, force = false) => {
      if (!stopId || !session?.token) return;

      const now = Date.now();
      const last = lastGuidanceRequestRef.current;
      const movedSinceLastRouteM = last ? haversine(last.position, nextPosition) : Number.POSITIVE_INFINITY;
      const shouldRefresh = force || !last || now - last.at >= ROUTE_REFRESH_MS || movedSinceLastRouteM >= ROUTE_REFRESH_DISTANCE_M;
      if (!shouldRefresh) return;

      lastGuidanceRequestRef.current = { at: now, position: nextPosition };
      const requestId = guidanceRequestIdRef.current + 1;
      guidanceRequestIdRef.current = requestId;
      setRouteStatus("Updating walking route");

      try {
        const response = await fetch(`/api/stocker/stop/${stopId}/guidance?lat=${nextPosition.lat}&lng=${nextPosition.lng}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.message ?? payload?.error?.message ?? "Unable to load guidance");
        if (guidanceRequestIdRef.current !== requestId) return;

        const nextGuidance = payload.data as WalkingGuidanceData;
        guidanceRef.current = nextGuidance;
        setGuidance(nextGuidance);
        updateLiveMetrics(nextPosition, nextGuidance);
        setRouteStatus("Walking route ready");
        setError(null);
      } catch (loadError) {
        if (guidanceRequestIdRef.current === requestId) {
          setRouteStatus("Route update failed");
          setError(loadError instanceof Error ? loadError.message : "Unable to load guidance");
        }
      }
    },
    [session?.token, stopId, updateLiveMetrics],
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setRouteStatus("GPS unavailable");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (geo) => {
        const nextPosition = { lat: geo.coords.latitude, lng: geo.coords.longitude };
        positionRef.current = nextPosition;
        accuracyRef.current = geo.coords.accuracy;
        setPositionSnapshot(nextPosition);
        setAccuracySnapshot(geo.coords.accuracy);
        updateLiveMetrics(nextPosition);
        void loadGuidance(nextPosition);
      },
      () => setRouteStatus("GPS permission needed"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [loadGuidance, updateLiveMetrics]);

  useEffect(() => {
    if (positionRef.current && session?.token && stopId) {
      void loadGuidance(positionRef.current, true);
    }
  }, [loadGuidance, session?.token, stopId]);

  const machineDistance = liveDistanceM;
  const machineGeofenceM = guidance?.machineGeofenceM ?? 20;
  const canComplete = machineDistance != null && machineDistance <= machineGeofenceM;
  const displayDistanceM = liveDistanceM ?? guidance?.walkingDistanceM ?? null;
  const displayDurationS = liveDurationS ?? guidance?.walkingDurationS ?? null;

  const completeStop = async () => {
    const currentPosition = positionRef.current;
    if (!stopId || !session?.token || !currentPosition) return;
    setCompleting(true);
    setError(null);
    try {
      await fetch(`/api/stocker/stop/${stopId}/arrive`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ latitude: currentPosition.lat, longitude: currentPosition.lng, timestamp: Date.now() }),
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

  const center = useMemo(() => {
    if (positionSnapshot && guidance?.machineLocation) return midpoint(positionSnapshot, guidance.machineLocation);
    return positionSnapshot ?? guidance?.machineLocation ?? { lat: 38.5758, lng: -121.4789 };
  }, [guidance?.machineLocation, positionSnapshot]);
  const fallbackRoutePath = !guidance?.encodedPolyline && positionSnapshot && guidance?.machineLocation ? [positionSnapshot, guidance.machineLocation] : null;
  const frameKey = guidance?.machineLocation && positionSnapshot ? `${guidance.machineLocation.lat.toFixed(6)},${guidance.machineLocation.lng.toFixed(6)}` : "waiting";
  const durationLabel = formatDuration(displayDurationS);

  return (
    <>
      <Head>
        <title>Indoor Guidance | Ten Kings</title>
      </Head>
      <main className="min-h-screen bg-[#0a0a0a] text-white">
        <section className="relative h-[55dvh] min-h-[24rem]">
          <TenKingsMap
            center={center}
            userPosition={positionSnapshot}
            userAccuracyM={accuracySnapshot}
            liveUserPositionRef={positionRef}
            liveUserAccuracyRef={accuracyRef}
            destination={guidance?.machineLocation ?? null}
            routePolyline={guidance?.encodedPolyline ?? null}
            routePath={fallbackRoutePath}
            interactive
            followCenter
            initialZoom={19}
            minimumInitialZoom={19}
            recenterZoom={19}
            mapTypeId="roadmap"
            disableDefaultUI={false}
            initialFrameKey={frameKey}
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
            {displayDistanceM != null ? `${formatDistance(displayDistanceM)}${durationLabel ? ` · ${durationLabel}` : ""}` : "GPS pending"}
          </div>
        </section>
        <p className="px-5 pt-2 text-center font-sans text-[11px] text-zinc-500">
          Zoom in on the map to see the indoor floor plan (available at select venues)
        </p>

        <section className="space-y-5 px-5 py-6">
          {error ? <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
          <div className="rounded-md border border-zinc-800 bg-[#111] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">Machine Location</p>
              {guidance?.hasIndoorMap ? <span className="rounded-full border border-[#d4a843]/40 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[#d4a843]">Floor Plan Available</span> : null}
            </div>
            <h1 className="mt-2 font-heading text-2xl font-semibold">{guidance?.locationName ?? "Loading stop"}</h1>
            <div className="mt-4 grid gap-3 text-sm text-zinc-300">
              <p>
                <span className="text-zinc-500">Machine location: </span>
                {guidance ? formatLandmarks(guidance.landmarks) : "Waiting for venue details"}
              </p>
              <p>
                <span className="text-zinc-500">Special instructions: </span>
                {guidance?.locationDescription?.trim() || "No special instructions saved for this location."}
              </p>
              <p>
                <span className="text-zinc-500">Walking time estimate: </span>
                {guidance?.walkingTimeMin ? `${guidance.walkingTimeMin} min` : displayDurationS != null ? formatDuration(displayDurationS) : "GPS pending"}
              </p>
              <p className="text-xs text-zinc-500">{routeStatus}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={completeStop}
            disabled={!canComplete || completing || !positionSnapshot}
            className="h-14 w-full rounded-md bg-[#d4a843] font-heading text-sm font-semibold uppercase tracking-[0.14em] text-black disabled:opacity-50"
          >
            {completing ? "Completing" : canComplete ? "Mark As Complete" : `Move closer (${Math.round(machineDistance ?? machineGeofenceM + 1)}m)`}
          </button>
        </section>
      </main>
    </>
  );
}
