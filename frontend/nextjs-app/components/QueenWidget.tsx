"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../hooks/useSession";
import { TEN_KINGS_COLLECTIBLES_CROWN_PATH, TEN_KINGS_COLLECTIBLES_CROWN_VIEWBOX } from "../lib/tenKingsBrand";

type WidgetMode = "chat" | "voice" | "call";
type WidgetMessageRole = "assistant" | "user";
type LaunchMode = "chat" | "voice" | null;
type QueenConnectionType = "websocket" | "webrtc";

type WidgetMessage = {
  id: string;
  role: WidgetMessageRole;
  text: string;
};

const GOLD = "#C9A84C";
const BLACK = "#0A0A0A";
const PHONE_NUMBER = "7705013785";
const PHONE_LABEL = "(770) 501-3785";
const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID?.trim() ?? "";

function CrownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox={TEN_KINGS_COLLECTIBLES_CROWN_VIEWBOX} aria-hidden="true" className={className}>
      <path d={TEN_KINGS_COLLECTIBLES_CROWN_PATH} fill="currentColor" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M22 16.92v2.7a2 2 0 0 1-2.18 2 19.78 19.78 0 0 1-8.63-3.07 19.38 19.38 0 0 1-5.96-5.96A19.78 19.78 0 0 1 2.16 3.95 2 2 0 0 1 4.14 1.8h2.7a2 2 0 0 1 2 1.72l.92 4.38a2 2 0 0 1-.57 1.86l-1.98 1.98a16 16 0 0 0 5.04 5.04l1.98-1.98a2 2 0 0 1 1.86-.57l4.38.92A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function buttonPulseEnabled(pathname: string) {
  const normalizedPath = pathname.toLowerCase();
  return normalizedPath.startsWith("/shop") || normalizedPath.includes("pack");
}

function summarizeConversationError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Queen hit a connection issue. Try again in a moment.";
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
}

