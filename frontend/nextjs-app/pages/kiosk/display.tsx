import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Head from "next/head";
import Image from "next/image";
import { useRouter } from "next/router";
import type { SerializedKioskSession } from "../../lib/server/kioskSession";
import { normalizeQrInput } from "../../lib/qrInput";
import { useObsConnection } from "../../hooks/useObsConnection";

interface DisplayResponse {
  location: {
    id: string;
    name: string;
    slug: string;
  };
  session: SerializedKioskSession | null;
}

type HelperIntent = "info" | "success" | "error";

type RevealDetails = {
  name: string | null;
  set: string | null;
  number: string | null;
  imageUrl: string | null;
};

type ManualRevealState = { data: RevealDetails | null; expiresAt: number } | null;

type CachedSession = {
  sessionId: string;
  controlToken: string;
  packCode: string | null;
  savedAt: number;
};

const POLL_INTERVAL_MS = 4000;
const TIMER_TICK_MS = 1000;
const MANUAL_REVEAL_DURATION_MS = Number(process.env.NEXT_PUBLIC_MANUAL_REVEAL_MS ?? 10000);
const MANUAL_REVEAL_COOLDOWN_MS = Number(process.env.NEXT_PUBLIC_MANUAL_REVEAL_COOLDOWN_MS ?? 5000);
const ATTRACT_VIDEO_URL = process.env.NEXT_PUBLIC_KIOSK_ATTRACT_VIDEO_URL ?? "";
const KIOSK_SECRET_HEADER = "x-kiosk-secret";
const CONTROL_TOKEN_HEADER = "x-kiosk-token";
const kioskSecret = process.env.NEXT_PUBLIC_KIOSK_API_SECRET ?? "";
const OBS_WS_URL = process.env.NEXT_PUBLIC_OBS_WS_URL ?? "";
const OBS_WS_PASSWORD = process.env.NEXT_PUBLIC_OBS_WS_PASSWORD ?? "";
const OBS_SCENE_LIVE = process.env.NEXT_PUBLIC_OBS_SCENE_LIVE ?? "Live Rip";

const helperThemes: Record<HelperIntent, string> = {
  info: "border-white/10 bg-white/5 text-white",
  success: "border-emerald-400/40 bg-emerald-400/10 text-emerald-50",
  error: "border-rose-500/30 bg-rose-500/10 text-rose-50",
};

const formatDuration = (ms: number) => {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
};

const coerceString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const extractRevealDetails = (session: SerializedKioskSession | null): RevealDetails | null => {
  if (!session?.reveal || typeof session.reveal !== "object" || Array.isArray(session.reveal)) {
    return null;
  }
  const payload = session.reveal as Record<string, unknown>;
  const imageUrl = coerceString(payload.imageUrl) ?? coerceString(payload.thumbnailUrl);
  return {
    name: coerceString(payload.name),
    set: coerceString(payload.set),
    number: coerceString(payload.number),
    imageUrl,
  };
};

const getPackLabel = (session: SerializedKioskSession | null, fallback?: string | null) => {
  if (!session) {
    return fallback ?? null;
  }
  return session.packQrCode?.serial ?? session.packQrCode?.code ?? session.code ?? fallback ?? null;
};

const buildFallbackLocation = (
  location: DisplayResponse["location"] | undefined | null,
  slug?: string,
  locationId?: string
): DisplayResponse["location"] => {
  if (location) {
    return location;
  }
  return {
    id: locationId ?? slug ?? "unknown",
    name: slug ?? "Ten Kings Live",
    slug: slug ?? "live",
  };
};

