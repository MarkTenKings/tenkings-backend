'use client';

import { useEffect, useRef, useState } from "react";
import MapFallback from "./MapFallback";
import { useGoogleMaps } from "../../hooks/useGoogleMaps";
import type { Checkpoint, LatLng } from "../../lib/kingsHunt";

export interface TenKingsMapProps {
  center: LatLng;
  userPosition?: LatLng | null;
  userAccuracyM?: number | null;
  destination?: LatLng | null;
  routePolyline?: string | null;
  routePath?: LatLng[] | null;
  checkpoints?: Checkpoint[];
  checkpointsHit?: string[];
  statusLabel?: string;
  className?: string;
  interactive?: boolean;
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
  destination = null,
  routePolyline = null,
  routePath = null,
  checkpoints = [],
  checkpointsHit = [],
  statusLabel,
  className,
  interactive = true,
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
  const [mapError, setMapError] = useState<Error | null>(null);

  useEffect(() => {
    if (!isLoaded || !libraries || !containerRef.current || mapRef.current || mapError) {
      return;
    }

    try {
      const { Map } = libraries.mapsLibrary;

      mapRef.current = new Map(containerRef.current, {
        center,
        zoom: 17,
        mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID,
        renderingType: google.maps.RenderingType.VECTOR,
        disableDefaultUI: true,
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        clickableIcons: false,
        gestureHandling: interactive ? "greedy" : "none",
      });
    } catch (error) {
      console.error("Kings Hunt map initialization failed", error);
      setMapError(error instanceof Error ? error : new Error("Unable to initialize the hunt map"));
    }

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
  }, [center, interactive, isLoaded, libraries, mapError]);

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

    try {
      const { AdvancedMarkerElement } = libraries.markerLibrary;
      const { Circle } = libraries.mapsLibrary;

      if (!userPosition) {
        if (userMarkerRef.current) {
          userMarkerRef.current.map = null;
          userMarkerRef.current = null;
        }
        accuracyCircleRef.current?.setMap(null);
        accuracyCircleRef.current = null;
        return;
      }

      if (!userMarkerRef.current) {
        userMarkerRef.current = new AdvancedMarkerElement({
          map,
          position: userPosition,
          title: "Your location",
          content: buildUserMarkerNode(),
        });
      } else {
        userMarkerRef.current.position = userPosition;
        userMarkerRef.current.map = map;
      }

      if (userAccuracyM != null && Number.isFinite(userAccuracyM)) {
        if (!accuracyCircleRef.current) {
          accuracyCircleRef.current = new Circle({
            map,
            center: userPosition,
            radius: userAccuracyM,
            fillColor: "#4aa7ff",
            fillOpacity: 0.12,
            strokeColor: "#4aa7ff",
            strokeOpacity: 0.26,
            strokeWeight: 1,
          });
        } else {
          accuracyCircleRef.current.setMap(map);
          accuracyCircleRef.current.setCenter(userPosition);
          accuracyCircleRef.current.setRadius(userAccuracyM);
        }
      } else {
        accuracyCircleRef.current?.setMap(null);
        accuracyCircleRef.current = null;
      }
    } catch (error) {
      console.error("Kings Hunt user marker failed", error);
      setMapError(error instanceof Error ? error : new Error("Unable to update your live position"));
    }
  }, [libraries, mapError, userAccuracyM, userPosition]);

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

    routeBaseRef.current?.setMap(null);
    routePatternRef.current?.setMap(null);
    routeBaseRef.current = null;
    routePatternRef.current = null;

    const staticRoutePath = Array.isArray(routePath) && routePath.length > 1 ? routePath : null;
    if (!routePolyline && !staticRoutePath) {
      return;
    }

    try {
      const { Polyline } = libraries.mapsLibrary;
      const isApproximate = !routePolyline;
      const path = routePolyline ? libraries.geometryLibrary.encoding.decodePath(routePolyline) : staticRoutePath ?? [];

      routeBaseRef.current = new Polyline({
        map,
        path,
        strokeColor: isApproximate ? "rgba(212,168,67,0.18)" : "rgba(212,168,67,0.28)",
        strokeOpacity: 1,
        strokeWeight: isApproximate ? 2 : 4,
        geodesic: true,
      });

      routePatternRef.current = new Polyline({
        map,
        path,
        strokeOpacity: 0,
        strokeWeight: 0,
        geodesic: true,
        icons: isApproximate
          ? [
              {
                icon: {
                  path: google.maps.SymbolPath.CIRCLE,
                  fillColor: "#d4a843",
                  fillOpacity: 0.92,
                  strokeOpacity: 0,
                  scale: 2.6,
                },
                offset: "0",
                repeat: "16px",
              },
            ]
          : [
              {
                icon: {
                  path: "M 0,-1 0,1",
                  strokeOpacity: 1,
                  strokeColor: "#d4a843",
                  scale: 4,
                },
                offset: "0",
                repeat: "18px",
              },
            ],
      });
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
        className={`${HUNT_MAP_HEIGHT_CLASS} ${className ?? ""}`.trim()}
        eyebrow="Map failed to load"
        title="Live route map unavailable"
        body="The hunt can still continue. Use Google Maps directions and the venue details panel while the live map is unavailable."
      />
    );
  }

  if (!isLoaded) {
    return <div className={`tk-map-loading ${HUNT_MAP_HEIGHT_CLASS} ${className ?? ""}`.trim()}>Loading map</div>;
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
      <div ref={containerRef} className={`tk-google-map__canvas ${HUNT_MAP_HEIGHT_CLASS}`.trim()} />
    </div>
  );
}
