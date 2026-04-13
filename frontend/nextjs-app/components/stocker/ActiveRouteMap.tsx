'use client';

import { useEffect, useMemo, useRef } from "react";
import { useGoogleMaps } from "../../hooks/useGoogleMaps";
import type { LocationSummary, StockerStopData } from "../../types/stocker";
import MapFallback from "../maps/MapFallback";

type LatLng = { lat: number; lng: number };

type ActiveRouteMapProps = {
  stops: Array<StockerStopData & { location: LocationSummary }>;
  encodedPolyline: string | null;
  userPosition: LatLng | null;
  userHeading?: number | null;
  mapHeading?: number | null;
  nextStopId: string | null;
};

function markerNode(kind: "completed" | "next" | "future") {
  const node = document.createElement("div");
  node.className = `stocker-stop-marker stocker-stop-marker--${kind}`;
  node.textContent = kind === "completed" ? "✓" : kind === "next" ? "◆" : "";
  return node;
}

function userNode() {
  const node = document.createElement("div");
  node.className = "tk-user-direction-marker";
  node.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L20 20 L12 14 L4 20 Z" fill="#3b82f6" stroke="#fff" stroke-width="2"/></svg>';
  return node;
}

function setMarkerHeading(marker: google.maps.marker.AdvancedMarkerElement | null, heading: number | null | undefined) {
  const content = marker?.content;
  if (content instanceof HTMLElement && typeof heading === "number" && Number.isFinite(heading)) {
    content.style.transform = `rotate(${heading}deg)`;
  }
}

export default function ActiveRouteMap({ stops, encodedPolyline, userPosition, userHeading = null, mapHeading = null, nextStopId }: ActiveRouteMapProps) {
  const { isLoaded, loadError, libraries } = useGoogleMaps();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const framedRef = useRef(false);
  const framedUserRef = useRef(false);
  const lastUserPanAtRef = useRef(0);

  const stopPositions = useMemo(
    () =>
      stops
        .filter((stop) => typeof stop.location.latitude === "number" && typeof stop.location.longitude === "number")
        .map((stop) => ({
          stop,
          position: { lat: stop.location.latitude as number, lng: stop.location.longitude as number },
        })),
    [stops],
  );

  useEffect(() => {
    if (!isLoaded || !libraries || !containerRef.current || mapRef.current) return;
    const { Map } = libraries.mapsLibrary;
    mapRef.current = new Map(containerRef.current, {
      center: userPosition ?? stopPositions[0]?.position ?? { lat: 38.5758, lng: -121.4789 },
      zoom: 11,
      mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID,
      colorScheme: "DARK" as google.maps.ColorScheme,
      backgroundColor: "#050505",
      renderingType: google.maps.RenderingType.VECTOR,
      disableDefaultUI: true,
      zoomControl: true,
      streetViewControl: false,
      fullscreenControl: false,
      mapTypeControl: false,
      clickableIcons: false,
      gestureHandling: "greedy",
    });
    mapRef.current.setTilt(45);
  }, [isLoaded, libraries, stopPositions, userPosition]);

  useEffect(() => {
    return () => {
      markersRef.current.forEach((marker) => {
        marker.map = null;
      });
      userMarkerRef.current && (userMarkerRef.current.map = null);
      routeRef.current?.setMap(null);
      mapRef.current = null;
      markersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libraries) return;
    markersRef.current.forEach((marker) => {
      marker.map = null;
    });
    markersRef.current = [];
    const { AdvancedMarkerElement } = libraries.markerLibrary;
    for (const { stop, position } of stopPositions) {
      const kind = stop.status === "completed" ? "completed" : stop.id === nextStopId ? "next" : "future";
      markersRef.current.push(
        new AdvancedMarkerElement({
          map,
          position,
          title: stop.location.name,
          content: markerNode(kind),
          zIndex: kind === "next" ? 30 : kind === "completed" ? 20 : 10,
        }),
      );
    }
  }, [libraries, nextStopId, stopPositions]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libraries) return;
    const { AdvancedMarkerElement } = libraries.markerLibrary;
    if (!userPosition) {
      if (userMarkerRef.current) userMarkerRef.current.map = null;
      userMarkerRef.current = null;
      return;
    }
    if (!userMarkerRef.current) {
      userMarkerRef.current = new AdvancedMarkerElement({ map, position: userPosition, title: "Your location", content: userNode(), zIndex: 100 });
    } else {
      userMarkerRef.current.position = userPosition;
      userMarkerRef.current.map = map;
    }
    setMarkerHeading(userMarkerRef.current, userHeading);

    const now = Date.now();
    if (framedUserRef.current && now - lastUserPanAtRef.current > 5000) {
      map.panTo(userPosition);
      lastUserPanAtRef.current = now;
    }
  }, [libraries, userHeading, userPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof mapHeading !== "number" || !Number.isFinite(mapHeading)) return;
    map.setHeading(mapHeading);
    map.setTilt(45);
  }, [mapHeading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libraries) return;
    routeRef.current?.setMap(null);
    routeRef.current = null;
    if (!encodedPolyline) return;
    const path = libraries.geometryLibrary.encoding.decodePath(encodedPolyline);
    routeRef.current = new google.maps.Polyline({
      map,
      path,
      geodesic: true,
      strokeColor: "#d4a843",
      strokeOpacity: 0.9,
      strokeWeight: 5,
    });
  }, [encodedPolyline, libraries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || framedRef.current) return;
    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;
    if (userPosition) {
      bounds.extend(userPosition);
      hasBounds = true;
    }
    for (const { position } of stopPositions) {
      bounds.extend(position);
      hasBounds = true;
    }
    if (hasBounds) {
      map.fitBounds(bounds, 64);
      framedRef.current = true;
    }
  }, [stopPositions, userPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userPosition || framedUserRef.current) return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(userPosition);
    for (const { position } of stopPositions) {
      bounds.extend(position);
    }
    map.fitBounds(bounds, 72);
    framedUserRef.current = true;
    lastUserPanAtRef.current = Date.now();
  }, [stopPositions, userPosition]);

  if (loadError) return <MapFallback title="Map unavailable" body={loadError.message} className="h-full min-h-[100dvh] rounded-none" />;
  return <div ref={containerRef} className="h-full min-h-[100dvh] w-full bg-[#050505]" />;
}
