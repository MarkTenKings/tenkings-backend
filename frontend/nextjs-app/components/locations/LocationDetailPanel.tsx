import Link from "next/link";
import { useEffect, useState } from "react";
import { formatLocationHours, getLocationTypeLabel } from "../../lib/kingsHunt";
import { formatTimeAgo, parseOpenStatus, type OpenStatus } from "../../lib/locationUtils";

interface LocationLiveRip {
  id: string;
  slug: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  viewCount: number | null;
  createdAt: string;
}

export interface LocationPanelLocation {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  address: string;
  mapsUrl: string | null;
  machinePhotoUrl: string | null;
  hours: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  locationType: string | null;
  locationStatus: string | null;
  liveRips: LocationLiveRip[];
}

interface LocationDetailPanelProps {
  location: LocationPanelLocation | null;
  onClose: () => void;
}

function OpenStatusBadge({ hours, locationType }: { hours: string | null; locationType: string | null }) {
  const status = parseOpenStatus(hours, locationType);
  const config: Record<OpenStatus, { text: string | null; color: string; dot: string }> = {
    open: { text: "Open Now", color: "#22c55e", dot: "#16a34a" },
    closed: { text: "Closed", color: "#6b7280", dot: "#4b5563" },
    event_only: { text: "Event Days", color: "#d4a843", dot: "#b8922a" },
    unknown: { text: null, color: "", dot: "" },
  };

  const badge = config[status];
  if (!badge.text) {
    return null;
  }

  return (
    <span
      className="font-kingshunt-body inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em]"
      style={{ color: badge.color }}
    >
      <span
        className={status === "open" ? "tk-open-status-dot" : ""}
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "999px",
          background: badge.dot,
          display: "inline-block",
        }}
      />
      {badge.text}
    </span>
  );
}

function LiveRipCard({ rip }: { rip: LocationLiveRip }) {
  return (
    <a
      href={rip.videoUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block w-[140px] flex-shrink-0 overflow-hidden rounded-lg border border-[#1a1a1a] bg-[#111111] no-underline transition hover:border-[#d4a843]/60"
    >
      <div className="relative flex h-[100px] w-[140px] items-center justify-center overflow-hidden bg-[#1a1a1a]">
        {rip.thumbnailUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={rip.thumbnailUrl} alt={rip.title} className="h-full w-full object-cover" />
          </>
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d4a843] bg-[rgba(212,168,67,0.2)]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="#d4a843" aria-hidden="true">
              <path d="M4 2l10 6-10 6V2z" />
            </svg>
          </div>
        )}
      </div>
      <div className="space-y-2 p-2">
        <p
          className="font-kingshunt-body text-[11px] leading-[1.35] text-[#cccccc]"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {rip.title}
        </p>
        <p className="font-kingshunt-body text-[10px] uppercase tracking-[0.16em] text-[#6c6c6c]">{formatTimeAgo(rip.createdAt)}</p>
      </div>
    </a>
  );
}

