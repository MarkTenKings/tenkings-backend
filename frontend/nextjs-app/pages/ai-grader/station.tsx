import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import {
  AI_GRADER_STATION_STEPS,
  buildAiGraderLocalStationStatus,
  buildSampleAiGraderReportHistory,
  type AiGraderLocalReportHistory,
  type AiGraderLocalReportHistoryItem,
  type AiGraderLocalStationStatus,
  type AiGraderStationAction,
} from "../../lib/aiGraderLocalStation";
import {
  AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY,
  AI_GRADER_STATION_TOKEN_STORAGE_KEY,
  DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
  callAiGraderStationBridge,
  fetchAiGraderStationReportHistory,
} from "../../lib/aiGraderStationBridgeClient";

type HistorySort = "most_recent" | "oldest" | "grade" | "category";
type HistoryView = "list" | "tiles";

async function callStationContract(action: AiGraderStationAction): Promise<AiGraderLocalStationStatus> {
  const method = action === "status" || action === "latest-report" || action === "session-manifest" ? "GET" : "POST";
  const response = await fetch(`/api/ai-grader/station/${action}`, { method });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? "AI Grader station action failed.");
  }
  return payload.result;
}

function formatMs(ms?: number) {
  if (typeof ms !== "number") return "pending";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function reportUrlFor(item: AiGraderLocalReportHistoryItem) {
  return item.viewerPath || `/ai-grader/reports/${encodeURIComponent(item.reportId)}`;
}

function sortHistory(items: AiGraderLocalReportHistoryItem[], sort: HistorySort) {
  const sorted = [...items];
  if (sort === "oldest") {
    return sorted.sort((a, b) => String(a.generatedAt ?? "").localeCompare(String(b.generatedAt ?? "")));
  }
  if (sort === "grade") {
    return sorted.sort((a, b) => (b.provisionalOverallGrade ?? -1) - (a.provisionalOverallGrade ?? -1));
  }
  if (sort === "category") {
    return sorted.sort((a, b) => String(a.category ?? "Unknown").localeCompare(String(b.category ?? "Unknown")));
  }
  return sorted.sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")));
}

export default function AiGraderStationPage() {
  const [status, setStatus] = useState<AiGraderLocalStationStatus>(() => buildAiGraderLocalStationStatus({ action: "status" }));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_AI_GRADER_STATION_BRIDGE_URL);
  const [stationToken, setStationToken] = useState("");
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [contractPreviewEnabled, setContractPreviewEnabled] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyView, setHistoryView] = useState<HistoryView>("list");
  const [historySort, setHistorySort] = useState<HistorySort>("most_recent");
  const [history, setHistory] = useState<AiGraderLocalReportHistory>(() => buildSampleAiGraderReportHistory());
  const [profileDraft, setProfileDraft] = useState({
    dutyPercent: status.acceptedProfile.dutyPercent,
    exposureUs: status.acceptedProfile.exposureUs,
    gain: status.acceptedProfile.gain,
  });

  useEffect(() => {
    const savedBridgeUrl = window.localStorage.getItem(AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY);
    const savedToken = window.localStorage.getItem(AI_GRADER_STATION_TOKEN_STORAGE_KEY);
    if (savedBridgeUrl) setBridgeUrl(savedBridgeUrl);
    if (savedToken) setStationToken(savedToken);
  }, []);

  const currentStep = useMemo(
    () => AI_GRADER_STATION_STEPS.find((step) => step.id === status.currentStep) ?? AI_GRADER_STATION_STEPS[0],
    [status.currentStep]
  );

  const sortedHistory = useMemo(() => sortHistory(history.items, historySort), [history.items, historySort]);
  const reportReady = status.latestReport.exists && Boolean(status.latestReport.reportId);
  const showFlipScrim = status.currentStep === "prompt_flip_card";
  const canUseBridge = bridgeConnected || contractPreviewEnabled;

  const refreshHistory = async () => {
    if (!bridgeConnected) {
      setHistory(buildSampleAiGraderReportHistory());
      return;
    }
    const nextHistory = await fetchAiGraderStationReportHistory({ baseUrl: bridgeUrl, stationToken });
    setHistory(nextHistory);
  };

  const connectBridge = async () => {
    setBusy("connect");
    setError(null);
    try {
      const next = await callAiGraderStationBridge({ baseUrl: bridgeUrl, stationToken, action: "status" });
      window.localStorage.setItem(AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY, bridgeUrl);
      window.localStorage.setItem(AI_GRADER_STATION_TOKEN_STORAGE_KEY, stationToken);
      setStatus(next);
      setBridgeConnected(true);
      setProfileDraft({
        dutyPercent: next.acceptedProfile.dutyPercent,
        exposureUs: next.acceptedProfile.exposureUs,
        gain: next.acceptedProfile.gain,
      });
      setHistory(await fetchAiGraderStationReportHistory({ baseUrl: bridgeUrl, stationToken }));
    } catch (requestError) {
      setBridgeConnected(false);
      setError(requestError instanceof Error ? requestError.message : "AI Grader station bridge connection failed.");
    } finally {
      setBusy(null);
    }
  };

  const actionBody = (
    overrides: Record<string, unknown> = {},
    sourceStatus: AiGraderLocalStationStatus = status,
    useDraftProfile = true
  ) => {
    const profile = useDraftProfile
      ? {
          dutyPercent: Number(profileDraft.dutyPercent),
          exposureUs: Number(profileDraft.exposureUs),
          gain: Number(profileDraft.gain),
          channels: sourceStatus.acceptedProfile.channels,
          source: "bridge_operator",
        }
      : {
          dutyPercent: sourceStatus.acceptedProfile.dutyPercent,
          exposureUs: sourceStatus.acceptedProfile.exposureUs,
          gain: sourceStatus.acceptedProfile.gain,
          channels: sourceStatus.acceptedProfile.channels,
          source: sourceStatus.acceptedProfile.source,
        };
    return {
    confirmations: {
      lightIdleOff: true,
      fixtureRulersVisible: true,
      ...overrides,
    },
      acceptedProfile: profile,
    };
  };

  const runAction = async (action: AiGraderStationAction, body?: Record<string, unknown>) => {
    const next = bridgeConnected
      ? await callAiGraderStationBridge({ baseUrl: bridgeUrl, stationToken, action, body })
      : contractPreviewEnabled
        ? await callStationContract(action)
        : (() => {
            throw new Error("Connect the Dell local station bridge before running station actions.");
          })();
    setStatus(next);
    setProfileDraft({
      dutyPercent: next.acceptedProfile.dutyPercent,
      exposureUs: next.acceptedProfile.exposureUs,
      gain: next.acceptedProfile.gain,
    });
    return next;
  };

  const startNewCard = async () => {
    setBusy("start");
    setError(null);
    try {
      await runAction("start-session");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not start an AI Grader card session.");
    } finally {
      setBusy(null);
    }
  };

  const startGrading = async () => {
    setBusy("start-grading");
    setError(null);
    try {
      if (!canUseBridge) throw new Error("Connect the Dell local station bridge before starting grading.");
      let latest = status;
      if (latest.currentStep === "start_new_card") latest = await runAction("start-session");
      latest = await runAction("confirm-light-idle-off", actionBody({ lightIdleOff: true }, latest, false));
      latest = await runAction("confirm-fixture-rulers", actionBody({ fixtureRulersVisible: true }, latest, false));
      if (latest.currentStep === "verify_fixture_rulers" || latest.currentStep === "live_preview_focus_framing" || latest.currentStep === "start_new_card") {
        latest = await runAction("launch-preview", actionBody({}, latest, false));
      }
      latest = await runAction("accept-profile", actionBody({}, latest, false));
      await runAction("capture-front", actionBody({}, latest, false));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Start grading failed.");
    } finally {
      setBusy(null);
    }
  };

  const confirmFlipAndContinue = async () => {
    setBusy("back");
    setError(null);
    try {
      await runAction("confirm-flip", { confirmations: { flipComplete: true } });
      await runAction("capture-back", { confirmations: { flipComplete: true, lightIdleOff: true, fixtureRulersVisible: true } });
      await runAction("run-diagnostics");
      await runAction("export-report-bundle");
      await refreshHistory();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Back capture or report generation failed.");
    } finally {
      setBusy(null);
    }
  };

  const safeOff = async () => {
    setBusy("safe-off");
    setError(null);
    try {
      await runAction("safe-off", { confirmations: { finalLightOff: true, lightIdleOff: true } });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Safe Off failed.");
    } finally {
      setBusy(null);
    }
  };

  const openReport = () => {
    if (!reportReady) {
      setError("No generated report is ready yet.");
      return;
    }
    window.localStorage.setItem(AI_GRADER_STATION_BRIDGE_URL_STORAGE_KEY, bridgeUrl);
    window.localStorage.setItem(AI_GRADER_STATION_TOKEN_STORAGE_KEY, stationToken);
    window.open(status.latestReport.localViewerPath, "_blank", "noopener,noreferrer");
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setError(null);
    try {
      await refreshHistory();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load local AI Grader report history.");
    }
  };

  return (
    <>
      <Head>
        <title>Ten Kings AI Grader Station</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="station">
        <section className="viewer" aria-label="AI Grader camera cockpit">
          <div className="camera-frame">
            <div className="guide-card" />
            <div className="crosshair horizontal" />
            <div className="crosshair vertical" />
            <div className="camera-status">
              <span>{bridgeConnected ? "Dell bridge connected" : "Bridge disconnected"}</span>
              <strong>{currentStep.label}</strong>
              <p>
                Embedded browser Basler streaming is pending. The real low-latency pylon preview opens in the native Windows
                preview window from this cockpit.
              </p>
            </div>
          </div>

          {!bridgeConnected ? (
            <div className="connect-scrim">
              <div>
                <p className="eyebrow">Ten Kings AI Grader</p>
                <h1>Connect AI Grader Station</h1>
                <p>Connect this browser to the local Dell bridge before running hardware. Public report pages never expose controls.</p>
                <label>
                  Bridge URL
                  <input value={bridgeUrl} onChange={(event) => setBridgeUrl(event.target.value)} />
                </label>
                <label>
                  Station Token
                  <input value={stationToken} onChange={(event) => setStationToken(event.target.value)} type="password" />
                </label>
                <button type="button" onClick={connectBridge} disabled={busy !== null}>
                  {busy === "connect" ? "Connecting" : "Connect"}
                </button>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={contractPreviewEnabled}
                    onChange={(event) => setContractPreviewEnabled(event.target.checked)}
                  />
                  Contract preview only
                </label>
              </div>
            </div>
          ) : null}

          {showFlipScrim ? (
            <div className="flip-scrim">
              <div>
                <h2>Flip Card to Back</h2>
                <p>Seat the card in the fixture, then continue. The system will capture the back and generate the report.</p>
                <button type="button" onClick={confirmFlipAndContinue} disabled={busy !== null}>
                  {busy === "back" ? "Capturing Back" : "Confirm Back Is Ready"}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="sidebar">
          <div className="brand">
            <span>Ten Kings</span>
            <strong>AI Grader Station</strong>
          </div>

          {error ? <div className="error">{error}</div> : null}

          <section className="next-card">
            <p className="eyebrow">Current Step</p>
            <h2>{currentStep.label}</h2>
            <p>{currentStep.operatorAction}</p>
            <button type="button" className="primary" onClick={startNewCard} disabled={busy !== null}>
              {busy === "start" ? "Starting" : "Start New Card"}
            </button>
            <button type="button" className="start-grading" onClick={startGrading} disabled={busy !== null}>
              {busy === "start-grading" ? "Working" : "Start Grading"}
            </button>
          </section>

          <section className="profile">
            <div>
              <span>Duty</span>
              <strong>{profileDraft.dutyPercent}%</strong>
            </div>
            <div>
              <span>Exposure</span>
              <strong>{profileDraft.exposureUs} us</strong>
            </div>
            <div>
              <span>Gain</span>
              <strong>{profileDraft.gain}</strong>
            </div>
            <label>
              Duty %
              <input
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={profileDraft.dutyPercent}
                onChange={(event) => setProfileDraft((current) => ({ ...current, dutyPercent: Number(event.target.value) }))}
              />
            </label>
            <label>
              Exposure us
              <input
                type="number"
                min="1"
                max="100000"
                step="1000"
                value={profileDraft.exposureUs}
                onChange={(event) => setProfileDraft((current) => ({ ...current, exposureUs: Number(event.target.value) }))}
              />
            </label>
          </section>

          <section className="status">
            <div>
              <span>Report</span>
              <strong>{reportReady ? "Ready" : "Pending"}</strong>
            </div>
            <div>
              <span>Safe Off</span>
              <strong>{status.confirmations?.finalLightOff ? "Confirmed" : "Available"}</strong>
            </div>
            <div>
              <span>Bridge</span>
              <strong>{status.mode}</strong>
            </div>
          </section>

          <div className="action-row">
            <button type="button" onClick={openReport} disabled={!reportReady}>
              View Report
            </button>
            <button type="button" onClick={openHistory}>
              Card History Reports
            </button>
          </div>

          <button type="button" className="safe" onClick={safeOff} disabled={busy !== null}>
            {busy === "safe-off" ? "Safe Off Running" : "Safe Off / End Session"}
          </button>

          <section className="paths">
            <p>Station URL: http://127.0.0.1:3020/ai-grader/station</p>
            <p>Bridge: {bridgeUrl}</p>
            <p>Report path: {status.latestReport.localHtmlPath ?? "pending"}</p>
            <p>Bundle: {status.outputs?.reportBundlePath ?? "pending"}</p>
          </section>

          <section className="timing">
            <p className="eyebrow">Timing</p>
            <dl>
              <dt>Capture commands</dt>
              <dd>{formatMs(status.timingSummary?.captureCommandMs)}</dd>
              <dt>Report generation</dt>
              <dd>{formatMs(status.timingSummary?.reportGenerationMs)}</dd>
              <dt>Safe off</dt>
              <dd>{formatMs(status.timingSummary?.safeOffMs)}</dd>
            </dl>
          </section>
        </aside>

        <section className={historyOpen ? "history open" : "history"} aria-label="AI Grader report history">
          <button type="button" className="close-history" onClick={() => setHistoryOpen(false)} aria-label="Close report history">
            X
          </button>
          <div className="history-head">
            <div>
              <p className="eyebrow">Card History Reports</p>
              <h2>Local AI Grader sessions</h2>
            </div>
            <div className="history-controls">
              <select value={historySort} onChange={(event) => setHistorySort(event.target.value as HistorySort)}>
                <option value="most_recent">Most recent</option>
                <option value="oldest">Oldest</option>
                <option value="grade">Grade</option>
                <option value="category">Category</option>
              </select>
              <button type="button" onClick={() => setHistoryView(historyView === "list" ? "tiles" : "list")}>
                {historyView === "list" ? "Tile View" : "List View"}
              </button>
            </div>
          </div>

          <div className="history-stats">
            <article><span>All Time</span><strong>{history.stats.allTime}</strong></article>
            <article><span>Month</span><strong>{history.stats.monthly}</strong></article>
            <article><span>Week</span><strong>{history.stats.weekly}</strong></article>
            <article><span>Today</span><strong>{history.stats.daily}</strong></article>
            <article><span>Average</span><strong>{history.stats.averageProvisionalGrade ?? "n/a"}</strong></article>
          </div>

          <div className={historyView === "tiles" ? "history-list tiles" : "history-list"}>
            {sortedHistory.map((item) => (
              <article key={item.reportId}>
                <div>
                  <span>{item.generatedAt ? new Date(item.generatedAt).toLocaleString() : "Unknown date"}</span>
                  <strong>{item.title ?? item.reportId}</strong>
                  <p>{item.localHtmlPath ?? item.reportBundlePath ?? "Local report path pending."}</p>
                </div>
                <div className="history-grade">
                  <span>Provisional</span>
                  <strong>{item.provisionalOverallGrade ?? "Pending"}</strong>
                </div>
                <button type="button" onClick={() => window.open(reportUrlFor(item), "_blank", "noopener,noreferrer")}>
                  Open
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>

      <style jsx>{`
        .station {
          min-height: 100vh;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 380px;
          background: #0b0c0b;
          color: #f6f1e7;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          overflow: hidden;
        }
        .viewer {
          position: relative;
          min-height: 100vh;
          background:
            linear-gradient(180deg, rgba(8, 12, 9, 0.35), rgba(8, 8, 7, 0.88)),
            radial-gradient(circle at center, rgba(76, 91, 70, 0.32), transparent 58%),
            #121311;
          padding: 28px;
        }
        .camera-frame {
          position: relative;
          height: calc(100vh - 56px);
          min-height: 640px;
          border: 1px solid rgba(225, 205, 155, 0.24);
          background:
            linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
            linear-gradient(0deg, rgba(255,255,255,0.035) 1px, transparent 1px),
            #171916;
          background-size: 64px 64px;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: inset 0 0 120px rgba(0, 0, 0, 0.46);
        }
        .guide-card {
          position: absolute;
          left: 50%;
          top: 50%;
          width: min(36vw, 330px);
          aspect-ratio: 2.5 / 3.5;
          transform: translate(-50%, -50%);
          border: 2px solid rgba(89, 255, 166, 0.78);
          border-radius: 8px;
          box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.16), 0 0 40px rgba(89, 255, 166, 0.12);
        }
        .guide-card:before,
        .guide-card:after {
          content: "";
          position: absolute;
          inset: 12%;
          border: 1px solid rgba(89, 255, 166, 0.28);
        }
        .guide-card:after {
          inset: 28% 18%;
        }
        .crosshair {
          position: absolute;
          background: rgba(237, 219, 174, 0.38);
        }
        .crosshair.horizontal {
          top: 50%;
          left: 24px;
          right: 24px;
          height: 1px;
        }
        .crosshair.vertical {
          left: 50%;
          top: 24px;
          bottom: 24px;
          width: 1px;
        }
        .camera-status {
          position: absolute;
          left: 26px;
          bottom: 24px;
          max-width: 520px;
          color: #d8d2c4;
        }
        .camera-status span,
        .eyebrow {
          color: #c9a85f;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .camera-status strong {
          display: block;
          margin-top: 8px;
          font-size: 34px;
          letter-spacing: 0;
        }
        .camera-status p {
          margin: 8px 0 0;
          color: #bbb4a8;
          line-height: 1.5;
        }
        .connect-scrim,
        .flip-scrim {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 24px;
          backdrop-filter: blur(8px);
          background: rgba(5, 6, 5, 0.58);
          z-index: 5;
        }
        .connect-scrim > div,
        .flip-scrim > div {
          width: min(520px, 92vw);
          border: 1px solid rgba(238, 211, 146, 0.32);
          background: rgba(14, 15, 13, 0.92);
          border-radius: 8px;
          padding: 24px;
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.35);
        }
        .flip-scrim {
          background: rgba(115, 14, 20, 0.48);
        }
        h1,
        h2,
        p {
          margin: 0;
          letter-spacing: 0;
        }
        h1 {
          font-size: 38px;
          line-height: 1.05;
        }
        h2 {
          font-size: 24px;
        }
        .connect-scrim p,
        .flip-scrim p {
          margin-top: 10px;
          color: #cfc7b8;
          line-height: 1.5;
        }
        label {
          display: block;
          margin-top: 14px;
          color: #ded6c8;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        input,
        select {
          width: 100%;
          box-sizing: border-box;
          margin-top: 7px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(0, 0, 0, 0.3);
          color: #f8f0e0;
          border-radius: 8px;
          padding: 11px 12px;
          font: inherit;
          letter-spacing: 0;
          text-transform: none;
        }
        button {
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          min-height: 44px;
          padding: 11px 14px;
          color: #f7efe1;
          background: rgba(255, 255, 255, 0.06);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
        }
        button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .connect-scrim button,
        .flip-scrim button,
        .start-grading {
          width: 100%;
          margin-top: 16px;
          border-color: #5bff9d;
          background: #5bff9d;
          color: #06100a;
          box-shadow: 0 0 36px rgba(91, 255, 157, 0.22);
        }
        .checkbox {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .checkbox input {
          width: auto;
          margin: 0;
        }
        .sidebar {
          height: 100vh;
          overflow-y: auto;
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(16, 16, 14, 0.98);
          padding: 22px;
        }
        .brand {
          display: grid;
          gap: 4px;
          margin-bottom: 20px;
        }
        .brand span {
          color: #c9a85f;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.18em;
        }
        .brand strong {
          font-size: 22px;
        }
        .error {
          border: 1px solid rgba(255, 82, 82, 0.34);
          background: rgba(95, 12, 18, 0.34);
          color: #ffd6d6;
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 14px;
          line-height: 1.4;
        }
        .next-card,
        .profile,
        .status,
        .paths,
        .timing {
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.045);
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 14px;
        }
        .next-card p {
          margin-top: 8px;
          color: #bdb5a8;
          line-height: 1.45;
        }
        .primary {
          width: 100%;
          margin-top: 14px;
          border-color: rgba(228, 191, 105, 0.7);
          color: #f7e4b4;
        }
        .profile {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .profile label {
          grid-column: span 3;
          margin-top: 0;
        }
        .profile span,
        .status span,
        .history-stats span {
          display: block;
          color: #9d9688;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .profile strong,
        .status strong,
        .history-stats strong {
          display: block;
          margin-top: 5px;
          font-size: 18px;
        }
        .status {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .action-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          margin-bottom: 12px;
        }
        .action-row button:first-child {
          border-color: #e1bd68;
          background: #e1bd68;
          color: #111;
        }
        .safe {
          width: 100%;
          border-color: rgba(255, 92, 92, 0.42);
          background: rgba(105, 19, 23, 0.36);
          color: #ffd7d7;
          margin-bottom: 14px;
        }
        .paths p {
          margin: 0 0 8px;
          color: #bdb5a8;
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .timing dl {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          margin: 0;
        }
        .timing dt {
          color: #a9a094;
        }
        .timing dd {
          margin: 0;
          font-weight: 800;
        }
        .history {
          position: fixed;
          inset: 0;
          transform: translateX(100%);
          transition: transform 220ms ease;
          z-index: 10;
          background: #f4f0e8;
          color: #151411;
          padding: 26px;
          overflow-y: auto;
        }
        .history.open {
          transform: translateX(0);
        }
        .close-history {
          position: sticky;
          top: 0;
          z-index: 2;
          width: 44px;
          color: #151411;
          background: #fff;
          border-color: rgba(20, 20, 20, 0.14);
        }
        .history-head {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-end;
          max-width: 1240px;
          margin: 10px auto 20px;
        }
        .history-controls {
          display: flex;
          gap: 10px;
        }
        .history-controls select,
        .history-controls button {
          color: #151411;
          background: #fff;
          border-color: rgba(20, 20, 20, 0.14);
        }
        .history-stats,
        .history-list {
          max-width: 1240px;
          margin: 0 auto 18px;
        }
        .history-stats {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 12px;
        }
        .history-stats article,
        .history-list article {
          border: 1px solid rgba(20, 20, 20, 0.1);
          background: rgba(255, 255, 255, 0.78);
          border-radius: 8px;
          padding: 15px;
          box-shadow: 0 14px 48px rgba(39, 30, 12, 0.08);
        }
        .history-list {
          display: grid;
          gap: 10px;
        }
        .history-list.tiles {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .history-list article {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 110px 110px;
          gap: 12px;
          align-items: center;
        }
        .history-list.tiles article {
          grid-template-columns: 1fr;
          align-items: stretch;
        }
        .history-list span {
          color: #7a6b50;
          font-size: 12px;
        }
        .history-list strong {
          display: block;
          margin-top: 5px;
          overflow-wrap: anywhere;
        }
        .history-list p {
          margin-top: 7px;
          color: #5b554b;
          overflow-wrap: anywhere;
        }
        .history-list button {
          color: #111;
          background: #e0bd6c;
          border-color: #d4af58;
        }
        .history-grade {
          text-align: center;
        }
        @media (max-width: 980px) {
          .station {
            grid-template-columns: 1fr;
            overflow: auto;
          }
          .viewer,
          .sidebar {
            min-height: auto;
            height: auto;
          }
          .camera-frame {
            min-height: 560px;
            height: 70vh;
          }
          .sidebar {
            border-left: 0;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
          }
          .history-head,
          .history-controls {
            display: grid;
            grid-template-columns: 1fr;
          }
          .history-stats,
          .history-list.tiles,
          .history-list article {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </>
  );
}
