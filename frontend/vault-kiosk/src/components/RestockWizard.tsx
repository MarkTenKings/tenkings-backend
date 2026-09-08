import { useEffect, useMemo, useState } from "react";
import type { RestockSession, VaultDoorId, VaultRestockItemState } from "../types";
import { DoorMap } from "./DoorMap";

interface RestockWizardProps {
  session: RestockSession | null;
  busy: boolean;
  onStart: () => Promise<void>;
  onOutcome: (doorId: VaultDoorId, outcome: Exclude<VaultRestockItemState, "UNREVIEWED">, notes?: string, productFitConfirmed?: boolean) => Promise<void>;
  onFinalize: (doorsClosed: boolean) => Promise<void>;
}

export function RestockWizard({ session, busy, onStart, onOutcome, onFinalize }: RestockWizardProps) {
  const [closedConfirmed, setClosedConfirmed] = useState(false);
  const [observationConfirmed, setObservationConfirmed] = useState(false);
  const [fitConfirmed, setFitConfirmed] = useState(false);
  const [notes, setNotes] = useState("");
  const current = useMemo(
    () => session?.items.find((item) => item.outcome === "UNREVIEWED") ?? session?.items.at(-1) ?? null,
    [session],
  );
  const reviewed = session?.items.filter((item) => item.outcome !== "UNREVIEWED").length ?? 0;
  const total = session?.items.length ?? 0;
  const complete = total > 0 && reviewed === total;
  const command = current?.command ?? null;
  const wrongDoorReceipt = Boolean(command?.observedDoorId && current && command.observedDoorId !== current.doorId);
  const layoutAvailable = session?.configSchemaVersion === 1 || session?.configSchemaVersion === 2 && Boolean(session.machineProfile);
  const label = current?.doorLabel ?? current?.doorId;
  const compartment = session?.machineProfile?.doors.find((door) => door.doorId === current?.doorId)?.usableCompartmentMm;

  useEffect(() => {
    setObservationConfirmed(false);
    setFitConfirmed(false);
    setClosedConfirmed(false);
    setNotes("");
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
      <details className="restock-plan">
        <summary>Review the pinned plan and outcomes for {total} doors</summary>
        {[...new Set(session.items.map((item) => item.productId))].map((productId) => {
          const group = session.items.filter((item) => item.productId === productId);
          return <div key={productId ?? "unassigned"}><h3>{group[0]?.productName}</h3><p>{group.map((item) => `${item.doorLabel ?? item.doorId} (${item.outcome})`).join(" · ")}</p></div>;
        })}
        <p>{session.items.filter((item) => item.outcome === "FILLED").length} filled · {session.items.filter((item) => item.outcome === "LEFT_EMPTY").length} left empty · {session.items.filter((item) => item.outcome === "EXCEPTION").length} exceptions</p>
      </details>
      {!complete && current && (
        <div className="restock-step" key={current.doorId}>
          <span className="large-door-code">{label}</span>
          <div><strong>{current.productName}</strong><p>The local service owns the command. Wait for its terminal receipt, then inspect this exact assigned door and record the human-observed outcome.</p></div>
          <ol className="command-phases" aria-label={`Durable phases for ${current.doorId}`}>
            <li data-complete={Boolean(command)}>Command intent persisted</li>
            <li data-complete={command?.terminal === true}>Terminal controller receipt</li>
            <li data-complete={command?.observationRecorded === true}>Human observation and outcome</li>
          </ol>
          {!command && (
            <div className="phase-wait" role="status">
              <p>No command exists for this door yet. One explicit action schedules only this unobserved assigned door.</p>
              <button type="button" className="secondary-action" disabled={busy || !layoutAvailable} onClick={() => void onStart()}>{busy ? "Scheduling…" : `Schedule command for ${label}`}</button>
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
              <span>I personally observed the physical result for {label}. The controller receipt alone is not proof that the door opened.</span>
            </label>
          ) : null}
          {command?.terminal && !wrongDoorReceipt && <label className="confirmation-check product-fit-check">
            <input type="checkbox" checked={fitConfirmed} disabled={busy || !observationConfirmed} onChange={(event) => setFitConfirmed(event.target.checked)} />
            <span>I checked that the actual packaged product fits this compartment and the door closes safely.{compartment ? ` Configured usable space: ${compartment.width} × ${compartment.height} × ${compartment.depth} mm; opening size alone does not establish fit.` : " Dimensions do not replace this physical check."}</span>
          </label>}
          <div className="outcome-actions" role="group" aria-label={`Outcome for ${current.doorId}`}>
            <button type="button" disabled={busy || !layoutAvailable || !command?.terminal || !observationConfirmed || !fitConfirmed || wrongDoorReceipt} onClick={() => void onOutcome(current.doorId, "FILLED", notes, fitConfirmed)}>FILLED</button>
            <button type="button" disabled={busy || !layoutAvailable || !command?.terminal || !observationConfirmed || wrongDoorReceipt} onClick={() => void onOutcome(current.doorId, "LEFT_EMPTY", notes)}>LEFT EMPTY</button>
            <button type="button" disabled={busy || !layoutAvailable || !command?.terminal || !observationConfirmed || wrongDoorReceipt} onClick={() => void onOutcome(current.doorId, "EXCEPTION", notes)}>EXCEPTION</button>
          </div>
          <label className="restock-notes">Shortage, mismatch, or observation notes
            <textarea aria-label="Restock observation notes" value={notes} maxLength={1000} disabled={busy} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <p className="operation-note">Only FILLED makes the planned assignment available. Every choice is persisted before this wizard advances.</p>
          {session.machineProfile?.provenance === "SYNTHETIC" && <p className="operation-note">Synthetic test profile: this workflow records simulator observations and does not establish physical product fit or cabinet coverage.</p>}
          <div className="restock-map"><DoorMap configSchemaVersion={session.configSchemaVersion ?? null} machineProfile={session.machineProfile} purpose="RESTOCK" doors={session.items.map((item) => ({ doorId: item.doorId, productId: item.productId, state: "AVAILABLE", selected: item.doorId === current.doorId }))} selectedProductId={current.productId} disabled={true} animatedDoorId={current.doorId} onToggle={() => undefined} /></div>
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
