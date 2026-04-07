import Head from "next/head";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../components/AppShell";
import LocationCard, { type LocationCardRecord } from "../components/locations/LocationCard";
import MapErrorBoundary from "../components/maps/MapErrorBoundary";
import MapFallback from "../components/maps/MapFallback";
import type { StoreLocatorMapLocation } from "../components/maps/StoreLocatorMap";
import { hasAdminAccess, hasAdminPhoneAccess } from "../constants/admin";
import { useSession } from "../hooks/useSession";
import { haversineDistance, NEARBY_DISTANCE_M, ONLINE_LOCATION_SLUG } from "../lib/locationUtils";

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

interface RipEntry {
  title: string;
  videoUrl: string;
}

interface LiveRipClip {
  id: string;
  slug: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  viewCount: number | null;
  createdAt: string;
}

interface LocationRecord extends LocationCardRecord {
  mediaUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  venueCenterLat: number | null;
  venueCenterLng: number | null;
  geofenceRadiusM: number | null;
  hasIndoorMap: boolean;
  walkingTimeMin: number | null;
  landmarks: string[];
  createdAt: string;
  updatedAt: string;
}

interface LocationFormState {
  id?: string;
  name: string;
  slug: string;
  description: string;
  address: string;
  mapsUrl: string;
  mediaUrl: string;
  recentRips: RipEntry[];
}

const emptyFormState: LocationFormState = {
  name: "",
  slug: "",
  description: "",
  address: "",
  mapsUrl: "",
  mediaUrl: "",
  recentRips: [],
};

const normalizeRipList = (value: RipEntry[]): RipEntry[] =>
  value
    .map((entry) => ({
      title: entry.title.trim(),
      videoUrl: entry.videoUrl.trim(),
    }))
    .filter((entry) => entry.title && entry.videoUrl);

