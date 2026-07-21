import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AiGraderCalibrationConsole from "../../components/ai-grader/AiGraderCalibrationConsole";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import {
  aiGraderCalibrationPreviewFresh,
  buildMockAiGraderCalibrationConsole,
  unavailableAiGraderCalibrationConsole,
  type AiGraderCalibrationConsoleAction,
  type AiGraderCalibrationConsoleViewModel,
} from "../../lib/aiGraderCalibrationConsole";
import {
  AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY,
  AI_GRADER_STATION_TOKEN_STORAGE_KEY,
  DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
  openAiGraderStationPreviewStream,
} from "../../lib/aiGraderStationBridgeClient";
import {
  aiGraderPreviewBindingMatches,
  aiGraderPreviewDisplayedSnapshot,
  createAiGraderPreviewEpochState,
  sanitizeAiGraderPreviewFrameBinding,
  transitionAiGraderPreviewEpoch,
  type AiGraderPreviewEpochEvent,
  type AiGraderPreviewEpochState,
} from "../../lib/aiGraderPreviewLifecycle";

const MOCK_SCENARIOS = new Set(["incomplete", "failed", "pass"]);
const MOCK_PREVIEW_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2448 2048">
    <defs>
      <pattern id="grid" width="180" height="180" patternUnits="userSpaceOnUse">
        <rect width="180" height="180" fill="#ddd7ca"/>
        <rect width="90" height="90" fill="#242521"/>
        <rect x="90" y="90" width="90" height="90" fill="#242521"/>
      </pattern>
      <radialGradient id="light"><stop stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></radialGradient>
    </defs>
    <rect width="2448" height="2048" fill="#171915"/>
    <g transform="translate(450 210) rotate(2.1 700 780)">
      <rect width="1400" height="1560" rx="4" fill="url(#grid)"/>
      <rect width="1400" height="1560" rx="4" fill="url(#light)"/>
    </g>
    <text x="34" y="1990" fill="#c9c4b7" font-family="system-ui" font-size="36">Mocked Basler frame · no camera access</text>
  </svg>
`)}`;

function applyEpochEvent(
  stateRef: React.MutableRefObject<AiGraderPreviewEpochState>,
  setState: React.Dispatch<React.SetStateAction<AiGraderPreviewEpochState>>,
  event: AiGraderPreviewEpochEvent,
) {
  const transition = transitionAiGraderPreviewEpoch(stateRef.current, event);
  stateRef.current = transition.state;
  setState(transition.state);
  for (const objectUrl of transition.revokeObjectUrls) window.URL.revokeObjectURL(objectUrl);
  return transition;
}

