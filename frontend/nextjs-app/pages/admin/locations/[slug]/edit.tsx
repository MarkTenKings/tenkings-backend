import Head from "next/head";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../../../../components/AppShell";
import {
  ADMIN_PAGE_FRAME_CLASS,
  AdminPageHeader,
  adminInputClass,
  adminPanelClass,
  adminSelectClass,
  adminTextareaClass,
} from "../../../../components/admin/AdminPrimitives";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../../constants/admin";
import { useSession } from "../../../../hooks/useSession";
import { buildAdminHeaders } from "../../../../lib/adminHeaders";
import { LOCATION_STATUS_VALUES, type LocationLiveStatusResponse } from "../../../../lib/locationStatus";
import type { PinDropMapProps } from "../../../../components/admin/PinDropMap";

const PinDropMap = dynamic<PinDropMapProps>(() => import("../../../../components/admin/PinDropMap").then((mod) => mod.PinDropMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[280px] items-center justify-center rounded-lg border border-white/10 bg-black/40 text-[11px] uppercase tracking-[0.24em] text-gold-300">
      Loading map
    </div>
  ),
});

type EditableLocation = {
  id: string;
  name: string;
  slug: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  description: string | null;
  hours: string | null;
  locationType: string | null;
  locationStatus: string | null;
  latitude: number | null;
  longitude: number | null;
  venueCenterLat: number | null;
  venueCenterLng: number | null;
  geofenceRadiusM: number | null;
  machineLat: number | null;
  machineLng: number | null;
  machineGeofenceM: number | null;
  mapsUrl: string | null;
  mediaUrl: string | null;
  machinePhotoUrl: string | null;
  walkingTimeMin: number | null;
  landmarks: string[];
  hasIndoorMap: boolean;
};

type TextFieldKey =
  | "name"
  | "slug"
  | "address"
  | "city"
  | "state"
  | "zip"
  | "hours"
  | "mapsUrl"
  | "machinePhotoUrl";

type NumberFieldKey =
  | "latitude"
  | "longitude"
  | "venueCenterLat"
  | "venueCenterLng"
  | "geofenceRadiusM"
  | "walkingTimeMin";

const textFields: Array<{ key: TextFieldKey; label: string; required?: boolean }> = [
  { key: "name", label: "Name", required: true },
  { key: "slug", label: "Slug", required: true },
  { key: "address", label: "Address", required: true },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "ZIP" },
  { key: "hours", label: "Hours" },
  { key: "mapsUrl", label: "Google Maps URL" },
  { key: "machinePhotoUrl", label: "Machine Photo URL" },
];

const numberFields: Array<{ key: NumberFieldKey; label: string; integer?: boolean }> = [
  { key: "latitude", label: "Latitude" },
  { key: "longitude", label: "Longitude" },
  { key: "venueCenterLat", label: "Venue Center Latitude" },
  { key: "venueCenterLng", label: "Venue Center Longitude" },
  { key: "geofenceRadiusM", label: "Geofence Radius (meters)", integer: true },
  { key: "walkingTimeMin", label: "Walking Time (minutes)", integer: true },
];

const locationTypeOptions = ["mall", "arena", "casino", "stadium", "venue", "online", "other"];

function normalizeLoadedLocation(payload: Partial<EditableLocation>): EditableLocation {
  return {
    id: payload.id ?? "",
    name: payload.name ?? "",
    slug: payload.slug ?? "",
    address: payload.address ?? "",
    city: payload.city ?? null,
    state: payload.state ?? null,
    zip: payload.zip ?? null,
    description: payload.description ?? null,
    hours: payload.hours ?? null,
    locationType: payload.locationType ?? null,
    locationStatus: payload.locationStatus ?? "active",
    latitude: typeof payload.latitude === "number" ? payload.latitude : null,
    longitude: typeof payload.longitude === "number" ? payload.longitude : null,
    venueCenterLat: typeof payload.venueCenterLat === "number" ? payload.venueCenterLat : null,
    venueCenterLng: typeof payload.venueCenterLng === "number" ? payload.venueCenterLng : null,
    geofenceRadiusM: typeof payload.geofenceRadiusM === "number" ? payload.geofenceRadiusM : null,
    machineLat: typeof payload.machineLat === "number" ? payload.machineLat : null,
    machineLng: typeof payload.machineLng === "number" ? payload.machineLng : null,
    machineGeofenceM: typeof payload.machineGeofenceM === "number" ? payload.machineGeofenceM : null,
    mapsUrl: payload.mapsUrl ?? null,
    mediaUrl: payload.mediaUrl ?? null,
    machinePhotoUrl: payload.machinePhotoUrl ?? null,
    walkingTimeMin: typeof payload.walkingTimeMin === "number" ? payload.walkingTimeMin : null,
    landmarks: Array.isArray(payload.landmarks) ? payload.landmarks.filter((value) => typeof value === "string") : [],
    hasIndoorMap: Boolean(payload.hasIndoorMap),
  };
}

