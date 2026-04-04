'use client';

import { useEffect, useRef, useState } from "react";
import MapFallback from "./MapFallback";
import { useGoogleMaps } from "../../hooks/useGoogleMaps";
import type { Checkpoint, LatLng } from "../../lib/kingsHunt";

export interface TenKingsMapProps {
  center: LatLng;
  userPosition?: LatLng | null;
  userAccuracyM?: number | null;
  liveUserPositionRef?: { current: LatLng | null } | null;
  liveUserAccuracyRef?: { current: number | null } | null;
  destination?: LatLng | null;
  routePolyline?: string | null;
  routePath?: LatLng[] | null;
  checkpoints?: Checkpoint[];
  checkpointsHit?: string[];
  statusLabel?: string;
  className?: string;
  interactive?: boolean;
  followUser?: boolean;
  heightClassName?: string;
}

function buildUserMarkerNode(): HTMLDivElement {
  const node = document.createElement("div");
  node.className = "tk-user-dot";
  return node;
}

function buildDestinationMarkerNode(): HTMLDivElement {
  const node = document.createElement("div");
  node.className = "tk-machine-marker";

  const halo = document.createElement("span");
  halo.className = "tk-machine-marker__halo";
  node.appendChild(halo);

  const icon = document.createElement("span");
  icon.className = "tk-machine-marker__icon";
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 16L3 6l5.5 4.8L12 4l3.5 6.8L21 6l-2 10H5z"></path><path d="M19 19H5v-2h14v2z"></path></svg>';
  node.appendChild(icon);

  return node;
}

function buildCheckpointNode(isHit: boolean): HTMLDivElement {
  const node = document.createElement("div");
  node.className = "tk-checkpoint-marker";
  node.dataset.hit = String(isHit);
  node.textContent = isHit ? "✓" : "C";
  return node;
}

const HUNT_MAP_HEIGHT_CLASS = "min-h-[28.125rem] lg:min-h-[37.5rem]";

