import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { speedsterImageService } from "../lib/ai-grader-v2/image-service";

import {
  SPEEDSTER_CANONICAL_TRACE_GRID,
  applyCompletedSpeedsterTraceStroke,
  acceptSpeedsterHighlighterProposal,
  buildSpeedsterTraceProvenanceRevision,
  canonicalPixelToPanelPoint,
  clipSpeedsterTraceToCrop,
  clipSpeedsterTraceToMaterial,
  copyVisibleSpeedsterTrace,
  createEmptySpeedsterTrace,
  createSpeedsterCanonicalCropTransform,
  createSpeedsterTraceCropTransform,
  initializeSpeedsterHighlighterStrokes,
  panelPointToCanonicalPixel,
  rasterizeSpeedsterCanonicalContour,
} from "../lib/ai-grader-v2/trace-editor";

function setTracePixel(trace: Uint8Array, x: number, y: number) {
  trace[y * SPEEDSTER_CANONICAL_TRACE_GRID.width + x] = 1;
}

test("the drawing panel and canonical grid share one invertible affine crop transform", () => {
  const transform = createSpeedsterCanonicalCropTransform({
    anchor: { x: 0.5, y: 0.5 },
    cropWidthPixels: 400,
    panelAspectRatio: 1,
  });

  assert.deepEqual(panelPointToCanonicalPixel({ x: 0.5, y: 0.5 }, transform), {
    x: 635,
    y: 889,
  });
  const canonical = panelPointToCanonicalPixel({ x: 0.25, y: 0.75 }, transform);
  const panel = canonicalPixelToPanelPoint(canonical, transform);
  assert.ok(Math.abs(panel.x - 0.25) <= 1 / transform.crop.width);
  assert.ok(Math.abs(panel.y - 0.75) <= 1 / transform.crop.height);
  assert.equal(transform.version, "speedster-canonical-crop-affine-v1");
});

test("anchor crops stay on the canonical card without adding another mapping", () => {
  const transform = createSpeedsterCanonicalCropTransform({
    anchor: { x: 0, y: 1 },
    cropWidthPixels: 360,
    panelAspectRatio: 1,
  });

  assert.deepEqual(transform.crop, {
    x: 0,
    y: SPEEDSTER_CANONICAL_TRACE_GRID.height - 1 - 360,
    width: 360,
    height: 360,
  });
  assert.deepEqual(panelPointToCanonicalPixel({ x: 0, y: 1 }, transform), {
    x: 0,
    y: SPEEDSTER_CANONICAL_TRACE_GRID.height - 1,
  });
});

test("proposal traces are clipped to the exact affine crop before visible state or Save", () => {
  const trace = createEmptySpeedsterTrace();
  const transform = {
    version: "speedster-canonical-crop-affine-v1" as const,
    crop: { x: 100.25, y: 200.25, width: 19.5, height: 29.5 },
  };
  setTracePixel(trace, 101, 201);
  setTracePixel(trace, 119, 229);
  setTracePixel(trace, 100, 201);
  setTracePixel(trace, 120, 229);
  setTracePixel(trace, 101, 200);
  setTracePixel(trace, 119, 230);

  const clipped = clipSpeedsterTraceToCrop(trace, transform);

  assert.notEqual(clipped, trace);
  assert.equal(clipped.reduce((sum, value) => sum + value, 0), 2);
  assert.equal(clipped[201 * SPEEDSTER_CANONICAL_TRACE_GRID.width + 101], 1);
  assert.equal(clipped[229 * SPEEDSTER_CANONICAL_TRACE_GRID.width + 119], 1);
  assert.equal(trace.reduce((sum, value) => sum + value, 0), 6);
});

