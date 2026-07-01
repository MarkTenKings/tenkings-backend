import Head from "next/head";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AI_GRADER_STATION_STEPS,
  buildAiGraderLocalStationStatus,
  type AiGraderLocalStationStatus,
  type AiGraderStationAction,
} from "../../lib/aiGraderLocalStation";

const ACTIONS: Array<{ action: AiGraderStationAction; label: string; kind: "primary" | "secondary" | "danger" }> = [
  { action: "start-session", label: "Start", kind: "primary" },
  { action: "launch-preview", label: "Launch Preview", kind: "secondary" },
  { action: "accept-profile", label: "Accept Profile", kind: "secondary" },
  { action: "capture-front", label: "Capture Front", kind: "secondary" },
  { action: "confirm-flip", label: "Continue After Flip", kind: "primary" },
  { action: "capture-back", label: "Capture Back", kind: "secondary" },
  { action: "run-diagnostics", label: "Run Diagnostics", kind: "primary" },
  { action: "safe-off", label: "Safe Off", kind: "danger" },
];

async function callStation(action: AiGraderStationAction): Promise<AiGraderLocalStationStatus> {
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

  const currentStep = useMemo(
    () => AI_GRADER_STATION_STEPS.find((step) => step.id === status.currentStep) ?? AI_GRADER_STATION_STEPS[0],
    [status.currentStep]
  );

  const runAction = async (action: AiGraderStationAction) => {
    setBusyAction(action);
    setError(null);
    try {
      setStatus(await callStation(action));
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
              <span>Mock/Contract Bridge V0</span>
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

        <section className="status-grid" aria-label="station status">
          <article>
            <span>Bridge</span>
            <strong>{status.mode}</strong>
            <p>Hardware actions are contract-only in this PR.</p>
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
            {status.warnings.concat(status.reportBundle.limitations).map((warning) => (
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
        .bridge,
        .warnings {
          max-width: 1280px;
          margin: 0 auto 20px;
          padding: 22px;
        }
        .section-heading {
          margin-bottom: 16px;
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
