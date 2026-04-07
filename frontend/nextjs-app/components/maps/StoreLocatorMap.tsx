'use client';

import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useGoogleMaps } from "../../hooks/useGoogleMaps";
import { buildDirectionsHref, getLocationTypeLabel, type KingsHuntLocation } from "../../lib/kingsHunt";
import { ONLINE_LOCATION_SLUG } from "../../lib/locationUtils";
import MapFallback from "./MapFallback";

export interface StoreLocatorMapLocation {
  id: string;
  slug: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  locationType?: string | null;
  city?: string | null;
  state?: string | null;
  hours?: string | null;
  mapsUrl?: string | null;
}

export interface StoreLocatorMapProps {
  locations: StoreLocatorMapLocation[];
  onMarkerClick?: (slug: string) => void;
  className?: string;
  mapRef?: MutableRefObject<google.maps.Map | null>;
  selectedSlug?: string | null;
}

const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 };
const TEN_KINGS_CROWN_PATH = "M6 34 14 13l11 10L32 4l7 19 11-10 8 21-5 2-6-13-12 11-3-16-3 16-12-11-6 13Z";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setMarkerSelected(node: HTMLElement, selected: boolean) {
  node.dataset.selected = selected ? "true" : "false";
}

function createCrownMarkerContent(selected = false): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "tk-map-marker";
  setMarkerSelected(container, selected);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 40");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("fill", "#0a0a0a");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", TEN_KINGS_CROWN_PATH);
  svg.appendChild(path);

  const crown = document.createElement("span");
  crown.className = "tk-map-marker__crown";
  crown.appendChild(svg);
  container.appendChild(crown);

  return container;
}

function createClusterMarkerContent(count: number): HTMLDivElement {
  const element = document.createElement("div");
  element.style.cssText = `
    width: 44px;
    height: 44px;
    border-radius: 999px;
    background: #d4a843;
    color: #0a0a0a;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Clash Display', sans-serif;
    font-weight: 700;
    font-size: 16px;
    cursor: pointer;
    box-shadow: 0 0 16px rgba(212,168,67,0.4);
    border: 1px solid rgba(10,10,10,0.18);
  `;
  element.textContent = String(count);
  return element;
}

function buildInfoWindowContent(location: StoreLocatorMapLocation): string {
  const typeLabel = escapeHtml(getLocationTypeLabel(location.locationType).toUpperCase());
  const name = escapeHtml(location.name);
  const address = escapeHtml(location.address || "");
  const startHuntHref = `/kingshunt/${encodeURIComponent(location.slug)}`;
  const directionsButton = location.mapsUrl
    ? `<a href="${escapeHtml(location.mapsUrl)}" target="_blank" rel="noopener noreferrer" style="
        display:inline-block;
        background:transparent;
        color:#d4a843;
        padding:8px 16px;
        border-radius:6px;
        font-weight:700;
        font-size:13px;
        text-decoration:none;
        border:1px solid #d4a843;
        text-transform:uppercase;
        letter-spacing:0.05em;
        font-family:Satoshi,sans-serif;
      ">Directions</a>`
    : "";

  return `
    <div style="
      font-family:Satoshi,sans-serif;
      background:#111111;
      color:#ffffff;
      padding:16px;
      min-width:220px;
      border-radius:8px;
    ">
      <div style="
        font-size:11px;
        color:#d4a843;
        letter-spacing:0.1em;
        font-weight:700;
        text-transform:uppercase;
        margin-bottom:4px;
      ">${typeLabel}</div>
      <div style="
        font-family:'Clash Display',sans-serif;
        font-size:18px;
        font-weight:700;
        color:#ffffff;
        margin-bottom:8px;
      ">${name}</div>
      <div style="
        font-size:13px;
        color:#999999;
        margin-bottom:12px;
      ">${address}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a href="${startHuntHref}" style="
          display:inline-block;
          background:#d4a843;
          color:#0a0a0a;
          padding:8px 16px;
          border-radius:6px;
          font-weight:700;
          font-size:13px;
          text-decoration:none;
          text-transform:uppercase;
          letter-spacing:0.05em;
          font-family:Satoshi,sans-serif;
        ">Start Hunt</a>
        ${directionsButton}
      </div>
    </div>
  `;
}

function applyInfoWindowChrome() {
  const frame = document.querySelector(".gm-style .gm-style-iw-c");
  if (frame instanceof HTMLElement) {
    frame.style.padding = "0";
    frame.style.background = "transparent";
    frame.style.boxShadow = "none";
    frame.style.borderRadius = "0";
  }

  const content = document.querySelector(".gm-style .gm-style-iw-d");
  if (content instanceof HTMLElement) {
    content.style.overflow = "hidden";
    content.style.maxHeight = "none";
  }

  const tail = document.querySelector(".gm-style .gm-style-iw-tc");
  if (tail instanceof HTMLElement) {
    tail.style.display = "none";
  }
}

