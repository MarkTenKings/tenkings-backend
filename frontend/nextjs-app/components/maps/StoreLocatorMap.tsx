'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { useGoogleMaps } from "../../hooks/useGoogleMaps";
import { isComingSoonLocation } from "../../lib/locationStatus";
import { ONLINE_LOCATION_SLUG } from "../../lib/locationUtils";
import { TEN_KINGS_COLLECTIBLES_CROWN_PATH, TEN_KINGS_COLLECTIBLES_CROWN_VIEWBOX } from "../../lib/tenKingsBrand";
import MapFallback from "./MapFallback";

export interface StoreLocatorMapLocation {
  id: string;
  slug: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  locationType?: string | null;
  locationStatus?: string | null;
  city?: string | null;
  state?: string | null;
  hours?: string | null;
  mapsUrl?: string | null;
}

export interface StoreLocatorMapProps {
  locations: StoreLocatorMapLocation[];
  onMarkerClick?: (slug: string) => void;
  onMapClick?: () => void;
  className?: string;
  selectedSlug?: string | null;
  edgeToEdge?: boolean;
}

const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 };

function setMarkerSelected(node: HTMLElement, selected: boolean) {
  node.dataset.selected = selected ? "true" : "false";
}

function createCrownMarkerContent(location: Pick<StoreLocatorMapLocation, "locationStatus">, selected = false): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "tk-map-marker";
  setMarkerSelected(container, selected);

  const isComingSoon = isComingSoonLocation(location.locationStatus);
  container.dataset.variant = isComingSoon ? "silver" : "gold";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", TEN_KINGS_COLLECTIBLES_CROWN_VIEWBOX);
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("fill", isComingSoon ? "#ffffff" : "#0a0a0a");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", TEN_KINGS_COLLECTIBLES_CROWN_PATH);
  svg.appendChild(path);

  const crown = document.createElement("span");
  crown.className = "tk-map-marker__crown";
  crown.appendChild(svg);
  container.appendChild(crown);

  return container;
}

function focusLocation(map: google.maps.Map, location: StoreLocatorMapLocation) {
  map.panTo({ lat: location.latitude, lng: location.longitude });

  const currentZoom = map.getZoom() ?? 4;
  if (currentZoom < 14) {
    map.setZoom(14);
  }

  if (typeof window === "undefined") {
    return;
  }

  window.setTimeout(() => {
    if (window.innerWidth < 768) {
      map.panBy(0, 140);
    } else {
      map.panBy(-180, 0);
    }
  }, 120);
}

export default function StoreLocatorMap({
  locations,
  onMarkerClick,
  onMapClick,
  className,
  selectedSlug = null,
  edgeToEdge = false,
}: StoreLocatorMapProps) {
  const { isLoaded, loadError, libraries } = useGoogleMaps();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerLookupRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const markerNodeLookupRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const onMarkerClickRef = useRef<StoreLocatorMapProps["onMarkerClick"]>(onMarkerClick);
  const onMapClickRef = useRef<StoreLocatorMapProps["onMapClick"]>(onMapClick);
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

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    if (!isLoaded || !libraries || !containerRef.current || mapInstanceRef.current || mapError) {
      return;
    }

    const markerLookup = markerLookupRef.current;
    const markerNodeLookup = markerNodeLookupRef.current;

    try {
      const { Map } = libraries.mapsLibrary;

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
        gestureHandling: "greedy",
      });

      mapInstanceRef.current.addListener("click", () => {
        onMapClickRef.current?.();
      });
    } catch (error) {
      console.error("Store locator map initialization failed", error);
      setMapError(error instanceof Error ? error : new Error("Unable to initialize the location map"));
      return;
    }

    return () => {
      markerLookup.forEach((marker) => {
        google.maps.event.clearInstanceListeners(marker);
        marker.map = null;
      });
      markerLookup.clear();
      markerNodeLookup.clear();

      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
      }
      mapInstanceRef.current = null;
    };
  }, [isLoaded, libraries, mapError]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !libraries || mapError) {
      return;
    }

    try {
      const { AdvancedMarkerElement } = libraries.markerLibrary;

      markerLookupRef.current.forEach((marker) => {
        google.maps.event.clearInstanceListeners(marker);
        marker.map = null;
      });
      markerLookupRef.current.clear();
      markerNodeLookupRef.current.clear();

      if (physicalLocations.length === 0) {
        map.setCenter(DEFAULT_CENTER);
        map.setZoom(4);
        return;
      }

      const bounds = new google.maps.LatLngBounds();

      physicalLocations.forEach((location) => {
        const content = createCrownMarkerContent(location, false);
        const marker = new AdvancedMarkerElement({
          map,
          position: { lat: location.latitude, lng: location.longitude },
          title: location.name,
          gmpClickable: true,
          content,
        });

        marker.addListener("click", () => {
          setMarkerSelected(content, true);
          onMarkerClickRef.current?.(location.slug);
          focusLocation(map, location);
        });

        markerLookupRef.current.set(location.slug, marker);
        markerNodeLookupRef.current.set(location.slug, content);
        bounds.extend({ lat: location.latitude, lng: location.longitude });
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
  }, [libraries, mapError, physicalLocations]);

  useEffect(() => {
    markerNodeLookupRef.current.forEach((node, markerSlug) => {
      setMarkerSelected(node, markerSlug === selectedSlug);
    });

    if (!selectedSlug) {
      return;
    }

    const map = mapInstanceRef.current;
    const location = locationsBySlug.get(selectedSlug);
    if (!map || !location) {
      return;
    }

    focusLocation(map, location);
  }, [locationsBySlug, selectedSlug]);

  if (loadError || mapError) {
    return (
      <MapFallback
        className={className}
        eyebrow="Map failed to load"
        title="Venue map unavailable"
        body="The live map could not load, but every location detail panel and hunt link will return once the map service recovers."
      />
    );
  }

  if (!isLoaded) {
    return <div className={`tk-map-loading ${className ?? ""}`.trim()}>Loading map</div>;
  }

  return (
    <div className={`tk-google-map ${edgeToEdge ? "tk-google-map--edge" : ""} ${className ?? ""}`.trim()}>
      <div ref={containerRef} className="tk-google-map__canvas" />
    </div>
  );
}
