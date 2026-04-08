import Head from "next/head";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { StoreLocatorMapLocation } from "../components/maps/StoreLocatorMap";
import LocationDetailPanel, { type LocationPanelLocation } from "../components/locations/LocationDetailPanel";
import MapErrorBoundary from "../components/maps/MapErrorBoundary";
import MapFallback from "../components/maps/MapFallback";
import { haversineDistance, ONLINE_LOCATION_SLUG } from "../lib/locationUtils";

const StoreLocatorMap = dynamic(() => import("../components/maps/StoreLocatorMap"), {
  ssr: false,
  loading: () => (
    <MapFallback
      className="h-full"
      eyebrow="Loading map"
      title="Loading venue map"
      body="Fetching the live Ten Kings venue map and marker layer."
    />
  ),
});

interface LiveRipClip {
  id: string;
  slug: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  viewCount: number | null;
  createdAt: string;
}

interface LocationRecord extends LocationPanelLocation {
  latitude: number | null;
  longitude: number | null;
  venueCenterLat: number | null;
  venueCenterLng: number | null;
  geofenceRadiusM: number | null;
  hasIndoorMap: boolean;
  walkingTimeMin: number | null;
  machinePhotoUrl: string | null;
  landmarks: string[];
  createdAt: string;
  updatedAt: string;
}

const sanitizeLocationRecord = (location: LocationRecord): LocationRecord => ({
  ...location,
  machinePhotoUrl: location.machinePhotoUrl ?? null,
  liveRips: Array.isArray((location as { liveRips?: LiveRipClip[] }).liveRips)
    ? ((location as { liveRips: LiveRipClip[] }).liveRips ?? []).map((rip) => ({
        ...rip,
        thumbnailUrl: rip.thumbnailUrl ?? null,
        viewCount: typeof rip.viewCount === "number" ? rip.viewCount : null,
        createdAt: rip.createdAt ?? new Date().toISOString(),
      }))
    : [],
  landmarks: Array.isArray((location as { landmarks?: string[] }).landmarks)
    ? ((location as { landmarks: string[] }).landmarks ?? []).filter((landmark) => typeof landmark === "string")
    : [],
  hasIndoorMap: Boolean((location as { hasIndoorMap?: boolean }).hasIndoorMap),
});