function LocationHeroImage({ location }: { location: LocationPanelLocation }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(location.machinePhotoUrl ?? null);
  const [loading, setLoading] = useState(!location.machinePhotoUrl);

  useEffect(() => {
    let cancelled = false;

    setPhotoUrl(location.machinePhotoUrl ?? null);
    setLoading(!location.machinePhotoUrl);

    if (location.machinePhotoUrl) {
      return () => {
        cancelled = true;
      };
    }

    fetch(`/api/locations/${encodeURIComponent(location.slug)}/photo`)
      .then(async (response) => {
        if (!response.ok) {
          return { photoUrl: null as string | null };
        }
        return (await response.json()) as { photoUrl?: string | null };
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setPhotoUrl(typeof payload.photoUrl === "string" ? payload.photoUrl : null);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [location.machinePhotoUrl, location.slug]);

  if (loading) {
    return (
      <div className="flex h-[220px] w-full items-center justify-center bg-[linear-gradient(135deg,#111111_0%,#1a1a0a_100%)]">
        <div className="text-[32px] text-[#d4a843] opacity-50">♛</div>
      </div>
    );
  }

  if (!photoUrl) {
    return (
      <div className="flex h-[220px] w-full items-end bg-[linear-gradient(135deg,#0a0a0a_0%,#1a1500_50%,#0a0a0a_100%)] p-5">
        <div>
          {(location.city || location.state) && (
            <p className="font-kingshunt-body text-[11px] uppercase tracking-[0.15em] text-[#d4a843]">
              {[location.city, location.state].filter(Boolean).join(", ")}
            </p>
          )}
          <h2 className="font-kingshunt-display mt-2 text-[22px] leading-none text-white">{location.name}</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[220px] w-full overflow-hidden bg-[#111111]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoUrl}
        alt={location.name}
        className="h-full w-full object-cover"
        onError={() => setPhotoUrl(null)}
      />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,10,10,0.8)_0%,transparent_60%)]" />
    </div>
  );
}

export default function LocationDetailPanel({ location, onClose }: LocationDetailPanelProps) {
  if (!location) {
    return null;
  }

  const typeLabel = getLocationTypeLabel(location.locationType).toUpperCase();
  const hoursLabel = formatLocationHours(location.hours);
  const description =
    location.description?.trim() || "Ten Kings machines are stocked and ready for live ripping at this venue.";

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <aside className="tk-location-panel pointer-events-auto absolute inset-x-0 bottom-0 h-[70vh] overflow-y-auto rounded-t-[20px] bg-[#0a0a0a] shadow-[0_-12px_40px_rgba(0,0,0,0.55)] md:inset-y-0 md:left-0 md:right-auto md:h-auto md:w-[400px] md:rounded-none md:shadow-[4px_0_24px_rgba(0,0,0,0.6)]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close location details"
          className="absolute right-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-[#333333] bg-[rgba(10,10,10,0.8)] text-[18px] text-white transition hover:border-[#d4a843] hover:text-[#d4a843]"
        >
          ×
        </button>

        <div className="mx-auto mt-3 h-1.5 w-14 rounded-full bg-white/12 md:hidden" />
        <LocationHeroImage location={location} />

        <div className="space-y-5 px-5 pb-7 pt-5">
          <div>
            <p className="font-kingshunt-body mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#d4a843]">{typeLabel}</p>
            <h2 className="font-kingshunt-display text-[24px] font-bold leading-[1.15] text-white">{location.name}</h2>
          </div>

          <OpenStatusBadge hours={location.hours} locationType={location.locationType} />

          {location.address ? <p className="font-kingshunt-body text-[14px] leading-6 text-[#888888]">{location.address}</p> : null}
          {hoursLabel ? <p className="font-kingshunt-body text-[13px] leading-6 text-[#666666]">{hoursLabel}</p> : null}
          <p className="font-kingshunt-body text-[14px] leading-7 text-[#c7c7c7]">{description}</p>

          <div className="flex gap-2.5">
            <Link
              href={`/kingshunt/${location.slug}`}
              className="font-kingshunt-body inline-flex flex-1 items-center justify-center rounded-lg bg-[#d4a843] px-4 py-3 text-center text-[13px] font-bold uppercase tracking-[0.05em] text-[#0a0a0a] transition hover:bg-[#e3bb5d]"
            >
              Start Hunt
            </Link>
            {location.mapsUrl ? (
              <a
                href={location.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-kingshunt-body inline-flex flex-1 items-center justify-center rounded-lg border border-[#d4a843] bg-transparent px-4 py-3 text-center text-[13px] font-bold uppercase tracking-[0.05em] text-[#d4a843] transition hover:bg-[rgba(212,168,67,0.08)]"
              >
                Directions
              </a>
            ) : null}
          </div>

          {location.liveRips.length > 0 ? (
            <div>
              <p className="font-kingshunt-body mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#d4a843]">Live Rips</p>
              <div className="tk-hide-scrollbar flex gap-3 overflow-x-auto pb-2">
                {location.liveRips.map((rip) => (
                  <LiveRipCard key={rip.id} rip={rip} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
