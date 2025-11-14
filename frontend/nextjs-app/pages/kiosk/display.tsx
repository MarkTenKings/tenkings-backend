import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import OBSWebSocket from "obs-websocket-js";
import Head from "next/head";
import Image from "next/image";
import { useRouter } from "next/router";
import type { SerializedKioskSession } from "../../lib/server/kioskSession";
import { normalizeQrInput } from "../../lib/qrInput";

interface DisplayResponse {
  location: {
    id: string;
    name: string;
    slug: string;
  };
  session: SerializedKioskSession | null;
}

type HelperIntent = "info" | "success" | "error";

const POLL_INTERVAL_MS = 4000;
const TIMER_TICK_MS = 1000;
const ATTRACT_VIDEO_URL = process.env.NEXT_PUBLIC_KIOSK_ATTRACT_VIDEO_URL ?? "";
const KIOSK_SECRET_HEADER = "x-kiosk-secret";
const CONTROL_TOKEN_HEADER = "x-kiosk-token";
const kioskSecret = process.env.NEXT_PUBLIC_KIOSK_API_SECRET ?? "";
const OBS_WS_URL = process.env.NEXT_PUBLIC_OBS_WS_URL ?? "";
const OBS_WS_PASSWORD = process.env.NEXT_PUBLIC_OBS_WS_PASSWORD ?? "";
const OBS_SCENE_ATTRACT = process.env.NEXT_PUBLIC_OBS_SCENE_ATTRACT ?? "Attract Loop";
const OBS_SCENE_COUNTDOWN = process.env.NEXT_PUBLIC_OBS_SCENE_COUNTDOWN ?? OBS_SCENE_ATTRACT;
const OBS_SCENE_LIVE = process.env.NEXT_PUBLIC_OBS_SCENE_LIVE ?? "Live Rip";
const OBS_SCENE_REVEAL = process.env.NEXT_PUBLIC_OBS_SCENE_REVEAL ?? OBS_SCENE_LIVE;
type Stage = "STANDBY" | "COUNTDOWN" | "LIVE" | "REVEAL";