export default function AiGraderCalibrationPage() {
  const router = useRouter();
  const { session, loading: sessionLoading, ensureSession } = useSession();
  const requestedMock = typeof router.query.mock === "string" && MOCK_SCENARIOS.has(router.query.mock)
    ? router.query.mock as "incomplete" | "failed" | "pass"
    : null;
  const localMock = process.env.NODE_ENV !== "production" ? requestedMock : null;
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  const [model] = useState<AiGraderCalibrationConsoleViewModel>(() => unavailableAiGraderCalibrationConsole());
  const displayModel = useMemo(
    () => localMock ? buildMockAiGraderCalibrationConsole(localMock) : model,
    [localMock, model],
  );
  const [message, setMessage] = useState("");
  const [previewDetail, setPreviewDetail] = useState("Waiting for an authoritative calibration preview epoch.");
  const initialBinding = displayModel.source === "authoritative_bridge" ? displayModel.previewBinding : undefined;
  const [previewEpochState, setPreviewEpochState] = useState<AiGraderPreviewEpochState>(() => createAiGraderPreviewEpochState(initialBinding));
  const previewEpochStateRef = useRef(previewEpochState);
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());

  useEffect(() => {
    previewEpochStateRef.current = previewEpochState;
  }, [previewEpochState]);

  useEffect(() => {
    if (!router.isReady || localMock || sessionLoading || session) return;
    void ensureSession({ message: "Admin authentication is required to open calibration." }).catch(() => undefined);
  }, [ensureSession, localMock, router.isReady, session, sessionLoading]);

  useEffect(() => {
    const binding = displayModel.source === "authoritative_bridge" ? displayModel.previewBinding : undefined;
    const currentBinding = previewEpochStateRef.current.binding;
    if (
      (binding && !aiGraderPreviewBindingMatches(binding, currentBinding)) ||
      (!binding && currentBinding)
    ) {
      applyEpochEvent(previewEpochStateRef, setPreviewEpochState, { type: "bind", binding });
    }
    if (!binding || !displayModel.sessionId || typeof window === "undefined") return;

    const stationToken = window.localStorage.getItem(AI_GRADER_STATION_TOKEN_STORAGE_KEY)?.trim() ?? "";
    const bridgeUrl = window.localStorage.getItem(AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY)?.trim()
      || DEFAULT_AI_GRADER_STATION_BRIDGE_URL;
    if (!stationToken) {
      setPreviewDetail("Pair this browser at the grading station first. Pairing tokens remain in browser storage and are never placed in URLs.");
      return;
    }

    let active = true;
    const controller = new AbortController();
    setPreviewDetail("Connecting to the paired local Basler preview.");
    const reader = openAiGraderStationPreviewStream(
      {
        baseUrl: bridgeUrl,
        stationToken,
        mathematicalCalibrationSessionId: displayModel.sessionId,
      },
      {
        signal: controller.signal,
        onOpen() {
          if (active) {
            applyEpochEvent(previewEpochStateRef, setPreviewEpochState, { type: "opened", binding });
            setPreviewDetail("Connected; waiting for a fresh exact frame.");
          }
        },
        onFrame(frame) {
          if (!active) return;
          const frameBinding = sanitizeAiGraderPreviewFrameBinding(frame);
          if (!frameBinding || !aiGraderPreviewBindingMatches(frameBinding, binding)) return;
          const objectUrl = window.URL.createObjectURL(frame.blob);
          const receivedAtMs = Date.now();
          const transition = applyEpochEvent(previewEpochStateRef, setPreviewEpochState, {
            type: "frame",
            frame: frameBinding,
            objectUrl,
            receivedAtMs,
            capturedAt: frame.capturedAt,
          });
          if (!transition.accepted) return;
          const image = new window.Image();
          image.onload = () => {
            if (!active) return;
            applyEpochEvent(previewEpochStateRef, setPreviewEpochState, {
              type: "image_loaded",
              frame: frameBinding,
              loadedAtMs: Date.now(),
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
          };
          image.src = objectUrl;
          setFreshnessNow(receivedAtMs);
          setPreviewDetail("Live Basler stream bound to the exact server-issued calibration epoch.");
        },
        onEof() {
          if (active) setPreviewDetail("Preview ended safely. It will reconnect after the authoritative session revision changes.");
        },
        onState(event) {
          if (active) setPreviewDetail(event.message);
        },
        onError(error) {
          if (active) setPreviewDetail(error.message);
        },
      },
    );
    void reader.catch(() => undefined);
    const freshnessTimer = window.setInterval(() => {
      const nowMs = Date.now();
      setFreshnessNow(nowMs);
      applyEpochEvent(previewEpochStateRef, setPreviewEpochState, { type: "tick", nowMs });
    }, 250);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(freshnessTimer);
      applyEpochEvent(previewEpochStateRef, setPreviewEpochState, { type: "clear", status: "stopped" });
    };
  }, [
    displayModel.eventHeadSha256,
    displayModel.previewBinding,
    displayModel.previewBinding?.sessionId,
    displayModel.previewBinding?.side,
    displayModel.previewBinding?.sideEpoch,
    displayModel.sessionId,
    displayModel.sessionRevision,
    displayModel.source,
  ]);

  const displayedPreview = aiGraderPreviewDisplayedSnapshot(previewEpochState);
  const previewFresh = localMock ? true : aiGraderCalibrationPreviewFresh(previewEpochState, freshnessNow);
  const previewUrl = localMock ? MOCK_PREVIEW_DATA_URL : displayedPreview?.objectUrl ?? null;
  const previewStatusLabel = localMock
    ? "Mocked preview"
    : previewFresh
      ? "Basler live · fresh"
      : "Basler preview unavailable";

  const handleAction = useCallback((action: AiGraderCalibrationConsoleAction) => {
    if (action === "exit") {
      void router.push("/ai-grader/station");
      return;
    }
    if (localMock) {
      setMessage("Mocked-data review only: no helper, camera, lighting, registry, or Production mutation was performed.");
      return;
    }
    setMessage("This action is blocked because its reviewed authoritative contract is not available. The browser did not invent a request.");
  }, [localMock, router]);

  if (!router.isReady || (!localMock && sessionLoading)) {
    return <main className="gate"><p>Checking admin access…</p><style jsx>{`.gate{min-height:100vh;display:grid;place-items:center;background:#0b0d0c;color:#f5f1e7;font-family:system-ui}`}</style></main>;
  }

  if (!localMock && !isAdmin) {
    return (
      <main className="gate">
        <Head><title>Calibration Admin Access Required | Ten Kings</title><meta name="robots" content="noindex,nofollow" /></Head>
        <section role="alert">
          <p>Ten Kings AI Grader</p>
          <h1>Admin access required</h1>
          <p>The calibration console is restricted to an authenticated Ten Kings human administrator.</p>
          <button type="button" onClick={() => void ensureSession({ force: true, message: "Admin authentication is required to open calibration." })}>Sign in as administrator</button>
          <button type="button" onClick={() => void router.push("/ai-grader/station")}>Return to grading</button>
        </section>
        <style jsx>{`.gate{min-height:100vh;display:grid;place-items:center;background:#0b0d0c;color:#f5f1e7;font-family:system-ui;padding:24px}.gate section{max-width:540px;border:1px solid #4c5048;background:#131612;padding:26px}.gate h1{font-size:32px}.gate p{line-height:1.5;color:#c8c1b1}.gate button{min-height:44px;margin:8px 8px 0 0;border:1px solid #c9a85f;border-radius:5px;background:#c9a85f;color:#17140d;padding:9px 13px;font-weight:800}`}</style>
      </main>
    );
  }

  return (
    <>
      <Head><title>AI Grader Calibration | Ten Kings</title><meta name="robots" content="noindex,nofollow" /></Head>
      {localMock ? <div className="mock-banner" role="status">Local mocked data · no API, helper, hardware, registry, or Production mutation</div> : null}
      <AiGraderCalibrationConsole
        model={displayModel}
        previewUrl={previewUrl}
        previewFresh={previewFresh}
        previewStatusLabel={previewStatusLabel}
        previewDetail={previewDetail}
        message={message}
        onAction={handleAction}
      />
      <style jsx>{`.mock-banner{position:sticky;top:0;z-index:20;background:#7b5415;color:#fff5d6;padding:7px 12px;text-align:center;font:800 12px/1.3 system-ui;letter-spacing:.04em}`}</style>
    </>
  );
}
