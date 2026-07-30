import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { snapHumanGeometryPointToGradientV1 } from "../lib/humanGeometryGradientSnap";

const workspaceSource = readFileSync(path.resolve(
  __dirname,
  "../components/ai-grader/HumanGeometryAssistWorkspace.tsx",
), "utf8");
const workspaceStyles = readFileSync(path.resolve(
  __dirname,
  "../components/ai-grader/HumanGeometryAssistWorkspace.module.css",
), "utf8");
const stationSource = readFileSync(path.resolve(
  __dirname,
  "../pages/ai-grader/station.tsx",
), "utf8");
const panelSource = readFileSync(path.resolve(
  __dirname,
  "../components/ai-grader/HumanGeometryAssistPanel.tsx",
), "utf8");

test("workspace exposes mandatory front/back, candidates, tools, regions, pan, zoom, undo, and lock controls", () => {
  assert.match(workspaceSource, /\["front", "back"\]/);
  assert.match(workspaceSource, /current\.printedBorders\[edge\]\.candidates\.map/);
  assert.match(workspaceSource, /Rounded 3\.18 mm/);
  assert.match(workspaceSource, /Square 90°/);
  assert.match(workspaceSource, /Confirm straight edges/);
  assert.match(workspaceSource, /Confirm surface/);
  assert.match(workspaceSource, />Pan<\/button>/);
  assert.match(workspaceSource, /Zoom/);
  assert.match(workspaceSource, />Undo<\/button>/);
  assert.match(workspaceSource, />Reset to suggestion<\/button>/);
  assert.match(workspaceSource, /Lock Front & Back Geometry/);
  assert.match(workspaceSource, /className=\{styles\.magnifier\}/);
  assert.match(workspaceSource, /kind: "border"/);
  assert.match(workspaceSource, /kind: "corner"/);
});

test("workspace enforces Borders, Corners, Edges, Surface, then side confirmation", () => {
  assert.match(workspaceSource, /const bordersReady/);
  assert.match(workspaceSource, /const cornersReady/);
  assert.match(workspaceSource, /showCandidates=\{!bordersReady\}/);
  assert.match(workspaceSource, /showCorners=\{bordersReady\}/);
  assert.match(workspaceSource, /showEdgeRegions=\{/);
  assert.match(workspaceSource, /showSurfaceRegion=\{current\.edgeRegionsReviewed\}/);
  assert.match(workspaceSource, /onCornerPointerDown=\{bordersReady \? beginCornerDrag : undefined\}/);
  assert.match(workspaceSource, /disabled=\{!bordersReady\}/);
  assert.match(workspaceSource, /disabled=\{!cornersReady\}/);
  assert.match(workspaceSource, /disabled=\{!current\.edgeRegionsReviewed\}/);
  assert.match(workspaceSource, /disabled=\{!canConfirmSide \|\| current\.confirmed\}/);
  assert.ok(
    workspaceSource.indexOf("Printed borders") <
      workspaceSource.indexOf("Physical corners"),
  );
  assert.ok(
    workspaceSource.indexOf("Physical corners") <
      workspaceSource.indexOf("Straight edges"),
  );
  assert.ok(
    workspaceSource.indexOf("Straight edges") <
      workspaceSource.indexOf("<h3>Surface"),
  );
});

test("workspace uses the Ten Kings black, gold, cream, and confirmation-green palette", () => {
  assert.match(workspaceStyles, /--black: #000/);
  assert.match(workspaceStyles, /--gold: #e1bd68/);
  assert.match(workspaceStyles, /--cream: #f8f3e7/);
  assert.match(workspaceStyles, /--green: #5bff9d/);
  assert.match(workspaceStyles, /background: var\(--black\)/);
  assert.doesNotMatch(workspaceStyles, /#1c3554|#142c47|#1b2550|#7a151b/i);
});

test("gradient snap selects the nearest defensible edge without a model dependency", () => {
  const width = 100;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = x < 50 ? 0 : 255;
      const index = (y * width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const snapped = snapHumanGeometryPointToGradientV1(
    { data, width, height },
    { x: 52, y: 10 },
    "x",
  );
  assert.equal(snapped.x, 50);
  assert.equal(snapped.distance, 2);
  assert.equal(snapped.strength, 1);
});

test("an unavailable Eyes geometry provider has zero calls, waits, errors, or gates in Human Geometry", () => {
  assert.doesNotMatch(stationSource, /mode:\s*"eyes_selection"/);
  assert.doesNotMatch(
    stationSource,
    /action:\s*"complete-eyes-centering-selection"/,
  );
  assert.doesNotMatch(stationSource, /eyesCenteringRunningRef/);
  assert.doesNotMatch(
    stationSource,
    /EYES could not complete its exact border-candidate review/,
  );

  assert.match(panelSource, /action:\s*"lock-human-geometry"/);
  assert.doesNotMatch(
    panelSource,
    /runAiGraderOcrPrefillFromLocalReport|eyes|provider/i,
  );

  const publishStart = stationSource.indexOf("const approveAndPublish");
  const publishEnd = stationSource.indexOf(
    "const loadFinishReportBundle",
    publishStart,
  );
  const publish = stationSource.slice(publishStart, publishEnd);
  assert.ok(publishStart >= 0 && publishEnd > publishStart);
  assert.doesNotMatch(publish, /eyesCentering|eyes_selection/i);
});