test("canonical material clipping matches rounded pixel centers and leaves square traces unchanged", () => {
  const trace = createEmptySpeedsterTrace();
  setTracePixel(trace, 0, 0);
  setTracePixel(trace, 63, 0);
  setTracePixel(trace, 635, 889);
  const before = trace.slice();

  const rounded = clipSpeedsterTraceToMaterial(trace, "ROUNDED_3_18_MM");
  const square = clipSpeedsterTraceToMaterial(trace, "SQUARE");

  assert.equal(rounded[0], 0);
  assert.equal(rounded[63], 1);
  assert.equal(rounded[889 * SPEEDSTER_CANONICAL_TRACE_GRID.width + 635], 1);
  assert.deepEqual(square, trace);
  assert.notEqual(square, trace);
  assert.deepEqual(trace, before);
});

test("an existing final trace derives one affine crop containing its exact nonzero bounds", () => {
  const localized = createEmptySpeedsterTrace();
  setTracePixel(localized, 600, 800);
  setTracePixel(localized, 620, 820);
  assert.deepEqual(createSpeedsterTraceCropTransform(localized).crop, {
    x: 480,
    y: 680,
    width: 260,
    height: 260,
  });

  const trace = createEmptySpeedsterTrace();
  const bounds = [
    { x: 7, y: 5 },
    { x: 1263, y: 1772 },
  ] as const;
  bounds.forEach(({ x, y }) => setTracePixel(trace, x, y));
  const before = trace.slice();

  const transform = createSpeedsterTraceCropTransform(trace);

  bounds.forEach((point) => {
    const panel = canonicalPixelToPanelPoint(point, transform);
    assert.ok(panel.x >= 0 && panel.x <= 1);
    assert.ok(panel.y >= 0 && panel.y <= 1);
  });
  assert.deepEqual(trace, before);
  assert.deepEqual(clipSpeedsterTraceToCrop(trace, transform), trace);
});

test("highlighter emits one proposal request while brush and eraser directly edit the binary trace", () => {
  const empty = createEmptySpeedsterTrace();
  const stroke = [{ x: 400, y: 500 }, { x: 410, y: 500 }];
  const highlighted = applyCompletedSpeedsterTraceStroke({
    trace: empty,
    tool: "HIGHLIGHTER",
    points: stroke,
    strokeWidthPixels: 20,
  });

  assert.equal(highlighted.trace, empty);
  assert.deepEqual(highlighted.proposalRequest, {
    canonicalPoints: stroke,
    strokeWidthPixels: 20,
    strokeWidthMm: 1,
  });

  const brushed = applyCompletedSpeedsterTraceStroke({
    trace: highlighted.trace,
    tool: "BRUSH",
    points: stroke,
    strokeWidthPixels: 10,
  });
  assert.equal(brushed.proposalRequest, null);
  assert.ok(brushed.trace.some((value) => value === 1));

  const erased = applyCompletedSpeedsterTraceStroke({
    trace: brushed.trace,
    tool: "ERASER",
    points: stroke,
    strokeWidthPixels: 20,
  });
  assert.equal(erased.proposalRequest, null);
  assert.equal(erased.trace.some((value) => value === 1), false);
});

test("rounded-corner Highlighter requests preserve the literal human stroke", () => {
  const points = [{ x: 0, y: 0 }, { x: 8, y: 8 }];
  const highlighted = applyCompletedSpeedsterTraceStroke({
    trace: createEmptySpeedsterTrace(),
    tool: "HIGHLIGHTER",
    points,
    strokeWidthPixels: 20,
  });

  assert.deepEqual(highlighted.proposalRequest?.canonicalPoints, points);
});

