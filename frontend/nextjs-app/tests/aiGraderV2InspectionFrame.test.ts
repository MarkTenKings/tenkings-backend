import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  SPEEDSTER_CANONICAL_FRAME,
  canonicalPointToInspection,
  parseSpeedsterInspectionFrame,
} from "../lib/ai-grader-v2/inspection-frame";

const frame = {
  width: 1350,
  height: 1858,
  cardBounds: { x: 40, y: 40, width: 1270, height: 1778 },
};

test("maps canonical card corners into the exact 40-pixel inspection inset", () => {
  assert.deepEqual(canonicalPointToInspection({ x: 0, y: 0 }, frame), {
    x: 40 / 1349,
    y: 40 / 1857,
  });
  assert.deepEqual(canonicalPointToInspection({ x: 1, y: 1 }, frame), {
    x: 1309 / 1349,
    y: 1817 / 1857,
  });
});

test("legacy full-frame evidence remains an identity mapping", () => {
  const point = { x: 0.25, y: 0.75 };
  assert.deepEqual(canonicalPointToInspection(point, SPEEDSTER_CANONICAL_FRAME), point);
});

test("accepts only bounded inspection metadata", () => {
  assert.deepEqual(parseSpeedsterInspectionFrame(frame), frame);
  assert.equal(parseSpeedsterInspectionFrame({
    ...frame,
    cardBounds: { ...frame.cardBounds, x: 1000 },
  }), null);
});

test("uses a square magnifier while retaining full-stage boundary clamping", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const css = readFileSync(
    `${root}/components/ai-grader-v2/DefectEvidenceViewer.module.css`,
    "utf8",
  );
  const lens = css.match(/\.lens\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";

  assert.match(lens, /border-radius:\s*0;/);
  assert.match(lens, /left:\s*clamp\(0px,/);
  assert.match(lens, /top:\s*clamp\(0px,/);
  assert.doesNotMatch(lens, /border-radius:\s*50%/);
});

test("Memory pins and the existing detail panel surface the proposal similarity", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const component = readFileSync(
    `${root}/components/ai-grader-v2/DefectEvidenceViewer.tsx`,
    "utf8",
  );
  const css = readFileSync(
    `${root}/components/ai-grader-v2/DefectEvidenceViewer.module.css`,
    "utf8",
  );

  assert.match(component, /function memorySimilarity\(/);
  assert.match(component, /className=\{styles\.memoryScore\}/);
  assert.match(component, /`memory · sim \$\{activeSimilarity\}`/);
  assert.match(css, /\.memoryScore\s*\{/);
  assert.match(css, /\.memoryLabel\s*\{/);
  assert.doesNotMatch(component, /memory.*(?:confirm|modal|screen)/i);
});

test("review measurement uses one server-owned ORIGINAL inspection evidence request", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const page = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");
  const service = readFileSync(`${root}/lib/server/aiGraderV2ReviewAction.ts`, "utf8");

  assert.match(page, /\/review-action/);
  assert.doesNotMatch(page, /speedsterImageService\.measure/);
  assert.match(service, /evidenceView:\s*\{/);
  assert.match(service, /id:\s*`\$\{side\}:ORIGINAL`/);
  assert.match(service, /inspectionStorageKey/);
  assert.match(service, /await deps\.measure/);
  assert.doesNotMatch(page, /fingerprint.*(?:queue|poll)/i);
});

test("SAM Memory decisions reuse deterministic session and side diagnostics", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const service = readFileSync(`${root}/lib/server/aiGraderV2ReviewAction.ts`, "utf8");
  const route = readFileSync(
    `${root}/pages/api/admin/ai-grader-v2/sessions/[sessionId]/review-action.ts`,
    "utf8",
  );

  assert.match(service, /sessionId:\s*input\.sessionId/);
  assert.match(service, /requestTraceId:\s*`\$\{input\.sessionId\}:\$\{request\.side\}:detect`/);
  assert.match(service, /learningBank,/);
  assert.match(route, /speedsterLearningBankForDetectRequest/);
});
