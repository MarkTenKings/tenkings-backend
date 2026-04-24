import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import confetti from "canvas-confetti";
import { BrowserRipClient, type RipError } from "@tenkings/browser-rip-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../../components/AppShell";
import { useSession } from "../../../hooks/useSession";
import {
  GOLDEN_TICKET_CONSENT_TEXT,
  GOLDEN_TICKET_CONSENT_TEXT_VERSION,
  GOLDEN_TICKET_COUNTDOWN_SECONDS,
  GOLDEN_TICKET_LIVE_SECONDS,
  GOLDEN_TICKET_MIN_AGE,
} from "../../../lib/goldenConsent";
import type { SerializedKioskSession } from "../../../lib/server/kioskSession";

type ClaimPhase =
  | "landing"
  | "auth"
  | "claimed"
  | "underage"
  | "consent"
  | "permissions-recovery"
  | "countdown"
  | "reveal"
  | "claim-form"
  | "confirmation"
  | "error";

type ViewerSummary = {
  id: string;
  phone: string | null;
  email: string | null;
  displayName: string | null;
  dateOfBirth: string | null;
};

type TicketRecord = {
  id: string;
  ticketNumber: number;
  code: string;
  status: "MINTED" | "PLACED" | "SCANNED" | "CLAIMED" | "FULFILLED" | "EXPIRED";
  revealVideoAssetUrl: string | null;
  revealVideoPoster: string | null;
  scannedByUserId: string | null;
  claimedAt: string | null;
  claimUrl: string;
  winnerProfileUrl: string;
  shareCardUrl: string;
  prize: {
    itemId: string;
    name: string;
    description: string | null;
    category: string | null;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    estimatedValue: number | null;
    requiresSize: boolean;
    sizeOptions: string[];
  };
  sourceLocation: {
    id: string;
    name: string;
    slug: string;
  } | null;
  winnerProfile: {
    displayName: string;
    displayHandle: string | null;
    caption: string | null;
    publishedAt: string;
  } | null;
  liveRip: {
    slug: string;
    title: string;
    videoUrl: string;
    thumbnailUrl: string | null;
    muxPlaybackId: string | null;
  } | null;
};

type TicketLookupResponse = {
  ticket: TicketRecord;
  viewer: ViewerSummary | null;
};

type LocationOption = {
  id: string;
  name: string;
  slug: string;
};

type BrowserStartResponse = {
  session?: SerializedKioskSession;
  controlToken?: string;
  error?: string;
  message?: string;
  retryAfterSeconds?: number;
};

type WhipResponse = {
  whipUrl?: string;
  whipUploadUrl?: string;
  streamKey?: string;
  playbackId?: string | null;
  playbackUrl?: string | null;
  message?: string;
};

type ClaimResult = {
  success: true;
  ticketNumber: number;
  winnerProfileUrl: string;
  shareCardUrl: string;
};

type PendingBrowserStart = {
  sessionId: string;
  controlToken: string;
  whipUploadUrl: string;
  countdownSeconds: number;
  liveSeconds: number;
  countdownEndsAt: string;
};

type ClaimFormState = {
  fullName: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
  sourceLocationId: string;
  size: string;
  socialHandle: string;
};

type ReactionUploadState = {
  status: "idle" | "uploading" | "uploaded" | "error";
  message: string | null;
  url: string | null;
};

