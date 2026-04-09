import { parseOpenStatus, type OpenStatus } from "../../lib/locationUtils";

type OpenStatusBadgeProps = {
  hours: string | null;
  locationType: string | null;
  className?: string;
};

export function OpenStatusBadge({ hours, locationType, className }: OpenStatusBadgeProps) {
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
      className={`font-kingshunt-body inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] ${className ?? ""}`.trim()}
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
