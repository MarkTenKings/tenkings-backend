import Head from "next/head";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AI_GRADER_STATION_STEPS,
  buildAiGraderLocalStationStatus,
  type AiGraderLocalStationStatus,
  type AiGraderStationAction,
} from "../../lib/aiGraderLocalStation";
import {
  DEFAULT_AI_GRADER_STATION_BRIDGE_URL,
  callAiGraderStationBridge,
} from "../../lib/aiGraderStationBridgeClient";

const ACTIONS: Array<{ action: AiGraderStationAction; label: string; kind: "primary" | "secondary" | "danger" }> = [
  { action: "start-session", label: "Start", kind: "primary" },
  { action: "confirm-light-idle-off", label: "Light Idle/Off", kind: "secondary" },
  { action: "confirm-fixture-rulers", label: "Fixture Visible", kind: "secondary" },
  { action: "launch-preview", label: "Launch Preview", kind: "secondary" },
  { action: "accept-profile", label: "Accept Profile", kind: "secondary" },
  { action: "capture-front", label: "Capture Front", kind: "secondary" },
  { action: "confirm-flip", label: "Continue After Flip", kind: "primary" },
  { action: "capture-back", label: "Capture Back", kind: "secondary" },
  { action: "run-diagnostics", label: "Run Diagnostics", kind: "primary" },
  { action: "export-report-bundle", label: "Export Bundle", kind: "secondary" },
  { action: "safe-off", label: "Safe Off", kind: "danger" },
  { action: "end-session", label: "End Session", kind: "secondary" },
];

async function callStationContract(action: AiGraderStationAction): Promise<AiGraderLocalStationStatus> {
  const method = action === "status" || action === "latest-report" || action === "session-manifest" ? "GET" : "POST";
  const response = await fetch(`/api/ai-grader/station/${action}`, { method });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.message ?? "AI Grader station action failed.");
  }
  return payload.result;
}

function actionClass(kind: "primary" | "secondary" | "danger") {
  if (kind === "danger") return "border-red-500/50 bg-red-950/40 text-red-100 hover:border-red-300";
  if (kind === "primary") return "border-amber-300 bg-amber-300 text-zinc-950 hover:bg-amber-200";
  return "border-white/18 bg-white/[0.04] text-zinc-100 hover:border-white/40";
}

