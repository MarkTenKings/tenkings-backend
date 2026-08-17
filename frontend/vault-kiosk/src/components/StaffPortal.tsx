import { useEffect, useMemo, useState } from "react";
import { roleMay } from "@tenkings/vault-contracts/browser";
import type {
  CertificationStatus,
  MachineHealthDetail,
  RestockSession,
  StaffSession,
  TrustedBuildIdentity,
  VaultDoorId,
  VaultRestockItemState,
} from "../types";
import { staffOperationsForRole } from "../workflow/kioskWorkflow";
import { CertificationPanel } from "./CertificationPanel";
import { RestockWizard } from "./RestockWizard";

type StaffTab = "OVERVIEW" | "RESTOCK" | "HEALTH" | "CERTIFICATION";

interface StaffPortalProps {
  staff: StaffSession;
  restock: RestockSession | null;
  certification: CertificationStatus | null;
  health: MachineHealthDetail | null;
  busy: boolean;
  error: string | null;
  buildIdentity: TrustedBuildIdentity | null;
  doorSafetyEpoch: number;
  workflowResumeRequired: boolean;
  onLoadHealth: () => Promise<void>;
  onStartRestock: () => Promise<void>;
  onRestockOutcome: (doorId: VaultDoorId, outcome: Exclude<VaultRestockItemState, "UNREVIEWED">) => Promise<void>;
  onFinalizeRestock: (closed: boolean) => Promise<void>;
  onStartCertification: () => Promise<void>;
  onCertificationEvidence: (outcome: "PASS" | "FAIL" | "CRITICAL", doorId: VaultDoorId | null) => Promise<void>;
  onSubmitCertification: (servicedDoorsClosed: boolean) => Promise<void>;
  onResumeWorkflow: () => Promise<void>;
  onSafeExit: (closed: boolean) => Promise<void>;
}