test("Highlighter provenance is appended only with a valid accepted proposal", () => {
  const request = {
    canonicalPoints: [{ x: 600, y: 800 }],
    strokeWidthPixels: 20,
    strokeWidthMm: 1,
  } as const;
  const cropTransform = createSpeedsterCanonicalCropTransform({ anchor: { x: 0.5, y: 0.5 } });
  const prior = [request];

  assert.equal(acceptSpeedsterHighlighterProposal({
    proposal: null,
    request,
    priorHighlighterStrokes: prior,
    cropTransform,
    cornerShape: "ROUNDED_3_18_MM",
  }), null);
  assert.equal(acceptSpeedsterHighlighterProposal({
    proposal: new Uint8Array(1),
    request,
    priorHighlighterStrokes: prior,
    cropTransform,
    cornerShape: "ROUNDED_3_18_MM",
  }), null);

  const proposal = createEmptySpeedsterTrace();
  setTracePixel(proposal, 635, 889);
  const accepted = acceptSpeedsterHighlighterProposal({
    proposal,
    request,
    priorHighlighterStrokes: prior,
    cropTransform,
    cornerShape: "ROUNDED_3_18_MM",
  });
  assert.ok(accepted);
  assert.deepEqual(accepted.highlighterStrokes, [request, request]);
  assert.notEqual(accepted.highlighterStrokes, prior);
  assert.equal(prior.length, 1);
});

