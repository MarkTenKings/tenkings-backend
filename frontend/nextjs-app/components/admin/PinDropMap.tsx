'use client';

import { useCallback, useEffect, useRef } from "react";
import { useGoogleMaps, type LoadedGoogleMaps } from "../../hooks/useGoogleMaps";
import MapFallback from "../maps/MapFallback";

export interface PinDropMapProps {
  lat: number | null;
  lng: number | null;
  onPositionChange: (lat: number, lng: number) => void;
  geofenceRadiusM?: number;
  height?: string;
  pinColor?: string;
  pinLabel?: string;
  zoom?: number;
  defaultCenter?: { lat: number; lng: number } | null;
}

const DEFAULT_CENTER = { lat: 38.58, lng: -121.49 };

function getPosition(lat: number | null, lng: number | null): { lat: number; lng: number } | null {
  return typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

function createPinElement(pinColor: string, pinLabel: string) {
  const pinEl = document.createElement("div");
  pinEl.style.cssText = [
    "width: 36px",
    "height: 36px",
    "border-radius: 50%",
    `background: ${pinColor}`,
    `color: ${pinColor.toLowerCase() === "#3b82f6" ? "#fff" : "#0a0a0a"}`,
    "display: flex",
    "align-items: center",
    "justify-content: center",
    "font-family: Satoshi, sans-serif",
    "font-weight: 800",
    "font-size: 14px",
    "cursor: grab",
    "box-shadow: 0 2px 8px rgba(0,0,0,0.5)",
    "border: 2px solid rgba(255,255,255,0.75)",
  ].join(";");
  pinEl.textContent = pinLabel;
  return pinEl;
}

function readMarkerPosition(marker: google.maps.marker.AdvancedMarkerElement): { lat: number; lng: number } | null {
  const position = marker.position;
  if (!position) {
    return null;
  }

  const lat = typeof position.lat === "function" ? position.lat() : position.lat;
  const lng = typeof position.lng === "function" ? position.lng() : position.lng;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
}

export function PinDropMap({
  lat,
  lng,
  onPositionChange,
  geofenceRadiusM,
  height = "300px",
  pinColor = "#d4a843",
  pinLabel = "V",
  zoom = 17,
  defaultCenter = null,
}: PinDropMapProps) {
  const { isLoaded, loadError, libraries } = useGoogleMaps();
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const markerDragListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const mapClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const onPositionChangeRef = useRef(onPositionChange);
  const librariesRef = useRef<LoadedGoogleMaps | null>(null);

  useEffect(() => {
    onPositionChangeRef.current = onPositionChange;
  }, [onPositionChange]);

  useEffect(() => {
    librariesRef.current = libraries;
  }, [libraries]);

  const ensureCircle = useCallback(
    (position: { lat: number; lng: number }) => {
      const map = mapRef.current;
      if (!map || !geofenceRadiusM || geofenceRadiusM <= 0) {
        circleRef.current?.setMap(null);
        circleRef.current = null;
        return;
      }

      if (!circleRef.current) {
        circleRef.current = new google.maps.Circle({
          map,
          center: position,
          radius: geofenceRadiusM,
          fillColor: pinColor,
          fillOpacity: 0.1,
          strokeColor: pinColor,
          strokeOpacity: 0.45,
          strokeWeight: 2,
        });
        return;
      }

      circleRef.current.setCenter(position);
      circleRef.current.setRadius(geofenceRadiusM);
      circleRef.current.setOptions({
        fillColor: pinColor,
        strokeColor: pinColor,
      });
    },
    [geofenceRadiusM, pinColor],
  );

  const ensureMarker = useCallback(
    (position: { lat: number; lng: number }) => {
      const map = mapRef.current;
      const loadedLibraries = librariesRef.current;
      if (!map || !loadedLibraries) {
        return null;
      }

      if (!markerRef.current) {
        const { AdvancedMarkerElement } = loadedLibraries.markerLibrary;
        const marker = new AdvancedMarkerElement({
          map,
          position,
          content: createPinElement(pinColor, pinLabel),
          gmpDraggable: true,
        });

        markerDragListenerRef.current = marker.addListener("dragend", () => {
          const nextPosition = readMarkerPosition(marker);
          if (!nextPosition) {
            return;
          }
          ensureCircle(nextPosition);
          onPositionChangeRef.current(nextPosition.lat, nextPosition.lng);
        });

        markerRef.current = marker;
        return marker;
      }

      markerRef.current.position = position;
      markerRef.current.map = map;
      return markerRef.current;
    },
    [ensureCircle, pinColor, pinLabel],
  );

  const placePin = useCallback(
    (position: { lat: number; lng: number }) => {
      ensureMarker(position);
      ensureCircle(position);
      mapRef.current?.panTo(position);
      onPositionChangeRef.current(position.lat, position.lng);
    },
    [ensureCircle, ensureMarker],
  );

  useEffect(() => {
    if (!isLoaded || !libraries || !mapContainer.current || mapRef.current) {
      return;
    }

    const { Map } = libraries.mapsLibrary;
    const currentPosition = getPosition(lat, lng);
    const center = currentPosition ?? defaultCenter ?? DEFAULT_CENTER;
    const map = new Map(mapContainer.current, {
      center,
      zoom: currentPosition || defaultCenter ? zoom : 5,
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
      gestureHandling: "cooperative",
    });
    mapRef.current = map;

    mapClickListenerRef.current = map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) {
        return;
      }
      placePin({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    });
  }, [defaultCenter, isLoaded, lat, libraries, lng, placePin, zoom]);

  useEffect(() => {
    if (!mapRef.current || !libraries) {
      return;
    }

    const currentPosition = getPosition(lat, lng);
    if (!currentPosition) {
      markerRef.current && (markerRef.current.map = null);
      circleRef.current?.setMap(null);
      circleRef.current = null;
      return;
    }

    ensureMarker(currentPosition);
    ensureCircle(currentPosition);
    mapRef.current.setZoom(zoom);
    mapRef.current.panTo(currentPosition);
  }, [ensureCircle, ensureMarker, lat, libraries, lng, zoom]);

  useEffect(() => {
    if (!mapRef.current || getPosition(lat, lng) || !defaultCenter) {
      return;
    }

    mapRef.current.setZoom(zoom);
    mapRef.current.panTo(defaultCenter);
  }, [defaultCenter, lat, lng, zoom]);

  useEffect(() => {
    return () => {
      markerDragListenerRef.current?.remove();
      mapClickListenerRef.current?.remove();
      circleRef.current?.setMap(null);
      markerRef.current && (markerRef.current.map = null);
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, []);

  if (loadError) {
    return <MapFallback title="Map unavailable" body={loadError.message} className="h-[300px]" />;
  }

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={mapContainer}
        style={{
          width: "100%",
          height,
          borderRadius: "8px",
          overflow: "hidden",
          border: "1px solid #222",
          background: "#050505",
        }}
      />
      {!isLoaded ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 text-[11px] uppercase tracking-[0.24em] text-[#d4a843]">
          Loading map
        </div>
      ) : null}
      <p style={{ color: "#666", fontSize: "11px", fontFamily: "Satoshi, sans-serif", marginTop: "6px" }}>
        Click the map to place a pin, or drag the pin to adjust position.
      </p>
    </div>
  );
}
