'use client';

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import MapErrorBoundary from "../maps/MapErrorBoundary";
import MapFallback from "../maps/MapFallback";
import TenKingsMap from "../maps/TenKingsMap";
import { useKingsHunt } from "../../hooks/useKingsHunt";
import {
  buildDirectionsHref,
  formatDistance,
  formatDuration,
  formatLocationHours,
  getLocationTypeLabel,
  getMachinePosition,
  getVenueCenterPosition,
  type LatLng,
  type KingsHuntLocation,
} from "../../lib/kingsHunt";

export interface KingsHuntExperienceProps {
  location: KingsHuntLocation;
  entryMethod: string;
  qrCodeId?: string | null;
}

function StateCard({
  eyebrow,
  title,
  body,
  actions,
}: {
  eyebrow: string;
  title: string;
  body: string;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5">
      <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.3em] text-[#d4a843]">{eyebrow}</p>
      <h2 className="font-kingshunt-display mt-3 text-[2rem] leading-none tracking-[0.04em] text-white">{title}</h2>
      <p className="font-kingshunt-body mt-4 text-sm leading-6 text-[#c8c8c8]">{body}</p>
      {actions ? <div className="mt-5 flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  );
}

function buildStaticRoutePath(points: Array<LatLng | null>): LatLng[] {
  const path: LatLng[] = [];

  points.forEach((point) => {
    if (!point) {
      return;
    }

    const previous = path[path.length - 1];
    if (previous && previous.lat === point.lat && previous.lng === point.lng) {
      return;
    }

    path.push(point);
  });

  return path;
}

export default function KingsHuntExperience({ location, entryMethod, qrCodeId = null }: KingsHuntExperienceProps) {
  const { state, context, requestGPS, startHunt, retry } = useKingsHunt({
    location,
    entryMethod,
    qrCodeId,
  });

  const directionsHref = buildDirectionsHref(location, context.position);
  const machinePosition = getMachinePosition(location);
  const venueCenterPosition = getVenueCenterPosition(location);
  const hoursLabel = formatLocationHours(location.hours);
  const distanceLabel = context.route ? formatDistance(context.route.distanceM) : formatDistance(context.distanceToMachineM);
  const etaLabel = context.route ? formatDuration(context.route.durationSec) : context.etaMin != null ? `${context.etaMin} min` : "ETA unavailable";
  const walkingDirectionsHref =
    machinePosition != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${machinePosition.lat},${machinePosition.lng}`)}&travelmode=walking`
      : directionsHref;
  const isLiveRouteState = state === "NAVIGATING" || state === "ARRIVED";
  const isActiveNavigationState = state === "NAVIGATING" || state === "ARRIVED";
  const venueDetailLine =
    location.landmarks.length >= 2
      ? `Between ${location.landmarks[0]} & ${location.landmarks[1]}`
      : location.landmarks[0] ?? "Use the live route to reach the Ten Kings machine.";
  const staticRoutePath = useMemo(() => {
    const checkpointPath = [...context.checkpoints]
      .sort((left, right) => left.order - right.order)
      .map((checkpoint) => ({ lat: checkpoint.lat, lng: checkpoint.lng }));

    return buildStaticRoutePath([venueCenterPosition, ...checkpointPath, machinePosition]);
  }, [context.checkpoints, machinePosition, venueCenterPosition]);
  const mapCenter = isLiveRouteState
    ? context.position ?? machinePosition ?? venueCenterPosition
    : venueCenterPosition ?? machinePosition ?? context.position;
  const mapStatusLabel =
    state === "NAVIGATING"
      ? "Live Route Active"
      : state === "ARRIVED"
        ? "Arrival Confirmed"
        : state === "LOCATION_SERVICES_OFF"
          ? "Location Services Off"
          : state === "STATIC_MAP"
            ? "Static Route Preview"
            : "Venue Route Preview";

  return (
    <div className={`min-h-screen bg-[#0a0a0a] text-white ${isActiveNavigationState ? "lg:px-4 lg:py-8" : "px-4 py-8"}`}>
      <div className={`mx-auto flex w-full flex-col ${isActiveNavigationState ? "max-w-none gap-0 lg:max-w-6xl lg:gap-6" : "max-w-6xl gap-6"}`}>
        <div className={`items-center justify-between gap-4 ${isActiveNavigationState ? "hidden lg:flex" : "flex"}`}>
          <Link href="/kingshunt" className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843]">
            Back to venue list
          </Link>
          <span className="font-kingshunt-body rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[0.68rem] uppercase tracking-[0.24em] text-white/78">
            {getLocationTypeLabel(location.locationType)}
          </span>
        </div>

        <section
          className={`overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(212,168,67,0.18),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015)),#0e0e0e] px-6 py-7 shadow-[0_28px_90px_rgba(0,0,0,0.5)] md:px-8 ${isActiveNavigationState ? "hidden lg:block" : ""}`}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.34em] text-[#d4a843]">Kings Hunt Live Route</p>
              <h1 className="font-kingshunt-display mt-4 text-4xl leading-none tracking-[0.04em] text-white md:text-6xl">{location.name}</h1>
              <p className="font-kingshunt-body mt-4 max-w-2xl text-sm leading-6 text-[#b7b7b7]">
                {location.description || "Live GPS wayfinding to the Ten Kings machine with real walking directions and a destination marker."}
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843]">Current State</p>
              <p className="font-kingshunt-display mt-2 text-[1.65rem] leading-none tracking-[0.04em] text-white">{state.replaceAll("_", " ")}</p>
            </div>
          </div>

          <div className={`mt-5 gap-3 md:grid-cols-2 ${isActiveNavigationState ? "hidden md:grid" : "grid"}`}>
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="font-kingshunt-body text-[0.62rem] uppercase tracking-[0.26em] text-white/55">Distance</p>
              <p className="font-kingshunt-display mt-2 text-[1.55rem] leading-none tracking-[0.04em] text-white">{distanceLabel}</p>
            </div>
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="font-kingshunt-body text-[0.62rem] uppercase tracking-[0.26em] text-white/55">ETA</p>
              <p className="font-kingshunt-display mt-2 text-[1.55rem] leading-none tracking-[0.04em] text-white">{etaLabel}</p>
            </div>
          </div>
        </section>

        {mapCenter && machinePosition ? (
          <section className={`grid ${isActiveNavigationState ? "gap-0 lg:gap-6 lg:grid-cols-[1.45fr_0.85fr]" : "gap-6 lg:grid-cols-[1.4fr_0.9fr]"}`}>
            <div className={`space-y-4 ${isActiveNavigationState ? "space-y-0 lg:space-y-4" : ""}`}>
              {state === "STATIC_MAP" ? (
                <div className="flex flex-col gap-3 rounded-[1.4rem] border border-[#d4a843]/25 bg-[#d4a843]/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-kingshunt-body text-[0.62rem] uppercase tracking-[0.28em] text-[#d4a843]">Location Optional</p>
                    <p className="font-kingshunt-body mt-2 text-sm leading-6 text-[#efe1b3]">
                      Enable location for live tracking. The static venue map and route preview below still work right now.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startHunt}
                    className="font-kingshunt-body rounded-full bg-[#d4a843] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[#171208]"
                  >
                    Start Hunt
                  </button>
                </div>
              ) : null}

              {state === "LOCATION_SERVICES_OFF" ? (
                <div className="rounded-[1.6rem] border border-[#d4a843]/30 bg-[linear-gradient(180deg,rgba(212,168,67,0.14),rgba(12,12,12,0.9))] p-5">
                  <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.3em] text-[#d4a843]">Turn On Location Services</p>
                  <h2 className="font-kingshunt-display mt-3 text-[2rem] leading-none tracking-[0.04em] text-white">Enable device location first</h2>
                  <p className="font-kingshunt-body mt-4 text-sm leading-6 text-[#efe1b3]">
                    Open <strong>Settings &gt; Privacy &amp; Security &gt; Location Services</strong>, turn it on, then come back here and try again.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void retry()}
                      className="font-kingshunt-body rounded-full bg-[#d4a843] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[#171208]"
                    >
                      I Turned It On - Try Again
                    </button>
                    <Link
                      href={walkingDirectionsHref}
                      target="_blank"
                      rel="noreferrer"
                      className="font-kingshunt-body rounded-full border border-white/10 px-4 py-3 text-[0.68rem] uppercase tracking-[0.26em] text-white/85"
                    >
                      Open in Google Maps
                    </Link>
                  </div>
                </div>
              ) : null}

              <div className={`relative ${isActiveNavigationState ? "kingshunt-mobile-nav-shell lg:min-h-0" : ""}`}>
                <MapErrorBoundary
                  fallback={
                    <MapFallback
                      className={isActiveNavigationState ? "kingshunt-map-fullscreen-height lg:min-h-[37.5rem]" : "min-h-[28.125rem] lg:min-h-[37.5rem]"}
                      eyebrow="Map failed to load"
                      title="Live route map unavailable"
                      body="Use Google Maps and the venue details panel while the live map reconnects."
                      actions={
                        <Link
                          href={directionsHref}
                          target="_blank"
                          rel="noreferrer"
                          className="font-kingshunt-body rounded-full bg-[#d4a843] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[#171208]"
                        >
                          Open Google Maps
                        </Link>
                      }
                    />
                  }
                >
                  <TenKingsMap
                    center={mapCenter}
                    userPosition={isLiveRouteState ? context.position : null}
                    userAccuracyM={isLiveRouteState ? context.accuracyM : null}
                    liveUserPositionRef={isLiveRouteState ? context.livePositionRef : null}
                    liveUserAccuracyRef={isLiveRouteState ? context.liveAccuracyRef : null}
                    destination={machinePosition}
                    routePolyline={isLiveRouteState ? context.route?.polyline ?? null : null}
                    routePath={isLiveRouteState ? null : staticRoutePath}
                    checkpoints={[]}
                    checkpointsHit={[]}
                    statusLabel={isActiveNavigationState ? undefined : mapStatusLabel}
                    className={isActiveNavigationState ? "kingshunt-map-navigating" : undefined}
                    followUser={isLiveRouteState}
                    heightClassName={isActiveNavigationState ? "kingshunt-map-fullscreen-height lg:min-h-[37.5rem]" : undefined}
                  />
                </MapErrorBoundary>

                {isActiveNavigationState ? (
                  <div className="pointer-events-none absolute inset-x-4 bottom-4 z-[2] flex justify-center">
                    <div className="rounded-full border border-[#d4a843] bg-[rgba(10,10,10,0.85)] px-5 py-2 text-center shadow-[0_18px_48px_rgba(0,0,0,0.34)] backdrop-blur">
                      <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.24em] text-white/85">
                        {distanceLabel} · {etaLabel} · {location.name}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

              {isActiveNavigationState ? (
                <div className="border-t border-white/10 bg-[#0a0a0a] px-4 py-4 lg:hidden">
                  <p className="font-kingshunt-display text-[1.35rem] leading-none tracking-[0.04em] text-white">{location.name}</p>
                  <p className="font-kingshunt-body mt-2 text-sm leading-6 text-[#c8c8c8]">{venueDetailLine}</p>
                  {state === "ARRIVED" ? (
                    <p className="font-kingshunt-body mt-2 text-[0.72rem] uppercase tracking-[0.24em] text-[#d4a843]">You&rsquo;ve arrived at the machine.</p>
                  ) : null}
                </div>
              ) : null}

              {isLiveRouteState && context.route?.warnings?.length ? (
                <div className="rounded-[1.4rem] border border-[#d4a843]/20 bg-[#d4a843]/10 px-4 py-3">
                  <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843]">Route Warning</p>
                  <p className="font-kingshunt-body mt-2 text-sm leading-6 text-[#f0e0af]">{context.route.warnings.join(" • ")}</p>
                </div>
              ) : null}

              {isLiveRouteState && !context.route && context.routeError ? (
                <div className="rounded-[1.4rem] border border-[#d4a843]/20 bg-[#d4a843]/10 px-4 py-3">
                  <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843]">Route Unavailable</p>
                  <p className="font-kingshunt-body mt-2 text-sm leading-6 text-[#f0e0af]">
                    Live walking directions are unavailable right now. The map is still showing your live position and the machine destination, but no route line is being drawn until the next successful route fetch.
                  </p>
                </div>
              ) : null}
            </div>

            <div className={`space-y-4 ${isActiveNavigationState ? "hidden lg:block" : ""}`}>
              {state === "LOADING" || state === "LOCATING" ? (
                <StateCard
                  eyebrow="Acquiring GPS"
                  title="Finding your live position"
                  body="We request high-accuracy GPS immediately so live tracking can start, but the venue route preview is already loaded on the map."
                />
              ) : null}

              {state === "STATIC_MAP" ? (
                <div className="rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5">
                  <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.3em] text-[#d4a843]">Find the Machine</p>
                  <h2 className="font-kingshunt-display mt-3 text-[2rem] leading-none tracking-[0.04em] text-white">{venueDetailLine}</h2>
                  <p className="font-kingshunt-body mt-4 text-sm leading-6 text-[#c8c8c8]">
                    Walk the static gold route through the venue to the Ten Kings machine. Approximate walk time: ~{location.walkingTimeMin ?? 3} min.
                  </p>
                  {context.error ? <p className="font-kingshunt-body mt-3 text-sm leading-6 text-[#f0ddb0]">{context.error}</p> : null}
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={startHunt}
                      className="font-kingshunt-body rounded-full bg-[#d4a843] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[#171208]"
                    >
                      Start Hunt
                    </button>
                    <Link
                      href={walkingDirectionsHref}
                      target="_blank"
                      rel="noreferrer"
                      className="font-kingshunt-body rounded-full border border-white/10 px-4 py-3 text-[0.68rem] uppercase tracking-[0.26em] text-white/85"
                    >
                      Open in Google Maps
                    </Link>
                  </div>
                </div>
              ) : null}

              {state === "NOT_AT_VENUE" ? (
                <StateCard
                  eyebrow="Outside Geofence"
                  title="You’re not close enough to this venue yet"
                  body={`We can still point you there now. Current venue-center distance: ${formatDistance(context.distanceToVenueM)}.`}
                  actions={
                    <>
                      <Link
                        href={directionsHref}
                        target="_blank"
                        rel="noreferrer"
                        className="font-kingshunt-body rounded-full bg-[#d4a843] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[#171208]"
                      >
                        Get Directions
                      </Link>
                      <button
                        type="button"
                        onClick={() => void retry()}
                        className="font-kingshunt-body rounded-full border border-white/10 px-4 py-3 text-[0.68rem] uppercase tracking-[0.26em] text-white/85"
                      >
                        Retry GPS
                      </button>
                    </>
                  }
                />
              ) : null}

              {state === "NAVIGATING" ? (
                <StateCard
                  eyebrow="Live Tracking"
                  title="Follow the gold route"
                  body="Keep moving toward the gold crown marker. The route and ETA refresh as your position updates, without any extra hunt or reward steps."
                />
              ) : null}

              {state === "ARRIVED" ? (
                <div className="overflow-hidden rounded-[1.7rem] border border-[#d4a843]/30 bg-[radial-gradient(circle_at_top,rgba(212,168,67,0.24),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02)),#101010] p-5">
                  <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.32em] text-[#d4a843]">Arrival Confirmed</p>
                  <h2 className="font-kingshunt-display mt-3 text-[2.35rem] leading-none tracking-[0.04em] text-white">
                    You found the machine.
                  </h2>
                  <p className="font-kingshunt-body mt-4 text-sm leading-6 text-[#ddd1a8]">
                    The live route is complete. You are at the Ten Kings machine.
                  </p>

                  <div className="mt-5 rounded-[1.2rem] border border-white/10 bg-white/[0.03] px-4 py-3">
                    <p className="font-kingshunt-body text-[0.62rem] uppercase tracking-[0.26em] text-white/55">Final Route</p>
                    <p className="font-kingshunt-display mt-2 text-[1.5rem] leading-none tracking-[0.04em] text-white">{distanceLabel} · {etaLabel}</p>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      href={directionsHref}
                      target="_blank"
                      rel="noreferrer"
                      className="font-kingshunt-body rounded-full border border-white/10 px-4 py-3 text-[0.68rem] uppercase tracking-[0.26em] text-white/85"
                    >
                      Share / Maps
                    </Link>
                  </div>
                </div>
              ) : null}

              <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-5">
                <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843]">Venue Details</p>
                <h3 className="font-kingshunt-display mt-3 text-[1.85rem] leading-none tracking-[0.04em] text-white">{location.name}</h3>
                <p className="font-kingshunt-body mt-4 text-sm leading-6 text-[#c8c8c8]">{location.address}</p>
                {hoursLabel ? <p className="font-kingshunt-body mt-3 text-xs uppercase tracking-[0.22em] text-white/55">{hoursLabel}</p> : null}
                {location.landmarks.length ? (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {location.landmarks.map((landmark) => (
                      <span
                        key={landmark}
                        className="font-kingshunt-body rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[0.62rem] uppercase tracking-[0.24em] text-white/72"
                      >
                        {landmark}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              {location.machinePhotoUrl ? (
                <div className="overflow-hidden rounded-[1.6rem] border border-white/10 bg-white/[0.03]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={location.machinePhotoUrl} alt={`Ten Kings machine at ${location.name}`} className="h-64 w-full object-cover" />
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Checkpoint toast intentionally disabled while Kings Hunt stays in pure navigation mode. */}
      </div>
    </div>
  );
}
