import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AI_GRADER_LABEL_SHEET_CAPACITY,
  AI_GRADER_LABEL_SHEET_SCHEMA_VERSION,
  buildAiGraderLabelSheetRevision,
  buildAiGraderLabelSheetsResult,
  mergeAiGraderLabelSheetPayload,
  normalizeAiGraderConfirmedCardIdentity,
  safeAiGraderLabelPublicUrl,
  sealAiGraderLabelSheetAssignment,
  selectNextAiGraderLabelSheetSlot,
  type AiGraderLabelSheetAssignment,
  type AiGraderLabelSheetSourceRow,
} from "../lib/aiGraderLabelSheets";

function sourceRow(reportId: string, labelId: string, assignment: AiGraderLabelSheetAssignment): AiGraderLabelSheetSourceRow {
  return {
    id: labelId,
    reportId,
    certId: `TK-${reportId}`,
    labelGradeText: "9.2",
    qrPayloadUrl: `https://collect.tenkings.co/ai-grader/reports/${reportId}`,
    publicReportUrl: `https://collect.tenkings.co/ai-grader/reports/${reportId}`,
    physicalPrintStatus: "not_printed",
    publicationStatus: "published",
    payload: mergeAiGraderLabelSheetPayload(
      {
        stationToken: "must-not-leak",
        reportHtmlPath: "C:\\capture\\report.html",
      },
      assignment,
      {
        category: "sport",
        playerName: "Test Player",
        year: "2025",
        manufacturer: "Topps",
        productSet: "Chrome",
        cardNumber: String(assignment.slot),
        privateField: "must-not-leak",
      }
    ),
  };
}

test("label sheet selection fills slots one through sixteen and starts the next sheet", () => {
  const rows: AiGraderLabelSheetSourceRow[] = [];
  for (let index = 1; index <= AI_GRADER_LABEL_SHEET_CAPACITY + 1; index += 1) {
    const reportId = `report-${index}`;
    const selection = selectNextAiGraderLabelSheetSlot(rows, {
      reportId,
      assignedAt: new Date(Date.UTC(2026, 6, 9, 12, index)).toISOString(),
      assignedByUserId: "operator-1",
    });
    rows.push(sourceRow(reportId, `label-${index}`, selection.assignment));
    if (index <= AI_GRADER_LABEL_SHEET_CAPACITY) {
      assert.equal(selection.assignment.sheetNumber, 1);
      assert.equal(selection.assignment.slot, index);
    } else {
      assert.equal(selection.assignment.sheetNumber, 2);
      assert.equal(selection.assignment.slot, 1);
    }
  }

  const retry = selectNextAiGraderLabelSheetSlot(rows, {
    reportId: "report-5",
    assignedAt: "2026-07-09T15:00:00.000Z",
  });
  assert.equal(retry.existing, true);
  assert.equal(retry.assignment.sheetNumber, 1);
  assert.equal(retry.assignment.slot, 5);
});

test("sealed partial sheets are not reused", () => {
  const first = selectNextAiGraderLabelSheetSlot([], {
    reportId: "report-1",
    assignedAt: "2026-07-09T12:00:00.000Z",
    assignedByUserId: "operator-1",
  });
  const sealed = sealAiGraderLabelSheetAssignment(first.assignment, {
    sealedAt: "2026-07-09T12:05:00.000Z",
    sealedByUserId: "operator-2",
  });
  const rows = [sourceRow("report-1", "label-1", sealed)];
  const next = selectNextAiGraderLabelSheetSlot(rows, {
    reportId: "report-2",
    assignedAt: "2026-07-09T12:06:00.000Z",
  });

  assert.equal(next.assignment.sheetNumber, 2);
  assert.equal(next.assignment.slot, 1);
  assert.notEqual(next.assignment.sheetId, sealed.sheetId);
});

