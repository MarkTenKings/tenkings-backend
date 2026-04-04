'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  accuracy: number | null;
  error: GeolocationPositionError | null;
  permissionState: PermissionState | null;
  isWatching: boolean;
  requestPermission: () => Promise<void>;
  startWatching: () => void;
  stopWatching: () => void;
}

const defaultOptions: Required<UseGeolocationOptions> = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
};

export function useGeolocation(options?: UseGeolocationOptions): UseGeolocationReturn {
  const resolvedOptions = useMemo(() => ({ ...defaultOptions, ...options }), [options]);
  const watchIdRef = useRef<number | null>(null);
  const [position, setPosition] = useState<GeolocationSnapshot | null>(null);
  const [error, setError] = useState<GeolocationPositionError | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState | null>(null);
  const [isWatching, setIsWatching] = useState(false);

  const applyPosition = useCallback((nextPosition: GeolocationPosition) => {
    setError(null);
    setPosition({
      lat: nextPosition.coords.latitude,
      lng: nextPosition.coords.longitude,
      accuracy: Number.isFinite(nextPosition.coords.accuracy) ? nextPosition.coords.accuracy : null,
      heading: Number.isFinite(nextPosition.coords.heading ?? NaN) ? nextPosition.coords.heading ?? null : null,
      speed: Number.isFinite(nextPosition.coords.speed ?? NaN) ? nextPosition.coords.speed ?? null : null,
    });
  }, []);

  const applyError = useCallback((nextError: GeolocationPositionError) => {
    setError(nextError);
    if (nextError.code === nextError.PERMISSION_DENIED) {
      setPermissionState("denied");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("permissions" in navigator) || !navigator.permissions?.query) {
      return;
    }

    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;

    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (cancelled) {
          return;
        }

        permissionStatus = status;
        setPermissionState(status.state);
        status.onchange = () => setPermissionState(status.state);
      })
      .catch(() => {
        // Browser support varies; the hook still works without Permissions API.
      });

    return () => {
      cancelled = true;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
    };
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

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      throw new Error("Geolocation is not supported by this browser");
    }

    await new Promise<void>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (nextPosition) => {
          setPermissionState("granted");
          applyPosition(nextPosition);
          resolve();
        },
        (nextError) => {
          applyError(nextError);
          reject(nextError);
        },
        resolvedOptions,
      );
    });
  }, [applyError, applyPosition, resolvedOptions]);

  const startWatching = useCallback(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      return;
    }

    if (watchIdRef.current != null) {
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(applyPosition, applyError, resolvedOptions);
    setIsWatching(true);
  }, [applyError, applyPosition, resolvedOptions]);

  useEffect(() => stopWatching, [stopWatching]);

  return {
    position,
    accuracy: position?.accuracy ?? null,
    error,
    permissionState,
    isWatching,
    requestPermission,
    startWatching,
    stopWatching,
  };
}
