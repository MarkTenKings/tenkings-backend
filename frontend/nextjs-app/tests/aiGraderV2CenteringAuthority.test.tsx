import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error The existing DOM harness uses jsdom without a declaration package.
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { calculateCenteringScore } from "../lib/ai-grader-v2/scoring";

(require.extensions as unknown as Record<string, (module: NodeModule) => void>)[".css"] = (module) => {
  module.exports = {};
};
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const { CenteringAssist } = require("../components/ai-grader-v2/CenteringAssist") as typeof import("../components/ai-grader-v2/CenteringAssist");

test("invalid full-frame centering remains editable and cannot continue as perfect balance", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://fixture.invalid" });
  const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator };
  for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", { value: () => null });
  Object.defineProperty(dom.window.SVGElement.prototype, "setPointerCapture", { value() {} });
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const root = createRoot(container);
  const continued: import("../components/ai-grader-v2/CenteringAssist").CenteringAssistResult[] = [];
  try {
    await act(async () => root.render(<CenteringAssist
      imageUrl="https://fixture.invalid/card.webp"
      side="FRONT"
      initialInnerQuad={[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]}
      detectedBorders={["top", "right", "bottom", "left"]}
      onContinue={(result) => { continued.push(result); }}
    />));
    const image = container.querySelector("img")!;
    Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 1400 } });
    await act(async () => image.dispatchEvent(new dom.window.Event("load", { bubbles: true })));
    const button = container.querySelector("button")!;
    assert.equal(button.disabled, true);
    assert.match(container.textContent ?? "", /Adjust the printed-frame corners/);
    assert.doesNotMatch(container.textContent ?? "", /50\.0 \/ 50\.0/);
    await act(async () => button.click());
    assert.equal(continued.length, 0);
    const overlay = container.querySelector("svg")!;
    Object.defineProperty(overlay, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) });
    for (const [label, clientX, clientY] of [["Top left", 200, 100], ["Top right", 950, 100],
      ["Bottom right", 950, 900], ["Bottom left", 200, 900]] as const) {
      const handle = container.querySelector(`[aria-label="${label}"]`)!;
      await act(async () => {
        const down = new dom.window.Event("pointerdown", { bubbles: true });
        Object.assign(down, { pointerId: 1 });
        handle.dispatchEvent(down);
        const move = new dom.window.Event("pointermove", { bubbles: true });
        Object.assign(move, { pointerId: 1, clientX, clientY });
        overlay.dispatchEvent(move);
      });
    }
    assert.equal(button.disabled, false);
    await act(async () => button.click());
    assert.equal(continued.length, 1);
    assert.equal(calculateCenteringScore(continued[0].borders), 5);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) Object.defineProperty(globalThis, key, { configurable: true, value });
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  }
});
