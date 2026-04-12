'use client';

import { useEffect, useRef } from "react";
import { useGoogleMaps } from "../../../hooks/useGoogleMaps";
import type { LiveStockerPosition } from "../../../types/stocker";
import MapFallback from "../../maps/MapFallback";

type StockerOpsLiveMapProps = {
  stockers: LiveStockerPosition[];
  selectedStockerId: string | null;
  onSelectStocker: (stockerId: string) => void;
};

function statusColor(status: LiveStockerPosition["status"]) {
  if (status === "at_location" || status === "restocking") return "#22c55e";
  if (status === "idle") return "#ef4444";
  return "#d4a843";
}

function markerNode(stocker: LiveStockerPosition, selected: boolean) {
  const node = document.createElement("div");
  node.className = `admin-stocker-marker${selected ? " admin-stocker-marker--selected" : ""}`;
  const initial = stocker.name.trim().charAt(0).toUpperCase() || "S";
  node.innerHTML = `<span style="background:${statusColor(stocker.status)}">${initial}</span><small>${stocker.name}</small>`;
  return node;
}

function animateMarker(
  marker: google.maps.marker.AdvancedMarkerElement,
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  durationMs = 1400,
) {
  const started = performance.now();
  const step = (now: number) => {
    const progress = Math.min(1, (now - started) / durationMs);
    const eased = 1 - Math.pow(1 - progress, 3);
    marker.position = {
      lat: from.lat + (to.lat - from.lat) * eased,
      lng: from.lng + (to.lng - from.lng) * eased,
    };
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export default function StockerOpsLiveMap({ stockers, selectedStockerId, onSelectStocker }: StockerOpsLiveMapProps) {
  const { isLoaded, loadError, libraries } = useGoogleMaps();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerLookupRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const polylineLookupRef = useRef<Map<string, google.maps.Polyline>>(new Map());
  const positionLookupRef = useRef<Map<string, google.maps.LatLngLiteral>>(new Map());
  const selectRef = useRef(onSelectStocker);

  useEffect(() => {
    selectRef.current = onSelectStocker;
  }, [onSelectStocker]);

  useEffect(() => {
    if (!isLoaded || !libraries || !containerRef.current || mapRef.current) return;
    const { Map } = libraries.mapsLibrary;
    mapRef.current = new Map(containerRef.current, {
      center: { lat: 38.5758, lng: -121.4789 },
      zoom: 9,
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
  }, [isLoaded, libraries]);

  useEffect(() => {
    const markers = markerLookupRef.current;
    const polylines = polylineLookupRef.current;
    return () => {
      markers.forEach((marker) => {
        marker.map = null;
      });
      polylines.forEach((polyline) => polyline.setMap(null));
      markers.clear();
      polylines.clear();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libraries) return;
    const { AdvancedMarkerElement } = libraries.markerLibrary;
    const seen = new Set<string>();
    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;

    for (const stocker of stockers) {
      seen.add(stocker.stockerId);
      const position = { lat: stocker.lat, lng: stocker.lng };
      const previousPosition = positionLookupRef.current.get(stocker.stockerId);
      const selected = selectedStockerId === stocker.stockerId;
      let marker = markerLookupRef.current.get(stocker.stockerId);
      if (!marker) {
        marker = new AdvancedMarkerElement({
          map,
          position,
          title: stocker.name,
          content: markerNode(stocker, selected),
        });
        marker.addListener("click", () => selectRef.current(stocker.stockerId));
        markerLookupRef.current.set(stocker.stockerId, marker);
      } else {
        marker.content = markerNode(stocker, selected);
        if (previousPosition) animateMarker(marker, previousPosition, position);
        else marker.position = position;
        marker.map = map;
      }
      positionLookupRef.current.set(stocker.stockerId, position);
      bounds.extend(position);
      hasBounds = true;

      const existingPolyline = polylineLookupRef.current.get(stocker.stockerId);
      existingPolyline?.setMap(null);
      if (stocker.shift?.routePolyline) {
        const path = libraries.geometryLibrary.encoding.decodePath(stocker.shift.routePolyline);
        const polyline = new google.maps.Polyline({
          map,
          path,
          geodesic: true,
          strokeColor: "#d4a843",
          strokeOpacity: 0.55,
          strokeWeight: 4,
        });
        polylineLookupRef.current.set(stocker.stockerId, polyline);
      }
    }

    markerLookupRef.current.forEach((marker, stockerId) => {
      if (!seen.has(stockerId)) {
        marker.map = null;
        markerLookupRef.current.delete(stockerId);
        positionLookupRef.current.delete(stockerId);
      }
    });
    polylineLookupRef.current.forEach((polyline, stockerId) => {
      if (!seen.has(stockerId)) {
        polyline.setMap(null);
        polylineLookupRef.current.delete(stockerId);
      }
    });
    if (hasBounds && stockers.length > 0) map.fitBounds(bounds, 80);
  }, [libraries, selectedStockerId, stockers]);

  if (loadError) return <MapFallback title="Map unavailable" body={loadError.message} className="h-full min-h-[100dvh] rounded-none" />;
  return <div ref={containerRef} className="h-full min-h-[100dvh] w-full bg-[#050505]" />;
}
