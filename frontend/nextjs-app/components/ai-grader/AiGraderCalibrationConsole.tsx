import React, { useMemo, useState } from "react";
import type {
  AiGraderCalibrationConsoleAction,
  AiGraderCalibrationConsoleViewModel,
  AiGraderCalibrationHistoryView,
} from "../../lib/aiGraderCalibrationConsole";
import { aiGraderCalibrationActionEnabled } from "../../lib/aiGraderCalibrationConsole";
import type {
  AiGraderCalibrationActivationRegistryProjectionV1,
  AiGraderCalibrationActivationStatusResponseV1,
  AiGraderCalibrationSnapshotProjectionV1,
} from "../../lib/aiGraderCalibrationActivationClient";

export type AiGraderCalibrationRegistryConsoleState = {
  loading: boolean;
  error?: string;
  registry?: AiGraderCalibrationActivationRegistryProjectionV1;
  status?: AiGraderCalibrationActivationStatusResponseV1;
};

export type AiGraderCalibrationConsoleProps = {
  model: AiGraderCalibrationConsoleViewModel;
  previewUrl: string | null;
  previewFresh: boolean;
  previewStatusLabel: string;
  previewDetail: string;
  busyAction?: AiGraderCalibrationConsoleAction;
  message?: string;
  onAction(action: AiGraderCalibrationConsoleAction, input?: Record<string, unknown>): void;
  registryState?: AiGraderCalibrationRegistryConsoleState;
  registryBusy?: boolean;
  onRefreshRegistry?(): void;
  onRegistryActivation?(input: {
    action: "activate" | "reactivate";
    snapshot: AiGraderCalibrationSnapshotProjectionV1;
    priorActivationId?: string;
    expectedRegistryRevision: string;
    reason: string;
  }): void;
};

const ACTION_LABELS: Record<AiGraderCalibrationConsoleAction, string> = {
  start_new: "Start New Calibration",
  resume: "Resume",
  capture_current_pose: "Capture Current Pose",
  retry_current_pose: "Retry Current Pose",
  replace_selected_pose: "Replace Selected Pose",
  confirm_blank_reverse_flip: "Confirm Blank-Reverse Flip",
  begin_or_resume_automatic_sweep: "Begin / Resume Automatic Sweep",
  analyze: "Analyze",
  finalize: "Finalize",
  activate: "Activate",
  reactivate: "Reactivate",
  exit: "Exit Calibration",
};