test("safe label sheet DTOs omit raw payload and unsafe URLs", () => {
  const assignment: AiGraderLabelSheetAssignment = {
    schemaVersion: AI_GRADER_LABEL_SHEET_SCHEMA_VERSION,
    sheetId: "ai-grader-label-sheet-000001",
    sheetNumber: 1,
    slot: 1,
    capacity: AI_GRADER_LABEL_SHEET_CAPACITY,
    assignedAt: "2026-07-09T12:00:00.000Z",
  };
  const row = sourceRow("report-1", "label-1", assignment);
  row.qrPayloadUrl = "https://storage.example.test/object?X-Amz-Signature=secret";
  row.publicReportUrl = "http://127.0.0.1/report-1";
  const result = buildAiGraderLabelSheetsResult([row]);
  const serialized = JSON.stringify(result);

  assert.equal(result.sheets[0].labels[0].qrPayloadUrl, undefined);
  assert.equal(result.sheets[0].labels[0].publicReportUrl, undefined);
  assert.equal(result.sheets[0].labels[0].confirmedCardIdentity.playerName, "Test Player");
  assert.equal(safeAiGraderLabelPublicUrl("https://printer.internal/report"), undefined);
  assert.equal(safeAiGraderLabelPublicUrl("https://bridge.localhost/report"), undefined);
  assert.equal(safeAiGraderLabelPublicUrl("https://100.64.0.1/report"), undefined);
  assert.equal(safeAiGraderLabelPublicUrl("https://[::ffff:127.0.0.1]/report"), undefined);
  assert.doesNotMatch(serialized, /must-not-leak|reportHtmlPath|stationToken|X-Amz-Signature|127\.0\.0\.1/);
});

test("safe sheet DTOs expose only Label V1 version authority and revisions bind it", () => {
  const assignment: AiGraderLabelSheetAssignment = {
    schemaVersion: AI_GRADER_LABEL_SHEET_SCHEMA_VERSION,
    sheetId: "ai-grader-label-sheet-000001",
    sheetNumber: 1,
    slot: 1,
    capacity: AI_GRADER_LABEL_SHEET_CAPACITY,
    assignedAt: "2026-07-13T12:00:00.000Z",
  };
  const row = sourceRow("report-v1", "label-v1", assignment);
  (row.payload as Record<string, unknown>).labelV1 = {
    schemaVersion: "ten-kings-label-runtime-v1",
    templateId: "ten-kings-sports-label-v1",
    templateDigestSha256: "a".repeat(64),
    calibrationProfile: {
      status: "provisional_not_physically_calibrated",
      printProfileId: "ten-kings-foil-express-provisional-v1",
      cutProfileId: "ten-kings-cricut-provisional-v1",
      privateOffset: "must-not-leak",
    },
    immutableIdentitySnapshot: { privateField: "must-not-leak" },
  };
  const label = buildAiGraderLabelSheetsResult([row]).sheets[0].labels[0];
  assert.deepEqual(label.labelV1, {
    schemaVersion: "ten-kings-label-runtime-v1",
    templateId: "ten-kings-sports-label-v1",
    templateDigestSha256: "a".repeat(64),
    printProfileId: "ten-kings-foil-express-provisional-v1",
    cutProfileId: "ten-kings-cricut-provisional-v1",
    physicalCalibrationStatus: "provisional_not_physically_calibrated",
  });
  assert.doesNotMatch(JSON.stringify(label), /privateOffset|privateField|must-not-leak/);
  assert.notEqual(
    buildAiGraderLabelSheetRevision([label]),
    buildAiGraderLabelSheetRevision([
      { ...label, labelV1: { ...label.labelV1!, templateDigestSha256: "b".repeat(64) } },
    ])
  );
});

