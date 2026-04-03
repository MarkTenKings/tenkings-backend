import Head from "next/head";
import Link from "next/link";
import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import CheckpointProgress from "../../components/maps/CheckpointProgress";
import FolsomOutletsSVG from "../../components/maps/FolsomOutletsSVG";
import KingsHuntHeader from "../../components/maps/KingsHuntHeader";
import NotAtLocationCard from "../../components/maps/NotAtLocationCard";
import StatsBar from "../../components/maps/StatsBar";
import WalkingDirections from "../../components/maps/WalkingDirections";
import { estimateWalkingTimeMin, haversineDistance } from "../../lib/geo";
import {
  FOLSOM_ROUTE_POINTS,
  buildDirectionsHref,
  clamp01,
  getLocationTypeLabel,
  interpolatePoint,
  parseCheckpoints,
  parseWalkingDirections,
  type Checkpoint,
  type KingsHuntLocation,
  type VenueMapPoint,
} from "../../lib/kingsHunt";
import { getKingsHuntLocationBySlug } from "../../lib/server/kingsHunt";

type GpsState = "detecting" | "at-venue" | "away" | "unavailable";

type PositionState = {
  lat: number;
  lng: number;
  accuracy: number | null;
};

type PageProps = {
  location: KingsHuntLocation;
  qrCodeId: string | null;
  entry: string | null;
};

function getEntryMethod(entry: string | null, qrCodeId: string | null) {
  if (qrCodeId) {
    return "qr_direct";
  }

  if (entry === "gps") {
    return "qr_gps_detect";
  }

  return "website_click";
}

function isAtVenue(location: KingsHuntLocation, lat: number, lng: number) {
  if (typeof location.venueCenterLat !== "number" || typeof location.venueCenterLng !== "number") {
    return false;
  }

  return haversineDistance(lat, lng, location.venueCenterLat, location.venueCenterLng) <= (location.geofenceRadiusM ?? 500);
}

function distanceToMachine(location: KingsHuntLocation, lat: number, lng: number) {
  if (typeof location.latitude !== "number" || typeof location.longitude !== "number") {
    return null;
  }

  return haversineDistance(lat, lng, location.latitude, location.longitude);
}

function buildUserPoint(
  location: KingsHuntLocation,
  checkpoints: Checkpoint[],
  reachedIds: number[],
  position: PositionState | null,
  huntActive: boolean,
): VenueMapPoint | null {
  if (location.slug !== "folsom-premium-outlets") {
    return null;
  }

  if (!huntActive) {
    return FOLSOM_ROUTE_POINTS.entrance;
  }

  if (!position) {
    return FOLSOM_ROUTE_POINTS.entrance;
  }

  const reachedSet = new Set(reachedIds);
  const nextCheckpoint = checkpoints.find((checkpoint) => !reachedSet.has(checkpoint.id));
  if (!nextCheckpoint) {
    return FOLSOM_ROUTE_POINTS.machine;
  }

  const completedCheckpoints = checkpoints.filter((checkpoint) => reachedSet.has(checkpoint.id));
  const previousCheckpoint = completedCheckpoints[completedCheckpoints.length - 1] ?? null;
  const previousPoint = previousCheckpoint
    ? FOLSOM_ROUTE_POINTS.checkpoints[previousCheckpoint.id] ?? FOLSOM_ROUTE_POINTS.entrance
    : FOLSOM_ROUTE_POINTS.entrance;
  const nextPoint = FOLSOM_ROUTE_POINTS.checkpoints[nextCheckpoint.id] ?? FOLSOM_ROUTE_POINTS.machine;
  const previousLat = previousCheckpoint?.lat ?? location.venueCenterLat ?? location.latitude ?? nextCheckpoint.lat;
  const previousLng = previousCheckpoint?.lng ?? location.venueCenterLng ?? location.longitude ?? nextCheckpoint.lng;
  const segmentLength = haversineDistance(previousLat, previousLng, nextCheckpoint.lat, nextCheckpoint.lng) || 1;
  const remainingDistance = haversineDistance(position.lat, position.lng, nextCheckpoint.lat, nextCheckpoint.lng);

  return interpolatePoint(previousPoint, nextPoint, clamp01(1 - remainingDistance / segmentLength));
}

export const getServerSideProps: GetServerSideProps<PageProps> = async ({ params, query }) => {
  const locationSlug = typeof params?.locationSlug === "string" ? params.locationSlug : null;
  if (!locationSlug) {
    return { notFound: true };
  }

  const location = await getKingsHuntLocationBySlug(locationSlug);
  if (!location) {
    return { notFound: true };
  }

  return {
    props: {
      location: JSON.parse(JSON.stringify(location)) as KingsHuntLocation,
      qrCodeId: typeof query.qr === "string" ? query.qr : null,
      entry: typeof query.entry === "string" ? query.entry : null,
    },
  };
};

