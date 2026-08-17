import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultApiClient } from "../src/api/VaultApiClient";
import { snapshot } from "./fixtures";

afterEach(() => { vi.unstubAllGlobals(); });

describe("canonical loopback API client", () => {
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
