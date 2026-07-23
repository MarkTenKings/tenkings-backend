import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AiGraderCalibrationConsole from "../../components/ai-grader/AiGraderCalibrationConsole";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import {
  aiGraderCalibrationActionEnabled,
  aiGraderCalibrationPreviewFresh,
  buildAiGraderCalibrationConsoleFromV1_2,
  buildMockAiGraderCalibrationConsole,
  unavailableAiGraderCalibrationConsole,
  type AiGraderCalibrationConsoleAction,
  type AiGraderCalibrationConsoleViewModel,
} from "../../lib/aiGraderCalibrationConsole";
import { claimAiGraderCalibrationAdminPrompt } from "../../lib/aiGraderCalibrationAuthPrompt";
import {
  listAiGraderCalibrationActivationsV1,
  readAiGraderCalibrationActivationStatusV1,
  resolveTrustedAiGraderCalibrationRegistryV1,
  runAiGraderCalibrationActivationWorkflowV1,
  type AiGraderCalibrationSnapshotProjectionV1,
} from "../../lib/aiGraderCalibrationActivationClient";
import {
  resolveAiGraderCalibrationRegistryForConsoleV1,
} from "../../lib/aiGraderCalibrationRegistryResolver";
import {
  listMathematicalCalibrationV1_2Sessions,
  mutateMathematicalCalibrationV1_2Session,
  readMathematicalCalibrationV1_2Status,
  replaceMathematicalCalibrationV1_2Pose,
  startMathematicalCalibrationV1_2Session,
} from "../../lib/aiGraderMathematicalCalibrationV1_2Client";
import type {
  MathematicalCalibrationV1_2SessionListItemDto,
  MathematicalCalibrationV1_2SessionStatusDto,
} from "../../lib/aiGraderMathematicalCalibrationV1_2Contract";
import {
  AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY,
  AI_GRADER_STATION_TOKEN_STORAGE_KEY,
  DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
  callAiGraderStationBridge,
  openAiGraderStationPreviewStream,
} from "../../lib/aiGraderStationBridgeClient";
import type { AiGraderCalibrationRegistryConsoleState } from "../../components/ai-grader/AiGraderCalibrationConsole";
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
const AI_GRADER_CALIBRATION_V1_2_SESSION_STORAGE_KEY = "tenkings.aiGraderCalibration.v1_2SessionId";
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

function pairedStationCredentials() {
  if (typeof window === "undefined") throw new Error("The paired local station is available only in the browser.");
  const stationToken = window.localStorage.getItem(AI_GRADER_STATION_TOKEN_STORAGE_KEY)?.trim() ?? "";
  const baseUrl = window.localStorage.getItem(AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY)?.trim()
    || DEFAULT_AI_GRADER_STATION_BRIDGE_URL;
  if (!stationToken) throw new Error("Pair this browser at the grading station before calibration.");
  return { stationToken, baseUrl };
}

function noSessionConsole(resume?: MathematicalCalibrationV1_2SessionListItemDto): AiGraderCalibrationConsoleViewModel {
  const base = unavailableAiGraderCalibrationConsole();
  const available = (enabled: boolean, reason: string) => ({ available: enabled, authorityPresent: true, reason });
  return {
    ...base,
    source: "authoritative_bridge",
    contractVersion: "1.2.0",
    title: "Mathematical Calibration V1.2",
    summary: resume
      ? "The paired helper preserved the exact incomplete session. Resume uses its server-issued revision."
      : "Start a new helper-owned calibration. The browser supplies no operation, role, channel, sample, or rig authority.",
    hardFailure: undefined,
    actions: {
      ...base.actions,
      start_new: available(true, "Start one new helper-owned V1.2 session."),
      resume: available(Boolean(resume), resume ? "Resume the exact preserved session and revision." : "No exact preserved browser-bound session is available."),
      exit: available(true, "Return safely to grading."),
    },
  };
}

