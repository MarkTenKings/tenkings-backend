import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  HUMAN_GRADE_LABEL_GEOMETRY,
  HUMAN_GRADE_FORMULA_WEIGHTS,
  HUMAN_GRADE_SHEET_CAPACITY,
  HUMAN_GRADE_SHEET_SLOTS,
  NEW_HUMAN_GRADE_FORMULA_VERSION,
  buildHumanGradeLabelContent,
  calculateHumanGrade,
  formatHumanGrade,
  formatHumanGradeCertificateNumber,
  type HumanGradeLabelSnapshot,
} from "../lib/humanGrade";
import {
  HUMAN_GRADE_LABEL_FINISH_GEOMETRY,
  HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY,
  renderHumanGradeLabelSheetPdf,
} from "../lib/server/humanGradeLabelRenderer";

const sports: HumanGradeLabelSnapshot = {
  certificateNumber: "TKH-000001",
  gradingFormulaVersion: "LEGACY_30_25_25_20",
  cardType: "SPORTS",
  playerName: "LeBron James",
  year: "2003",
  manufacturer: "Topps",
  productSet: "Chrome",
  parallel: "Refractor",
  insert: "Rookie",
  cardNumber: "111",
  centeringGrade: 10,
  cornersGrade: 9,
  edgesGrade: 8,
  surfaceGrade: 7,
  grade: 8.7,
};

const pokemon: HumanGradeLabelSnapshot = {
  certificateNumber: "TKH-000002",
  gradingFormulaVersion: "EQUAL_25",
  cardType: "POKEMON",
  cardName: "Charizard",
  year: "1999",
  productSet: "Base Set",
  parallel: "Holo",
  cardNumber: "4",
  centeringGrade: 10,
  cornersGrade: 10,
  edgesGrade: 10,
  surfaceGrade: 10,
  grade: 10,
};

const equalSports: HumanGradeLabelSnapshot = {
  ...sports,
  certificateNumber: "TKH-000003",
  gradingFormulaVersion: "EQUAL_25",
  grade: 8.5,
};

test("human-grade certificate numbers are short, deterministic, and one-line safe", () => {
  assert.equal(formatHumanGradeCertificateNumber(1), "TKH-000001");
  assert.equal(formatHumanGradeCertificateNumber(999999), "TKH-999999");
  assert.equal(formatHumanGrade(10), "10");
  assert.equal(formatHumanGrade("9.50"), "9.5");
  assert.throws(() => formatHumanGradeCertificateNumber(0), /positive integer/);
  assert.throws(() => formatHumanGrade(10.1), /1 through 10/);
});

test("human-grade final grades calculate with their explicit legacy or equal formula version", () => {
  assert.deepEqual(HUMAN_GRADE_FORMULA_WEIGHTS, {
    LEGACY_30_25_25_20: {
      centering: 0.3,
      corners: 0.25,
      edges: 0.25,
      surface: 0.2,
    },
    EQUAL_25: {
      centering: 0.25,
      corners: 0.25,
      edges: 0.25,
      surface: 0.25,
    },
  });
  assert.equal(NEW_HUMAN_GRADE_FORMULA_VERSION, "EQUAL_25");
  assert.deepEqual(calculateHumanGrade(sports, "LEGACY_30_25_25_20"), {
    weightedGrade: 8.65,
    labelGrade: "8.7",
  });
  assert.deepEqual(calculateHumanGrade(equalSports, "EQUAL_25"), {
    weightedGrade: 8.5,
    labelGrade: "8.5",
  });
  assert.deepEqual(calculateHumanGrade(equalSports), {
    weightedGrade: 8.5,
    labelGrade: "8.5",
  });
  assert.deepEqual(
    calculateHumanGrade({
      centeringGrade: 9.5,
      cornersGrade: 9.5,
      edgesGrade: 9.5,
      surfaceGrade: 9.5,
    }),
    { weightedGrade: 9.5, labelGrade: "9.5" }
  );
});