const sanitizeLocationRecord = (location: LocationRecord): LocationRecord => ({
  ...location,
  recentRips: Array.isArray(location.recentRips)
    ? (location.recentRips as RipEntry[])
        .map((rip) => ({
          title: typeof rip.title === "string" ? rip.title : "",
          videoUrl: typeof rip.videoUrl === "string" ? rip.videoUrl : "",
        }))
        .filter((rip) => rip.title && rip.videoUrl)
    : [],
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
  const { session, ensureSession } = useSession();
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<"create" | "edit" | null>(null);
  const [formState, setFormState] = useState<LocationFormState>(emptyFormState);
  const [saving, setSaving] = useState(false);
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const hashHandledRef = useRef(false);

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

    const headers: Record<string, string> = {};
    if (session?.token) {
      headers.Authorization = `Bearer ${session.token}`;
    }

    fetch("/api/locations", { headers })
      .then(async (res) => {
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load locations");
        }

        const payload = (await res.json()) as { locations: LocationRecord[] };
        if (!mounted) {
          return;
        }

        const sanitized = (payload.locations ?? []).map((location) => sanitizeLocationRecord(location));
        setLocations(sanitized);
      })
      .catch((err: unknown) => {
        if (!mounted) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load locations");
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [session?.token]);

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
    if (!flash) {
      return;
    }
    const timeout = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [flash]);

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

    physicalLocations.forEach((location) => {
      distances[location.slug] = haversineDistance(
        userPosition.lat,
        userPosition.lng,
        location.latitude as number,
        location.longitude as number,
      );
    });

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
    if (selectedSlug && !sortedLocations.some((location) => location.slug === selectedSlug)) {
      setSelectedSlug(null);
    }
  }, [selectedSlug, sortedLocations]);

  const handleLocationSelect = useCallback((location: LocationRecord) => {
    setSelectedSlug(location.slug);

    const map = mapRef.current;
    if (!map || typeof location.latitude !== "number" || typeof location.longitude !== "number") {
      return;
    }

    map.panTo({ lat: location.latitude, lng: location.longitude });
    if ((map.getZoom() ?? 0) < 15) {
      map.setZoom(15);
    }
  }, []);

  const handleMapMarkerClick = useCallback((slug: string) => {
    setSelectedSlug(slug);

    const card = document.getElementById(`location-card-${slug}`);
    if (!card) {
      return;
    }

    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("highlight-pulse");
    window.setTimeout(() => card.classList.remove("highlight-pulse"), 1800);
  }, []);

  useEffect(() => {
    if (hashHandledRef.current || typeof window === "undefined" || sortedLocations.length === 0) {
      return;
    }

    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!hash) {
      hashHandledRef.current = true;
      return;
    }

    const targetLocation = sortedLocations.find((location) => location.slug === hash);
    if (!targetLocation) {
      hashHandledRef.current = true;
      return;
    }

    hashHandledRef.current = true;
    window.setTimeout(() => {
      handleLocationSelect(targetLocation);
      const card = document.getElementById(`location-card-${targetLocation.slug}`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  }, [handleLocationSelect, sortedLocations]);

  const beginCreate = useCallback(() => {
    setEditMode("create");
    setFormState({ ...emptyFormState });
  }, []);

  const beginEdit = useCallback((location: LocationRecord) => {
    setEditMode("edit");
    setFormState({
      id: location.id,
      name: location.name,
      slug: location.slug,
      description: location.description ?? "",
      address: location.address,
      mapsUrl: location.mapsUrl ?? "",
      mediaUrl: location.mediaUrl ?? "",
      recentRips: location.recentRips ?? [],
    });
  }, []);

  const closeEditor = useCallback(() => {
    setEditMode(null);
    setFormState({ ...emptyFormState });
  }, []);

  const handleFormChange = (field: keyof LocationFormState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const updateRip = (index: number, rip: RipEntry) => {
    setFormState((prev) => {
      const next = [...prev.recentRips];
      next[index] = rip;
      return { ...prev, recentRips: next };
    });
  };

  const addRip = () => {
    setFormState((prev) => ({ ...prev, recentRips: [...prev.recentRips, { title: "", videoUrl: "" }] }));
  };

  const removeRip = (index: number) => {
    setFormState((prev) => ({
      ...prev,
      recentRips: prev.recentRips.filter((_, idx) => idx !== index),
    }));
  };

  const handleSave = async () => {
    if (!editMode) {
      return;
    }
    setSaving(true);
    setFlash(null);

    let activeSession = session;
    if (!activeSession) {
      try {
        activeSession = await ensureSession();
      } catch (saveError) {
        if (!(saveError instanceof Error && saveError.message === "Authentication cancelled")) {
          setFlash("Sign in to manage locations.");
        }
        setSaving(false);
        return;
      }
    }

    if (!activeSession) {
      setSaving(false);
      return;
    }

    const body = {
      name: formState.name.trim(),
      slug: (formState.slug || formState.name).trim(),
      description: formState.description.trim(),
      address: formState.address.trim(),
      mapsUrl: formState.mapsUrl.trim(),
      mediaUrl: formState.mediaUrl.trim(),
      recentRips: normalizeRipList(formState.recentRips),
    };

    try {
      const endpoint = editMode === "create" ? "/api/locations" : `/api/locations/${formState.id}`;
      const method = editMode === "create" ? "POST" : "PUT";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeSession.token}`,
      };

      const response = await fetch(endpoint, {
        method,
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? "Unable to save location");
      }

      const payload = await response.json();
      const location: LocationRecord = payload.location ?? payload?.location;

      if (!location) {
        throw new Error("Unexpected response from server");
      }

      const normalizedLocation = sanitizeLocationRecord(location);

      setLocations((prev) => {
        if (editMode === "create") {
          return [...prev, normalizedLocation].sort((a, b) => a.name.localeCompare(b.name));
        }
        return prev.map((entry) => (entry.id === normalizedLocation.id ? normalizedLocation : entry));
      });

      setFlash("Location saved");
      closeEditor();
    } catch (saveError) {
      setFlash(saveError instanceof Error ? saveError.message : "Unable to save location");
    } finally {
      setSaving(false);
    }
  };

  const mapSummary = userPosition ? "Sorted by nearest venue from your device" : "Allow location access to sort venues by distance";

  return (
    <AppShell background="black" brandVariant="collectibles">
      <Head>
        <title>Ten Kings · Locations</title>
        <meta name="description" content="Find Ten Kings Collectibles machines and plan your next live rip." />
      </Head>

      <div className="min-h-screen bg-[#0a0a0a]">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          <header className="space-y-5">
            <div className="space-y-4">
              <p className="font-kingshunt-body text-[11px] font-bold uppercase tracking-[0.38em] text-[#d4a843]">Find a Location</p>
              <h1 className="font-kingshunt-display text-[clamp(2.8rem,7vw,5rem)] uppercase leading-[0.92] tracking-[0.08em] text-white">
                Pick & Rip in Person
              </h1>
              <p className="font-kingshunt-body max-w-3xl text-sm leading-7 text-[#b5b5b5]">
                Ten Kings Collectibles machines are stocked, authenticated, and ready for live ripping. Browse every active
                physical venue, sort by distance when GPS is available, and jump straight into Kings Hunt.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                <p className="font-kingshunt-body text-[11px] font-bold uppercase tracking-[0.24em] text-[#d4a843]">Mapped Venues</p>
                <p className="font-kingshunt-display mt-3 text-3xl uppercase tracking-[0.08em] text-white">{mapLocations.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 md:col-span-2">
                <p className="font-kingshunt-body text-[11px] font-bold uppercase tracking-[0.24em] text-[#d4a843]">Map Sync</p>
                <p className="font-kingshunt-body mt-3 text-sm leading-6 text-[#a6a6a6]">
                  Tap a gold crown to highlight the venue card, or select a card to pan the map and open that venue’s info window.
                </p>
                <p className="font-kingshunt-body mt-2 text-[12px] uppercase tracking-[0.18em] text-[#707070]">{mapSummary}</p>
              </div>
            </div>
          </header>

          {flash ? <div className="rounded-2xl border border-sky-500/40 bg-sky-500/10 px-6 py-4 text-sm text-sky-200">{flash}</div> : null}
          {error ? <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-6 py-4 text-sm text-rose-200">{error}</div> : null}

          {isAdmin ? (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={beginCreate}
                className="font-kingshunt-body rounded-full border border-[#d4a843] bg-[#d4a843] px-6 py-2 text-xs font-bold uppercase tracking-[0.32em] text-[#0a0a0a] shadow-glow transition hover:bg-[#e4bb63]"
              >
                Add location
              </button>
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] px-6 py-12 text-center text-sm text-[#9a9a9a]">
              Loading locations…
            </div>
          ) : sortedLocations.length === 0 ? (
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] px-6 py-12 text-center text-sm text-[#9a9a9a]">
              Physical Ten Kings locations will be announced soon.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
              <section className="order-2 overflow-hidden rounded-[2rem] border border-white/10 bg-[#0d0d0d] shadow-card lg:order-1 lg:h-[80vh] lg:max-h-[800px]">
                <div className="border-b border-white/8 px-5 py-4 lg:px-6">
                  <p className="font-kingshunt-body text-[11px] font-bold uppercase tracking-[0.24em] text-[#d4a843]">Location List</p>
                  <p className="font-kingshunt-body mt-2 text-sm text-[#8c8c8c]">
                    {userPosition ? "Nearest venues first." : "Venue order stays fixed if GPS access is denied."}
                  </p>
                </div>
                <div className="lg:h-[calc(80vh-5.6rem)] lg:max-h-[710px] lg:overflow-y-auto">
                  {sortedLocations.map((location) => {
                    const distanceMeters = distanceBySlug[location.slug] ?? null;
                    const isNearby = distanceMeters != null && distanceMeters < NEARBY_DISTANCE_M;

                    return (
                      <LocationCard
                        key={location.id}
                        location={location}
                        distanceMeters={distanceMeters}
                        isNearby={isNearby}
                        isSelected={selectedSlug === location.slug}
                        onSelect={() => handleLocationSelect(location)}
                        onEdit={isAdmin ? () => beginEdit(location) : undefined}
                      />
                    );
                  })}
                </div>
              </section>

              <section className="order-1 rounded-[2rem] border border-white/10 bg-[#050505] p-3 shadow-card lg:order-2 lg:sticky lg:top-24 lg:h-[80vh] lg:max-h-[800px]">
                <div className="h-[420px] overflow-hidden rounded-[1.5rem] border border-white/8 bg-[#090909] sm:h-[500px] lg:h-full">
                  <MapErrorBoundary
                    fallback={
                      <MapFallback
                        className="h-full"
                        eyebrow="Map failed to load"
                        title="Venue map unavailable"
                        body="The live map is temporarily unavailable, but the location list still works for directions and hunt links."
                      />
                    }
                  >
                    <StoreLocatorMap
                      locations={mapLocations}
                      selectedSlug={selectedSlug}
                      onMarkerClick={handleMapMarkerClick}
                      className="h-full"
                      mapRef={mapRef}
                    />
                  </MapErrorBoundary>
                </div>
                <div className="flex flex-col gap-2 px-2 pt-4 text-[11px] uppercase tracking-[0.24em] text-[#666666] md:flex-row md:items-center md:justify-between">
                  <span>{mapLocations.length} physical Ten Kings venues mapped</span>
                  <span>Clusters expand as you zoom in</span>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {editMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10">
          <div className="absolute inset-0 bg-black/70" onClick={closeEditor} />
          <div className="relative z-10 w-full max-w-2xl space-y-6 rounded-3xl border border-white/10 bg-night-900/95 p-6 shadow-2xl md:p-10">
            <h3 className="font-heading text-2xl uppercase tracking-[0.24em] text-white">
              {editMode === "create" ? "Add location" : "Edit location"}
            </h3>
            <div className="grid gap-4 text-sm text-slate-200">
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Name</span>
                <input
                  value={formState.name}
                  onChange={(event) => handleFormChange("name", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="Machine name"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Slug</span>
                <input
                  value={formState.slug}
                  onChange={(event) => handleFormChange("slug", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="internal-slug"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Description</span>
                <textarea
                  value={formState.description}
                  onChange={(event) => handleFormChange("description", event.target.value)}
                  className="min-h-[90px] rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="What makes this location special?"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Address</span>
                <input
                  value={formState.address}
                  onChange={(event) => handleFormChange("address", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="Street, City, State"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Google Maps URL</span>
                <input
                  value={formState.mapsUrl}
                  onChange={(event) => handleFormChange("mapsUrl", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="https://maps.google.com/..."
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Media URL</span>
                <input
                  value={formState.mediaUrl}
                  onChange={(event) => handleFormChange("mediaUrl", event.target.value)}
                  className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                  placeholder="https://youtube.com/... or https://...mp4"
                />
              </label>

              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs uppercase tracking-[0.3em] text-slate-400">Featured pulls</h4>
                  <button
                    type="button"
                    onClick={addRip}
                    className="rounded-full border border-white/10 px-4 py-1 text-xs uppercase tracking-[0.24em] text-gold-300 transition hover:border-gold-300"
                  >
                    Add pull
                  </button>
                </div>
                {formState.recentRips.length === 0 && (
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">No featured pulls yet.</p>
                )}
                {formState.recentRips.map((rip, index) => (
                  <div key={`rip-${index}`} className="space-y-3 rounded-2xl border border-white/10 bg-night-900/80 p-4">
                    <label className="flex flex-col gap-2">
                      <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Title</span>
                      <input
                        value={rip.title}
                        onChange={(event) =>
                          updateRip(index, {
                            ...rip,
                            title: event.target.value,
                          })
                        }
                        className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                        placeholder="Top pull title"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-xs uppercase tracking-[0.3em] text-slate-400">Video URL</span>
                      <input
                        value={rip.videoUrl}
                        onChange={(event) =>
                          updateRip(index, {
                            ...rip,
                            videoUrl: event.target.value,
                          })
                        }
                        className="rounded-xl border border-white/10 bg-night-900/70 px-4 py-3 text-white outline-none focus:border-gold-400"
                        placeholder="https://..."
                      />
                    </label>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeRip(index)}
                        className="rounded-full border border-rose-500/40 px-4 py-1 text-xs uppercase tracking-[0.24em] text-rose-300 transition hover:border-rose-400"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-full border border-white/10 px-6 py-2 text-xs uppercase tracking-[0.28em] text-slate-300 transition hover:border-white/30 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-2 text-xs font-semibold uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {saving ? "Saving…" : "Save location"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
