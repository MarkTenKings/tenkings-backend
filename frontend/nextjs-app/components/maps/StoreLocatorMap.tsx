'use client';

import { useEffect, useRef } from "react";
import { buildDirectionsHref, formatLocationHours, type KingsHuntLocation } from "../../lib/kingsHunt";
import { useGoogleMaps } from "../../hooks/useGoogleMaps";

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
}

const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 };

function buildMarkerNode(): HTMLDivElement {
  const marker = document.createElement("div");
  marker.className = "tk-map-marker";

  const crown = document.createElement("span");
  crown.className = "tk-map-marker__crown";
  crown.textContent = "TK";
  marker.appendChild(crown);

  return marker;
}

function buildPopupNode(location: StoreLocatorMapLocation, onMarkerClick?: (slug: string) => void): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.className = "tk-map-popup";

  const eyebrow = document.createElement("p");
  eyebrow.className = "tk-map-popup__eyebrow";
  eyebrow.textContent = "Kings Hunt Venue";
  wrapper.appendChild(eyebrow);

  const title = document.createElement("p");
  title.className = "tk-map-popup__title";
  title.textContent = location.name;
  wrapper.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "tk-map-popup__meta";
  meta.textContent = [location.address, [location.city, location.state].filter(Boolean).join(", ")].filter(Boolean).join(" • ");
  wrapper.appendChild(meta);

  const hours = formatLocationHours(location.hours);
  if (hours) {
    const hoursNode = document.createElement("p");
    hoursNode.className = "tk-map-popup__hours";
    hoursNode.textContent = hours;
    wrapper.appendChild(hoursNode);
  }

  const actions = document.createElement("div");
  actions.className = "tk-map-popup__actions";

  const detailsButton = document.createElement("button");
  detailsButton.type = "button";
  detailsButton.className = "tk-map-popup__action";
  detailsButton.textContent = "View Details";
  detailsButton.addEventListener("click", () => onMarkerClick?.(location.slug));
  actions.appendChild(detailsButton);

  const directionsLink = document.createElement("a");
  directionsLink.className = "tk-map-popup__secondary";
  directionsLink.href = buildDirectionsHref({
    latitude: location.latitude,
    longitude: location.longitude,
    address: location.address,
    mapsUrl: location.mapsUrl ?? null,
  } satisfies Pick<KingsHuntLocation, "latitude" | "longitude" | "address" | "mapsUrl">);
  directionsLink.target = "_blank";
  directionsLink.rel = "noreferrer";
  directionsLink.textContent = "Get Directions";
  actions.appendChild(directionsLink);

  wrapper.appendChild(actions);
  return wrapper;
}

export default function StoreLocatorMap({ locations, onMarkerClick, className }: StoreLocatorMapProps) {
  const { isLoaded, loadError } = useGoogleMaps();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  useEffect(() => {
    if (!isLoaded || !containerRef.current || mapRef.current) {
      return;
    }

    mapRef.current = new google.maps.Map(containerRef.current, {
      center: DEFAULT_CENTER,
      zoom: 4,
      minZoom: 3,
      mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID,
      disableDefaultUI: true,
      zoomControl: true,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
      gestureHandling: "cooperative",
    });
    infoWindowRef.current = new google.maps.InfoWindow();

    return () => {
      markersRef.current.forEach((marker) => {
        marker.map = null;
      });
      markersRef.current = [];
      infoWindowRef.current?.close();
      infoWindowRef.current = null;
      mapRef.current = null;
    };
  }, [isLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    const infoWindow = infoWindowRef.current;
    if (!map || !infoWindow) {
      return;
    }

    markersRef.current.forEach((marker) => {
      marker.map = null;
    });
    markersRef.current = [];

    if (locations.length === 0) {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(4);
      return;
    }

    const bounds = new google.maps.LatLngBounds();

    locations.forEach((location) => {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: location.latitude, lng: location.longitude },
        title: location.name,
        content: buildMarkerNode(),
      });

      marker.addListener("gmp-click", () => {
        infoWindow.setContent(buildPopupNode(location, onMarkerClick));
        infoWindow.open({ map, anchor: marker });
      });

      markersRef.current.push(marker);
      bounds.extend({ lat: location.latitude, lng: location.longitude });
    });

    if (locations.length === 1) {
      map.setCenter({ lat: locations[0].latitude, lng: locations[0].longitude });
      map.setZoom(12);
      return;
    }

    map.fitBounds(bounds, 72);
  }, [locations, onMarkerClick]);

  if (loadError) {
    return <div className={`tk-map-loading ${className ?? ""}`.trim()}>Map failed to load</div>;
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
