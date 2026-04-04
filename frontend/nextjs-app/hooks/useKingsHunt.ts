'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkArrival, checkGeofence, estimateWalkingTimeMin, haversineDistance } from "../lib/geo";
import {
  DEFAULT_ARRIVAL_RADIUS_M,
  DEFAULT_ARRIVAL_REWARD,
  DEFAULT_ROUTE_RECALC_THRESHOLD_M,
  getCheckpointRewardTotal,
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
  distanceToVenueM: number | null;
  distanceToMachineM: number | null;
  route: ComputeRouteResponse | null;
  checkpoints: Checkpoint[];
  checkpointsHit: string[];
  activeCheckpoint: Checkpoint | null;
  sessionId: string | null;
  tkdEarned: number;
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
  const [navigationStarted, setNavigationStarted] = useState(false);
  const [checkpointsHit, setCheckpointsHit] = useState<string[]>([]);
  const [activeCheckpoint, setActiveCheckpoint] = useState<Checkpoint | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasArrived, setHasArrived] = useState(false);
  const sessionInitializedRef = useRef(false);
  const completionSentRef = useRef(false);
  const sessionUpdateRef = useRef(0);
  const lastRouteOriginRef = useRef<LatLng | null>(null);

  const geolocation = useGeolocation({
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000,
  });
  const routeComputation = useRouteComputation();

  const checkpoints = useMemo(() => location.checkpoints ?? [], [location.checkpoints]);
  const position = useMemo<LatLng | null>(() => {
    if (!geolocation.position) {
      return null;
    }

    return {
      lat: geolocation.position.lat,
      lng: geolocation.position.lng,
    };
  }, [geolocation.position]);
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
  const tkdEarned = useMemo(() => {
    return getCheckpointRewardTotal(checkpoints, checkpointsHit) + (hasArrived ? DEFAULT_ARRIVAL_REWARD : 0);
  }, [checkpoints, checkpointsHit, hasArrived]);
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
    setErrorMessage(null);

    try {
      await geolocation.requestPermission();
      geolocation.startWatching();
    } catch (error) {
      const maybeGeolocationError =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: number })
          : null;

      if (maybeGeolocationError) {
        if (maybeGeolocationError.code === 1) {
          setErrorMessage("Location permission is off. Enable GPS to start the hunt.");
          return;
        }

        setErrorMessage("We couldn't get a GPS fix. Move closer to open air and try again.");
        return;
      }

      setErrorMessage(error instanceof Error ? error.message : "Unable to start geolocation");
    }
  }, [geolocation]);

  const retry = useCallback(async () => {
    completionSentRef.current = false;
    setHasArrived(false);
    setActiveCheckpoint(null);
    await requestGPS();
  }, [requestGPS]);

  const startHunt = useCallback(() => {
    setNavigationStarted(true);
  }, []);

  const dismissCheckpoint = useCallback(() => {
    setActiveCheckpoint(null);
  }, []);

  useEffect(() => {
    void requestGPS();
  }, [requestGPS]);

  useEffect(() => {
    if (sessionInitializedRef.current || !visitorId) {
      return;
    }

    if (!hasRequestedGps && !position && !geolocation.error && geolocation.permissionState == null) {
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
        gpsAccuracy: geolocation.accuracy,
      },
      checkpointsReached: 0,
      tkdEarned: 0,
    }).catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to create navigation session");
    });
  }, [entryMethod, geolocation.accuracy, geolocation.error, geolocation.permissionState, hasRequestedGps, location.id, position, postSession, qrCodeId, visitorId]);

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
      tkdEarned,
      journeyStartedAt: navigationStarted ? new Date().toISOString() : undefined,
    }).catch((error: unknown) => {
      console.error("Failed to update Kings Hunt session", error);
    });
  }, [checkpointsHit.length, navigationStarted, position, postSession, sessionId, tkdEarned]);

  useEffect(() => {
    if (!position || !machinePosition || !geofence?.isInside || hasArrived) {
      return;
    }

    const shouldRecalculate =
      !lastRouteOriginRef.current ||
      haversineDistance(position.lat, position.lng, lastRouteOriginRef.current.lat, lastRouteOriginRef.current.lng) >=
        DEFAULT_ROUTE_RECALC_THRESHOLD_M;

    if (!shouldRecalculate) {
      return;
    }

    lastRouteOriginRef.current = position;
    void routeComputation
      .computeRoute({
        originLat: position.lat,
        originLng: position.lng,
        destLat: machinePosition.lat,
        destLng: machinePosition.lng,
        locationSlug: location.slug,
      })
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : "Unable to compute walking route");
      });
  }, [geofence?.isInside, hasArrived, location.slug, machinePosition, position, routeComputation]);

  useEffect(() => {
    if (!navigationStarted || !position || checkpoints.length === 0) {
      return;
    }

    const hitSet = new Set(checkpointsHit);
    const nextCheckpoint = checkpoints.find(
      (checkpoint) =>
        !hitSet.has(checkpoint.id) &&
        haversineDistance(position.lat, position.lng, checkpoint.lat, checkpoint.lng) <= checkpoint.radiusM,
    );

    if (!nextCheckpoint) {
      return;
    }

    const nextCheckpointIds = [...checkpointsHit, nextCheckpoint.id].sort((leftId, rightId) => {
      const leftOrder = checkpoints.find((checkpoint) => checkpoint.id === leftId)?.order ?? 0;
      const rightOrder = checkpoints.find((checkpoint) => checkpoint.id === rightId)?.order ?? 0;
      return leftOrder - rightOrder;
    });

    setCheckpointsHit(nextCheckpointIds);
    setActiveCheckpoint(nextCheckpoint);
    navigator.vibrate?.([120, 60, 180]);

    if (sessionId) {
      void fetch("/api/kingshunt/checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          checkpointId: nextCheckpoint.id,
          checkpointsReached: nextCheckpointIds.length,
          tkdReward: nextCheckpoint.tkdReward,
          tkdEarned: getCheckpointRewardTotal(checkpoints, nextCheckpointIds) + (hasArrived ? DEFAULT_ARRIVAL_REWARD : 0),
        }),
      }).catch((error) => {
        console.error("Failed to record checkpoint", error);
      });
    }
  }, [checkpoints, checkpointsHit, hasArrived, navigationStarted, position, sessionId]);

  useEffect(() => {
    if (hasArrived || completionSentRef.current || !position || !machinePosition) {
      return;
    }

    if (!checkArrival(position, machinePosition, DEFAULT_ARRIVAL_RADIUS_M)) {
      return;
    }

    completionSentRef.current = true;
    setHasArrived(true);
    setNavigationStarted(false);
    setActiveCheckpoint(null);
    navigator.vibrate?.([200, 100, 240]);
    geolocation.stopWatching();

    if (sessionId) {
      void postSession({
        sessionId,
        lat: position.lat,
        lng: position.lng,
        checkpointsReached: checkpointsHit.length,
        tkdEarned: getCheckpointRewardTotal(checkpoints, checkpointsHit) + DEFAULT_ARRIVAL_REWARD,
        journeyCompletedAt: new Date().toISOString(),
      }).catch((error: unknown) => {
        console.error("Failed to complete Kings Hunt session", error);
      });
    }
  }, [checkpoints, checkpointsHit, geolocation, hasArrived, machinePosition, position, postSession, sessionId]);

  const state = useMemo<HuntState>(() => {
    if (errorMessage && geolocation.permissionState !== "denied") {
      return "ERROR";
    }

    if (!hasRequestedGps) {
      return "LOADING";
    }

    if (geolocation.permissionState === "denied" || geolocation.error?.code === geolocation.error?.PERMISSION_DENIED) {
      return "PERMISSION_DENIED";
    }

    if (!position) {
      return "LOCATING";
    }

    if (hasArrived) {
      return "ARRIVED";
    }

    if (!geofence?.isInside) {
      return "NOT_AT_VENUE";
    }

    return navigationStarted ? "NAVIGATING" : "AT_VENUE";
  }, [errorMessage, geolocation.error, geolocation.permissionState, geofence?.isInside, hasArrived, hasRequestedGps, navigationStarted, position]);

  return {
    state,
    context: {
      position,
      accuracyM: geolocation.accuracy,
      distanceToVenueM: geofence?.distanceM ?? null,
      distanceToMachineM,
      route: routeComputation.lastRoute,
      checkpoints,
      checkpointsHit,
      activeCheckpoint,
      sessionId,
      tkdEarned,
      etaMin,
      error: errorMessage,
      routeError: routeComputation.error,
      permissionState: geolocation.permissionState,
    },
    requestGPS,
    startHunt,
    retry,
    dismissCheckpoint,
  };
}