function percent(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

function degrees(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}°` : "—";
}

function hash(value?: string) {
  return value ? `${value.slice(0, 12)}…${value.slice(-10)}` : "Not available";
}

function timestamp(value?: string) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : "Not recorded";
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function historicalActionLabel(calibration: AiGraderCalibrationHistoryView) {
  if (calibration.active) return "Currently Active";
  if (!calibration.eligibleForActivation) return "Not Eligible";
  return "Reactivate";
}

export default function AiGraderCalibrationConsole({
  model,
  previewUrl,
  previewFresh,
  previewStatusLabel,
  previewDetail,
  busyAction,
  message,
  onAction,
  registryState,
  registryBusy,
  onRefreshRegistry,
  onRegistryActivation,
}: AiGraderCalibrationConsoleProps) {
  const [selectedPoseNumber, setSelectedPoseNumber] = useState<number>();
  const [replacementConfirmed, setReplacementConfirmed] = useState(false);
  const [activationName, setActivationName] = useState("");
  const [activationLocation, setActivationLocation] = useState("");
  const [lightingLabel, setLightingLabel] = useState("");
  const [selectedRegistrySnapshotId, setSelectedRegistrySnapshotId] = useState("");
  const [activationReason, setActivationReason] = useState("");

  const actionEnabled = (action: AiGraderCalibrationConsoleAction) => aiGraderCalibrationActionEnabled({
    model,
    action,
    previewFresh,
    selectedPoseNumber,
    replacementWarningConfirmed: replacementConfirmed,
  });
  const activationLabelsComplete = Boolean(activationName.trim() && activationLocation.trim() && lightingLabel.trim());
  const activationEligible = model.analysis.exactPass
    && model.finalization.exactPass
    && model.finalization.memberCount === 12
    && model.actions.activate.available
    && model.actions.activate.authorityPresent;
  const contourPoints = model.currentPose.exactTargetContour?.length === 4
    ? model.currentPose.exactTargetContour.map((point) => `${point.x},${point.y}`).join(" ")
    : null;
  const frameViewBox = useMemo(() => {
    const points = model.currentPose.exactTargetContour ?? [];
    const maxX = Math.max(2448, ...points.map((point) => point.x));
    const maxY = Math.max(2048, ...points.map((point) => point.y));
    return `0 0 ${maxX} ${maxY}`;
  }, [model.currentPose.exactTargetContour]);
  const registry = registryState?.registry;
  const registryStatus = registryState?.status;
  const selectedRegistrySnapshot = registry?.snapshots.find((snapshot) => snapshot.snapshotId === selectedRegistrySnapshotId);
  const priorActivationForSelected = useMemo(() => {
    if (!registry || !selectedRegistrySnapshot) return undefined;
    return [...registry.activations]
      .filter((activation) => activation.snapshotId === selectedRegistrySnapshot.snapshotId && activation.activatedAt)
      .sort((left, right) => Date.parse(right.activatedAt ?? "") - Date.parse(left.activatedAt ?? ""))[0];
  }, [registry, selectedRegistrySnapshot]);
  const selectedRegistryAction = priorActivationForSelected ? "reactivate" : "activate";
  const activeRegistryActivation = registry?.activations.find((activation) => activation.activationId === registry.activeActivationId);

  const button = (action: AiGraderCalibrationConsoleAction, className = "") => {
    const enabled = actionEnabled(action) && (action !== "activate" || activationLabelsComplete);
    const authority = model.actions[action];
    return (
      <button
        type="button"
        className={`calibration-action ${className}`.trim()}
        onClick={() => onAction(action, action === "replace_selected_pose"
          ? { selectedPoseNumber, replacementWarningConfirmed: replacementConfirmed }
          : action === "activate"
            ? { name: activationName.trim(), location: activationLocation.trim(), lightingLabel: lightingLabel.trim() }
            : undefined)}
        disabled={Boolean(busyAction) || !enabled}
        aria-describedby={`reason-${action}`}
      >
        {busyAction === action ? "Working…" : ACTION_LABELS[action]}
      </button>
    );
  };

  return (
    <main className="calibration-shell ai-grader-calibration-console">
      <header className="topbar">
        <div>
          <p className="eyebrow">Ten Kings AI Grader · Admin Calibration</p>
          <h1>{model.title}</h1>
          <p>{model.summary}</p>
        </div>
        <div className="top-actions">
          {button("start_new")}
          {button("resume")}
          {button("exit", "quiet")}
        </div>
        <span id="reason-start_new" className="sr-only">{model.actions.start_new.reason}</span>
        <span id="reason-resume" className="sr-only">{model.actions.resume.reason}</span>
        <span id="reason-exit" className="sr-only">{model.actions.exit.reason}</span>
      </header>

      <section className="camera-safety" aria-label="Camera ownership safety">
        <strong>Close Pylon Viewer before calibration.</strong>
        <span> The authoritative helper must pause and drain preview, take the sole camera lease, verify safe-off, release the camera, and then reconnect preview.</span>
      </section>

      {model.hardFailure ? (
        <section className="hard-failure" role="alert">
          <strong>Calibration hard failure</strong>
          <p>{model.hardFailure}</p>
          <p>No older calibration was selected automatically. Grading remains fail-closed.</p>
        </section>
      ) : null}

      {message ? <p className="message" aria-live="polite">{message}</p> : null}

      <div className="workspace">
        <section className="visual-column" aria-label="Live Basler calibration preview">
          <div className={`preview-stage ${previewFresh ? "fresh" : "stale"}`}>
            {previewUrl ? (
              // Live Object URLs are intentionally rendered directly and are revoked by the preview epoch lifecycle.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Live Basler calibration preview" />
            ) : (
              <div className="preview-empty">
                <strong>{previewStatusLabel}</strong>
                <span>{previewDetail}</span>
              </div>
            )}
            {contourPoints ? (
              <svg viewBox={frameViewBox} aria-label="Exact detected calibration target contour" role="img">
                <polygon points={contourPoints} />
              </svg>
            ) : null}
            <div className="preview-state" role="status">
              <strong>{previewStatusLabel}</strong>
              <span>{previewFresh ? "Fresh exact frame" : "No fresh capture-authorizing frame"}</span>
            </div>
          </div>

          <section className="pose-panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Current Pose</p>
                <h2>{model.currentPoseNumber ? `Pose ${model.currentPoseNumber} of 4` : "Waiting for an exact step"}</h2>
              </div>
              <strong className={model.currentPose.valid ? "pass-badge" : "fail-badge"}>
                {model.currentPose.valid ? "VALID" : "INVALID"}
              </strong>
            </div>
            <div className="metric-grid">
              <article><span>X</span><strong>{percent(model.currentPose.centerXFraction, 2)}</strong></article>
              <article><span>Y</span><strong>{percent(model.currentPose.centerYFraction, 2)}</strong></article>
              <article><span>Rotation</span><strong>{degrees(model.currentPose.rotationDegrees)}</strong></article>
              <article><span>Coverage</span><strong>{percent(model.currentPose.coverageFraction, 2)}</strong></article>
              <article><span>Safety margin</span><strong>{percent(model.currentPose.safetyMarginFraction, 2)}</strong></article>
            </div>
            {model.currentPose.reasons.length ? (
              <ul className="reason-list">
                {model.currentPose.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            ) : null}
            <div className="guidance" aria-label="Actionable movement guidance">
              <strong>Movement guidance</strong>
              <ol>{model.movementGuidance.map((guidance) => <li key={guidance}>{guidance}</li>)}</ol>
            </div>
            <div className="capture-actions">
              {button("capture_current_pose", "primary")}
              {button("retry_current_pose")}
            </div>
            <p id="reason-capture_current_pose" className="action-reason">{model.actions.capture_current_pose.reason}</p>
            <p id="reason-retry_current_pose" className="action-reason">{model.actions.retry_current_pose.reason}</p>
          </section>
        </section>

        <aside className="control-column" aria-label="Calibration status and controls">
          <section className="card diversity-card">
            <div className="section-head">
              <div><p className="eyebrow">Aggregate Diversity</p><h2>Pose 4 exact final gate</h2></div>
              <strong className={model.aggregateDiversity.exactFinalGateSatisfied ? "pass-badge" : "fail-badge"}>
                {model.aggregateDiversity.exactFinalGateSatisfied ? "PASS" : "NOT MET"}
              </strong>
            </div>
            <div className="span-row">
              <span>X span</span><strong>{percent(model.aggregateDiversity.xSpan, 2)}</strong><small>min {percent(model.aggregateDiversity.minimumXSpan, 2)}</small>
            </div>
            <div className="span-row">
              <span>Y span</span><strong>{percent(model.aggregateDiversity.ySpan, 2)}</strong><small>min {percent(model.aggregateDiversity.minimumYSpan, 2)}</small>
            </div>
            <div className="span-row">
              <span>Rotation</span><strong>{degrees(model.aggregateDiversity.rotationSpanDegrees)}</strong><small>min {degrees(model.aggregateDiversity.minimumRotationSpanDegrees)}</small>
            </div>
          </section>

          <section className="card accepted-card">
            <div className="section-head"><div><p className="eyebrow">Immutable Evidence</p><h2>Accepted pose history</h2></div><strong>{model.acceptedPoses.filter((pose) => !pose.superseded).length} / 4</strong></div>
            <div className="history-list">
              {model.acceptedPoses.length ? model.acceptedPoses.map((pose) => (
                <label key={`${pose.poseNumber}-${pose.operationLabel}`} className={pose.superseded ? "history-item superseded" : "history-item"}>
                  <input
                    type="radio"
                    name="selected-pose"
                    value={pose.poseNumber}
                    checked={selectedPoseNumber === pose.poseNumber}
                    onChange={() => { setSelectedPoseNumber(pose.poseNumber); setReplacementConfirmed(false); }}
                    disabled={pose.superseded}
                  />
                  <span>
                    <strong>Pose {pose.poseNumber}{pose.superseded ? " · superseded" : ""}</strong>
                    <small>{percent(pose.centerXFraction, 2)}, {percent(pose.centerYFraction, 2)} · {degrees(pose.rotationDegrees)} · margin {percent(pose.safetyMarginFraction, 2)}</small>
                    <code title={pose.evidenceSha256}>{hash(pose.evidenceSha256)}</code>
                  </span>
                </label>
              )) : <p className="empty-copy">No accepted poses.</p>}
            </div>
            <label className="warning-confirm">
              <input type="checkbox" checked={replacementConfirmed} onChange={(event) => setReplacementConfirmed(event.target.checked)} />
              <span>I understand replacement never mutates the selected pose. It appends new evidence and marks the old operation immutably superseded.</span>
            </label>
            {button("replace_selected_pose", "danger-outline")}
            <p id="reason-replace_selected_pose" className="action-reason">{model.actions.replace_selected_pose.reason}</p>
          </section>

          <section className="card failure-card">
            <div className="section-head"><div><p className="eyebrow">Preserved Failures</p><h2>Failed attempt history</h2></div><strong>{model.failedAttempts.length}</strong></div>
            {model.failedAttempts.length ? (
              <ol className="failure-list">{model.failedAttempts.map((failure) => (
                <li key={`${failure.attemptLabel}-${failure.failedAt}`}>
                  <strong>{failure.attemptLabel} · {failure.stepLabel}</strong>
                  <p>{failure.message}</p>
                  <small>{timestamp(failure.failedAt)}</small>
                </li>
              ))}</ol>
            ) : <p className="empty-copy">No failed attempts.</p>}
          </section>

          <section className="card sweep-card">
            <div className="section-head"><div><p className="eyebrow">Automatic Sweep</p><h2>{model.automaticSweep.acceptedFrames} / {model.automaticSweep.requiredFrames}</h2></div><strong>{model.automaticSweep.currentLabel}</strong></div>
            <progress max={model.automaticSweep.requiredFrames} value={model.automaticSweep.acceptedFrames} aria-label="Automatic sweep progress" />
            <div className="control-stack">
              {button("confirm_blank_reverse_flip")}
              {button("begin_or_resume_automatic_sweep", "primary")}
            </div>
            <p id="reason-confirm_blank_reverse_flip" className="action-reason">{model.actions.confirm_blank_reverse_flip.reason}</p>
            <p id="reason-begin_or_resume_automatic_sweep" className="action-reason">{model.actions.begin_or_resume_automatic_sweep.reason}</p>
          </section>

          <section className="card result-card">
            <div className="result-columns">
              <div>
                <p className="eyebrow">Analyze</p>
                <h2>{statusLabel(model.analysis.status)}</h2>
                <p>{model.analysis.summary}</p>
                {model.analysis.issues.length ? <ul>{model.analysis.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
                {button("analyze")}
                <p id="reason-analyze" className="action-reason">{model.actions.analyze.reason}</p>
              </div>
              <div>
                <p className="eyebrow">Finalize</p>
                <h2>{statusLabel(model.finalization.status)}</h2>
                <p>{model.finalization.summary}</p>
                {button("finalize")}
                <p id="reason-finalize" className="action-reason">{model.actions.finalize.reason}</p>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section className="activation-section" aria-label="Calibration activation">
        <div className="activation-head">
          <div>
            <p className="eyebrow">Fresh Human-Admin Activation</p>
            <h2>Activate only after exact PASS</h2>
            <p>Failure never selects an older bundle automatically. Historical reactivation is always a separate explicit action.</p>
          </div>
          <strong className={model.analysis.exactPass && model.finalization.exactPass ? "pass-badge" : "fail-badge"}>
            {model.analysis.exactPass && model.finalization.exactPass ? "EXACT PASS" : "BLOCKED"}
          </strong>
        </div>
        {registryState ? (
          <div className="activation-layout">
            <div className="activation-form">
              <div className="section-head">
                <div><p className="eyebrow">Hosted Registry</p><h3>{registry?.rigId ?? "Waiting for exact rig identity"}</h3></div>
                <button type="button" className="calibration-action quiet" onClick={onRefreshRegistry} disabled={registryBusy || registryState.loading}>Refresh</button>
              </div>
              {registryState.error ? <p className="activation-blocked" role="alert">{registryState.error}</p> : null}
              {registryStatus?.pending ? (
                <p className="activation-blocked" role="status">
                  Pending activation {registryStatus.pending.activationId} must complete or fail before another selection.
                </p>
              ) : null}
              {selectedRegistrySnapshot ? (
                <>
                  <h4>{selectedRegistrySnapshot.profileId} / {selectedRegistrySnapshot.calibrationVersion}</h4>
                  <dl className="hash-list">
                    <dt>Snapshot</dt><dd><code>{selectedRegistrySnapshot.snapshotId}</code></dd>
                    <dt>Bundle SHA-256</dt><dd><code title={selectedRegistrySnapshot.bundleManifestSha256 ?? undefined}>{hash(selectedRegistrySnapshot.bundleManifestSha256 ?? undefined)}</code></dd>
                    <dt>Runtime context</dt><dd><code title={selectedRegistrySnapshot.runtimeContextHash ?? undefined}>{hash(selectedRegistrySnapshot.runtimeContextHash ?? undefined)}</code></dd>
                    <dt>Rig characterization</dt><dd><code title={selectedRegistrySnapshot.rigCharacterizationSha256 ?? undefined}>{hash(selectedRegistrySnapshot.rigCharacterizationSha256 ?? undefined)}</code></dd>
                    <dt>Operating context</dt><dd><code title={selectedRegistrySnapshot.operatingContextHash ?? undefined}>{hash(selectedRegistrySnapshot.operatingContextHash ?? undefined)}</code></dd>
                  </dl>
                  <label>
                    Private activation reason
                    <input
                      value={activationReason}
                      onChange={(event) => setActivationReason(event.target.value)}
                      placeholder="Why this exact calibration is being selected"
                    />
                  </label>
                  <p className="warning-copy">
                    This explicit {selectedRegistryAction} removes any prior active pointer before local verification. Failure has no automatic rollback or older-calibration fallback.
                  </p>
                  <button
                    type="button"
                    className="calibration-action activate-button"
                    disabled={
                      registryBusy ||
                      Boolean(registryStatus?.pending) ||
                      !selectedRegistrySnapshot.activationEligible ||
                      selectedRegistrySnapshot.trustStatus !== "TRUSTED" ||
                      activeRegistryActivation?.snapshotId === selectedRegistrySnapshot.snapshotId ||
                      activationReason.trim().length === 0 ||
                      !onRegistryActivation
                    }
                    onClick={() => onRegistryActivation?.({
                      action: selectedRegistryAction,
                      snapshot: selectedRegistrySnapshot,
                      ...(priorActivationForSelected ? { priorActivationId: priorActivationForSelected.activationId } : {}),
                      expectedRegistryRevision: registry!.registryRevision,
                      reason: activationReason.trim(),
                    })}
                  >
                    {registryBusy ? "Verifying authority�w^~)�v" : selectedRegistryAction === "reactivate"
                      ? "Authenticate & Reactivate"
                      : "Authenticate & Activate"}
                  </button>
                  <p className="action-reason">A fresh human-admin sign-in is required before the first hosted write.</p>
                </>
              ) : <p className="empty-copy">Select one exact hosted snapshot to review its immutable hashes.</p>}
            </div>
            <div className="calibration-history">
              <h3>Saved calibrations</h3>
              {registry?.snapshots.length ? registry.snapshots.map((snapshot) => {
                const exactActive = activeRegistryActivation?.snapshotId === snapshot.snapshotId;
                const historical = registry.activations
                  .filter((activation) => activation.snapshotId === snapshot.snapshotId && activation.activatedAt)
                  .sort((left, right) => Date.parse(right.activatedAt ?? "") - Date.parse(left.activatedAt ?? ""))[0];
                const label = exactActive ? "Currently Active" : historical ? "Select to Reactivate" : "Select to Activate";
                return (
                  <article key={snapshot.snapshotId}>
                    <div>
                      <span className={`status-pill ${snapshot.trustStatus === "TRUSTED" ? "eligible" : "failed"}`}>{snapshot.trustStatus}</span>
                      <h4>{snapshot.profileId}</h4>
                      <p>{snapshot.calibrationVersion} � {snapshot.rigId}</p>
                      <small>{snapshot.activationEligible ? "Exact hosted activation checks passed." : snapshot.activationIneligibilityCode ?? "Not eligible."}</small>
                      {snapshot.bundleManifestSha256 ? <code title={snapshot.bundleManifestSha256}>{hash(snapshot.bundleManifestSha256)}</code> : null}
                    </div>
                    <button
                      type="button"
                      className="calibration-action"
                      disabled={registryBusy || Boolean(registryStatus?.pending) || exactActive || !snapshot.activationEligible}
                      onClick={() => {
                        setSelectedRegistrySnapshotId(snapshot.snapshotId);
                        setActivationReason("");
                      }}
                    >
                      {label}
                    </button>
                  </article>
                );
              }) : <p className="empty-copy">{registryState.loading ? "Loading exact registry projectionr��y��y�" : "No saved calibration projections are available."}</p>}
              <p className="action-reason">Historical reactivation uses the exact prior activated ID shown by the hosted registry.</p>
            </div>
          </div>
        ) : (
        <div className="activation-layout">
          <div className="activation-form">
            <label>Name<input value={activationName} onChange={(event) => setActivationName(event.target.value)} placeholder="Calibration name" /></label>
            <label>Location<input value={activationLocation} onChange={(event) => setActivationLocation(event.target.value)} placeholder="Physical station location" /></label>
            <label>Lighting label<input value={lightingLabel} onChange={(event) => setLightingLabel(event.target.value)} placeholder="Controlled lighting description" /></label>
            <dl className="hash-list">
              <dt>Bundle SHA-256</dt><dd><code title={model.finalization.bundleSha256}>{hash(model.finalization.bundleSha256)}</code></dd>
              <dt>Runtime context</dt><dd><code title={model.finalization.runtimeContextSha256}>{hash(model.finalization.runtimeContextSha256)}</code></dd>
              <dt>Rig characterization</dt><dd><code title={model.finalization.rigCharacterizationSha256}>{hash(model.finalization.rigCharacterizationSha256)}</code></dd>
              <dt>Member ledger</dt><dd><code title={model.finalization.memberLedgerSha256}>{hash(model.finalization.memberLedgerSha256)}</code></dd>
              <dt>Member count</dt><dd>{model.finalization.memberCount ?? "—"}</dd>
            </dl>
            {activationEligible ? button("activate", "activate-button") : (
              <p className="activation-blocked" role="status">Activate is unavailable until this exact bundle has a finalized twelve-member PASS.</p>
            )}
            <p id="reason-activate" className="action-reason">{model.actions.activate.reason}</p>
          </div>
          <div className="calibration-history">
            <h3>Saved calibrations</h3>
            {model.calibrations.length ? model.calibrations.map((calibration) => (
              <article key={calibration.calibrationId}>
                <div>
                  <span className={`status-pill ${calibration.status}`}>{statusLabel(calibration.status)}</span>
                  <h4>{calibration.name}</h4>
                  <p>{calibration.location} · {calibration.lightingLabel}</p>
                  <small>{calibration.gateSummary}</small>
                  {calibration.bundleSha256 ? <code title={calibration.bundleSha256}>{hash(calibration.bundleSha256)}</code> : null}
                </div>
                <button
                  type="button"
                  className="calibration-action"
                  disabled={Boolean(busyAction) || calibration.active || !calibration.eligibleForActivation || !model.actions.reactivate.available || !model.actions.reactivate.authorityPresent}
                  onClick={() => onAction("reactivate", { calibrationId: calibration.calibrationId })}
                >
                  {historicalActionLabel(calibration)}
                </button>
              </article>
            )) : <p className="empty-copy">No saved calibration projections are available.</p>}
            <p id="reason-reactivate" className="action-reason">{model.actions.reactivate.reason}</p>
          </div>
        </div>
        )}
      </section>

      <style jsx>{`
        .calibration-shell { min-height: 100vh; background: #0b0d0c; color: #f5f1e7; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 20px; }
        .topbar, .activation-head, .section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
        .topbar { min-height: 90px; border: 1px solid #343832; background: #121512; padding: 18px 20px; }
        h1, h2, h3, h4, p { margin: 0; } h1 { font-size: clamp(25px, 2vw, 38px); line-height: 1.1; } h2 { font-size: 18px; } h3 { font-size: 17px; } h4 { margin-top: 7px; font-size: 15px; }
        .topbar p, .activation-head p { max-width: 820px; margin-top: 8px; color: #c7c0b0; line-height: 1.45; }
        .eyebrow { color: #d8bd72 !important; font-size: 10px; font-weight: 900; letter-spacing: .18em; text-transform: uppercase; }
        .top-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
        button { min-height: 42px; border: 1px solid #6b624c; border-radius: 6px; background: #262820; color: #f8f1df; padding: 9px 13px; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
        button:hover:not(:disabled) { border-color: #e0c36f; background: #333426; } button:focus-visible, input:focus-visible { outline: 3px solid #79bfff; outline-offset: 2px; }
        button:disabled { cursor: not-allowed; opacity: .42; } button.primary, .activate-button { border-color: #d8bd72; background: #d8bd72; color: #17140d; } button.quiet { background: transparent; } button.danger-outline { width: 100%; border-color: #a85555; color: #ffd0ca; background: #251515; }
        .camera-safety { margin-top: 12px; border: 1px solid #8b794a; background: #28220f; padding: 11px 14px; color: #fff1bf; line-height: 1.45; }
        .hard-failure { margin-top: 12px; border: 2px solid #d86559; background: #321713; padding: 14px 18px; color: #ffd5ce; } .hard-failure strong { font-size: 17px; } .hard-failure p { margin-top: 5px; line-height: 1.45; }
        .message { margin-top: 12px; border: 1px solid #5f6e58; background: #182119; padding: 11px 14px; color: #dff0da; }
        .workspace { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(430px, .85fr); gap: 14px; margin-top: 14px; align-items: start; }
        .visual-column { position: sticky; top: 12px; display: grid; gap: 12px; }
        .preview-stage { position: relative; min-height: 490px; height: min(58vh, 650px); border: 2px solid #5b5c50; background: linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(0deg, rgba(255,255,255,.035) 1px, transparent 1px), #101210; background-size: 52px 52px; overflow: hidden; }
        .preview-stage.fresh { border-color: #4f9e69; } .preview-stage.stale { border-color: #a56b3c; }
        .preview-stage img { width: 100%; height: 100%; object-fit: contain; background: #040504; }
        .preview-stage svg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
        .preview-stage polygon { fill: rgba(71, 219, 116, .08); stroke: #71ff9d; stroke-width: 7px; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
        .preview-empty { position: absolute; inset: 0; display: grid; place-content: center; gap: 8px; text-align: center; color: #c6c0b1; padding: 30px; } .preview-empty strong { color: #fff5da; font-size: 18px; }
        .preview-state { position: absolute; left: 12px; bottom: 12px; display: grid; gap: 3px; border: 1px solid rgba(255,255,255,.18); background: rgba(4,6,4,.86); padding: 9px 12px; } .preview-state span { color: #c6c0b1; font-size: 11px; }
        .pose-panel, .card, .activation-section { border: 1px solid #343832; background: #121512; padding: 15px; }
        .pass-badge, .fail-badge { align-self: flex-start; border: 1px solid currentColor; border-radius: 999px; padding: 6px 9px; font-size: 11px; letter-spacing: .08em; }
        .pass-badge { color: #77e69c; } .fail-badge { color: #ff9d8e; }
        .metric-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; margin-top: 12px; }
        .metric-grid article { border: 1px solid #2f342d; background: #0d0f0d; padding: 9px; } .metric-grid span, .span-row span { display: block; color: #a8a190; font-size: 10px; font-weight: 800; text-transform: uppercase; } .metric-grid strong { display: block; margin-top: 5px; font-size: 18px; font-variant-numeric: tabular-nums; }
        .guidance { margin-top: 12px; border-left: 4px solid #d8bd72; background: #222016; padding: 10px 12px; } .guidance ol, .reason-list { margin: 7px 0 0; padding-left: 20px; color: #ded4bd; line-height: 1.5; }
        .capture-actions, .control-stack { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
        .control-column { display: grid; gap: 10px; max-height: calc(100vh - 134px); overflow: auto; padding-right: 3px; }
        .span-row { display: grid; grid-template-columns: 1fr auto 95px; gap: 10px; align-items: baseline; border-top: 1px solid #2f342d; padding: 9px 0; } .span-row:first-of-type { margin-top: 10px; } .span-row strong { font-size: 18px; font-variant-numeric: tabular-nums; } .span-row small { color: #aaa18d; text-align: right; }
        .history-list { display: grid; gap: 6px; margin-top: 10px; }
        .history-item { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 8px; border: 1px solid #30342f; background: #0d0f0d; padding: 9px; text-transform: none; letter-spacing: 0; } .history-item input { margin-top: 4px; } .history-item span { display: grid; gap: 3px; } .history-item small { color: #bdb4a2; } code { display: block; color: #cbbf9e; font-family: "Cascadia Mono", Consolas, monospace; font-size: 10px; overflow-wrap: anywhere; }
        .history-item.superseded { opacity: .58; text-decoration: line-through; }
        .warning-confirm { display: grid; grid-template-columns: 20px 1fr; gap: 8px; margin: 10px 0; color: #f1c7be; font-size: 11px; line-height: 1.45; letter-spacing: 0; text-transform: none; }
        .failure-list { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; } .failure-list li { border-left: 4px solid #c65a4e; background: #241513; padding: 9px 11px; } .failure-list p { margin: 4px 0; color: #f2c3ba; line-height: 1.35; } .failure-list small { color: #bba29c; }
        progress { width: 100%; height: 15px; margin-top: 12px; accent-color: #d8bd72; }
        .result-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .result-columns > div { border: 1px solid #30342f; background: #0d0f0d; padding: 11px; } .result-columns p { margin: 7px 0; color: #c8c0af; line-height: 1.4; } .result-columns ul { padding-left: 18px; color: #f0b3a8; }
        .action-reason { margin: 6px 0 0; color: #979080; font-size: 10px; line-height: 1.35; }
        .activation-blocked { border: 1px solid #79483f; background: #261613; color: #ffc1b5; padding: 10px; font-size: 12px; line-height: 1.4; }
        .warning-copy { margin: 8px 0 12px; border-left: 4px solid #d86559; background: #241513; color: #f4c8bf; padding: 9px 11px; font-size: 11px; line-height: 1.45; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        .empty-copy { margin-top: 9px; color: #a9a18f; }
        .activation-section { margin-top: 14px; }
        .activation-layout { display: grid; grid-template-columns: minmax(350px, .75fr) minmax(0, 1.25fr); gap: 14px; margin-top: 14px; }
        .activation-form, .calibration-history { border: 1px solid #30342f; background: #0d0f0d; padding: 14px; }
        label { color: #c8bfac; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        label input[type="text"], .activation-form input { width: 100%; box-sizing: border-box; margin: 6px 0 10px; border: 1px solid #505449; border-radius: 4px; background: #161916; color: #fff7e5; padding: 10px; }
        .hash-list { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 7px 10px; margin: 6px 0 12px; } .hash-list dt { color: #a9a18f; font-size: 11px; } .hash-list dd { margin: 0; }
        .calibration-history { display: grid; gap: 8px; align-content: start; } .calibration-history article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; border: 1px solid #30342f; padding: 11px; } .calibration-history p, .calibration-history small { display: block; margin-top: 5px; color: #b7ae9b; line-height: 1.35; }
        .status-pill { display: inline-block; border: 1px solid #5e6257; border-radius: 999px; padding: 3px 6px; color: #cfc7b6; font-size: 9px; font-weight: 900; text-transform: uppercase; } .status-pill.active, .status-pill.eligible { border-color: #4c9864; color: #87e8a6; } .status-pill.failed, .status-pill.revoked { border-color: #a65049; color: #ffaea0; }
        @media (max-width: 1180px) { .workspace, .activation-layout { grid-template-columns: 1fr; } .visual-column { position: static; } .control-column { max-height: none; overflow: visible; } .preview-stage { height: 54vh; } }
        @media (max-width: 720px) { .calibration-shell { padding: 10px; } .topbar, .activation-head, .section-head { flex-direction: column; } .top-actions, .top-actions button { width: 100%; } .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .capture-actions, .control-stack, .result-columns { grid-template-columns: 1fr; } .activation-layout { grid-template-columns: minmax(0, 1fr); } .hash-list { grid-template-columns: 1fr; } .calibration-history article { grid-template-columns: 1fr; } }
        @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; transition: none !important; } }
      `}</style>
      <style jsx global>{`
        .ai-grader-calibration-console button.calibration-action {
          min-height: 44px;
          border: 1px solid #6b624c;
          border-radius: 6px;
          background: #262820;
          color: #f8f1df;
          padding: 9px 13px;
          font: inherit;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
        }
        .ai-grader-calibration-console button.calibration-action:hover:not(:disabled) {
          border-color: #e0c36f;
          background: #333426;
        }
        .ai-grader-calibration-console button.calibration-action:focus-visible {
          outline: 3px solid #79bfff;
          outline-offset: 2px;
        }
        .ai-grader-calibration-console button.calibration-action:disabled {
          cursor: not-allowed;
          opacity: .42;
        }
        .ai-grader-calibration-console button.calibration-action.primary,
        .ai-grader-calibration-console button.calibration-action.activate-button {
          border-color: #d8bd72;
          background: #d8bd72;
          color: #17140d;
        }
        .ai-grader-calibration-console button.calibration-action.quiet {
          background: transparent;
        }
        .ai-grader-calibration-console button.calibration-action.danger-outline {
          width: 100%;
          border-color: #a85555;
          color: #ffd0ca;
          background: #251515;
        }
      `}</style>
    </main>
  );
}
