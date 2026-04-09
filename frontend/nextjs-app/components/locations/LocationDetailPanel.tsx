import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatLocationHours, getLocationTypeLabel } from "../../lib/kingsHunt";
import {
  type LocationEventsResponse,
  type LocationEventSummary,
  type LocationLiveStatusResponse,
  type LocationStatusValue,
  isComingSoonLocation,
  isEventOnlyLocationType,
} from "../../lib/locationStatus";
import { formatTimeAgo } from "../../lib/locationUtils";
import { OpenStatusBadge } from "./OpenStatusBadge";

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
  isAdmin?: boolean;
  onClose: () => void;
  onLocationStatusChange?: (slug: string, status: LocationStatusValue) => Promise<void> | void;
}

function getLocalTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatEventCalendarDate(date: string | null, format: "month" | "day") {
  if (!date) {
    return "";
  }

  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  if (format === "month") {
    return parsed.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  }

  return String(parsed.getDate());
}

function formatEventTime(time: string | null) {
  if (!time) {
    return null;
  }

  const parsed = new Date(`2000-01-01T${time}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
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

    fetch(`/api/location-photo/${encodeURIComponent(location.slug)}`)
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

function UpcomingEventsList({ events }: { events: LocationEventSummary[] }) {
  if (events.length === 0) {
    return null;
  }

  return (
    <div style={{ padding: "0 20px 20px" }}>
      <p
        style={{
          color: "#d4a843",
          fontSize: "11px",
          letterSpacing: "0.12em",
          fontFamily: "Satoshi, sans-serif",
          fontWeight: 700,
          marginBottom: "12px",
          textTransform: "uppercase",
        }}
      >
        Upcoming Events
      </p>
      {events.map((event) => (
        <a
          key={event.id}
          href={event.url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 0",
            borderBottom: "1px solid #1a1a1a",
            textDecoration: "none",
          }}
        >
          <div
            style={{
              flexShrink: 0,
              width: "44px",
              textAlign: "center",
              background: "#111",
              borderRadius: "6px",
              padding: "6px 4px",
            }}
          >
            <p
              style={{
                color: "#d4a843",
                fontSize: "10px",
                fontFamily: "Satoshi, sans-serif",
                fontWeight: 700,
                margin: 0,
              }}
            >
              {formatEventCalendarDate(event.date, "month")}
            </p>
            <p
              style={{
                color: "#fff",
                fontSize: "18px",
                fontFamily: "Clash Display, sans-serif",
                fontWeight: 700,
                margin: 0,
              }}
            >
              {formatEventCalendarDate(event.date, "day")}
            </p>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                color: "#fff",
                fontSize: "14px",
                fontFamily: "Satoshi, sans-serif",
                fontWeight: 700,
                margin: "0 0 2px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {event.name}
            </p>
            {formatEventTime(event.time) ? (
              <p
                style={{
                  color: "#666",
                  fontSize: "12px",
                  fontFamily: "Satoshi, sans-serif",
                  margin: 0,
                }}
              >
                {formatEventTime(event.time)}
              </p>
            ) : null}
          </div>

          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 4l4 4-4 4" stroke="#444" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </a>
      ))}
    </div>
  );
}

export default function LocationDetailPanel({
  location,
  isAdmin = false,
  onClose,
  onLocationStatusChange,
}: LocationDetailPanelProps) {
  const [liveStatus, setLiveStatus] = useState<LocationLiveStatusResponse | null>(null);
  const [events, setEvents] = useState<LocationEventSummary[]>([]);
  const [updatingStatus, setUpdatingStatus] = useState<LocationStatusValue | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (!location?.slug) {
      return;
    }

    const controller = new AbortController();
    setLiveStatus(null);

    fetch(`/api/locations/${encodeURIComponent(location.slug)}/live-status`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load live status");
        }
        return (await response.json()) as LocationLiveStatusResponse;
      })
      .then((payload) => {
        setLiveStatus(payload);
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name === "AbortError") {
          return;
        }
        setLiveStatus(null);
      });

    return () => controller.abort();
  }, [location?.slug]);

  useEffect(() => {
    if (!location?.slug) {
      return;
    }

    if (!isEventOnlyLocationType(location.locationType)) {
      setEvents([]);
      return;
    }

    const controller = new AbortController();
    setEvents([]);

    fetch(`/api/locations/${encodeURIComponent(location.slug)}/events`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Failed to load upcoming events");
        }
        return (await response.json()) as LocationEventsResponse;
      })
      .then((payload) => {
        setEvents(Array.isArray(payload.events) ? payload.events : []);
      })
      .catch((error: unknown) => {
        if ((error as Error)?.name === "AbortError") {
          return;
        }
        setEvents([]);
      });

    return () => controller.abort();
  }, [location?.locationType, location?.slug]);

  useEffect(() => {
    setStatusError(null);
    setUpdatingStatus(null);
  }, [location?.slug]);

  const hasEventToday = useMemo(() => {
    const today = getLocalTodayString();
    return events.some((event) => event.date === today);
  }, [events]);

  if (!location) {
    return null;
  }

  const typeLabel = getLocationTypeLabel(location.locationType).toUpperCase();
  const hoursLabel = formatLocationHours(location.hours);
  const description =
    location.description?.trim() || "Ten Kings machines are stocked and ready for live ripping at this venue.";
  const isComingSoon = isComingSoonLocation(location.locationStatus);
  const showLiveHours = !isComingSoon && Array.isArray(liveStatus?.hours) && liveStatus.hours.length > 0;
  const showFallbackHours =
    !isComingSoon && !showLiveHours && !isEventOnlyLocationType(location.locationType) && Boolean(hoursLabel);
  const decoratedLiveStatus = liveStatus
    ? {
        ...liveStatus,
        hasEventToday,
      }
    : null;
  const editHref = `/admin/assigned-locations/${location.id}`;

  const handleLocationStatusUpdate = async (status: LocationStatusValue) => {
    if (!onLocationStatusChange || updatingStatus || status === location.locationStatus) {
      return;
    }

    setUpdatingStatus(status);
    setStatusError(null);

    try {
      await onLocationStatusChange(location.slug, status);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "Failed to update location status");
    } finally {
      setUpdatingStatus(null);
    }
  };

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

          <OpenStatusBadge
            hours={location.hours}
            locationType={location.locationType}
            locationStatus={location.locationStatus}
            liveStatus={decoratedLiveStatus}
          />

          {location.address ? <p className="font-kingshunt-body text-[14px] leading-6 text-[#888888]">{location.address}</p> : null}
          {showFallbackHours ? (
            <p className="font-kingshunt-body text-[13px] leading-6 text-[#666666]">{hoursLabel}</p>
          ) : null}

          {showLiveHours ? (
            <details style={{ marginBottom: "16px" }}>
              <summary
                style={{
                  color: "#666",
                  fontSize: "13px",
                  fontFamily: "Satoshi, sans-serif",
                  cursor: "pointer",
                  listStyle: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>Hours</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 4l4 4 4-4" stroke="#444" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                </svg>
              </summary>
              <div style={{ marginTop: "8px", paddingLeft: "4px" }}>
                {liveStatus?.hours?.map((day) => (
                  <p
                    key={day}
                    style={{
                      color: "#888",
                      fontSize: "12px",
                      fontFamily: "Satoshi, sans-serif",
                      margin: "4px 0",
                      lineHeight: 1.4,
                    }}
                  >
                    {day}
                  </p>
                ))}
              </div>
            </details>
          ) : null}

          <p className="font-kingshunt-body text-[14px] leading-7 text-[#c7c7c7]">{description}</p>

          <div className="flex gap-2.5">
            {isComingSoon ? (
              <button
                type="button"
                disabled
                className="font-kingshunt-body inline-flex flex-1 items-center justify-center rounded-lg border border-[#222222] bg-[#222222] px-4 py-3 text-center text-[13px] font-bold uppercase tracking-[0.05em] text-[#555555]"
              >
                Notify Me
              </button>
            ) : (
              <Link
                href={`/kingshunt/${location.slug}`}
                className="font-kingshunt-body inline-flex flex-1 items-center justify-center rounded-lg bg-[#d4a843] px-4 py-3 text-center text-[13px] font-bold uppercase tracking-[0.05em] text-[#0a0a0a] transition hover:bg-[#e3bb5d]"
              >
                Start Hunt
              </Link>
            )}

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
        </div>

        {isEventOnlyLocationType(location.locationType) ? <UpcomingEventsList events={events} /> : null}

        {location.liveRips.length > 0 ? (
          <div className="px-5 pb-7">
            <p className="font-kingshunt-body mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#d4a843]">Live Rips</p>
            <div className="tk-hide-scrollbar flex gap-3 overflow-x-auto pb-2">
              {location.liveRips.map((rip) => (
                <LiveRipCard key={rip.id} rip={rip} />
              ))}
            </div>
          </div>
        ) : null}

        {isAdmin ? (
          <div style={{ padding: "20px", paddingTop: 0, borderTop: "1px solid #1a1a1a", marginTop: "16px" }}>
            <a
              href={editHref}
              style={{
                display: "block",
                width: "100%",
                padding: "12px",
                textAlign: "center",
                borderRadius: "8px",
                border: "1px solid #333",
                color: "#888",
                fontFamily: "Satoshi, sans-serif",
                fontWeight: 700,
                fontSize: "12px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                textDecoration: "none",
                background: "transparent",
              }}
            >
              Edit Location
            </a>

            <div style={{ paddingTop: "12px" }}>
              <p
                style={{
                  color: "#666",
                  fontSize: "11px",
                  letterSpacing: "0.1em",
                  fontFamily: "Satoshi, sans-serif",
                  marginBottom: "8px",
                }}
              >
                LOCATION STATUS
              </p>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  disabled={!onLocationStatusChange || updatingStatus !== null}
                  onClick={() => void handleLocationStatusUpdate("active")}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "6px",
                    background: location.locationStatus === "active" ? "#d4a843" : "#111",
                    color: location.locationStatus === "active" ? "#0a0a0a" : "#666",
                    fontFamily: "Satoshi, sans-serif",
                    fontWeight: 700,
                    fontSize: "12px",
                    letterSpacing: "0.05em",
                    cursor: !onLocationStatusChange || updatingStatus !== null ? "not-allowed" : "pointer",
                    border: location.locationStatus === "active" ? "none" : "1px solid #222",
                    opacity: !onLocationStatusChange || updatingStatus !== null ? 0.7 : 1,
                  }}
                >
                  LIVE
                </button>

                <button
                  type="button"
                  disabled={!onLocationStatusChange || updatingStatus !== null}
                  onClick={() => void handleLocationStatusUpdate("coming_soon")}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "6px",
                    background: location.locationStatus === "coming_soon" ? "#555" : "#111",
                    color: location.locationStatus === "coming_soon" ? "#fff" : "#666",
                    fontFamily: "Satoshi, sans-serif",
                    fontWeight: 700,
                    fontSize: "12px",
                    letterSpacing: "0.05em",
                    cursor: !onLocationStatusChange || updatingStatus !== null ? "not-allowed" : "pointer",
                    border: location.locationStatus === "coming_soon" ? "none" : "1px solid #222",
                    opacity: !onLocationStatusChange || updatingStatus !== null ? 0.7 : 1,
                  }}
                >
                  COMING SOON
                </button>
              </div>

              {statusError ? (
                <p className="font-kingshunt-body mt-3 text-[12px] text-rose-300">{statusError}</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
