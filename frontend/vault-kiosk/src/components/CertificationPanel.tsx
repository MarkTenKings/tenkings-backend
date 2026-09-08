import { useEffect, useState } from "react";
import type { CertificationStatus, CertificationObservation, TrustedBuildIdentity, VaultDoorId } from "../types";
import { displayDoorIdentities, resolveObservedDoors } from "../workflow/profileLayout";
import { observationEvidenceClass } from "../workflow/certificationEvidence";

interface CertificationPanelProps {
  status: CertificationStatus | null;
  busy: boolean;
  buildIdentity: TrustedBuildIdentity | null;
  onStart: () => Promise<void>;
  onEvidence: (outcome: "PASS" | "FAIL" | "CRITICAL", doorId: VaultDoorId | null, observation: CertificationObservation) => Promise<void>;
  onSubmit: (servicedDoorsClosed: boolean) => Promise<void>;
  onCycle?: (cycleType: "PURCHASE" | "RESTOCK") => Promise<void>;
}

export function CertificationPanel({ status, busy, buildIdentity, onStart, onEvidence, onSubmit, onCycle }: CertificationPanelProps) {
  const [observationConfirmed, setObservationConfirmed] = useState(false);
  const [closedConfirmed, setClosedConfirmed] = useState(false);
  const [observedDoors, setObservedDoors] = useState("");
  const [notes, setNotes] = useState("");
  const command = status?.currentCommand ?? null;
  const commandDoorId = command?.doorId ?? null;
  const commandMatchesScheduledDoor = Boolean(commandDoorId && status?.nextDoorId === commandDoorId);
  const wrongDoorReceipt = Boolean(command?.observedDoorId && commandDoorId && command.observedDoorId !== commandDoorId);
  const evidenceCount = (status?.passEvidenceCount ?? 0) + (status?.failEvidenceCount ?? 0) + (status?.criticalEvidenceCount ?? 0);
  const currentObservationRecorded = command?.observationRecorded === true;
  const identities = displayDoorIdentities(status?.configSchemaVersion, status?.machineProfile);
  const resolvedIds = resolveObservedDoors(observedDoors, identities);
  const observedIds = resolvedIds ?? [];
  const observationValid = identities.length > 0 && resolvedIds !== null && notes.trim().length >= 3;
  const observedUnexpected = observedIds.some((id) => id !== commandDoorId);
  const passValid = observationValid && observedIds.length === 1 && observedIds[0] === commandDoorId;
  const sendEvidence = (outcome: "PASS" | "FAIL" | "CRITICAL") => onEvidence(outcome, commandDoorId, { observedDoorIds: observedIds as VaultDoorId[], notes: notes.trim() });
  const evidenceClass = observationEvidenceClass(status);
  const simulatedEvidence = evidenceClass === "AUTOMATED";
  const simulatedCycles = status?.adapterMode === "MOCK";
  const commandLabel = command?.doorLabel ?? identities.find((door) => door.doorId === commandDoorId)?.label ?? commandDoorId;

  useEffect(() => {
    setObservationConfirmed(false);
    setClosedConfirmed(false);
    setObservedDoors("");
    setNotes("");
  }, [command?.commandId, evidenceCount]);

  return (
    <section className="operations-card certification-panel" aria-labelledby="certification-title">
      <strong className="test-mode-banner">TEST MODE · NEVER PRODUCTION REVENUE</strong>
      <p className="eyebrow">Version-bound evidence</p>
      <h2 id="certification-title">Machine certification</h2>
      {status?.activeSessionId && <p className="adapter-mode-label">{simulatedEvidence ? "MOCK ADAPTER IN SESSION · simulator evidence only; no physical coverage" : evidenceClass ? "OFFICIAL_TEST adapters · supervised physical observation" : "Adapter provenance unavailable; evidence is blocked"}</p>}
      {buildIdentity ? (
        <dl className="command-receipt trusted-build">
          <div><dt>Service build</dt><dd>{buildIdentity.appVersion}</dd></div>
          <div><dt>Source commit</dt><dd>{buildIdentity.sourceCommit}</dd></div>
        </dl>
      ) : <p className="critical-stop" role="alert">Trusted service build identity is unavailable. Certification cannot start from browser-supplied provenance.</p>}
      {!status?.activeSessionId ? (
        <>
          <p>Start an immutable certification session using only the configured test adapters. This cannot activate live payment or a generic door command.</p>
          <button type="button" className="primary-action" disabled={busy || !buildIdentity} onClick={() => void onStart()}>
            {busy ? "Starting…" : "Start TEST MODE session"}
          </button>
        </>
      ) : (
        <>
          {status.criticalStop && <p className="critical-stop" role="alert">CRITICAL STOP — physical automation is fail-closed pending independent review.</p>}
          <dl className="coverage-grid">
            <div><dt>Recorded PASS evidence</dt><dd>{status.passEvidenceCount}</dd></div>
            <div><dt>Recorded FAIL evidence</dt><dd>{status.failEvidenceCount}</dd></div>
            <div><dt>Recorded CRITICAL evidence</dt><dd>{status.criticalEvidenceCount}</dd></div>
            <div><dt>Full certification thresholds</dt><dd>Server report only</dd></div>
          </dl>
          <div className="next-test-door">
            <span>{evidenceCount ? "Next deterministic coverage target" : "Scheduled test door"}</span>
            <strong>{status.nextDoorLabel ?? identities.find((door) => door.doorId === status.nextDoorId)?.label ?? status.nextDoorId ?? "Unavailable"}</strong>
          </div>
          <ol className="command-phases" aria-label="Durable certification test phases">
            <li data-complete={Boolean(command)}>Command intent persisted</li>
            <li data-complete={command?.terminal === true}>Terminal controller receipt</li>
            <li data-complete={currentObservationRecorded}>Human observation and evidence</li>
          </ol>
          {!command && !status.criticalStop && <p className="phase-wait" role="status">Waiting for the local service to expose the durable certification command.</p>}
          {command && !command.terminal && <p className="phase-wait" role="status">Command {command.commandId} is {command.state}. Evidence controls remain locked pending a terminal receipt.</p>}
          {command?.terminal && (
            <dl className="command-receipt">
              <div><dt>Command</dt><dd>{command.commandId}</dd></div>
              <div><dt>Workflow</dt><dd>{command.cycleType ?? "DIAGNOSTIC"}</dd></div>
              <div><dt>Bound door</dt><dd>{commandLabel ?? "Unavailable"}{commandLabel !== commandDoorId && <small> · ID {commandDoorId}</small>}</dd></div>
              <div><dt>Terminal outcome</dt><dd>{command.outcome ?? command.state}</dd></div>
              <div><dt>Controller-observed door</dt><dd>{command.observedDoorId ?? "Not reported"}</dd></div>
            </dl>
          )}
          {command?.terminal && !currentObservationRecorded && !status.criticalStop && commandMatchesScheduledDoor && (
            <label className="confirmation-check observation-check">
              <input type="checkbox" checked={observationConfirmed} onChange={(event) => setObservationConfirmed(event.target.checked)} />
              <span>I reviewed the {simulatedEvidence ? "simulated" : evidenceClass ? "physical" : "reported"} result for {commandLabel}. The controller receipt alone is not proof of opening.</span>
            </label>
          )}
          {command?.terminal && !currentObservationRecorded && !status.criticalStop && (
            <div className="evidence-observation">
              <label>Actually observed door labels or IDs (comma separated; leave blank if none)
                <input aria-label="Actually observed door IDs" value={observedDoors} onChange={(event) => setObservedDoors(event.target.value)} disabled={busy} maxLength={1000} placeholder={commandDoorId ?? "Exact door ID"} />
              </label>
              <label>Observation notes
                <textarea aria-label="Observation notes" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={busy} maxLength={1000} />
              </label>
              {resolvedIds === null && <p role="alert">Use exact, unique IDs or labels from this pinned profile. For labels containing commas, use the stable ID. Ambiguous or duplicate entries are blocked.</p>}
              {!identities.length && <p className="critical-stop" role="alert">The pinned door profile is unavailable. Evidence is blocked until the local service restores its exact configuration.</p>}
              <details className="door-identity-reference"><summary>Door label and stable ID reference</summary><ul>{identities.map((door) => <li key={door.doorId}>{door.label} · ID {door.doorId}</li>)}</ul></details>
              {observedUnexpected && <p className="critical-stop" role="alert">An unexpected door was observed. Record CRITICAL to preserve the actual door IDs and stop automation.</p>}
            </div>
          )}
          {command?.terminal && !commandMatchesScheduledDoor && !currentObservationRecorded && <p className="critical-stop" role="alert">Command-to-door binding does not match the scheduled test. Evidence recording is blocked.</p>}
          {wrongDoorReceipt && !currentObservationRecorded && <p className="critical-stop" role="alert">CRITICAL STOP — the controller receipt names {command?.observedDoorId}, not the bound door {commandDoorId}. Only a supervised CRITICAL observation may be recorded.</p>}
          {commandDoorId && !status.criticalStop && !currentObservationRecorded && (
            <div className="evidence-actions" role="group" aria-label={`Record evidence for ${commandDoorId}`}>
              <button type="button" disabled={busy || !buildIdentity || !evidenceClass || !command?.terminal || command.state !== "ACCEPTED" || !commandMatchesScheduledDoor || !observationConfirmed || wrongDoorReceipt || !passValid} onClick={() => void sendEvidence("PASS")}>Record PASS</button>
              <button type="button" disabled={busy || !buildIdentity || !evidenceClass || !command?.terminal || !commandMatchesScheduledDoor || !observationConfirmed || wrongDoorReceipt || !observationValid || observedUnexpected} onClick={() => void sendEvidence("FAIL")}>Record FAIL</button>
              <button type="button" disabled={busy || !buildIdentity || !evidenceClass || !command?.terminal || !commandMatchesScheduledDoor || !observationConfirmed || !observationValid} className="danger" onClick={() => void sendEvidence("CRITICAL")}>Wrong/unpaid door</button>
            </div>
          )}
          {currentObservationRecorded && !status.criticalStop && (
            <div className="phase-complete" role="status">
              <p>This supervised test has durable human evidence. The service may now schedule the next deterministic under-tested door.</p>
              <button type="button" className="secondary-action" disabled={busy || !buildIdentity || !identities.length} onClick={() => void onStart()}>{busy ? "Scheduling…" : "Schedule next supervised test"}</button>
              {simulatedCycles && onCycle && <div className="certification-cycle-actions">
                <button type="button" className="secondary-action" disabled={busy || !buildIdentity || !identities.length} onClick={() => void onCycle("PURCHASE")}>Run simulated purchase cycle</button>
                <button type="button" className="secondary-action" disabled={busy || !buildIdentity || !identities.length} onClick={() => void onCycle("RESTOCK")}>Run simulated restock cycle</button>
                <p>Purchase cycles use the same payment and fulfillment path. After a restock cycle, complete the exact door outcome and safe-close checklist in Restock before continuing.</p>
              </div>}
            </div>
          )}
          {currentObservationRecorded && !status.criticalStop && (
            <div className="certification-submit">
              <h3>Finish local evidence collection</h3>
              <p>Submission closes this local TEST MODE session for cloud review. It is not certification approval or launch authorization.</p>
              <label className="confirmation-check">
                <input type="checkbox" checked={closedConfirmed} disabled={busy} onChange={(event) => setClosedConfirmed(event.target.checked)} />
                <span>I physically confirmed every serviced certification door is closed.</span>
              </label>
              <button type="button" className="primary-action submit-certification-action" disabled={busy || !closedConfirmed} onClick={() => void onSubmit(closedConfirmed)}>
                {busy ? "Submitting…" : "Submit evidence for cloud review"}
              </button>
            </div>
          )}
          <p className="operation-note">Any wrong-door or unpaid-door observation is critical. Evidence is preserved and automation stops.</p>
        </>
      )}
    </section>
  );
}
