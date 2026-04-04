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
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const routeAccentRef = useRef<google.maps.Polyline | null>(null);
  const accuracyCircleRef = useRef<google.maps.Circle | null>(null);
  const routeAnimationRef = useRef<number | null>(null);
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
      return;
    }

    return () => {
      markersRef.current.forEach((marker) => {
        marker.map = null;
      });
      markersRef.current = [];
      routeRef.current?.setMap(null);
      routeAccentRef.current?.setMap(null);
      accuracyCircleRef.current?.setMap(null);
      if (routeAnimationRef.current != null) {
        window.clearInterval(routeAnimationRef.current);
      }
      mapRef.current = null;
    };
  }, [center, interactive, isLoaded, libraries, mapError]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libraries || mapError) {
      return;
    }

    try {
      const { AdvancedMarkerElement } = libraries.markerLibrary;
      const { Circle, Polyline } = libraries.mapsLibrary;

      markersRef.current.forEach((marker) => {
        marker.map = null;
      });
      markersRef.current = [];
      routeRef.current?.setMap(null);
      routeAccentRef.current?.setMap(null);
      accuracyCircleRef.current?.setMap(null);

      if (routeAnimationRef.current != null) {
        window.clearInterval(routeAnimationRef.current);
        routeAnimationRef.current = null;
      }

      const bounds = new google.maps.LatLngBounds();

      if (destination) {
        markersRef.current.push(
          new AdvancedMarkerElement({
            map,
            position: destination,
            title: "Ten Kings machine",
            content: buildDestinationMarkerNode(),
          }),
        );
        bounds.extend(destination);
      }

      if (userPosition) {
        markersRef.current.push(
          new AdvancedMarkerElement({
            map,
            position: userPosition,
            title: "Your location",
            content: buildUserMarkerNode(),
          }),
        );
        bounds.extend(userPosition);

        if (userAccuracyM != null && Number.isFinite(userAccuracyM)) {
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
        }
      }

      checkpoints.forEach((checkpoint) => {
        const isHit = checkpointsHit.includes(checkpoint.id);
        markersRef.current.push(
          new AdvancedMarkerElement({
            map,
            position: { lat: checkpoint.lat, lng: checkpoint.lng },
            title: checkpoint.name,
            content: buildCheckpointNode(isHit),
          }),
        );
        bounds.extend({ lat: checkpoint.lat, lng: checkpoint.lng });
      });

      const staticRoutePath = Array.isArray(routePath) && routePath.length > 1 ? routePath : null;

      if (routePolyline || staticRoutePath) {
        const path = routePolyline ? libraries.geometryLibrary.encoding.decodePath(routePolyline) : staticRoutePath ?? [];
        routeRef.current = new Polyline({
          map,
          path,
          strokeColor: routePolyline ? "rgba(212,168,67,0.38)" : "rgba(212,168,67,0.22)",
          strokeOpacity: 1,
          strokeWeight: routePolyline ? 8 : 6,
          geodesic: true,
        });
        routeAccentRef.current = new Polyline({
          map,
          path,
          strokeColor: "#d4a843",
          strokeOpacity: routePolyline ? 0.96 : 0,
          strokeWeight: routePolyline ? 4 : 3,
          geodesic: true,
          icons: routePolyline
            ? [
                {
                  icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    fillColor: "#fff0b4",
                    fillOpacity: 1,
                    strokeOpacity: 0,
                    scale: 3,
                  },
                  offset: "0%",
                  repeat: "96px",
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
                  repeat: "16px",
                },
              ],
        });

        path.forEach((point) => bounds.extend(point));

        if (routePolyline) {
          let offset = 0;
          routeAnimationRef.current = window.setInterval(() => {
            offset = (offset + 2) % 100;
            if (routeAccentRef.current) {
              routeAccentRef.current.set("icons", [
                {
                  icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    fillColor: "#fff0b4",
                    fillOpacity: 1,
                    strokeOpacity: 0,
                    scale: 3,
                  },
                  offset: `${offset}%`,
                  repeat: "96px",
                },
              ]);
            }
          }, 120);
        }
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, 88);
      } else {
        map.setCenter(center);
        map.setZoom(17);
      }
    } catch (error) {
      console.error("Kings Hunt map overlays failed to render", error);
      setMapError(error instanceof Error ? error : new Error("Unable to render the hunt map"));
    }
  }, [center, checkpoints, checkpointsHit, destination, libraries, mapError, routePath, routePolyline, userAccuracyM, userPosition]);

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
      <div ref={containerRef} className={`tk-google-map__canvas ${HUNT_MAP_HEIGHT_CLASS}`.trim()} />
    </div>
  );
}