const formatDuration = (ms: number) => {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const extractRevealDetails = (session: SerializedKioskSession | null) => {
  if (!session?.reveal || typeof session.reveal !== "object" || Array.isArray(session.reveal)) {
    return null;
  }
  const payload = session.reveal as Record<string, unknown>;
  return {
    name: (payload.name as string) ?? null,
    set: (payload.set as string) ?? null,
    number: (payload.number as string) ?? null,
    imageUrl: (payload.imageUrl as string) ?? (payload.thumbnailUrl as string) ?? null,
  };
};

const getPackLabel = (session: SerializedKioskSession | null, fallback?: string | null) => {
  if (!session) {
    return fallback ?? null;
  }
  return session.packQrCode?.serial ?? session.packQrCode?.code ?? session.code ?? fallback ?? null;
};

const buildFallbackLocation = (
  current: DisplayResponse["location"] | null | undefined,
  slug?: string,
  locationId?: string
): DisplayResponse["location"] => {
  if (current) {
    return current;
  }
  return {
    id: locationId ?? slug ?? "unknown",
    name: slug ?? "Ten Kings Live",
    slug: slug ?? "live",
  };
};

export default function KioskDisplayPage() {
  const router = useRouter();
  const locationIdParam = router.query.locationId;
  const slugParam = router.query.slug ?? router.query.location;
  const locationId = typeof locationIdParam === "string" ? locationIdParam : Array.isArray(locationIdParam) ? locationIdParam[0] : undefined;
  const slug = typeof slugParam === "string" ? slugParam : Array.isArray(slugParam) ? slugParam[0] : undefined;

  const [display, setDisplay] = useState<DisplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [helperMessage, setHelperMessage] = useState<string | null>(null);
  const [helperIntent, setHelperIntent] = useState<HelperIntent>("info");
  const [controlToken, setControlToken] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [scanBuffer, setScanBuffer] = useState("");
  const [activePackCode, setActivePackCode] = useState<string | null>(null);

  const session = display?.session ?? null;
  const reveal = useMemo(() => extractRevealDetails(session), [session]);

  const countdownRemaining = useMemo(() => {
    if (!session?.countdownEndsAt) {
      return 0;
    }
    return new Date(session.countdownEndsAt).getTime() - now;
  }, [session?.countdownEndsAt, now]);

  const liveRemaining = useMemo(() => {
    if (!session?.liveEndsAt) {
      return 0;
    }
    return new Date(session.liveEndsAt).getTime() - now;
  }, [session?.liveEndsAt, now]);

  const revealRemaining = useMemo(() => {
    if (!session?.revealEndsAt) {
      return 0;
    }
    return new Date(session.revealEndsAt).getTime() - now;
  }, [session?.revealEndsAt, now]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TIMER_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const focusInterval = window.setInterval(() => {
      scanInputRef.current?.focus();
    }, 1500);
    return () => window.clearInterval(focusInterval);
  }, []);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    scanInputRef.current?.focus();
  }, [router.isReady]);

  const storageKey = useMemo(() => {
    if (locationId) {
      return `kiosk-display:${locationId}`;
    }
    if (slug) {
      return `kiosk-display:slug:${slug}`;
    }
    return null;
  }, [locationId, slug]);

  const persistSession = useCallback(
    (sessionId: string, token: string, packCode: string) => {
      if (!storageKey) {
        return;
      }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ sessionId, controlToken: token, packCode, savedAt: Date.now() }));
        setActivePackCode(packCode);
      } catch (err) {
        console.warn("[kiosk-display] failed to persist session", err);
      }
    },
    [storageKey]
  );

  const clearPersistedSession = useCallback(() => {
    if (!storageKey) {
      return;
    }
    try {
      window.localStorage.removeItem(storageKey);
    } catch (err) {
      console.warn("[kiosk-display] failed to clear session cache", err);
    }
    setControlToken(null);
    setActivePackCode(null);
  }, [storageKey]);

  const setHelperState = useCallback((message: string, intent: HelperIntent = "info") => {
    setHelperIntent(intent);
    setHelperMessage(message);
    window.setTimeout(() => {
      setHelperMessage((current) => (current === message ? null : current));
    }, 4000);
  }, []);

  const obsAutomationEnabled = Boolean(OBS_WS_URL);
  const obsClientRef = useRef<OBSWebSocket | null>(null);
  const obsConnectedRef = useRef(false);
  const obsConnectPromiseRef = useRef<Promise<void> | null>(null);
  const obsCurrentSceneRef = useRef<string | null>(null);
  const obsStreamSettingsRef = useRef<{ server: string; key: string } | null>(null);

  const ensureObsConnection = useCallback(async () => {
    if (!obsAutomationEnabled || typeof window === "undefined") {
      return null;
    }
    if (!obsClientRef.current) {
      obsClientRef.current = new OBSWebSocket();
      obsClientRef.current.on("ConnectionClosed", () => {
        obsConnectedRef.current = false;
        obsConnectPromiseRef.current = null;
        obsCurrentSceneRef.current = null;
        setHelperState("OBS connection closed.", "error");
      });
      obsClientRef.current.on("ConnectionError", (error) => {
        obsConnectedRef.current = false;
        obsConnectPromiseRef.current = null;
        obsCurrentSceneRef.current = null;
        console.error("[kiosk-display] OBS connection error", error);
        setHelperState("OBS connection error.", "error");
      });
    }
    if (obsConnectedRef.current) {
      return obsClientRef.current;
    }
    if (!obsConnectPromiseRef.current) {
      setHelperState("Connecting to OBS…", "info");
      obsConnectPromiseRef.current = obsClientRef.current
        ?.connect(OBS_WS_URL, OBS_WS_PASSWORD || undefined)
        .then(async () => {
          obsConnectedRef.current = true;
          try {
            const { currentProgramSceneName } = await obsClientRef.current!.call("GetCurrentProgramScene");
            obsCurrentSceneRef.current = currentProgramSceneName;
          } catch (error) {
            console.warn("[kiosk-display] Unable to fetch OBS scene", error);
            obsCurrentSceneRef.current = null;
          }
          setHelperState("Connected to OBS.", "success");
        })
        .catch((error) => {
          obsConnectedRef.current = false;
          console.error("[kiosk-display] OBS connect failed", error);
          setHelperState(
            error instanceof Error ? `OBS connect failed: ${error.message}` : "OBS connect failed.",
            "error"
          );
          throw error;
        })
        .finally(() => {
          obsConnectPromiseRef.current = null;
        });
    }
    await obsConnectPromiseRef.current;
    return obsClientRef.current;
  }, [obsAutomationEnabled, setHelperState]);

  const setObsScene = useCallback(
    async (sceneName: string) => {
      if (!obsAutomationEnabled || !sceneName) {
        return;
      }
      const obs = await ensureObsConnection();
      if (!obs) {
        return;
      }
      if (obsCurrentSceneRef.current === sceneName) {
        return;
      }
      await obs.call("SetCurrentProgramScene", { sceneName });
      obsCurrentSceneRef.current = sceneName;
    },
    [ensureObsConnection, obsAutomationEnabled]
  );

  const configureObsStream = useCallback(
    async ({ server, key }: { server: string; key: string }) => {
      if (!obsAutomationEnabled) {
        return;
      }
      const obs = await ensureObsConnection();
      if (!obs) {
        return;
      }
      await obs.call("SetStreamServiceSettings", {
        streamServiceType: "rtmp_custom",
        streamServiceSettings: {
          server,
          key,
          use_auth: false,
        },
      });
      obsStreamSettingsRef.current = { server, key };
    },
    [ensureObsConnection, obsAutomationEnabled]
  );

  const startObsStream = useCallback(async () => {
    if (!obsAutomationEnabled) {
      return;
    }
    const obs = await ensureObsConnection();
    if (!obs) {
      return;
    }
    const status = (await obs.call("GetStreamStatus")) as { outputActive?: boolean };
    if (!status.outputActive) {
      await obs.call("StartStream");
      setHelperState("OBS stream started.", "success");
    }
  }, [ensureObsConnection, obsAutomationEnabled, setHelperState]);

  const stopObsStream = useCallback(async () => {
    if (!obsAutomationEnabled) {
      return;
    }
    const obs = await ensureObsConnection();
    if (!obs) {
      return;
    }
    const status = (await obs.call("GetStreamStatus")) as { outputActive?: boolean };
    if (status.outputActive) {
      await obs.call("StopStream");
      setHelperState("OBS stream stopped.", "info");
    }
  }, [ensureObsConnection, obsAutomationEnabled, setHelperState]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }

    if (!locationId && !slug) {
      setError("Add ?locationId=… or ?slug=… to target a kiosk location.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    let poll: number | null = null;

    const fetchDisplay = async () => {
      if (cancelled) {
        return;
      }
      try {
        const params = new URLSearchParams();
        if (locationId) {
          params.set("locationId", locationId);
        } else if (slug) {
          params.set("slug", slug);
        }
        const response = await fetch(`/api/kiosk/display?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as Partial<DisplayResponse> & {
          message?: string;
        };
        if (!response.ok || !payload || !payload.location) {
          throw new Error(payload?.message ?? "Failed to load kiosk display");
        }
        if (cancelled) {
          return;
        }
        setDisplay(payload as DisplayResponse);
        if (payload.session) {
          setActivePackCode(getPackLabel(payload.session));
        } else {
          clearPersistedSession();
        }
        setLastUpdated(Date.now());
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : "Unable to reach kiosk display";
        setError(message);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchDisplay();
    poll = window.setInterval(() => {
      void fetchDisplay();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (poll) {
        window.clearInterval(poll);
      }
    };
  }, [router.isReady, locationId, slug, clearPersistedSession]);

  useEffect(() => {
    if (!router.isReady || !storageKey) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        return;
      }
      const cached = JSON.parse(raw) as { sessionId?: string; controlToken?: string; packCode?: string | null };
      if (!cached?.sessionId || !cached?.controlToken) {
        return;
      }
      setControlToken(cached.controlToken);
      setActivePackCode(cached.packCode ?? null);
      void (async () => {
        try {
          const response = await fetch(`/api/kiosk/${cached.sessionId}`);
          if (!response.ok) {
            throw new Error("session not found");
          }
          const payload = (await response.json()) as { session: SerializedKioskSession };
          setDisplay((prev) =>
            prev ? { ...prev, session: payload.session } : { location: buildFallbackLocation(display?.location, slug, locationId), session: payload.session }
          );
          setActivePackCode(getPackLabel(payload.session, cached.packCode ?? null));
          setHelperState("Restored active session after restart.", "info");
        } catch (err) {
          clearPersistedSession();
        }
      })();
    } catch (err) {
      console.warn("[kiosk-display] failed to parse cached session", err);
    }
  }, [router.isReady, storageKey, display?.location, clearPersistedSession, locationId, slug, setHelperState]);

  const prepareObsForSession = useCallback(
    async (sessionId: string, tokenOverride?: string) => {
      if (!obsAutomationEnabled) {
        return;
      }
      const token = tokenOverride ?? controlToken;
      if (!token) {
        return;
      }
      try {
        const response = await fetch(`/api/kiosk/${sessionId}/ingest`, {
          headers: {
            [CONTROL_TOKEN_HEADER]: token,
          },
        });
        const payload = (await response.json().catch(() => null)) as {
          ingestUrl?: string;
          streamKey?: string;
          message?: string;
        } | null;
        if (!response.ok || !payload?.ingestUrl || !payload?.streamKey) {
          throw new Error(payload?.message ?? "OBS ingest unavailable");
        }
        await configureObsStream({ server: payload.ingestUrl, key: payload.streamKey });
        await setObsScene(OBS_SCENE_COUNTDOWN);
        await startObsStream();
        setHelperState("OBS ingest ready.", "success");
      } catch (error) {
        console.error("[kiosk-display] OBS ingest error", error);
        const message = error instanceof Error ? error.message : "Unable to configure OBS";
        setHelperState(message, "error");
      }
    },
    [obsAutomationEnabled, controlToken, configureObsStream, setHelperState, setObsScene, startObsStream]
  );

  const handlePackScan = useCallback(
    async (code: string) => {
      if (!display?.location) {
        setHelperState("Display is missing location information.", "error");
        return;
      }
      if (!kioskSecret) {
        setHelperState("Kiosk secret is not configured.", "error");
        return;
      }
      try {
        setHelperState(`Starting session for ${code}…`, "info");
        const response = await fetch("/api/kiosk/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [KIOSK_SECRET_HEADER]: kioskSecret,
          },
          body: JSON.stringify({ packCode: code, locationId: display.location.id }),
        });
        const payload = (await response.json().catch(() => null)) as { session: SerializedKioskSession; controlToken: string; message?: string } | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.message ?? "Failed to start session");
        }
        setControlToken(payload.controlToken);
        setDisplay((prev) => (prev ? { ...prev, session: payload.session } : prev));
        const packLabel = getPackLabel(payload.session, code) ?? code;
        setActivePackCode(packLabel);
        persistSession(payload.session.id, payload.controlToken, packLabel);
        void prepareObsForSession(payload.session.id, payload.controlToken);
        setHelperState(`Session ${payload.session.code} ready.`, "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to start session";
        setHelperState(message, "error");
      }
    },
    [display?.location, persistSession, prepareObsForSession, setHelperState]
  );

  const handleCardScan = useCallback(
    async (code: string) => {
      if (!display?.session) {
        setHelperState("Scan a pack before revealing a card.", "error");
        return;
      }
      if (!controlToken) {
        setHelperState("Control token missing; start session from this screen.", "error");
        return;
      }
      try {
        setHelperState("Checking card…", "info");
        const lookupResponse = await fetch(`/api/claim/card/${encodeURIComponent(code)}`);
        const lookupPayload = (await lookupResponse.json().catch(() => null)) as {
          card?: { item?: { id: string; name?: string | null } | null };
          message?: string;
        } | null;
        if (!lookupResponse.ok || !lookupPayload?.card?.item?.id) {
          throw new Error(lookupPayload?.message ?? "Card is not linked to inventory yet");
        }

        const itemId = lookupPayload.card.item.id;
        const qrLinkUrl = `${window.location.origin}/claim/card/${encodeURIComponent(code)}`;

        setHelperState("Revealing card…", "info");
        const response = await fetch(`/api/kiosk/${display.session.id}/reveal`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [CONTROL_TOKEN_HEADER]: controlToken,
          },
          body: JSON.stringify({
            itemId,
            qrLinkUrl,
            buybackLinkUrl: qrLinkUrl,
          }),
        });
        const payload = (await response.json().catch(() => null)) as { session: SerializedKioskSession; message?: string } | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.message ?? "Failed to reveal card");
        }
        setDisplay((prev) => (prev ? { ...prev, session: payload.session } : prev));
        setActivePackCode(getPackLabel(payload.session, activePackCode));
        const friendlyName = lookupPayload.card?.item?.name;
        setHelperState(friendlyName ? `Revealed ${friendlyName}.` : "Card revealed.", "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to reveal card";
        setHelperState(message, "error");
      }
    },
    [display?.session, controlToken, setHelperState, activePackCode]
  );

  const processScan = useCallback(
    async (raw: string) => {
      const normalized = normalizeQrInput(raw);
      if (!normalized) {
        setHelperState("Scanner input not recognised.", "error");
        return;
      }
      if (normalized.startsWith("tkp_")) {
        await handlePackScan(normalized);
      } else if (normalized.startsWith("tkc_")) {
        await handleCardScan(normalized);
      } else {
        setHelperState("Unknown QR code.", "error");
      }
    },
    [handlePackScan, handleCardScan, setHelperState]
  );

  const handleScanSubmit = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (!scanBuffer.trim()) {
        return;
      }
      const value = scanBuffer.trim();
      setScanBuffer("");
      await processScan(value);
    },
    [scanBuffer, processScan]
  );

  const handleScanChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setScanBuffer(event.target.value);
  }, []);

  const sessionInactive = !display?.session;

  const advanceStage = useCallback(
    async (nextStage: SerializedKioskSession["status"]) => {
      if (!display?.session || !controlToken) {
        return;
      }
      try {
        const response = await fetch(`/api/kiosk/${display.session.id}/stage`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [CONTROL_TOKEN_HEADER]: controlToken,
          },
          body: JSON.stringify({ stage: nextStage }),
        });
        const payload = (await response.json().catch(() => null)) as { session?: SerializedKioskSession; message?: string } | null;
        if (!response.ok || !payload?.session) {
          throw new Error(payload?.message ?? "Unable to advance stage");
        }
        const nextSession = payload.session ?? null;
        const normalizedSession =
          nextSession && (nextSession.status === "COMPLETE" || nextSession.status === "CANCELLED") ? null : nextSession;
        setDisplay((prev) => (prev ? { ...prev, session: normalizedSession } : prev));
        if (!normalizedSession) {
          clearPersistedSession();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to advance stage";
        setHelperState(message, "error");
      }
    },
    [display?.session, controlToken, setHelperState, clearPersistedSession]
  );

  const autoLiveTriggered = useRef(false);
  useEffect(() => {
    if (!display?.session || !controlToken) {
      autoLiveTriggered.current = false;
      return;
    }
    if (display.session.status !== "COUNTDOWN") {
      autoLiveTriggered.current = false;
      return;
    }
    if (countdownRemaining > 1000) {
      return;
    }
    if (autoLiveTriggered.current) {
      return;
    }
    autoLiveTriggered.current = true;
    void advanceStage("LIVE").catch(() => {
      autoLiveTriggered.current = false;
    });
  }, [display?.session, controlToken, countdownRemaining, advanceStage]);

  const autoLiveWrapRef = useRef(false);
  useEffect(() => {
    if (!display?.session || !controlToken) {
      autoLiveWrapRef.current = false;
      return;
    }
    if (display.session.status !== "LIVE") {
      autoLiveWrapRef.current = false;
      return;
    }
    if (liveRemaining > 0) {
      return;
    }
    if (autoLiveWrapRef.current) {
      return;
    }
    autoLiveWrapRef.current = true;
    const nextStage: SerializedKioskSession["status"] = display.session.reveal ? "REVEAL" : "CANCELLED";
    void advanceStage(nextStage).catch(() => {
      autoLiveWrapRef.current = false;
    });
  }, [display?.session, controlToken, liveRemaining, advanceStage]);

  const autoRevealWrapRef = useRef(false);
  useEffect(() => {
    if (!display?.session || !controlToken) {
      autoRevealWrapRef.current = false;
      return;
    }
    if (display.session.status !== "REVEAL") {
      autoRevealWrapRef.current = false;
      return;
    }
    if (revealRemaining > 0) {
      return;
    }
    if (autoRevealWrapRef.current) {
      return;
    }
    autoRevealWrapRef.current = true;
    void advanceStage("COMPLETE").catch(() => {
      autoRevealWrapRef.current = false;
    });
  }, [display?.session, controlToken, revealRemaining, advanceStage]);

  const sessionStage: Stage = useMemo(() => {
    if (!display?.session) {
      return "STANDBY";
    }
    switch (display.session.status) {
      case "COUNTDOWN":
      case "LIVE":
      case "REVEAL":
        return display.session.status;
      default:
        return "STANDBY";
    }
  }, [display?.session]);

  useEffect(() => {
    if (!obsAutomationEnabled || typeof window === "undefined") {
      return;
    }
    let cancelled = false;
    const applyStage = async () => {
      try {
        switch (sessionStage) {
          case "STANDBY":
            await stopObsStream();
            await setObsScene(OBS_SCENE_ATTRACT);
            break;
          case "COUNTDOWN":
            await setObsScene(OBS_SCENE_COUNTDOWN);
            await startObsStream();
            break;
          case "LIVE":
            await setObsScene(OBS_SCENE_LIVE);
            await startObsStream();
            break;
          case "REVEAL":
            await setObsScene(OBS_SCENE_REVEAL);
            break;
          default:
            break;
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "OBS stage error";
          setHelperState(message, "error");
        }
      }
    };
    void applyStage();
    return () => {
      cancelled = true;
    };
  }, [sessionStage, obsAutomationEnabled, setObsScene, startObsStream, stopObsStream, setHelperState]);

  const helperThemes: Record<HelperIntent, string> = {
    info: "border-white/15 bg-white/5 text-white",
    success: "border-emerald-400/30 bg-emerald-500/10 text-emerald-50",
    error: "border-rose-500/30 bg-rose-500/10 text-rose-50",
  };

  const helperStatus = sessionInactive ? "IDLE" : display?.session?.status ?? "ACTIVE";
  const helperHeadline = helperMessage
    ? helperMessage
    : sessionInactive
      ? "Scan a pack QR to start the countdown"
      : display?.session?.status === "LIVE"
        ? "Stream is live – scan the card to reveal"
        : display?.session?.status === "REVEAL"
          ? "Hit revealed – resetting soon"
          : "Countdown armed – keep the pack on camera";
  const helperSubline = sessionInactive
    ? "Scanner input is captured on this display—no need for a second screen."
    : controlToken
      ? "This display holds the control token; card scans here reveal instantly."
      : "Start the next pack from this display to control reveals locally.";
  const helperPackLabel = activePackCode ?? session?.packQrCode?.serial ?? session?.packQrCode?.code ?? null;

  useEffect(() => {
    return () => {
      if (obsAutomationEnabled && obsClientRef.current) {
        try {
          obsClientRef.current.disconnect();
        } catch (error) {
          // ignore
        }
      }
    };
  }, [obsAutomationEnabled]);

  const renderCountdown = () => (
    <div className="flex flex-col items-center gap-6 text-center">
      <p className="text-sm uppercase tracking-[0.4em] text-slate-300">Countdown</p>
      <p className="font-heading text-[clamp(4rem,12vw,12rem)] tracking-[0.08em] text-white">
        {formatDuration(countdownRemaining)}
      </p>
      <p className="max-w-2xl text-lg text-slate-300">
        When the timer hits zero the stream is live. Keep the pack centered on camera and get ready to rip.
      </p>
    </div>
  );

  const renderLive = () => (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex items-center gap-3 text-rose-300">
        <span className="h-3 w-3 animate-pulse rounded-full bg-rose-500" />
        <p className="text-sm uppercase tracking-[0.45em]">Live</p>
      </div>
      <p className="font-heading text-[clamp(3.5rem,10vw,10rem)] tracking-[0.08em] text-white">
        {formatDuration(liveRemaining)}
      </p>
      <p className="max-w-2xl text-lg text-slate-200">
        The countdown is over—Ten Kings Live is airing. Show the cards, celebrate the hit, and keep energy high.
      </p>
    </div>
  );

  const renderReveal = () => (
    <div className="flex flex-col items-center gap-6 text-center">
      <p className="text-sm uppercase tracking-[0.45em] text-emerald-300">Highlighted Hit</p>
      <p className="font-heading text-[clamp(3rem,8vw,8rem)] tracking-[0.1em] text-emerald-100">
        {formatDuration(revealRemaining)}
      </p>
      <h2 className="font-heading text-[clamp(2.5rem,6vw,5rem)] uppercase tracking-[0.12em] text-white">
        {reveal?.name ?? "Vault Hit"}
      </h2>
      {reveal?.set ? <p className="text-lg text-slate-200">{reveal.set}</p> : null}
      {reveal?.imageUrl ? (
        <Image
          src={reveal.imageUrl}
          alt={reveal.name ?? "Reveal"}
          width={840}
          height={600}
          className="max-h-[420px] w-auto rounded-[3rem] border border-white/10 bg-night-900/80 p-6 shadow-card"
          sizes="(max-width: 768px) 80vw, 720px"
          priority
          unoptimized
        />
      ) : null}
    </div>
  );

  const renderStandby = () => (
    <div className="flex flex-col items-center gap-8 text-center">
      <p className="text-sm uppercase tracking-[0.4em] text-slate-300">Ten Kings Live</p>
      <h1 className="font-heading text-[clamp(2.5rem,6vw,5rem)] uppercase tracking-[0.16em] text-white">
        Scan a pack to start the show
      </h1>
      <p className="max-w-3xl text-lg text-slate-300">
        Waiting for the next rip at {display?.location.name ?? "this kiosk"}. Trigger a pack from the operator console or scan here and this screen jumps to the countdown automatically.
      </p>
      {ATTRACT_VIDEO_URL ? (
        <video
          className="mt-4 w-full max-w-4xl rounded-[3rem] border border-white/10 bg-black/40 shadow-card"
          autoPlay
          muted
          loop
          playsInline
        >
          <source src={ATTRACT_VIDEO_URL} />
        </video>
      ) : null}
    </div>
  );

  const renderStage = () => {
    if (!session) {
      return renderStandby();
    }
    switch (session.status) {
      case "COUNTDOWN":
        return renderCountdown();
      case "LIVE":
        return renderLive();
      case "REVEAL":
        return renderReveal();
      default:
        return renderStandby();
    }
  };

  const locationLabel = display?.location?.name ?? "Ten Kings Live";

  return (
    <div className="min-h-screen bg-night-950 text-white">
      <Head>
        <title>Ten Kings · Kiosk Display</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <form aria-hidden="true" className="sr-only" onSubmit={(event) => void handleScanSubmit(event)}>
          <input
            ref={scanInputRef}
            value={scanBuffer}
            onChange={handleScanChange}
            onBlur={() => scanInputRef.current?.focus()}
            id="kiosk-hidden-input"
            name="kioskHiddenInput"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="none"
          />
        </form>

        <div className="pointer-events-none">
          <div className={`rounded-3xl border px-6 py-5 shadow-2xl backdrop-blur ${helperThemes[helperIntent]}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 text-[0.65rem] uppercase tracking-[0.4em] text-white/70">
              <p>Kiosk Helper</p>
              <p>{helperStatus}</p>
            </div>
            <p className="mt-3 font-heading text-2xl tracking-[0.08em]">{helperHeadline}</p>
            <p className="mt-2 text-sm text-white/80">{helperSubline}</p>
            <div className="mt-4 flex flex-wrap gap-3 text-[0.65rem] uppercase tracking-[0.32em] text-white/70">
              {helperPackLabel ? <span className="rounded-full border border-white/20 px-3 py-1">{helperPackLabel}</span> : null}
              {display?.location?.slug ? <span className="rounded-full border border-white/20 px-3 py-1">/{display.location.slug}</span> : null}
              <span className="rounded-full border border-white/20 px-3 py-1">Scanner Ready</span>
            </div>
          </div>
        </div>

        <header className="flex flex-col gap-3 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Stage Display</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">{locationLabel}</h1>
          {session?.pack?.definition ? <p className="text-sm uppercase tracking-[0.28em] text-slate-300">{session.pack.definition.name}</p> : null}
          {session?.packQrCode ? <p className="text-xs font-mono uppercase tracking-[0.3em] text-slate-500">Pack {session.packQrCode.serial ?? session.packQrCode.code}</p> : null}
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {!error && lastUpdated ? (
            <p className="text-xs text-slate-500">Auto-updated at {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
          ) : null}
        </header>

        <section className="flex flex-1 items-center justify-center text-center">
          {loading ? <p className="text-slate-300">Loading display…</p> : renderStage()}
        </section>

        <footer className="pb-6 text-center text-xs uppercase tracking-[0.32em] text-slate-500">
          Display refreshes automatically every {Math.round(POLL_INTERVAL_MS / 1000)}s
        </footer>
      </main>
    </div>
  );
}