export default function KingsHuntLocationPage({
  location,
  qrCodeId,
  entry,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const directions = useMemo(() => parseWalkingDirections(location.walkingDirections), [location.walkingDirections]);
  const checkpoints = useMemo(() => parseCheckpoints(location.checkpoints), [location.checkpoints]);
  const directionsHref = useMemo(() => buildDirectionsHref(location), [location]);
  const [gpsState, setGpsState] = useState<GpsState>("detecting");
  const [position, setPosition] = useState<PositionState | null>(null);
  const [distanceRemainingM, setDistanceRemainingM] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [huntActive, setHuntActive] = useState(false);
  const [reachedIds, setReachedIds] = useState<number[]>([]);
  const [tkdEarned, setTkdEarned] = useState(0);
  const [checkpointNotice, setCheckpointNotice] = useState<{ title: string; reward: number; message: string } | null>(null);
  const [journeyComplete, setJourneyComplete] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const sessionLoggedRef = useRef(false);
  const journeyStartedRef = useRef(false);
  const reachedIdsRef = useRef<Set<number>>(new Set());

  const createOrUpdateSession = useCallback(async (payload: Record<string, unknown>) => {
    try {
      const response = await fetch("/api/kingshunt/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Session request failed");
      }

      const result = (await response.json()) as { sessionId?: string };
      if (result.sessionId) {
        setSessionId(result.sessionId);
      }
    } catch (error) {
      console.error("Unable to persist Kings Hunt session", error);
    }
  }, []);

  useEffect(() => {
    if (checkpointNotice == null) {
      return;
    }

    const timeout = window.setTimeout(() => setCheckpointNotice(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [checkpointNotice]);

  useEffect(() => {
    let cancelled = false;

    if (!navigator.geolocation) {
      setGpsState("unavailable");
      if (!sessionLoggedRef.current) {
        sessionLoggedRef.current = true;
        void createOrUpdateSession({
          locationId: location.id,
          entryMethod: getEntryMethod(entry, qrCodeId),
          qrCodeId,
        });
      }
      return () => {
        cancelled = true;
      };
    }

    navigator.geolocation.getCurrentPosition(
      (geoPosition) => {
        if (cancelled) {
          return;
        }

        const nextPosition = {
          lat: geoPosition.coords.latitude,
          lng: geoPosition.coords.longitude,
          accuracy: Number.isFinite(geoPosition.coords.accuracy) ? geoPosition.coords.accuracy : null,
        };

        setPosition(nextPosition);
        setDistanceRemainingM(distanceToMachine(location, nextPosition.lat, nextPosition.lng));
        setGpsState(isAtVenue(location, nextPosition.lat, nextPosition.lng) ? "at-venue" : "away");

        if (!sessionLoggedRef.current) {
          sessionLoggedRef.current = true;
          void createOrUpdateSession({
            locationId: location.id,
            entryMethod: getEntryMethod(entry, qrCodeId),
            lat: nextPosition.lat,
            lng: nextPosition.lng,
            qrCodeId,
          });
        }
      },
      () => {
        if (cancelled) {
          return;
        }

        setGpsState("unavailable");
        if (!sessionLoggedRef.current) {
          sessionLoggedRef.current = true;
          void createOrUpdateSession({
            locationId: location.id,
            entryMethod: getEntryMethod(entry, qrCodeId),
            qrCodeId,
          });
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 },
    );

    return () => {
      cancelled = true;
    };
  }, [createOrUpdateSession, entry, location, qrCodeId]);

  useEffect(() => {
    if (!huntActive || !sessionId || journeyStartedRef.current) {
      return;
    }

    journeyStartedRef.current = true;
    void createOrUpdateSession({
      sessionId,
      journeyStartedAt: new Date().toISOString(),
    });
  }, [createOrUpdateSession, huntActive, sessionId]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const startHunt = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsState("unavailable");
      return;
    }

    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    setHuntActive(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (geoPosition) => {
        const nextPosition = {
          lat: geoPosition.coords.latitude,
          lng: geoPosition.coords.longitude,
          accuracy: Number.isFinite(geoPosition.coords.accuracy) ? geoPosition.coords.accuracy : null,
        };

        setPosition(nextPosition);
        setDistanceRemainingM(distanceToMachine(location, nextPosition.lat, nextPosition.lng));
        setGpsState(isAtVenue(location, nextPosition.lat, nextPosition.lng) ? "at-venue" : "away");

        checkpoints.forEach((checkpoint) => {
          if (reachedIdsRef.current.has(checkpoint.id)) {
            return;
          }

          const distanceToCheckpoint = haversineDistance(nextPosition.lat, nextPosition.lng, checkpoint.lat, checkpoint.lng);
          if (distanceToCheckpoint > checkpoint.radiusM) {
            return;
          }

          reachedIdsRef.current.add(checkpoint.id);
          const nextReachedIds = Array.from(reachedIdsRef.current).sort((left, right) => left - right);
          setReachedIds(nextReachedIds);
          setTkdEarned((current) => current + checkpoint.tkdReward);
          setCheckpointNotice({
            title: checkpoint.name,
            reward: checkpoint.tkdReward,
            message: checkpoint.message,
          });
          navigator.vibrate?.([140, 60, 180]);

          if (sessionId) {
            void fetch("/api/kingshunt/checkpoint", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId,
                checkpointId: checkpoint.id,
                tkdEarned: checkpoint.tkdReward,
                journeyCompletedAt:
                  checkpoint.id === checkpoints[checkpoints.length - 1]?.id ? new Date().toISOString() : undefined,
              }),
            }).catch((error) => console.error("Unable to log checkpoint", error));
          }

          if (checkpoint.id === checkpoints[checkpoints.length - 1]?.id) {
            setJourneyComplete(true);
          }
        });
      },
      () => {
        setGpsState("unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    );
  }, [checkpoints, location, sessionId]);

  const checkpointVisuals = useMemo(() => {
    const reachedSet = new Set(reachedIds);
    const activeCheckpointId = checkpoints.find((checkpoint) => !reachedSet.has(checkpoint.id))?.id ?? null;

    return checkpoints
      .filter((checkpoint) => FOLSOM_ROUTE_POINTS.checkpoints[checkpoint.id])
      .map((checkpoint) => ({
        id: checkpoint.id,
        label: checkpoint.name,
        status: reachedSet.has(checkpoint.id)
          ? ("completed" as const)
          : checkpoint.id === activeCheckpointId
            ? ("current" as const)
            : ("upcoming" as const),
        point: FOLSOM_ROUTE_POINTS.checkpoints[checkpoint.id],
      }));
  }, [checkpoints, reachedIds]);

  const userPoint = useMemo(
    () => buildUserPoint(location, checkpoints, reachedIds, position, huntActive),
    [checkpoints, huntActive, location, position, reachedIds],
  );

  const showInteractiveMap = location.slug === "folsom-premium-outlets" && location.hasIndoorMap;
  const shouldShowHuntButton = checkpoints.length > 0 && gpsState !== "away";
  const etaMin = distanceRemainingM != null ? estimateWalkingTimeMin(distanceRemainingM) : location.walkingTimeMin;

  return (
    <AppShell hideHeader hideFooter background="black">
      <Head>
        <title>Ten Kings · Kings Hunt · {location.name}</title>
        <meta
          name="description"
          content={`Navigate directly to the Ten Kings machine at ${location.name} with guided wayfinding and checkpoint rewards.`}
        />
      </Head>

      <div className="min-h-screen px-4 py-8 [background:radial-gradient(circle_at_top,rgba(212,168,67,0.14),transparent_28%),radial-gradient(circle_at_85%_85%,rgba(59,130,246,0.08),transparent_24%),#050505]">
        <div className="mx-auto w-full max-w-md overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,17,17,0.96),rgba(12,12,12,0.98))] shadow-[0_35px_110px_rgba(0,0,0,0.56)]">
          <KingsHuntHeader
            title={huntActive ? "Your Quest" : gpsState === "away" ? "Kings Hunt" : "Finding Your Way"}
            subtitle={huntActive ? undefined : location.slug === "folsom-premium-outlets" ? "Folsom Premium Outlets" : location.name}
            tkdEarned={huntActive ? tkdEarned : undefined}
          />

          <div className="space-y-5 px-5 py-5">
            {huntActive ? <CheckpointProgress checkpoints={checkpoints} reachedIds={reachedIds} /> : null}

            {gpsState === "away" ? (
              <>
                <NotAtLocationCard location={location} directionsHref={directionsHref} />
                <section id="preview" className="space-y-4 rounded-[26px] border border-white/10 bg-white/[0.03] p-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.28em] text-[#7f7f88]">Preview the route</p>
                    <h2 className="mt-2 text-xl font-semibold text-[#f3f3f5]">{location.name}</h2>
                  </div>
                  {showInteractiveMap ? (
                    <FolsomOutletsSVG showUser={false} huntActive={false} checkpointVisuals={checkpointVisuals} />
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-white/10 bg-[#121212] p-5 text-sm text-[#8e8e96]">
                      Indoor map coming soon.
                    </div>
                  )}
                  <WalkingDirections directions={directions} walkingTimeMin={location.walkingTimeMin} />
                </section>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <h2 className="text-[2rem] font-semibold leading-tight tracking-[-0.03em] text-[#f6f6f8]">{location.name}</h2>
                  <div
                    className={[
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em]",
                      gpsState === "at-venue"
                        ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
                        : gpsState === "detecting"
                          ? "border-[#d4a843]/20 bg-[#d4a843]/10 text-[#d4a843]"
                          : "border-white/10 bg-white/[0.04] text-[#b8b8bf]",
                    ].join(" ")}
                  >
                    <span className={gpsState === "detecting" ? "animate-pulse" : ""} aria-hidden>
                      *
                    </span>
                    {gpsState === "at-venue"
                      ? "Location detected"
                      : gpsState === "detecting"
                        ? "Checking venue"
                        : "Location unavailable"}
                  </div>
                  <p className="text-sm text-[#9a9aa3]">
                    {location.hours ? `${getLocationTypeLabel(location.locationType)} | ${location.hours}` : getLocationTypeLabel(location.locationType)}
                  </p>
                </div>

                {showInteractiveMap ? (
                  <FolsomOutletsSVG
                    showUser={gpsState !== "unavailable"}
                    userPoint={gpsState === "unavailable" ? null : userPoint}
                    huntActive={huntActive}
                    checkpointVisuals={checkpointVisuals}
                  />
                ) : (
                  <div className="space-y-4 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.26em] text-[#7c7c84]">Indoor map coming soon</p>
                        <h3 className="mt-2 text-lg font-semibold text-[#f2f2f4]">{location.name}</h3>
                      </div>
                      <span className="rounded-full border border-[#d4a843]/20 bg-[#d4a843]/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-[#d4a843]">
                        {getLocationTypeLabel(location.locationType)}
                      </span>
                    </div>
                    <p className="text-sm text-[#a3a3aa]">{location.address}</p>
                    <div className="rounded-[22px] border border-dashed border-white/10 bg-[#101010] px-4 py-5 text-sm text-[#82828a]">
                      We&apos;re collecting indoor routing details for this venue. Use the walking steps and Google Maps for now.
                    </div>
                  </div>
                )}

                {checkpointNotice ? (
                  <div className="rounded-[22px] border border-[rgba(212,168,67,0.24)] bg-[rgba(212,168,67,0.08)] px-4 py-4 shadow-[0_18px_45px_rgba(212,168,67,0.12)]">
                    <p className="text-sm font-semibold text-[#f3e3b5]">Checkpoint reached: {checkpointNotice.title}</p>
                    <p className="mt-1 text-lg font-semibold text-[#d4a843]">+{checkpointNotice.reward} TKD</p>
                    <p className="mt-1 text-sm text-[#b4a16a]">{checkpointNotice.message}</p>
                  </div>
                ) : null}

                {journeyComplete ? (
                  <div className="rounded-[24px] border border-emerald-400/20 bg-emerald-500/10 px-4 py-4 text-center">
                    <p className="text-sm uppercase tracking-[0.24em] text-emerald-300">Treasure Found</p>
                    <p className="mt-2 text-lg font-semibold text-[#f6fff8]">Claim your reward at the machine.</p>
                  </div>
                ) : null}

                <WalkingDirections directions={directions} walkingTimeMin={location.walkingTimeMin} />

                {location.machinePhotoUrl ? (
                  <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03]">
                    <img src={location.machinePhotoUrl} alt={`Ten Kings machine at ${location.name}`} className="h-48 w-full object-cover" />
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-4 text-xs uppercase tracking-[0.22em] text-[#7d7d85]">
                    Machine photo coming soon
                  </div>
                )}

                <Link
                  href={directionsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-full items-center justify-center rounded-[18px] border border-[#d4a843]/40 px-4 py-3 text-sm font-semibold text-[#d4a843] transition hover:border-[#d4a843] hover:bg-[#d4a843]/10"
                >
                  Open in Google Maps
                </Link>

                {shouldShowHuntButton ? (
                  <button
                    type="button"
                    onClick={startHunt}
                    className="flex w-full items-center justify-center rounded-[18px] bg-[#d4a843] px-4 py-3 text-sm font-semibold text-[#15120a] transition hover:bg-[#e0b84e]"
                  >
                    {huntActive ? "Keep tracking the hunt" : "Start the Hunt"}
                  </button>
                ) : null}

                {huntActive ? (
                  <StatsBar distanceM={distanceRemainingM} etaMin={etaMin} accuracyM={position?.accuracy ?? null} />
                ) : null}
              </>
            )}

            <div className="flex items-center justify-between border-t border-white/8 pt-4 text-xs uppercase tracking-[0.22em] text-[#6f6f76]">
              <span>{location.city && location.state ? `${location.city}, ${location.state}` : location.address}</span>
              <Link href="/locations" className="text-[#d4a843] transition hover:text-[#e0b84e]">
                All locations
              </Link>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
