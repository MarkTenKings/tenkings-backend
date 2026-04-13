import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { haversineDistance } from "../../lib/geo";
import {
  formatDistance,
  formatLocationHours,
  getLocationTypeLabel,
  getMachinePosition,
  type DetectVenue,
  type KingsHuntLocation,
} from "../../lib/kingsHunt";
import { listActiveKingsHuntLocations } from "../../lib/server/kingsHunt";

interface KingsHuntIndexPageProps {
  locations: KingsHuntLocation[];
}

interface DistanceLookup {
  [slug: string]: number;
}

type DetectStatus = "loading" | "denied" | "error" | "ready";

export const getServerSideProps: GetServerSideProps<KingsHuntIndexPageProps> = async () => {
  const locations = await listActiveKingsHuntLocations();

  return {
    props: {
      locations: JSON.parse(JSON.stringify(locations)) as KingsHuntLocation[],
    },
  };
};

export default function KingsHuntIndexPage({
  locations,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const router = useRouter();
  const [status, setStatus] = useState<DetectStatus>("loading");
  const [distances, setDistances] = useState<DistanceLookup>({});
  const [statusMessage, setStatusMessage] = useState<string>("Scanning for your venue…");

  useEffect(() => {
    let cancelled = false;

    if (!navigator.geolocation) {
      setStatus("error");
      setStatusMessage("This browser does not support GPS. Pick your venue manually below.");
      return () => {
        cancelled = true;
      };
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (cancelled) {
          return;
        }

        const currentDistances = locations.reduce<DistanceLookup>((accumulator, location) => {
          const machinePosition = getMachinePosition(location);
          if (machinePosition) {
            accumulator[location.slug] = haversineDistance(
              position.coords.latitude,
              position.coords.longitude,
              machinePosition.lat,
              machinePosition.lng,
            );
          }

          return accumulator;
        }, {});

        setDistances(currentDistances);

        try {
          const response = await fetch("/api/kingshunt/detect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            }),
          });

          const payload = (await response.json().catch(() => ({}))) as {
            location?: DetectVenue | null;
            detected?: DetectVenue[];
            message?: string;
          };

          if (!response.ok) {
            throw new Error(payload.message ?? "Unable to detect nearby venue");
          }

          if (payload.location?.slug) {
            setStatusMessage(`Launching ${payload.location.name}…`);
            void router.replace(`/kingshunt/${payload.location.slug}?entry=gps`);
            return;
          }

          setStatus("ready");
          setStatusMessage("No active venue geofence matched your GPS. Choose the nearest machine below.");
        } catch (error) {
          console.error("Kings Hunt detect failed", error);
          if (!cancelled) {
            setStatus("error");
            setStatusMessage(error instanceof Error ? error.message : "Unable to auto-detect your venue.");
          }
        }
      },
      (error) => {
        if (cancelled) {
          return;
        }

        if (error.code === error.PERMISSION_DENIED) {
          setStatus("denied");
          setStatusMessage("Location access is off. Pick your venue manually to start the hunt.");
          return;
        }

        setStatus("error");
        setStatusMessage("We couldn't get a GPS fix. Pick your venue manually and we'll still guide you.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );

    return () => {
      cancelled = true;
    };
  }, [locations, router]);

  const sortedLocations = useMemo(() => {
    return [...locations].sort((left, right) => {
      const leftDistance = distances[left.slug] ?? Number.POSITIVE_INFINITY;
      const rightDistance = distances[right.slug] ?? Number.POSITIVE_INFINITY;
      return leftDistance - rightDistance;
    });
  }, [distances, locations]);

  return (
    <AppShell hideHeader hideFooter background="black">
      <Head>
        <title>Ten Kings · Kings Hunt</title>
        <meta name="description" content="Auto-detect the nearest Ten Kings venue and launch live GPS wayfinding to the machine." />
      </Head>

      <div className="min-h-screen bg-[#0a0a0a] px-4 py-8 text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
          <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(212,168,67,0.18),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015)),#0e0e0e] px-6 py-7 shadow-[0_28px_90px_rgba(0,0,0,0.5)] md:px-8">
            <p className="font-kingshunt-body text-xs uppercase tracking-[0.34em] text-[#d4a843]">Kings Hunt</p>
            <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="max-w-3xl">
                <h1 className="font-kingshunt-display text-4xl leading-none tracking-[0.04em] text-white md:text-6xl">
                  Find the machine.
                  <br />
                  Follow the gold route.
                </h1>
                <p className="font-kingshunt-body mt-4 max-w-2xl text-sm leading-6 text-[#b7b7b7] md:text-base">
                  We request GPS immediately, check every active venue geofence, and drop you into the live wayfinding experience if
                  you&apos;re already on site.
                </p>
              </div>
              <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-4 py-3">
                <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843]">
                  {status === "loading" ? "Scanning GPS" : status === "ready" ? "Venue not matched" : status === "denied" ? "Location Off" : "Retry Needed"}
                </p>
                <p className="font-kingshunt-body mt-2 max-w-xs text-sm leading-6 text-[#dedede]">{statusMessage}</p>
              </div>
            </div>
          </section>

          {(status === "denied" || status === "error") && (
            <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] px-5 py-4">
              <p className="font-kingshunt-body text-sm text-[#d9d9d9]">
                Kings Hunt still works without auto-detect. Pick the venue you&apos;re at and we&apos;ll open the location-specific hunt page.
              </p>
            </div>
          )}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sortedLocations.map((location) => {
              const distanceLabel = distances[location.slug] != null ? formatDistance(distances[location.slug]) : null;
              const hoursLabel = formatLocationHours(location.hours);

              return (
                <Link
                  key={location.id}
                  href={`/kingshunt/${location.slug}`}
                  className="group rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 transition hover:border-[#d4a843]/40 hover:bg-white/[0.05]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843]">
                        {getLocationTypeLabel(location.locationType)}
                      </p>
                      <h2 className="font-kingshunt-display mt-3 text-[2rem] leading-none tracking-[0.04em] text-white">
                        {location.name}
                      </h2>
                    </div>
                    {distanceLabel ? (
                      <span className="font-kingshunt-body rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[0.68rem] uppercase tracking-[0.24em] text-[#f2f2f2]">
                        {distanceLabel}
                      </span>
                    ) : null}
                  </div>

                  <p className="font-kingshunt-body mt-4 text-sm leading-6 text-[#bdbdbd]">{location.address}</p>
                  {hoursLabel ? <p className="font-kingshunt-body mt-2 text-xs uppercase tracking-[0.22em] text-[#8f8f8f]">{hoursLabel}</p> : null}

                  <div className="mt-6 flex items-center justify-between">
                    <span className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-white/55">
                      {location.city && location.state ? `${location.city}, ${location.state}` : "View hunt"}
                    </span>
                    <span className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843] transition group-hover:translate-x-1">
                      Start Hunt
                    </span>
                  </div>
                </Link>
              );
            })}
          </section>

          <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-4">
            <Link href="/locations" className="font-kingshunt-body text-xs uppercase tracking-[0.28em] text-[#d4a843]">
              Browse full location pages
            </Link>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="font-kingshunt-body rounded-full border border-white/10 px-4 py-2 text-[0.68rem] uppercase tracking-[0.28em] text-white/78 transition hover:border-[#d4a843]/40 hover:text-white"
            >
              Retry GPS
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