export default function LocationsPage() {
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    fetch("/api/locations")
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load locations");
        }

        const payload = (await response.json()) as { locations: LocationRecord[] };
        if (!mounted) {
          return;
        }

        setLocations((payload.locations ?? []).map((location) => sanitizeLocationRecord(location)));
      })
      .catch((loadError: unknown) => {
        if (!mounted) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load locations");
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const previousHtmlBackground = document.documentElement.style.backgroundColor;
    const previousBodyBackground = document.body.style.backgroundColor;

    document.documentElement.style.backgroundColor = "#0a0a0a";
    document.body.style.backgroundColor = "#0a0a0a";

    return () => {
      document.documentElement.style.backgroundColor = previousHtmlBackground;
      document.body.style.backgroundColor = previousBodyBackground;
    };
  }, []);

  const physicalLocations = useMemo(
    () =>
      locations.filter(
        (location) =>
          location.slug !== ONLINE_LOCATION_SLUG &&
          typeof location.latitude === "number" &&
          typeof location.longitude === "number",
      ),
    [locations],
  );

  const distanceBySlug = useMemo(() => {
    const distances: Record<string, number> = {};
    if (!userPosition) {
      return distances;
    }

    for (const location of physicalLocations) {
      distances[location.slug] = haversineDistance(
        userPosition.lat,
        userPosition.lng,
        location.latitude as number,
        location.longitude as number,
      );
    }

    return distances;
  }, [physicalLocations, userPosition]);

  const sortedLocations = useMemo(() => {
    if (!userPosition) {
      return physicalLocations;
    }

    return [...physicalLocations].sort((left, right) => {
      const leftDistance = distanceBySlug[left.slug] ?? Number.POSITIVE_INFINITY;
      const rightDistance = distanceBySlug[right.slug] ?? Number.POSITIVE_INFINITY;
      return leftDistance - rightDistance;
    });
  }, [distanceBySlug, physicalLocations, userPosition]);

  const locationsBySlug = useMemo(
    () => new Map(sortedLocations.map((location) => [location.slug, location])),
    [sortedLocations],
  );

  const selectedLocation = selectedSlug ? locationsBySlug.get(selectedSlug) ?? null : null;

  const mapLocations = useMemo<StoreLocatorMapLocation[]>(
    () =>
      sortedLocations.map((location) => ({
        id: location.id,
        slug: location.slug,
        name: location.name,
        address: location.address,
        latitude: location.latitude as number,
        longitude: location.longitude as number,
        locationType: location.locationType,
        city: location.city,
        state: location.state,
        hours: location.hours,
        mapsUrl: location.mapsUrl,
      })),
    [sortedLocations],
  );

  useEffect(() => {
    if (selectedSlug && !locationsBySlug.has(selectedSlug)) {
      setSelectedSlug(null);
    }
  }, [locationsBySlug, selectedSlug]);

  useEffect(() => {
    if (typeof window === "undefined" || sortedLocations.length === 0) {
      return;
    }

    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!hash) {
      return;
    }

    const location = locationsBySlug.get(hash);
    if (location) {
      setSelectedSlug(location.slug);
    }
  }, [locationsBySlug, sortedLocations.length]);

  return (
    <>
      <Head>
        <title>Ten Kings · Locations</title>
        <meta name="description" content="Find Ten Kings Collectibles machines and plan your next live rip." />
      </Head>

      <div className="relative w-screen overflow-hidden bg-[#0a0a0a]" style={{ height: "100dvh", minHeight: "100vh" }}>
        <div className="absolute inset-0">
          <MapErrorBoundary
            fallback={
              <MapFallback
                className="h-full"
                eyebrow="Map failed to load"
                title="Venue map unavailable"
                body="The live map is temporarily unavailable, but location details and hunt links return once the map service recovers."
              />
            }
          >
            <StoreLocatorMap
              locations={mapLocations}
              selectedSlug={selectedSlug}
              onMarkerClick={(slug) => setSelectedSlug(slug)}
              onMapClick={() => setSelectedSlug(null)}
              className="h-full w-full"
              edgeToEdge
            />
          </MapErrorBoundary>
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-[linear-gradient(to_bottom,rgba(10,10,10,0.95)_0%,rgba(10,10,10,0)_100%)] px-5 pb-16 pt-5 sm:px-6">
          <div className="pointer-events-auto max-w-[460px]">
            <p className="font-kingshunt-body text-[11px] font-bold uppercase tracking-[0.24em] text-[#d4a843]">
              FIND A LOCATION · {mapLocations.length} VENUES
            </p>
            <h1 className="font-kingshunt-display mt-2 text-[clamp(28px,4vw,48px)] leading-[0.92] text-white">PICK &amp; RIP IN PERSON</h1>
          </div>
        </div>

        {loading ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
            <div className="rounded-full border border-white/10 bg-[rgba(10,10,10,0.86)] px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-[#d4a843] backdrop-blur">
              Loading venues…
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="absolute bottom-6 left-4 right-4 z-20 rounded-2xl border border-rose-500/40 bg-[rgba(20,10,10,0.92)] px-5 py-4 text-sm text-rose-200 sm:left-6 sm:right-auto sm:max-w-md">
            {error}
          </div>
        ) : null}

        {!loading && mapLocations.length === 0 && !error ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
            <div className="rounded-[1.5rem] border border-white/10 bg-[rgba(10,10,10,0.88)] px-6 py-5 text-center backdrop-blur">
              <p className="font-kingshunt-body text-[11px] uppercase tracking-[0.24em] text-[#d4a843]">No venues yet</p>
              <p className="font-kingshunt-body mt-2 text-sm text-[#b3b3b3]">Physical Ten Kings locations will appear here once they go live.</p>
            </div>
          </div>
        ) : null}

        <LocationDetailPanel location={selectedLocation} onClose={() => setSelectedSlug(null)} />
      </div>
    </>
  );
}
