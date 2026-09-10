import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error jsdom is used by the existing lifecycle tests without declarations.
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { YouTubeApi, YouTubePlayer } from "../lib/youtubeIframeApi";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
const LiveRipPreview = require("../components/LiveRipPreview").default as typeof import("../components/LiveRipPreview").default;
const { loadYouTubeIframeApi } = require("../lib/youtubeIframeApi") as typeof import("../lib/youtubeIframeApi");

test("YouTube readiness, mute updates, completion and stale callbacks preserve deliberate playback", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost", pretendToBeVisual: true });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: class { observe() {} disconnect() {} },
  };
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 320, height: 180, top: 0, left: 0, bottom: 180, right: 320 });
  type Events = ConstructorParameters<YouTubeApi["Player"]>[1]["events"];
  const players: Array<{ frame: HTMLIFrameElement; events: Events; player: YouTubePlayer; destroys: number; state: number; commands: string[] }> = [];
  const api: YouTubeApi = { Player: class {
    record;
    constructor(frame: HTMLIFrameElement, { events }: { events: Events }) {
      this.record = { frame, events, player: this, destroys: 0, state: 1, commands: [] as string[] };
      players.push(this.record);
    }
    mute() { this.record.commands.push("mute"); }
    unMute() { this.record.commands.push("unMute"); }
    getPlayerState() { return this.record.state; }
    destroy() { this.record.destroys++; this.record.frame.remove(); }
  } };
  const root = createRoot(dom.window.document.getElementById("root")!);
  const container = dom.window.document.getElementById("root")!;
  let muted = true;
  let version = 0;
  const render = () => root.render(<LiveRipPreview id="youtube" title="YouTube" videoUrl={`https://youtube.com/watch?v=local${version}`} muted={muted} onToggleMute={() => undefined} />);
  const click = async (label: string) => act(async () => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    assert.ok(button, label); button.click();
  });
  const frames = () => container.querySelectorAll("iframe").length;
  try {
    await act(render);
    assert.equal(frames(), 0);
    assert.equal(document.querySelectorAll("script").length, 0, "provider API never loads before intent");
    await click("Play YouTube");
    const firstFrame = container.querySelector("iframe")!;
    assert.equal(new URL(firstFrame.src).searchParams.get("origin"), "http://localhost");
    const firstApiScript = document.querySelector("script")!;
    assert.equal(firstApiScript.src, "https://www.youtube.com/iframe_api");
    const sharedA = loadYouTubeIframeApi();
    const sharedB = loadYouTubeIframeApi();
    assert.equal(sharedA, sharedB);
    await click("Close YouTube");
    await act(async () => { window.YT = api; window.onYouTubeIframeAPIReady?.(); await sharedA; });
    assert.equal(players.length, 0, "late API load cannot resurrect a closed player");
    assert.equal(firstFrame.getAttribute("src"), null);
    await click("Play YouTube");
    const first = players[0];
    await act(() => first.events.onReady({ target: first.player }));
    assert.deepEqual(first.commands, ["mute"]);
    muted = false;
    await act(render);
    assert.deepEqual(first.commands, ["mute", "unMute"]);
    assert.equal(players.length, 1, "mute/metadata rerender preserves the player");
    await act(() => first.events.onStateChange({ target: first.player, data: 2 }));
    assert.equal(frames(), 1, "pause is not completion");
    await act(() => first.events.onStateChange({ target: first.player, data: 0 }));
    assert.equal(frames(), 0);
    assert.equal(first.destroys, 1);
    assert.equal(first.frame.getAttribute("src"), null);
    await click("Play YouTube");
    const second = players[1];
    await act(() => first.events.onStateChange({ target: first.player, data: 0 }));
    assert.equal(frames(), 1, "old completion does not close a new player");
    version++;
    await act(render);
    assert.equal(frames(), 0);
    assert.equal(second.destroys, 1);
    await click("Play YouTube");
    const third = players[2];
    await act(() => {
      second.events.onReady({ target: second.player });
      second.events.onStateChange({ target: second.player, data: 0 });
    });
    assert.equal(frames(), 1, "old source callbacks cannot change its replacement");
    assert.deepEqual(second.commands, [], "old ready callback cannot issue mute/play commands");
    third.state = 0;
    await act(() => third.events.onReady({ target: third.player }));
    assert.equal(frames(), 0, "a clip that ended before API readiness still releases");
    await act(() => root.unmount());
    assert.equal(third.destroys, 1);
    assert.equal(third.frame.getAttribute("src"), null);

    delete window.YT;
    const failure = loadYouTubeIframeApi();
    const failedScript = [...document.querySelectorAll("script")].at(-1)!;
    failedScript.dispatchEvent(new dom.window.Event("error"));
    assert.equal(await failure, null);
    assert.equal(failedScript.isConnected, false);
    const retry = loadYouTubeIframeApi();
    const retryScript = [...document.querySelectorAll("script")].at(-1)!;
    assert.notEqual(retryScript, failedScript);
    retryScript.dispatchEvent(new dom.window.Event("error"));
    assert.equal(await retry, null);
  } finally {
    await act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