export default function StoreLocatorMap({
  locations,
  onMarkerClick,
  className,
  mapRef,
  selectedSlug = null,
}: StoreLocatorMapProps) {
  const { isLoaded, loadError, libraries } = useGoogleMaps();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const markerLookupRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const markerNodeLookupRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const [mapError, setMapError] = useState<Error | null>(null);

  const physicalLocations = useMemo(
    () =>
      locations.filter(
        (location) =>
          location.slug !== ONLINE_LOCATION_SLUG &&
          Number.isFinite(location.latitude) &&
          Number.isFinite(location.longitude),
      ),
    [locations],
  );

  const locationsBySlug = useMemo(
    () => new Map(physicalLocations.map((location) => [location.slug, location])),
    [physicalLocations],
  );

  const updateSelectedMarkers = (slug: string | null) => {
    markerNodeLookupRef.current.forEach((node, markerSlug) => {
      setMarkerSelected(node, markerSlug === slug);
    });
  };

  const openInfoWindow = (location: StoreLocatorMapLocation, marker: google.maps.marker.AdvancedMarkerElement) => {
    const map = mapInstanceRef.current;
    const infoWindow = infoWindowRef.current;
    if (!map || !infoWindow) {
      return;
    }

    infoWindow.setContent(buildInfoWindowContent(location));
    infoWindow.open({ anchor: marker, map });
  };

  useEffect(() => {
    if (!isLoaded || !libraries || !containerRef.current || mapInstanceRef.current || mapError) {
      return;
    }

    const markerLookup = markerLookupRef.current;
    const markerNodeLookup = markerNodeLookupRef.current;

    try {
      const { Map, InfoWindow } = libraries.mapsLibrary;

      mapInstanceRef.current = new Map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: 4,
        minZoom: 3,
        mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID!,
        colorScheme: "DARK" as any,
        renderingType: google.maps.RenderingType.VECTOR,
        disableDefaultUI: true,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        gestureHandling: "cooperative",
      });
      mapRef && (mapRef.current = mapInstanceRef.current);

      const infoWindow = new InfoWindow();
      infoWindow.addListener("domready", applyInfoWindowChrome);
      infoWindowRef.current = infoWindow;
    } catch (error) {
      console.error("Store locator map initialization failed", error);
      setMapError(error instanceof Error ? error : new Error("Unable to initialize the location map"));
      return;
    }

    return () => {
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;

      markerLookup.forEach((marker) => {
        google.maps.event.clearInstanceListeners(marker);
        marker.map = null;
      });
      markerLookup.clear();
      markerNodeLookup.clear();

      infoWindowRef.current?.close();
      infoWindowRef.current = null;
      mapInstanceRef.current = null;
      if (mapRef) {
        mapRef.current = null;
      }
    };
  }, [isLoaded, libraries, mapError, mapRef]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    const infoWindow = infoWindowRef.current;
    if (!map || !infoWindow || !libraries || mapError) {
      return;
    }

    try {
      const { AdvancedMarkerElement } = libraries.markerLibrary;

      clustererRef.current?.clearMarkers();
      clustererRef.current = null;

      markerLookupRef.current.forEach((marker) => {
        google.maps.event.clearInstanceListeners(marker);
        marker.map = null;
      });
      markerLookupRef.current.clear();
      markerNodeLookupRef.current.clear();
      infoWindow.close();

      if (physicalLocations.length === 0) {
        map.setCenter(DEFAULT_CENTER);
        map.setZoom(4);
        return;
      }

      const bounds = new google.maps.LatLngBounds();
      const markers: google.maps.marker.AdvancedMarkerElement[] = [];

      physicalLocations.forEach((location) => {
        const content = createCrownMarkerContent(false);
        const marker = new AdvancedMarkerElement({
          map,
          position: { lat: location.latitude, lng: location.longitude },
          title: location.name,
          gmpClickable: true,
          content,
        });

        marker.addListener("click", () => {
          updateSelectedMarkers(location.slug);
          openInfoWindow(location, marker);
          onMarkerClick?.(location.slug);
        });

        markerLookupRef.current.set(location.slug, marker);
        markerNodeLookupRef.current.set(location.slug, content);
        markers.push(marker);
        bounds.extend({ lat: location.latitude, lng: location.longitude });
      });

      clustererRef.current = new MarkerClusterer({
        map,
        markers,
        renderer: {
          render: ({ count, position }) =>
            new AdvancedMarkerElement({
              position,
              zIndex: 1000 + count,
              content: createClusterMarkerContent(count),
            }),
        },
      });

      if (physicalLocations.length === 1) {
        map.setCenter({ lat: physicalLocations[0].latitude, lng: physicalLocations[0].longitude });
        map.setZoom(12);
      } else {
        map.fitBounds(bounds, 72);
      }
    } catch (error) {
      console.error("Store locator markers failed to render", error);
      setMapError(error instanceof Error ? error : new Error("Unable to render location markers"));
    }
  }, [libraries, mapError, onMarkerClick, physicalLocations]);

  useEffect(() => {
    updateSelectedMarkers(selectedSlug);

    if (!selectedSlug) {
      infoWindowRef.current?.close();
      return;
    }

    const marker = markerLookupRef.current.get(selectedSlug);
    const location = locationsBySlug.get(selectedSlug);
    if (!marker || !location) {
      return;
    }

    openInfoWindow(location, marker);
  }, [locationsBySlug, selectedSlug]);

  if (loadError || mapError) {
    return (
      <MapFallback
        className={className}
        eyebrow="Map failed to load"
        title="Venue map unavailable"
        body="The live map could not load, but every location card below is still available with directions and hunt links."
      />
    );
  }

  if (!isLoaded) {
    return <div className={`tk-map-loading ${className ?? ""}`.trim()}>Loading map</div>;
  }

  return (
    <div className={`tk-google-map ${className ?? ""}`.trim()}>
      <div ref={containerRef} className="tk-google-map__canvas" />
    </div>
  );
}

export function buildStoreLocatorDirectionsHref(
  location: Pick<StoreLocatorMapLocation, "latitude" | "longitude" | "address" | "mapsUrl">,
  origin?: { lat: number; lng: number } | null,
) {
  return buildDirectionsHref(
    {
      latitude: location.latitude,
      longitude: location.longitude,
      address: location.address,
      mapsUrl: location.mapsUrl ?? null,
    } satisfies Pick<KingsHuntLocation, "latitude" | "longitude" | "address" | "mapsUrl">,
    origin ?? null,
  );
}
