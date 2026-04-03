import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { TEN_KINGS_MAP_STYLE, TEN_KINGS_MARKER_SVG } from "../../lib/mapStyles";

export type StoreLocatorMapLocation = {
  id: string;
  slug: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  locationType?: string | null;
  city?: string | null;
  state?: string | null;
};

type StoreLocatorMapProps = {
  locations: StoreLocatorMapLocation[];
  onMarkerClick?: (slug: string) => void;
  className?: string;
};

function buildPopupNode(location: StoreLocatorMapLocation, onMarkerClick?: (slug: string) => void) {
  const container = document.createElement("div");
  container.className = "tk-map-popup";

  const title = document.createElement("p");
  title.className = "tk-map-popup__title";
  title.textContent = location.name;
  container.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "tk-map-popup__meta";
  meta.textContent = [location.city, location.state].filter(Boolean).join(", ") || location.address;
  container.appendChild(meta);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "tk-map-popup__action";
  action.textContent = "View details ↓";
  action.addEventListener("click", () => onMarkerClick?.(location.slug));
  container.appendChild(action);

  return container;
}

export default function StoreLocatorMap({ locations, onMarkerClick, className }: StoreLocatorMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: TEN_KINGS_MAP_STYLE,
      center: [-98.5795, 39.8283],
      zoom: 3.2,
      attributionControl: false,
    });

    map.dragRotate.disable();
    map.touchZoomRotate.enable({ around: "center" });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    const handleResize = () => map.resize();
    window.addEventListener("resize", handleResize);

    mapRef.current = map;

    return () => {
      window.removeEventListener("resize", handleResize);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (locations.length === 0) {
      return;
    }

    const bounds = new maplibregl.LngLatBounds();

    locations.forEach((location) => {
      const markerNode = document.createElement("button");
      markerNode.type = "button";
      markerNode.className = "tk-map-marker";
      markerNode.setAttribute("aria-label", `View ${location.name}`);
      markerNode.innerHTML = TEN_KINGS_MARKER_SVG;
      markerNode.addEventListener("click", () => onMarkerClick?.(location.slug));

      const popup = new maplibregl.Popup({
        offset: 18,
        closeButton: false,
        maxWidth: "220px",
      }).setDOMContent(buildPopupNode(location, onMarkerClick));

      const marker = new maplibregl.Marker({
        element: markerNode,
        anchor: "center",
      })
        .setLngLat([location.longitude, location.latitude])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
      bounds.extend([location.longitude, location.latitude]);
    });

    if (locations.length === 1) {
      map.flyTo({
        center: [locations[0].longitude, locations[0].latitude],
        zoom: 11.5,
        duration: 800,
      });
      return;
    }

    map.fitBounds(bounds, {
      padding: 56,
      maxZoom: 12,
      duration: 800,
    });
  }, [locations, onMarkerClick]);

  return <div ref={containerRef} className={`tk-map-theme h-full w-full ${className ?? ""}`.trim()} />;
}