export default function AiGraderStationPage() {
  const [status, setStatus] = useState<AiGraderLocalStationStatus>(() => buildAiGraderLocalStationStatus({ action: "status" }));
  const [busyAction, setBusyAction] = useState<AiGraderStationAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_AI_GRADER_STATION_BRIDGE_URL);
  const [stationToken, setStationToken] = useState("");
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [contractPreviewEnabled, setContractPreviewEnabled] = useState(false);
  const [operatorChecks, setOperatorChecks] = useState({
    lightIdleOff: false,
    fixtureRulersVisible: false,
    flipComplete: false,
    finalLightOff: false,
  });
  const [profileDraft, setProfileDraft] = useState({
    dutyPercent: status.acceptedProfile.dutyPercent,
    exposureUs: status.acceptedProfile.exposureUs,
    gain: status.acceptedProfile.gain,
  });

  const currentStep = useMemo(
    () => AI_GRADER_STATION_STEPS.find((step) => step.id === status.currentStep) ?? AI_GRADER_STATION_STEPS[0],
    [status.currentStep]
  );

  const buildActionBody = (action: AiGraderStationAction) => {
    const confirmations = {
      ...operatorChecks,
      lightIdleOff: operatorChecks.lightIdleOff || action === "confirm-light-idle-off",
      fixtureRulersVisible: operatorChecks.fixtureRulersVisible || action === "confirm-fixture-rulers",
      flipComplete: operatorChecks.flipComplete || action === "confirm-flip",
    };
    if (action === "safe-off") {
      confirmations.finalLightOff = operatorChecks.finalLightOff;
    }
    return {
      confirmations,
      acceptedProfile:
        action === "accept-profile"
          ? {
              dutyPercent: Number(profileDraft.dutyPercent),
              exposureUs: Number(profileDraft.exposureUs),
              gain: Number(profileDraft.gain),
              channels: status.acceptedProfile.channels,
              source: "bridge_operator",
            }
          : undefined,
    };
  };

  const connectBridge = async () => {
    setBusyAction("status");
    setError(null);
    try {
      const next = await callAiGraderStationBridge({ baseUrl: bridgeUrl, stationToken, action: "status" });
      setStatus(next);
      setBridgeConnected(true);
      setOperatorChecks((current) => ({ ...current, ...(next.confirmations ?? {}) }));
      setProfileDraft({
        dutyPercent: next.acceptedProfile.dutyPercent,
        exposureUs: next.acceptedProfile.exposureUs,
        gain: next.acceptedProfile.gain,
      });
    } catch (requestError) {
      setBridgeConnected(false);
      setError(requestError instanceof Error ? requestError.message : "AI Grader station bridge connection failed.");
    } finally {
      setBusyAction(null);
    }
  };

  const runAction = async (action: AiGraderStationAction) => {
    setBusyAction(action);
    setError(null);
    try {
      const next = bridgeConnected
        ? await callAiGraderStationBridge({
            baseUrl: bridgeUrl,
            stationToken,
            action,
            body: buildActionBody(action),
          })
        : contractPreviewEnabled
          ? await callStationContract(action)
          : (() => {
              throw new Error("Connect the Dell local station bridge before running station actions, or explicitly enable contract preview.");
            })();
      setStatus(next);
      setOperatorChecks((current) => ({ ...current, ...(next.confirmations ?? {}) }));
      setProfileDraft({
        dutyPercent: next.acceptedProfile.dutyPercent,
        exposureUs: next.acceptedProfile.exposureUs,
        gain: next.acceptedProfile.gain,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "AI Grader station action failed.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <>
      <Head>
        <title>Ten Kings AI Grader Station</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="station-shell">
        <section className="hero">
          <div>
            <p className="eyebrow">Ten Kings Local Operator Station</p>
            <h1>AI Grader Station</h1>
            <p className="hero-copy">
              Guided fixed-rig workflow for starting a card, launching preview, accepting capture profile, capturing front/back,
              generating provisional diagnostics, and opening the report.
            </p>
            <div className="badge-row">
              <span>Local Dell Workflow</span>
              <span>{bridgeConnected ? "Real Local Bridge Connected" : "Bridge Required"}</span>
              <span>Not Certified - No Final Grade</span>
            </div>
          </div>
          <aside className="next-panel">
            <p className="eyebrow">Next Action</p>
            <h2>{currentStep.label}</h2>
            <p>{currentStep.operatorAction}</p>
            <button type="button" onClick={() => runAction(status.nextAction)} disabled={busyAction !== null} className="next-button">
              {busyAction === status.nextAction ? "Working" : status.nextActionLabel}
            </button>
          </aside>
        </section>

        {error ? <section className="alert">{error}</section> : null}

        <section className="connection-panel">
          <div>
            <p className="eyebrow">Dell Local Bridge</p>
            <h2>{bridgeConnected ? "Connected to local station bridge" : "Connect before hardware actions"}</h2>
            <p>
              The hosted web app never controls hardware directly. This page calls the Dell loopback bridge at 127.0.0.1
              with a local station token; public report pages remain read-only.
            </p>
          </div>
          <div className="connection-fields">
            <label>
              Bridge URL
              <input value={bridgeUrl} onChange={(event) => setBridgeUrl(event.target.value)} />
            </label>
            <label>
              Station token
              <input value={stationToken} onChange={(event) => setStationToken(event.target.value)} type="password" />
            </label>
            <button type="button" onClick={connectBridge} disabled={busyAction !== null} className="connect-button">
              {busyAction === "status" ? "Checking" : "Connect"}
            </button>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={contractPreviewEnabled}
                onChange={(event) => setContractPreviewEnabled(event.target.checked)}
              />
              Contract preview only
            </label>
          </div>
        </section>

        <section className="operator-checks">
          <div>
            <p className="eyebrow">Operator Confirmations</p>
            <h2>Staged, not pre-confirmed</h2>
          </div>
          <label>
            <input
              type="checkbox"
              checked={operatorChecks.lightIdleOff}
              onChange={(event) => setOperatorChecks((current) => ({ ...current, lightIdleOff: event.target.checked }))}
            />
            Physical ring light is idle/off
          </label>
          <label>
            <input
              type="checkbox"
              checked={operatorChecks.fixtureRulersVisible}
              onChange={(event) => setOperatorChecks((current) => ({ ...current, fixtureRulersVisible: event.target.checked }))}
            />
            Fixture and rulers are visible
          </label>
          <label>
            <input
              type="checkbox"
              checked={operatorChecks.flipComplete}
              onChange={(event) => setOperatorChecks((current) => ({ ...current, flipComplete: event.target.checked }))}
            />
            Card is flipped and seated
          </label>
          <label>
            <input
              type="checkbox"
              checked={operatorChecks.finalLightOff}
              onChange={(event) => setOperatorChecks((current) => ({ ...current, finalLightOff: event.target.checked }))}
            />
            Final physical ring light is off
          </label>
        </section>

        <section className="status-grid" aria-label="station status">
          <article>
            <span>Bridge</span>
            <strong>{status.mode}</strong>
            <p>{bridgeConnected ? `Connected at ${status.stationUrl ?? bridgeUrl}` : "Waiting for Dell loopback bridge."}</p>
          </article>
          <article>
            <span>Capture Profile</span>
            <strong>{status.acceptedProfile.dutyPercent}% / {status.acceptedProfile.exposureUs} us</strong>
            <p>Channels {status.acceptedProfile.channels.join(", ")}; gain {status.acceptedProfile.gain}.</p>
          </article>
          <article>
            <span>Ruler Profile</span>
            <strong>{status.calibrationProfile.status}</strong>
            <p>{status.calibrationProfile.mmPerPixelX ?? "pending"} mm/px X, {status.calibrationProfile.mmPerPixelY ?? "pending"} mm/px Y.</p>
          </article>
          <article>
            <span>Report</span>
            <strong>{status.latestReport.exists ? "Ready" : "Pending"}</strong>
            <p>{status.latestReport.localHtmlPath ?? "Run diagnostics to attach a report."}</p>
          </article>
        </section>

        <section className="profile-panel">
          <div>
            <p className="eyebrow">Lighting / Exposure</p>
            <h2>Capture profile to accept</h2>
            <p>Preview tuning stays software-side until accepted. Hardware settings are not saved as Basler or Leimac User Sets.</p>
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
          <label>
            Gain
            <input
              type="number"
              min="0"
              step="0.1"
              value={profileDraft.gain}
              onChange={(event) => setProfileDraft((current) => ({ ...current, gain: Number(event.target.value) }))}
            />
          </label>
        </section>

        <section className="workflow">
          <div className="section-heading">
            <p className="eyebrow">Workflow</p>
            <h2>Card Session Steps</h2>
          </div>
          <div className="step-list">
            {AI_GRADER_STATION_STEPS.map((step, index) => {
              const active = step.id === status.currentStep;
              return (
                <article key={step.id} className={active ? "step active" : "step"}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <p>{step.operatorAction}</p>
                  </div>
                  {step.hardwareCapable ? <em>hardware capable</em> : <em>software</em>}
                </article>
              );
            })}
          </div>
        </section>

        <section className="actions">
          <div className="section-heading">
            <p className="eyebrow">Controls</p>
            <h2>Operator Actions</h2>
          </div>
          <div className="button-grid">
            {ACTIONS.map((item) => (
              <button
                key={item.action}
                type="button"
                disabled={busyAction !== null}
                onClick={() => runAction(item.action)}
                className={actionClass(item.kind)}
              >
                {busyAction === item.action ? "Working" : item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="report-panel">
          <div>
            <p className="eyebrow">Local Report Viewer</p>
            <h2>Review the latest provisional report</h2>
            <p>
              The local viewer route uses the PR #45 report bundle contract for now. It is read-only and does not control hardware.
            </p>
          </div>
          <Link href={status.latestReport.localViewerPath} className="report-link">
            Open Report Viewer
          </Link>
        </section>

        <section className="bridge">
          <div className="section-heading">
            <p className="eyebrow">Bridge Contract</p>
            <h2>Local API Surface</h2>
          </div>
          <div className="endpoint-grid">
            {status.bridgeContract.endpoints.map((endpoint) => (
              <article key={endpoint.path}>
                <span>{endpoint.method}</span>
                <strong>{endpoint.path}</strong>
                <p>{endpoint.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="warnings">
          <div>
            <p className="eyebrow">Safety</p>
            <h2>Current boundaries</h2>
          </div>
          <ul>
            {status.warnings.concat(status.reportBundle?.limitations ?? []).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      </main>

      <style jsx>{`
        .station-shell {
          min-height: 100vh;
          background: #0e0e0d;
          color: #f5f1e8;
          padding: 28px;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 360px;
          gap: 20px;
          max-width: 1280px;
          margin: 0 auto 20px;
          align-items: stretch;
        }
        .hero > div,
        .next-panel,
        .status-grid article,
        .connection-panel,
        .operator-checks,
        .profile-panel,
        .workflow,
        .actions,
        .report-panel,
        .bridge,
        .warnings,
        .alert {
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.045);
          border-radius: 8px;
          box-shadow: 0 18px 60px rgba(0, 0, 0, 0.25);
        }
        .hero > div {
          padding: 30px;
        }
        .eyebrow {
          margin: 0 0 10px;
          color: #c8a96a;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        h1,
        h2,
        p {
          margin: 0;
        }
        h1 {
          font-size: 44px;
          line-height: 1.02;
          letter-spacing: 0;
        }
        h2 {
          font-size: 22px;
          letter-spacing: 0;
        }
        .hero-copy {
          max-width: 760px;
          margin-top: 14px;
          color: #cbc6bb;
          line-height: 1.65;
        }
        .badge-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 22px;
        }
        .badge-row span {
          border: 1px solid rgba(200, 169, 106, 0.35);
          color: #ead6a8;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }
        .next-panel {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .next-panel p {
          color: #cfc9bd;
          line-height: 1.5;
        }
        .next-button,
        .report-link,
        .button-grid button {
          min-height: 44px;
          border-radius: 8px;
          border: 1px solid;
          padding: 12px 16px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          transition: border-color 160ms ease, background 160ms ease, color 160ms ease;
        }
        .next-button,
        .report-link {
          margin-top: auto;
          background: #e0bd6c;
          border-color: #e0bd6c;
          color: #10100f;
          text-align: center;
          text-decoration: none;
        }
        .alert {
          max-width: 1280px;
          margin: 0 auto 20px;
          padding: 14px 16px;
          border-color: rgba(255, 85, 85, 0.35);
          color: #ffd4d4;
        }
        .status-grid,
        .operator-checks,
        .profile-panel,
        .endpoint-grid,
        .button-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          max-width: 1280px;
          margin: 0 auto 20px;
        }
        .status-grid article,
        .endpoint-grid article {
          padding: 16px;
        }
        .status-grid span,
        .endpoint-grid span {
          display: block;
          color: #a6a099;
          font-size: 11px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .status-grid strong,
        .endpoint-grid strong {
          display: block;
          margin-top: 8px;
          overflow-wrap: anywhere;
        }
        .status-grid p,
        .endpoint-grid p {
          margin-top: 8px;
          color: #bfb8ad;
          font-size: 13px;
          line-height: 1.45;
        }
        .workflow,
        .actions,
        .report-panel,
        .connection-panel,
        .bridge,
        .warnings {
          max-width: 1280px;
          margin: 0 auto 20px;
          padding: 22px;
        }
        .section-heading {
          margin-bottom: 16px;
        }
        .connection-panel,
        .profile-panel {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(320px, 520px);
          gap: 18px;
          align-items: end;
        }
        .connection-panel p,
        .profile-panel p {
          margin-top: 8px;
          color: #bfb8ad;
          line-height: 1.55;
        }
        .connection-fields,
        .profile-panel {
          align-items: end;
        }
        .connection-fields {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
          gap: 10px;
        }
        .connection-fields label,
        .profile-panel label,
        .operator-checks label {
          color: #d8d0c4;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .connection-fields input:not([type="checkbox"]),
        .profile-panel input {
          width: 100%;
          margin-top: 7px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          background: rgba(0, 0, 0, 0.26);
          color: #f5f1e8;
          border-radius: 8px;
          padding: 11px 12px;
          font: inherit;
          letter-spacing: 0;
          text-transform: none;
          box-sizing: border-box;
        }
        .connect-button {
          min-height: 43px;
          border: 1px solid #e0bd6c;
          background: #e0bd6c;
          color: #10100f;
          border-radius: 8px;
          padding: 0 16px;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .checkbox-row {
          grid-column: 1 / -1;
          display: inline-flex;
          gap: 8px;
          align-items: center;
        }
        .operator-checks {
          max-width: 1280px;
          margin: 0 auto 20px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.045);
          border-radius: 8px;
          padding: 18px;
          grid-template-columns: 1.2fr repeat(4, minmax(0, 1fr));
          align-items: center;
        }
        .operator-checks label {
          display: flex;
          gap: 8px;
          align-items: center;
          line-height: 1.35;
        }
        .profile-panel {
          max-width: 1280px;
          margin: 0 auto 20px;
          padding: 20px;
          grid-template-columns: minmax(0, 1fr) repeat(3, minmax(120px, 160px));
        }
        .step-list {
          display: grid;
          gap: 10px;
        }
        .step {
          display: grid;
          grid-template-columns: 46px minmax(0, 1fr) 128px;
          gap: 14px;
          align-items: center;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.16);
          border-radius: 8px;
          padding: 12px;
        }
        .step.active {
          border-color: rgba(224, 189, 108, 0.8);
          background: rgba(224, 189, 108, 0.09);
        }
        .step span {
          color: #c8a96a;
          font-weight: 800;
        }
        .step p {
          margin-top: 4px;
          color: #bbb4aa;
          font-size: 13px;
        }
        .step em {
          justify-self: end;
          color: #a9a39b;
          font-size: 12px;
          font-style: normal;
        }
        .button-grid {
          max-width: none;
          margin: 0;
        }
        .button-grid button {
          cursor: pointer;
        }
        .button-grid button:disabled,
        .next-button:disabled {
          cursor: not-allowed;
          opacity: 0.65;
        }
        .report-panel {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
        }
        .report-panel p {
          margin-top: 8px;
          color: #bfb8ad;
        }
        .warnings ul {
          margin: 0;
          padding-left: 18px;
          color: #d8d0c4;
          line-height: 1.7;
        }
        @media (max-width: 920px) {
          .hero,
          .status-grid,
          .connection-panel,
          .connection-fields,
          .operator-checks,
          .profile-panel,
          .endpoint-grid,
          .button-grid {
            grid-template-columns: 1fr;
          }
          .step {
            grid-template-columns: 38px minmax(0, 1fr);
          }
          .step em {
            grid-column: 2;
            justify-self: start;
          }
          .report-panel {
            align-items: stretch;
            flex-direction: column;
          }
        }
      `}</style>
    </>
  );
}