test("the Highlighter client preserves the proxy's sanitized error and request ID", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    message: "SAM proposal failed: RuntimeError: CUDA fault (request sam-request-123).",
    requestId: "sam-request-123",
  }), { status: 500, headers: { "Content-Type": "application/json" } });
  try {
    await assert.rejects(() => speedsterImageService.traceProposal("admin-token", {
      sessionId: "speedster-123",
      side: "FRONT",
      findingId: null,
      stroke: {
        canonicalPoints: [{ x: 0, y: 0 }],
        strokeWidthPixels: 20,
        strokeWidthMm: 1,
        cropTransformVersion: "speedster-canonical-crop-affine-v1",
      },
      currentTraceWire: null,
    }), new Error("SAM proposal failed: RuntimeError: CUDA fault (request sam-request-123)."));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("existing finding contours open as editable binary traces and Save copies exactly what is visible", () => {
  const trace = rasterizeSpeedsterCanonicalContour([
    { x: 0.4, y: 0.4 },
    { x: 0.6, y: 0.4 },
    { x: 0.6, y: 0.6 },
    { x: 0.4, y: 0.6 },
  ]);
  assert.ok(trace.some((value) => value === 1));

  const saved = copyVisibleSpeedsterTrace(trace);
  assert.ok(saved instanceof Uint8Array);
  assert.equal(saved.length, 1270 * 1778);
  assert.deepEqual(saved, trace);
  assert.notEqual(saved, trace);
  trace.fill(0);
  assert.ok(saved.some((value) => value === 1));
});

test("Brush adds pixels to an existing detector or Memory contour trace", () => {
  const trace = rasterizeSpeedsterCanonicalContour([
    { x: 0.4, y: 0.4 },
    { x: 0.6, y: 0.4 },
    { x: 0.6, y: 0.6 },
    { x: 0.4, y: 0.6 },
  ]);
  const before = trace.reduce((total, value) => total + value, 0);
  const brushed = applyCompletedSpeedsterTraceStroke({
    trace,
    tool: "BRUSH",
    points: [{ x: 760, y: 889 }],
    strokeWidthPixels: 12,
  });

  assert.equal(brushed.proposalRequest, null);
  assert.ok(brushed.trace.reduce((total, value) => total + value, 0) > before);
});

test("the review Brush is 1.20 mm and a saved new trace becomes the active finding immediately", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const editor = readFileSync(
    `${root}/components/ai-grader-v2/DefectTraceEditor.tsx`,
    "utf8",
  );
  const viewer = readFileSync(
    `${root}/components/ai-grader-v2/DefectEvidenceViewer.tsx`,
    "utf8",
  );
  const adminPage = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");

  assert.match(editor, /BRUSH:\s*24/);
  assert.match(viewer, /typeof applied === "string"/);
  assert.match(viewer, /setEditingFindingId\(applied\)/);
  assert.match(viewer, /select\(applied\)/);
  assert.match(adminPage, /const newFindingId = input\.target\.findingId\s*\? null\s*:\s*`\$\{input\.target\.side\}:smart-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(adminPage, /if \(!measurement\.applied\) throw new Error\(measurement\.message\)/);
  assert.match(adminPage, /return newFindingId \?\? true/);

  const saveStart = editor.indexOf("Promise.resolve(onSave?.");
  const saveEnd = editor.indexOf(".finally(() => setSavePending(false))", saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.match(
    editor.slice(saveStart, saveEnd),
    /catch\(\(error\) => \{[\s\S]*?error instanceof Error[\s\S]*?error\.message/,
  );
});

test("an existing trace revision preserves source, crop, and ordered strokes while updating only its hash", () => {
  const prior = {
    version: "speedster-trace-provenance-v1" as const,
    sourceViewId: "FRONT:ORIGINAL",
    cropTransform: {
      version: "speedster-canonical-crop-affine-v1" as const,
      crop: { x: 400, y: 600, width: 300, height: 300 },
    },
    highlighterStrokes: [{
      canonicalPoints: [{ x: 600, y: 800 }, { x: 601, y: 801 }],
      strokeWidthMm: 1.5,
    }],
    finalTraceSha256: "0".repeat(64),
  };
  const history = initializeSpeedsterHighlighterStrokes(prior);
  assert.deepEqual(history, [{
    canonicalPoints: [{ x: 600, y: 800 }, { x: 601, y: 801 }],
    strokeWidthPixels: 30,
    strokeWidthMm: 1.5,
  }]);

  const brushOnly = buildSpeedsterTraceProvenanceRevision({
    sourceViewId: "FRONT:ORIGINAL",
    cropTransform: createSpeedsterCanonicalCropTransform({ anchor: { x: 0.2, y: 0.2 } }),
    highlighterStrokes: history,
    priorTraceProvenance: prior,
    finalTraceSha256: "a".repeat(64),
  });
  assert.equal(brushOnly.sourceViewId, prior.sourceViewId);
  assert.deepEqual(brushOnly.cropTransform, prior.cropTransform);
  assert.deepEqual(brushOnly.highlighterStrokes, prior.highlighterStrokes);
  assert.equal(brushOnly.finalTraceSha256, "a".repeat(64));

  const appended = buildSpeedsterTraceProvenanceRevision({
    sourceViewId: "FRONT:ORIGINAL",
    cropTransform: brushOnly.cropTransform,
    highlighterStrokes: [...history, {
      canonicalPoints: [{ x: 602, y: 802 }],
      strokeWidthPixels: 20,
      strokeWidthMm: 1,
    }],
    priorTraceProvenance: prior,
    finalTraceSha256: "b".repeat(64),
  });
  assert.deepEqual(appended.highlighterStrokes, [
    ...prior.highlighterStrokes,
    { canonicalPoints: [{ x: 602, y: 802 }], strokeWidthMm: 1 },
  ]);
});

test("the master map only anchors and the enlarged close-up is the sole drawing surface", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const viewer = readFileSync(
    `${root}/components/ai-grader-v2/DefectEvidenceViewer.tsx`,
    "utf8",
  );
  const editor = readFileSync(
    `${root}/components/ai-grader-v2/DefectTraceEditor.tsx`,
    "utf8",
  );
  const adminPage = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");

  assert.match(viewer, /openTraceEditorAtMasterAnchor/);
  assert.match(viewer, /editingFindingId !== active\.id/);
  assert.match(viewer, /setEditingFindingId\(defect\.id\)/);
  assert.match(viewer, /createSpeedsterTraceCropTransform\(initialTrace\)/);
  assert.match(viewer, /cornerShape/);
  assert.match(viewer, /initialTraceProvenance/);
  assert.doesNotMatch(viewer, /localSavedTraces|setLocalSavedTraces/);
  assert.doesNotMatch(viewer, /smartMarkBox|finishMark|markStart|markEnd/);
  assert.match(editor, /HIGHLIGHTER/);
  assert.match(editor, /BRUSH/);
  assert.match(editor, /ERASER/);
  assert.match(editor, /onHighlighterStrokeEnd/);
  assert.match(editor, /onSave/);
  assert.match(editor, /applied === false/);
  assert.match(editor, /clipSpeedsterTraceToEditorBounds\(initialTrace, cropTransform, cornerShape\)/);
  assert.match(editor, /clipSpeedsterTraceToEditorBounds\(result\.trace, cropTransform, cornerShape\)/);
  assert.match(editor, /acceptSpeedsterHighlighterProposal/);
  assert.match(editor, /initializeSpeedsterHighlighterStrokes/);
  assert.match(editor, /if \(proposalPending \|\| savePending \|\| activePointerIdRef\.current !== null\) return/);
  assert.match(editor, /disabled=\{proposalPending \|\| savePending\}/);
  assert.match(editor, /disabled=\{!validTrace \|\| proposalPending \|\| savePending\}/);
  assert.match(editor, /Brush added no pixels because that area is already in the trace/);
  assert.match(editor, /error instanceof Error\s+\? error\.message/);
  const proposalStart = adminPage.indexOf("const traceProposal =");
  const proposalEnd = adminPage.indexOf("const saveTrace =", proposalStart);
  assert.doesNotMatch(adminPage.slice(proposalStart, proposalEnd), /catch/);
  assert.match(editor, /priorTraceProvenance/);
  assert.match(viewer, /clipSpeedsterTraceToMaterial/);
  assert.match(editor, /Uint8Array/);
});

test("trace UI uses the approved codec and has no rectangle measurement path", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const sources = [
    `${root}/lib/ai-grader-v2/trace-editor.ts`,
    `${root}/components/ai-grader-v2/DefectTraceEditor.tsx`,
    `${root}/components/ai-grader-v2/DefectEvidenceViewer.tsx`,
    `${root}/components/ai-grader-v2/ReviewWorkspace.tsx`,
    `${root}/pages/admin/ai-grader-v2.tsx`,
  ].map((path) => readFileSync(path, "utf8")).join("\n");

  assert.match(sources, /encodeSpeedsterTraceRleV1/);
  assert.match(sources, /buildSpeedsterTraceProvenanceRevision/);
  assert.match(sources, /traceProposal/);
  assert.match(sources, /onTraceSave/);
  assert.doesNotMatch(sources, /onSmartMark|smartMarkBox|finishMark|markStart|markEnd/);
  assert.doesNotMatch(sources, /canonicalContour:\s*\[\s*\{\s*x:\s*box\./);
});

test("marker sweeps retain one lazy exact trace and never promote a measurement child to source authority", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const viewer = readFileSync(
    `${root}/components/ai-grader-v2/DefectEvidenceViewer.tsx`,
    "utf8",
  );

  assert.match(viewer, /const \[hydratedTrace, setHydratedTrace\][\s\S]*?\| null>\(null\)/);
  assert.doesNotMatch(viewer, /hydratedTraces|Readonly<Record<string, SpeedsterTraceRleV1>>/);
  assert.match(viewer, /setHydratedTrace\(\{ findingId, trace \}\)/);
  assert.match(viewer, /requestedTraceKey\.current === requestKey/);
  assert.match(viewer, /cancelled \|\| requestedTraceKey\.current !== requestKey/);
  assert.match(viewer, /current\.findingId === findingId && current\.trace\.sha256 === traceSha256/);
  assert.match(viewer, /<ExactTraceOverlay\s+trace=\{activeTrace\}/);
  assert.doesNotMatch(viewer, /<ExactTraceOverlay[\s\S]*?defects=\{/);
  assert.match(viewer, /isSpeedsterSourceMeasuredDefect\(active\)[\s\S]*?!activeTrace/);
  assert.match(viewer, /The exact saved trace could not be loaded\. The finding remains unchanged\./);
});