export function StaffPortal({
  staff, restock, certification, health, buildIdentity, doorSafetyEpoch, workflowResumeRequired, busy, error, onLoadHealth, onStartRestock, onRestockOutcome,
  onFinalizeRestock, onStartCertification, onCertificationEvidence, onSubmitCertification, onResumeWorkflow, onSafeExit,
}: StaffPortalProps) {
  const [tab, setTab] = useState<StaffTab>("OVERVIEW");
  const [closedConfirmed, setClosedConfirmed] = useState(false);
  const operations = useMemo(() => staffOperationsForRole(staff.role), [staff.role]);
  const restockFinalized = !restock || restock.status === "COMPLETED";
  const certificationFinalized = !certification;
  const workflowsFinalized = restockFinalized && certificationFinalized && !workflowResumeRequired;

  useEffect(() => {
    if (tab === "HEALTH" && !health) void onLoadHealth();
  }, [health, onLoadHealth, tab]);

  useEffect(() => setClosedConfirmed(false), [doorSafetyEpoch]);

  return (
    <main className="staff-portal">
      <header className="staff-header">
        <div><p className="eyebrow">Service mode locked</p><h1>{staff.displayName}</h1></div>
        <span className="role-badge">{staff.role}</span>
      </header>
      <nav className="staff-tabs" aria-label="Service areas">
        <button type="button" aria-current={tab === "OVERVIEW" ? "page" : undefined} onClick={() => setTab("OVERVIEW")}>Overview</button>
        {roleMay(staff.role, "RESTOCK_RUN") && <button type="button" aria-current={tab === "RESTOCK" ? "page" : undefined} onClick={() => setTab("RESTOCK")}>Restock</button>}
        {roleMay(staff.role, "DIAGNOSTICS_VIEW") && <button type="button" aria-current={tab === "HEALTH" ? "page" : undefined} onClick={() => setTab("HEALTH")}>Health</button>}
        {roleMay(staff.role, "CERTIFICATION_COLLECT") && <button type="button" aria-current={tab === "CERTIFICATION" ? "page" : undefined} onClick={() => setTab("CERTIFICATION")}>Certification</button>}
      </nav>
      {error && <p className="staff-error" role="alert">{error}</p>}
      {workflowResumeRequired && (
        <section className="operations-card resume-workflow" aria-labelledby="resume-workflow-title">
          <p className="eyebrow">Fresh PIN accepted</p>
          <h2 id="resume-workflow-title">Resume persisted service work</h2>
          <p>The local service retained the exact workflow across lock or restart. Rebind this fresh staff session before recording an outcome. If the previous step is already observed, continuing explicitly schedules the next single supervised command.</p>
          <button type="button" className="primary-action" disabled={busy} onClick={() => void onResumeWorkflow()}>{busy ? "Resuming…" : "Resume durable workflow"}</button>
        </section>
      )}

      {tab === "OVERVIEW" && (
        <section className="operations-grid" aria-label={`${staff.role} operations`}>
          {operations.map((operation) => (
            <article className="operation-tile" key={operation.permission}>
              <span aria-hidden="true">◆</span><h2>{operation.label}</h2><p>{operation.description}</p>
              {(operation.permission === "PRODUCT_MANAGE" || operation.permission === "TAX_MANAGE" || operation.permission === "ENROLLMENT_MANAGE" || operation.permission === "CONFIG_PUBLISH" || operation.permission === "FINANCIAL_RESOLVE") && (
                <small>Cloud Admin with fresh human step-up</small>
              )}
            </article>
          ))}
          <article className="operation-tile prohibited">
            <span aria-hidden="true">×</span><h2>No remote unlock</h2><p>This kiosk exposes no generic, batch, or remote door command. Tests run only through a supervised evidence path.</p>
          </article>
        </section>
      )}

      {tab === "RESTOCK" && roleMay(staff.role, "RESTOCK_RUN") && (
        <RestockWizard session={restock} busy={busy || workflowResumeRequired} onStart={onStartRestock} onOutcome={onRestockOutcome} onFinalize={onFinalizeRestock} />
      )}

      {tab === "HEALTH" && roleMay(staff.role, "DIAGNOSTICS_VIEW") && (
        <section className="operations-card" aria-labelledby="health-title">
          <div className="operation-heading"><div><p className="eyebrow">Redacted local facts</p><h2 id="health-title">Machine health</h2></div><button type="button" className="text-action" disabled={busy} onClick={() => void onLoadHealth()}>Refresh</button></div>
          {health ? (
            <dl className="health-grid">
              <div><dt>Readiness</dt><dd>{health.health}</dd></div>
              <div><dt>Database</dt><dd>{health.databaseIntegrity}</dd></div>
              <div><dt>Clock</dt><dd>{health.clockSafe ? "Safe" : "Blocked"}</dd></div>
              <div><dt>Storage</dt><dd>{health.storageSafe ? "Safe" : "Blocked"}</dd></div>
              <div><dt>Cloud freshness</dt><dd>{health.cloudFresh ? "Current" : "Stale"}</dd></div>
              <div><dt>Outbox</dt><dd>{health.outboxPendingCount === null ? "Unavailable" : `${health.outboxPendingCount.toLocaleString()} pending`}</dd></div>
              <div><dt>Payment adapter</dt><dd>{health.paymentAdapter}</dd></div>
              <div><dt>Controller adapter</dt><dd>{health.controllerAdapter}</dd></div>
            </dl>
          ) : <p>Loading local health…</p>}
          {health?.readinessReasons.length ? <ul className="health-reasons">{health.readinessReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
        </section>
      )}

      {tab === "CERTIFICATION" && roleMay(staff.role, "CERTIFICATION_COLLECT") && (
        <CertificationPanel status={certification} busy={busy || workflowResumeRequired} buildIdentity={buildIdentity} onStart={onStartCertification} onEvidence={onCertificationEvidence} onSubmit={onSubmitCertification} />
      )}

      <section className="safe-exit-card">
        {!workflowsFinalized && <p className="inline-alert" role="status">Safe exit remains locked until every restock is finalized and any active certification evidence is physically closed and submitted for cloud review. Critical-stop sessions require independent recovery.</p>}
        <label className="confirmation-check">
          <input type="checkbox" checked={closedConfirmed} disabled={!workflowsFinalized || busy} onChange={(event) => setClosedConfirmed(event.target.checked)} />
          <span>I confirmed every serviced door is closed and the machine area is safe.</span>
        </label>
        <button type="button" className="primary-action" disabled={busy || !workflowsFinalized || !closedConfirmed} onClick={() => void onSafeExit(closedConfirmed)}>
          Safely exit to customer mode
        </button>
      </section>
    </main>
  );
}
