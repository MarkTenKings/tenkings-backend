import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultApiClient } from "../src/api/VaultApiClient";
import { snapshot } from "./fixtures";
import { createRequire } from "node:module";
import type { VaultMachineProfile } from "@tenkings/vault-contracts/browser";

const require = createRequire(import.meta.url);
const { makeSyntheticProfile } = require("../../../packages/vault-contracts/tests/profile-fixtures.js") as { makeSyntheticProfile(count: number): { profile: VaultMachineProfile } };

afterEach(() => { vi.unstubAllGlobals(); });

describe("canonical loopback API client", () => {
  it("preserves separately pinned profile and labels through the public state boundary", async () => {
    const profile = makeSyntheticProfile(72).profile;
    const [door] = profile.doors;
    const revised = { ...profile, revision: 2, doors: profile.doors.map((entry) => ({ ...entry, label: `New ${entry.label}` })) };
    const raw = {
      ...snapshot({ configSchemaVersion: 2, machineProfile: revised }),
      cart: [{ doorId: door.doorId, productId: "sports-25", productName: "Sports pack", priceCents: 2500 }],
      activeRestock: { sessionId: "restock-pinned", configVersion: 1, configSchemaVersion: 2, machineProfile: profile, status: "ACTIVE", items: [{ doorId: door.doorId, doorLabel: door.label, productId: "sports-25", productName: "Sports pack", outcome: "UNREVIEWED" }] },
      activeCertification: { sessionId: "cert-pinned", configSchemaVersion: 2, machineProfile: profile, status: "ACTIVE", passCount: 0, failCount: 0, criticalCount: 0, nextUnderTestedDoorId: door.doorId, nextUnderTestedDoorLabel: door.label, adapterMode: "MOCK", currentCommand: { commandId: "cmd", doorId: door.doorId, doorLabel: door.label, state: "ACCEPTED", terminal: true } },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: raw }))));
    const normalized = (await new VaultApiClient("http://127.0.0.1:4173").getState()).data;
    expect(normalized.cart[0].doorLabel).toBe(`New ${door.label}`);
    expect(normalized.activeRestock?.machineProfile?.revision).toBe(1);
    expect(normalized.activeRestock?.items[0].doorLabel).toBe(door.label);
    expect(normalized.activeCertification?.nextDoorLabel).toBe(door.label);
    expect(normalized.activeCertification?.currentCommand?.doorLabel).toBe(door.label);
    expect(normalized.activeCertification?.machineProfile?.revision).toBe(1);
  });

  it("binds empty-machine activation to the reviewed version, digest and two explicit checks without profile data from the browser", async () => {
    const fetchMock = vi.fn(async (_url: URL) => new Response(JSON.stringify({ data: snapshot() })));
    vi.stubGlobal("fetch", fetchMock);
    await new VaultApiClient("http://127.0.0.1:4173").activateEmptyMachineProfile("staff-1", 7, 2, "a".repeat(64));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/staff/profile-activation");
    expect(init.headers).toMatchObject({ "If-Match": "7" });
    expect(JSON.parse(String(init.body))).toEqual({ staffSessionId: "staff-1", expectedConfigVersion: 2, expectedConfigDigest: "a".repeat(64), compartmentsEmpty: true, servicedDoorsClosed: true });
    expect(fetchMock.mock.calls.map(([url]) => (url as URL).pathname)).toEqual(["/api/v1/staff/profile-activation", "/api/v1/state"]);
  });

  it("sends the explicit packaged-product fit observation with the exact restock door outcome", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { recorded: true } })));
    vi.stubGlobal("fetch", fetchMock);
    const door = makeSyntheticProfile(72).profile.doors[0];
    await new VaultApiClient("http://127.0.0.1:4173").recordRestockOutcome("restock-1", "staff-1", door.doorId, "FILLED", 7, "Fits safely", true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe(`/api/v1/restocks/restock-1/items/${door.doorId}`);
    expect(JSON.parse(String(init.body))).toEqual({ staffSessionId: "staff-1", outcome: "FILLED", notes: "Fits safely", productFitConfirmed: true });
  });
  it("accepts only an exact commit hash as trusted certification build identity", async () => {
    for (const sourceCommit of ["UNVERIFIED", "codex/vault-v1-build", "abcdef1234567", "z".repeat(40), "a".repeat(40)]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: snapshot({ buildIdentity: { sourceCommit, appVersion: "1.0.0" } }) }))));
      const state = (await new VaultApiClient("http://127.0.0.1:4173").getState()).data;
      expect(state.buildIdentity, sourceCommit).toEqual(sourceCommit === "a".repeat(40) ? { sourceCommit, appVersion: "1.0.0" } : null);
    }
  });
  it("projects machine CLOCK_UNSAFE evidence as blocked, not a healthy clock", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: {
      readiness: { ready: false, reasons: ["CLOCK_UNSAFE", "STORAGE_PRESSURE", "CLOUD_NOT_FRESH"] },
      controller: { adapter: "simulator", ready: true }, payment: { adapterName: "mock" }, integrity: { ok: true },
    } }))));
    const result = await new VaultApiClient("http://127.0.0.1:4173").getHealth();
    expect(result.data).toMatchObject({ clockSafe: false, storageSafe: false, cloudFresh: false });
  });
  it("starts the exact same-path test cycle without browser-authored door or build authority", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { cycleType: "PURCHASE", saleId: "sale-1", doorId: "X-01" } })));
    vi.stubGlobal("fetch", fetchMock);
    await new VaultApiClient("http://127.0.0.1:4173").runCertificationCycle("cert-1", "staff-1", "PURCHASE", 23);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/certification/sessions/cert-1/cycles");
    expect(init.headers).toMatchObject({ "If-Match": "23" });
    expect(JSON.parse(String(init.body))).toEqual({ staffSessionId: "staff-1", cycleType: "PURCHASE" });
  });
  it("cancels only the exact sale with a durable idempotency key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: snapshot() })));
    vi.stubGlobal("fetch", fetchMock);
    await new VaultApiClient("http://127.0.0.1:4173").cancelPayment("sale-1", 9, "cancel-key");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/sales/sale-1/cancel");
    expect(JSON.parse(String(init.body))).toEqual({ idempotencyKey: "cancel-key" });
    expect(init.headers).toMatchObject({ "If-Match": "9" });
  });
  it("renews an expired kiosk session and retries only the read", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "KIOSK_SESSION_INVALID", message: "Expired" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { expiresAt: "later" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot() })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new VaultApiClient("http://127.0.0.1:4173").getState();
    expect(result.data.configVersion).toBe(snapshot().configVersion);
    expect(fetchMock.mock.calls.map(([url]) => (url as URL).pathname)).toEqual(["/api/v1/state", "/api/v1/session/bootstrap", "/api/v1/state"]);
  });

  it("renews expiry without replaying a payment mutation or renewing staff failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "KIOSK_SESSION_INVALID", message: "Expired" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { expiresAt: "later" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "STAFF_AUTH_FAILED", message: "Failed" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new VaultApiClient("http://127.0.0.1:4173");
    await expect(client.startPayment("sale", 1, "key")).rejects.toMatchObject({ code: "KIOSK_SESSION_RENEWED" });
    expect(fetchMock.mock.calls.map(([url]) => (url as URL).pathname)).toEqual(["/api/v1/sales/sale/payment", "/api/v1/session/bootstrap"]);
    await expect(client.authenticateStaff("staff", "123456", 1)).rejects.toMatchObject({ code: "STAFF_AUTH_FAILED" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("sends contract version, same-origin credentials, JSON, and optimistic state version", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ requestId: "req-1", data: { ok: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new VaultApiClient("http://127.0.0.1:4173");
    await client.selectDoor("X-01" as never, "sports-25", true, "state-9");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/cart/select");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toMatchObject({
      "X-Vault-Contract-Version": "1",
      "Content-Type": "application/json",
      "If-Match": "state-9",
    });
    expect(JSON.parse(String(init.body))).toEqual({ doorId: "X-01", productId: "sports-25", selected: true });
  });

  it("uses only the frozen paid-group retry endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ requestId: "req-2", data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new VaultApiClient("http://127.0.0.1:4173");
    await client.openPaidDoors("11111111-1111-4111-8111-111111111111", "state-10", "22222222-2222-4222-8222-222222222222");
    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/api/v1/sales/11111111-1111-4111-8111-111111111111/open-doors");
    expect(url.pathname).not.toMatch(/unlock|controller|hardware|batch/i);
  });

  it("records unpaid activity with the current optimistic state version", async () => {
    const state = snapshot({ stateVersion: 19 });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ requestId: "req-activity", data: state }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await new VaultApiClient("http://127.0.0.1:4173").recordActivity(18);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/session/activity");
    expect(init.headers).toMatchObject({ "If-Match": "18", "X-Vault-Contract-Version": "1" });
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it("starts certification without accepting browser-authored source or build identity", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ requestId: "req-cert-start", data: { sessionId: "cert-1", scheduledDoorId: "X-01" } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await new VaultApiClient("http://127.0.0.1:4173").startCertification("staff-1", 22);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/certification/sessions");
    expect(JSON.parse(String(init.body))).toEqual({ staffSessionId: "staff-1" });
    expect(String(init.body)).not.toMatch(/source|commit|version/i);
  });

  it("submits certification only with state version and explicit physical-close confirmation", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ requestId: "req-cert-submit", data: { submitted: true } }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await new VaultApiClient("http://127.0.0.1:4173").submitCertification("cert-1", "staff-1", true, 24);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/certification/sessions/cert-1/submit");
    expect(init.headers).toMatchObject({ "If-Match": "24" });
    expect(JSON.parse(String(init.body))).toEqual({ staffSessionId: "staff-1", servicedDoorsClosed: true });
  });

  it("normalizes service errors without leaking response details into the call site", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      requestId: "req-3", error: { code: "STATE_CONFLICT", message: "Reload durable state", retryable: true },
    }), { status: 409, headers: { "Content-Type": "application/json" } })));
    const client = new VaultApiClient("http://127.0.0.1:4173");
    await expect(client.getState()).rejects.toMatchObject({
      code: "STATE_CONFLICT", requestId: "req-3", retryable: true,
    });
  });

  it("normalizes numeric machine state, nested tax, sale timers, and resumable restock", async () => {
    const base = snapshot();
    const wire = {
      ...base,
      stateVersion: 12,
      sequence: 44,
      city: undefined,
      state: undefined,
      taxRateBasisPoints: undefined,
      tax: { city: "Burbank", state: "CA", rateBasisPoints: 1025 },
      activeSale: null,
      sale: null,
      activeRestock: {
        sessionId: "restock-2", configVersion: 3, status: "IN_PROGRESS",
        items: [{ doorId: base.doors[0].doorId, productId: "sports-25", productName: "Sports Mystery Pack", outcome: "FILLED" }],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ requestId: "req-4", data: wire }), {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    const response = await new VaultApiClient("http://127.0.0.1:4173").getState();
    expect(response.data.stateVersion).toBe(12);
    expect(response.data.city).toBe("Burbank");
    expect(response.data.taxRateBasisPoints).toBe(1025);
    expect(response.data.activeRestock?.id).toBe("restock-2");
    expect(response.data.activeRestock?.items[0].outcome).toBe("FILLED");
    expect(response.data.activeRestock?.items[0].command).toBeNull();
  });

  it("normalizes trusted command receipts and evidence counts without inventing certification coverage", async () => {
    const base = snapshot();
    const command = {
      commandId: "cert-command-1", doorId: base.doors[0].doorId, state: "ACCEPTED", terminal: true,
      observationRecorded: false, outcome: "ACCEPTED", observedDoorId: base.doors[0].doorId, evidenceCode: null,
    };
    const wire = {
      ...base,
      activeCertification: {
        sessionId: "cert-1", configVersion: 3, status: "ACTIVE", adapterMode: "MOCK",
        passCount: 4, failCount: 2, criticalCount: 0, nextUnderTestedDoorId: base.doors[0].doorId, currentCommand: command,
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ requestId: "req-cert", data: wire }), {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    const normalized = (await new VaultApiClient("http://127.0.0.1:4173").getState()).data.activeCertification!;
    expect(normalized).toMatchObject({ passEvidenceCount: 4, failEvidenceCount: 2, criticalEvidenceCount: 0 });
    expect(normalized.currentCommand).toMatchObject({ commandId: "cert-command-1", terminal: true, observationRecorded: false });
    expect(normalized).not.toHaveProperty("purchaseCyclesCompleted");
  });

  it("uses the browser-safe contract subprotocol and nested snapshot sequence for events", () => {
    const listeners = new Map<string, (event: { data?: string }) => void>();
    class FakeWebSocket {
      static latest: FakeWebSocket;
      readonly url: URL;
      readonly protocol: string;
      constructor(url: URL, protocol: string) { this.url = url; this.protocol = protocol; FakeWebSocket.latest = this; }
      addEventListener(type: string, listener: (event: { data?: string }) => void) { listeners.set(type, listener); }
      close() {}
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const onEvent = vi.fn();
    const client = new VaultApiClient("http://127.0.0.1:4173");
    client.subscribe(onEvent, () => undefined);
    expect(FakeWebSocket.latest.protocol).toBe("vault-contract-v1");
    listeners.get("message")?.({ data: JSON.stringify({ type: "PUBLIC_STATE", data: snapshot({ sequence: 77 }) }) });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "PUBLIC_STATE", sequence: 77 }));
  });
});
