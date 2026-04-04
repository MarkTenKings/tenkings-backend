'use client';

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { useEffect, useState } from "react";

let hasConfiguredLoader = false;
let loadPromise: Promise<typeof google> | null = null;

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

export async function loadGoogleMaps(): Promise<typeof google> {
  if (!loadPromise) {
    configureLoader();
    loadPromise = Promise.all([importLibrary("maps"), importLibrary("marker"), importLibrary("geometry")]).then(() => google);
  }

  return loadPromise;
}

export function useGoogleMaps(): {
  isLoaded: boolean;
  loadError: Error | null;
} {
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (!cancelled) {
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

  return { isLoaded, loadError };
}
