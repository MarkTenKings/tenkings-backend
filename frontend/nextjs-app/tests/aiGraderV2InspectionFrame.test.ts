import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  SPEEDSTER_CANONICAL_FRAME,
  canonicalPointToInspection,
  inspectionBoxToCanonical,
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

test("Smart-Mark boxes may use the context but measurement receives only card intersection", () => {
  const canonical = inspectionBoxToCanonical({
    x: 20 / 1349,
    y: 30 / 1857,
    width: 50 / 1349,
    height: 60 / 1857,
  }, frame);
  assert.ok(canonical);
  assert.equal(canonical.x, 0);
  assert.equal(canonical.y, 0);
  assert.ok(canonical.width > 0);
  assert.ok(canonical.height > 0);
  assert.equal(inspectionBoxToCanonical({ x: 0, y: 0, width: 10 / 1349, height: 10 / 1857 }, frame), null);
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

test("the existing defect detail panel surfaces compact memory provenance", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const component = readFileSync(
    `${root}/components/ai-grader-v2/DefectEvidenceViewer.tsx`,
    "utf8",
  );
  const css = readFileSync(
    `${root}/components/ai-grader-v2/DefectEvidenceViewer.module.css`,
    "utf8",
  );

  assert.match(component, /active\.origin === "MEMORY"/);
  assert.match(component, /className=\{styles\.memoryLabel\}>memory<\/small>/);
  assert.match(css, /\.memoryLabel\s*\{/);
  assert.doesNotMatch(component, /memory.*(?:confirm|modal|screen)/i);
});

test("Smart-Mark measure sends the same ORIGINAL inspection evidence in one request", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const page = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");
  const service = readFileSync(`${root}/lib/ai-grader-v2/image-service.ts`, "utf8");

  assert.match(page, /evidenceView:\s*\{/);
  assert.match(page, /sessionId:\s*draft\.id/);
  assert.match(page, /id:\s*`\$\{side\}:ORIGINAL`/);
  assert.match(page, /sourceImageUrls\[`\$\{side\}:ORIGINAL`\]/);
  assert.match(page, /inspectionFrame:\s*side === "FRONT"/);
  assert.match(service, /evidenceView:\s*\{/);
  assert.doesNotMatch(page, /fingerprint.*(?:queue|poll)/i);
});

test("SAM Memory decisions reuse deterministic session and side diagnostics", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const page = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");
  const service = readFileSync(`${root}/lib/ai-grader-v2/image-service.ts`, "utf8");

  assert.match(page, /sessionId:\s*draft\.id/);
  assert.match(page, /requestTraceId:\s*`\$\{draft\.id\}:\$\{request\.side\}:detect`/);
  assert.match(service, /sessionId:\s*string/);
  assert.match(service, /requestTraceId:\s*string/);
});
