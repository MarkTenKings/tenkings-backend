import test from "node:test";
import assert from "node:assert/strict";
import { mergeAiGraderPublishedReportReadData } from "../lib/server/aiGraderPublicReportRead";
import { safeAiGraderPublicReportUrl } from "../lib/server/aiGraderPublicReportData";

test("V1 public enrichment URLs reuse the strict report-link safety policy", () => {
  assert.equal(
    safeAiGraderPublicReportUrl("https://cdn.tenkings.test/reports/card.png"),
    "https://cdn.tenkings.test/reports/card.png",
  );
  assert.equal(
    safeAiGraderPublicReportUrl("/api/ai-grader/reports/report-1/assets/card.png"),
    "/api/ai-grader/reports/report-1/assets/card.png",
  );

  for (const unsafe of [
    "https://127.0.0.1/private-report.png",
    "https://169.254.169.254/latest/meta-data",
    "https://storage.invalid/card.png?X-Amz-Signature=secret",
    "https://user:secret@cdn.tenkings.test/card.png",
    "//tracker.invalid/card.png",
    "javascript:alert(1)",
  ]) {
    assert.equal(
      safeAiGraderPublicReportUrl(unsafe),
      undefined,
      `expected unsafe public report URL to be rejected: ${unsafe}`,
    );
  }
});

test("v0.2 public reads retain the canonical release and ignore private runtime release enrichments", () => {
  const canonicalRelease = {
    finalGrade: {
      overall: 8.5,
      elements: {},
      confidence: { score: 0.82, band: "medium" },
    },
    label: {
      certId: "TK-report-001",
      labelGradeText: "8.5",
      publicReportUrl: "/ai-grader/reports/report-001",
      qrPayloadUrl: "/ai-grader/reports/report-001",
    },
    publication: { publicReportUrl: "/ai-grader/reports/report-001" },
  };
  const bundle = {
    schemaVersion: "ai-grader-report-bundle-v0.2",
    reportId: "report-001",
    productionRelease: canonicalRelease,
  };

  const result = mergeAiGraderPublishedReportReadData(bundle, {
    productionRelease: {
      ...canonicalRelease,
      bridgeUrl: "http://127.0.0.1:4319",
      stationToken: "private-token",
      finalGrade: { ...canonicalRelease.finalGrade, internalModelTrace: "private" },
    },
    labelData: { certId: "overwritten", localPath: "C:\\private\\label.json" },
    slabbedPhotos: [{ publicUrl: "https://private.invalid/signed?token=secret" }],
    valuation: { resultSummary: "private runtime enrichment" },
  });

  assert.equal(result, bundle);
  assert.deepEqual((result as typeof bundle).productionRelease, canonicalRelease);
  assert.doesNotMatch(JSON.stringify(result), /bridgeUrl|stationToken|internalModelTrace|localPath|private runtime|signed/);
});

test("legacy public reads retain their existing dynamic release enrichment", () => {
  const result = mergeAiGraderPublishedReportReadData(
    { schemaVersion: "ai-grader-report-bundle-v0.1", reportId: "legacy-report" },
    {
      productionRelease: {
        finalGradeComputed: true,
        labelDataGenerated: true,
        qrPayloadGenerated: true,
        reportStatus: "final_ai_grader_report_v0",
        label: { certId: "legacy" },
      },
      labelData: { labelGradeText: "8.5" },
      slabbedPhotos: [{ artifactId: "front-slabbed" }],
      valuation: { status: "complete", valuationMinor: 12500 },
    },
  ) as any;

  assert.equal(result.productionRelease.label.certId, "legacy");
  assert.equal(result.productionRelease.label.labelGradeText, "8.5");
  assert.equal(result.productionRelease.slabbedPhotoContract.status, "uploaded");
  assert.equal(result.productionRelease.ebayCompsContract.valuationMinor, 12500);
  assert.equal(result.finalGradeComputed, true);
});
