import dynamic from "next/dynamic";
import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../../hooks/useSession";
import { useStockerShift } from "../../hooks/useStockerShift";
import type { DrivingNavigationData, GeofenceEvent, LocationSummary, NavigationStep, StockerStopData } from "../../types/stocker";

const ActiveRouteMap = dynamic(() => import("../../components/stocker/ActiveRouteMap"), { ssr: false });

type LatLng = { lat: number; lng: number };
type GpsStatus = "starting" | "tracking" | "unavailable" | "denied";
type GeoSnapshot = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
};

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

function etaText(seconds: number | null | undefined) {
  if (!seconds) return "ETA pending";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min ETA`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ETA`;
}

function formatShortDuration(seconds: number | null | undefined) {
  if (!seconds) return "ETA pending";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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

function NavigationBanner({ step }: { step: NavigationStep }) {
  return (
    <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-4 bg-[#1a6b3c] px-5 py-4 shadow-[0_4px_12px_rgba(0,0,0,0.3)]">
      <ManeuverIcon maneuver={step.maneuver} />
      <div className="min-w-0 flex-1">
        <p className="m-0 font-sans text-lg font-bold leading-tight text-white">{step.instruction}</p>
        <p className="m-0 mt-1 font-sans text-[13px] text-white/70">
          {distanceText(step.distanceMeters)} · {formatShortDuration(step.durationSeconds)}
        </p>
      </div>
    </div>
  );
}

function insideLocationGeofence(position: LatLng, location: LocationSummary) {
  const lat = location.venueCenterLat ?? location.latitude;
  const lng = location.venueCenterLng ?? location.longitude;
  if (lat == null || lng == null) return false;
  return haversine(position, { lat, lng }) <= location.geofenceRadiusM;
}

function drivingPositionForLocation(location: LocationSummary): LatLng | null {
  const lat = location.venueCenterLat ?? location.latitude;
  const lng = location.venueCenterLng ?? location.longitude;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
}

function buildGoogleMapsUrl(
  currentLat: number,
  currentLng: number,
  remainingStops: Array<{ latitude: number; longitude: number }>,
) {
  if (remainingStops.length === 0) return null;

  const destination = remainingStops[remainingStops.length - 1];
  const params = new URLSearchParams({
    api: "1",
    origin: `${currentLat},${currentLng}`,
    destination: `${destination.latitude},${destination.longitude}`,
    travelmode: "driving",
  });

  const waypoints = remainingStops
    .slice(0, -1)
    .map((stop) => `${stop.latitude},${stop.longitude}`)
    .join("|");
  if (waypoints) {
    params.set("waypoints", waypoints);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export default function StockerRoutePage() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const selectedShiftId = router.isReady && typeof router.query.shiftId === "string" ? router.query.shiftId : null;
  const { shift, loading: shiftLoading, refresh } = useStockerShift(router.isReady ? session?.token : undefined, selectedShiftId);
  const [position, setPosition] = useState<LatLng | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("starting");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<DrivingNavigationData | null>(null);
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [cardCollapsed, setCardCollapsed] = useState(false);
  const [userHeading, setUserHeading] = useState<number | null>(null);
  const [compassHeading, setCompassHeading] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState("00:00");
  const [ending, setEnding] = useState(false);
  const [arrivedStopId, setArrivedStopId] = useState<string | null>(null);
  const lastReportAtRef = useRef(0);
  const shiftRef = useRef(shift);
  const sessionRef = useRef(session);
  const latestGeoRef = useRef<GeoSnapshot | null>(null);
  const previousPositionRef = useRef<LatLng | null>(null);
  const userHeadingRef = useRef<number | null>(null);
  const nextStopRef = useRef<(StockerStopData & { location: LocationSummary }) | null>(null);
  const lastNavigationRef = useRef<{ position: LatLng | null; stopKey: string; at: number }>({ position: null, stopKey: "", at: 0 });

  useEffect(() => {
    shiftRef.current = shift;
  }, [shift]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!loading && !session) ensureSession().catch(() => router.replace("/stocker"));
  }, [ensureSession, loading, router, session]);

  useEffect(() => {
    if (!router.isReady || loading || shiftLoading || !session) return;
    if (!shift || shift.status !== "active") void router.replace("/stocker/dashboard");
  }, [loading, router, session, shift, shiftLoading]);

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
  const remainingStops = useMemo(
    () => stops.filter((stop) => stop.status !== "completed" && stop.status !== "skipped").sort((a, b) => a.stopOrder - b.stopOrder),
    [stops],
  );
  const remainingStopKey = useMemo(() => remainingStops.map((stop) => `${stop.id}:${stop.status}`).join("|"), [remainingStops]);
  const nextDistance = useMemo(() => {
    const nextPosition = nextStop ? drivingPositionForLocation(nextStop.location) : null;
    if (!position || !nextPosition) return null;
    return haversine(position, nextPosition);
  }, [nextStop, position]);
  const arrivedAtStop = useMemo(
    () =>
      stops.find((stop) => stop.id === arrivedStopId && (stop.status === "arrived" || stop.status === "restocking")) ??
      stops.find((stop) => stop.status === "arrived" || stop.status === "restocking") ??
      null,
    [arrivedStopId, stops],
  );
  const googleMapsNavigationUrl = useMemo(() => {
    if (!position || remainingStops.length === 0) return null;
    const navigationStops = remainingStops
      .map((stop) => drivingPositionForLocation(stop.location))
      .filter((stop): stop is LatLng => Boolean(stop))
      .map((stop) => ({ latitude: stop.lat, longitude: stop.lng }));
    return buildGoogleMapsUrl(position.lat, position.lng, navigationStops);
  }, [position, remainingStops]);
  const navigationSteps = useMemo(() => navigation?.steps ?? [], [navigation?.steps]);
  const currentStep = navigationSteps[currentStepIndex] ?? navigationSteps[0] ?? null;
  const mapHeading = compassHeading ?? userHeading;

  useEffect(() => {
    nextStopRef.current = nextStop;
  }, [nextStop]);

  useEffect(() => {
    userHeadingRef.current = userHeading;
  }, [userHeading]);

  useEffect(() => {
    setCurrentStepIndex(0);
  }, [navigation?.generatedAt]);

  useEffect(() => {
    if (!position || navigationSteps.length === 0) return;
    const step = navigationSteps[currentStepIndex];
    if (!step) return;
    const distanceToStepEnd = haversine(position, { lat: step.endLat, lng: step.endLng });
    if (distanceToStepEnd <= 30 && currentStepIndex < navigationSteps.length - 1) {
      setCurrentStepIndex((index) => Math.min(index + 1, navigationSteps.length - 1));
    }
  }, [currentStepIndex, navigationSteps, position]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.DeviceOrientationEvent === "undefined") return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const heading =
        (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading ??
        (typeof event.alpha === "number" ? 360 - event.alpha : null);
      if (typeof heading === "number" && Number.isFinite(heading)) {
        setCompassHeading(heading);
      }
    };

    const DeviceOrientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<string>;
    };

    if (typeof DeviceOrientation.requestPermission === "function") {
      DeviceOrientation.requestPermission()
        .then((state) => {
          if (state === "granted") window.addEventListener("deviceorientation", handleOrientation, true);
        })
        .catch(() => undefined);
    } else {
      window.addEventListener("deviceorientationabsolute", handleOrientation, true);
      window.addEventListener("deviceorientation", handleOrientation, true);
    }

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
      window.removeEventListener("deviceorientationabsolute", handleOrientation, true);
    };
  }, []);

  const reportPosition = useCallback(
    (snapshot: GeoSnapshot, force = false) => {
      const activeSession = sessionRef.current;
      const activeShift = shiftRef.current;
      if (!activeSession?.token || !activeShift?.id || activeShift.status !== "active") return;

      const now = Date.now();
      if (!force && now - lastReportAtRef.current < 5000) return;
      lastReportAtRef.current = now;

      fetch("/api/stocker/position", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${activeSession.token}` },
        body: JSON.stringify({
          shiftId: activeShift.id,
          latitude: snapshot.latitude,
          longitude: snapshot.longitude,
          speed: snapshot.speed,
          heading: snapshot.heading,
          accuracy: snapshot.accuracy,
          timestamp: snapshot.timestamp,
        }),
      })
        .then((response) => response.json().catch(() => null))
        .then((payload) => {
          const events = (payload?.data?.geofence ?? []) as GeofenceEvent[];
          const locationEvent = events.find((event) => event.type === "location_entered" || event.type === "machine_reached");
          if (locationEvent?.stopId) {
            setArrivedStopId(locationEvent.stopId);
            void refresh();
          }
        })
        .catch(() => undefined);
    },
    [refresh],
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus("unavailable");
      setGpsError("GPS is not available on this device.");
      return;
    }

    setGpsStatus("starting");
    setGpsError(null);
    const watchId = navigator.geolocation.watchPosition(
      (geo) => {
        const next = { lat: geo.coords.latitude, lng: geo.coords.longitude };
        const previous = previousPositionRef.current;
        const movementHeading =
          Number.isFinite(geo.coords.heading ?? NaN) && geo.coords.heading != null
            ? geo.coords.heading
            : previous && haversine(previous, next) > 2
              ? calculateBearing(previous, next)
              : userHeadingRef.current;
        const snapshot: GeoSnapshot = {
          latitude: geo.coords.latitude,
          longitude: geo.coords.longitude,
          accuracy: Number.isFinite(geo.coords.accuracy) ? geo.coords.accuracy : null,
          speed: Number.isFinite(geo.coords.speed ?? NaN) ? geo.coords.speed : null,
          heading: movementHeading,
          timestamp: geo.timestamp,
        };
        previousPositionRef.current = next;
        latestGeoRef.current = snapshot;
        setPosition(next);
        setAccuracy(snapshot.accuracy);
        if (typeof movementHeading === "number" && Number.isFinite(movementHeading)) {
          setUserHeading(movementHeading);
        }
        setGpsStatus("tracking");
        setGpsError(null);

        const activeNextStop = nextStopRef.current;
        const forceGeofenceCheck = activeNextStop ? insideLocationGeofence(next, activeNextStop.location) : false;
        reportPosition(snapshot, forceGeofenceCheck);
      },
      (geoError) => {
        setGpsStatus(geoError.code === geoError.PERMISSION_DENIED ? "denied" : "unavailable");
        setGpsError(geoError.message || "Unable to read live GPS.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [reportPosition]);

  useEffect(() => {
    if (shift?.status === "active" && latestGeoRef.current) {
      reportPosition(latestGeoRef.current, true);
    }
  }, [reportPosition, session?.token, shift?.id, shift?.status]);

  useEffect(() => {
    if (!session?.token || !shift?.id || shift.status !== "active" || !position || remainingStops.length === 0) {
      if (remainingStops.length === 0) setNavigation(null);
      return;
    }

    const now = Date.now();
    const previous = lastNavigationRef.current;
    const movedM = previous.position ? haversine(previous.position, position) : Number.POSITIVE_INFINITY;
    const stopsChanged = previous.stopKey !== remainingStopKey;
    if (!stopsChanged && movedM < 25 && now - previous.at < 15000) return;
    if (!stopsChanged && now - previous.at < 8000) return;

    lastNavigationRef.current = { position, stopKey: remainingStopKey, at: now };
    const controller = new AbortController();
    setNavigationLoading(true);
    setNavigationError(null);

    fetch("/api/stocker/route/navigation", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ shiftId: shift.id, latitude: position.lat, longitude: position.lng }),
    })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload?.message ?? payload?.error?.message ?? "Unable to update route");
        setNavigation(payload?.data?.navigation ?? null);
      })
      .catch((routeError) => {
        if (routeError instanceof DOMException && routeError.name === "AbortError") return;
        setNavigationError(routeError instanceof Error ? routeError.message : "Unable to update route");
      })
      .finally(() => {
        if (!controller.signal.aborted) setNavigationLoading(false);
      });

    return () => controller.abort();
  }, [position, remainingStopKey, remainingStops.length, session?.token, shift?.id, shift?.status]);

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
        <ActiveRouteMap
          stops={stops}
          encodedPolyline={navigation?.encodedPolyline ?? null}
          userPosition={position}
          userHeading={userHeading}
          mapHeading={mapHeading}
          nextStopId={nextStop?.id ?? null}
        />
        {currentStep && !arrivedAtStop ? <NavigationBanner step={currentStep} /> : null}
        {!cardCollapsed ? (
          <>
            <div className="absolute left-4 top-24 rounded-md border border-zinc-800 bg-black/75 px-3 py-2 text-xs uppercase tracking-[0.14em] text-zinc-300 backdrop-blur">
              {gpsError ? gpsStatus : gpsStatus === "tracking" ? "GPS tracking" : "Starting GPS"}
            </div>
            <div className="absolute right-4 top-24 rounded-md border border-zinc-800 bg-black/75 px-3 py-2 font-mono text-sm text-[#d4a843] backdrop-blur">
              {elapsed}
            </div>
          </>
        ) : null}
        {arrivedAtStop ? (
          <div className="absolute inset-x-0 top-0 z-30 bg-[#22c55e] px-4 py-4 text-center text-black shadow-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.14em]">Arrived at {arrivedAtStop.location.name}</p>
            <button
              type="button"
              onClick={() => router.push({ pathname: `/stocker/stop/${arrivedAtStop.id}`, query: shift?.id ? { shiftId: shift.id } : {} })}
              className="mt-3 w-full rounded-md bg-black px-4 py-3 text-sm font-bold uppercase tracking-[0.14em] text-[#22c55e]"
            >
              Start Indoor Guidance
            </button>
          </div>
        ) : null}
        {cardCollapsed && nextStop ? (
          <div className="absolute bottom-[70px] left-1/2 z-[25] flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#d4a843]/30 bg-black/80 px-5 py-2 backdrop-blur">
            <span className="text-base font-bold text-[#d4a843]">{distanceText(navigation?.nextDistanceM ?? nextDistance)}</span>
            <span className="text-zinc-600">·</span>
            <span className="text-sm text-zinc-300">{formatShortDuration(navigation?.nextDurationS)}</span>
          </div>
        ) : null}
        <section
          className="absolute inset-x-0 bottom-0 z-20 overflow-hidden rounded-t-md border-t border-zinc-800 bg-[#111]/95 shadow-2xl backdrop-blur transition-all duration-300"
          style={{ maxHeight: cardCollapsed ? 60 : 300 }}
        >
          <button type="button" onClick={() => setCardCollapsed((collapsed) => !collapsed)} className="block w-full px-3 py-3" aria-label={cardCollapsed ? "Expand stop details" : "Collapse stop details"}>
            <span className="mx-auto block h-1 w-10 rounded-sm bg-zinc-700" />
          </button>
          {shiftLoading ? <p className="text-sm text-zinc-400">Loading route...</p> : null}
          {nextStop ? (
            <div className="px-4 pb-4">
              {cardCollapsed ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="font-heading text-base font-bold text-[#d4a843]">{distanceText(navigation?.nextDistanceM ?? nextDistance)}</span>
                  <span className="truncate text-sm text-zinc-400">
                    {formatShortDuration(navigation?.nextDurationS)} · {nextStop.location.name}
                  </span>
                </div>
              ) : (
                <>
              <p className="text-xs uppercase tracking-[0.18em] text-[#d4a843]">
                Stop {nextStop.stopOrder + 1} of {stops.length}
              </p>
              <h1 className="mt-1 font-heading text-xl font-semibold">{nextStop.location.name}</h1>
              <p className="mt-1 text-sm text-zinc-400">
                {distanceText(navigation?.nextDistanceM ?? nextDistance)} · {etaText(navigation?.nextDurationS)} ·{" "}
                {accuracy ? `GPS +/- ${Math.round(accuracy)}m` : gpsError ?? "GPS pending"}
              </p>
              {navigationLoading || navigationError ? (
                <p className={navigationError ? "mt-2 text-xs text-red-300" : "mt-2 text-xs text-zinc-500"}>
                  {navigationError ?? "Updating driving route..."}
                </p>
              ) : null}
              {googleMapsNavigationUrl ? (
                <a
                  href={googleMapsNavigationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 block w-full rounded-md bg-[#d4a843] px-4 py-3 text-center text-sm font-bold uppercase tracking-[0.14em] text-black no-underline"
                >
                  Start Navigation
                </a>
              ) : null}
              <div className="mt-4 flex items-center justify-between gap-3">
                <button type="button" onClick={skipStop} className="rounded-md border border-[#d4a843]/50 px-4 py-2 text-xs uppercase tracking-[0.16em] text-[#d4a843]">
                  Skip Stop
                </button>
                <button
                  type="button"
                  onClick={() => router.push({ pathname: `/stocker/stop/${nextStop.id}`, query: shift?.id ? { shiftId: shift.id } : {} })}
                  className="rounded-md bg-[#d4a843] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-black"
                >
                  Open Stop
                </button>
              </div>
                </>
              )}
            </div>
          ) : (
            <div className="px-4 pb-4">
              <h1 className="font-heading text-xl font-semibold uppercase tracking-[0.12em] text-[#d4a843]">Route Complete</h1>
              <p className="mt-1 text-sm text-zinc-400">End the route to complete your shift summary.</p>
              <button disabled={ending} type="button" onClick={endRoute} className="mt-4 h-12 w-full rounded-md bg-[#d4a843] text-sm font-semibold uppercase tracking-[0.16em] text-black disabled:opacity-60">
                {ending ? "Ending" : "End Route"}
              </button>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
