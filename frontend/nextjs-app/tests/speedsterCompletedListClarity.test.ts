import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const page = readFileSync(`${root}/pages/admin/ai-grader-v2/completed/index.tsx`, "utf8");
const styles = readFileSync(`${root}/styles/AiGraderV2PostGrade.module.css`, "utf8");

test("completed-list copy states the complete non-void newest-first scrolling truth", () => {
  assert.match(
    page,
    /Showing all \$\{payload\.cards\.length\} non-void completed card\$\{payload\.cards\.length === 1 \? "" : "s"\}, newest first\. Scroll to view the full list\./,
  );
  assert.match(page, /<p className=\{styles\.listSummary\}>\{message\}<\/p>/);
  assert.match(styles, /\.listSummary\s*\{/);
  assert.match(page, /<Link href="\/card-maps">Card Maps<\/Link>/);
});

test("completed-list UI renders every returned card without client pagination", () => {
  assert.match(page, /fetch\("\/api\/admin\/ai-grader-v2\/completed"/);
  assert.match(page, /\{cards\.map\(\(card\) => \(/);
  assert.doesNotMatch(page, /cards\.(?:slice|filter)\(/);
  assert.doesNotMatch(page, /(?:pageSize|pagination|cursor|loadMore|hasMore)/i);
});