const DEFAULT_FORM: ClaimFormState = {
  fullName: "",
  street1: "",
  street2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
  phone: "",
  email: "",
  sourceLocationId: "",
  size: "",
  socialHandle: "",
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function isOldEnough(value: string | null) {
  if (!value) {
    return false;
  }
  const date = value.includes("T") ? new Date(value) : parseDateOnly(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  let age = new Date().getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = new Date().getUTCMonth() - date.getUTCMonth();
  const dayDiff = new Date().getUTCDate() - date.getUTCDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }
  return age >= GOLDEN_TICKET_MIN_AGE;
}

function formatCurrency(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}

function joinPath(origin: string, path: string) {
  return new URL(path, origin).toString();
}

function buildWhipUploadUrl(payload: WhipResponse) {
  if (payload.whipUploadUrl) {
    return payload.whipUploadUrl;
  }
  if (!payload.whipUrl || !payload.streamKey) {
    throw new Error("WHIP publish URL is incomplete");
  }
  return `${payload.whipUrl.replace(/\/$/, "")}/${encodeURIComponent(payload.streamKey)}`;
}

function ScreenShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-5xl items-center px-4 py-10 sm:px-6">
      <div className="w-full rounded-[2rem] border border-white/10 bg-black/40 p-6 shadow-2xl backdrop-blur sm:p-8">
        <p className="text-xs uppercase tracking-[0.38em] text-gold-300">{eyebrow}</p>
        <h1 className="mt-4 font-heading text-3xl uppercase tracking-[0.14em] text-white sm:text-4xl">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm text-slate-200">
      <span>{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30";

export default function GoldenClaimPage() {
  const router = useRouter();
  const { code } = router.query;
  const { session, loading: sessionLoading, ensureSession, updateProfile } = useSession();

  const [phase, setPhase] = useState<ClaimPhase>("landing");
  const [ticket, setTicket] = useState<TicketRecord | null>(null);
  const [viewer, setViewer] = useState<ViewerSummary | null>(null);
  const [ticketLoading, setTicketLoading] = useState(true);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [dobInput, setDobInput] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [countdownValue, setCountdownValue] = useState(GOLDEN_TICKET_COUNTDOWN_SECONDS);
  const [pendingStart, setPendingStart] = useState<PendingBrowserStart | null>(null);
  const [claimForm, setClaimForm] = useState<ClaimFormState>(DEFAULT_FORM);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const [reactionUpload, setReactionUpload] = useState<ReactionUploadState>({
    status: "idle",
    message: null,
    url: null,
  });
  const [helpOpen, setHelpOpen] = useState(false);

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const compositeRef = useRef<HTMLCanvasElement | null>(null);
  const revealVideoRef = useRef<HTMLVideoElement | null>(null);
  const clientRef = useRef<BrowserRipClient | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const bootingFlowRef = useRef(false);
  const formInitializedRef = useRef(false);
  const activeSessionRef = useRef<PendingBrowserStart | null>(null);

  const publicWinnerUrl = useMemo(() => {
    if (!ticket || typeof window === "undefined") {
      return null;
    }
    return joinPath(window.location.origin, claimResult?.winnerProfileUrl ?? ticket.winnerProfileUrl);
  }, [claimResult?.winnerProfileUrl, ticket]);

  const loadTicket = useCallback(
    async (authToken?: string | null) => {
      if (typeof code !== "string") {
        return;
      }

      setTicketLoading(true);
      setTicketError(null);

      try {
        const response = await fetch(`/api/golden/ticket/${encodeURIComponent(code)}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        });
        const payload = (await response.json().catch(() => ({}))) as TicketLookupResponse & { message?: string };
        if (response.status === 404) {
          await router.replace("/golden/invalid");
          return;
        }
        if (!response.ok || !payload.ticket) {
          throw new Error(payload.message ?? "Failed to load Golden Ticket");
        }
        setTicket(payload.ticket);
        setViewer(payload.viewer ?? null);
      } catch (error) {
        setTicketError(error instanceof Error ? error.message : "Failed to load Golden Ticket");
        setTicket(null);
        setViewer(null);
      } finally {
        setTicketLoading(false);
      }
    },
    [code, router]
  );

  useEffect(() => {
    void loadTicket(session?.token ?? null);
  }, [loadTicket, session?.token]);

  useEffect(() => {
    let cancelled = false;
    setLocationsLoading(true);
    fetch("/api/locations")
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          locations?: Array<{ id: string; name: string; slug: string }>;
        };
        if (!response.ok || !payload.locations) {
          throw new Error("Failed to load locations");
        }
        return payload.locations;
      })
      .then((items) => {
        if (!cancelled) {
          setLocations(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocations([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLocationsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ticket || sessionLoading) {
      return;
    }

    if (["countdown", "reveal", "claim-form", "confirmation"].includes(phase)) {
      return;
    }

    if (ticket.status === "CLAIMED") {
      if (viewer?.id && ticket.scannedByUserId === viewer.id) {
        setClaimResult({
          success: true,
          ticketNumber: ticket.ticketNumber,
          winnerProfileUrl: ticket.winnerProfileUrl,
          shareCardUrl: ticket.shareCardUrl,
        });
        setPhase("confirmation");
        return;
      }

      if (viewer?.id && ticket.scannedByUserId !== viewer.id) {
        if (ticket.winnerProfile) {
          void router.replace(ticket.winnerProfileUrl);
          return;
        }

        setPhase("claimed");
        return;
      }

      setPhase("claimed");
      return;
    }

    if (!viewer) {
      setPhase("auth");
      return;
    }

    if (viewer.dateOfBirth) {
      if (!isOldEnough(viewer.dateOfBirth)) {
        setPhase("underage");
        return;
      }
      setPhase("consent");
      return;
    }

    setPhase("auth");
  }, [phase, router, sessionLoading, ticket, viewer]);

  useEffect(() => {
    if (!viewer || formInitializedRef.current) {
      return;
    }

    formInitializedRef.current = true;
    setClaimForm((current) => ({
      ...current,
      fullName: viewer.displayName ?? current.fullName,
      phone: viewer.phone ?? current.phone,
      email: viewer.email ?? current.email,
    }));
  }, [viewer]);

  useEffect(() => {
    const sourceLocationId = ticket?.sourceLocation?.id;
    if (!sourceLocationId) {
      return;
    }

    setClaimForm((current) =>
      current.sourceLocationId === sourceLocationId
        ? current
        : {
            ...current,
            sourceLocationId,
          }
    );
  }, [ticket?.sourceLocation?.id]);

  const getAudioContext = useCallback(async () => {
    if (typeof window === "undefined") {
      return null;
    }
    if (!audioContextRef.current) {
      audioContextRef.current = new window.AudioContext();
    }
    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const playTone = useCallback(
    async (frequency: number, durationMs: number, bend = false) => {
      const context = await getAudioContext();
      if (!context) {
        return;
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      if (bend) {
        oscillator.frequency.linearRampToValueAtTime(frequency * 1.2, context.currentTime + durationMs / 1000);
      }
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + durationMs / 1000);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + durationMs / 1000 + 0.02);
    },
    [getAudioContext]
  );

  const cancelCanvasLoop = useCallback(() => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const drawCanvasFrame = useCallback(() => {
    const canvas = compositeRef.current;
    const preview = previewRef.current;
    const reveal = revealVideoRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#050505";
    context.fillRect(0, 0, width, height);

    const drawLiveBadge = () => {
      context.fillStyle = "rgba(0,0,0,0.58)";
      context.beginPath();
      context.roundRect(width - 230, 34, 176, 54, 18);
      context.fill();
      context.fillStyle = "#b91c1c";
      context.beginPath();
      context.arc(width - 194, 61, 10, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "700 24px Arial";
      context.fillText("LIVE", width - 170, 69);
    };

    const drawTitleBar = () => {
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#8B6A18");
      gradient.addColorStop(0.5, "#D4AF37");
      gradient.addColorStop(1, "#F4DE9A");
      context.fillStyle = "rgba(0,0,0,0.38)";
      context.beginPath();
      context.roundRect(40, 32, width - 80, 86, 28);
      context.fill();
      context.fillStyle = gradient;
      context.font = "700 48px Times New Roman";
      context.textAlign = "center";
      context.fillText("TEN KINGS GOLDEN TICKET REVEAL", width / 2, 88);
      context.textAlign = "left";
    };

    if (phase === "reveal" && reveal && reveal.readyState >= 2) {
      context.drawImage(reveal, 0, 0, width, height);
      if (preview && preview.readyState >= 2) {
        const pipWidth = 320;
        const pipHeight = 180;
        const pipX = width - pipWidth - 48;
        const pipY = height - pipHeight - 48;
        context.save();
        context.beginPath();
        context.roundRect(pipX, pipY, pipWidth, pipHeight, 28);
        context.clip();
        context.drawImage(preview, pipX, pipY, pipWidth, pipHeight);
        context.restore();
        context.lineWidth = 6;
        context.strokeStyle = "#D4AF37";
        context.beginPath();
        context.roundRect(pipX, pipY, pipWidth, pipHeight, 28);
        context.stroke();
      }
      drawTitleBar();
      drawLiveBadge();
      context.fillStyle = "rgba(0,0,0,0.5)";
      context.beginPath();
      context.roundRect(44, height - 92, 230, 44, 16);
      context.fill();
      context.fillStyle = "#ffffff";
      context.font = "700 22px Arial";
      context.fillText("RECORDING", 78, height - 61);
      context.fillStyle = "#dc2626";
      context.beginPath();
      context.arc(60, height - 68, 9, 0, Math.PI * 2);
      context.fill();
    } else {
      if (preview && preview.readyState >= 2) {
        context.drawImage(preview, 0, 0, width, height);
      }
      context.fillStyle = "rgba(0,0,0,0.25)";
      context.fillRect(0, 0, width, height);
      drawTitleBar();
      drawLiveBadge();

      context.textAlign = "center";
      context.shadowColor = "rgba(0,0,0,0.8)";
      context.shadowBlur = 40;
      context.fillStyle = "#D4AF37";
      context.font = "700 280px Times New Roman";
      context.fillText(String(countdownValue), width / 2, height / 2 + 92);
      context.shadowBlur = 0;
      context.textAlign = "left";
    }

    animationFrameRef.current = window.requestAnimationFrame(drawCanvasFrame);
  }, [countdownValue, phase]);

  useEffect(() => {
    cancelCanvasLoop();
    if (phase === "countdown" || phase === "reveal") {
      animationFrameRef.current = window.requestAnimationFrame(drawCanvasFrame);
    }
    return () => cancelCanvasLoop();
  }, [cancelCanvasLoop, drawCanvasFrame, phase]);

  const uploadReactionBlob = useCallback(
    async (blob: Blob) => {
      const active = activeSessionRef.current;
      const authToken = session?.token;
      if (!active || !authToken) {
        return;
      }

      setReactionUpload({
        status: "uploading",
        message: "Uploading reaction clip...",
        url: null,
      });

      try {
        const params = new URLSearchParams({
          sessionId: active.sessionId,
          fileName: `golden-ticket-${ticket?.ticketNumber ?? "reaction"}.webm`,
          contentType: blob.type || "video/webm",
        });
        const response = await fetch(`/api/golden/reaction/upload?${params.toString()}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": blob.type || "video/webm",
          },
          body: blob,
        });

        const payload = (await response.json().catch(() => ({}))) as { url?: string; message?: string };
        if (!response.ok || !payload.url) {
          throw new Error(payload.message ?? "Reaction upload failed");
        }

        setReactionUpload({
          status: "uploaded",
          message: "Reaction clip saved.",
          url: payload.url,
        });
      } catch (error) {
        setReactionUpload({
          status: "error",
          message: error instanceof Error ? error.message : "Reaction upload failed",
          url: null,
        });
      }
    },
    [session?.token, ticket?.ticketNumber]
  );

  const cancelActiveSession = useCallback(async () => {
    const active = activeSessionRef.current;
    if (!active) {
      return;
    }

    try {
      await fetch(`/api/kiosk/${active.sessionId}`, {
        method: "DELETE",
        headers: {
          "x-kiosk-token": active.controlToken,
        },
      });
    } catch (error) {
      // Best effort cleanup only.
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelCanvasLoop();
      void clientRef.current?.stop().catch(() => undefined);
      if (!claimResult) {
        void cancelActiveSession();
      }
    };
  }, [cancelActiveSession, cancelCanvasLoop, claimResult]);

  const postStage = useCallback(async (stage: "LIVE" | "CANCELLED") => {
    const active = activeSessionRef.current;
    if (!active) {
      throw new Error("Reveal session not ready");
    }

    const response = await fetch(`/api/kiosk/${active.sessionId}/stage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kiosk-token": active.controlToken,
      },
      body: JSON.stringify({ stage }),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new Error(payload.message ?? `Failed to move reveal to ${stage}`);
    }
  }, []);

  const postReveal = useCallback(async (itemId: string) => {
    const active = activeSessionRef.current;
    if (!active) {
      throw new Error("Reveal session not ready");
    }

    const response = await fetch(`/api/kiosk/${active.sessionId}/reveal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kiosk-token": active.controlToken,
      },
      body: JSON.stringify({ itemId }),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new Error(payload.message ?? "Failed to finalize reveal");
    }
  }, []);

  const playRevealVideo = useCallback(async () => {
    const reveal = revealVideoRef.current;
    if (!reveal || !ticket?.revealVideoAssetUrl) {
      throw new Error("Reveal video is not available for this Golden Ticket");
    }

    reveal.currentTime = 0;
    await reveal.play();

    await new Promise<void>((resolve, reject) => {
      const handleEnded = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("Founder reveal video failed to play"));
      };
      const cleanup = () => {
        reveal.removeEventListener("ended", handleEnded);
        reveal.removeEventListener("error", handleError);
      };

      reveal.addEventListener("ended", handleEnded, { once: true });
      reveal.addEventListener("error", handleError, { once: true });
    });
  }, [ticket?.revealVideoAssetUrl]);

  useEffect(() => {
    if (phase !== "countdown" || !pendingStart || !ticket || !compositeRef.current || !previewRef.current || bootingFlowRef.current) {
      return;
    }

    const client = clientRef.current;
    if (!client) {
      return;
    }

    let cancelled = false;
    bootingFlowRef.current = true;
    activeSessionRef.current = pendingStart;
    client.attachPreview(previewRef.current);
    client.attachComposite(compositeRef.current);
    client.configure({
      sessionId: pendingStart.sessionId,
      whipUrl: pendingStart.whipUploadUrl,
      revealVideoUrl: ticket.revealVideoAssetUrl ?? "",
      countdownSeconds: pendingStart.countdownSeconds,
      liveSeconds: pendingStart.liveSeconds,
      overlayTitle: "TEN KINGS GOLDEN TICKET REVEAL",
    });

    const runFlow = async () => {
      try {
        setPhaseError(null);
        await client.start();

        const countdownEndsAtMs = new Date(pendingStart.countdownEndsAt).getTime();

        while (true) {
          if (cancelled) {
            return;
          }

          const remainingMs = countdownEndsAtMs - Date.now();
          const nextValue = Math.min(
            GOLDEN_TICKET_COUNTDOWN_SECONDS,
            Math.max(0, Math.ceil(remainingMs / 1000))
          );

          if (nextValue <= 0) {
            break;
          }

          setCountdownValue(nextValue);
          await playTone(440, 150);

          const waitUntilNextSecondMs = remainingMs - (nextValue - 1) * 1000;
          await wait(Math.max(40, waitUntilNextSecondMs));
        }

        if (cancelled) {
          return;
        }

        setCountdownValue(0);
        await playTone(880, 600, true);
        await postStage("LIVE");
        if (cancelled) {
          return;
        }

        setPhase("reveal");
        await playRevealVideo();
        if (cancelled) {
          return;
        }

        await postReveal(ticket.prize.itemId);
        await client.stop();
        if (cancelled) {
          return;
        }

        setPhase("claim-form");
      } catch (error) {
        if (!cancelled) {
          setPhaseError(error instanceof Error ? error.message : "Reveal flow failed");
          setPhase("error");
          await cancelActiveSession();
          await client.stop().catch(() => undefined);
        }
      } finally {
        if (!cancelled) {
          setPendingStart(null);
        }
        bootingFlowRef.current = false;
      }
    };

    void runFlow();

    return () => {
      cancelled = true;
      bootingFlowRef.current = false;
    };
  }, [cancelActiveSession, pendingStart, phase, playRevealVideo, playTone, postReveal, postStage, ticket]);

  const handlePhaseError = useCallback((error: RipError) => {
    setPhaseError(error.message);
    if (error.code === "PERMISSIONS_DENIED" || error.code === "NO_CAMERA" || error.code === "NO_MIC") {
      setPhase("permissions-recovery");
      return;
    }
    setPhase("error");
  }, []);

  const handleUnlockReveal = useCallback(async () => {
    if (!ticket) {
      return;
    }

    setConsentBusy(true);
    setPhaseError(null);

    let startedSession: { sessionId: string; controlToken: string } | null = null;

    try {
      const activeSession = session ?? (await ensureSession());

      const existingDob = viewer?.dateOfBirth;
      if (!existingDob && !dobInput) {
        throw new Error("Enter your date of birth to continue");
      }
      if (!existingDob && dobInput && !isOldEnough(dobInput)) {
        setPhase("underage");
        return;
      }

      const provisionalClient =
        clientRef.current ??
        new BrowserRipClient({
          sessionId: "pending",
          whipUrl: "https://invalid.local/whip",
          revealVideoUrl: ticket.revealVideoAssetUrl ?? "",
          countdownSeconds: GOLDEN_TICKET_COUNTDOWN_SECONDS,
          liveSeconds: GOLDEN_TICKET_LIVE_SECONDS,
          overlayTitle: "TEN KINGS GOLDEN TICKET REVEAL",
          onStageChange: () => undefined,
          onError: handlePhaseError,
          onReactionBlob: (blob) => {
            void uploadReactionBlob(blob);
          },
        });

      clientRef.current = provisionalClient;
      if (previewRef.current) {
        provisionalClient.attachPreview(previewRef.current);
      }

      const consentResponse = await fetch("/api/golden/consent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.token}`,
        },
        body: JSON.stringify({
          goldenTicketCode: ticket.code,
          consentTextVersion: GOLDEN_TICKET_CONSENT_TEXT_VERSION,
          consented: true,
          dateOfBirth: existingDob ? undefined : dobInput,
        }),
      });
      const consentPayload = (await consentResponse.json().catch(() => ({}))) as { message?: string };
      if (!consentResponse.ok) {
        throw new Error(consentPayload.message ?? "Failed to capture consent");
      }

      await provisionalClient.requestPermissions();

      const startResponse = await fetch("/api/kiosk/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.token}`,
        },
        body: JSON.stringify({
          ingestMode: "BROWSER",
          goldenTicketCode: ticket.code,
          countdownSeconds: GOLDEN_TICKET_COUNTDOWN_SECONDS,
          liveSeconds: GOLDEN_TICKET_LIVE_SECONDS,
        }),
      });

      const startPayload = (await startResponse.json().catch(() => ({}))) as BrowserStartResponse;
      if (!startResponse.ok || !startPayload.session?.id || !startPayload.controlToken) {
        if (startResponse.status === 409 && startPayload.error === "ONLINE_STREAM_BUSY") {
          throw new Error(`Another King is mid-reveal. Try again in ${startPayload.retryAfterSeconds ?? 20} seconds.`);
        }
        throw new Error(startPayload.message ?? "Failed to start Golden Ticket reveal");
      }

      startedSession = {
        sessionId: startPayload.session.id,
        controlToken: startPayload.controlToken,
      };

      const whipResponse = await fetch(`/api/kiosk/${startPayload.session.id}/whip-url`, {
        headers: {
          Authorization: `Bearer ${activeSession.token}`,
        },
      });
      const whipPayload = (await whipResponse.json().catch(() => ({}))) as WhipResponse;
      if (!whipResponse.ok) {
        throw new Error(whipPayload.message ?? "Failed to fetch WHIP configuration");
      }

      setPendingStart({
        sessionId: startPayload.session.id,
        controlToken: startPayload.controlToken,
        whipUploadUrl: buildWhipUploadUrl(whipPayload),
        countdownSeconds: startPayload.session.countdownSeconds,
        liveSeconds: startPayload.session.liveSeconds,
        countdownEndsAt: startPayload.session.countdownEndsAt,
      });
      setPhase("countdown");
      setReactionUpload({
        status: "idle",
        message: null,
        url: null,
      });

      if (viewer?.displayName || activeSession.user.displayName) {
        updateProfile({ displayName: viewer?.displayName ?? activeSession.user.displayName ?? null });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to unlock reveal";
      setPhaseError(message);
      if (message.toLowerCase().includes("permission")) {
        setPhase("permissions-recovery");
      }
      if (startedSession) {
        await fetch(`/api/kiosk/${startedSession.sessionId}`, {
          method: "DELETE",
          headers: {
            "x-kiosk-token": startedSession.controlToken,
          },
        }).catch(() => undefined);
      }
      await clientRef.current?.stop().catch(() => undefined);
      clientRef.current = null;
    } finally {
      setConsentBusy(false);
    }
  }, [dobInput, ensureSession, handlePhaseError, session, ticket, updateProfile, uploadReactionBlob, viewer]);

  const handleClaimSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!ticket || !activeSessionRef.current) {
        return;
      }

      try {
        const activeSession = session ?? (await ensureSession());
        setClaimBusy(true);
        setPhaseError(null);

        const response = await fetch(`/api/golden/claim/${encodeURIComponent(ticket.code)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${activeSession.token}`,
          },
          body: JSON.stringify({
            shippingAddress: {
              fullName: claimForm.fullName,
              street1: claimForm.street1,
              street2: claimForm.street2 || undefined,
              city: claimForm.city,
              state: claimForm.state,
              postalCode: claimForm.postalCode,
              country: claimForm.country,
            },
            phone: claimForm.phone,
            email: claimForm.email || undefined,
            sourceLocationId: claimForm.sourceLocationId,
            size: ticket.prize.requiresSize ? claimForm.size : undefined,
            socialHandle: claimForm.socialHandle || undefined,
            sessionId: activeSessionRef.current.sessionId,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as ClaimResult & { message?: string };
        if (!response.ok || !payload.success) {
          throw new Error(payload.message ?? "Claim failed");
        }

        setClaimResult(payload);
        setTicket((current) =>
          current
            ? {
                ...current,
                status: "CLAIMED",
              }
            : current
        );
        setPhase("confirmation");
      } catch (error) {
        setPhaseError(error instanceof Error ? error.message : "Claim failed");
      } finally {
        setClaimBusy(false);
      }
    },
    [claimForm, ensureSession, session, ticket]
  );

  useEffect(() => {
    if (phase !== "confirmation") {
      return;
    }

    confetti({
      particleCount: 180,
      spread: 90,
      origin: { y: 0.6 },
      colors: ["#D4AF37", "#F4DE9A", "#8B6A18", "#ffffff"],
    });
  }, [phase]);

  const handleShare = useCallback(async () => {
    if (!ticket || !publicWinnerUrl) {
      return;
    }

    const shareText = `I just claimed Golden Ticket #${claimResult?.ticketNumber ?? ticket.ticketNumber} on Ten Kings.`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Golden Ticket #${claimResult?.ticketNumber ?? ticket.ticketNumber}`,
          text: shareText,
          url: publicWinnerUrl,
        });
        return;
      } catch (error) {
        // fall through to clipboard
      }
    }

    await navigator.clipboard.writeText(publicWinnerUrl);
    setPhaseError("Winner profile link copied to clipboard.");
  }, [claimResult?.ticketNumber, publicWinnerUrl, ticket]);

  const renderPhase = () => {
    if (ticketLoading || phase === "landing") {
      return (
        <ScreenShell eyebrow="Golden Ticket" title="Loading your reveal...">
          <p className="text-sm text-slate-300">Validating your Golden Ticket and preparing the winner flow.</p>
        </ScreenShell>
      );
    }

    if (ticketError || phase === "error") {
      return (
        <ScreenShell eyebrow="Golden Ticket" title="We hit a problem.">
          <div className="space-y-4">
            <p className="text-sm text-rose-100">{phaseError ?? ticketError ?? "Something went wrong."}</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void loadTicket(session?.token ?? null)}
                className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhaseError(null);
                  setPhase(ticket ? "consent" : "landing");
                }}
                className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-200"
              >
                Back
              </button>
            </div>
          </div>
        </ScreenShell>
      );
    }

    if (phase === "claimed") {
      return (
        <ScreenShell eyebrow="Golden Ticket" title="This ticket has already been claimed.">
          <div className="space-y-4 text-sm text-slate-300">
            <p>
              {ticket?.winnerProfile
                ? "Sign in if this is your claim, or jump to the public winner page."
                : "Sign in if this is your claim. This winner profile is not currently public."}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => ensureSession().catch(() => undefined)}
                className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black"
              >
                Sign In
              </button>
              {ticket?.winnerProfile ? (
                <Link
                  href={ticket.winnerProfileUrl}
                  className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-200"
                >
                  View Winner Page
                </Link>
              ) : null}
            </div>
          </div>
        </ScreenShell>
      );
    }

    if (phase === "auth") {
      return (
        <ScreenShell eyebrow="Golden Ticket" title="You found a Golden Ticket.">
          {!viewer ? (
            <div className="space-y-4 text-sm text-slate-300">
              <p>Sign in to unlock your reveal.</p>
              <button
                type="button"
                onClick={() => ensureSession().catch(() => undefined)}
                className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black"
              >
                Sign In To Unlock
              </button>
            </div>
          ) : (
            <form
              className="grid gap-4 sm:max-w-md"
              onSubmit={(event) => {
                event.preventDefault();
                if (!dobInput) {
                  setPhaseError("Enter your date of birth to continue.");
                  return;
                }
                if (!isOldEnough(dobInput)) {
                  setPhase("underage");
                  return;
                }
                setPhaseError(null);
                setPhase("consent");
              }}
            >
              <p className="text-sm text-slate-300">Enter your date of birth. Golden Ticket claims are for Kings 18 and over.</p>
              <Field label="Date of birth">
                <input
                  type="date"
                  value={dobInput}
                  onChange={(event) => setDobInput(event.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  className={inputClass}
                  required
                />
              </Field>
              <button
                type="submit"
                className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black"
              >
                Continue
              </button>
            </form>
          )}
        </ScreenShell>
      );
    }

    if (phase === "underage") {
      return (
        <ScreenShell eyebrow="Golden Ticket" title="Golden Ticket claims are for Kings 18 and over.">
          <p className="text-sm text-slate-300">
            Please ask a parent or guardian to contact <a className="text-gold-300 underline" href="mailto:support@tenkings.co">support@tenkings.co</a>.
          </p>
        </ScreenShell>
      );
    }

    if (phase === "consent" && ticket) {
      return (
        <ScreenShell eyebrow="Golden Ticket" title="Unlock your reveal.">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/35 p-5 text-sm text-slate-200">
                <pre className="whitespace-pre-wrap font-sans leading-7 text-slate-200">{GOLDEN_TICKET_CONSENT_TEXT}</pre>
              </div>
              <label className="flex items-start gap-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(event) => setConsentChecked(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-black/60 text-gold-500"
                />
                <span>I agree.</span>
              </label>
              <button
                type="button"
                disabled={!consentChecked || consentBusy}
                onClick={() => void handleUnlockReveal()}
                className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {consentBusy ? "Unlocking..." : "Unlock My Reveal"}
              </button>
            </div>
            <aside className="rounded-[1.5rem] border border-white/10 bg-black/35 p-5">
              {ticket.prize.imageUrl ? (
                <div className="relative aspect-square overflow-hidden rounded-[1.25rem] border border-white/10 bg-black">
                  <Image src={ticket.prize.imageUrl} alt={ticket.prize.name} fill className="object-cover" sizes="320px" />
                </div>
              ) : null}
              <div className="mt-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Prize</p>
                <h2 className="font-heading text-2xl uppercase tracking-[0.1em] text-white">{ticket.prize.name}</h2>
                {ticket.prize.description ? <p className="text-sm text-slate-300">{ticket.prize.description}</p> : null}
                {formatCurrency(ticket.prize.estimatedValue) ? (
                  <p className="text-sm text-slate-300">Estimated value: {formatCurrency(ticket.prize.estimatedValue)}</p>
                ) : null}
              </div>
            </aside>
          </div>
        </ScreenShell>
      );
    }

    if (phase === "permissions-recovery") {
      return (
        <ScreenShell eyebrow="Golden Ticket" title="We couldn&apos;t access your camera or microphone.">
          <div className="space-y-4 text-sm text-slate-300">
            <p>Your Golden Ticket is safe. Tap below to try again.</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  setPhase("consent");
                  setPhaseError(null);
                }}
                className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={() => setHelpOpen((current) => !current)}
                className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-200"
              >
                Need Help?
              </button>
            </div>
            {helpOpen ? (
              <div className="rounded-[1.25rem] border border-white/10 bg-black/35 p-4 text-sm text-slate-300">
                <p>iPhone Safari: Settings → Safari → Camera and Microphone.</p>
                <p className="mt-2">Android Chrome: tap the lock icon in the address bar → Permissions.</p>
              </div>
            ) : null}
          </div>
        </ScreenShell>
      );
    }

    if ((phase === "countdown" || phase === "reveal") && ticket) {
      return (
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-0 py-0">
          <div className="relative flex min-h-screen items-center justify-center bg-black">
            <canvas ref={compositeRef} width={1280} height={720} className="h-screen w-full object-cover" />
          </div>
        </div>
      );
    }

    if (phase === "claim-form" && ticket) {
      return (
        <ScreenShell eyebrow="Golden Ticket" title="Tell us where to ship it, King.">
          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="space-y-4 rounded-[1.5rem] border border-white/10 bg-black/35 p-5">
              {ticket.prize.imageUrl ? (
                <div className="relative aspect-square overflow-hidden rounded-[1.25rem] border border-white/10 bg-black">
                  <Image src={ticket.prize.imageUrl} alt={ticket.prize.name} fill className="object-cover" sizes="320px" />
                </div>
              ) : null}
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">Prize</p>
                <h2 className="font-heading text-2xl uppercase tracking-[0.1em] text-white">{ticket.prize.name}</h2>
                {reactionUpload.message ? <p className="text-xs text-slate-400">{reactionUpload.message}</p> : null}
              </div>
            </aside>

            <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleClaimSubmit}>
              <Field label="Full name">
                <input
                  value={claimForm.fullName}
                  onChange={(event) => setClaimForm((current) => ({ ...current, fullName: event.target.value }))}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="Phone">
                <input
                  value={claimForm.phone}
                  onChange={(event) => setClaimForm((current) => ({ ...current, phone: event.target.value }))}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="Street address">
                <input
                  value={claimForm.street1}
                  onChange={(event) => setClaimForm((current) => ({ ...current, street1: event.target.value }))}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="Apt / suite">
                <input
                  value={claimForm.street2}
                  onChange={(event) => setClaimForm((current) => ({ ...current, street2: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label="City">
                <input
                  value={claimForm.city}
                  onChange={(event) => setClaimForm((current) => ({ ...current, city: event.target.value }))}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="State">
                <input
                  value={claimForm.state}
                  onChange={(event) => setClaimForm((current) => ({ ...current, state: event.target.value.toUpperCase().slice(0, 2) }))}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="ZIP code">
                <input
                  value={claimForm.postalCode}
                  onChange={(event) => setClaimForm((current) => ({ ...current, postalCode: event.target.value }))}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="Country">
                <input
                  value={claimForm.country}
                  onChange={(event) => setClaimForm((current) => ({ ...current, country: event.target.value }))}
                  className={inputClass}
                  required
                />
              </Field>
              <Field label="Email (optional)">
                <input
                  type="email"
                  value={claimForm.email}
                  onChange={(event) => setClaimForm((current) => ({ ...current, email: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              {ticket.sourceLocation ? (
                <Field label="Pack source">
                  <div className="rounded-[1rem] border border-white/10 bg-black/35 px-4 py-3 text-sm text-slate-200">
                    <p>{ticket.sourceLocation.name}</p>
                    <p className="mt-1 text-xs text-slate-500">Recorded from Golden Ticket pack placement.</p>
                  </div>
                </Field>
              ) : (
                <Field label="How did you get this pack?">
                  <select
                    value={claimForm.sourceLocationId}
                    onChange={(event) => setClaimForm((current) => ({ ...current, sourceLocationId: event.target.value }))}
                    className={inputClass}
                    required
                  >
                    <option value="">{locationsLoading ? "Loading locations..." : "Select a location"}</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {ticket.prize.requiresSize ? (
                <Field label="Size">
                  <select
                    value={claimForm.size}
                    onChange={(event) => setClaimForm((current) => ({ ...current, size: event.target.value }))}
                    className={inputClass}
                    required
                  >
                    <option value="">Select a size</option>
                    {ticket.prize.sizeOptions.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="Social handle (optional)">
                <input
                  value={claimForm.socialHandle}
                  onChange={(event) => setClaimForm((current) => ({ ...current, socialHandle: event.target.value }))}
                  className={inputClass}
                  placeholder="@yourhandle"
                />
              </Field>
              <div className="sm:col-span-2 pt-2">
                <button
                  type="submit"
                  disabled={claimBusy}
                  className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {claimBusy ? "Locking In..." : "Ship It, Ten Kings"}
                </button>
              </div>
            </form>
          </div>
        </ScreenShell>
      );
    }

    if (phase === "confirmation" && ticket) {
      const ticketNumber = claimResult?.ticketNumber ?? ticket.ticketNumber;
      const winnerPath = claimResult?.winnerProfileUrl ?? ticket.winnerProfileUrl;
      return (
        <ScreenShell eyebrow="Golden Ticket" title="Locked in, King.">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <p className="text-lg text-slate-200">You are Golden Ticket #{ticketNumber}. Welcome to the Hall.</p>
              <div className="rounded-[1.5rem] border border-gold-400/30 bg-gold-500/10 p-5">
                <p className="text-xs uppercase tracking-[0.28em] text-gold-100">Winner Profile</p>
                <h2 className="mt-3 font-heading text-2xl uppercase tracking-[0.1em] text-white">{ticket.prize.name}</h2>
                <p className="mt-2 text-sm text-slate-200">
                  {viewer?.displayName ?? ticket.winnerProfile?.displayName ?? session?.user.displayName ?? "Winner"} · Golden Ticket #{ticketNumber}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href={winnerPath}
                  className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black"
                >
                  View Your Reveal
                </Link>
                <button
                  type="button"
                  onClick={() => void handleShare()}
                  className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-200"
                >
                  Share Your Moment
                </button>
              </div>
            </div>
            <aside className="space-y-4 rounded-[1.5rem] border border-white/10 bg-black/35 p-5">
              {ticket.prize.imageUrl ? (
                <div className="relative aspect-square overflow-hidden rounded-[1.25rem] border border-white/10 bg-black">
                  <Image src={ticket.prize.imageUrl} alt={ticket.prize.name} fill className="object-cover" sizes="320px" />
                </div>
              ) : null}
              <p className="text-sm text-slate-300">{publicWinnerUrl ?? winnerPath}</p>
            </aside>
          </div>
        </ScreenShell>
      );
    }

    return null;
  };

  return (
    <AppShell
      background="gilded"
      brandVariant="collectibles"
      hideHeader={phase === "countdown" || phase === "reveal"}
      hideFooter={phase === "countdown" || phase === "reveal"}
    >
      <Head>
        <title>{ticket ? `Golden Ticket #${ticket.ticketNumber}` : "Golden Ticket"} | Ten Kings</title>
        <meta name="robots" content="noindex" />
      </Head>

      <video ref={previewRef} className="hidden" autoPlay muted playsInline />
      <video
        ref={revealVideoRef}
        className="hidden"
        playsInline
        preload="auto"
        src={ticket?.revealVideoAssetUrl ?? undefined}
        poster={ticket?.revealVideoPoster ?? undefined}
      />

      {phaseError && phase !== "error" ? (
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{phaseError}</div>
        </div>
      ) : null}

      {renderPhase()}
    </AppShell>
  );
}