export default function AiGraderCalibrationPage() {
  const router = useRouter();
  const { session, loading: sessionLoading, ensureSession } = useSession();
  const requestedMock = typeof router.query.mock === "string" && MOCK_SCENARIOS.has(router.query.mock)
    ? router.query.mock as "incomplete" | "failed" | "pass"
    : null;
  const localMock = process.env.NODE_ENV !== "production" ? requestedMock : null;
  const isAdmin = hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone);
  const [model, setModel] = useState<AiGraderCalibrationConsoleViewModel>(() => unavailableAiGraderCalibrationConsole());
  const [v1_2Status, setV1_2Status] = useState<MathematicalCalibrationV1_2SessionStatusDto>();
  const [resumeItem, setResumeItem] = useState<MathematicalCalibrationV1_2SessionListItemDto>();
  const [busyAction, setBusyAction] = useState<AiGraderCalibrationConsoleAction>();
  const [registryState, setRegistryState] = useState<AiGraderCalibrationRegistryConsoleState>({ loading: false });
  const [registryBusy, setRegistryBusy] = useState(false);
  const displayModel = useMemo(
    () => localMock ? buildMockAiGraderCalibrationConsole(localMock) : model,
    [localMock, model],
  );
  const [message, setMessage] = useState("");
  const [previewDetail, setPreviewDetail] = useState("Waiting for an authoritative calibration preview epoch.");
  const initialBinding = displayModel.source === "authoritative_bridge" ? displayModel.previewBinding : undefined;
  const [previewEpochState, setPreviewEpochState] = useState<AiGraderPreviewEpochState>(() => createAiGraderPreviewEpochState(initialBinding));
  const previewEpochStateRef = useRef(previewEpochState);
  const automaticAdminPromptClaimRef = useRef(false);
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());

  useEffect(() => {
    previewEpochStateRef.current = previewEpochState;
  }, [previewEpochState]);

  useEffect(() => {
    if (session) {
      automaticAdminPromptClaimRef.current = false;
      return;
    }
    if (
      !router.isReady
      || localMock
      || sessionLoading
      || !claimAiGraderCalibrationAdminPrompt(automaticAdminPromptClaimRef)
    ) return;
    void ensureSession({ message: "Admin authentication is required to open calibration." }).catch(() => undefined);
  }, [ensureSession, localMock, router.isReady, session, sessionLoading]);

  const applyV1_2Status = useCallback((status: MathematicalCalibrationV1_2SessionStatusDto) => {
    setV1_2Status(status);
    setModel(buildAiGraderCalibrationConsoleFromV1_2(status));
    window.localStorage.setItem(AI_GRADER_CALIBRATION_V1_2_SESSION_STORAGE_KEY, status.sessionId);
  }, []);

  const refreshCore = useCallback(async () => {
    const credentials = pairedStationCredentials();
    const listed = await listMathematicalCalibrationV1_2Sessions(credentials);
    const savedSessionId = window.localStorage.getItem(AI_GRADER_CALIBRATION_V1_2_SESSION_STORAGE_KEY)?.trim();
    const saved = savedSessionId ? listed.sessions.find((item) => item.sessionId === savedSessionId) : undefined;
    setResumeItem(saved);
    if (!saved) {
      setV1_2Status(undefined);
      setModel(noSessionConsole());
      return;
    }
    const status = await readMathematicalCalibrationV1_2Status({ ...credentials, sessionId: saved.sessionId });
    if (status.revision !== saved.revision) {
      setResumeItem({ ...saved, revision: status.revision });
    }
    applyV1_2Status(status);
  }, [applyV1_2Status]);

  const refreshRegistry = useCallback(async (tokenOverride?: string) => {
    const token = tokenOverride?.trim() || session?.token?.trim() || "";
    if (!token) return;
    setRegistryState((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const credentials = pairedStationCredentials();
      const resolved = await resolveAiGraderCalibrationRegistryForConsoleV1({
        readLocalRigId: async () => {
          const stationStatus = await callAiGraderStationBridge({ ...credentials, action: "status" });
          return stationStatus.mathematicalCalibration?.rigId;
        },
        listByRigId: (rigId) => listAiGraderCalibrationActivationsV1({
          token,
          rigId,
          includeIncomplete: true,
        }),
        readStatusByRigId: (rigId) => readAiGraderCalibrationActivationStatusV1({ token, rigId }),
        resolveSoleHostedTrusted: () => resolveTrustedAiGraderCalibrationRegistryV1({ token }),
      });
      setRegistryState({ loading: false, registry: resolved.registry, status: resolved.status });
    } catch (error) {
      setRegistryState({
        loading: false,
        error: error instanceof Error ? error.message : "Hosted calibration registry is unavailable.",
      });
    }
  }, [session?.token]);

  useEffect(() => {
    if (!router.isReady || localMock || sessionLoading || !isAdmin || !session?.token) return;
    void refreshCore().catch((error) => {
      setModel(unavailableAiGraderCalibrationConsole(error instanceof Error ? error.message : "V1.2 local session authority is unavailable."));
    });
    void refreshRegistry();
  }, [isAdmin, localMock, refreshCore, refreshRegistry, router.isReady, session?.token, sessionLoading]);

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

  const handleAction = useCallback(async (
    action: AiGraderCalibrationConsoleAction,
    input?: Record<string, unknown>,
  ) => {
    if (action === "exit") {
      void router.push("/ai-grader/station");
      return;
    }
    if (localMock) {
      setMessage("Mocked-data review only: no helper, camera, lighting, registry, or Production mutation was performed.");
      return;
    }
    if (action === "activate" || action === "reactivate") {
      setMessage("Use the exact hosted registry selection below. Core V1.2 never owns activation.");
      return;
    }
    const selectedPoseNumber = typeof input?.selectedPoseNumber === "number" ? input.selectedPoseNumber : undefined;
    const replacementWarningConfirmed = input?.replacementWarningConfirmed === true;
    if (!aiGraderCalibrationActionEnabled({
      model: displayModel,
      action,
      previewFresh,
      selectedPoseNumber,
      replacementWarningConfirmed,
    })) {
      setMessage(displayModel.actions[action].reason);
      return;
    }
    const credentials = pairedStationCredentials();
    setBusyAction(action);
    setMessage("");
    try {
      let next: MathematicalCalibrationV1_2SessionStatusDto;
      if (action === "start_new") {
        next = await startMathematicalCalibrationV1_2Session({ ...credentials, request: {} });
      } else if (action === "resume") {
        if (!resumeItem) throw new Error("No exact preserved session/revision is selected for resume.");
        next = await startMathematicalCalibrationV1_2Session({
          ...credentials,
          request: { resumeSessionId: resumeItem.sessionId, expectedRevision: resumeItem.revision },
        });
      } else {
        if (!v1_2Status) throw new Error("Refresh the exact V1.2 session before mutation.");
        const request = { sessionId: v1_2Status.sessionId, expectedRevision: v1_2Status.revision };
        if (action === "replace_selected_pose") {
          if (!selectedPoseNumber || selectedPoseNumber < 1 || selectedPoseNumber > 4 || !replacementWarningConfirmed) {
            throw new Error("Exact accepted pose selection and immutable-history acknowledgement are required.");
          }
          next = await replaceMathematicalCalibrationV1_2Pose({
            ...credentials,
            request: { ...request, acceptedSlot: selectedPoseNumber as 1 | 2 | 3 | 4 },
          });
        } else if (action === "retry_current_pose") {
          next = await mutateMathematicalCalibrationV1_2Session({ ...credentials, action: "retry", request });
        } else if (action === "analyze") {
          next = await mutateMathematicalCalibrationV1_2Session({ ...credentials, action: "analyze", request });
        } else if (action === "finalize") {
          next = await mutateMathematicalCalibrationV1_2Session({ ...credentials, action: "finalize", request });
        } else if (action === "begin_or_resume_automatic_sweep") {
          next = v1_2Status;
          for (let step = 0; step < 73 && next.phase === "photometric_sweep"; step += 1) {
            next = await mutateMathematicalCalibrationV1_2Session({
              ...credentials,
              action: "capture",
              request: { sessionId: next.sessionId, expectedRevision: next.revision },
            });
            applyV1_2Status(next);
          }
          if (next.phase === "photometric_sweep") {
            throw new Error("Automatic sweep stopped before the helper reached its exact next phase.");
          }
        } else {
          next = await mutateMathematicalCalibrationV1_2Session({ ...credentials, action: "capture", request });
        }
      }
      applyV1_2Status(next);
      setMessage(`Exact helper state updated to revision ${next.revision.slice(0, 12)}.`);
    } catch (error) {
      if (v1_2Status?.sessionId) {
        try {
          applyV1_2Status(await readMathematicalCalibrationV1_2Status({
            ...credentials,
            sessionId: v1_2Status.sessionId,
          }));
        } catch {
          // Preserve the original failure; no stale client state authorizes another mutation.
        }
      }
      setMessage(error instanceof Error ? error.message : "Calibration mutation failed closed.");
    } finally {
      setBusyAction(undefined);
    }
  }, [
    applyV1_2Status,
    displayModel,
    localMock,
    previewFresh,
    resumeItem,
    router,
    v1_2Status,
  ]);

  const handleRegistryActivation = useCallback(async (input: {
    action: "activate" | "reactivate";
    snapshot: AiGraderCalibrationSnapshotProjectionV1;
    priorActivationId?: string;
    expectedRegistryRevision: string;
    reason: string;
  }) => {
    setRegistryBusy(true);
    setMessage("");
    try {
      const freshSession = await ensureSession({
        force: true,
        message: "Enter a fresh human-admin SMS code to activate this exact calibration.",
      });
      if (!hasAdminAccess(freshSession.user.id) && !hasAdminPhoneAccess(freshSession.user.phone)) {
        throw new Error("Fresh authentication did not produce a human-admin session.");
      }
      const credentials = pairedStationCredentials();
      const result = await runAiGraderCalibrationActivationWorkflowV1({
        freshAdminToken: freshSession.token,
        ...credentials,
        selection: input,
      });
      setMessage(`Exact activation ${result.completed.activation.activationId} is hosted and locally ACTIVE.`);
      await refreshRegistry(freshSession.token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Calibration activation failed closed.");
    } finally {
      setRegistryBusy(false);
    }
  }, [ensureSession, refreshRegistry]);

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
        busyAction={busyAction}
        message={message}
        onAction={handleAction}
        registryState={localMock ? undefined : registryState}
        registryBusy={registryBusy}
        onRefreshRegistry={() => void refreshRegistry()}
        onRegistryActivation={(input) => void handleRegistryActivation(input)}
      />
      <style jsx>{`.mock-banner{position:sticky;top:0;z-index:20;background:#7b5415;color:#fff5d6;padding:7px 12px;text-align:center;font:800 12px/1.3 system-ui;letter-spacing:.04em}`}</style>
    </>
  );
}
