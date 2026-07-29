import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HUMAN_GRADE_LABEL_GEOMETRY,
  HUMAN_GRADE_SHEET_CAPACITY,
  HUMAN_GRADE_SHEET_SLOTS,
  buildHumanGradeLabelContent,
  formatHumanGrade,
  formatHumanGradeCertificateNumber,
  type HumanGradeLabelSnapshot,
} from "../lib/humanGrade";
import { renderHumanGradeLabelSheetPdf } from "../lib/server/humanGradeLabelRenderer";

const sports: HumanGradeLabelSnapshot = {
  certificateNumber: "TKH-000001",
  cardType: "SPORTS",
  playerName: "LeBron James",
  year: "2003",
  manufacturer: "Topps",
  productSet: "Chrome",
  parallel: "Refractor",
  insert: "Rookie",
  cardNumber: "111",
  grade: 9.5,
};

const pokemon: HumanGradeLabelSnapshot = {
  certificateNumber: "TKH-000002",
  cardType: "POKEMON",
  cardName: "Charizard",
  year: "1999",
  productSet: "Base Set",
  parallel: "Holo",
  cardNumber: "4",
  grade: 10,
};

test("human-grade certificate numbers are short, deterministic, and one-line safe", () => {
  assert.equal(formatHumanGradeCertificateNumber(1), "TKH-000001");
  assert.equal(formatHumanGradeCertificateNumber(999999), "TKH-999999");
  assert.equal(formatHumanGrade(10), "10");
  assert.equal(formatHumanGrade("9.50"), "9.5");
  assert.throws(() => formatHumanGradeCertificateNumber(0), /positive integer/);
  assert.throws(() => formatHumanGrade(10.1), /1 through 10/);
});

test("human-grade Sports and Pokemon labels use only printed label fields", () => {
  assert.deepEqual(buildHumanGradeLabelContent(sports), {
    primary: "LEBRON JAMES",
    metadata: "2003 TOPPS CHROME",
    descriptor: "REFRACTOR / ROOKIE",
    cardNumberAboveGrade: "#111",
    certificateNumber: "TKH-000001",
    grade: "9.5",
  });
  assert.deepEqual(buildHumanGradeLabelContent(pokemon), {
    primary: "CHARIZARD",
    metadata: "1999 BASE SET #4",
    descriptor: "HOLO",
    certificateNumber: "TKH-000002",
    grade: "10",
  });
});

test("human-grade pages copy the approved 2 by 8 physical sheet geometry", () => {
  assert.equal(HUMAN_GRADE_SHEET_CAPACITY, 16);
  assert.deepEqual(HUMAN_GRADE_LABEL_GEOMETRY.paper, {
    widthPt: 612,
    heightPt: 792,
    widthIn: 8.5,
    heightIn: 11,
  });
  assert.deepEqual(HUMAN_GRADE_LABEL_GEOMETRY.label, {
    widthPt: 196.56,
    heightPt: 59.76,
    widthIn: 2.73,
    heightIn: 0.83,
  });
  assert.equal(HUMAN_GRADE_SHEET_SLOTS.length, 16);
  assert.deepEqual(HUMAN_GRADE_SHEET_SLOTS[0], {
    slot: 1,
    row: 1,
    column: 1,
    xPt: 72,
    yFromTopPt: 72,
  });
  assert.deepEqual(HUMAN_GRADE_SHEET_SLOTS[15], {
    slot: 16,
    row: 8,
    column: 2,
    xPt: 343.44,
    yFromTopPt: 616.32,
  });
});

test("human-grade renderer creates one exact letter page with embedded approved fonts", async () => {
  const entries = Array.from({ length: 16 }, (_, index) => ({
    slot: index + 1,
    snapshot: {
      ...(index % 2 ? pokemon : sports),
      certificateNumber: formatHumanGradeCertificateNumber(index + 1),
    },
  }));
  const pdf = await renderHumanGradeLabelSheetPdf(entries);
  const source = pdf.toString("latin1");
  assert.equal(pdf.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(pdf.byteLength > 50_000);
  assert.match(source, /\/MediaBox \[0 0 612 792\]/);
  assert.equal((source.match(/\/Type \/Page\b/g) ?? []).length, 1);
  assert.match(source, /BebasNeue-Regular/);
  assert.match(source, /Barlow-Regular/);
  assert.doesNotMatch(source, /GRADING|QR CODE|NFC/);
});

test("human-grade code stays outside AI Grader station and production routes", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const api = readFileSync(`${root}/pages/api/admin/human-grade/index.ts`, "utf8");
  const pdfApi = readFileSync(`${root}/pages/api/admin/human-grade/sheets/[sheetId].ts`, "utf8");
  const page = readFileSync(`${root}/pages/admin/human-grade.tsx`, "utf8");
  const renderer = readFileSync(`${root}/lib/server/humanGradeLabelRenderer.ts`, "utf8");
  assert.match(api, /requireAdminSession/);
  assert.match(page, /Add New Graded Card/);
  assert.match(page, /TKH-AUTO/);
  assert.doesNotMatch(`${api}\n${pdfApi}\n${page}`, /\/api\/admin\/ai-grader|\/ai-grader\/station/);
  assert.doesNotMatch(renderer, /from ["'][^"']*aiGrader/);
  assert.doesNotMatch(renderer, /drawNfc|drawQr|GRADING/);
});
