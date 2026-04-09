import Head from "next/head";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { OpenStatusBadge } from "../components/locations/OpenStatusBadge";
import type { StoreLocatorMapLocation } from "../components/maps/StoreLocatorMap";
import LocationDetailPanel, { type LocationPanelLocation } from "../components/locations/LocationDetailPanel";
import MapErrorBoundary from "../components/maps/MapErrorBoundary";
import MapFallback from "../components/maps/MapFallback";
import { hasAdminAccess, hasAdminPhoneAccess } from "../constants/admin";
import { useSession } from "../hooks/useSession";
import { getLocationTypeLabel } from "../lib/kingsHunt";
import { haversineDistance, ONLINE_LOCATION_SLUG } from "../lib/locationUtils";
import { TEN_KINGS_COLLECTIBLES_CROWN_PATH, TEN_KINGS_COLLECTIBLES_CROWN_VIEWBOX } from "../lib/tenKingsBrand";

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

type ViewMode = "map" | "list";

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

function ListLocationCard({
  location,
  onClick,
}: {
  location: LocationRecord;
  onClick: () => void;
}) {
  const subtitle = [location.city, location.state].filter(Boolean).join(", ") || location.address;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-[12px] border border-[#1a1a1a] bg-[#111111] p-4 text-left transition hover:border-[#2a2a2a] hover:bg-[#161616] active:bg-[#1a1a1a]"
    >
      <div
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "999px",
          background: "#d4a843",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox={TEN_KINGS_COLLECTIBLES_CROWN_VIEWBOX}
          fill="#0a0a0a"
          aria-hidden="true"
        >
          <path d={TEN_KINGS_COLLECTIBLES_CROWN_PATH} />
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-kingshunt-body mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#d4a843]">
          {getLocationTypeLabel(location.locationType)}
        </p>
        <p
          className="font-kingshunt-display mb-1 text-[16px] font-bold text-white"
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {location.name}
        </p>
        <p
          className="font-kingshunt-body text-[13px] text-[#666666]"
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {subtitle}
        </p>
      </div>

      <div className="flex-shrink-0">
        <OpenStatusBadge hours={location.hours} locationType={location.locationType} />
      </div>

      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 4l4 4-4 4" stroke="#444" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export default function LocationsPage() {
  const { session } = useSession();
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("map");

  const isAdmin = useMemo(() => {
    if (!session) {
      return false;
    }
    return hasAdminAccess(session.user.id) || hasAdminPhoneAccess(session.user.phone);
  }, [session]);

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

  const publicLocations = useMemo(
    () => locations.filter((location) => location.slug !== ONLINE_LOCATION_SLUG),
    [locations],
  );

  const distanceBySlug = useMemo(() => {
    const distances: Record<string, number> = {};
    if (!userPosition) {
      return distances;
    }

    for (const location of publicLocations) {
      if (typeof location.latitude !== "number" || typeof location.longitude !== "number") {
        continue;
      }

      distances[location.slug] = haversineDistance(
        userPosition.lat,
        userPosition.lng,
        location.latitude as number,
        location.longitude as number,
      );
    }

    return distances;
  }, [publicLocations, userPosition]);

  const sortedLocations = useMemo(() => {
    if (!userPosition) {
      return publicLocations;
    }

    return [...publicLocations].sort((left, right) => {
      const leftDistance = distanceBySlug[left.slug] ?? Number.POSITIVE_INFINITY;
      const rightDistance = distanceBySlug[right.slug] ?? Number.POSITIVE_INFINITY;
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
    });
  }, [distanceBySlug, publicLocations, userPosition]);

  const physicalLocations = useMemo(
    () =>
      sortedLocations.filter(
        (
          location,
        ): location is LocationRecord & {
          latitude: number;
          longitude: number;
        } => typeof location.latitude === "number" && typeof location.longitude === "number",
      ),
    [sortedLocations],
  );

  const locationsBySlug = useMemo(
    () => new Map(sortedLocations.map((location) => [location.slug, location])),
    [sortedLocations],
  );

  const selectedLocation = selectedSlug ? locationsBySlug.get(selectedSlug) ?? null : null;

  const mapLocations = useMemo<StoreLocatorMapLocation[]>(
    () =>
      physicalLocations.map((location) => ({
        id: location.id,
        slug: location.slug,
        name: location.name,
        address: location.address,
        latitude: location.latitude,
        longitude: location.longitude,
        locationType: location.locationType,
        city: location.city,
        state: location.state,
        hours: location.hours,
        mapsUrl: location.mapsUrl,
      })),
    [physicalLocations],
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
        {viewMode === "map" ? (
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
        ) : null}

        {viewMode === "list" ? (
          <div
            className="absolute inset-0 z-[15] overflow-y-auto bg-[#0a0a0a] px-4 pb-20 pt-20 sm:px-6"
            style={{ paddingTop: "80px", paddingBottom: "80px" }}
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-2">
              {sortedLocations.map((location) => (
                <ListLocationCard
                  key={location.slug}
                  location={location}
                  onClick={() => {
                    setViewMode("map");
                    setSelectedSlug(location.slug);
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-[linear-gradient(to_bottom,rgba(10,10,10,0.95)_0%,rgba(10,10,10,0)_100%)] px-5 pb-16 pt-5 sm:px-6">
          <div className="pointer-events-auto max-w-[460px]">
            <p className="font-kingshunt-body text-[11px] font-bold uppercase tracking-[0.24em] text-[#d4a843]">
              FIND A LOCATION · {sortedLocations.length} VENUES
            </p>
            <h1 className="font-kingshunt-display mt-2 text-[clamp(28px,4vw,48px)] leading-[0.92] text-white">PICK &amp; RIP IN PERSON</h1>
          </div>
        </div>

        {isAdmin ? (
          <div className="absolute right-4 top-4 z-30 sm:right-6">
            <Link
              href="/admin/assigned-locations"
              className="font-kingshunt-body inline-flex items-center rounded-full border border-[#d4a843] bg-[#111111] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#d4a843] shadow-[0_8px_24px_rgba(0,0,0,0.3)] transition hover:bg-[#171717]"
            >
              Add Location
            </Link>
          </div>
        ) : null}

        {loading ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-4">
            <div className="rounded-full border border-white/10 bg-[rgba(10,10,10,0.86)] px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-[#d4a843] backdrop-blur">
              Loading venues…
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="absolute bottom-24 left-4 right-4 z-20 rounded-2xl border border-rose-500/40 bg-[rgba(20,10,10,0.92)] px-5 py-4 text-sm text-rose-200 sm:left-6 sm:right-auto sm:max-w-md">
            {error}
          </div>
        ) : null}

        {!loading && sortedLocations.length === 0 && !error ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-6">
            <div className="rounded-[1.5rem] border border-white/10 bg-[rgba(10,10,10,0.88)] px-6 py-5 text-center backdrop-blur">
              <p className="font-kingshunt-body text-[11px] uppercase tracking-[0.24em] text-[#d4a843]">No venues yet</p>
              <p className="font-kingshunt-body mt-2 text-sm text-[#b3b3b3]">Physical Ten Kings locations will appear here once they go live.</p>
            </div>
          </div>
        ) : null}

        {!loading && !error && viewMode === "map" && sortedLocations.length > 0 && mapLocations.length === 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center px-4">
            <div className="max-w-md rounded-2xl border border-white/10 bg-[rgba(10,10,10,0.88)] px-5 py-4 text-center text-sm text-[#cccccc] backdrop-blur">
              Venue cards are available, but map pins need valid coordinates. Newly added venues now geocode from their saved address.
            </div>
          </div>
        ) : null}

        <div
          style={{
            position: "absolute",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            display: "flex",
            background: "rgba(10,10,10,0.9)",
            border: "1px solid #333",
            borderRadius: "24px",
            padding: "4px",
            backdropFilter: "blur(12px)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          }}
        >
          <button
            type="button"
            onClick={() => setViewMode("map")}
            style={{
              padding: "8px 20px",
              borderRadius: "20px",
              border: "none",
              background: viewMode === "map" ? "#d4a843" : "transparent",
              color: viewMode === "map" ? "#0a0a0a" : "#999",
              fontFamily: "Satoshi, sans-serif",
              fontWeight: 700,
              fontSize: "13px",
              letterSpacing: "0.05em",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            MAP
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            style={{
              padding: "8px 20px",
              borderRadius: "20px",
              border: "none",
              background: viewMode === "list" ? "#d4a843" : "transparent",
              color: viewMode === "list" ? "#0a0a0a" : "#999",
              fontFamily: "Satoshi, sans-serif",
              fontWeight: 700,
              fontSize: "13px",
              letterSpacing: "0.05em",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            LIST
          </button>
        </div>

        {viewMode === "map" ? <LocationDetailPanel location={selectedLocation} onClose={() => setSelectedSlug(null)} /> : null}
      </div>
    </>
  );
}