function QueenWidgetSurface({
  messages,
  appendMessage,
  externalError,
  setExternalError,
}: {
  messages: WidgetMessage[];
  appendMessage: (role: WidgetMessageRole, text: string) => void;
  externalError: string | null;
  setExternalError: (value: string | null) => void;
}) {
  const router = useRouter();
  const { session } = useSession();
  const {
    startSession,
    endSession,
    sendContextualUpdate,
    sendUserActivity,
    sendUserMessage,
    status,
    mode,
    isListening,
    isSpeaking,
  } = useConversation();

  const [isOpen, setIsOpen] = useState(false);
  const [widgetMode, setWidgetMode] = useState<WidgetMode>("chat");
  const [inputValue, setInputValue] = useState("");
  const [queuedChatMessage, setQueuedChatMessage] = useState<string | null>(null);
  const [pendingLaunchMode, setPendingLaunchMode] = useState<LaunchMode>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showAttentionPulse, setShowAttentionPulse] = useState(false);

  const hasOpenedRef = useRef(false);
  const lastContextRef = useRef("");
  const activeSessionKindRef = useRef<Exclude<WidgetMode, "call"> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const errorMessage = localError ?? externalError;

  const currentPath = typeof window !== "undefined" ? window.location.pathname : router.pathname ?? "/";
  const currentTitle = typeof document !== "undefined" && document.title.trim() ? document.title.trim() : "Ten Kings";

  const dynamicVariables = useMemo(
    () => ({
      current_page: currentPath,
      page_title: currentTitle,
      customer_name: session?.user.displayName?.trim() ?? "",
      is_returning_customer: session?.user.id ? "true" : "false",
    }),
    [currentPath, currentTitle, session?.user.displayName, session?.user.id]
  );

  const contextualUpdateText = useMemo(
    () =>
      [
        `Page context updated:`,
        `current_page=${dynamicVariables.current_page}`,
        `page_title=${dynamicVariables.page_title}`,
        `customer_name=${dynamicVariables.customer_name || "unknown"}`,
        `is_returning_customer=${dynamicVariables.is_returning_customer}`,
      ].join("\n"),
    [dynamicVariables]
  );

  const buildSessionOptions = useCallback(
    (connectionType: QueenConnectionType, textOnly: boolean) => ({
      agentId: AGENT_ID,
      connectionType,
      textOnly,
      userId: session?.user.id || undefined,
      dynamicVariables,
    }),
    [dynamicVariables, session?.user.id]
  );

  const startChatSession = useCallback(() => {
    if (!AGENT_ID) {
      setLocalError("Queen chat is not configured. Add the ElevenLabs agent ID to the frontend env.");
      return;
    }

    setLocalError(null);
    setExternalError(null);
    lastContextRef.current = "";
    activeSessionKindRef.current = "chat";
    startSession(buildSessionOptions("websocket", true));
  }, [buildSessionOptions, setExternalError, startSession]);

  const startVoiceSession = useCallback(async () => {
    if (!AGENT_ID) {
      setLocalError("Queen voice is not configured. Add the ElevenLabs agent ID to the frontend env.");
      return;
    }

    let permissionStream: MediaStream | null = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setLocalError("Voice mode is not supported by this browser.");
        return;
      }

      permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopMediaStream(permissionStream);
      permissionStream = null;

      setLocalError(null);
      setExternalError(null);
      lastContextRef.current = "";
      activeSessionKindRef.current = "voice";
      startSession(buildSessionOptions("webrtc", false));
    } catch (error) {
      setLocalError("Microphone access is required for Voice mode.");
    } finally {
      stopMediaStream(permissionStream);
    }
  }, [buildSessionOptions, setExternalError, startSession]);

  const closeWidget = useCallback(() => {
    setIsOpen(false);
    setWidgetMode("chat");
    setInputValue("");
    setQueuedChatMessage(null);
    setPendingLaunchMode(null);
    setLocalError(null);
    setExternalError(null);
    lastContextRef.current = "";
    activeSessionKindRef.current = null;

    if (status !== "disconnected") {
      endSession();
    }
  }, [endSession, setExternalError, status]);

  const openWidget = useCallback(() => {
    hasOpenedRef.current = true;
    setShowAttentionPulse(false);
    setIsOpen(true);
  }, []);

  const selectMode = useCallback(
    (nextMode: WidgetMode) => {
      setLocalError(null);
      setExternalError(null);
      setWidgetMode(nextMode);

      if (nextMode === "call") {
        setQueuedChatMessage(null);
        setPendingLaunchMode(null);
        activeSessionKindRef.current = null;
        lastContextRef.current = "";
        if (status !== "disconnected") {
          endSession();
        }
        return;
      }

      if (nextMode === "chat") {
        if (activeSessionKindRef.current === "voice" && status !== "disconnected") {
          activeSessionKindRef.current = null;
          setPendingLaunchMode(null);
          endSession();
        }
        return;
      }

      if (activeSessionKindRef.current === "voice" && status === "connected") {
        return;
      }

      setPendingLaunchMode("voice");

      if (status === "disconnected") {
        return;
      }

      activeSessionKindRef.current = null;
      endSession();
    },
    [endSession, setExternalError, status]
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = inputValue.trim();

      if (!trimmed) {
        return;
      }

      setWidgetMode("chat");
      setInputValue("");
      appendMessage("user", trimmed);
      setLocalError(null);
      setExternalError(null);

      if (!AGENT_ID) {
        setLocalError("Queen chat is not configured. Add the ElevenLabs agent ID to the frontend env.");
        return;
      }

      if (status === "connected" && activeSessionKindRef.current === "chat") {
        sendUserMessage(trimmed);
        return;
      }

      setQueuedChatMessage(trimmed);
      setPendingLaunchMode("chat");

      if (status !== "disconnected") {
        activeSessionKindRef.current = null;
        endSession();
      }
    },
    [appendMessage, endSession, inputValue, sendUserMessage, setExternalError, status]
  );

  useEffect(() => {
    const isEligibleForPulse = !hasOpenedRef.current && !isOpen && buttonPulseEnabled(currentPath);

    if (!isEligibleForPulse) {
      setShowAttentionPulse(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowAttentionPulse(true);
    }, 30_000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentPath, isOpen]);

  useEffect(() => {
    if (!pendingLaunchMode || status !== "disconnected") {
      return;
    }

    if (pendingLaunchMode === "chat") {
      startChatSession();
      setPendingLaunchMode(null);
      return;
    }

    setPendingLaunchMode(null);
    void startVoiceSession();
  }, [pendingLaunchMode, startChatSession, startVoiceSession, status]);

  useEffect(() => {
    if (!queuedChatMessage || status !== "connected" || activeSessionKindRef.current !== "chat") {
      return;
    }

    sendUserMessage(queuedChatMessage);
    setQueuedChatMessage(null);
  }, [queuedChatMessage, sendUserMessage, status]);

  useEffect(() => {
    if (status !== "connected" || widgetMode === "call") {
      return;
    }

    if (lastContextRef.current === contextualUpdateText) {
      return;
    }

    lastContextRef.current = contextualUpdateText;
    sendContextualUpdate(contextualUpdateText);
  }, [contextualUpdateText, sendContextualUpdate, status, widgetMode]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, widgetMode, isOpen, errorMessage]);

  useEffect(() => {
    if (status === "disconnected" && !pendingLaunchMode) {
      activeSessionKindRef.current = null;
    }
  }, [pendingLaunchMode, status]);

  const connectionLabel =
    status === "connected"
      ? widgetMode === "voice"
        ? isSpeaking
          ? "Queen is speaking"
          : isListening || mode === "listening"
            ? "Queen is listening"
            : "Voice is connected"
        : "Queen is connected"
      : status === "connecting"
        ? "Connecting to Queen"
        : status === "error"
          ? "Queen needs a retry"
          : widgetMode === "voice"
            ? "Tap Voice to start talking"
            : "Ask Queen about this page";

  return (
    <>
      <div className="fixed bottom-4 right-4 z-[140] sm:bottom-6 sm:right-6">
        {isOpen ? (
          <div
            className="fixed bottom-[5.25rem] left-4 right-4 z-[139] flex h-[70vh] max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-[#C9A84C]/30 bg-[#0A0A0A] text-white shadow-[0_28px_90px_rgba(0,0,0,0.62)] sm:bottom-[6.1rem] sm:left-auto sm:right-6 sm:h-[520px] sm:max-h-[520px] sm:w-[380px]"
            role="dialog"
            aria-label="Queen concierge"
          >
            <div className="flex items-center justify-between border-b border-[#C9A84C]/18 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#C9A84C]/35 bg-[#120f08] text-[#C9A84C]">
                  <CrownIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-lg font-semibold tracking-[0.08em] text-[#C9A84C]">Queen</div>
                  <div className="text-[0.68rem] uppercase tracking-[0.28em] text-white/45">{connectionLabel}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeWidget}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white/70 transition hover:border-[#C9A84C]/30 hover:text-[#C9A84C]"
                aria-label="Close Queen chat"
              >
                <span className="text-lg leading-none">×</span>
              </button>
            </div>

            <div className="border-b border-[#C9A84C]/12 px-5 py-3">
              <div className="grid grid-cols-3 gap-2">
                {(["chat", "voice", "call"] as WidgetMode[]).map((item) => {
                  const active = widgetMode === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => selectMode(item)}
                      className={`rounded-full px-3 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.22em] transition ${
                        active
                          ? "bg-[#C9A84C] text-[#0A0A0A]"
                          : "border border-white/10 bg-white/[0.03] text-white/72 hover:border-[#C9A84C]/35 hover:text-[#C9A84C]"
                      }`}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>

            {widgetMode === "call" ? (
              <div className="flex flex-1 flex-col justify-center px-6 py-8">
                <div className="rounded-[1.35rem] border border-[#C9A84C]/18 bg-[linear-gradient(180deg,rgba(201,168,76,0.14),rgba(201,168,76,0.04))] p-6 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#C9A84C]/28 bg-[#120f08] text-[#C9A84C]">
                    <PhoneIcon className="h-6 w-6" />
                  </div>
                  <div className="text-sm uppercase tracking-[0.3em] text-white/45">Call Queen Directly</div>
                  <a
                    href={`tel:${PHONE_NUMBER}`}
                    className="mt-4 block text-2xl font-semibold tracking-[0.08em] text-[#C9A84C] transition hover:text-[#f1d689]"
                  >
                    {PHONE_LABEL}
                  </a>
                  <p className="mt-4 text-sm leading-6 text-white/66">
                    Prefer a real-time conversation? Tap the number above to call Queen directly from your phone.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                  {widgetMode === "voice" ? (
                    <div className="rounded-[1.35rem] border border-[#C9A84C]/20 bg-white/[0.02] p-5">
                      <div className="flex flex-col items-center gap-4 text-center">
                        <div
                          className={`queen-voice-orb relative flex h-28 w-28 items-center justify-center rounded-full border transition ${
                            status === "connected" && isSpeaking
                              ? "border-[#C9A84C]/80 bg-[radial-gradient(circle_at_center,rgba(243,220,140,0.95),rgba(201,168,76,0.94)_58%,rgba(77,57,20,0.98))] text-[#0A0A0A]"
                              : status === "connected"
                                ? "border-[#C9A84C]/55 bg-[radial-gradient(circle_at_center,rgba(201,168,76,0.22),rgba(10,10,10,0.94)_68%)] text-[#C9A84C]"
                                : "border-white/10 bg-white/[0.03] text-white/45"
                          }`}
                          data-speaking={status === "connected" && isSpeaking}
                          data-listening={status === "connected" && !isSpeaking}
                        >
                          <CrownIcon className="h-12 w-12" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold uppercase tracking-[0.28em] text-[#C9A84C]">Voice Concierge</div>
                          <div className="mt-2 text-sm leading-6 text-white/66">
                            {status === "connected"
                              ? isSpeaking
                                ? "Queen is talking now."
                                : "Queen is listening for your next question."
                              : "Tap Voice to start a live browser conversation. Microphone permission is required."}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {messages.map((message) => (
                    <div key={message.id} className={`flex ${message.role === "assistant" ? "justify-start" : "justify-end"}`}>
                      <div
                        className={`max-w-[86%] rounded-[1.2rem] px-4 py-3 text-sm leading-6 ${
                          message.role === "assistant"
                            ? "border border-[#C9A84C]/18 bg-white/[0.04] text-white/86"
                            : "bg-[#C9A84C] text-[#0A0A0A]"
                        }`}
                      >
                        {message.text}
                      </div>
                    </div>
                  ))}

                  {!messages.length ? (
                    <div className="rounded-[1.2rem] border border-dashed border-white/12 px-4 py-5 text-sm leading-6 text-white/55">
                      Queen can answer questions about packs, live rips, locations, shipping, or whatever page you are viewing right now.
                    </div>
                  ) : null}

                  {errorMessage ? (
                    <div className="rounded-[1.2rem] border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm leading-6 text-amber-200">
                      {errorMessage}
                    </div>
                  ) : null}
                </div>

                {widgetMode === "chat" ? (
                  <form onSubmit={handleSubmit} className="border-t border-[#C9A84C]/12 px-4 py-4">
                    <div className="flex items-end gap-3 rounded-[1.1rem] border border-white/10 bg-white/[0.03] px-3 py-3">
                      <input
                        value={inputValue}
                        onChange={(event) => {
                          setInputValue(event.target.value);
                          if (status === "connected" && activeSessionKindRef.current === "chat") {
                            sendUserActivity();
                          }
                        }}
                        placeholder="Ask Queen about this page"
                        className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                        disabled={!AGENT_ID}
                        aria-label="Message Queen"
                      />
                      <button
                        type="submit"
                        className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-[#C9A84C] px-4 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[#0A0A0A] transition hover:bg-[#e2c15f] disabled:cursor-not-allowed disabled:bg-[#6d5a25] disabled:text-black/45"
                        disabled={!inputValue.trim() || !AGENT_ID}
                      >
                        Send
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="border-t border-[#C9A84C]/12 px-5 py-4">
                    <button
                      type="button"
                      onClick={() => selectMode("voice")}
                      className="w-full rounded-full border border-[#C9A84C]/28 bg-white/[0.03] px-4 py-3 text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-[#C9A84C] transition hover:border-[#C9A84C]/45 hover:bg-[#C9A84C]/10"
                    >
                      {status === "connected" && activeSessionKindRef.current === "voice" ? "Voice Connected" : "Start Voice"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}

        <button
          type="button"
          onClick={openWidget}
          className="relative flex h-14 w-14 items-center justify-center rounded-full border border-[#C9A84C]/40 bg-black text-[#C9A84C] shadow-[0_0_0_1px_rgba(201,168,76,0.22),0_0_22px_rgba(201,168,76,0.3),0_14px_36px_rgba(0,0,0,0.46)] transition hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(201,168,76,0.34),0_0_26px_rgba(201,168,76,0.42),0_16px_40px_rgba(0,0,0,0.52)]"
          aria-label="Open Queen concierge"
          style={showAttentionPulse ? { animation: "queenWidgetButtonPulse 2.8s ease-in-out infinite" } : undefined}
        >
          <span className="pointer-events-none absolute inset-[5px] rounded-full border border-[#C9A84C]/22" aria-hidden="true" />
          <CrownIcon className="h-6 w-6" />
        </button>
      </div>

      <style jsx global>{`
        @keyframes queenWidgetButtonPulse {
          0%,
          100% {
            box-shadow:
              0 0 0 1px rgba(201, 168, 76, 0.22),
              0 0 22px rgba(201, 168, 76, 0.28),
              0 14px 36px rgba(0, 0, 0, 0.46);
            transform: translateY(0) scale(1);
          }
          35% {
            box-shadow:
              0 0 0 1px rgba(201, 168, 76, 0.34),
              0 0 30px rgba(201, 168, 76, 0.52),
              0 16px 42px rgba(0, 0, 0, 0.52);
            transform: translateY(-1px) scale(1.04);
          }
          70% {
            box-shadow:
              0 0 0 1px rgba(201, 168, 76, 0.28),
              0 0 26px rgba(201, 168, 76, 0.4),
              0 15px 38px rgba(0, 0, 0, 0.48);
            transform: translateY(0) scale(1.01);
          }
        }

        @keyframes queenVoiceOrbBreath {
          0%,
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(201, 168, 76, 0.18);
          }
          50% {
            transform: scale(1.03);
            box-shadow: 0 0 0 18px rgba(201, 168, 76, 0);
          }
        }

        .queen-voice-orb[data-listening="true"] {
          animation: queenVoiceOrbBreath 2.1s ease-in-out infinite;
        }

        .queen-voice-orb[data-speaking="true"]::after {
          content: "";
          position: absolute;
          inset: -8px;
          border-radius: 999px;
          border: 1px solid rgba(201, 168, 76, 0.45);
          animation: queenVoiceOrbBreath 1.4s ease-out infinite;
        }
      `}</style>
    </>
  );
}

export default function QueenWidget() {
  const messageIdRef = useRef(0);
  const [messages, setMessages] = useState<WidgetMessage[]>([
    {
      id: "queen-intro",
      role: "assistant",
      text: "Ask about packs, live rips, locations, or whatever page you are viewing right now.",
    },
  ]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const appendMessage = useCallback((role: WidgetMessageRole, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    setMessages((current) => {
      const last = current[current.length - 1];
      if (last && last.role === role && last.text === trimmed) {
        return current;
      }

      messageIdRef.current += 1;
      return [
        ...current,
        {
          id: `queen-message-${messageIdRef.current}`,
          role,
          text: trimmed,
        },
      ];
    });
  }, []);

  const handleConversationMessage = useCallback(
    (payload: { message: string; role: "user" | "agent" }) => {
      appendMessage(payload.role === "user" ? "user" : "assistant", payload.message);
    },
    [appendMessage]
  );

  const handleConversationError = useCallback((message: string, context?: unknown) => {
    setErrorMessage(summarizeConversationError(message || context));
  }, []);

  return (
    <ConversationProvider onMessage={handleConversationMessage} onError={handleConversationError}>
      <QueenWidgetSurface
        messages={messages}
        appendMessage={appendMessage}
        externalError={errorMessage}
        setExternalError={setErrorMessage}
      />
    </ConversationProvider>
  );
}
