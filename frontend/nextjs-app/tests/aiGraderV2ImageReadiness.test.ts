import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  evaluateSpeedsterImageReadiness,
  speedsterGeometryInteractionState,
  type SpeedsterImageLayoutSnapshot,
} from "../lib/ai-grader-v2/image-readiness";
import { buildSpeedsterGeometryStart } from "../lib/ai-grader-v2/capture-geometry";

const geometryAssistSource = readFileSync(path.resolve(
  __dirname,
  "../components/ai-grader-v2/GeometryAssist.tsx",
), "utf8");
const captureWorkspaceSource = readFileSync(path.resolve(
  __dirname,
  "../components/ai-grader-v2/CaptureWorkspace.tsx",
), "utf8");
const geometryStyles = readFileSync(path.resolve(
  __dirname,
  "../components/ai-grader-v2/GeometryAssist.module.css",
), "utf8");

const visibleLayout: SpeedsterImageLayoutSnapshot = {
  complete: true,
  naturalWidth: 1200,
  naturalHeight: 1600,
  clientWidth: 600,
  clientHeight: 800,
  frameClientWidth: 600,
  frameClientHeight: 800,
  imageRect: { left: 100, top: 50, right: 700, bottom: 850, width: 600, height: 800 },
  frameRect: { left: 100, top: 50, right: 700, bottom: 850, width: 600, height: 800 },
};

test("geometry success without image onLoad times out closed and preserves both photos", () => {
  assert.deepEqual(speedsterGeometryInteractionState("LOADING"), {
    overlayVisible: false,
    continueEnabled: false,
  });
  assert.deepEqual(speedsterGeometryInteractionState("FAILED"), {
    overlayVisible: false,
    continueEnabled: false,
  });

  assert.match(geometryAssistSource, /SPEEDSTER_IMAGE_LOAD_TIMEOUT_MS/);
  assert.match(geometryAssistSource, /onError=/);
  assert.match(geometryAssistSource, /\.decode\(\)/);

  const failureStart = captureWorkspaceSource.indexOf("const handleGeometryImageFailure");
  const failureEnd = captureWorkspaceSource.indexOf("const confirmGeometry", failureStart);
  const failureHandler = captureWorkspaceSource.slice(failureStart, failureEnd);
  assert.ok(failureStart >= 0 && failureEnd > failureStart);
  assert.match(failureHandler, /setFront\(null\)/);
  assert.match(failureHandler, /setBack\(null\)/);
  assert.match(failureHandler, /setStage\("PHOTOS"\)/);
  assert.match(failureHandler, /setMessage\(/);
  assert.doesNotMatch(failureHandler, /setFrontPhoto|setBackPhoto/);
  assert.match(captureWorkspaceSource, /<p role="status">/);
});

test("natural dimensions do not make zero-sized or out-of-frame layout actionable", () => {
  assert.deepEqual(evaluateSpeedsterImageReadiness({
    ...visibleLayout,
    clientWidth: 0,
    imageRect: { ...visibleLayout.imageRect, width: 0, right: 100 },
  }), { ready: false, reason: "rendered image dimensions are zero" });

  assert.deepEqual(evaluateSpeedsterImageReadiness({
    ...visibleLayout,
    imageRect: { left: 900, top: 50, right: 1500, bottom: 850, width: 600, height: 800 },
  }), { ready: false, reason: "rendered image is outside the usable frame" });
});

test("null or malformed sanitized geometry cannot create a partial geometry transition", () => {
  const front = {
    originalStorageKey: "front.jpg",
    sourceUrl: "https://example.test/front.jpg",
    geometry: { width: 1200, height: 1600, corners: visibleQuad },
  };
  const invalidBack = {
    originalStorageKey: "back.jpg",
    sourceUrl: "https://example.test/back.jpg",
    geometry: { width: 1200, height: 1600, corners: null },
  };

  assert.throws(
    () => buildSpeedsterGeometryStart({ front, back: invalidBack }),
    /back card geometry/i,
  );
  assert.equal("stage" in front, false);
  assert.equal("stage" in invalidBack, false);

  const beginStart = captureWorkspaceSource.indexOf("const beginGeometry");
  const beginEnd = captureWorkspaceSource.indexOf("const handleGeometryImageFailure", beginStart);
  const beginGeometry = captureWorkspaceSource.slice(beginStart, beginEnd);
  const transitionBuild = beginGeometry.indexOf("buildSpeedsterGeometryStart");
  assert.ok(beginStart >= 0 && beginEnd > beginStart && transitionBuild >= 0);
  assert.doesNotMatch(
    beginGeometry.slice(0, transitionBuild),
    /setFront\(|setBack\(|setStage\(|setFrontPhoto|setBackPhoto/,
  );
});

const visibleQuad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const;

test("normal valid geometry preserves image sizing, corners, edge map, and Continue workflow", () => {
  const transition = buildSpeedsterGeometryStart({
    front: {
      originalStorageKey: "front.jpg",
      sourceUrl: "https://example.test/front.jpg",
      geometry: { width: 1200, height: 1600, corners: visibleQuad },
    },
    back: {
      originalStorageKey: "back.jpg",
      sourceUrl: "https://example.test/back.jpg",
      geometry: { width: 1200, height: 1600, corners: visibleQuad },
    },
  });

  assert.equal(evaluateSpeedsterImageReadiness(visibleLayout).ready, true);
  assert.deepEqual(speedsterGeometryInteractionState("READY"), {
    overlayVisible: true,
    continueEnabled: true,
  });
  assert.deepEqual(transition.front.corners, visibleQuad);
  assert.deepEqual(transition.back.corners, visibleQuad);
  assert.equal(transition.front.sourceUrl, "https://example.test/front.jpg");
  assert.equal(transition.stage, "FRONT_GEOMETRY");
  assert.match(geometryStyles, /\.image\s*\{[\s\S]*height: auto/);
  assert.match(geometryAssistSource, /gradientMapFromImage/);
  assert.match(geometryAssistSource, /onContinue/);
});

test("the forbidden overlay-and-Continue state is impossible unless readiness is READY", () => {
  for (const readiness of ["LOADING", "FAILED", "READY"] as const) {
    const interaction = speedsterGeometryInteractionState(readiness);
    assert.equal(
      interaction.overlayVisible && interaction.continueEnabled && readiness !== "READY",
      false,
    );
  }

  assert.match(geometryAssistSource, /\{interaction\.overlayVisible \? \(/);
  assert.match(geometryAssistSource, /disabled=\{!interaction\.continueEnabled\}/);
});
