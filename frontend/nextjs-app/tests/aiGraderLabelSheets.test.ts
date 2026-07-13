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
  row.nfc = {
    status: "active",
    publicTagId: "Abcdefghijklmnopqrstuvwxyz012345",
    nfcTagUrl: "https://collect.tenkings.co/nfc/Abcdefghijklmnopqrstuvwxyz012345",
    chipType: "NTAG215",
    securityMode: "static_url_v1",
    uidFingerprintSha256: "must-not-leak",
  };
  row.qrPayloadUrl = "https://storage.example.test/object?X-Amz-Signature=secret";
  row.publicReportUrl = "http://127.0.0.1/report-1";
  const result = buildAiGraderLabelSheetsResult([row]);
  const serialized = JSON.stringify(result);

  assert.equal(result.sheets[0].labels[0].qrPayloadUrl, undefined);
  assert.equal(result.sheets[0].labels[0].publicReportUrl, undefined);
  assert.equal(result.sheets[0].labels[0].confirmedCardIdentity.playerName, "Test Player");
  assert.deepEqual(result.sheets[0].labels[0].nfc, {
    status: "active",
    registrationKind: "registered_link",
    publicTagId: "Abcdefghijklmnopqrstuvwxyz012345",
    nfcTagUrl: "https://collect.tenkings.co/nfc/Abcdefghijklmnopqrstuvwxyz012345",
    chipType: "NTAG215",
    securityMode: "static_url_v1",
  });
  assert.equal(safeAiGraderLabelPublicUrl("https://printer.internal/report"), undefined);
  assert.equal(safeAiGraderLabelPublicUrl("https://bridge.localhost/report"), undefined);
  assert.equal(safeAiGraderLabelPublicUrl("https://100.64.0.1/report"), undefined);
  assert.equal(safeAiGraderLabelPublicUrl("https://[::ffff:127.0.0.1]/report"), undefined);
  assert.doesNotMatch(serialized, /must-not-leak|reportHtmlPath|stationToken|X-Amz-Signature|127\.0\.0\.1/);
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

test("label sheet page fixes physical print dimensions and uses authenticated queue actions", () => {
  const testPath = fileURLToPath(import.meta.url);
  const pagePath = fileURLToPath(new URL("../pages/ai-grader/labels/sheets.tsx", import.meta.url));
  assert.notEqual(testPath, pagePath);
  const source = readFileSync(pagePath, "utf8");

  assert.match(source, /@page \{ size: 8\.5in 12in; margin: 0; \}/);
  assert.match(source, /grid-template-columns: repeat\(2, 2\.73in\)/);
  assert.match(source, /grid-template-rows: repeat\(8, 0\.83in\)/);
  assert.match(source, /\/production\/label-sheets/);
  assert.match(source, /\/production\/prepare-label-sheet-print/);
  assert.match(source, /\/production\/mark-label-sheet-printed/);
  assert.match(source, /buildAdminHeaders\(session\.token/);
  assert.doesNotMatch(source, /stationToken|data:image|127\.0\.0\.1/);
});
