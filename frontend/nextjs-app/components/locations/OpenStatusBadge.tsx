import type { LocationLiveStatusResponse } from "../../lib/locationStatus";
import { isComingSoonLocation } from "../../lib/locationStatus";
import { parseOpenStatus, type OpenStatus } from "../../lib/locationUtils";

type BadgeStatus = OpenStatus | "coming_soon" | "event_today";

type OpenStatusBadgeProps = {
  hours: string | null;
  locationType: string | null;
  locationStatus?: string | null;
  liveStatus?: (LocationLiveStatusResponse & { hasEventToday?: boolean }) | null;
  className?: string;
};

export function OpenStatusBadge({
  hours,
  locationType,
  locationStatus = null,
  liveStatus = null,
  className,
}: OpenStatusBadgeProps) {
  let status: BadgeStatus;

  if (isComingSoonLocation(locationStatus)) {
    status = "coming_soon";
  } else if (liveStatus?.isEventBased) {
    status = liveStatus.hasEventToday ? "event_today" : "event_only";
  } else if (liveStatus?.openNow === true) {
    status = "open";
  } else if (liveStatus?.openNow === false) {
    status = "closed";
  } else {
    status = parseOpenStatus(hours, locationType);
  }

  const config: Record<BadgeStatus, { text: string | null; color: string; dot: string; pulse?: boolean }> = {
    open: { text: "Open Now", color: "#22c55e", dot: "#16a34a", pulse: true },
    closed: { text: "Closed", color: "#6b7280", dot: "#4b5563" },
    event_only: { text: "Event Days Only", color: "#d4a843", dot: "#b8922a" },
    event_today: { text: "Open Today", color: "#22c55e", dot: "#16a34a" },
    coming_soon: { text: "Coming Soon", color: "#888888", dot: "#888888" },
    unknown: { text: null, color: "", dot: "" },
  };

  const badge = config[status];
  if (!badge.text) {
    return null;
  }

  return (
    <span
      className={`font-kingshunt-body inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] ${className ?? ""}`.trim()}
      style={{ color: badge.color }}
    >
      <span
        className={badge.pulse ? "tk-open-status-dot" : ""}
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
