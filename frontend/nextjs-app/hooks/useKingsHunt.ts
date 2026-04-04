'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { checkArrival, checkGeofence, estimateWalkingTimeMin, haversineDistance } from "../lib/geo";
import {
  DEFAULT_ARRIVAL_RADIUS_M,
  DEFAULT_ROUTE_RECALC_THRESHOLD_M,
  getMachinePosition,
  getVenueCenterPosition,
  type Checkpoint,
  type ComputeRouteResponse,
  type HuntState,
  type KingsHuntLocation,
  type LatLng,
} from "../lib/kingsHunt";
import { useGeolocation } from "./useGeolocation";
import { useRouteComputation } from "./useRouteComputation";
import { useVisitorId } from "./useVisitorId";

export interface UseKingsHuntOptions {
  location: KingsHuntLocation;
  entryMethod: string;
  qrCodeId?: string | null;
}

export interface UseKingsHuntContext {
  position: LatLng | null;
  accuracyM: number | null;
  livePositionRef: MutableRefObject<LatLng | null>;
  liveAccuracyRef: MutableRefObject<number | null>;
  distanceToVenueM: number | null;
  distanceToMachineM: number | null;
  route: ComputeRouteResponse | null;
  routePath: LatLng[] | null;
  checkpoints: Checkpoint[];
  checkpointsHit: string[];
  activeCheckpoint: Checkpoint | null;
  sessionId: string | null;
  etaMin: number | null;
  error: string | null;
  routeError: string | null;
  permissionState: PermissionState | null;
}

export interface UseKingsHuntReturn {
  state: HuntState;
  context: UseKingsHuntContext;
  requestGPS: () => Promise<void>;
  startHunt: () => void;
  retry: () => Promise<void>;
  dismissCheckpoint: () => void;
}