export default function KioskDisplayPage() {
  const router = useRouter();
  const slugParam = router.query.slug ?? router.query.location;
  const locationIdParam = router.query.locationId;
  const slug = typeof slugParam === "string" ? slugParam : Array.isArray(slugParam) ? slugParam[0] : undefined;
  const locationId =
    typeof locationIdParam === "string"
      ? locationIdParam
      : Array.isArray(locationIdParam)
        ? locationIdParam[0]
        : undefined;

  const [display, setDisplay] = useState<DisplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [helperMessage, setHelperMessage] = useState<string | null>(null);
  const [helperIntent, setHelperIntent] = useState<HelperIntent>("info");
  const [controlToken, setControlToken] = useState<string | null>(null);
  const [scanBuffer, setScanBuffer] = useState("");
  const [activePackCode, setActivePackCode] = useState<string | null>(null);
  const [manualReveal, setManualReveal] = useState<ManualRevealState>(null);

  const session = display?.session ?? null;
  const reveal = useMemo(() => extractRevealDetails(session), [session]);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const manualRevealCooldownRef = useRef(0);

  const {
    enabled: obsEnabled,
    status: obsStatus,
    lastError: obsLastError,
    startStreaming,
    stopStreaming,
  } = useObsConnection({
    url: OBS_WS_URL,
    password: OBS_WS_PASSWORD,
    sceneName: OBS_SCENE_LIVE,
  });

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
    const timer = window.setInterval(() => setNow(Date.now()), TIMER_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!manualReveal) {
      return;
    }
    if (manualReveal.expiresAt <= Date.now()) {
      setManualReveal(null);
      return;
    }
    const timeoutId = window.setTimeout(() => setManualReveal(null), manualReveal.expiresAt - Date.now());
    return () => window.clearTimeout(timeoutId);
  }, [manualReveal]);

  useEffect(() => {
    const focusTimer = window.setInterval(() => {
      scanInputRef.current?.focus();
    }, 1500);
    return () => window.clearInterval(focusTimer);
  }, []);

  useEffect(() => {
    if (router.isReady) {
      scanInputRef.current?.focus();
    }
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

  const setHelperState = useCallback((message: string, intent: HelperIntent = "info") => {
    setHelperIntent(intent);
    setHelperMessage(message);
    window.setTimeout(() => {
      setHelperMessage((current) => (current === message ? null : current));
    }, 4000);
  }, []);

  const persistSession = useCallback(
    (sessionId: string, token: string, packCode: string | null) => {
      if (!storageKey) {
        return;
      }
      try {
        const payload: CachedSession = { sessionId, controlToken: token, packCode, savedAt: Date.now() };
        window.localStorage.setItem(storageKey, JSON.stringify(payload));
        setActivePackCode(packCode);
      } catch (error) {
        console.warn("[kiosk-display] failed to persist session", error);
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
    } catch (error) {
      console.warn("[kiosk-display] failed to clear persisted session", error);
    }
    setControlToken(null);
    setActivePackCode(null);
  }, [storageKey]);

  useEffect(() => {
    if (!router.isReady) {
      return;
    }
    if (!locationId && !slug) {
      setError("Add ?locationId=… or ?slug=… to target a kiosk location.");
      setLoading(false);
      return;
    }

    let isMounted = true;

    const fetchDisplay = async () => {
      if (!isMounted) {
        return;
      }
      try {
        const params = new URLSearchParams();
        if (locationId) {
          params.set("locationId", locationId);
        } else if (slug) {
          params.set("slug", slug);
        }
        const response = await fetch(`/api/kiosk/display?${params.toString()}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as Partial<DisplayResponse> & { message?: string };
        if (!response.ok || !payload.location) {
          throw new Error(payload?.message ?? "Failed to load kiosk display");
        }
        if (!isMounted) {
          return;
        }
        setDisplay(payload as DisplayResponse);
        if (payload.session) {
          setActivePackCode(getPackLabel(payload.session));
        } else {
          clearPersistedSession();
        }
        setError(null);
        setLastUpdated(Date.now());
      } catch (err) {
        if (!isMounted) {
          return;
        }
        const message = err instanceof Error ? err.message : "Unable to reach kiosk display";
        setError(message);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void fetchDisplay();
    const pollTimer = window.setInterval(() => {
      void fetchDisplay();
    }, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(pollTimer);
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
      const cached = JSON.parse(raw) as CachedSession;
      if (!cached?.sessionId || !cached.controlToken) {
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
          setDisplay((current) =>
            current
              ? { ...current, session: payload.session }
              : { location: buildFallbackLocation(display?.location, slug, locationId), session: payload.session }
          );
          setActivePackCode(getPackLabel(payload.session, cached.packCode ?? null));
          setHelperState("Restored active session after restart.");
        } catch (err) {
          console.warn("[kiosk-display] failed to restore cached session", err);
          clearPersistedSession();
        }
      })();
    } catch (error) {
      console.warn("[kiosk-display] failed to parse cached session", error);
    }
  }, [router.isReady, storageKey, display?.location, slug, locationId, clearPersistedSession, setHelperState]);

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
        setHelperState(`Starting session for ${code}…`);
        const response = await fetch("/api/kiosk/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [KIOSK_SECRET_HEADER]: kioskSecret,
          },
          body: JSON.stringify({ packCode: code, locationId: display.location.id }),
        });
        const payload = (await response.json().catch(() => null)) as {
          session: SerializedKioskSession;
          controlToken: string;
          message?: string;
        } | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.message ?? "Failed to start session");
        }
        setControlToken(payload.controlToken);
        setDisplay((current) => (current ? { ...current, session: payload.session } : current));
        const packLabel = getPackLabel(payload.session, code) ?? code;
        setActivePackCode(packLabel);
        persistSession(payload.session.id, payload.controlToken, packLabel);
        if (obsEnabled) {
          void startStreaming().catch((error) => {
            const message = error instanceof Error ? error.message : "Unable to start OBS stream";
            console.error("[kiosk-display] OBS start failed", error);
            setHelperState(message, "error");
          });
        }
        setHelperState(`Session ${payload.session.code} ready.`, "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to start session";
        setHelperState(message, "error");
      }
    },
    [display?.location, obsEnabled, persistSession, setHelperState, startStreaming]
  );

  const handleManualCardReveal = useCallback(
    async (code: string) => {
      if (Date.now() < manualRevealCooldownRef.current) {
        setHelperState("Please wait before scanning another card.", "error");
        return;
      }
      try {
        setHelperState("Revealing card…");
        const response = await fetch("/api/kiosk/reveal-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const payload = (await response.json().catch(() => null)) as {
          reveal?: { name?: string | null; set?: string | null; number?: string | null; imageUrl?: string | null; thumbnailUrl?: string | null };
          message?: string;
        } | null;
        if (!response.ok || !payload?.reveal) {
          throw new Error(payload?.message ?? "Unable to reveal card");
        }
        const revealData: RevealDetails = {
          name: coerceString(payload.reveal.name),
          set: coerceString(payload.reveal.set),
          number: coerceString(payload.reveal.number),
          imageUrl: coerceString(payload.reveal.imageUrl) ?? coerceString(payload.reveal.thumbnailUrl),
        };
        setManualReveal({ data: revealData, expiresAt: Date.now() + MANUAL_REVEAL_DURATION_MS });
        manualRevealCooldownRef.current = Date.now() + MANUAL_REVEAL_COOLDOWN_MS;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to reveal card";
        setHelperState(message, "error");
      }
    },
    [setHelperState]
  );

  const handleCardScan = useCallback(
    async (code: string) => {
      if (!display?.session) {
        await handleManualCardReveal(code);
        return;
      }
      if (!controlToken) {
        setHelperState("Control token missing; start session from this screen.", "error");
        return;
      }
      try {
        setHelperState("Checking card…");
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

        setHelperState("Revealing card…");
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
        setDisplay((current) => (current ? { ...current, session: payload.session } : current));
        setActivePackCode(getPackLabel(payload.session, activePackCode));
        const friendlyName = lookupPayload.card?.item?.name;
        setHelperState(friendlyName ? `Revealed ${friendlyName}.` : "Card revealed.", "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to reveal card";
        setHelperState(message, "error");
      }
    },
    [display?.session, controlToken, setHelperState, activePackCode, handleManualCardReveal]
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

  const advanceStage = useCallback(
    async (nextStage: SerializedKioskSession["status"], options?: { silent?: boolean }) => {
      if (!display?.session) {
        return;
      }
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (controlToken) {
        headers[CONTROL_TOKEN_HEADER] = controlToken;
      } else if (kioskSecret) {
        headers[KIOSK_SECRET_HEADER] = kioskSecret;
      } else {
        if (!options?.silent) {
          setHelperState("Control token missing; start session from this screen.", "error");
        }
        return;
      }
      try {
        const response = await fetch(`/api/kiosk/${display.session.id}/stage`, {
          method: "POST",
          headers,
          body: JSON.stringify({ stage: nextStage }),
        });
        const payload = (await response.json().catch(() => null)) as { session?: SerializedKioskSession; message?: string } | null;
        if (!response.ok || !payload?.session) {
          throw new Error(payload?.message ?? "Unable to advance stage");
        }
        const nextSession = payload.session;
        const normalizedSession =
          nextSession && (nextSession.status === "COMPLETE" || nextSession.status === "CANCELLED") ? null : nextSession;
        setDisplay((current) => (current ? { ...current, session: normalizedSession } : current));
        if (!normalizedSession) {
          clearPersistedSession();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to advance stage";
        if (!options?.silent) {
          setHelperState(message, "error");
        }
      }
    },
    [display?.session, controlToken, clearPersistedSession, setHelperState]
  );

  const autoLiveTriggered = useRef(false);
  useEffect(() => {
    if (!display?.session) {
      autoLiveTriggered.current = false;
      return;
    }
    if (display.session.status !== "COUNTDOWN" || countdownRemaining > 1000) {
      return;
    }
    if (autoLiveTriggered.current) {
      return;
    }
    autoLiveTriggered.current = true;
    void advanceStage("LIVE", { silent: true }).catch(() => {
      autoLiveTriggered.current = false;
    });
  }, [display?.session, countdownRemaining, advanceStage]);

  const autoLiveWrapRef = useRef(false);
  useEffect(() => {
    if (!display?.session) {
      autoLiveWrapRef.current = false;
      return;
    }
    if (display.session.status !== "LIVE" || liveRemaining > 0) {
      return;
    }
    if (autoLiveWrapRef.current) {
      return;
    }
    autoLiveWrapRef.current = true;
    const nextStage: SerializedKioskSession["status"] = display.session.reveal ? "REVEAL" : "CANCELLED";
    void advanceStage(nextStage, { silent: true }).catch(() => {
      autoLiveWrapRef.current = false;
    });
  }, [display?.session, liveRemaining, advanceStage]);

  const autoRevealWrapRef = useRef(false);
  useEffect(() => {
    if (!display?.session) {
      autoRevealWrapRef.current = false;
      return;
    }
    if (display.session.status !== "REVEAL" || revealRemaining > 0) {
      return;
    }
    if (autoRevealWrapRef.current) {
      return;
    }
    autoRevealWrapRef.current = true;
    void advanceStage("COMPLETE", { silent: true }).catch(() => {
      autoRevealWrapRef.current = false;
    });
  }, [display?.session, revealRemaining, advanceStage]);

  useEffect(() => {
    if (!obsEnabled) {
      return;
    }
    const activeStages: SerializedKioskSession["status"][] = ["COUNTDOWN", "LIVE", "REVEAL"];
    if (session && activeStages.includes(session.status)) {
      void startStreaming().catch((error) => {
        const message = error instanceof Error ? error.message : "OBS start error";
        console.error("[kiosk-display] OBS start error", error);
        setHelperState(message, "error");
      });
      return;
    }
    void stopStreaming().catch((error) => {
      const message = error instanceof Error ? error.message : "OBS stop error";
      console.warn("[kiosk-display] OBS stop error", error);
      setHelperState(message, "error");
    });
  }, [session, obsEnabled, startStreaming, stopStreaming, setHelperState]);

  const helperStatus = manualReveal ? "REVEAL" : !session ? "IDLE" : session.status;
  const helperHeadline = helperMessage
    ? helperMessage
    : manualReveal
      ? "Card reveal in progress"
      : !session
        ? "Scan a pack QR to start the countdown"
        : session.status === "LIVE"
          ? "Stream is live – scan the card to reveal"
          : session.status === "REVEAL"
            ? "Hit revealed – resetting soon"
            : "Countdown armed – keep the pack on camera";
  const helperSubline = manualReveal
    ? "Standalone reveal will wrap automatically."
    : !session
      ? "Scan the pack label or start a session from the admin panel."
      : session.status === "LIVE"
        ? "Timer hits zero when the live window closes."
        : session.status === "REVEAL"
          ? "Once the timer ends this session completes automatically."
          : "Keep the pack on camera until the countdown ends.";
  const helperPackLabel = session ? getPackLabel(session, activePackCode) : activePackCode;
  const obsStatusLabel = !obsEnabled
    ? null
    : obsStatus === "error"
      ? "OBS ERROR"
      : obsStatus === "streaming"
        ? "OBS STREAMING"
        : obsStatus === "connected"
          ? "OBS READY"
          : obsStatus === "connecting"
            ? "OBS CONNECTING"
            : obsStatus === "disconnected"
              ? "OBS DISCONNECTED"
              : "OBS DISABLED";

  const renderCountdown = () => (
    <div className="flex flex-col items-center gap-6 text-center">
      <p className="text-sm uppercase tracking-[0.4em] text-slate-300">Countdown</p>
      <p className="font-heading text-[clamp(4rem,12vw,12rem)] tracking-[0.08em] text-white">{formatDuration(countdownRemaining)}</p>
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
      <p className="font-heading text-[clamp(3.5rem,10vw,10rem)] tracking-[0.08em] text-white">{formatDuration(liveRemaining)}</p>
      <p className="max-w-2xl text-lg text-slate-200">
        The countdown is over—Ten Kings Live is airing. Show the cards, celebrate the hit, and keep energy high.
      </p>
    </div>
  );

  const renderReveal = (payload: RevealDetails | null, remainingMs: number) => (
    <div className="flex flex-col items-center gap-6 text-center">
      <p className="text-sm uppercase tracking-[0.45em] text-emerald-300">Highlighted Hit</p>
      <p className="font-heading text-[clamp(3rem,8vw,8rem)] tracking-[0.1em] text-emerald-100">
        {formatDuration(Math.max(0, remainingMs))}
      </p>
      <h2 className="font-heading text-[clamp(2.5rem,6vw,5rem)] uppercase tracking-[0.12em] text-white">{payload?.name ?? "Vault Hit"}</h2>
      {payload?.set ? <p className="text-lg text-slate-200">{payload.set}</p> : null}
      {payload?.imageUrl ? (
        <Image
          src={payload.imageUrl}
          alt={payload.name ?? "Reveal"}
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
      <h1 className="font-heading text-[clamp(2.5rem,6vw,5rem)] uppercase tracking-[0.16em] text-white">Scan a pack to start the show</h1>
      <p className="max-w-3xl text-lg text-slate-300">
        Waiting for the next rip at {display?.location.name ?? "this kiosk"}. Trigger a pack from the operator console or scan here and this
        screen jumps to the countdown automatically.
      </p>
      {ATTRACT_VIDEO_URL ? (
        <video className="mt-4 w-full max-w-4xl rounded-[3rem] border border-white/10 bg-black/40 shadow-card" autoPlay muted loop playsInline>
          <source src={ATTRACT_VIDEO_URL} />
        </video>
      ) : null}
    </div>
  );

  const renderStage = () => {
    if (manualReveal) {
      return renderReveal(manualReveal.data, manualReveal.expiresAt - now);
    }
    if (!session) {
      return renderStandby();
    }
    switch (session.status) {
      case "COUNTDOWN":
        return renderCountdown();
      case "LIVE":
        return renderLive();
      case "REVEAL":
        return renderReveal(reveal, revealRemaining);
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
              {obsStatusLabel ? <span className="rounded-full border border-white/20 px-3 py-1">{obsStatusLabel}</span> : null}
              <span className="rounded-full border border-white/20 px-3 py-1">Scanner Ready</span>
            </div>
            {obsStatus === "error" && obsLastError ? <p className="mt-2 text-xs text-rose-200">OBS error: {obsLastError}</p> : null}
          </div>
        </div>

        <header className="flex flex-col gap-3 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Stage Display</p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white">{locationLabel}</h1>
          {session?.pack?.definition ? <p className="text-sm uppercase tracking-[0.28em] text-slate-300">{session.pack.definition.name}</p> : null}
          {session?.packQrCode ? <p className="text-xs font-mono uppercase tracking-[0.3em] text-slate-500">Pack {session.packQrCode.serial ?? session.packQrCode.code}</p> : null}
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          {!error && lastUpdated ? (
            <p className="text-xs text-slate-500">
              Auto-updated at {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          ) : null}
        </header>

        <section className="flex flex-1 items-center justify-center text-center">{loading ? <p className="text-slate-300">Loading display…</p> : renderStage()}</section>

        <footer className="pb-6 text-center text-xs uppercase tracking-[0.32em] text-slate-500">
          Display refreshes automatically every {Math.round(POLL_INTERVAL_MS / 1000)}s
        </footer>
      </main>
    </div>
  );
}
