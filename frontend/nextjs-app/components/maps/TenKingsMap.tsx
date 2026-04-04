'use client';

import { useEffect, useRef } from "react";
import { useGoogleMaps } from "../../hooks/useGoogleMaps";
import type { Checkpoint, LatLng } from "../../lib/kingsHunt";

export interface TenKingsMapProps {
  center: LatLng;
  userPosition?: LatLng | null;
  userAccuracyM?: number | null;
  destination?: LatLng | null;
  routePolyline?: string | null;
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

  const icon = document.createElement("span");
  icon.className = "tk-machine-marker__icon";
  icon.textContent = "TK";
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

export default function TenKingsMap({
  center,
  userPosition = null,
  userAccuracyM = null,
  destination = null,
  routePolyline = null,
  checkpoints = [],
  checkpointsHit = [],
  statusLabel,
  className,
  interactive = true,
}: TenKingsMapProps) {
  const { isLoaded, loadError } = useGoogleMaps();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const routeAccentRef = useRef<google.maps.Polyline | null>(null);
  const accuracyCircleRef = useRef<google.maps.Circle | null>(null);
  const routeAnimationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isLoaded || !containerRef.current || mapRef.current) {
      return;
    }

    mapRef.current = new google.maps.Map(containerRef.current, {
      center,
      zoom: 17,
      mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID,
      disableDefaultUI: true,
      zoomControl: true,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false,
      clickableIcons: false,
      gestureHandling: interactive ? "greedy" : "none",
    });

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
  }, [center, interactive, isLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

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
        new google.maps.marker.AdvancedMarkerElement({
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
        new google.maps.marker.AdvancedMarkerElement({
          map,
          position: userPosition,
          title: "Your location",
          content: buildUserMarkerNode(),
        }),
      );
      bounds.extend(userPosition);

      if (userAccuracyM != null && Number.isFinite(userAccuracyM)) {
        accuracyCircleRef.current = new google.maps.Circle({
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
        new google.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: checkpoint.lat, lng: checkpoint.lng },
          title: checkpoint.name,
          content: buildCheckpointNode(isHit),
        }),
      );
      bounds.extend({ lat: checkpoint.lat, lng: checkpoint.lng });
    });

    if (routePolyline) {
      const path = google.maps.geometry.encoding.decodePath(routePolyline);
      routeRef.current = new google.maps.Polyline({
        map,
        path,
        strokeColor: "rgba(212,168,67,0.38)",
        strokeOpacity: 1,
        strokeWeight: 8,
        geodesic: true,
      });
      routeAccentRef.current = new google.maps.Polyline({
        map,
        path,
        strokeColor: "#d4a843",
        strokeOpacity: 0.96,
        strokeWeight: 4,
        geodesic: true,
        icons: [
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
        ],
      });

      path.forEach((point) => bounds.extend(point));

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

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 88);
    } else {
      map.setCenter(center);
      map.setZoom(17);
    }
  }, [center, checkpoints, checkpointsHit, destination, routePolyline, userAccuracyM, userPosition]);

  if (loadError) {
    return <div className={`tk-map-loading ${className ?? ""}`.trim()}>Map failed to load</div>;
  }

  if (!isLoaded) {
    return <div className={`tk-map-loading ${className ?? ""}`.trim()}>Loading map</div>;
  }

  return (
    <div className={`tk-google-map ${className ?? ""}`.trim()}>
      {statusLabel ? <div className="absolute left-4 top-4 z-[1] tk-map-status-pill">{statusLabel}</div> : null}
      <div ref={containerRef} className="tk-google-map__canvas min-h-[22rem]" />
    </div>
  );
}
