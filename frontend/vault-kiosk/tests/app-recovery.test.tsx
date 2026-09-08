import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { VaultApiClient } from "../src/api/VaultApiClient";
import { sale, snapshot } from "./fixtures";
import { click, renderReact } from "./render";
import { MemoryStorage } from "./memoryStorage";

function response<T>(data: T) {
  return Promise.resolve({ requestId: "req-test", data });
}

function fakeApi(initial = snapshot()) {
  return {
    bootstrap: vi.fn(() => response({ expiresAt: "2026-08-17T01:00:00.000Z" })),
    getState: vi.fn(() => response(initial)),
    subscribe: vi.fn(() => ({ close: vi.fn() })),
    selectDoor: vi.fn(),
    pickForMe: vi.fn(),
    checkout: vi.fn(),
    startPayment: vi.fn(),
    openPaidDoors: vi.fn(),
    finishPaidPresentation: vi.fn(),
    recordActivity: vi.fn(),
    authenticateStaff: vi.fn(),
    getHealth: vi.fn(),
    startOrResumeRestock: vi.fn(),
    recordRestockOutcome: vi.fn(),
    finalizeRestock: vi.fn(),
    startCertification: vi.fn(),
    recordCertificationEvidence: vi.fn(),
    submitCertification: vi.fn(),
    safeExit: vi.fn(),
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("App durable recovery and conflict flows", () => {
  it("reloads the reserved sale after a lost checkout response without automatically starting or replacing payment", async () => {
    const initial = snapshot();
    const reserved = snapshot({ stateVersion: 8, sequence: 8, cart: [], activeSale: { ...sale, state: "RESERVED", paymentState: "NOT_REQUESTED", paidDoorIds: [] } });
    let current = initial;
    const api = fakeApi(initial);
    api.getState.mockImplementation(() => response(current));
    api.checkout.mockImplementation(async () => { current = reserved; throw new Error("response lost after reservation"); });
    api.startPayment.mockImplementation(() => response({ ...reserved, stateVersion: 9, sequence: 9, publicState: "PAYMENT_PENDING", activeSale: { ...reserved.activeSale!, state: "PAYMENT_REQUESTED", paymentState: "REQUESTED" } }));
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    await click(view.container.querySelector(".checkout-action"));
    await settle();
    expect(api.checkout).toHaveBeenCalledTimes(1);
    expect(api.startPayment).not.toHaveBeenCalled();
    expect(view.container.querySelector(".checkout-action")).toBeNull();
    await click(view.container.querySelector(".payment-continue-action"));
    await settle();
    expect(api.startPayment).toHaveBeenCalledTimes(1);
    expect(api.startPayment.mock.calls[0][0]).toBe(sale.saleId);
    view.unmount();
  });

  it("does not repeat an already consumed paid retry after the response is lost", async () => {
    const initial = snapshot({ publicState: "PAID_RESET_COUNTDOWN", activeSale: { ...sale, resetSecondsRemaining: 30 } });
    let current = initial;
    const api = fakeApi(initial);
    api.getState.mockImplementation(() => response(current));
    api.openPaidDoors.mockImplementation(async () => {
      current = { ...initial, stateVersion: 8, sequence: 8, activeSale: { ...initial.activeSale!, retryAvailable: false, retryUsed: true } };
      throw new Error("response lost after retry commit");
    });
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    await click(view.container.querySelector(".retry-action"));
    await settle();
    expect(api.openPaidDoors).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".retry-action")).toBeNull();
    expect(view.container.textContent).toContain("Contact Ten Kings");
    expect(api.startPayment).not.toHaveBeenCalled();
    view.unmount();
  });

  it("blocks all shopping mutations when a v2 profile is missing without hiding retained cart metadata", async () => {
    const api = fakeApi(snapshot({ configSchemaVersion: 2, machineProfile: null }));
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    expect(view.container.textContent).toContain("layout is unavailable");
    expect(view.container.querySelectorAll(".door-cell")).toHaveLength(0);
    expect(view.container.textContent).toContain("Sports Mystery Pack");
    expect(view.container.querySelector<HTMLButtonElement>(".checkout-action")?.disabled).toBe(true);
    expect([...view.container.querySelectorAll<HTMLButtonElement>(".pick-button")].every((button) => button.disabled)).toBe(true);
    expect(api.checkout).not.toHaveBeenCalled();
    view.unmount();
  });
  it("keeps Pick for me disabled throughout the persisted selection animation", async () => {
    const initial = snapshot({ cart: [] });
    const picked = snapshot({ sequence: 8, stateVersion: 8 });
    const api = fakeApi(initial);
    api.pickForMe.mockImplementation(() => response(picked));
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    const pick = view.container.querySelector<HTMLButtonElement>(".pick-button")!;
    await click(pick);
    await settle();
    expect(api.pickForMe).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".pick-flash")).not.toBeNull();
    expect(pick.disabled).toBe(true);
    await click(pick);
    expect(api.pickForMe).toHaveBeenCalledTimes(1);
    view.unmount();
  });
  it("allows individual staff entry while a controller/config dependency is blocked, but never over an active sale", async () => {
    for (const state of ["NO_VALID_CACHED_CONFIG", "CONTROLLER_NOT_READY", "NAYAX_UNAVAILABLE"] as const) {
      const api = fakeApi(snapshot({ publicState: state, activeSale: null }));
      const view = renderReact(<App api={api as unknown as VaultApiClient} />);
      await settle();
      for (let i = 0; i < 10; i++) await click(view.container.querySelector(".service-hot-corner"));
      expect(view.container.textContent).toContain("Service access");
      view.unmount();
    }
    const api = fakeApi(snapshot({ publicState: "PAYMENT_UNKNOWN", activeSale: { ...sale, paymentState: "UNKNOWN" } }));
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    for (let i = 0; i < 10; i++) await click(view.container.querySelector(".service-hot-corner"));
    expect(view.container.querySelector(".service-entry-card")).toBeNull();
    view.unmount();
  });
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", { configurable: true, value: new MemoryStorage() });
  });
  afterEach(() => document.body.replaceChildren());

  it("offers explicit RESERVED + NOT_REQUESTED recovery and reuses the persisted payment key", async () => {
    const reserved = snapshot({
      publicState: "ATTRACT",
      cart: [],
      activeSale: { ...sale, state: "RESERVED", paymentState: "NOT_REQUESTED", paidDoorIds: [] },
    });
    const api = fakeApi(reserved);
    api.startPayment.mockImplementation((_saleId, _version, key) => response({ ...reserved, stateVersion: 8, sequence: 8, publicState: "PAYMENT_PENDING", activeSale: { ...reserved.activeSale!, state: "PAYMENT_REQUESTED", paymentState: "REQUESTED" } }));
    window.localStorage.setItem(`ten-kings-vault:payment-intent-v1:${sale.saleId}`, "55555555-5555-4555-8555-555555555555");
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    expect(view.container.textContent).toContain("Payment has not been requested");
    await click(view.container.querySelector(".payment-continue-action"));
    await settle();
    expect(api.startPayment).toHaveBeenCalledWith(sale.saleId, reserved.stateVersion, "55555555-5555-4555-8555-555555555555");
    view.unmount();
  });

  it("marks exact checkout conflicts while retaining the original cart metadata", async () => {
    const initial = snapshot();
    const conflict = snapshot({
      stateVersion: 8,
      sequence: 8,
      publicState: "SHOPPING_EMPTY",
      cart: [],
      reservationConflictDoorIds: [initial.cart[0].doorId],
      preservedDoorIds: [],
    });
    const api = fakeApi(initial);
    api.checkout.mockImplementation(() => response(conflict));
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    await click(view.container.querySelector(".checkout-action"));
    await settle();
    expect(view.container.textContent).toContain("Replace this door");
    expect(view.container.querySelector(`[data-door-id="${initial.cart[0].doorId}"]`)?.className).toContain("conflict");
    expect((view.container.querySelector(".checkout-action") as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
  });

  it("provides an explicit decline return path through the presentation-only done route", async () => {
    const declined = snapshot({ publicState: "PAYMENT_DECLINED", cart: [], activeSale: { ...sale, state: "PAYMENT_DECLINED", paymentState: "DECLINED", paidDoorIds: [] } });
    const shopping = snapshot({ stateVersion: 8, sequence: 8, publicState: "ATTRACT", cart: [], activeSale: null });
    const api = fakeApi(declined);
    api.finishPaidPresentation.mockImplementation(() => response(shopping));
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    expect(view.container.textContent).toContain("No charge was completed");
    await click(view.container.querySelector(".return-shopping-action"));
    await settle();
    expect(api.finishPaidPresentation).toHaveBeenCalledWith(sale.saleId, declined.stateVersion);
    expect(view.container.textContent).toContain("Choose your mystery pack");
    view.unmount();
  });

  it("hydrates only the durable locked staff identity and requires fresh PIN reauthentication", async () => {
    const locked = snapshot({
      publicState: "SERVICE_LOCKED",
      serviceLocked: true,
      activeStaff: { sessionId: "locked-session", userId: "technician-7", role: "TECHNICIAN", locked: true, expiresAt: "2026-08-17T08:00:00.000Z" },
    });
    const api = fakeApi(locked);
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    const userId = view.container.querySelector('input[aria-label="Staff ID"]') as HTMLInputElement;
    expect(view.container.textContent).toContain("Resume locked service");
    expect(userId.value).toBe("technician-7");
    expect(userId.readOnly).toBe(false);
    expect(view.container.textContent).not.toContain("Safely exit to customer mode");
    view.unmount();
  });

  it("reauthenticates the durable identity and requires an explicit workflow resume before outcomes", async () => {
    const activeRestock = {
      id: "restock-persisted", configVersion: 3, configSchemaVersion: 1 as const, status: "ACTIVE" as const, updatedAt: "stable",
      items: [{
        doorId: "X-01" as never, productId: "sports-25", productName: "Sports Mystery Pack", outcome: "UNREVIEWED" as const,
        command: { commandId: "restock-command", doorId: "X-01" as never, state: "ACCEPTED", terminal: true, observationRecorded: false, outcome: "ACCEPTED", observedDoorId: "X-01" as never, evidenceCode: null },
      }],
    };
    const locked = snapshot({
      publicState: "SERVICE_LOCKED", serviceLocked: true, activeRestock,
      activeStaff: { sessionId: "locked-session", userId: "restocker-9", role: "RESTOCKER", locked: true, expiresAt: "2026-08-17T08:00:00.000Z" },
    });
    const resumed = snapshot({
      stateVersion: 8, sequence: 8, publicState: "SERVICE_LOCKED", serviceLocked: true, activeRestock,
      activeStaff: { sessionId: "fresh-session", userId: "restocker-9", role: "RESTOCKER", locked: false, expiresAt: "2026-08-17T09:00:00.000Z" },
    });
    let current = locked;
    const api = fakeApi(locked);
    api.getState.mockImplementation(() => response(current));
    api.authenticateStaff.mockImplementation(() => {
      current = resumed;
      return response({
        session: { sessionId: "fresh-session", userId: "restocker-9", displayName: "restocker-9", role: "RESTOCKER" as const, expiresAt: "2026-08-17T09:00:00.000Z" },
        restock: null,
        certification: null,
      });
    });
    api.startOrResumeRestock.mockImplementation(() => response({ sessionId: "restock-persisted", expectedDoorIds: ["X-01" as never] }));
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    const pin = view.container.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(pin, "123456");
      pin.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(view.container.querySelector('button[type="submit"]'));
    await settle();
    expect(view.container.textContent).toContain("Resume persisted service work");
    expect(view.container.textContent).not.toContain("Service access");
    await click([...view.container.querySelectorAll("button")].find((button) => button.textContent === "Resume durable workflow") ?? null);
    await settle();
    expect(api.startOrResumeRestock).toHaveBeenCalledWith("fresh-session", resumed.stateVersion);
    view.unmount();
  });

  it("uses a state-versioned activity mutation for the focus-contained idle warning", async () => {
    const idle = snapshot({ publicState: "IDLE_WARNING", idleSecondsRemaining: 12 });
    const resumed = snapshot({ stateVersion: 8, sequence: 8, publicState: "SHOPPING_WITH_CART", idleSecondsRemaining: 60 });
    const api = fakeApi(idle);
    api.recordActivity.mockImplementation(() => response(resumed));
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    const keep = view.container.querySelector<HTMLButtonElement>(".idle-overlay .primary-action")!;
    expect(document.activeElement).toBe(keep);
    keep.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(keep);
    await click(keep);
    await settle();
    expect(api.recordActivity).toHaveBeenCalledWith(idle.stateVersion);
    expect(view.container.querySelector(".idle-overlay")).toBeNull();
    view.unmount();
  });

  it("requires a fresh certification session binding even when its previous command was already observed", async () => {
    const cert = { configSchemaVersion: 1 as const, activeSessionId: "cert-persisted", passEvidenceCount: 1, failEvidenceCount: 0, criticalEvidenceCount: 0, nextDoorId: sale.items[0].doorId, criticalStop: false, adapterMode: "MOCK" as const, currentCommand: { commandId: "cert-command", doorId: sale.items[0].doorId, state: "ACCEPTED", terminal: true, observationRecorded: true, outcome: "ACCEPTED", observedDoorId: sale.items[0].doorId, evidenceCode: null } };
    const locked = snapshot({ serviceLocked: true, publicState: "SERVICE_LOCKED", activeCertification: cert, activeStaff: { sessionId: "old-staff", userId: "technician-1", role: "TECHNICIAN", locked: true, expiresAt: "2099-01-01T00:00:00.000Z" } });
    let current = locked;
    const api = fakeApi(locked);
    api.getState.mockImplementation(() => response(current));
    api.authenticateStaff.mockImplementation(() => {
      current = { ...locked, stateVersion: 8, sequence: 8, activeStaff: { ...locked.activeStaff!, sessionId: "new-staff", locked: false } };
      return response({ session: { ...current.activeStaff!, displayName: "Technician" }, restock: null, certification: cert });
    });
    api.startCertification.mockImplementation(() => response({ sessionId: "cert-persisted", scheduledDoorId: sale.items[0].doorId }));
    const view = renderReact(<App api={api as unknown as VaultApiClient} />);
    await settle();
    const pin = view.container.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(pin, "123456");
      pin.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(view.container.querySelector('button[type="submit"]'));
    await settle();
    expect(view.container.textContent).toContain("Resume persisted service work");
    expect(api.startCertification).not.toHaveBeenCalled();
    await click([...view.container.querySelectorAll("button")].find((button) => button.textContent === "Resume durable workflow") ?? null);
    await settle();
    expect(api.startCertification).toHaveBeenCalledWith("new-staff", 8);
    view.unmount();
  });
});
