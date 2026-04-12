import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveStockerPosition, SSEPositionsEvent } from "../types/stocker";

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export function useStockerLiveFeed(token: string | null | undefined) {
  const [stockers, setStockers] = useState<LiveStockerPosition[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!token || typeof window === "undefined") {
      setConnectionStatus("disconnected");
      return;
    }
    sourceRef.current?.close();
    setConnectionStatus("connecting");
    const source = new EventSource(`/api/admin/stocker/live-feed?token=${encodeURIComponent(token)}`);
    sourceRef.current = source;
    source.onopen = () => setConnectionStatus("connected");
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SSEPositionsEvent;
        if (data.type === "positions") setStockers(data.stockers);
      } catch (error) {
        console.warn("Failed to parse stocker live feed", error);
      }
    };
    source.onerror = () => {
      source.close();
      setConnectionStatus("error");
      reconnectRef.current = setTimeout(connect, 3000);
    };
  }, [token]);

  useEffect(() => {
    connect();
    return () => {
      sourceRef.current?.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  return { stockers, connectionStatus, reconnect: connect };
}
