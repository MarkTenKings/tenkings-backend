import dynamic from "next/dynamic";
import { useState } from "react";
import { slugify } from "../../lib/slugify";
import { adminInputClass } from "./AdminPrimitives";
import type { PinDropMapProps } from "./PinDropMap";

const PinDropMap = dynamic<PinDropMapProps>(() => import("./PinDropMap").then((mod) => mod.PinDropMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[260px] items-center justify-center rounded-lg border border-white/10 bg-black/40 text-[11px] uppercase tracking-[0.24em] text-gold-300">
      Loading map
    </div>
  ),
});

export type CreateLocationInput = {
  name: string;
  address: string;
  slug: string;
  latitude: number | null;
  longitude: number | null;
  venueCenterLat: number | null;
  venueCenterLng: number | null;
  geofenceRadiusM: number;
  machineLat: number | null;
  machineLng: number | null;
  machineGeofenceM: number;
};

type AddLocationModalProps = {
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onCreate: (value: CreateLocationInput) => void;
};

function parseNumberInput(value: string, fallback: number | null = null) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function AddLocationModal({ busy = false, error, onClose, onCreate }: AddLocationModalProps) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [venueCenterLat, setVenueCenterLat] = useState<number | null>(null);
  const [venueCenterLng, setVenueCenterLng] = useState<number | null>(null);
  const [geofenceRadiusM, setGeofenceRadiusM] = useState(500);
  const [machineLat, setMachineLat] = useState<number | null>(null);
  const [machineLng, setMachineLng] = useState<number | null>(null);
  const [machineGeofenceM, setMachineGeofenceM] = useState(20);
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug((current) => {
      if (!slugTouched || current === slugify(name)) {
        return slugify(value);
      }
      return current;
    });
  };

  const submit = () => {
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();
    const normalizedSlug = slugify(slug || trimmedName);

    if (!trimmedName) {
      setClientError("Location name is required.");
      return;
    }
    if (!trimmedAddress) {
      setClientError("Address is required.");
      return;
    }
    if (!normalizedSlug) {
      setClientError("Slug is required.");
      return;
    }

    setClientError(null);
    onCreate({
      name: trimmedName,
      address: trimmedAddress,
      slug: normalizedSlug,
      latitude,
      longitude,
      venueCenterLat: venueCenterLat ?? latitude,
      venueCenterLng: venueCenterLng ?? longitude,
      geofenceRadiusM,
      machineLat,
      machineLng,
      machineGeofenceM,
    });
  };

  const geocodeAddress = async () => {
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      setClientError("Address is required before geocoding.");
      return;
    }

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setClientError("Missing Google Maps browser API key.");
      return;
    }

    setGeocodingAddress(true);
    setClientError(null);

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(trimmedAddress)}&key=${encodeURIComponent(apiKey)}`,
      );
      const payload = (await response.json().catch(() => ({}))) as {
        results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
        error_message?: string;
      };
      const nextPosition = payload.results?.[0]?.geometry?.location;
      if (typeof nextPosition?.lat !== "number" || typeof nextPosition.lng !== "number") {
        throw new Error(payload.error_message ?? "Google did not return coordinates for this address.");
      }

      setLatitude(nextPosition.lat);
      setLongitude(nextPosition.lng);
      setVenueCenterLat(nextPosition.lat);
      setVenueCenterLng(nextPosition.lng);
    } catch (geocodeError) {
      setClientError(geocodeError instanceof Error ? geocodeError.message : "Failed to geocode address.");
    } finally {
      setGeocodingAddress(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-sm">
      <div className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-[8px] border border-white/10 bg-night-900 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Assigned Locations</p>
            <h2 className="font-heading text-2xl uppercase tracking-[0.12em] text-white">Add New Location</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-white/12 px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-slate-300 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Name</span>
            <input
              value={name}
              onChange={(event) => handleNameChange(event.currentTarget.value)}
              className={adminInputClass()}
              placeholder="Dallas Stars CoAmerica Center"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Address</span>
            <input
              value={address}
              onChange={(event) => setAddress(event.currentTarget.value)}
              className={adminInputClass()}
              placeholder="2601 Avenue of the Stars, Frisco, TX 75034"
            />
            <button
              type="button"
              onClick={() => void geocodeAddress()}
              disabled={busy || geocodingAddress}
              className="w-fit rounded-[4px] border border-white/15 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-gold-300 transition hover:border-gold-400/50 disabled:cursor-wait disabled:opacity-50"
            >
              {geocodingAddress ? "Geocoding..." : "Geocode Address"}
            </button>
          </label>

          <section className="space-y-3 rounded-[8px] border border-white/10 bg-black/25 p-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Venue Location</p>
              <p className="mt-1 text-xs text-slate-500">Drop the gold pin on the venue or building location.</p>
            </div>
            <PinDropMap
              lat={latitude}
              lng={longitude}
              onPositionChange={(nextLat, nextLng) => {
                setLatitude(nextLat);
                setLongitude(nextLng);
                setVenueCenterLat((current) => current ?? nextLat);
                setVenueCenterLng((current) => current ?? nextLng);
              }}
              geofenceRadiusM={geofenceRadiusM}
              pinColor="#d4a843"
              pinLabel="V"
              height="260px"
              zoom={15}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Latitude</span>
                <input
                  type="number"
                  step="any"
                  value={latitude ?? ""}
                  onChange={(event) => {
                    const parsed = parseNumberInput(event.currentTarget.value);
                    setLatitude(parsed);
                    setVenueCenterLat((current) => current ?? parsed);
                  }}
                  className={adminInputClass()}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Longitude</span>
                <input
                  type="number"
                  step="any"
                  value={longitude ?? ""}
                  onChange={(event) => {
                    const parsed = parseNumberInput(event.currentTarget.value);
                    setLongitude(parsed);
                    setVenueCenterLng((current) => current ?? parsed);
                  }}
                  className={adminInputClass()}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Geofence Radius (meters)</span>
                <input
                  type="number"
                  value={geofenceRadiusM}
                  onChange={(event) => setGeofenceRadiusM(parseNumberInput(event.currentTarget.value, 500) ?? 500)}
                  className={adminInputClass()}
                />
              </label>
            </div>
          </section>

          <section className="space-y-3 rounded-[8px] border border-white/10 bg-black/25 p-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Machine Location</p>
              <p className="mt-1 text-xs text-slate-500">
                Drop the blue pin where the Ten Kings machine sits inside the venue. The machine geofence defaults to 20 meters.
              </p>
            </div>
            <PinDropMap
              lat={machineLat}
              lng={machineLng}
              onPositionChange={(nextLat, nextLng) => {
                setMachineLat(nextLat);
                setMachineLng(nextLng);
                setMachineGeofenceM((current) => current || 20);
              }}
              geofenceRadiusM={machineGeofenceM}
              pinColor="#3b82f6"
              pinLabel="M"
              height="260px"
              zoom={18}
              defaultCenter={typeof latitude === "number" && typeof longitude === "number" ? { lat: latitude, lng: longitude } : null}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Machine Latitude</span>
                <input
                  type="number"
                  step="any"
                  value={machineLat ?? ""}
                  onChange={(event) => setMachineLat(parseNumberInput(event.currentTarget.value))}
                  className={adminInputClass()}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-200">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Machine Longitude</span>
                <input
                  type="number"
                  step="any"
                  value={machineLng ?? ""}
                  onChange={(event) => setMachineLng(parseNumberInput(event.currentTarget.value))}
                  className={adminInputClass()}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm text-slate-200 md:col-span-2">
                <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Machine Geofence (meters)</span>
                <input
                  type="number"
                  value={machineGeofenceM}
                  onChange={(event) => setMachineGeofenceM(parseNumberInput(event.currentTarget.value, 20) ?? 20)}
                  className={adminInputClass()}
                />
                <span className="text-xs text-slate-500">Default: 20 meters. Triggers stocker task workflow when within this distance.</span>
              </label>
            </div>
          </section>

          <label className="flex flex-col gap-2 text-sm text-slate-200">
            <span className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Slug</span>
            <input
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.currentTarget.value);
              }}
              className={adminInputClass()}
              placeholder="dallas-stars-coamerica-center"
            />
            <span className="text-xs text-slate-500">Auto-generated from the name, but you can edit it.</span>
          </label>
        </div>

        {clientError || error ? (
          <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {clientError ?? error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-white/12 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-200 transition hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-full border border-gold-400/60 bg-gold-500 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-night-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
