'use client';

import type { ReactNode } from "react";
import Link from "next/link";
import TenKingsMap from "../maps/TenKingsMap";
import { useKingsHunt } from "../../hooks/useKingsHunt";
import {
  buildDirectionsHref,
  formatDistance,
  formatDuration,
  formatLocationHours,
  getLocationTypeLabel,
  getMachinePosition,
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

export default function KingsHuntExperience({ location, entryMethod, qrCodeId = null }: KingsHuntExperienceProps) {
  const { state, context, requestGPS, startHunt, retry, dismissCheckpoint } = useKingsHunt({
    location,
    entryMethod,
    qrCodeId,
  });

  const directionsHref = buildDirectionsHref(location, context.position);
  const machinePosition = getMachinePosition(location);
  const hoursLabel = formatLocationHours(location.hours);
  const distanceLabel = context.route ? formatDistance(context.route.distanceM) : formatDistance(context.distanceToMachineM);
  const etaLabel = context.route ? formatDuration(context.route.durationSec) : context.etaMin != null ? `${context.etaMin} min` : "ETA unavailable";

  return (
    <div className="min-h-screen bg-[#0a0a0a] px-4 py-8 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <Link href="/kingshunt" className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843]">
            Back to venue list
          </Link>
          <span className="font-kingshunt-body rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[0.68rem] uppercase tracking-[0.24em] text-white/78">
            {getLocationTypeLabel(location.locationType)}
          </span>
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(212,168,67,0.18),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015)),#0e0e0e] px-6 py-7 shadow-[0_28px_90px_rgba(0,0,0,0.5)] md:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.34em] text-[#d4a843]">Kings Hunt Live Route</p>
              <h1 className="font-kingshunt-display mt-4 text-4xl leading-none tracking-[0.04em] text-white md:text-6xl">{location.name}</h1>
              <p className="font-kingshunt-body mt-4 max-w-2xl text-sm leading-6 text-[#b7b7b7]">
                {location.description || "Walk the live gold route, hit checkpoints for TKD, and finish at the Ten Kings machine."}
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843]">Current State</p>
              <p className="font-kingshunt-display mt-2 text-[1.65rem] leading-none tracking-[0.04em] text-white">{state.replaceAll("_", " ")}</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="font-kingshunt-body text-[0.62rem] uppercase tracking-[0.26em] text-white/55">Distance</p>
              <p className="font-kingshunt-display mt-2 text-[1.55rem] leading-none tracking-[0.04em] text-white">{distanceLabel}</p>
            </div>
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="font-kingshunt-body text-[0.62rem] uppercase tracking-[0.26em] text-white/55">ETA</p>
              <p className="font-kingshunt-display mt-2 text-[1.55rem] leading-none tracking-[0.04em] text-white">{etaLabel}</p>
            </div>
            <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="font-kingshunt-body text-[0.62rem] uppercase tracking-[0.26em] text-white/55">TKD Earned</p>
              <p className="font-kingshunt-display mt-2 text-[1.55rem] leading-none tracking-[0.04em] text-white">+{context.tkdEarned}</p>
            </div>
          </div>
        </section>

        {state === "LOADING" || state === "LOCATING" ? (
          <StateCard
            eyebrow="Acquiring GPS"
            title="Finding your live position"
            body="We’re requesting high-accuracy GPS so we can check the venue geofence and compute a real walkable route with Google Routes."
          />
        ) : null}

        {state === "PERMISSION_DENIED" ? (
          <StateCard
            eyebrow="Location Off"
            title="Enable GPS to start the hunt"
            body="Kings Hunt needs live location to place your blue dot, verify you’re at the venue, and draw the real walking route to the machine."
            actions={
              <>
                <button
                  type="button"
                  onClick={() => void requestGPS()}
                  className="font-kingshunt-body rounded-full bg-[#d4a843] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[#171208]"
                >
                  Try Again
                </button>
                <Link
                  href={directionsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="font-kingshunt-body rounded-full border border-white/10 px-4 py-3 text-[0.68rem] uppercase tracking-[0.26em] text-white/85"
                >
                  Open Google Maps
                </Link>
              </>
            }
          />
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

        {(state === "AT_VENUE" || state === "NAVIGATING" || state === "ARRIVED") && machinePosition ? (
          <section className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
            <div className="space-y-4">
              <TenKingsMap
                center={context.position ?? machinePosition}
                userPosition={context.position}
                userAccuracyM={context.accuracyM}
                destination={machinePosition}
                routePolyline={context.route?.polyline ?? null}
                checkpoints={context.checkpoints}
                checkpointsHit={context.checkpointsHit}
                statusLabel={state === "NAVIGATING" ? "Live Route Active" : state === "ARRIVED" ? "Arrival Confirmed" : "Venue Geofence Matched"}
              />

              {context.route?.warnings?.length ? (
                <div className="rounded-[1.4rem] border border-[#d4a843]/20 bg-[#d4a843]/10 px-4 py-3">
                  <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.28em] text-[#d4a843]">Route Warning</p>
                  <p className="font-kingshunt-body mt-2 text-sm leading-6 text-[#f0e0af]">{context.route.warnings.join(" • ")}</p>
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              {state === "AT_VENUE" ? (
                <StateCard
                  eyebrow="Venue Confirmed"
                  title="You’re in range"
                  body="Your GPS matches this venue. Start the live hunt to follow the real walking route, watch your distance drop, and trigger checkpoints."
                  actions={
                    <>
                      <button
                        type="button"
                        onClick={startHunt}
                        className="font-kingshunt-body rounded-full bg-[#d4a843] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[#171208]"
                      >
                        Start Hunt
                      </button>
                      <Link
                        href={directionsHref}
                        target="_blank"
                        rel="noreferrer"
                        className="font-kingshunt-body rounded-full border border-white/10 px-4 py-3 text-[0.68rem] uppercase tracking-[0.26em] text-white/85"
                      >
                        Open Google Maps
                      </Link>
                    </>
                  }
                />
              ) : null}

              {state === "NAVIGATING" ? (
                <StateCard
                  eyebrow="Live Tracking"
                  title="Follow the gold route"
                  body="Keep moving toward the pulsing marker. We’re updating the route, ETA, and checkpoint progress as your blue dot moves."
                />
              ) : null}

              {state === "ARRIVED" ? (
                <div className="overflow-hidden rounded-[1.7rem] border border-[#d4a843]/30 bg-[radial-gradient(circle_at_top,rgba(212,168,67,0.24),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02)),#101010] p-5">
                  <p className="font-kingshunt-body text-[0.68rem] uppercase tracking-[0.32em] text-[#d4a843]">Arrival Confirmed</p>
                  <h2 className="font-kingshunt-display mt-3 text-[2.35rem] leading-none tracking-[0.04em] text-white">
                    You found the machine.
                  </h2>
                  <p className="font-kingshunt-body mt-4 text-sm leading-6 text-[#ddd1a8]">
                    Celebration complete. Claim your reward at the machine and keep the streak going.
                  </p>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.2rem] border border-white/10 bg-white/[0.03] px-4 py-3">
                      <p className="font-kingshunt-body text-[0.62rem] uppercase tracking-[0.26em] text-white/55">Checkpoint Hits</p>
                      <p className="font-kingshunt-display mt-2 text-[1.5rem] leading-none tracking-[0.04em] text-white">
                        {context.checkpointsHit.length}/{context.checkpoints.length}
                      </p>
                    </div>
                    <div className="rounded-[1.2rem] border border-white/10 bg-white/[0.03] px-4 py-3">
                      <p className="font-kingshunt-body text-[0.62rem] uppercase tracking-[0.26em] text-white/55">Total TKD</p>
                      <p className="font-kingshunt-display mt-2 text-[1.5rem] leading-none tracking-[0.04em] text-white">+{context.tkdEarned}</p>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Link
                      href="/packs"
                      className="font-kingshunt-body rounded-full bg-[#d4a843] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[#171208]"
                    >
                      Open a Mystery Pack
                    </Link>
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

        {state === "ERROR" ? (
          <StateCard
            eyebrow="Route Error"
            title="Something interrupted the hunt"
            body={context.error || context.routeError || "We hit an unexpected error while loading GPS or route data. Retry to continue."}
            actions={
              <button
                type="button"
                onClick={() => void retry()}
                className="font-kingshunt-body rounded-full bg-[#d4a843] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-[#171208]"
              >
                Retry Hunt
              </button>
            }
          />
        ) : null}

        {context.activeCheckpoint ? (
          <button
            type="button"
            onClick={dismissCheckpoint}
            className="fixed bottom-5 right-5 z-20 max-w-sm rounded-[1.3rem] border border-[#d4a843]/30 bg-[linear-gradient(180deg,rgba(212,168,67,0.18),rgba(12,12,12,0.96))] px-4 py-4 text-left shadow-[0_22px_48px_rgba(0,0,0,0.44)]"
          >
            <p className="font-kingshunt-body text-[0.62rem] uppercase tracking-[0.28em] text-[#d4a843]">Checkpoint Hit</p>
            <p className="font-kingshunt-display mt-2 text-[1.5rem] leading-none tracking-[0.04em] text-white">
              {context.activeCheckpoint.name}
            </p>
            <p className="font-kingshunt-body mt-2 text-sm text-[#f0ddb0]">+{context.activeCheckpoint.tkdReward} TKD added to your run.</p>
          </button>
        ) : null}
      </div>
    </div>
  );
}
