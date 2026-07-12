import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_GRADER_WEB_REPORT_BUNDLE_V02_VERSION,
  aiGraderReportDefectFindings,
  getAiGraderReportBundle,
  type AiGraderCompatibleReportBundle,
} from "../lib/aiGraderReportBundle";
import { reportImageAssets } from "../lib/aiGraderReportImages";

test("v0.1 report findings continue to use the nested stored-finding shape", () => {
  const bundle = getAiGraderReportBundle("sample-defect-v1");
  const findings = aiGraderReportDefectFindings(bundle);

  assert.equal(bundle.schemaVersion, "ai-grader-report-bundle-v0.1");
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].geometry.shape, {
    type: "box",
    x: 0.56,
    y: 0.27,
    width: 0.19,
    height: 0.14,
  });
});

test("v0.2 report findings use only the top-level published projection and convert kind for the overlay", () => {
  const legacyBundle = getAiGraderReportBundle("sample-defect-v1");
  const finalizedFixture = getAiGraderReportBundle("sample-final-v0");
  const bundle = {
    ...legacyBundle,
    schemaVersion: AI_GRADER_WEB_REPORT_BUNDLE_V02_VERSION,
    productionRelease: finalizedFixture.productionRelease!,
    defectFindings: [
      {
        schemaVersion: "ai-grader-defect-finding-v1",
        findingId: "dfv1_v02_top_level",
        side: "front",
        category: "scratch",
        detector: {
          id: "surface-v1",
          version: "1.0.0",
          captureProfileVersion: "ten-kings-fixed-rig-production-fast-v1",
        },
        severity: { score: 42, band: "medium" },
        confidence: 0.73,
        review: { status: "unreviewed" },
        geometry: {
          coordinateFrame: "normalized_card",
          units: "fraction",
          shape: { kind: "box", x: 0.12, y: 0.24, width: 0.2, height: 0.1 },
        },
        evidence: {
          trueViewAssetId: "report/front/normalized.png",
          channelAssetIds: [],
          roiAssetIds: [],
        },
        explanation: "AI candidate projected from the published finding contract.",
      },
    ],
  } satisfies AiGraderCompatibleReportBundle;

  const findings = aiGraderReportDefectFindings(bundle);
  assert.deepEqual(findings.map((finding) => finding.findingId), ["dfv1_v02_top_level"]);
  assert.deepEqual(findings[0].geometry.shape, {
    type: "box",
    x: 0.12,
    y: 0.24,
    width: 0.2,
    height: 0.1,
  });
  assert.equal(bundle.defectFindings[0].geometry.shape.kind, "box");
});

test("public report assets take precedence over private or legacy assets", () => {
  const bundle = {
    ...getAiGraderReportBundle("sample-final-v0"),
    publicAssets: [{ id: "report/front/normalized.png", contentType: "image/png", publicUrl: "/storage/front.png" }],
    assets: [{ id: "private/front.png", contentType: "image/png", publicUrl: "/storage/private.png" }],
  };
  assert.deepEqual(reportImageAssets(bundle).map((asset) => asset.id), ["report/front/normalized.png"]);
});
