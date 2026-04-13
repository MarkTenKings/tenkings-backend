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

  const dot = document.createElement("span");
  dot.style.background = statusColor(stocker.status);
  dot.textContent = initial;
  node.appendChild(dot);

  const name = document.createElement("small");
  name.textContent = stocker.name;
  node.appendChild(name);

  if (stocker.nextStopEta && stocker.nextStopName) {
    const label = document.createElement("em");
    label.style.cssText =
      "background: rgba(10,10,10,0.85); color: #d4a843; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-family: Satoshi, sans-serif; font-weight: 700; white-space: nowrap; text-align: center; margin-top: 4px; font-style: normal;";
    label.textContent = `${stocker.nextStopEta} → ${stocker.nextStopName}`;
    node.appendChild(label);
  }

  return node;
}

function stopMarkerNode(index: number, completed: boolean) {
  const node = document.createElement("div");
  node.style.cssText = [
    "display:inline-flex",
    "height:22px",
    "width:22px",
    "align-items:center",
    "justify-content:center",
    "border-radius:999px",
    "border:2px solid rgba(255,255,255,0.9)",
    `background:${completed ? "rgba(212,168,67,0.96)" : "rgba(10,10,10,0.82)"}`,
    `color:${completed ? "#080808" : "#d4a843"}`,
    "font-size:11px",
    "font-weight:800",
    "box-shadow:0 8px 24px rgba(0,0,0,0.32)",
  ].join(";");
  node.textContent = String(index + 1);
  return node;
}

