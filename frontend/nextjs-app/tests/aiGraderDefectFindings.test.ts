import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AiGraderDefectOverlay from "../components/ai-grader/AiGraderDefectOverlay";
import {
  defectFindingLabel,
  defectFindingsForExactImage,
  defectFindingPolygonPoints,
  defectFindingShapeBounds,
  normalizedPointToPercent,
  objectContainProjection,
  type AiGraderDefectFindingV1,
} from "../lib/aiGraderDefectFindings";
import {
  findReportImageByExactAssetId,
  findReportNormalizedCardImageByExactAssetId,
  type AiGraderRenderableReportImage,
} from "../lib/aiGraderReportImages";

const finding: AiGraderDefectFindingV1 = {
  schemaVersion: "ai-grader-defect-finding-v1",
  findingId: "dfv1_1234567890abcdef12345678",
  side: "back",
  category: "surface_anomaly",
  detector: { id: "surface-v1", version: "1.0.0" },
  severity: { score: 75, band: "high" },
  confidence: 0.82,
  review: { status: "unreviewed" },
  geometry: {
    coordinateFrame: "normalized_card",
    units: "fraction",
    shape: { type: "box", x: 0.1, y: 0.2, width: 0.25, height: 0.125 },
  },
  evidence: {
    trueViewAssetId: "report/back/normalized.png",
    channelAssetIds: [],
    roiAssetIds: [],
  },
  explanation: "AI-detected provisional surface finding.",
};

test("normalized geometry projects deterministically into the overlay coordinate plane", () => {
  assert.deepEqual(normalizedPointToPercent({ x: 0.125, y: 0.875 }), { x: 12.5, y: 87.5 });
  assert.deepEqual(defectFindingShapeBounds(finding.geometry.shape), { x: 0.1, y: 0.2, width: 0.25, height: 0.125 });
  const polygon = {
    type: "polygon" as const,
    points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.3, y: 0.6 }],
  };
  assert.equal(defectFindingPolygonPoints(polygon), "10,20 40,20 30,60");
  assert.deepEqual(defectFindingShapeBounds(polygon), { x: 0.1, y: 0.2, width: 0.30000000000000004, height: 0.39999999999999997 });
  assert.deepEqual(objectContainProjection(100, 200), { x: 15, y: 0, width: 70, height: 100 });
  const squareProjection = objectContainProjection(100, 100);
  assert.equal(squareProjection.x, 0);
  assert.equal(squareProjection.width, 100);
  assert.ok(Math.abs(squareProjection.y - 14.285714) < 0.000001);
  assert.ok(Math.abs(squareProjection.height - 71.428571) < 0.000001);
});

test("finding image joins require the exact logical asset ID", () => {
  const assets: AiGraderRenderableReportImage[] = [
    {
      id: "report/back/normalized.png",
      fileName: "normalized.png",
      side: "back",
      evidenceRole: "normalized_card",
      renderUrl: "https://cdn.example.test/exact.png",
      renderSource: "public_url",
    },
    {
      id: "report/front/normalized.png",
      fileName: "normalized.png",
      side: "front",
      evidenceRole: "normalized_card",
      renderUrl: "https://cdn.example.test/fuzzy.png",
      renderSource: "public_url",
    },
  ];
  assert.equal(findReportImageByExactAssetId(assets, "report/back/normalized.png")?.renderUrl, "https://cdn.example.test/exact.png");
  assert.equal(findReportImageByExactAssetId(assets, "REPORT/BACK/NORMALIZED.PNG"), undefined);
  assert.equal(findReportImageByExactAssetId(assets, "normalized.png"), undefined);
  assert.equal(findReportNormalizedCardImageByExactAssetId(assets, "report/back/normalized.png", "back")?.renderUrl, "https://cdn.example.test/exact.png");
  assert.equal(findReportNormalizedCardImageByExactAssetId(assets, "report/back/normalized.png", "front"), undefined);
  const otherImageFinding = {
    ...finding,
    findingId: "dfv1_abcdef1234567890abcdef12",
    evidence: { ...finding.evidence, trueViewAssetId: "report/back/other.png" },
  };
  assert.deepEqual(defectFindingsForExactImage([finding, otherImageFinding], "report/back/normalized.png").map((entry) => entry.findingId), [
    finding.findingId,
  ]);
});

test("overlay withholds interactive markers until the exact evidence image loads", () => {
  const image: AiGraderRenderableReportImage = {
    id: "report/back/normalized.png",
    fileName: "normalized.png",
    renderUrl: "/images/card-pull-1.png",
    renderSource: "public_url",
  };
  const html = renderToStaticMarkup(createElement(AiGraderDefectOverlay, { image, findings: [finding] }));
  assert.match(html, /<img[^>]*src="\/images\/card-pull-1.png"/);
  assert.doesNotMatch(html, /<svg|<rect|role="button"/);
  assert.match(defectFindingLabel(finding), /82% confidence/);
  assert.doesNotMatch(html, /data:image|localPath|stationToken/);
});
