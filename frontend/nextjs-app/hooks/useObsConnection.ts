import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OBSWebSocket from "obs-websocket-js";

type ObsStatus = "disabled" | "disconnected" | "connecting" | "connected" | "streaming" | "error";

const normalizeMessage = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown OBS error";
};

const isOutputActiveMessage = (message: string) => message.toLowerCase().includes("output is currently active");
const isOutputInactiveMessage = (message: string) => message.toLowerCase().includes("output is not currently active");

export function useObsConnection(options: {
  url?: string | null;
  password?: string | null;
  sceneName?: string | null;
  maxAttempts?: number;
  retryDelayMs?: number;
}): {
  enabled: boolean;
  status: ObsStatus;
  isStreaming: boolean;
  lastError: string | null;
  startStreaming: () => Promise<void>;
  stopStreaming: () => Promise<void>;
  applyStreamSettings: (settings: { server: string; key: string; streamServiceType?: string }) => Promise<void>;
} {
  const trimmedUrl = options.url?.trim() ?? "";
  const trimmedPassword = options.password?.trim() ?? "";
  const desiredScene = options.sceneName?.trim() || null;
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const enabled = Boolean(trimmedUrl);
  const [status, setStatus] = useState<ObsStatus>(() => (enabled ? "disconnected" : "disabled"));
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const clientRef = useRef<OBSWebSocket | null>(null);
  const connectPromiseRef = useRef<Promise<OBSWebSocket | null> | null>(null);
  const hasEventsRef = useRef(false);

  const updateWindowDebug = useCallback(
    (override?: Partial<{ status: ObsStatus; isStreaming: boolean; error: string | null }>) => {
      if (typeof window === "undefined") {
        return;
      }
      (window as typeof window & { kioskObsDebug?: Record<string, unknown> }).kioskObsDebug = {
        status: override?.status ?? status,
        isStreaming: override?.isStreaming ?? isStreaming,
        url: trimmedUrl,
        error: override?.error ?? lastError,
      };
    },
    [isStreaming, lastError, status, trimmedUrl]
  );

  const teardown = useCallback(() => {
    if (clientRef.current) {
      try {
        clientRef.current.disconnect();
      } catch {
        // best effort cleanup
      }
    }
    clientRef.current = null;
    connectPromiseRef.current = null;
    hasEventsRef.current = false;
    setIsStreaming(false);
    setStatus(enabled ? "disconnected" : "disabled");
  }, [enabled]);

  const bindEvents = useCallback(() => {
    if (!clientRef.current || hasEventsRef.current) {
      return;
    }
    hasEventsRef.current = true;
    clientRef.current.on("ConnectionClosed", () => {
      hasEventsRef.current = false;
      clientRef.current = null;
      connectPromiseRef.current = null;
      setIsStreaming(false);
      setStatus(enabled ? "disconnected" : "disabled");
      updateWindowDebug({ status: enabled ? "disconnected" : "disabled", isStreaming: false });
    });
    clientRef.current.on("ConnectionError", (error) => {
      const message = normalizeMessage(error);
      setStatus("error");
      setLastError(message);
      updateWindowDebug({ status: "error", error: message });
    });
    clientRef.current.on("StreamStateChanged", ({ outputActive }) => {
      setIsStreaming(outputActive);
      setStatus(outputActive ? "streaming" : "connected");
      updateWindowDebug({ status: outputActive ? "streaming" : "connected", isStreaming: outputActive });
    });
  }, [enabled, updateWindowDebug]);

  const connect = useCallback(async () => {
    if (!enabled || !trimmedUrl) {
      return null;
    }
    if (connectPromiseRef.current) {
      return connectPromiseRef.current;
    }
    if (!clientRef.current) {
      clientRef.current = new OBSWebSocket();
    }
    bindEvents();
    setStatus((prev) => (prev === "streaming" ? prev : "connecting"));
    setLastError(null);

    const attemptConnection = async (attempt: number): Promise<OBSWebSocket | null> => {
      try {
        await clientRef.current!.connect(trimmedUrl, trimmedPassword || undefined);
        try {
          const { outputActive } = await clientRef.current!.call("GetStreamStatus");
          setIsStreaming(outputActive);
          setStatus(outputActive ? "streaming" : "connected");
          updateWindowDebug({ status: outputActive ? "streaming" : "connected", isStreaming: outputActive });
        } catch {
          setStatus("connected");
          updateWindowDebug({ status: "connected" });
        }
        if (desiredScene) {
          try {
            await clientRef.current!.call("SetCurrentProgramScene", { sceneName: desiredScene });
          } catch (error) {
            console.warn("[useObsConnection] Failed to set OBS scene", error);
          }
        }
        return clientRef.current;
      } catch (error) {
        const message = normalizeMessage(error);
        setStatus("error");
        setLastError(message);
        updateWindowDebug({ status: "error", error: message });
        if (attempt >= maxAttempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        return attemptConnection(attempt + 1);
      }
    };

    const connectionPromise = attemptConnection(1).finally(() => {
      connectPromiseRef.current = null;
    });
    connectPromiseRef.current = connectionPromise;
    return connectionPromise;
  }, [bindEvents, desiredScene, enabled, maxAttempts, retryDelayMs, trimmedPassword, trimmedUrl, updateWindowDebug]);

  const startStreaming = useCallback(async () => {
    if (!enabled) {
      return;
    }
    const obs = await connect();
    if (!obs) {
      return;
    }
    try {
      await obs.call("StartStream");
      setStatus("streaming");
      setIsStreaming(true);
      updateWindowDebug({ status: "streaming", isStreaming: true });
    } catch (error) {
      const message = normalizeMessage(error);
      if (isOutputActiveMessage(message)) {
        setStatus("streaming");
        setIsStreaming(true);
        updateWindowDebug({ status: "streaming", isStreaming: true });
        return;
      }
      setStatus("error");
      setLastError(message);
      updateWindowDebug({ status: "error", error: message });
      throw error;
    }
  }, [connect, enabled, updateWindowDebug]);

  const stopStreaming = useCallback(async () => {
    if (!enabled) {
      return;
    }
    const obs = await connect().catch(() => null);
    if (!obs) {
      setStatus("disconnected");
      setIsStreaming(false);
      updateWindowDebug({ status: "disconnected", isStreaming: false });
      return;
    }
    try {
      await obs.call("StopStream");
      setStatus("connected");
      setIsStreaming(false);
      updateWindowDebug({ status: "connected", isStreaming: false });
    } catch (error) {
      const message = normalizeMessage(error);
      if (isOutputInactiveMessage(message)) {
        setStatus("connected");
        setIsStreaming(false);
        updateWindowDebug({ status: "connected", isStreaming: false });
        return;
      }
      setStatus("error");
      setLastError(message);
      updateWindowDebug({ status: "error", error: message });
      throw error;
    }
  }, [connect, enabled, updateWindowDebug]);

  const applyStreamSettings = useCallback(
    async (settings: { server: string; key: string; streamServiceType?: string }) => {
      if (!enabled) {
        return;
      }
      const obs = await connect();
      if (!obs) {
        throw new Error("OBS connection unavailable");
      }
      const server = settings.server?.trim();
      const key = settings.key?.trim();
      if (!server || !key) {
        throw new Error("Missing OBS stream settings");
      }
      try {
        await obs.call("SetStreamServiceSettings", {
          streamServiceType: settings.streamServiceType ?? "rtmp_custom",
          streamServiceSettings: {
            server,
            key,
            use_auth: false,
          },
        });
      } catch (error) {
        const message = normalizeMessage(error);
        setStatus("error");
        setLastError(message);
        updateWindowDebug({ status: "error", error: message });
        throw error;
      }
    },
    [connect, enabled, updateWindowDebug]
  );

  useEffect(() => {
    if (!enabled) {
      teardown();
      return;
    }
    void connect();
    return () => {
      teardown();
      updateWindowDebug({ status: "disconnected", isStreaming: false });
    };
  }, [connect, enabled, teardown, updateWindowDebug]);

  useEffect(() => {
    updateWindowDebug();
    return () => {
      if (typeof window !== "undefined" && (window as typeof window & { kioskObsDebug?: unknown }).kioskObsDebug) {
        delete (window as typeof window & { kioskObsDebug?: unknown }).kioskObsDebug;
      }
    };
  }, [updateWindowDebug]);

  return useMemo(
    () => ({
      enabled,
      status,
      isStreaming,
      lastError,
      startStreaming,
      stopStreaming,
      applyStreamSettings,
    }),
    [applyStreamSettings, enabled, isStreaming, lastError, startStreaming, status, stopStreaming]
  );
}
