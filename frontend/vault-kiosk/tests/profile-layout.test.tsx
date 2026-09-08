import { createRequire } from "node:module";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultMachineProfile } from "@tenkings/vault-contracts/browser";
import { DoorMap } from "../src/components/DoorMap";
import { CartPanel } from "../src/components/CartPanel";
import { PaidFlow } from "../src/components/PaidFlow";
import { CertificationPanel } from "../src/components/CertificationPanel";
import { StaffPortal } from "../src/components/StaffPortal";
import { displayDoorIdentities, profileCanvasSize, resolveObservedDoors } from "../src/workflow/profileLayout";
import type { CertificationStatus } from "../src/types";
import { sale, snapshot } from "./fixtures";
import { click, renderReact } from "./render";

const require = createRequire(import.meta.url);
const { makeSyntheticProfile } = require("../../../packages/vault-contracts/tests/profile-fixtures.js") as {
  makeSyntheticProfile(count: number): { profile: VaultMachineProfile; doorMapping: unknown[] };
};
afterEach(() => document.body.replaceChildren());

function enter(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("versioned profile presentation and identity", () => {
  it.each([7, 72, 125])("renders all %i mixed-size doors and cutouts with stable IDs, labels, positions and native button semantics", async (count) => {
    const { profile } = makeSyntheticProfile(count);
    const doors = profile.doors.map((door, index) => ({ doorId: door.doorId, state: index === 1 ? "EMPTY" as const : "AVAILABLE" as const, productId: index % 2 ? "pokemon-50" : "sports-25", selected: index === 0 }));
    const toggle = vi.fn();
    const props = { configSchemaVersion: 2 as const, machineProfile: profile, doors, selectedProductId: "sports-25", disabled: false, animatedDoorId: null, onToggle: toggle };
    const view = renderReact(<DoorMap {...props} />);
    const cells = [...view.container.querySelectorAll<HTMLButtonElement>(".door-cell")];
    expect(cells.map((door) => door.dataset.doorId)).toEqual(profile.doors.map((door) => door.doorId));
    expect(cells.map((door) => door.dataset.doorLabel)).toEqual(profile.doors.map((door) => door.label));
    expect(cells.every((door) => door.tagName === "BUTTON" && !door.hasAttribute("role"))).toBe(true);
    expect(view.container.querySelectorAll(".profile-cutout")).toHaveLength(3);
    expect(view.container.textContent).toContain("Synthetic test layout");
    expect(cells[1].disabled).toBe(true);
    await click(cells[0]);
    expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ doorId: profile.doors[0].doorId }));
    const geometry = cells.map((door) => door.getAttribute("style"));
    view.rerender(<DoorMap {...props} selectedProductId="pokemon-50" doors={[...doors].reverse()} />);
    expect([...view.container.querySelectorAll<HTMLButtonElement>(".door-cell")].map((door) => door.getAttribute("style"))).toEqual(geometry);
    expect(view.container.querySelector('[data-door-id="door-0001"]')).toBe(cells[0]);
    const canvas = profileCanvasSize(profile, 300);
    for (const door of profile.doors) {
      expect(canvas.width * door.displayRect.width / profile.display.width).toBeGreaterThanOrEqual(48);
      expect(canvas.height * door.displayRect.height / profile.display.height).toBeGreaterThanOrEqual(48 - 1e-8);
    }
    view.unmount();
  });

  it("requires an explicit historical schema or complete new profile and never guesses a new grid", () => {
    for (const schema of [null, 2] as const) {
      const view = renderReact(<DoorMap configSchemaVersion={schema} machineProfile={null} doors={snapshot().doors} selectedProductId="sports-25" disabled={false} animatedDoorId={null} onToggle={() => undefined} />);
      expect(view.container.querySelectorAll(".door-cell")).toHaveLength(0);
      expect(view.container.textContent).toContain("layout is unavailable");
      view.unmount();
    }
    expect(displayDoorIdentities(1)).toHaveLength(150);
  });

  it("uses customer labels for cart actions and pinned sale labels after the current profile changes", async () => {
    const profile = makeSyntheticProfile(72).profile;
    const doorId = profile.doors[0].doorId;
    const current = { ...profile, revision: 2, doors: profile.doors.map((door) => door.doorId === doorId ? { ...door, label: "New label" } : door) };
    const line = { doorId, doorLabel: "Original label", productId: "sports-25", productName: "Sports pack", priceCents: 2500 };
    const focus = vi.fn();
    const cart = renderReact(<CartPanel cart={[line]} subtotalCents={2500} taxCents={206} totalCents={2706} taxLabel="Tax" providerViolation={null} disabled={false} busy={false} onRemove={() => undefined} onFocus={focus} onCheckout={() => undefined} />);
    expect(cart.container.querySelector(".cart-line-focus")?.getAttribute("aria-label")).toBe("Find door Original label on the map");
    await click(cart.container.querySelector(".cart-line-focus"));
    expect(focus).toHaveBeenCalledWith(line);
    cart.unmount();
    const pinnedSale = { ...sale, items: [{ ...sale.items[0], doorId, doorLabel: "Original label" }], paidDoorIds: [doorId], retryUsed: true, retryAvailable: false };
    const view = renderReact(<PaidFlow snapshot={snapshot({ configSchemaVersion: 2, machineProfile: current, publicState: "SUPPORT_REQUIRED", activeSale: pinnedSale })} retryBusy={false} paymentBusy={false} doneBusy={false} onContinuePayment={() => undefined} onOpenDoors={() => undefined} onDone={() => undefined} />);
    expect(view.container.querySelector("#paid-doors-title")?.textContent).toBe("Original label");
    expect(view.container.querySelector(".paid-door-list")?.textContent).toContain("Original label");
    expect(view.container.textContent).not.toContain("New label");
    expect(new URL(view.container.querySelector<HTMLAnchorElement>(".support-page-link")!.href).searchParams.get("doors")).toBe(doorId);
    view.unmount();
  });

  it("preserves exact stable-ID case and blocks ambiguous, unknown or duplicate observation labels", () => {
    const [first, second] = makeSyntheticProfile(7).profile.doors;
    const identities = [{ doorId: first.doorId, label: "A1" }, { doorId: second.doorId, label: first.doorId }];
    expect(resolveObservedDoors("A1", identities)).toEqual([first.doorId]);
    expect(resolveObservedDoors(second.doorId.toUpperCase(), identities)).toBeNull();
    expect(resolveObservedDoors(first.doorId, identities)).toBeNull();
    expect(resolveObservedDoors("A1, A1", identities)).toBeNull();
    expect(resolveObservedDoors("A1,", identities)).toBeNull();
    expect(resolveObservedDoors("", identities)).toEqual([]);
  });

  it("records a correct-door failure with actual notes, but requires CRITICAL for an unexpected door", async () => {
    const profile = makeSyntheticProfile(72).profile;
    const door = profile.doors[0];
    const status: CertificationStatus = { configSchemaVersion: 2, machineProfile: profile, activeSessionId: "cert-1", passEvidenceCount: 0, failEvidenceCount: 0, criticalEvidenceCount: 0, nextDoorId: door.doorId, nextDoorLabel: door.label, criticalStop: false, adapterMode: "MOCK", currentCommand: { commandId: "command-1", doorId: door.doorId, doorLabel: door.label, state: "ACCEPTED", terminal: true, observationRecorded: false, outcome: "ACCEPTED", observedDoorId: door.doorId, evidenceCode: null } };
    const evidence = vi.fn(async () => undefined);
    const view = renderReact(<CertificationPanel status={status} busy={false} buildIdentity={{ sourceCommit: "a".repeat(40), appVersion: "test" }} onStart={async () => undefined} onEvidence={evidence} onSubmit={async () => undefined} />);
    await click(view.container.querySelector(".observation-check input"));
    enter(view.container.querySelector('input[aria-label="Actually observed door IDs"]')!, door.label);
    enter(view.container.querySelector("textarea")!, "Correct door released partly but test package was obstructed");
    const [pass, fail, critical] = [...view.container.querySelectorAll<HTMLButtonElement>(".evidence-actions button")];
    expect(fail.disabled).toBe(false);
    await click(fail);
    expect(evidence).toHaveBeenCalledWith("FAIL", door.doorId, { observedDoorIds: [door.doorId], notes: "Correct door released partly but test package was obstructed" });
    enter(view.container.querySelector('input[aria-label="Actually observed door IDs"]')!, profile.doors[1].label);
    expect(pass.disabled).toBe(true);
    expect(fail.disabled).toBe(true);
    expect(critical.disabled).toBe(false);
    await click(critical);
    expect(evidence).toHaveBeenLastCalledWith("CRITICAL", door.doorId, expect.objectContaining({ observedDoorIds: [profile.doors[1].doorId] }));
    view.unmount();
  });

  it("requires two fresh checks for the exact pending profile and keeps profile activation scoped to technicians/admins", async () => {
    const activate = vi.fn(async () => undefined);
    const props = { staff: { sessionId: "staff-1", userId: "staff-1", displayName: "Technician", role: "TECHNICIAN" as const, expiresAt: "2099-01-01T00:00:00.000Z" }, restock: null, certification: null, health: null, buildIdentity: null, busy: false, error: null, doorSafetyEpoch: 0, workflowResumeRequired: false, pendingProfile: { version: 2, profileId: "mixed-72", revision: 1, digest: "a".repeat(64), requiresReconfiguration: true }, onActivateProfile: activate, onLoadHealth: async () => undefined, onStartRestock: async () => undefined, onRestockOutcome: async () => undefined, onFinalizeRestock: async () => undefined, onStartCertification: async () => undefined, onCertificationEvidence: async () => undefined, onSubmitCertification: async () => undefined, onResumeWorkflow: async () => undefined, onSafeExit: async () => undefined };
    const view = renderReact(<StaffPortal {...props} />);
    const button = view.container.querySelector<HTMLButtonElement>(".profile-activate-action")!;
    expect(button.disabled).toBe(true);
    const checks = [...view.container.querySelectorAll(".profile-activation input")];
    await click(checks[0]); expect(button.disabled).toBe(true);
    await click(checks[1]); expect(button.disabled).toBe(false);
    await click(button); expect(activate).toHaveBeenCalledTimes(1);
    view.rerender(<StaffPortal {...props} pendingProfile={{ ...props.pendingProfile, version: 3, digest: "b".repeat(64) }} />);
    expect(view.container.querySelector<HTMLButtonElement>(".profile-activate-action")!.disabled).toBe(true);
    expect([...view.container.querySelectorAll<HTMLInputElement>(".profile-activation input")].every((check) => !check.checked)).toBe(true);
    view.rerender(<StaffPortal {...props} staff={{ ...props.staff, role: "RESTOCKER" }} />);
    expect(view.container.querySelector(".profile-activation")).toBeNull();
    view.unmount();
  });
});
