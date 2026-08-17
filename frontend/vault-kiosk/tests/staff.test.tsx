import { afterEach, describe, expect, it, vi } from "vitest";
import { CertificationPanel } from "../src/components/CertificationPanel";
import { RestockWizard } from "../src/components/RestockWizard";
import { StaffPortal } from "../src/components/StaffPortal";
import { doors } from "./fixtures";
import { click, renderReact } from "./render";

afterEach(() => document.body.replaceChildren());

describe("durable staff operations", () => {
  it("records only explicit per-door restock outcomes and enables finalize after all are reviewed", async () => {
    const outcome = vi.fn(async () => undefined);
    const session = {
      id: "restock-1", configVersion: 3, status: "ACTIVE" as const, updatedAt: "2026-08-16T00:00:00.000Z",
      items: [{ doorId: doors[0].doorId, productId: "sports-25", productName: "Sports Mystery Pack", outcome: "UNREVIEWED" as const, command: {
        commandId: "restock-command-1", doorId: doors[0].doorId, state: "ACCEPTED", terminal: true, observationRecorded: false,
        outcome: "ACCEPTED", observedDoorId: doors[0].doorId, evidenceCode: null,
      } }],
    };
    const view = renderReact(<RestockWizard session={session} busy={false} onStart={async () => undefined} onOutcome={outcome} onFinalize={async () => undefined} />);
    expect(view.container.textContent).toContain(doors[0].doorId);
    expect(view.container.textContent).toContain("Only FILLED makes");
    const filled = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "FILLED")!;
    expect(filled.disabled).toBe(true);
    await click(view.container.querySelector(".observation-check input"));
    expect(filled.disabled).toBe(false);
    await click(filled);
    expect(outcome).toHaveBeenCalledWith(doors[0].doorId, "FILLED");
    view.rerender(<RestockWizard session={{ ...session, status: "READY_TO_FINALIZE", items: [{ ...session.items[0], outcome: "FILLED" }] }} busy={false} onStart={async () => undefined} onOutcome={outcome} onFinalize={async () => undefined} />);
    const finalize = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Finalize restock")!;
    expect(finalize.disabled).toBe(true);
    expect(view.container.textContent).toContain("physically confirmed every serviced door is closed");
    view.unmount();
  });

  it("keeps certification visibly isolated and fail-closes a critical observation", () => {
    const status = {
      activeSessionId: "cert-1", passEvidenceCount: 25, failEvidenceCount: 0, criticalEvidenceCount: 1,
      nextDoorId: doors[5].doorId, criticalStop: true, currentCommand: {
        commandId: "cert-command-1", doorId: doors[5].doorId, state: "ACCEPTED", terminal: true,
        observationRecorded: true, outcome: "ACCEPTED", observedDoorId: doors[5].doorId, evidenceCode: null,
      },
    };
    const view = renderReact(<CertificationPanel status={status} busy={false} buildIdentity={{ sourceCommit: "abcdef1234567", appVersion: "1.0.0" }} onStart={async () => undefined} onEvidence={async () => undefined} onSubmit={async () => undefined} />);
    expect(view.container.textContent).toContain("TEST MODE · NEVER PRODUCTION REVENUE");
    expect(view.container.textContent).toContain("CRITICAL STOP");
    expect(view.container.textContent).not.toContain("Record PASS");
    view.unmount();
  });

  it("renders only Restocker operations, gates safe exit on finalization, and resets close confirmation after a door action", async () => {
    const staff = { sessionId: "staff-1", userId: "r1", displayName: "Restocker One", role: "RESTOCKER" as const, expiresAt: "2026-08-17T00:00:00.000Z" };
    const view = renderReact(
      <StaffPortal
        staff={staff} restock={null} certification={null} health={null} buildIdentity={{ sourceCommit: "abcdef1234567", appVersion: "1.0.0" }} doorSafetyEpoch={0} workflowResumeRequired={false} busy={false} error={null}
        onLoadHealth={async () => undefined} onStartRestock={async () => undefined} onRestockOutcome={async () => undefined}
        onFinalizeRestock={async () => undefined} onStartCertification={async () => undefined}
        onCertificationEvidence={async () => undefined} onSubmitCertification={async () => undefined} onResumeWorkflow={async () => undefined} onSafeExit={async () => undefined}
      />,
    );
    expect(view.container.textContent).toContain("Restock doors");
    expect(view.container.textContent).not.toContain("Machine health");
    expect(view.container.textContent).not.toContain("Enrollment and keys");
    expect(view.container.textContent).toContain("No remote unlock");
    const exit = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Safely exit"))!;
    expect(exit.disabled).toBe(true);
    await click(view.container.querySelector(".safe-exit-card input"));
    expect(exit.disabled).toBe(false);
    view.rerender(
      <StaffPortal
        staff={staff} restock={null} certification={null} health={null} buildIdentity={{ sourceCommit: "abcdef1234567", appVersion: "1.0.0" }} doorSafetyEpoch={1} workflowResumeRequired={false} busy={false} error={null}
        onLoadHealth={async () => undefined} onStartRestock={async () => undefined} onRestockOutcome={async () => undefined}
        onFinalizeRestock={async () => undefined} onStartCertification={async () => undefined}
        onCertificationEvidence={async () => undefined} onSubmitCertification={async () => undefined} onResumeWorkflow={async () => undefined} onSafeExit={async () => undefined}
      />,
    );
    expect((view.container.querySelector(".safe-exit-card input") as HTMLInputElement).checked).toBe(false);
    expect(exit.disabled).toBe(true);
    view.unmount();
  });

  it("fails closed before a terminal restock receipt and schedules only the current unobserved door", async () => {
    const start = vi.fn(async () => undefined);
    const outcome = vi.fn(async () => undefined);
    const session = {
      id: "restock-2", configVersion: 3, status: "ACTIVE" as const, updatedAt: "stable",
      items: [{ doorId: doors[0].doorId, productId: "sports-25", productName: "Sports Mystery Pack", outcome: "UNREVIEWED" as const, command: null }],
    };
    const view = renderReact(<RestockWizard session={session} busy={false} onStart={start} onOutcome={outcome} onFinalize={async () => undefined} />);
    expect([...view.container.querySelectorAll<HTMLButtonElement>(".outcome-actions button")].every((button) => button.disabled)).toBe(true);
    await click([...view.container.querySelectorAll("button")].find((button) => button.textContent?.includes("Schedule command")) ?? null);
    expect(start).toHaveBeenCalledTimes(1);
    expect(outcome).not.toHaveBeenCalled();
    view.unmount();
  });

  it("requires trusted service identity and exact command-to-door binding for certification evidence", async () => {
    const evidence = vi.fn(async () => undefined);
    const status = {
      activeSessionId: "cert-2", passEvidenceCount: 0, failEvidenceCount: 0, criticalEvidenceCount: 0,
      nextDoorId: doors[1].doorId, criticalStop: false, currentCommand: {
        commandId: "cert-command-2", doorId: doors[0].doorId, state: "ACCEPTED", terminal: true,
        observationRecorded: false, outcome: "ACCEPTED", observedDoorId: doors[0].doorId, evidenceCode: null,
      },
    };
    const view = renderReact(<CertificationPanel status={status} busy={false} buildIdentity={null} onStart={async () => undefined} onEvidence={evidence} onSubmit={async () => undefined} />);
    expect(view.container.textContent).toContain("Trusted service build identity is unavailable");
    expect(view.container.textContent).toContain("binding does not match");
    expect([...view.container.querySelectorAll<HTMLButtonElement>(".evidence-actions button")].every((button) => button.disabled)).toBe(true);
    expect(view.container.textContent).toContain("Recorded PASS evidence");
    expect(view.container.textContent).not.toContain("Purchase door cycles");
    view.unmount();
  });

  it("blocks safe exit while a durable door workflow is not finalized", async () => {
    const staff = { sessionId: "staff-2", userId: "r2", displayName: "Restocker Two", role: "RESTOCKER" as const, expiresAt: "2026-08-17T00:00:00.000Z" };
    const activeRestock = {
      id: "restock-active", configVersion: 3, status: "ACTIVE" as const, updatedAt: "stable",
      items: [{ doorId: doors[0].doorId, productId: "sports-25", productName: "Sports Mystery Pack", outcome: "UNREVIEWED" as const, command: null }],
    };
    const resume = vi.fn(async () => undefined);
    const view = renderReact(
      <StaffPortal
        staff={staff} restock={activeRestock} certification={null} health={null} buildIdentity={{ sourceCommit: "abcdef1234567", appVersion: "1.0.0" }} doorSafetyEpoch={4} workflowResumeRequired={true} busy={false} error={null}
        onLoadHealth={async () => undefined} onStartRestock={async () => undefined} onRestockOutcome={async () => undefined}
        onFinalizeRestock={async () => undefined} onStartCertification={async () => undefined}
        onCertificationEvidence={async () => undefined} onSubmitCertification={async () => undefined} onResumeWorkflow={resume} onSafeExit={async () => undefined}
      />,
    );
    expect(view.container.textContent).toContain("Safe exit remains locked");
    expect((view.container.querySelector(".safe-exit-card input") as HTMLInputElement).disabled).toBe(true);
    expect([...view.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Safely exit"))?.disabled).toBe(true);
    await click([...view.container.querySelectorAll("button")].find((button) => button.textContent === "Resume durable workflow") ?? null);
    expect(resume).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("requires a fresh physical-close confirmation to submit certification for review without calling it approval", async () => {
    const submit = vi.fn(async () => undefined);
    const status = {
      activeSessionId: "cert-submit", passEvidenceCount: 1, failEvidenceCount: 0, criticalEvidenceCount: 0,
      nextDoorId: doors[1].doorId, criticalStop: false, currentCommand: {
        commandId: "cert-command-observed", doorId: doors[0].doorId, state: "ACCEPTED", terminal: true,
        observationRecorded: true, outcome: "ACCEPTED", observedDoorId: doors[0].doorId, evidenceCode: null,
      },
    };
    const view = renderReact(<CertificationPanel status={status} busy={false} buildIdentity={{ sourceCommit: "abcdef1234567", appVersion: "1.0.0" }} onStart={async () => undefined} onEvidence={async () => undefined} onSubmit={submit} />);
    const button = view.container.querySelector<HTMLButtonElement>(".submit-certification-action")!;
    expect(button.disabled).toBe(true);
    expect(view.container.textContent).toContain("It is not certification approval");
    await click(view.container.querySelector(".certification-submit input"));
    expect(button.disabled).toBe(false);
    await click(button);
    expect(submit).toHaveBeenCalledWith(true);
    view.unmount();
  });
});
