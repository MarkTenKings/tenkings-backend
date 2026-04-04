'use client';

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useState } from "react";

let hasConfiguredLoader = false;

export interface LoadedGoogleMaps {
  google: typeof google;
  mapsLibrary: google.maps.MapsLibrary;
  markerLibrary: google.maps.MarkerLibrary;
  geometryLibrary: google.maps.GeometryLibrary;
}

let loadPromise: Promise<LoadedGoogleMaps> | null = null;

function configureLoader() {
  if (hasConfiguredLoader) {
    return;
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
  }

  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

  setOptions({
    key: apiKey,
    v: "weekly",
    libraries: ["marker", "geometry"],
    mapIds: mapId ? [mapId] : undefined,
  });

  hasConfiguredLoader = true;
}

export async function loadGoogleMaps(): Promise<LoadedGoogleMaps> {
  if (!loadPromise) {
    configureLoader();
    loadPromise = Promise.all([importLibrary("maps"), importLibrary("marker"), importLibrary("geometry")])
      .then(([mapsLibrary, markerLibrary, geometryLibrary]) => ({
        google,
        mapsLibrary: mapsLibrary as google.maps.MapsLibrary,
        markerLibrary: markerLibrary as google.maps.MarkerLibrary,
        geometryLibrary: geometryLibrary as google.maps.GeometryLibrary,
      }))
      .catch((error) => {
        loadPromise = null;
        throw error;
      });
  }

  return loadPromise;
}

export function useGoogleMaps(): {
  isLoaded: boolean;
  loadError: Error | null;
  libraries: LoadedGoogleMaps | null;
} {
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [libraries, setLibraries] = useState<LoadedGoogleMaps | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.resolve()
      .then(() => loadGoogleMaps())
      .then((loadedLibraries) => {
        if (!cancelled) {
          setLibraries(loadedLibraries);
          setLoadError(null);
          setIsLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error : new Error("Failed to load Google Maps"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { isLoaded, loadError, libraries };
}