test("human-grade Sports and Pokemon labels use only printed label fields", () => {
  assert.deepEqual(buildHumanGradeLabelContent(sports), {
    primary: "LEBRON JAMES",
    metadata: "2003 TOPPS CHROME #111",
    descriptor: "REFRACTOR / ROOKIE",
    certificateNumber: "TKH-000001",
    subgrades: [
      { label: "CENTERING", grade: "10" },
      { label: "CORNERS", grade: "9" },
      { label: "EDGES", grade: "8" },
      { label: "SURFACE", grade: "7" },
    ],
    grade: "8.7",
  });
  assert.deepEqual(buildHumanGradeLabelContent(pokemon), {
    primary: "CHARIZARD",
    metadata: "1999 BASE SET #4",
    descriptor: "HOLO",
    certificateNumber: "TKH-000002",
    subgrades: [
      { label: "CENTERING", grade: "10" },
      { label: "CORNERS", grade: "10" },
      { label: "EDGES", grade: "10" },
      { label: "SURFACE", grade: "10" },
    ],
    grade: "10",
  });
  assert.equal(buildHumanGradeLabelContent(equalSports).grade, "8.5");
  assert.throws(
    () => buildHumanGradeLabelContent({ ...sports, grade: 8.6 }),
    /does not match its LEGACY_30_25_25_20 weighted subgrades/
  );
  assert.throws(
    () => buildHumanGradeLabelContent({ ...sports, gradingFormulaVersion: "EQUAL_25" }),
    /does not match its EQUAL_25 weighted subgrades/
  );
  assert.throws(
    () => buildHumanGradeLabelContent({ ...equalSports, gradingFormulaVersion: "LEGACY_30_25_25_20" }),
    /does not match its LEGACY_30_25_25_20 weighted subgrades/
  );
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

test("human-grade compact subgrade grid is centered with legible equals-separated scores", () => {
  assert.equal(HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.codeFontSizePt, 8);
  assert.equal(HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.equalsFontSizePt, 8);
  assert.equal(HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.scoreFontSizePt, 9.6);
  assert.equal(HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.horizontalScale, 0.84);
  assert.equal(HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.rightThirdCenterXPt, (132.5 + 196.56) / 2);
  assert.equal(HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.codeToEqualsGapPt, 1);
  assert.equal(HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.equalsToScoreGapPt, 1);
  const secondScoreTop =
    HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.gridTopPt +
    HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.rowHeightPt +
    HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.scoreTopOffsetPt;
  assert.ok(secondScoreTop >= HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.dividerTopPt);
  assert.ok(
    secondScoreTop + HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.scoreFontSizePt <=
      HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY.dividerBottomPt
  );
});

test("human-grade artwork uses a uniform safe frame and an outside hand-cut guide", () => {
  assert.deepEqual(HUMAN_GRADE_LABEL_FINISH_GEOMETRY, {
    safeInsetIn: 0.08,
    safeInsetPt: 5.76,
    cutGuideStrokePt: 0.75,
    cutGuidePathOffsetPt: -0.375,
  });
  assert.equal(
    HUMAN_GRADE_LABEL_FINISH_GEOMETRY.cutGuidePathOffsetPt +
      HUMAN_GRADE_LABEL_FINISH_GEOMETRY.cutGuideStrokePt / 2,
    0
  );
});

test("human-grade renderer validates and renders mixed legacy and equal-formula labels", async () => {
  const snapshots = [sports, equalSports, pokemon];
  const entries = Array.from({ length: 16 }, (_, index) => ({
    slot: index + 1,
    snapshot: {
      ...snapshots[index % snapshots.length],
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
  assert.equal((source.match(/-0\.375 -0\.375 197\.31 60\.51 re/g) ?? []).length, 1);
  assert.doesNotMatch(source, /GRADING|QR CODE|NFC/);

  const partialSource = (await renderHumanGradeLabelSheetPdf(entries.slice(0, 1))).toString("latin1");
  assert.equal((partialSource.match(/-0\.375 -0\.375 197\.31 60\.51 re/g) ?? []).length, 0);

  const slotFifteenSource = (await renderHumanGradeLabelSheetPdf(entries.slice(14, 15))).toString("latin1");
  assert.equal((slotFifteenSource.match(/-0\.375 -0\.375 197\.31 60\.51 re/g) ?? []).length, 1);

  const slotSixteenSource = (await renderHumanGradeLabelSheetPdf(entries.slice(15, 16))).toString("latin1");
  assert.equal((slotSixteenSource.match(/-0\.375 -0\.375 197\.31 60\.51 re/g) ?? []).length, 0);

  await assert.rejects(
    renderHumanGradeLabelSheetPdf([
      { slot: 1, snapshot: { ...sports, gradingFormulaVersion: "EQUAL_25" } },
    ]),
    /does not match its EQUAL_25 weighted subgrades/
  );
});

test("human-grade formula migration keeps a legacy-safe rollout default without a data rewrite", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const schema = readFileSync(`${root}/../../packages/database/prisma/schema.prisma`, "utf8");
  const api = readFileSync(`${root}/pages/api/admin/human-grade/index.ts`, "utf8");
  const migration = readFileSync(
    `${root}/../../packages/database/prisma/migrations/20260731183000_human_grade_formula_version/migration.sql`,
    "utf8"
  );
  assert.match(schema, /enum HumanGradeFormulaVersion[\s\S]*LEGACY_30_25_25_20[\s\S]*EQUAL_25/);
  assert.match(
    schema,
    /gradingFormulaVersion\s+HumanGradeFormulaVersion\s+@default\(LEGACY_30_25_25_20\)/
  );
  assert.match(migration, /ADD COLUMN "gradingFormulaVersion"[\s\S]*DEFAULT 'LEGACY_30_25_25_20'/);
  assert.doesNotMatch(migration, /ALTER COLUMN "gradingFormulaVersion" SET DEFAULT 'EQUAL_25'/);
  assert.match(api, /gradingFormulaVersion: NEW_HUMAN_GRADE_FORMULA_VERSION/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE FROM|TRUNCATE)\b/i);
});

test("human-grade code stays outside AI Grader station and production routes", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const api = readFileSync(`${root}/pages/api/admin/human-grade/index.ts`, "utf8");
  const pdfApi = readFileSync(`${root}/pages/api/admin/human-grade/sheets/[sheetId].ts`, "utf8");
  const page = readFileSync(`${root}/pages/admin/human-grade.tsx`, "utf8");
  const sharedEditor = readFileSync(`${root}/components/human-grade/SharedLabelEditor.tsx`, "utf8");
  const renderer = readFileSync(`${root}/lib/server/humanGradeLabelRenderer.ts`, "utf8");
  const patchBlock = api.slice(api.indexOf('req.method === "PATCH"'), api.indexOf('req.method === "DELETE"'));
  const deleteBlock = api.slice(api.indexOf('req.method === "DELETE"'));
  assert.match(api, /requireAdminSession/);
  assert.match(page, /Add New Graded Card/);
  assert.match(page, /TKH-AUTO/);
  assert.match(page, /calculateHumanGrade/);
  assert.match(page, /editingLabel\?\.gradingFormulaVersion \?\? NEW_HUMAN_GRADE_FORMULA_VERSION/);
  assert.match(api, /calculateHumanGrade/);
  assert.match(api, /gradingFormulaVersion: NEW_HUMAN_GRADE_FORMULA_VERSION/);
  assert.match(patchBlock, /select: \{ id: true, gradingFormulaVersion: true \}/);
  assert.match(patchBlock, /labelData\(parsed\.data, existing\.gradingFormulaVersion\)/);
  assert.match(api, /req\.method === "PATCH"/);
  assert.match(api, /req\.method === "DELETE"/);
  assert.doesNotMatch(patchBlock, /existing\.sheet\.status !== "OPEN"|Ready-to-print label pages cannot be edited/);
  assert.match(deleteBlock, /existing\.sheet\.status !== "OPEN"/);
  assert.match(page, /Save Changes/);
  assert.match(page, /Delete/);
  assert.match(page, /editingLabelId/);
  assert.match(page, /Completed Page Labels/);
  assert.match(page, /Saving an edit regenerates this page’s PDF with the updated label/);
  assert.match(page, /PDF rendered from its current saved labels/);
  assert.match(page, /cache: "no-store"/);
  assert.match(page, /SharedLabelEditor/);
  assert.match(sharedEditor, /Calculated grade and human subgrades/);
  assert.match(sharedEditor, /compact-final-grade/);
  assert.match(sharedEditor, /compact-subgrade-grid/);
  assert.match(sharedEditor, /compact-subgrade-equals/);
  assert.match(sharedEditor, /\["centeringGrade", "CTR", "Centering"\]/);
  assert.doesNotMatch(page, /className="subgrade-fields"/);
  assert.doesNotMatch(page, /grade-hud|hud-final-grade|hud-subgrade/);
  assert.match(pdfApi, /renderHumanGradeLabelSheetPdf/);
  assert.match(pdfApi, /gradingFormulaVersion: label\.gradingFormulaVersion/);
  assert.match(pdfApi, /"Cache-Control", "private, no-store"/);
  assert.match(renderer, /HUMAN_GRADE_SUBGRADE_GRID_GEOMETRY/);
  assert.match(renderer, /drawSubgradePair/);
  assert.match(renderer, /CENTERING: "CTR"/);
  assert.match(renderer, /CORNERS: "CRN"/);
  assert.match(renderer, /EDGES: "EDG"/);
  assert.match(renderer, /SURFACE: "SUR"/);
  assert.match(renderer, /\.text\("=", equalsX/);
  assert.match(renderer, /right-third content is not centered/);
  assert.doesNotMatch(renderer, /drawHud|nodeRadiusPt|frameWidthPt/);
  assert.doesNotMatch(`${api}\n${pdfApi}\n${page}`, /\/api\/admin\/ai-grader|\/ai-grader\/station/);
  assert.doesNotMatch(renderer, /from ["'][^"']*aiGrader/);
  assert.doesNotMatch(renderer, /drawNfc|drawQr|GRADING/);
});
