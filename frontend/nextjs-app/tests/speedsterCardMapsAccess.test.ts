import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const cardMapsPage = readFileSync(`${root}/pages/card-maps.tsx`, "utf8");
const cardMapsStyles = readFileSync(`${root}/styles/CardMaps.module.css`, "utf8");
const graderPage = readFileSync(`${root}/pages/admin/ai-grader-v2.tsx`, "utf8");
const graderStyles = readFileSync(`${root}/styles/AiGraderV2Admin.module.css`, "utf8");
const completedPage = readFileSync(`${root}/pages/admin/ai-grader-v2/completed/[sessionId].tsx`, "utf8");
const adminHome = readFileSync(`${root}/pages/admin/index.tsx`, "utf8");

test("CARD MAPS has one literal admin-only route whose hero CTA focuses NEW CARD MAP", () => {
  assert.match(cardMapsPage, /export default function CardMapsPage/);
  assert.match(cardMapsPage, /hasAdminAccess\(session\?\.user\.id\) \|\| hasAdminPhoneAccess\(session\?\.user\.phone\)/);
  assert.match(cardMapsPage, /if \(!isAdmin\) return[\s\S]*?Admin access required/);
  assert.match(cardMapsPage, /id="new-card-map"/);
  assert.match(cardMapsPage, /<h2 id="new-card-map-heading">NEW CARD MAP<\/h2>/);
  assert.match(cardMapsPage, /const focusNewCard = useCallback/);
  assert.match(cardMapsPage, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(cardMapsPage, /querySelector<HTMLInputElement>\("input"\)/);
  assert.match(cardMapsPage, /className=\{styles\.cardMapsCta\}[\s\S]*?onClick=\{focusNewCard\}>CREATE CARD MAP<\/button>/);
  assert.doesNotMatch(cardMapsPage, /createDraft\(null/);
});

test("new CARD MAP creation reuses the exact session, map, capture, and immutable workspace contracts", () => {
  assert.match(cardMapsPage, /fieldErrors=\{fieldErrors\}/);
  assert.match(cardMapsPage, /error instanceof SpeedsterIdentityValidationError/);
  assert.match(cardMapsPage, /primaryActionLabel="CONTINUE TO FRONT \+ BACK"/);
  assert.match(cardMapsPage, /fetch\("\/api\/admin\/ai-grader-v2\/sessions"/);
  assert.match(cardMapsPage, /maps\/current\?sessionId=/);
  assert.match(cardMapsPage, /workflowState: "CAPTURED"/);
  assert.match(cardMapsPage, /revisionId: bundle\.front\.mapRegistration\.mapRevisionId/);
  assert.match(cardMapsPage, /filterPolicyVersion: SPEEDSTER_MAP_FILTER_POLICY_VERSION/);
  assert.match(cardMapsPage, /<CaptureWorkspace/);
  assert.match(cardMapsPage, /<SpeedsterTrainWorkspace/);
  assert.match(cardMapsPage, /map\.status === "LOADED" \? "EDIT CARD MAP" : "CREATE CARD MAP"/);
  assert.doesNotMatch(cardMapsPage, /initializeReview|review-action|SAM 3/);
  assert.doesNotMatch(cardMapsPage, /"[^"\n]*TRAIN[^"\n]*"/);
});

test("completed CARD MAP mode uses one exact source request and a local identity-correction link", () => {
  assert.equal(cardMapsPage.match(/maps\/source\?sessionId=/g)?.length, 1);
  assert.match(cardMapsPage, /encodeURIComponent\(sessionId\)/);
  assert.match(cardMapsPage, /Completed-card CARD MAP source could not be loaded/);
  assert.match(cardMapsPage, /href=\{`\/admin\/ai-grader-v2\/completed\/\$\{encodeURIComponent\(sessionId\)\}`\}>FIX CARD IDENTITY<\/Link>/);
  assert.doesNotMatch(cardMapsPage, /fetch\(`\/api\/admin\/ai-grader-v2\/completed/);
});

test("all existing entry points converge on the sole CARD MAPS route", () => {
  assert.match(adminHome, /label: "Card Maps",[\s\S]*?href: "\/card-maps"/);
  assert.match(graderPage, /<Link href="\/card-maps">Card Maps<\/Link>/);
  assert.match(graderPage, /onSubmit=\{\(event\) => void createDraft\(event\)\}/);
  assert.match(graderPage, /maps\/current\?sessionId=/);
  assert.match(graderPage, /await initializeReview\(\)/);
  assert.doesNotMatch(graderPage, /id="card-maps"|cardMapsPanel|CREATE CARD MAP|<SpeedsterTrainWorkspace|trainRequested|trainOpen/);

  assert.match(completedPage, /router\.push\(`\/card-maps\?sessionId=\$\{encodeURIComponent\(sessionId\)\}`\)/);
  assert.match(completedPage, />\s*CARD MAP\s*<\/button>/);
  assert.doesNotMatch(completedPage, /maps\/current|maps\/source|SpeedsterTrainWorkspace|openTrain|trainOpen|trainLoading/);
});

test("dedicated CARD MAPS retains the responsive motion-safe visual while AI Grader drops it", () => {
  assert.match(cardMapsStyles, /\.cardMapsPanel \{/);
  assert.match(cardMapsStyles, /\.cardMapsCta \{[\s\S]*?background: linear-gradient/);
  assert.match(cardMapsStyles, /\.cardMapsVisual \{[\s\S]*?pointer-events: none/);
  assert.match(cardMapsStyles, /@media \(max-width: 980px\)/);
  assert.match(cardMapsStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(graderStyles, /\.cardMapsPanel|\.cardMapsCta|\.mapCard/);
});
