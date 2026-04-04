'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { haversineDistance } from "../lib/geo";

export interface UseGeolocationOptions {
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
}

export interface GeolocationSnapshot {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
}

export interface UseGeolocationReturn {
  position: GeolocationSnapshot | null;
  latestPositionRef: MutableRefObject<GeolocationSnapshot | null>;
  latestLatLngRef: MutableRefObject<{ lat: number; lng: number } | null>;
  latestAccuracyRef: MutableRefObject<number | null>;
  accuracy: number | null;
  error: GeolocationPositionError | null;
  permissionState: PermissionState | null;
  isWatching: boolean;
  requestPermission: (overrides?: UseGeolocationOptions) => Promise<void>;
  startWatching: (overrides?: UseGeolocationOptions) => void;
  stopWatching: () => void;
}

const defaultOptions: Required<UseGeolocationOptions> = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
};

const WATCH_STATE_UPDATE_INTERVAL_MS = 2500;
const WATCH_STATE_UPDATE_DISTANCE_M = 12;

export function useGeolocation(options?: UseGeolocationOptions): UseGeolocationReturn {
  const resolvedOptions = useMemo(() => ({ ...defaultOptions, ...options }), [options]);
  const watchIdRef = useRef<number | null>(null);
  const latestPositionRef = useRef<GeolocationSnapshot | null>(null);
  const latestLatLngRef = useRef<{ lat: number; lng: number } | null>(null);
  const latestAccuracyRef = useRef<number | null>(null);
  const lastCommittedPositionRef = useRef<GeolocationSnapshot | null>(null);
  const lastCommittedAtRef = useRef(0);
  const [position, setPosition] = useState<GeolocationSnapshot | null>(null);
  const [error, setError] = useState<GeolocationPositionError | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState | null>(null);
  const [isWatching, setIsWatching] = useState(false);

  const commitPosition = useCallback((snapshot: GeolocationSnapshot, forceCommit: boolean) => {
    latestPositionRef.current = snapshot;
    latestLatLngRef.current = { lat: snapshot.lat, lng: snapshot.lng };
    latestAccuracyRef.current = snapshot.accuracy;

    if (forceCommit) {
      lastCommittedPositionRef.current = snapshot;
      lastCommittedAtRef.current = Date.now();
      setPosition(snapshot);
      return;
    }

    const now = Date.now();
    const lastCommitted = lastCommittedPositionRef.current;
    const movedEnough =
      !lastCommitted ||
      haversineDistance(lastCommitted.lat, lastCommitted.lng, snapshot.lat, snapshot.lng) >= WATCH_STATE_UPDATE_DISTANCE_M;

    if (!movedEnough && now - lastCommittedAtRef.current < WATCH_STATE_UPDATE_INTERVAL_MS) {
      return;
    }

    lastCommittedPositionRef.current = snapshot;
    lastCommittedAtRef.current = now;
    setPosition(snapshot);
  }, []);

  const applyPosition = useCallback((nextPosition: GeolocationPosition, forceCommit = false) => {
    const snapshot = {
      lat: nextPosition.coords.latitude,
      lng: nextPosition.coords.longitude,
      accuracy: Number.isFinite(nextPosition.coords.accuracy) ? nextPosition.coords.accuracy : null,
      heading: Number.isFinite(nextPosition.coords.heading ?? NaN) ? nextPosition.coords.heading ?? null : null,
      speed: Number.isFinite(nextPosition.coords.speed ?? NaN) ? nextPosition.coords.speed ?? null : null,
    } satisfies GeolocationSnapshot;

    setError(null);
    setPermissionState("granted");
    commitPosition(snapshot, forceCommit);
  }, [commitPosition]);

  const applyError = useCallback((nextError: GeolocationPositionError) => {
    setError(nextError);
    if (nextError.code === nextError.PERMISSION_DENIED) {
      setPermissionState("denied");
    }
  }, []);

  const stopWatching = useCallback(() => {
    if (typeof window === "undefined" || watchIdRef.current == null) {
      setIsWatching(false);
      return;
    }

    navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    setIsWatching(false);
  }, []);

  const requestPermission = useCallback(async (overrides?: UseGeolocationOptions) => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      throw new Error("Geolocation is not supported by this browser");
    }

    setError(null);
    const requestOptions = { ...resolvedOptions, ...overrides };

    await new Promise<void>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (nextPosition) => {
          applyPosition(nextPosition, true);
          resolve();
        },
        (nextError) => {
          applyError(nextError);
          reject(nextError);
        },
        requestOptions,
      );
    });
  }, [applyError, applyPosition, resolvedOptions]);

  const startWatching = useCallback((overrides?: UseGeolocationOptions) => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      return;
    }

    if (watchIdRef.current != null) {
      return;
    }

    const watchOptions = { ...resolvedOptions, ...overrides };
    watchIdRef.current = navigator.geolocation.watchPosition((nextPosition) => applyPosition(nextPosition), applyError, watchOptions);
    setIsWatching(true);
  }, [applyError, applyPosition, resolvedOptions]);

  useEffect(() => stopWatching, [stopWatching]);

  return {
    position,
    latestPositionRef,
    latestLatLngRef,
    latestAccuracyRef,
    accuracy: position?.accuracy ?? null,
    error,
    permissionState,
    isWatching,
    requestPermission,
    startWatching,
    stopWatching,
  };
}
