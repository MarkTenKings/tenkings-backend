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
    const userId = view.container.querySelector('input[autocomplete="username"]') as HTMLInputElement;
    expect(view.container.textContent).toContain("Resume locked service");
    expect(userId.value).toBe("technician-7");
    expect(userId.readOnly).toBe(true);
    expect(view.container.textContent).not.toContain("Safely exit to customer mode");
    view.unmount();
  });

  it("reauthenticates the durable identity and requires an explicit workflow resume before outcomes", async () => {
    const activeRestock = {
      id: "restock-persisted", configVersion: 3, status: "ACTIVE" as const, updatedAt: "stable",
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
});