function parseNumberInput(value: string, integer = false) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = integer ? Number.parseInt(trimmed, 10) : Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function EditLocationPage() {
  const router = useRouter();
  const { slug } = router.query;
  const slugParam = typeof slug === "string" ? slug : "";
  const { session, loading } = useSession();
  const [location, setLocation] = useState<EditableLocation | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchingHours, setFetchingHours] = useState(false);
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );

  useEffect(() => {
    if (!loading && (!session || !isAdmin)) {
      void router.replace("/locations");
    }
  }, [isAdmin, loading, router, session]);

  useEffect(() => {
    if (!slugParam || !session?.token || !isAdmin) {
      return;
    }

    const controller = new AbortController();
    setLoadingLocation(true);
    setError(null);

    fetch(`/api/locations/${encodeURIComponent(slugParam)}`, {
      headers: buildAdminHeaders(session.token),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as Partial<EditableLocation> & { message?: string };
        if (!response.ok) {
          throw new Error(payload.message ?? "Failed to load location");
        }
        setLocation(normalizeLoadedLocation(payload));
      })
      .catch((loadError: unknown) => {
        if ((loadError as Error)?.name === "AbortError") {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load location");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingLocation(false);
        }
      });

    return () => controller.abort();
  }, [isAdmin, session?.token, slugParam]);

  const updateLocationField = <Key extends keyof EditableLocation>(key: Key, value: EditableLocation[Key]) => {
    setLocation((current) => (current ? { ...current, [key]: value } : current));
  };

  const handleGeocodeAddress = async () => {
    if (!location?.address.trim()) {
      return;
    }

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError("Missing Google Maps browser API key.");
      return;
    }

    setGeocodingAddress(true);
    setError(null);

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location.address)}&key=${encodeURIComponent(apiKey)}`,
      );
      const payload = (await response.json().catch(() => ({}))) as {
        results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
        error_message?: string;
        status?: string;
      };
      const nextPosition = payload.results?.[0]?.geometry?.location;
      if (typeof nextPosition?.lat !== "number" || typeof nextPosition.lng !== "number") {
        throw new Error(payload.error_message ?? "Google did not return coordinates for this address.");
      }

      setLocation((current) =>
        current
          ? {
              ...current,
              latitude: nextPosition.lat as number,
              longitude: nextPosition.lng as number,
              venueCenterLat: nextPosition.lat as number,
              venueCenterLng: nextPosition.lng as number,
            }
          : current,
      );
    } catch (geocodeError: unknown) {
      setError(geocodeError instanceof Error ? geocodeError.message : "Failed to geocode address");
    } finally {
      setGeocodingAddress(false);
    }
  };

  const handleFetchHours = async () => {
    if (!location?.slug) {
      return;
    }

    setFetchingHours(true);
    setError(null);

    try {
      const response = await fetch(`/api/locations/${encodeURIComponent(location.slug)}/live-status`);
      const payload = (await response.json().catch(() => ({}))) as LocationLiveStatusResponse & {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? payload.message ?? "Failed to fetch hours");
      }

      if (!Array.isArray(payload.hours) || payload.hours.length === 0) {
        throw new Error("Google did not return hours for this location.");
      }

      updateLocationField("hours", payload.hours.join(" | "));
    } catch (fetchError: unknown) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to fetch hours");
    } finally {
      setFetchingHours(false);
    }
  };

  const handleSave = async () => {
    if (!location || !session?.token || !slugParam) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/locations/${encodeURIComponent(slugParam)}`, {
        method: "PUT",
        headers: buildAdminHeaders(session.token, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(location),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<EditableLocation> & { message?: string };

      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to save location");
      }

      setLocation(normalizeLoadedLocation(payload));
      await router.push("/locations");
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save location");
    } finally {
      setSaving(false);
    }
  };

  const gateMessage = loading || (!session && !error) || (!isAdmin && !error) ? "Checking admin access..." : null;
  const loadingMessage = error ?? (loadingLocation || !slugParam || !location ? "Loading location..." : gateMessage);

  if (gateMessage || loadingLocation || !location) {
    return (
      <AppShell>
        <Head>
          <title>Ten Kings · Edit Location</title>
          <meta name="robots" content="noindex" />
        </Head>
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm uppercase tracking-[0.32em] text-slate-500">{loadingMessage}</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Ten Kings · Edit {location.name || "Location"}</title>
        <meta name="robots" content="noindex" />
      </Head>

      <div className={ADMIN_PAGE_FRAME_CLASS}>
        <AdminPageHeader
          backHref="/locations"
          backLabel="Back to Locations"
          eyebrow="Location Admin"
          title="Edit Location"
          description="Update the public venue details, geofence, map links, and hunt metadata for this Ten Kings location."
        />

        {error ? (
          <section className={adminPanelClass("border-rose-400/25 bg-rose-500/10 p-4")}>
            <p className="text-sm text-rose-200">{error}</p>
          </section>
        ) : null}

        <section className={adminPanelClass("mx-auto w-full max-w-3xl p-5 md:p-6")}>
          <div className="grid gap-4 md:grid-cols-2">
            {textFields.map((field) => {
              const input = (
                <input
                  type="text"
                  value={location[field.key] ?? ""}
                  onChange={(event) => updateLocationField(field.key, event.target.value as EditableLocation[typeof field.key])}
                  className={adminInputClass("w-full")}
                />
              );

              if (field.key === "hours") {
                return (
                  <div key={field.key} className="space-y-2">
                    <label className="space-y-2">
                      <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">{field.label}</span>
                      {input}
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleFetchHours()}
                      disabled={fetchingHours}
                      style={{
                        marginTop: "4px",
                        padding: "6px 12px",
                        background: "transparent",
                        border: "1px solid #333",
                        borderRadius: "4px",
                        color: "#d4a843",
                        fontSize: "11px",
                        fontFamily: "Satoshi, sans-serif",
                        cursor: fetchingHours ? "wait" : "pointer",
                        opacity: fetchingHours ? 0.65 : 1,
                      }}
                    >
                      {fetchingHours ? "Fetching Hours..." : "Fetch Hours from Google"}
                    </button>
                  </div>
                );
              }

              if (field.key === "address") {
                return (
                  <div key={field.key} className="space-y-2 md:col-span-2">
                    <label className="space-y-2">
                      <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">
                        {field.label}
                        {field.required ? " *" : ""}
                      </span>
                      {input}
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleGeocodeAddress()}
                      disabled={geocodingAddress}
                      style={{
                        marginTop: "4px",
                        padding: "6px 12px",
                        background: "transparent",
                        border: "1px solid #333",
                        borderRadius: "4px",
                        color: "#d4a843",
                        fontSize: "11px",
                        fontFamily: "Satoshi, sans-serif",
                        cursor: geocodingAddress ? "wait" : "pointer",
                        opacity: geocodingAddress ? 0.65 : 1,
                      }}
                    >
                      {geocodingAddress ? "Geocoding..." : "Geocode Address"}
                    </button>
                  </div>
                );
              }

              return (
                <label key={field.key} className="space-y-2">
                  <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>
                  {input}
                </label>
              );
            })}

            <label className="space-y-2">
              <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">Location Type</span>
              <select
                value={location.locationType ?? ""}
                onChange={(event) => updateLocationField("locationType", event.target.value || null)}
                className={adminSelectClass("w-full")}
              >
                <option value="">Select type</option>
                {locationTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">Location Status</span>
              <select
                value={location.locationStatus ?? ""}
                onChange={(event) => updateLocationField("locationStatus", event.target.value || null)}
                className={adminSelectClass("w-full")}
              >
                <option value="">Unset</option>
                {LOCATION_STATUS_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">Description</span>
              <textarea
                value={location.description ?? ""}
                onChange={(event) => updateLocationField("description", event.target.value || null)}
                rows={4}
                className={adminTextareaClass("w-full")}
              />
            </label>

            <div className="space-y-3 md:col-span-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Venue Location</p>
                <p className="mt-1 text-xs text-slate-500">Drop the gold pin on the venue or building location.</p>
              </div>
              <PinDropMap
                lat={location.latitude}
                lng={location.longitude}
                onPositionChange={(nextLat, nextLng) => {
                  setLocation((current) =>
                    current
                      ? {
                          ...current,
                          latitude: nextLat,
                          longitude: nextLng,
                          venueCenterLat: current.venueCenterLat ?? nextLat,
                          venueCenterLng: current.venueCenterLng ?? nextLng,
                        }
                      : current,
                  );
                }}
                geofenceRadiusM={location.geofenceRadiusM ?? 500}
                pinColor="#d4a843"
                pinLabel="V"
                height="280px"
                zoom={15}
              />
            </div>

            <div className="space-y-3 md:col-span-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Machine Location</p>
                <p className="mt-1 text-xs text-slate-500">
                  Drop the blue pin on the exact Ten Kings machine position. The machine geofence defaults to 20 meters.
                </p>
              </div>
              <PinDropMap
                lat={location.machineLat}
                lng={location.machineLng}
                onPositionChange={(nextLat, nextLng) => {
                  setLocation((current) =>
                    current
                      ? {
                          ...current,
                          machineLat: nextLat,
                          machineLng: nextLng,
                          machineGeofenceM: current.machineGeofenceM ?? 20,
                        }
                      : current,
                  );
                }}
                geofenceRadiusM={location.machineGeofenceM ?? 20}
                pinColor="#3b82f6"
                pinLabel="M"
                height="280px"
                zoom={18}
                defaultCenter={
                  typeof location.latitude === "number" && typeof location.longitude === "number"
                    ? { lat: location.latitude, lng: location.longitude }
                    : null
                }
              />
            </div>

            <label className="space-y-2">
              <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">Machine Latitude</span>
              <input
                type="number"
                step="any"
                value={location.machineLat ?? ""}
                onChange={(event) => updateLocationField("machineLat", parseNumberInput(event.target.value))}
                className={adminInputClass("w-full")}
              />
            </label>

            <label className="space-y-2">
              <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">Machine Longitude</span>
              <input
                type="number"
                step="any"
                value={location.machineLng ?? ""}
                onChange={(event) => updateLocationField("machineLng", parseNumberInput(event.target.value))}
                className={adminInputClass("w-full")}
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">Machine Geofence (meters)</span>
              <input
                type="number"
                value={location.machineGeofenceM ?? 20}
                onChange={(event) => updateLocationField("machineGeofenceM", parseNumberInput(event.target.value, true) ?? 20)}
                className={adminInputClass("w-full")}
              />
              <p className="text-xs text-slate-500">Default: 20 meters. Triggers stocker task workflow when within this distance.</p>
            </label>

            {numberFields.map((field) => (
              <label key={field.key} className="space-y-2">
                <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">{field.label}</span>
                <input
                  type="number"
                  step={field.integer ? undefined : "any"}
                  value={location[field.key] ?? ""}
                  onChange={(event) => {
                    const parsed = parseNumberInput(event.target.value, field.integer);
                    if (field.key === "latitude") {
                      setLocation((current) =>
                        current ? { ...current, latitude: parsed, venueCenterLat: current.venueCenterLat ?? parsed } : current,
                      );
                      return;
                    }
                    if (field.key === "longitude") {
                      setLocation((current) =>
                        current ? { ...current, longitude: parsed, venueCenterLng: current.venueCenterLng ?? parsed } : current,
                      );
                      return;
                    }
                    updateLocationField(field.key, parsed);
                  }}
                  className={adminInputClass("w-full")}
                />
              </label>
            ))}

            <label className="space-y-2 md:col-span-2">
              <span className="block text-[11px] uppercase tracking-[0.24em] text-slate-500">Landmarks</span>
              <textarea
                value={location.landmarks.join("\n")}
                onChange={(event) =>
                  updateLocationField(
                    "landmarks",
                    event.target.value
                      .split("\n")
                      .map((value) => value.trim())
                      .filter(Boolean),
                  )
                }
                rows={4}
                className={adminTextareaClass("w-full")}
              />
              <p className="text-xs text-slate-500">One landmark per line.</p>
            </label>

            <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 md:col-span-2">
              <input
                type="checkbox"
                checked={location.hasIndoorMap}
                onChange={(event) => updateLocationField("hasIndoorMap", event.target.checked)}
                className="h-4 w-4 accent-gold-400"
              />
              <span className="text-sm text-slate-200">Indoor map available</span>
            </label>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg bg-gold-500 px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.24em] text-night-950 transition hover:bg-gold-400 disabled:cursor-wait disabled:opacity-60 sm:flex-1"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-lg border border-white/12 px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.24em] text-slate-300 transition hover:border-white/25 hover:text-white sm:flex-1"
            >
              Cancel
            </button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