export default function TenKingsMap({
  center,
  userPosition = null,
  userAccuracyM = null,
  liveUserPositionRef = null,
  liveUserAccuracyRef = null,
  destination = null,
  routePolyline = null,
  routePath = null,
  checkpoints = [],
  checkpointsHit = [],
  statusLabel,
  className,
  interactive = true,
  followUser = false,
  heightClassName,
}: TenKingsMapProps) {
  const { isLoaded, loadError, libraries } = useGoogleMaps();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const destinationMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const checkpointMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const routeBaseRef = useRef<google.maps.Polyline | null>(null);
  const routePatternRef = useRef<google.maps.Polyline | null>(null);
  const accuracyCircleRef = useRef<google.maps.Circle | null>(null);
  const hasFramedInitialViewRef = useRef(false);
  const lastAutoPanAtRef = useRef(0);
  const lastRenderedUserPositionKeyRef = useRef<string | null>(null);
  const lastRenderedAccuracyRef = useRef<number | null>(null);
  const centerRef = useRef(center);
  const interactiveRef = useRef(interactive);
  const userPositionPropRef = useRef<LatLng | null>(userPosition);
  const userAccuracyPropRef = useRef<number | null>(userAccuracyM);
  const [mapError, setMapError] = useState<Error | null>(null);
  const resolvedHeightClassName = heightClassName ?? HUNT_MAP_HEIGHT_CLASS;

  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  useEffect(() => {
    interactiveRef.current = interactive;
  }, [interactive]);

  useEffect(() => {
    userPositionPropRef.current = userPosition;
    userAccuracyPropRef.current = userAccuracyM;
  }, [userAccuracyM, userPosition]);

  useEffect(() => {
    if (!isLoaded || !libraries || !containerRef.current || mapRef.current || mapError) {
      return;
    }

    try {
      const { Map } = libraries.mapsLibrary;
      const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID;

      mapRef.current = new Map(containerRef.current, {
        center: centerRef.current,
        zoom: 17,
        mapId,
        colorScheme: "DARK" as google.maps.ColorScheme,
        backgroundColor: "#050505",
        renderingType: google.maps.RenderingType.VECTOR,
        disableDefaultUI: true,
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        clickableIcons: false,
        gestureHandling: interactiveRef.current ? "greedy" : "none",
      });
    } catch (error) {
      console.error("Kings Hunt map initialization failed", error);
      setMapError(error instanceof Error ? error : new Error("Unable to initialize the hunt map"));
    }
  }, [isLoaded, libraries, mapError]);

  useEffect(() => {
    return () => {
      if (destinationMarkerRef.current) {
        destinationMarkerRef.current.map = null;
      }

      if (userMarkerRef.current) {
        userMarkerRef.current.map = null;
      }

      checkpointMarkersRef.current.forEach((marker) => {
        marker.map = null;
      });
      routeBaseRef.current?.setMap(null);
      routePatternRef.current?.setMap(null);
      accuracyCircleRef.current?.setMap(null);
      destinationMarkerRef.current = null;
      userMarkerRef.current = null;
      checkpointMarkersRef.current = [];
      routeBaseRef.current = null;
      routePatternRef.current = null;
      accuracyCircleRef.current = null;
      mapRef.current = null;
      hasFramedInitialViewRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.setOptions({
      gestureHandling: interactive ? "greedy" : "none",
    });
  }, [interactive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libraries || mapError) {
      return;
    }

    try {
      const { AdvancedMarkerElement } = libraries.markerLibrary;

      if (!destination) {
        if (destinationMarkerRef.current) {
          destinationMarkerRef.current.map = null;
          destinationMarkerRef.current = null;
        }
        return;
      }

      if (!destinationMarkerRef.current) {
        destinationMarkerRef.current = new AdvancedMarkerElement({
          map,
          position: destination,
          title: "Ten Kings machine",
          content: buildDestinationMarkerNode(),
        });
        return;
      }

      destinationMarkerRef.current.position = destination;
      destinationMarkerRef.current.map = map;
    } catch (error) {
      console.error("Kings Hunt destination marker failed", error);
      setMapError(error instanceof Error ? error : new Error("Unable to render the destination marker"));
    }
  }, [destination, libraries, mapError]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libraries || mapError) {
      return;
    }

    const syncUserPosition = () => {
      try {
        const { AdvancedMarkerElement } = libraries.markerLibrary;
        const { Circle } = libraries.mapsLibrary;
        const nextUserPosition = liveUserPositionRef?.current ?? userPositionPropRef.current;
        const nextUserAccuracy = liveUserAccuracyRef?.current ?? userAccuracyPropRef.current;

        if (!nextUserPosition) {
          if (userMarkerRef.current) {
            userMarkerRef.current.map = null;
            userMarkerRef.current = null;
          }
          accuracyCircleRef.current?.setMap(null);
          accuracyCircleRef.current = null;
          lastRenderedUserPositionKeyRef.current = null;
          lastRenderedAccuracyRef.current = null;
          return;
        }

        const nextUserPositionKey = `${nextUserPosition.lat.toFixed(7)},${nextUserPosition.lng.toFixed(7)}`;
        const positionChanged = nextUserPositionKey !== lastRenderedUserPositionKeyRef.current;
        const accuracyChanged = nextUserAccuracy !== lastRenderedAccuracyRef.current;

        if (!userMarkerRef.current) {
          userMarkerRef.current = new AdvancedMarkerElement({
            map,
            position: nextUserPosition,
            title: "Your location",
            content: buildUserMarkerNode(),
          });
        } else if (positionChanged) {
          userMarkerRef.current.position = nextUserPosition;
          userMarkerRef.current.map = map;
        }

        if (nextUserAccuracy != null && Number.isFinite(nextUserAccuracy)) {
          if (!accuracyCircleRef.current) {
            accuracyCircleRef.current = new Circle({
              map,
              center: nextUserPosition,
              radius: nextUserAccuracy,
              fillColor: "#4aa7ff",
              fillOpacity: 0.12,
              strokeColor: "#4aa7ff",
              strokeOpacity: 0.26,
              strokeWeight: 1,
            });
          } else if (positionChanged || accuracyChanged) {
            accuracyCircleRef.current.setMap(map);
            accuracyCircleRef.current.setCenter(nextUserPosition);
            accuracyCircleRef.current.setRadius(nextUserAccuracy);
          }
        } else {
          accuracyCircleRef.current?.setMap(null);
          accuracyCircleRef.current = null;
        }

        if (followUser) {
          const now = Date.now();
          if (positionChanged && now - lastAutoPanAtRef.current >= 5000) {
            map.panTo(nextUserPosition);
            lastAutoPanAtRef.current = now;
          }
        }

        lastRenderedUserPositionKeyRef.current = nextUserPositionKey;
        lastRenderedAccuracyRef.current = nextUserAccuracy;
      } catch (error) {
        console.error("Kings Hunt user marker failed", error);
        setMapError(error instanceof Error ? error : new Error("Unable to update your live position"));
      }
    };

    syncUserPosition();

    if (!liveUserPositionRef && !liveUserAccuracyRef) {
      return;
    }

    const intervalId = window.setInterval(syncUserPosition, 250);
    return () => window.clearInterval(intervalId);
  }, [followUser, libraries, liveUserAccuracyRef, liveUserPositionRef, mapError]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libraries || mapError) {
      return;
    }

    try {
      const { AdvancedMarkerElement } = libraries.markerLibrary;

      checkpointMarkersRef.current.forEach((marker) => {
        marker.map = null;
      });
      checkpointMarkersRef.current = [];

      checkpoints.forEach((checkpoint) => {
        const marker = new AdvancedMarkerElement({
          map,
          position: { lat: checkpoint.lat, lng: checkpoint.lng },
          title: checkpoint.name,
          content: buildCheckpointNode(checkpointsHit.includes(checkpoint.id)),
        });
        checkpointMarkersRef.current.push(marker);
      });
    } catch (error) {
      console.error("Kings Hunt checkpoint markers failed", error);
      setMapError(error instanceof Error ? error : new Error("Unable to render checkpoint markers"));
    }
  }, [checkpoints, checkpointsHit, libraries, mapError]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libraries || mapError) {
      return;
    }

    const staticRoutePath = Array.isArray(routePath) && routePath.length > 1 ? routePath : null;
    if (!routePolyline && !staticRoutePath) {
      routeBaseRef.current?.setMap(null);
      routePatternRef.current?.setMap(null);
      return;
    }

    try {
      const { Polyline } = libraries.mapsLibrary;
      if (!routeBaseRef.current) {
        routeBaseRef.current = new Polyline({
          map,
          geodesic: true,
          zIndex: 3,
        });
      }

      if (routePolyline) {
        routeBaseRef.current.setOptions({
          map,
          strokeColor: "#d4a843",
          strokeOpacity: 0.95,
          strokeWeight: 5,
          zIndex: 3,
        });
        routeBaseRef.current.setPath(libraries.geometryLibrary.encoding.decodePath(routePolyline));
        routePatternRef.current?.setMap(null);
        return;
      }

      routeBaseRef.current.setOptions({
        map,
        strokeColor: "rgba(212,168,67,0.34)",
        strokeOpacity: 0.85,
        strokeWeight: 3,
        zIndex: 2,
      });
      routeBaseRef.current.setPath(staticRoutePath ?? []);

      if (!routePatternRef.current) {
        routePatternRef.current = new Polyline({
          map,
          strokeOpacity: 0,
          strokeWeight: 3,
          geodesic: true,
          zIndex: 3,
          icons: [
            {
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: "#d4a843",
                fillOpacity: 0.94,
                strokeOpacity: 0,
                scale: 3,
              },
              offset: "0",
              repeat: "18px",
            },
          ],
        });
      } else {
        routePatternRef.current.setMap(map);
      }

      routePatternRef.current.setPath(staticRoutePath ?? []);
    } catch (error) {
      console.error("Kings Hunt route overlay failed", error);
      setMapError(error instanceof Error ? error : new Error("Unable to render the route overlay"));
    }
  }, [libraries, mapError, routePath, routePolyline]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || hasFramedInitialViewRef.current) {
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    let pointCount = 0;

    const addPoint = (point: LatLng) => {
      bounds.extend(point);
      pointCount += 1;
    };

    if (destination) {
      addPoint(destination);
    }

    if (userPosition) {
      addPoint(userPosition);
    }

    checkpoints.forEach((checkpoint) => {
      addPoint({ lat: checkpoint.lat, lng: checkpoint.lng });
    });

    const staticRoutePath = Array.isArray(routePath) && routePath.length > 1 ? routePath : null;
    if (routePolyline && libraries) {
      libraries.geometryLibrary.encoding.decodePath(routePolyline).forEach((point) => {
        bounds.extend(point);
        pointCount += 1;
      });
    } else {
      staticRoutePath?.forEach((point) => addPoint(point));
    }

    if (pointCount === 0) {
      return;
    }

    if (pointCount === 1) {
      map.setCenter(destination ?? userPosition ?? center);
      map.setZoom(17);
    } else {
      map.fitBounds(bounds, 88);
    }

    hasFramedInitialViewRef.current = true;
  }, [center, checkpoints, destination, libraries, routePath, routePolyline, userPosition]);

  if (loadError || mapError) {
    return (
      <MapFallback
        className={`${resolvedHeightClassName} ${className ?? ""}`.trim()}
        eyebrow="Map failed to load"
        title="Live route map unavailable"
        body="The hunt can still continue. Use Google Maps directions and the venue details panel while the live map is unavailable."
      />
    );
  }

  if (!isLoaded) {
    return <div className={`tk-map-loading ${resolvedHeightClassName} ${className ?? ""}`.trim()}>Loading map</div>;
  }

  return (
    <div className={`tk-google-map ${className ?? ""}`.trim()}>
      {statusLabel ? <div className="absolute left-4 top-4 z-[1] tk-map-status-pill">{statusLabel}</div> : null}
      {userPosition || destination ? (
        <button
          type="button"
          onClick={() => {
            const map = mapRef.current;
            if (!map) {
              return;
            }

            const target = userPosition ?? destination ?? center;
            map.panTo(target);

            if ((map.getZoom() ?? 0) < 17) {
              map.setZoom(17);
            }
          }}
          className="font-kingshunt-body absolute right-4 top-4 z-[1] rounded-full border border-white/10 bg-[rgba(10,10,10,0.76)] px-4 py-2 text-[0.64rem] uppercase tracking-[0.24em] text-white/88 backdrop-blur"
        >
          Re-center
        </button>
      ) : null}
      <div ref={containerRef} className={`tk-google-map__canvas ${resolvedHeightClassName}`.trim()} />
    </div>
  );
}
