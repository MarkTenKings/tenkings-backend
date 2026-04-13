import dynamic from "next/dynamic";
import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../../../hooks/useSession";
import type { NavigationStep, WalkingGuidanceData } from "../../../../types/stocker";

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

function calculateBearing(a: LatLng, b: LatLng) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const toDeg = (value: number) => (value * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function formatLandmarks(landmarks: string[]) {
  const cleaned = landmarks.map((landmark) => landmark.trim()).filter(Boolean);
  if (cleaned.length >= 2) return `Between ${cleaned[0]} & ${cleaned[1]}`;
  return cleaned[0] ?? "Follow the map to the Ten Kings machine.";
}

function ManeuverIcon({ maneuver }: { maneuver: string }) {
  const iconMap: Record<string, string> = {
    TURN_LEFT: "↰",
    TURN_SLIGHT_LEFT: "↖",
    TURN_SHARP_LEFT: "↲",
    TURN_RIGHT: "↱",
    TURN_SLIGHT_RIGHT: "↗",
    TURN_SHARP_RIGHT: "↳",
    STRAIGHT: "↑",
    UTURN_LEFT: "↺",
    UTURN_RIGHT: "↻",
    RAMP_LEFT: "↰",
    RAMP_RIGHT: "↱",
    MERGE: "↑",
    FORK_LEFT: "↰",
    FORK_RIGHT: "↱",
    ROUNDABOUT_LEFT: "↰",
    ROUNDABOUT_RIGHT: "↱",
    DEPART: "↑",
    NAME_CHANGE: "↑",
  };

  return (
    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-white/15 text-[28px] text-white">
      {iconMap[maneuver] || "↑"}
    </div>
  );
}

function WalkingInstructionBanner({ step }: { step: NavigationStep }) {
  return (
    <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-4 bg-[#1a6b3c] px-5 py-4 shadow-[0_4px_12px_rgba(0,0,0,0.3)]">
      <ManeuverIcon maneuver={step.maneuver} />
      <div className="min-w-0 flex-1">
        <p className="m-0 font-sans text-lg font-bold leading-tight text-white">{step.instruction}</p>
        <p className="m-0 mt-1 font-sans text-[13px] text-white/70">
          {formatDistance(step.distanceMeters)} · {formatDuration(step.durationSeconds)}
        </p>
      </div>
    </div>
  );
}

export default function StockerStopPage() {
  const router = useRouter();
  const stopId = typeof router.query.stopId === "string" ? router.query.stopId : "";
  const shiftId = typeof router.query.shiftId === "string" ? router.query.shiftId : "";
  const { session, loading, ensureSession } = useSession();
  const positionRef = useRef<LatLng | null>(null);
  const previousPositionRef = useRef<LatLng | null>(null);
  const userHeadingRef = useRef<number | null>(null);
  const accuracyRef = useRef<number | null>(null);
  const guidanceRef = useRef<WalkingGuidanceData | null>(null);
  const lastGuidanceRequestRef = useRef<{ at: number; position: LatLng } | null>(null);
  const guidanceRequestIdRef = useRef(0);
  const [positionSnapshot, setPositionSnapshot] = useState<LatLng | null>(null);
  const [accuracySnapshot, setAccuracySnapshot] = useState<number | null>(null);
  const [guidance, setGuidance] = useState<WalkingGuidanceData | null>(null);
  const [liveDistanceM, setLiveDistanceM] = useState<number | null>(null);
  const [liveDurationS, setLiveDurationS] = useState<number | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [cardCollapsed, setCardCollapsed] = useState(false);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const [routeStatus, setRouteStatus] = useState("Waiting for GPS");
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (!loading && !session) ensureSession().catch(() => router.replace("/stocker"));
  }, [ensureSession, loading, router, session]);

  useEffect(() => {
    userHeadingRef.current = userHeading;
  }, [userHeading]);

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
        const previousPosition = previousPositionRef.current;
        const nextHeading =
          Number.isFinite(geo.coords.heading ?? NaN) && geo.coords.heading != null
            ? geo.coords.heading
            : previousPosition && haversine(previousPosition, nextPosition) > 2
              ? calculateBearing(previousPosition, nextPosition)
              : userHeadingRef.current;
        previousPositionRef.current = nextPosition;
        positionRef.current = nextPosition;
        accuracyRef.current = geo.coords.accuracy;
        setPositionSnapshot(nextPosition);
        setAccuracySnapshot(geo.coords.accuracy);
        if (typeof nextHeading === "number" && Number.isFinite(nextHeading)) {
          setUserHeading(nextHeading);
        }
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

  useEffect(() => {
    setCurrentStepIndex(0);
  }, [guidance?.encodedPolyline]);

  const guidanceSteps = useMemo(() => guidance?.steps ?? [], [guidance?.steps]);

  useEffect(() => {
    if (!positionSnapshot || guidanceSteps.length === 0) return;
    const step = guidanceSteps[currentStepIndex];
    if (!step) return;
    const distanceToStepEnd = haversine(positionSnapshot, { lat: step.endLat, lng: step.endLng });
    if (distanceToStepEnd <= 30 && currentStepIndex < guidanceSteps.length - 1) {
      setCurrentStepIndex((index) => Math.min(index + 1, guidanceSteps.length - 1));
    }
  }, [currentStepIndex, guidanceSteps, positionSnapshot]);

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
  const currentStep = guidanceSteps[currentStepIndex] ?? guidanceSteps[0] ?? null;

  return (
    <>
      <Head>
        <title>Indoor Guidance | Ten Kings</title>
      </Head>
      <main className="relative h-[100dvh] overflow-hidden bg-[#0a0a0a] text-white">
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
          initialZoom={20}
          minimumInitialZoom={20}
          recenterZoom={20}
          mapTypeId="roadmap"
          colorScheme="LIGHT"
          userHeading={userHeading}
          disableDefaultUI={false}
          initialFrameKey={frameKey}
          heightClassName="h-full min-h-[80dvh]"
          className="tk-google-map--edge h-full rounded-none"
        />
        {currentStep ? <WalkingInstructionBanner step={currentStep} /> : null}
        {!cardCollapsed ? (
          <button
            type="button"
            onClick={() => router.push({ pathname: "/stocker/route", query: shiftId ? { shiftId } : {} })}
            className="absolute left-4 top-24 z-20 rounded-md border border-zinc-800 bg-black/70 px-3 py-2 text-xs uppercase tracking-[0.16em] text-zinc-300 backdrop-blur"
          >
            Back to Route
          </button>
        ) : null}
        {cardCollapsed ? (
          <div className="absolute bottom-[70px] left-1/2 z-[25] flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#d4a843]/30 bg-black/80 px-5 py-2 backdrop-blur">
            <span className="text-base font-bold text-[#d4a843]">{displayDistanceM != null ? formatDistance(displayDistanceM) : "GPS pending"}</span>
            <span className="text-zinc-600">·</span>
            <span className="text-sm text-zinc-300">{durationLabel || "ETA pending"}</span>
          </div>
        ) : null}
        <section
          className="absolute inset-x-0 bottom-0 z-20 overflow-hidden rounded-t-md border-t border-zinc-800 bg-[#111]/95 shadow-2xl backdrop-blur transition-all duration-300"
          style={{ maxHeight: cardCollapsed ? 60 : 340 }}
        >
          <button type="button" onClick={() => setCardCollapsed((collapsed) => !collapsed)} className="block w-full px-3 py-3" aria-label={cardCollapsed ? "Expand machine details" : "Collapse machine details"}>
            <span className="mx-auto block h-1 w-10 rounded-sm bg-zinc-700" />
          </button>
          {cardCollapsed ? (
            <div className="flex items-center justify-between gap-3 px-5 pb-4">
              <span className="font-heading text-base font-bold text-[#d4a843]">{displayDistanceM != null ? formatDistance(displayDistanceM) : "GPS pending"}</span>
              <span className="truncate text-sm text-zinc-400">
                {durationLabel || "ETA pending"} · {guidance?.locationName ?? "Machine"}
              </span>
            </div>
          ) : (
            <div className="space-y-4 px-5 pb-5">
              {error ? <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">Machine Location</p>
                  {guidance?.hasIndoorMap ? <span className="rounded-full border border-[#d4a843]/40 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[#d4a843]">Floor Plan Available</span> : null}
                </div>
                <h1 className="mt-2 font-heading text-2xl font-semibold">{guidance?.locationName ?? "Loading stop"}</h1>
                <div className="mt-3 grid gap-2 text-sm text-zinc-300">
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
                  <p className="text-xs text-zinc-500">{routeStatus}. Pinch and zoom to reveal indoor floor plans where Google supports them.</p>
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
            </div>
          )}
        </section>
      </main>
    </>
  );
}
