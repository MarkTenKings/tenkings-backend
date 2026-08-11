import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const page = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");
const styles = readFileSync(`${root}/styles/AiGraderV2Admin.module.css`, "utf8");

test("admin Speedster exposes one direct CARD MAPS access point with the existing TRAIN callback", () => {
  assert.match(page, /<Link href="#card-maps">Card Maps<\/Link>/);
  assert.match(page, /id="card-maps"/);
  assert.match(page, /aria-labelledby="card-maps-heading"/);
  assert.match(page, /<h2 id="card-maps-heading">CARD MAPS<\/h2>/);
  assert.match(page, /className=\{styles\.cardMapsStatus\} role="status" aria-live="polite">\{message\}<\/p>/);
  assert.match(page, /Complete the card identity above/);
  assert.match(
    page,
    /className=\{styles\.cardMapsCta\}[\s\S]*?type="button"[\s\S]*?disabled=\{working\}[\s\S]*?onClick=\{\(\) => void createDraft\(null, true\)\}[\s\S]*?>\s*CREATE CARD MAP\s*<\/button>/,
  );
  assert.equal(page.match(/CREATE CARD MAP/g)?.length, 1);
  assert.doesNotMatch(page, /TRAIN · NEW CARD/);
  assert.match(page, /onSubmit=\{\(event\) => void createDraft\(event, false\)\}/);
  assert.match(page, /if \(!isAdmin\) return/);
});

test("CARD MAPS visual treatment is responsive, non-interactive, and motion-safe", () => {
  assert.match(styles, /\.cardMapsPanel \{/);
  assert.match(styles, /\.cardMapsCta \{[\s\S]*?background: linear-gradient/);
  assert.match(styles, /\.cardMapsStatus \{/);
  assert.match(styles, /\.cardMapsVisual \{[\s\S]*?pointer-events: none/);
  assert.match(
    styles,
    /@media \(max-width: 980px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)[\s\S]*?"content"[\s\S]*?"visual"/,
  );
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.cardMapsCta \{ width: 100%; \}/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/);
});