test("confirmed identity and sheet revisions are normalized and deterministic", () => {
  assert.deepEqual(
    normalizeAiGraderConfirmedCardIdentity({
      category: "sport",
      displayTitle: "Display Card",
      brand: "Upper Deck",
      set: "Series One",
      number: "99",
      secret: "drop-me",
    }),
    {
      category: "sport",
      title: "Display Card",
      manufacturer: "Upper Deck",
      productSet: "Series One",
      cardNumber: "99",
    }
  );
  const left = buildAiGraderLabelSheetRevision([
    { labelId: "label-b", slot: 2 },
    { labelId: "label-a", slot: 1 },
  ]);
  const right = buildAiGraderLabelSheetRevision([
    { labelId: "label-a", slot: 1 },
    { labelId: "label-b", slot: 2 },
  ]);
  assert.equal(left, right);
  assert.notEqual(left, buildAiGraderLabelSheetRevision([{ labelId: "label-a", slot: 1 }]));
  const printable = {
    labelId: "label-a",
    slot: 1,
    certId: "TK-AIG-1",
    grade: "9.0",
    qrPayloadUrl: "https://collect.tenkings.co/ai-grader/reports/report-1",
    publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/report-1",
    confirmedCardIdentity: { playerName: "Michael Jordan", year: "1996" },
  };
  const printableRevision = buildAiGraderLabelSheetRevision([printable]);
  assert.notEqual(printableRevision, buildAiGraderLabelSheetRevision([{ ...printable, grade: "8.5" }]));
  assert.notEqual(
    printableRevision,
    buildAiGraderLabelSheetRevision([
      { ...printable, confirmedCardIdentity: { ...printable.confirmedCardIdentity, year: "1997" } },
    ])
  );
});

test("label sheet page uses authenticated server-rendered PDF authority and explicit human print state", () => {
  const testPath = fileURLToPath(import.meta.url);
  const pagePath = fileURLToPath(new URL("../pages/ai-grader/labels/sheets.tsx", import.meta.url));
  assert.notEqual(testPath, pagePath);
  const source = readFileSync(pagePath, "utf8");

  assert.match(source, /\/production\/label-sheets/);
  assert.match(source, /\/production\/prepare-label-sheet-print/);
  assert.match(source, /\/production\/mark-label-sheet-printed/);
  assert.match(source, /render-label-sheet-pdf/);
  assert.match(source, /render-label-sheet-cut-svg/);
  assert.match(source, /sheet-pdf-preview/);
  assert.match(source, /!productionOutputReady/);
  assert.match(source, /OPEN SHEET — NOT AUTHORIZED FOR PRINT/);
  assert.match(source, /Print Current Sheet/);
  assert.match(source, /Exact-dimension PDF is the print authority/);
  assert.match(source, /buildAdminHeaders\(session\.token/);
  assert.doesNotMatch(source, /window\.print|QRCode|@page|grid-template-columns: repeat\(2, 2\.73in\)|stationToken|data:image|127\.0\.0\.1/);
});

test("legacy per-card QR printing is retired and operator links target authenticated Label Sheets", () => {
  const legacyPage = readFileSync(
    fileURLToPath(new URL("../pages/ai-grader/labels/[reportId].tsx", import.meta.url)),
    "utf8"
  );
  const workflow = readFileSync(fileURLToPath(new URL("../lib/aiGraderOperatorWorkflow.ts", import.meta.url)), "utf8");
  const finish = readFileSync(fileURLToPath(new URL("../pages/ai-grader/finish.tsx", import.meta.url)), "utf8");
  const station = readFileSync(fileURLToPath(new URL("../pages/ai-grader/station.tsx", import.meta.url)), "utf8");

  assert.match(legacyPage, /href="\/ai-grader\/labels\/sheets"/);
  assert.match(legacyPage, /physical NFC tag/);
  assert.doesNotMatch(legacyPage, /qrcode|QRCode|<canvas|window\.print|Print Label|print-ready|@media print/i);
  assert.match(workflow, /\/ai-grader\/labels\/sheets/);
  assert.doesNotMatch(workflow, /\/ai-grader\/labels\/\$\{encodeURIComponent/);
  assert.match(finish, /Open label sheets/);
  assert.doesNotMatch(finish, />Open label preview</i);
  assert.match(station, />Label Sheets</);
  assert.doesNotMatch(station, />Label Preview</i);
});
