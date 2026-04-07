import Link from "next/link";
import { formatLocationHours, getLocationTypeLabel } from "../../lib/kingsHunt";
import { formatDistance, formatTimeAgo, parseOpenStatus, type OpenStatus } from "../../lib/locationUtils";

interface LiveRipClip {
  id: string;
  slug: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  viewCount: number | null;
  createdAt: string;
}

interface RipEntry {
  title: string;
  videoUrl: string;
}

export interface LocationCardRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  address: string;
  mapsUrl: string | null;
  locationType: string | null;
  locationStatus: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  hours: string | null;
  recentRips: RipEntry[];
  liveRips: LiveRipClip[];
}

interface LocationCardProps {
  location: LocationCardRecord;
  distanceMeters: number | null;
  isNearby: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
}

function StatusBadge({ status }: { status: OpenStatus }) {
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

export default function LocationCard({
  location,
  distanceMeters,
  isNearby,
  isSelected,
  onSelect,
  onEdit,
}: LocationCardProps) {
  const status = parseOpenStatus(location.hours, location.locationType);
  const typeLabel = getLocationTypeLabel(location.locationType).toUpperCase();
  const distanceLabel = distanceMeters != null ? formatDistance(distanceMeters) : null;
  const liveRip = location.liveRips[0] ?? null;
  const hoursLabel = formatLocationHours(location.hours);

  return (
    <article
      id={`location-card-${location.slug}`}
      className="scroll-mt-28 border-b border-white/8"
      style={{
        background: isSelected ? "rgba(212,168,67,0.05)" : "transparent",
        borderLeft: isSelected ? "3px solid #d4a843" : "3px solid transparent",
        boxShadow: isNearby ? "0 0 16px rgba(212,168,67,0.15)" : "none",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        className="cursor-pointer px-5 py-5 transition-colors duration-200 hover:bg-white/[0.02] lg:px-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="font-kingshunt-body text-[11px] font-bold uppercase tracking-[0.24em] text-[#d4a843]">{typeLabel}</p>
            <h3 className="font-kingshunt-display text-[1.55rem] uppercase leading-none tracking-[0.08em] text-white">
              {location.name}
            </h3>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StatusBadge status={status} />
            {distanceLabel ? (
              <span
                className="font-kingshunt-body text-[12px] font-medium"
                style={{ color: isNearby ? "#d4a843" : "#666666" }}
              >
                {distanceLabel}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <p className="font-kingshunt-body text-sm leading-6 text-[#d8d8d8]">{location.address}</p>
          {(location.city || location.state || location.zip) && (
            <p className="font-kingshunt-body text-[12px] uppercase tracking-[0.18em] text-[#7d7d7d]">
              {[location.city, location.state, location.zip].filter(Boolean).join(" · ")}
            </p>
          )}
          {hoursLabel ? <p className="font-kingshunt-body text-[13px] leading-5 text-[#9a9a9a]">{hoursLabel}</p> : null}
          {location.description ? <p className="font-kingshunt-body text-[13px] leading-6 text-[#b6b6b6]">{location.description}</p> : null}
        </div>

        {liveRip ? (
          <div className="mt-4 border-t border-[rgba(212,168,67,0.15)] pt-4">
            <p className="font-kingshunt-body text-[11px] font-bold uppercase tracking-[0.18em] text-[#d4a843]">Recent Activity</p>
            <p className="font-kingshunt-body mt-2 text-[13px] leading-6 text-[#d0d0d0]">{liveRip.title}</p>
            <p className="font-kingshunt-body mt-1 text-[11px] text-[#666666]">{formatTimeAgo(liveRip.createdAt)}</p>
          </div>
        ) : null}

        {location.recentRips[0] ? (
          <div className="mt-4 border-t border-white/8 pt-4">
            <p className="font-kingshunt-body text-[11px] font-bold uppercase tracking-[0.18em] text-[#8d8d8d]">Featured Pull</p>
            <p className="font-kingshunt-body mt-2 text-[13px] leading-6 text-[#c3c3c3]">{location.recentRips[0].title}</p>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href={`/kingshunt/${location.slug}`}
            onClick={(event) => event.stopPropagation()}
            className="font-kingshunt-body inline-flex items-center justify-center rounded-md border px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] transition"
            style={
              isNearby
                ? {
                    background: "#d4a843",
                    borderColor: "#d4a843",
                    color: "#0a0a0a",
                  }
                : {
                    background: "rgba(212,168,67,0.08)",
                    borderColor: "rgba(212,168,67,0.32)",
                    color: "#d4a843",
                  }
            }
          >
            Start Hunt
          </Link>
          {location.mapsUrl ? (
            <Link
              href={location.mapsUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="font-kingshunt-body inline-flex items-center justify-center rounded-md border border-white/12 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white/78 transition hover:border-[#d4a843] hover:text-[#d4a843]"
            >
              Directions
            </Link>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
              className="font-kingshunt-body inline-flex items-center justify-center rounded-md border border-white/12 px-4 py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-white/78 transition hover:border-white/30 hover:text-white"
            >
              Edit
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
