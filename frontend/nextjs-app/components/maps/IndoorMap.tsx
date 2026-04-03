import { useEffect, useRef } from "react";
import L from "leaflet";

type IndoorMapMarker = {
  id: string;
  position: [number, number];
  color?: string;
  label?: string;
};

type IndoorMapProps = {
  imageUrl?: string | null;
  bounds?: [[number, number], [number, number]];
  markers?: IndoorMapMarker[];
  path?: [number, number][];
  className?: string;
};

export default function IndoorMap({ imageUrl, bounds = [[0, 0], [600, 800]], markers = [], path = [], className }: IndoorMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    });

    L.rectangle(bounds, {
      color: "#2a2a2a",
      weight: 1,
      fillColor: "#111111",
      fillOpacity: 1,
    }).addTo(map);

    if (imageUrl) {
      L.imageOverlay(imageUrl, bounds).addTo(map);
    }

    if (path.length > 1) {
      L.polyline(path, {
        color: "#d4a843",
        weight: 3,
        dashArray: "6 6",
      }).addTo(map);
    }

    markers.forEach((marker) => {
      L.circleMarker(marker.position, {
        radius: 8,
        color: marker.color ?? "#d4a843",
        fillColor: marker.color ?? "#d4a843",
        fillOpacity: 0.9,
        weight: 2,
      })
        .addTo(map)
        .bindTooltip(marker.label ?? "", {
          permanent: Boolean(marker.label),
          direction: "top",
          opacity: 0.9,
        });
    });

    map.fitBounds(bounds, { padding: [20, 20] });
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [bounds, imageUrl, markers, path]);

  return <div ref={containerRef} className={`h-full min-h-[300px] w-full rounded-[28px] border border-white/10 bg-[#111111] ${className ?? ""}`.trim()} />;
}
