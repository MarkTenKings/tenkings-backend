import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const { JSDOM } = require("jsdom") as { JSDOM: new (...args: any[]) => any };
const cssExtensions = require.extensions as unknown as Record<string, (module: NodeModule) => void>;
cssExtensions[".css"] = (module) => {
  module.exports = new Proxy({}, {
    get: (_target, property) => property === "__esModule" ? false : String(property),
  });
};

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { DefectEvidenceViewer } = require(
  "../components/ai-grader-v2/DefectEvidenceViewer",
) as typeof import("../components/ai-grader-v2/DefectEvidenceViewer");

const inspectionFrame = {
  width: 1350,
  height: 1858,
  cardBounds: { x: 40, y: 40, width: 1270, height: 1778 },
};

test("public report remounts by side and exposes no annotations before that side's master image is ready", async () => {
  const rootPath = fileURLToPath(new URL("..", import.meta.url));
  const report = readFileSync(`${rootPath}/pages/ai-grader-v2/reports/[slug].tsx`, "utf8");
  assert.match(report, /<DefectEvidenceViewer\s+key=\{side\}/);

  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "https://collect.tenkings.co/ai-grader-v2/reports/test",
    pretendToBeVisual: true,
  });
  const previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: globalThis.navigator,
    HTMLElement: globalThis.HTMLElement,
    HTMLImageElement: globalThis.HTMLImageElement,
    HTMLCanvasElement: globalThis.HTMLCanvasElement,
    Event: globalThis.Event,
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    HTMLImageElement: { configurable: true, value: dom.window.HTMLImageElement },
    HTMLCanvasElement: { configurable: true, value: dom.window.HTMLCanvasElement },
    Event: { configurable: true, value: dom.window.Event },
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ clearRect() {}, fillRect() {}, set fillStyle(_value: string) {} }),
  });

  const container = dom.window.document.getElementById("root") as HTMLElement;
  const root = createRoot(container);
  const renderSide = async (side: "FRONT" | "BACK") => act(async () => root.render(
    <DefectEvidenceViewer
      key={side}
      masterImageUrl={`https://images.example.test/${side.toLowerCase()}-master.png`}
      magnifyImageUrl={`https://images.example.test/${side.toLowerCase()}-original.webp`}
      inspectionFrame={inspectionFrame}
      sourceImageUrls={{ ORIGINAL: `https://images.example.test/${side.toLowerCase()}-original.webp` }}
      side={side}
      defects={[]}
      readOnly
    />,
  ));

  try {
    await renderSide("FRONT");
    assert.match(container.textContent ?? "", /Loading Front evidence/i);
    assert.equal(container.querySelector('[data-evidence-overlay="FRONT"]'), null);
    const frontImage = container.querySelector("img");
    assert.ok(frontImage);
    await act(async () => frontImage.dispatchEvent(new dom.window.Event("load", { bubbles: true })));
    assert.ok(container.querySelector('[data-evidence-overlay="FRONT"]'));

    await renderSide("BACK");
    assert.match(container.textContent ?? "", /Loading Back evidence/i);
    assert.equal(container.querySelector('[data-evidence-overlay="BACK"]'), null);
    assert.equal(container.innerHTML.includes("front-master.png"), false);
    const backImage = container.querySelector("img");
    assert.ok(backImage);
    assert.match(backImage.getAttribute("src") ?? "", /back-master\.png/);
    await act(async () => backImage.dispatchEvent(new dom.window.Event("load", { bubbles: true })));
    assert.ok(container.querySelector('[data-evidence-overlay="BACK"]'));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, value] of Object.entries(previousGlobals)) {
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  }
});
