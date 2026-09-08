import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error jsdom is used by the existing lifecycle tests without declarations.
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const OnDemandMedia = require("../components/OnDemandMedia").default as typeof import("../components/OnDemandMedia").default;

test("server-rendered previews contain only the poster and Play control", () => {
  function Player() { throw new Error("Player must not initialize before deliberate play"); return null; }
  const html = renderToString(<OnDemandMedia title="Preview" sourceKey="movie"><Player /></OnDemandMedia>);
  assert.match(html, /Play Preview/);
  assert.doesNotMatch(html, /<(?:video|iframe|source|mux-player)\b/);
});

test("preview lifecycle never mounts media until deliberate visible play and releases it on every suspension", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
  const observers = new Map<Element, (entries: unknown[]) => void>();
  let hidden = false;
  let outside = false;
  let loads = 0;
  let pauses = 0;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: class {
      target?: Element;
      constructor(readonly callback: (entries: unknown[]) => void) {}
      observe(target: Element) { this.target = target; observers.set(target, this.callback); }
      disconnect() { if (this.target) observers.delete(this.target); }
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(dom.window.document, "visibilityState", { get: () => hidden ? "hidden" : "visible" });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 320, height: 180, top: outside ? 2000 : 0, left: 0, bottom: outside ? 2180 : 180, right: 320,
  } as DOMRect);
  dom.window.HTMLMediaElement.prototype.load = () => { loads++; };
  dom.window.HTMLMediaElement.prototype.pause = () => { pauses++; };
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let source = "/first.mp4";
  let muted = true;
  let metadata = 1;
  const render = () => root.render(<>
    <OnDemandMedia title="First" sourceKey={source} posterUrl="/poster.svg">
      <video src={source} muted={muted} data-metadata={metadata} />
    </OnDemandMedia>
    <OnDemandMedia title="Second" sourceKey="/second.mp4"><video src="/second.mp4" /></OnDemandMedia>
  </>);
  const click = async (label: string) => act(() => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(button, label);
    button.click();
  });
  try {
    await act(render);
    assert.equal(container.querySelectorAll("video, iframe, source").length, 0);
    assert.equal(loads, 0);
    await click("Play First");
    const playing = container.querySelector("video")!;
    assert.equal(playing.getAttribute("src"), source);
    muted = false;
    metadata++;
    await act(render);
    assert.equal(container.querySelector("video"), playing, "mute/poll updates preserve the same player");
    assert.equal(loads, 0, "mute/poll updates never reload media");
    await click("Play Second");
    assert.equal(container.querySelectorAll("video").length, 1);
    assert.equal(container.querySelector("video")?.getAttribute("src"), "/second.mp4");
    assert.equal(playing.getAttribute("src"), null, "released video cannot continue fetching");
    assert.equal(pauses, 1);
    await act(() => { hidden = true; dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")); });
    assert.equal(container.querySelectorAll("video").length, 0);
    await click("Play First");
    assert.equal(container.querySelectorAll("video").length, 0, "hidden documents cannot start playback");
    hidden = false;
    await act(() => dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(container.querySelectorAll("video").length, 0, "returning to tab does not resume");
    outside = true;
    await click("Play First");
    assert.equal(container.querySelectorAll("video").length, 0, "offscreen frames cannot start playback");
    outside = false;
    await click("Play First");
    await act(() => [...observers.values()][0]([{ isIntersecting: false }]));
    assert.equal(container.querySelectorAll("video").length, 0, "scrolling out releases media");
    await click("Play First");
    source = "/changed.mp4";
    await act(render);
    assert.equal(container.querySelectorAll("video").length, 0, "source replacement requires another deliberate play");
    await click("Play First");
    await click("Close First");
    assert.equal(container.querySelectorAll("video").length, 0);
    await click("Play First");
    await act(() => container.querySelector("video")!.dispatchEvent(new dom.window.Event("ended", { bubbles: true })));
    assert.equal(container.querySelectorAll("video").length, 0, "ended previews do not loop");
    await click("Play First");
    const last = container.querySelector("video")!;
    await act(() => root.unmount());
    assert.equal(last.getAttribute("src"), null);
    assert.equal(observers.size, 0);
  } finally {
    await act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
