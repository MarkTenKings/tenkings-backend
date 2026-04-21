import Head from "next/head";
import { BrowserRipClient, type RipStage } from "@tenkings/browser-rip-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession, type SessionPayload } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import type { SerializedKioskSession } from "../../lib/server/kioskSession";

type StartResponse = {
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

type StageValue = "LIVE" | "REVEAL" | "COMPLETE" | "CANCELLED";

const TEST_COUNTDOWN_SECONDS = 5;
const TEST_LIVE_SECONDS = 5;
const TEST_REVEAL_HOLD_MS = 3_000;
const PLACEHOLDER_REVEAL_VIDEO = "/admin/launch/kingsreview.mp4";

export default function BrowserRipTestPage() {
  const { session, loading, ensureSession, logout } = useSession();
  const [testSession, setTestSession] = useState<SerializedKioskSession | null>(null);
  const [ripStage, setRipStage] = useState<RipStage>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [controlToken, setControlToken] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [reactionInfo, setReactionInfo] = useState<string | null>(null);
  const [reactionDownloadUrl, setReactionDownloadUrl] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const compositeRef = useRef<HTMLCanvasElement | null>(null);
  const clientRef = useRef<BrowserRipClient | null>(null);
  const timerIdsRef = useRef<number[]>([]);

  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );

  const appendLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((current) => [`${timestamp} ${message}`, ...current].slice(0, 60));
  }, []);

  const clearTimers = useCallback(() => {
    for (const timerId of timerIdsRef.current) {
      window.clearTimeout(timerId);
    }
    timerIdsRef.current = [];
  }, []);

  const stopClient = useCallback(async () => {
    clearTimers();
    const client = clientRef.current;
    clientRef.current = null;
    if (!client) {
      return;
    }
    try {
      await client.stop();
    } catch (stopError) {
      appendLog(stopError instanceof Error ? `client stop failed: ${stopError.message}` : "client stop failed");
    }
  }, [appendLog, clearTimers]);

  useEffect(() => {
    return () => {
      clearTimers();
      void stopClient();
    };
  }, [clearTimers, stopClient]);

  useEffect(() => {
    if (!reactionDownloadUrl) {
      return;
    }
    return () => {
      URL.revokeObjectURL(reactionDownloadUrl);
    };
  }, [reactionDownloadUrl]);

  const transitionSessionStage = useCallback(
    async (sessionId: string, kioskToken: string, stage: StageValue) => {
      const response = await fetch(`/api/kiosk/${sessionId}/stage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-kiosk-token": kioskToken,
        },
        credentials: "include",
        body: JSON.stringify({ stage }),
      });

      const body = (await response.json().catch(() => ({}))) as { session?: SerializedKioskSession; message?: string };

      if (!response.ok) {
        const message = body.message ?? `Failed to transition to ${stage}`;
        if (response.status === 400 && message.includes("Cannot transition")) {
          appendLog(`stage ${stage} skipped (${message})`);
          return;
        }
        throw new Error(message);
      }

      if (body.session) {
        setTestSession(body.session);
      }
      appendLog(`session stage -> ${stage}`);
    },
    [appendLog],
  );

  const scheduleStageProgression = useCallback(
    (sessionId: string, kioskToken: string, countdownSeconds: number, liveSeconds: number) => {
      const countdownMs = countdownSeconds * 1000;
      const liveMs = liveSeconds * 1000;

      timerIdsRef.current.push(
        window.setTimeout(() => {
          void transitionSessionStage(sessionId, kioskToken, "LIVE");
        }, countdownMs),
      );

      timerIdsRef.current.push(
        window.setTimeout(() => {
          void transitionSessionStage(sessionId, kioskToken, "REVEAL");
        }, countdownMs + liveMs),
      );

      timerIdsRef.current.push(
        window.setTimeout(() => {
          void (async () => {
            await transitionSessionStage(sessionId, kioskToken, "COMPLETE");
            await stopClient();
          })();
        }, countdownMs + liveMs + TEST_REVEAL_HOLD_MS),
      );
    },
    [stopClient, transitionSessionStage],
  );

  const buildWhipUploadUrl = useCallback((payload: WhipResponse) => {
    if (payload.whipUploadUrl) {
      return payload.whipUploadUrl;
    }
    if (!payload.whipUrl || !payload.streamKey) {
      throw new Error("WHIP publish URL is incomplete");
    }
    return `${payload.whipUrl.replace(/\/$/, "")}/${encodeURIComponent(payload.streamKey)}`;
  }, []);

  const runTest = useCallback(async () => {
    let activeSession: SessionPayload | null = session;
    let createdSessionId: string | null = null;
    let createdControlToken: string | null = null;
    if (!activeSession) {
      try {
        activeSession = await ensureSession();
      } catch (sessionError) {
        setError(sessionError instanceof Error ? sessionError.message : "Sign-in required");
        return;
      }
    }

    if (!activeSession || !isAdmin) {
      setError("Admin access is required");
      return;
    }

    setBusy(true);
    setError(null);
    setLogs([]);
    setTestSession(null);
    setControlToken(null);
    setPlaybackUrl(null);
    setReactionInfo(null);
    setRipStage("idle");
    if (reactionDownloadUrl) {
      URL.revokeObjectURL(reactionDownloadUrl);
      setReactionDownloadUrl(null);
    }

    if (testSession?.id && controlToken && testSession.status !== "COMPLETE" && testSession.status !== "CANCELLED") {
      try {
        await transitionSessionStage(testSession.id, controlToken, "CANCELLED");
      } catch (cancelError) {
        appendLog(
          cancelError instanceof Error ? `previous session cancel failed: ${cancelError.message}` : "previous session cancel failed",
        );
      }
    }

    await stopClient();

    try {
      const sessionCode = `browser-rip-test-${Date.now()}`;
      appendLog("creating browser-ingest kiosk session");

      const startResponse = await fetch("/api/kiosk/start", {
        method: "POST",
        headers: buildAdminHeaders(activeSession.token, {
          "Content-Type": "application/json",
        }),
        credentials: "include",
        body: JSON.stringify({
          ingestMode: "BROWSER",
          code: sessionCode,
          countdownSeconds: TEST_COUNTDOWN_SECONDS,
          liveSeconds: TEST_LIVE_SECONDS,
        }),
      });

      const startBody = (await startResponse.json().catch(() => ({}))) as StartResponse;

      if (!startResponse.ok || !startBody.session?.id || !startBody.controlToken) {
        if (startResponse.status === 409 && startBody.error === "ONLINE_STREAM_BUSY") {
          throw new Error(
            `Online stream busy. Retry in ${startBody.retryAfterSeconds ?? 20} seconds.`,
          );
        }
        throw new Error(startBody.message ?? "Failed to start browser kiosk session");
      }

      createdSessionId = startBody.session.id;
      createdControlToken = startBody.controlToken;
      setTestSession(startBody.session);
      setControlToken(startBody.controlToken);
      appendLog(`session created: ${startBody.session.id}`);

      const whipResponse = await fetch(`/api/kiosk/${startBody.session.id}/whip-url`, {
        headers: buildAdminHeaders(activeSession.token),
        credentials: "include",
      });

      const whipBody = (await whipResponse.json().catch(() => ({}))) as WhipResponse;
      if (!whipResponse.ok) {
        throw new Error(whipBody.message ?? "Failed to fetch WHIP configuration");
      }

      setPlaybackUrl(whipBody.playbackUrl ?? null);
      appendLog("WHIP configuration loaded");

      const nextClient = new BrowserRipClient({
        sessionId: startBody.session.id,
        whipUrl: buildWhipUploadUrl(whipBody),
        revealVideoUrl: PLACEHOLDER_REVEAL_VIDEO,
        countdownSeconds: startBody.session.countdownSeconds,
        liveSeconds: startBody.session.liveSeconds,
        overlayTitle: "TEN KINGS BROWSER RIP TEST",
        onStageChange: (nextStage) => {
          setRipStage(nextStage);
          appendLog(`browser client -> ${nextStage}`);
        },
        onError: (clientError) => {
          setError(clientError.message);
          appendLog(`browser client error: ${clientError.message}`);
        },
        onReactionBlob: (blob) => {
          setReactionInfo(`${(blob.size / 1024 / 1024).toFixed(2)} MB ${blob.type || "video/webm"}`);
          const nextUrl = URL.createObjectURL(blob);
          setReactionDownloadUrl((current) => {
            if (current) {
              URL.revokeObjectURL(current);
            }
            return nextUrl;
          });
          appendLog(`reaction blob ready (${blob.size} bytes)`);
        },
      });

      clientRef.current = nextClient;

      if (previewRef.current) {
        nextClient.attachPreview(previewRef.current);
      }
      if (compositeRef.current) {
        nextClient.attachComposite(compositeRef.current);
      }

      appendLog("requesting camera and microphone permissions");
      await nextClient.requestPermissions();
      appendLog("starting WHIP publish");
      await nextClient.start();

      scheduleStageProgression(
        startBody.session.id,
        startBody.controlToken,
        startBody.session.countdownSeconds,
        startBody.session.liveSeconds,
      );
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Browser rip test failed";
      setError(message);
      appendLog(message);
      if (createdSessionId && createdControlToken) {
        try {
          await transitionSessionStage(createdSessionId, createdControlToken, "CANCELLED");
        } catch (cancelError) {
          appendLog(
            cancelError instanceof Error ? `session cancel failed: ${cancelError.message}` : "session cancel failed",
          );
        }
      }
      await stopClient();
    } finally {
      setBusy(false);
    }
  }, [
    appendLog,
    buildWhipUploadUrl,
    controlToken,
    ensureSession,
    isAdmin,
    reactionDownloadUrl,
    scheduleStageProgression,
    session,
    stopClient,
    testSession?.id,
    testSession?.status,
    transitionSessionStage,
  ]);

  const cancelTest = useCallback(async () => {
    if (!testSession?.id || !controlToken) {
      await stopClient();
      return;
    }

    setBusy(true);
    try {
      await transitionSessionStage(testSession.id, controlToken, "CANCELLED");
      await stopClient();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Failed to cancel test");
    } finally {
      setBusy(false);
    }
  }, [controlToken, stopClient, testSession?.id, transitionSessionStage]);

  const renderGate = () => {
    if (loading) {
      return <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Checking access...</p>;
    }

    if (!session) {
      return (
        <div className="space-y-4 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Admin Access Only</p>
          <button
            type="button"
            onClick={() => ensureSession().catch(() => undefined)}
            className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black"
          >
            Sign In
          </button>
        </div>
      );
    }

    if (!isAdmin) {
      return (
        <div className="space-y-4 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-rose-300">Access Denied</p>
          <button
            type="button"
            onClick={logout}
            className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-200"
          >
            Sign Out
          </button>
        </div>
      );
    }

    return null;
  };

  if (loading || !session || !isAdmin) {
    return (
      <AppShell>
        <Head>
          <title>Browser Rip Test | Ten Kings</title>
        </Head>
        <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-6 py-16">
          {renderGate()}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Head>
        <title>Browser Rip Test | Ten Kings</title>
      </Head>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.35em] text-gold-400">Dev Surface</p>
            <h1 className="font-heading text-3xl uppercase tracking-[0.14em] text-white">Browser Rip Test</h1>
            <p className="max-w-3xl text-sm text-slate-300">
              Starts a browser-ingest kiosk session on the shared Online location and drives the session through
              countdown, live, reveal, and complete using the new browser client plus kiosk control token.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={busy}
              className="rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-black disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Running..." : "Run Browser Test"}
            </button>
            <button
              type="button"
              onClick={() => void cancelTest()}
              disabled={busy || !testSession}
              className="rounded-full border border-white/20 px-6 py-3 text-xs uppercase tracking-[0.3em] text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel Session
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-white/10 bg-black">
              <video
                ref={previewRef}
                autoPlay
                muted
                playsInline
                className="aspect-video w-full bg-black object-cover"
              />
            </div>
            <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950">
              <canvas ref={compositeRef} width={1280} height={720} className="aspect-video w-full bg-slate-950" />
            </div>
          </div>

          <div className="space-y-4">
            <section className="rounded-lg border border-white/10 bg-white/5 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-white">Session</h2>
              <dl className="mt-4 space-y-3 text-sm text-slate-200">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-400">Kiosk status</dt>
                  <dd>{testSession?.status ?? "idle"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-400">Client stage</dt>
                  <dd>{ripStage}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-400">Session ID</dt>
                  <dd className="max-w-[16rem] truncate">{testSession?.id ?? "--"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-400">Ingest mode</dt>
                  <dd>{testSession?.ingestMode ?? "--"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-400">Playback URL</dt>
                  <dd className="max-w-[16rem] truncate">{playbackUrl ?? "--"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-slate-400">Reaction blob</dt>
                  <dd>{reactionInfo ?? "--"}</dd>
                </div>
              </dl>
              {reactionDownloadUrl ? (
                <a
                  href={reactionDownloadUrl}
                  download="browser-rip-test.webm"
                  className="mt-4 inline-flex text-xs uppercase tracking-[0.24em] text-gold-300"
                >
                  Download reaction recording
                </a>
              ) : null}
            </section>

            <section className="rounded-lg border border-white/10 bg-white/5 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-white">Event Log</h2>
              <div className="mt-4 max-h-[28rem] overflow-y-auto rounded-md border border-white/10 bg-black/30 p-3">
                {logs.length ? (
                  <ul className="space-y-2 text-xs text-slate-300">
                    {logs.map((entry) => (
                      <li key={entry} className="break-words">
                        {entry}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">No events yet.</p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