function animateMarker(
  marker: google.maps.marker.AdvancedMarkerElement,
  from: google.maps.LatLngLiteral,
  to: google.maps.LatLngLiteral,
  durationMs = 2000,
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
  const completedPolylineLookupRef = useRef<Map<string, google.maps.Polyline>>(new Map());
  const remainingPolylineLookupRef = useRef<Map<string, google.maps.Polyline>>(new Map());
  const stopMarkerLookupRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement[]>>(new Map());
  const positionLookupRef = useRef<Map<string, google.maps.LatLngLiteral>>(new Map());
  const hasInitialFitRef = useRef(false);
  const knownStockerIdsRef = useRef<Set<string>>(new Set());
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
    const completedPolylines = completedPolylineLookupRef.current;
    const remainingPolylines = remainingPolylineLookupRef.current;
    const stopMarkers = stopMarkerLookupRef.current;
    return () => {
      markers.forEach((marker) => {
        marker.map = null;
      });
      completedPolylines.forEach((polyline) => polyline.setMap(null));
      remainingPolylines.forEach((polyline) => polyline.setMap(null));
      stopMarkers.forEach((markerList) => markerList.forEach((marker) => {
        marker.map = null;
      }));
      markers.clear();
      completedPolylines.clear();
      remainingPolylines.clear();
      stopMarkers.clear();
      mapRef.current = null;
    };
  }, []);

  const fitToStockers = () => {
    const map = mapRef.current;
    if (!map || stockers.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    stockers.forEach((stocker) => bounds.extend({ lat: stocker.lat, lng: stocker.lng }));
    map.fitBounds(bounds, 80);
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !libraries) return;
    const { AdvancedMarkerElement } = libraries.markerLibrary;
    const seen = new Set<string>();
    const stockerIds = new Set(stockers.map((stocker) => stocker.stockerId));
    const hasNewStocker = stockers.some((stocker) => !knownStockerIdsRef.current.has(stocker.stockerId));

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

      completedPolylineLookupRef.current.get(stocker.stockerId)?.setMap(null);
      remainingPolylineLookupRef.current.get(stocker.stockerId)?.setMap(null);
      stopMarkerLookupRef.current.get(stocker.stockerId)?.forEach((stopMarker) => {
        stopMarker.map = null;
      });
      stopMarkerLookupRef.current.delete(stocker.stockerId);

      const stops = stocker.shift?.stops ?? [];
      const completedCount = stocker.completedStopCount;
      const stopPositions = stops
        .map((stop, index) => {
          const lat = stop.location.venueCenterLat ?? stop.location.latitude;
          const lng = stop.location.venueCenterLng ?? stop.location.longitude;
          return typeof lat === "number" && typeof lng === "number" ? { stop, index, position: { lat, lng } } : null;
        })
        .filter((entry): entry is { stop: (typeof stops)[number]; index: number; position: google.maps.LatLngLiteral } => Boolean(entry));

      const stopMarkers = stopPositions.map(
        (entry) =>
          new AdvancedMarkerElement({
            map,
            position: entry.position,
            title: entry.stop.location.name,
            content: stopMarkerNode(entry.index, entry.index < completedCount),
            zIndex: 5,
          }),
      );
      stopMarkerLookupRef.current.set(stocker.stockerId, stopMarkers);

      const completedPath = stopPositions.slice(0, Math.max(0, completedCount)).map((entry) => entry.position);
      if (completedPath.length > 1) {
        completedPolylineLookupRef.current.set(
          stocker.stockerId,
          new google.maps.Polyline({
            map,
            path: completedPath,
            geodesic: true,
            strokeColor: "#d4a843",
            strokeOpacity: 0.92,
            strokeWeight: 5,
            zIndex: 3,
          }),
        );
      }

      const remainingPath = [{ lat: stocker.lat, lng: stocker.lng }, ...stopPositions.slice(Math.max(0, completedCount)).map((entry) => entry.position)];
      if (remainingPath.length > 1) {
        remainingPolylineLookupRef.current.set(
          stocker.stockerId,
          new google.maps.Polyline({
            map,
            path: remainingPath,
            geodesic: true,
            strokeColor: "#d4a843",
            strokeOpacity: 0,
            strokeWeight: 4,
            zIndex: 2,
            icons: [
              {
                icon: {
                  path: "M 0,-1 0,1",
                  strokeColor: "#d4a843",
                  strokeOpacity: 0.9,
                  strokeWeight: 3,
                  scale: 4,
                },
                offset: "0",
                repeat: "20px",
              },
            ],
          }),
        );
      } else if (stocker.routePolyline && completedCount < stopPositions.length) {
        const path = libraries.geometryLibrary.encoding.decodePath(stocker.routePolyline);
        remainingPolylineLookupRef.current.set(
          stocker.stockerId,
          new google.maps.Polyline({
            map,
            path,
            geodesic: true,
            strokeColor: "#d4a843",
            strokeOpacity: 0.35,
            strokeWeight: 4,
            zIndex: 1,
          }),
        );
      }
    }

    markerLookupRef.current.forEach((marker, stockerId) => {
      if (!seen.has(stockerId)) {
        marker.map = null;
        markerLookupRef.current.delete(stockerId);
        positionLookupRef.current.delete(stockerId);
      }
    });
    completedPolylineLookupRef.current.forEach((polyline, stockerId) => {
      if (!seen.has(stockerId)) {
        polyline.setMap(null);
        completedPolylineLookupRef.current.delete(stockerId);
      }
    });
    remainingPolylineLookupRef.current.forEach((polyline, stockerId) => {
      if (!seen.has(stockerId)) {
        polyline.setMap(null);
        remainingPolylineLookupRef.current.delete(stockerId);
      }
    });
    stopMarkerLookupRef.current.forEach((markerList, stockerId) => {
      if (!seen.has(stockerId)) {
        markerList.forEach((marker) => {
          marker.map = null;
        });
        stopMarkerLookupRef.current.delete(stockerId);
      }
    });

    if ((!hasInitialFitRef.current || hasNewStocker) && stockers.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      stockers.forEach((stocker) => bounds.extend({ lat: stocker.lat, lng: stocker.lng }));
      map.fitBounds(bounds, 80);
      hasInitialFitRef.current = true;
    }
    knownStockerIdsRef.current = stockerIds;
  }, [libraries, selectedStockerId, stockers]);

  if (loadError) return <MapFallback title="Map unavailable" body={loadError.message} className="h-full min-h-[100dvh] rounded-none" />;
  return (
    <div className="relative h-full min-h-[100dvh] w-full bg-[#050505]">
      <div ref={containerRef} className="h-full min-h-[100dvh] w-full" />
      <button
        type="button"
        onClick={fitToStockers}
        className="absolute bottom-5 right-5 z-20 rounded-md border border-[#d4a843]/40 bg-black/80 px-4 py-3 text-xs font-bold uppercase tracking-[0.16em] text-[#d4a843] backdrop-blur"
      >
        Re-center
      </button>
    </div>
  );
}