export function useKingsHunt({ location, entryMethod, qrCodeId = null }: UseKingsHuntOptions): UseKingsHuntReturn {
  const visitorId = useVisitorId();
  const [hasRequestedGps, setHasRequestedGps] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [checkpointsHit, setCheckpointsHit] = useState<string[]>([]);
  const [activeCheckpoint, setActiveCheckpoint] = useState<Checkpoint | null>(null);
  const [approximateRoutePath, setApproximateRoutePath] = useState<LatLng[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasArrived, setHasArrived] = useState(false);
  const [showStaticMapFallback, setShowStaticMapFallback] = useState(false);
  const sessionInitializedRef = useRef(false);
  const completionSentRef = useRef(false);
  const sessionUpdateRef = useRef(0);
  const lastRouteOriginRef = useRef<LatLng | null>(null);
  const lastRouteRequestRef = useRef(0);
  const autoRequestRef = useRef(false);
  const routeRefreshInFlightRef = useRef(false);
  const journeyStartedAtRef = useRef<string | null>(null);
  const {
    position: geolocationPosition,
    accuracy: geolocationAccuracy,
    latestLatLngRef,
    latestAccuracyRef,
    error: geolocationError,
    permissionState,
    isWatching,
    requestPermission,
    startWatching,
    stopWatching,
  } = useGeolocation({
    enableHighAccuracy: true,
    maximumAge: 5000,
    timeout: 15000,
  });
  const routeComputation = useRouteComputation();

  const checkpoints = useMemo(() => location.checkpoints ?? [], [location.checkpoints]);
  const position = useMemo<LatLng | null>(() => {
    if (!geolocationPosition) {
      return null;
    }

    return {
      lat: geolocationPosition.lat,
      lng: geolocationPosition.lng,
    };
  }, [geolocationPosition]);
  const machinePosition = useMemo(() => getMachinePosition(location), [location]);
  const venueCenterPosition = useMemo(() => getVenueCenterPosition(location), [location]);
  const geofence = useMemo(() => {
    if (!position || !venueCenterPosition) {
      return null;
    }

    return checkGeofence(location, position);
  }, [location, position, venueCenterPosition]);
  const distanceToMachineM = useMemo(() => {
    if (!position || !machinePosition) {
      return null;
    }

    return haversineDistance(position.lat, position.lng, machinePosition.lat, machinePosition.lng);
  }, [machinePosition, position]);
  const etaMin = useMemo(() => {
    if (routeComputation.lastRoute) {
      return Math.max(1, Math.round(routeComputation.lastRoute.durationSec / 60));
    }

    if (distanceToMachineM == null) {
      return location.walkingTimeMin ?? null;
    }

    return estimateWalkingTimeMin(distanceToMachineM);
  }, [distanceToMachineM, location.walkingTimeMin, routeComputation.lastRoute]);

  const postSession = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await fetch("/api/kingshunt/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => ({}))) as {
        sessionId?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(result.message ?? "Unable to update navigation session");
      }

      if (result.sessionId) {
        setSessionId(result.sessionId);
      }
    },
    [],
  );

  const requestGPS = useCallback(async () => {
    setHasRequestedGps(true);
    setShowStaticMapFallback(false);
    setErrorMessage(null);
    stopWatching();

    const requestPosition = async (allowRetryOnTimeout: boolean) => {
      try {
        await requestPermission({
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: allowRetryOnTimeout ? 5000 : 0,
        });
      } catch (error) {
        const maybeGeolocationError =
          typeof error === "object" && error !== null && "code" in error
            ? (error as { code?: number })
            : null;

        if (maybeGeolocationError?.code === 3 && allowRetryOnTimeout) {
          await requestPosition(false);
          return;
        }

        if (maybeGeolocationError) {
          setShowStaticMapFallback(true);
          if (maybeGeolocationError.code === 1) {
            setErrorMessage("Location permission is off in this browser. Enable it to start live tracking.");
            return;
          }

          if (maybeGeolocationError.code === 2) {
            setErrorMessage("Location Services are off on this device. Turn them on in Settings, then try again.");
            return;
          }

          if (maybeGeolocationError.code === 3) {
            setErrorMessage("GPS is taking longer than expected. Keep Location Services on and try again.");
            return;
          }

          setErrorMessage("We couldn't get a GPS fix. Move closer to open air and try again.");
          return;
        }

        setShowStaticMapFallback(true);
        setErrorMessage(error instanceof Error ? error.message : "Unable to start geolocation");
      }
    };

    await requestPosition(true);
  }, [requestPermission, stopWatching]);

  const retry = useCallback(async () => {
    completionSentRef.current = false;
    lastRouteOriginRef.current = null;
    lastRouteRequestRef.current = 0;
    journeyStartedAtRef.current = null;
    setHasArrived(false);
    setShowStaticMapFallback(false);
    setCheckpointsHit([]);
    setActiveCheckpoint(null);
    setApproximateRoutePath(null);
    await requestGPS();
  }, [requestGPS]);

  const startHunt = useCallback(() => {
    void requestGPS();
  }, [requestGPS]);

  const dismissCheckpoint = useCallback(() => {
    setActiveCheckpoint(null);
  }, []);

  useLayoutEffect(() => {
    if (autoRequestRef.current) {
      return;
    }

    autoRequestRef.current = true;
    void requestGPS();
  }, [requestGPS]);

  useEffect(() => {
    if (!position) {
      return;
    }

    setShowStaticMapFallback(false);
  }, [position]);

  useEffect(() => {
    if (!position || !geofence?.isInside || hasArrived || journeyStartedAtRef.current) {
      return;
    }

    journeyStartedAtRef.current = new Date().toISOString();
  }, [geofence?.isInside, hasArrived, position]);

  useEffect(() => {
    if (!hasRequestedGps || position || hasArrived || showStaticMapFallback) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowStaticMapFallback(true);
    }, 10000);

    return () => window.clearTimeout(timeout);
  }, [hasArrived, hasRequestedGps, position, showStaticMapFallback]);

  useEffect(() => {
    if (!position || !geofence?.isInside || hasArrived || isWatching) {
      return;
    }

    startWatching({
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 10000,
    });
  }, [geofence?.isInside, hasArrived, isWatching, position, startWatching]);

  useEffect(() => {
    if (sessionInitializedRef.current || !visitorId) {
      return;
    }

    if (!hasRequestedGps && !position && !geolocationError) {
      return;
    }

    sessionInitializedRef.current = true;
    void postSession({
      locationId: location.id,
      entryMethod,
      qrCodeId,
      visitorId,
      lat: position?.lat,
      lng: position?.lng,
      deviceInfo: {
        userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
        screenWidth: typeof window === "undefined" ? null : window.innerWidth,
        screenHeight: typeof window === "undefined" ? null : window.innerHeight,
        gpsAccuracy: geolocationAccuracy,
      },
      checkpointsReached: 0,
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create navigation session");
    });
  }, [entryMethod, geolocationAccuracy, geolocationError, hasRequestedGps, location.id, position, postSession, qrCodeId, visitorId]);

  useEffect(() => {
    if (!sessionId || !position) {
      return;
    }

    const now = Date.now();
    if (now - sessionUpdateRef.current < 2500) {
      return;
    }

    sessionUpdateRef.current = now;
    void postSession({
      sessionId,
      lat: position.lat,
      lng: position.lng,
      checkpointsReached: checkpointsHit.length,
      journeyStartedAt: journeyStartedAtRef.current ?? undefined,
    }).catch((error: unknown) => {
      console.error("Failed to update Kings Hunt session", error);
    });
  }, [checkpointsHit.length, position, postSession, sessionId]);

  const refreshRoute = useCallback(
    async (origin: LatLng, forceRefresh: boolean) => {
      if (!machinePosition || !geofence?.isInside || hasArrived || routeRefreshInFlightRef.current) {
        return;
      }

      const now = Date.now();
      const hasMovedEnough =
        !lastRouteOriginRef.current ||
        haversineDistance(origin.lat, origin.lng, lastRouteOriginRef.current.lat, lastRouteOriginRef.current.lng) >=
          DEFAULT_ROUTE_RECALC_THRESHOLD_M;
      const shouldRefresh = forceRefresh || hasMovedEnough || now - lastRouteRequestRef.current >= 30000;

      if (!shouldRefresh) {
        return;
      }

      lastRouteOriginRef.current = origin;
      lastRouteRequestRef.current = now;
      routeRefreshInFlightRef.current = true;

      try {
        await routeComputation.computeRoute({
          originLat: origin.lat,
          originLng: origin.lng,
          destLat: machinePosition.lat,
          destLng: machinePosition.lng,
          locationSlug: location.slug,
        });
        setApproximateRoutePath(null);
      } catch (error) {
        setApproximateRoutePath(null);
        console.error("Kings Hunt route refresh failed", error);
      } finally {
        routeRefreshInFlightRef.current = false;
      }
    },
    [geofence?.isInside, hasArrived, location.slug, machinePosition, routeComputation],
  );

  useEffect(() => {
    if (!position || !machinePosition || !geofence?.isInside || hasArrived) {
      return;
    }

    void refreshRoute(position, false);
  }, [geofence?.isInside, hasArrived, machinePosition, position, refreshRoute]);

  useEffect(() => {
    if (!machinePosition || !geofence?.isInside || hasArrived) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const latestPosition = latestLatLngRef.current;
      if (latestPosition) {
        void refreshRoute(latestPosition, true);
      }
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [geofence?.isInside, hasArrived, latestLatLngRef, machinePosition, refreshRoute]);

  useEffect(() => {
    if (geofence?.isInside && machinePosition && !hasArrived) {
      return;
    }

    lastRouteOriginRef.current = null;
    lastRouteRequestRef.current = 0;
    setApproximateRoutePath(null);
  }, [geofence?.isInside, hasArrived, machinePosition]);

  /*
   * Checkpoint proximity detection is intentionally disabled while Kings Hunt is in
   * pure wayfinding mode on mobile. We keep the stored checkpoint data so the static
   * venue preview path can still follow the intended walkway.
   */
  // useEffect(() => {
  //   if (!position || checkpoints.length === 0) {
  //     return;
  //   }
  //
  //   const hitSet = new Set(checkpointsHit);
  //   const nextCheckpoint = checkpoints.find(
  //     (checkpoint) =>
  //       !hitSet.has(checkpoint.id) &&
  //       haversineDistance(position.lat, position.lng, checkpoint.lat, checkpoint.lng) <= checkpoint.radiusM,
  //   );
  //
  //   if (!nextCheckpoint) {
  //     return;
  //   }
  //
  //   const nextCheckpointIds = [...checkpointsHit, nextCheckpoint.id].sort((leftId, rightId) => {
  //     const leftOrder = checkpoints.find((checkpoint) => checkpoint.id === leftId)?.order ?? 0;
  //     const rightOrder = checkpoints.find((checkpoint) => checkpoint.id === rightId)?.order ?? 0;
  //     return leftOrder - rightOrder;
  //   });
  //
  //   setCheckpointsHit(nextCheckpointIds);
  //   setActiveCheckpoint(nextCheckpoint);
  //
  //   if (sessionId) {
  //     void fetch("/api/kingshunt/checkpoint", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({
  //         sessionId,
  //         checkpointId: nextCheckpoint.id,
  //         checkpointsReached: nextCheckpointIds.length,
  //       }),
  //     }).catch((error) => {
  //       console.error("Failed to record checkpoint", error);
  //     });
  //   }
  // }, [checkpoints, checkpointsHit, position, sessionId]);

  useEffect(() => {
    if (hasArrived || completionSentRef.current || !position || !machinePosition) {
      return;
    }

    if (!checkArrival(position, machinePosition, DEFAULT_ARRIVAL_RADIUS_M)) {
      return;
    }

    completionSentRef.current = true;
    setHasArrived(true);
    setActiveCheckpoint(null);
    stopWatching();

    if (sessionId) {
      void postSession({
        sessionId,
        lat: position.lat,
        lng: position.lng,
        checkpointsReached: checkpointsHit.length,
        journeyCompletedAt: new Date().toISOString(),
      }).catch((error: unknown) => {
        console.error("Failed to complete Kings Hunt session", error);
      });
    }
  }, [checkpoints, checkpointsHit, hasArrived, machinePosition, position, postSession, sessionId, stopWatching]);

  const state = useMemo<HuntState>(() => {
    if (!hasRequestedGps) {
      return "LOADING";
    }

    if (position) {
      if (hasArrived) {
        return "ARRIVED";
      }

      if (!geofence?.isInside) {
        return "NOT_AT_VENUE";
      }

      return "NAVIGATING";
    }

    if (geolocationError?.code === 2) {
      return "LOCATION_SERVICES_OFF";
    }

    if (showStaticMapFallback || geolocationError || errorMessage) {
      return "STATIC_MAP";
    }

    return "LOCATING";
  }, [errorMessage, geofence?.isInside, geolocationError, hasArrived, hasRequestedGps, position, showStaticMapFallback]);

  return {
    state,
    context: {
      position,
      accuracyM: geolocationAccuracy,
      livePositionRef: latestLatLngRef as MutableRefObject<LatLng | null>,
      liveAccuracyRef: latestAccuracyRef,
      distanceToVenueM: geofence?.distanceM ?? null,
      distanceToMachineM,
      route: routeComputation.lastRoute,
      routePath: approximateRoutePath,
      checkpoints,
      checkpointsHit,
      activeCheckpoint,
      sessionId,
      etaMin,
      error: errorMessage,
      routeError: routeComputation.error,
      permissionState,
    },
    requestGPS,
    startHunt,
    retry,
    dismissCheckpoint,
  };
}
