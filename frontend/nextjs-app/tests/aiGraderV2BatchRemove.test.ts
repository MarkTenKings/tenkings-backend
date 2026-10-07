import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { speedsterReviewPostSchema } from "../lib/ai-grader-v2/review-action-contract";

import {
  speedsterSelectionBox,
  speedsterSelectionIds,
} from "../lib/ai-grader-v2/multi-select";

test("reverse drag selects only marker centers inside the Canva-style box", () => {
  const box = speedsterSelectionBox({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 });
  assert.deepEqual(box, { left: 0.2, top: 0.1, right: 0.8, bottom: 0.7 });
  assert.deepEqual(speedsterSelectionIds([
    { id: "inside-a", point: { x: 0.2, y: 0.1 } },
    { id: "inside-b", point: { x: 0.5, y: 0.5 } },
    { id: "outside-x", point: { x: 0.81, y: 0.5 } },
    { id: "outside-y", point: { x: 0.5, y: 0.71 } },
  ], box), ["inside-a", "inside-b"]);
});

test("review UI exposes one Select mode, one batch remove, and one batch Undo path", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const viewer = readFileSync(`${root}/components/ai-grader-v2/DefectEvidenceViewer.tsx`, "utf8");
  const workspace = readFileSync(`${root}/components/ai-grader-v2/ReviewWorkspace.tsx`, "utf8");
  const page = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");
  const route = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/sessions/[sessionId]/review-action.ts`,
    "utf8",
  );

  assert.match(viewer, /type ReviewMode = [^\n]+"SELECT"/);
  assert.match(viewer, />Select<\/button>/);
  assert.match(viewer, /speedsterSelectionIds/);
  assert.match(viewer, /Remove \{batchSelectedIds\.size\} selected/);
  assert.match(viewer, /disabled=\{batchRemovePending \|\| busy\}/);
  assert.match(viewer, /disabled=\{busy\}[^>]*onClick=\{\(\) => onRemoveDefects/);
  assert.match(viewer, /if \(mode === "SELECT"\) event\.stopPropagation\(\)/);
  assert.match(viewer, /onRemoveDefects\?\.\(\[active\.id\]\)/);
  assert.match(workspace, /onRemoveDefects/);
  assert.match(workspace, /disabled=\{busy\} onClick=\{onComplete\}/);
  assert.match(page, /lastRemovedDefectIds/);
  assert.match(page, /reviewMutationInFlight/);
  assert.match(page, /busy=\{working\}/);
  assert.match(page, /type: "REMOVE", defectIds/);
  assert.match(page, /type: "UNDO", defectIds: lastRemovedDefectIds/);
  assert.match(route, /speedsterReviewPostSchema as postSchema/);
  assert.match(route, /postSchema\.safeParse\(req\.body \?\? \{\}\)/);
  for (const type of ["REMOVE", "UNDO"]) {
    assert.deepEqual(speedsterReviewPostSchema.parse({ action: { type, defectIds: ["finding-a", "finding-b"] } }),
      { action: { type, defectIds: ["finding-a", "finding-b"] } });
    assert.equal(speedsterReviewPostSchema.safeParse({ action: { type, defectIds: [] } }).success, false);
    assert.equal(speedsterReviewPostSchema.safeParse({ action: { type, defectIds: [""] } }).success, false);
  }
  assert.doesNotMatch(viewer, /confirm\(/i);
});
