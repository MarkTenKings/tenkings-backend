import { useEffect, useMemo, useState } from "react";
import type { RestockSession, VaultDoorId, VaultRestockItemState } from "../types";

interface RestockWizardProps {
  session: RestockSession | null;
  busy: boolean;
  onStart: () => Promise<void>;
  onOutcome: (doorId: VaultDoorId, outcome: Exclude<VaultRestockItemState, "UNREVIEWED">) => Promise<void>;
  onFinalize: (doorsClosed: boolean) => Promise<void>;
}

export function RestockWizard({ session, busy, onStart, onOutcome, onFinalize }: RestockWizardProps) {
  const [closedConfirmed, setClosedConfirmed] = useState(false);
  const [observationConfirmed, setObservationConfirmed] = useState(false);
  const current = useMemo(
    () => session?.items.find((item) => item.outcome === "UNREVIEWED") ?? session?.items.at(-1) ?? null,
    [session],
  );
  const reviewed = session?.items.filter((item) => item.outcome !== "UNREVIEWED").length ?? 0;
  const total = session?.items.length ?? 0;
  const complete = total > 0 && reviewed === total;
  const command = current?.command ?? null;
  const wrongDoorReceipt = Boolean(command?.observedDoorId && current && command.observedDoorId !== current.doorId);

  useEffect(() => {
    setObservationConfirmed(false);
    setClosedConfirmed(false);
  }, [current?.doorId, current?.outcome, command?.commandId]);

  if (!session) {
    return (
      <section className="operations-card" aria-labelledby="restock-title">
        <p className="eyebrow">Durable workflow</p>
        <h2 id="restock-title">Restock assigned doors</h2>
        <p>The local service pins the configuration and resumes the same session after a restart or lock.</p>
        <button className="primary-action" type="button" onClick={() => void onStart()} disabled={busy}>
          {busy ? "Loading…" : "Start or resume restock"}
        </button>
      </section>
    );
  }

  return (
    <section className="operations-card restock-wizard" aria-labelledby="restock-title">
      <div className="operation-heading">
        <div><p className="eyebrow">Pinned config {session.configVersion}</p><h2 id="restock-title">Restock doors</h2></div>
        <strong>{reviewed} / {total}</strong>
      </div>
      <progress value={reviewed} max={total} aria-label={`${reviewed} of ${total} restock doors reviewed`} />
      {!complete && current && (
        <div className="restock-step" key={current.doorId}>
          <span className="large-door-code">{current.doorId}</span>
          <div><strong>{current.productName}</strong><p>The local service owns the command. Wait for its terminal receipt, then inspect this exact assigned door and record the human-observed outcome.</p></div>
          <ol className="command-phases" aria-label={`Durable phases for ${current.doorId}`}>
            <li data-complete={Boolean(command)}>Command intent persisted</li>
            <li data-complete={command?.terminal === true}>Terminal controller receipt</li>
            <li data-complete={command?.observationRecorded === true}>Human observation and outcome</li>
          </ol>
          {!command && (
            <div className="phase-wait" role="status">
              <p>No command exists for this door yet. One explicit action schedules only this unobserved assigned door.</p>
              <button type="button" className="secondary-action" disabled={busy} onClick={() => void onStart()}>{busy ? "Scheduling…" : `Schedule command for ${current.doorId}`}</button>
            </div>
          )}
          {command && !command.terminal && <p className="phase-wait" role="status">Command {command.commandId} is {command.state}. Outcome controls remain locked until a terminal receipt is persisted.</p>}
          {command?.terminal && (
            <dl className="command-receipt">
              <div><dt>Command</dt><dd>{command.commandId}</dd></div>
              <div><dt>Terminal outcome</dt><dd>{command.outcome ?? command.state}</dd></div>
              <div><dt>Observed door</dt><dd>{command.observedDoorId ?? "Not reported"}</dd></div>
            </dl>
          )}
          {wrongDoorReceipt ? (
            <p className="critical-stop" role="alert">CRITICAL STOP — the controller receipt names {command?.observedDoorId}, not {current.doorId}. Do not record inventory or continue.</p>
          ) : command?.terminal ? (
            <label className="confirmation-check observation-check">
              <input type="checkbox" checked={observationConfirmed} onChange={(event) => setObservationConfirmed(event.target.checked)} />
              <span>I personally observed the physical result for {current.doorId}. The controller receipt alone is not proof that the door opened.</span>
            </label>
          ) : null}
          <div className="outcome-actions" role="group" aria-label={`Outcome for ${current.doorId}`}>
            <button type="button" disabled={busy || !command?.terminal || !observationConfirmed || wrongDoorReceipt} onClick={() => void onOutcome(current.doorId, "FILLED")}>FILLED</button>
            <button type="button" disabled={busy || !command?.terminal || !observationConfirmed || wrongDoorReceipt} onClick={() => void onOutcome(current.doorId, "LEFT_EMPTY")}>LEFT EMPTY</button>
            <button type="button" disabled={busy || !command?.terminal || !observationConfirmed || wrongDoorReceipt} onClick={() => void onOutcome(current.doorId, "EXCEPTION")}>EXCEPTION</button>
          </div>
          <p className="operation-note">Only FILLED makes the planned assignment available. Every choice is persisted before this wizard advances.</p>
        </div>
      )}
      {complete && (
        <div className="finalize-restock">
          <h3>Every assigned door is reviewed</h3>
          <label className="confirmation-check">
            <input type="checkbox" checked={closedConfirmed} onChange={(event) => setClosedConfirmed(event.target.checked)} />
            <span>I physically confirmed every serviced door is closed.</span>
          </label>
          <button type="button" className="primary-action" disabled={busy || !closedConfirmed} onClick={() => void onFinalize(closedConfirmed)}>
            {busy ? "Finalizing…" : "Finalize restock"}
          </button>
        </div>
      )}
    </section>
  );
}
