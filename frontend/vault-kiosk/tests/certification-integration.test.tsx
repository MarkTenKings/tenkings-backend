import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { VaultApiClient } from "../src/api/VaultApiClient";
import { click, renderReact } from "./render";

const require = createRequire(import.meta.url);
const { createRig, grant, vault } = require("../../../packages/vault-machine/tests/helpers.js");
const nodeFetch = globalThis.fetch;

async function until(assertion: () => void) {
  const deadline = Date.now() + 3000;
  while (true) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    try { assertion(); return; } catch (error) { if (Date.now() >= deadline) throw error; }
  }
}

function enter(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe("certification kiosk through the real loopback service", () => {
  for (const mocked of ["controller", "payment", "neither"] as const) {
    for (const outcome of ["PASS", "FAIL", "CRITICAL"] as const) {
      it(`records ${outcome} with ${mocked} mocked and preserves submission/critical-stop authority`, async () => {
        const rig = await createRig();
        const origin = "http://127.0.0.1:47831";
        const service = new vault.VaultHttpService(rig.machine, rig.operations, { origin, port: 0, clock: rig.clock, adapterCallbackToken: "local-fixture-only" });
        let view: ReturnType<typeof renderReact> | undefined;
        try {
          const payment = await rig.payment.capabilities(); const controller = await rig.controller.identity();
          rig.payment.capabilities = async () => ({ ...payment, mode: mocked === "payment" ? "MOCK" : "OFFICIAL_TEST" });
          rig.controller.identity = async () => ({ ...controller, mode: mocked === "controller" ? "MOCK" : "OFFICIAL_TEST" });
          const staff = grant(rig, "TECHNICIAN");
          const session = await rig.operations.startCertification(staff.sessionId);
          rig.machine.staff.lock(staff.sessionId);
          const address = await service.listen();
          let cookie = "";
          // Emulate the browser's automatic Origin/cookie transport; all DTOs,
          // optimistic state checks and mutations use the actual HTTP service.
          vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
            const headers = new Headers(init.headers); headers.set("Origin", origin);
            if (cookie) headers.set("Cookie", cookie);
            const response = await nodeFetch(url, { ...init, signal: undefined, headers });
            cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
            return response;
          });
          vi.stubGlobal("crypto", webcrypto);
          const api = new VaultApiClient(`http://127.0.0.1:${address.port}`);
          vi.spyOn(api, "subscribe").mockReturnValue({ close() {} });
          view = renderReact(<App api={api} />);
          const container = view.container;
          await until(() => expect(container.querySelector('input[inputmode="numeric"]')).not.toBeNull());
          enter(container.querySelector('input[inputmode="numeric"]')!, "123456");
          await click(container.querySelector('button[type="submit"]'));
          await until(() => expect(container.textContent).toContain("Resume durable workflow"));
          await click([...container.querySelectorAll("button")].find(button => button.textContent === "Resume durable workflow")!);
          await until(() => expect(container.querySelector(".resume-workflow")).toBeNull());
          await click([...container.querySelectorAll(".staff-tabs button")].find(button => button.textContent === "Certification")!);
          await until(() => expect(container.querySelector(".evidence-actions")).not.toBeNull());
          expect(container.textContent).toContain(mocked === "neither" ? "supervised physical observation" : "simulator evidence only; no physical coverage");
          await click(container.querySelector(".observation-check input"));
          enter(container.querySelector('input[aria-label="Actually observed door IDs"]')!, outcome === "PASS" ? session.scheduledDoorId : outcome === "CRITICAL" ? "K-01" : "");
          enter(container.querySelector(".evidence-observation textarea")!, "Software fixture observation; no physical proof");
          const label = outcome === "CRITICAL" ? "Wrong/unpaid door" : `Record ${outcome}`;
          const button = [...container.querySelectorAll<HTMLButtonElement>(".evidence-actions button")].find(item => item.textContent === label)!;
          expect(button.disabled).toBe(false); await click(button);
          await until(() => expect(rig.store.one("SELECT count(*) AS n FROM certification_evidence").n).toBe(1));
          expect(rig.store.one("SELECT evidence_class,outcome FROM certification_evidence")).toMatchObject({ evidence_class: mocked === "neither" ? "FULL_MACHINE" : "AUTOMATED", outcome });
          if (outcome === "CRITICAL") {
            await until(() => expect(container.textContent).toContain("CRITICAL STOP"));
            expect(container.querySelector(".submit-certification-action")).toBeNull();
            expect(rig.store.one("SELECT status FROM certification_session").status).toBe("CRITICAL_STOP");
          } else {
            await until(() => expect(container.querySelector(".certification-submit input")).not.toBeNull());
            expect(Boolean(container.querySelector(".certification-cycle-actions"))).toBe(mocked === "payment");
            await click(container.querySelector(".certification-submit input"));
            await click(container.querySelector(".submit-certification-action"));
            await until(() => expect(rig.store.one("SELECT status FROM certification_session").status).toBe("REVIEW_REQUIRED"));
            await until(() => expect(container.querySelector<HTMLInputElement>(".safe-exit-card input")?.disabled).toBe(false));
            await click(container.querySelector(".safe-exit-card input"));
            await click([...container.querySelectorAll("button")].find(button => button.textContent?.includes("Safely exit"))!);
            await until(() => expect(rig.store.one("SELECT service_locked FROM machine_meta WHERE singleton=1").service_locked).toBe(0));
          }
        } finally {
          view?.unmount();
          if (service.server.listening) await service.close();
          rig.store.close();
        }
      });
    }
  }
});
