import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cinematicEvidenceImage,
  toAiGraderCinematicReport,
} from "../lib/aiGraderCinematicReport";
import {
  resolveAiGraderCinematicReportPageProps,
  resolveAiGraderCinematicReportRoute,
} from "../lib/server/aiGraderCinematicReportRoute";
import { objectContainProjection } from "../lib/aiGraderDefectFindings";

// Node's focused test runner does not process Next CSS modules. The component
// remains production-styled by Next; this narrow loader lets the SSR safety
// assertions exercise the real React markup without a browser bundler.
(require as any).extensions[".css"] = (module: { exports: unknown }) => {
  const classes = new Proxy({}, { get: (_target, key) => String(key) });
  module.exports = { __esModule: true, default: classes };
};
const CinematicReport = require("../components/ai-grader/cinematic/CinematicReport").default;

const frontImageId = "report/front/normalized-card.png";
const backImageId = "report/back/normalized-card.png";
const frontHeatmapId = "report/front/surface-findings-heatmap.png";

function finding(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "ai-grader-defect-finding-v1",
    findingId: "dfv1_frontfinding1234567890abcd",
    side: "front",
    category: "surface_anomaly",
    detector: { id: "surface_v1", version: "1.0.0", captureProfileVersion: "fixed-rig-v1" },
    severity: { score: 63, band: "medium" },
    confidence: 0.581,
    review: { status: "unreviewed" },
    geometry: {
      coordinateFrame: "normalized_card",
      units: "fraction",
      shape: { kind: "box", x: 0.2, y: 0.3, width: 0.15, height: 0.1 },
    },
    evidence: { trueViewAssetId: frontImageId, heatmapAssetId: frontHeatmapId, channelAssetIds: [], roiAssetIds: [] },
    explanation: "Published surface response.",
    ...overrides,
  };
}

function publicBundle(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "ai-grader-report-bundle-v0.2",
    reportId: "persisted-cinematic-report",
    generatedAt: "2026-07-10T15:30:00.000Z",
    certifiedClaim: false,
    cardIdentity: { title: "Persisted Field Card", sideCount: 2, set: "2026 Field Set", cardNumber: "17" },
    productionRelease: {
      finalGrade: {
        overall: 8.5,
        confidence: { score: 0.581, band: "medium" },
        elements: {
          centering: { score: 8.8, confidence: "high", explanation: "Published centering analysis." },
          surface: { score: 8.1, confidence: "medium", explanation: "Published surface analysis." },
        },
        whyNot10: [{ id: "surface-1", title: "Surface response", explanation: "Published source finding." }],
      },
      label: {
        certId: "RPT-2026-17",
        labelGradeText: "AI Grade V0",
        publicReportUrl: "/ai-grader/reports/persisted-cinematic-report",
        qrPayloadUrl: "/ai-grader/reports/persisted-cinematic-report",
      },
      publication: { publicReportUrl: "/ai-grader/reports/persisted-cinematic-report" },
    },
    defectFindings: [finding()],
    publicAssets: [
      { id: frontImageId, kind: "report-image", fileName: "front-normalized-card.png", contentType: "image/png", publicUrl: "/storage/front-normalized-card.png", side: "front", evidenceRole: "normalized_card", widthPx: 1200, heightPx: 1680 },
      { id: frontHeatmapId, kind: "report-image", fileName: "front-surface-findings-heatmap.png", contentType: "image/png", publicUrl: "/storage/front-surface-findings-heatmap.png", side: "front", evidenceRole: "surface_heatmap", widthPx: 1200, heightPx: 1680 },
      { id: backImageId, kind: "report-image", fileName: "back-normalized-card.png", contentType: "image/png", publicUrl: "/storage/back-normalized-card.png", side: "back", evidenceRole: "normalized_card", widthPx: 1200, heightPx: 1680 },
    ],
    assets: [
      { id: "legacy/front-overlay.png", kind: "report-image", contentType: "image/png", publicUrl: "/storage/legacy-overlay.png", side: "front", evidenceRole: "measurement_overlay" },
    ],
    ...overrides,
  };
}

test("cinematic adapter uses persisted v0.2 fields and never prototype report values", () => {
  const report = toAiGraderCinematicReport(publicBundle());
  assert.ok(report);
  assert.equal(report?.title, "Persisted Field Card");
  assert.equal(report?.reportId, "persisted-cinematic-report");
  assert.equal(report?.generatedAt, "2026-07-10T15:30:00.000Z");
  assert.equal(report?.grade?.tkScore, 850);
  assert.equal(report?.grade?.confidenceScore, 0.581);
  assert.deepEqual(report?.grade?.elements.map((element) => element.key), ["centering", "surface"]);
  assert.equal(report?.images.front?.trueView?.renderUrl, "/storage/front-normalized-card.png");
  assert.equal(report?.images.front?.heatmap?.renderUrl, "/storage/front-surface-findings-heatmap.png");
  assert.equal(report?.findings.front[0]?.heatmap?.renderUrl, "/storage/front-surface-findings-heatmap.png");
  assert.equal(report?.images.front?.trueView?.id, frontImageId);
  assert.notEqual(report?.images.front?.trueView?.id, "legacy/front-overlay.png");
  const html = renderToStaticMarkup(createElement(CinematicReport, { report: report! }));
  assert.match(html, /Persisted Field Card/);
  assert.match(html, />850</);
  assert.match(html, /AI Grade · Not a certified claim/);
  assert.doesNotMatch(html, /\b995\b|PRISTINE|OBSIDIAN|\b50\/50\b|14,208|Act II|Act III|>1\./);
  assert.doesNotMatch(html, /Legacy|Living Legacy|Journey|Crown Label/);
});

test("cinematic findings remain exact-image and side scoped", () => {
  const backFinding = finding({
    findingId: "dfv1_backfinding1234567890abcde",
    side: "back",
    geometry: { coordinateFrame: "normalized_card", units: "fraction", shape: { kind: "box", x: 0.4, y: 0.5, width: 0.1, height: 0.12 } },
    evidence: { trueViewAssetId: backImageId, channelAssetIds: [], roiAssetIds: [] },
    review: { status: "confirmed", reviewedAt: "2026-07-10T15:30:00.000Z" },
  });
  const wrongSideFinding = finding({
    findingId: "dfv1_wrongside1234567890abcdef",
    evidence: { trueViewAssetId: backImageId, channelAssetIds: [], roiAssetIds: [] },
  });
  const report = toAiGraderCinematicReport(publicBundle({ defectFindings: [finding(), backFinding, wrongSideFinding] }));
  assert.deepEqual(report?.findings.front.map((entry) => entry.finding.findingId), ["dfv1_frontfinding1234567890abcd"]);
  assert.deepEqual(report?.findings.back.map((entry) => entry.finding.findingId), ["dfv1_backfinding1234567890abcde"]);
  assert.equal(report?.findings.front[0]?.statusLabel, "AI candidate");
  assert.equal(report?.findings.back[0]?.statusLabel, "Confirmed");
  assert.equal(report?.findings.front[0]?.finding.geometry.shape.type, "box");
});

test("selected findings use their exact normalized card asset, including case-insensitive v0.2 joins", () => {
  const detailImageId = "report/front/normalized-card-detail.png";
  const detailFinding = finding({
    findingId: "dfv1_detailfinding1234567890abc",
    evidence: { trueViewAssetId: detailImageId.toUpperCase(), channelAssetIds: [], roiAssetIds: [] },
  });
  const report = toAiGraderCinematicReport(publicBundle({
    defectFindings: [finding(), detailFinding],
    publicAssets: [
      ...publicBundle().publicAssets,
      { id: detailImageId, contentType: "image/png", publicUrl: "/storage/front-normalized-card-detail.png", side: "front", evidenceRole: "normalized_card" },
    ],
  }));
  const selected = report?.findings.front.find((entry) => entry.finding.findingId === "dfv1_detailfinding1234567890abc");
  assert.equal(selected?.trueView.id, detailImageId);
  assert.equal(cinematicEvidenceImage("trueView", report?.images.front, selected)?.id, detailImageId);
  assert.deepEqual(objectContainProjection(100, 100), { x: 0, y: 14.285714285714285, width: 100, height: 71.42857142857143 });
  assert.deepEqual(selected?.finding.geometry.shape, { type: "box", x: 0.2, y: 0.3, width: 0.15, height: 0.1 });
});

test("calibrated measurements render only from matching publish projections", () => {
  const uncalibrated = toAiGraderCinematicReport(publicBundle({
    calibrationProfile: { isCalibrated: false },
    defectFindings: [finding({ measurements: { lengthMm: 1.2, widthMm: 0.5, calibrationVersion: "cal-v1" } })],
  }));
  assert.equal(uncalibrated?.findings.front[0]?.measurements, undefined);
  const calibrated = toAiGraderCinematicReport(publicBundle({
    calibrationProfile: { isCalibrated: true, calibrationVersion: "cal-v1" },
    defectFindings: [finding({ measurements: { lengthMm: 1.2, widthMm: 0.5, calibrationVersion: "cal-v1" } })],
  }));
  assert.deepEqual(calibrated?.findings.front[0]?.measurements, { lengthMm: 1.2, widthMm: 0.5, calibrationVersion: "cal-v1" });
  const mismatched = toAiGraderCinematicReport(publicBundle({
    calibrationProfile: { isCalibrated: true, calibrationVersion: "cal-v2" },
    defectFindings: [finding({ measurements: { lengthMm: 1.2, widthMm: 0.5, calibrationVersion: "cal-v1" } })],
  }));
  assert.equal(mismatched?.findings.front[0]?.measurements, undefined);
});

test("sparse pre-versioning reports hide unsupported fields instead of synthesizing them", () => {
  const report = toAiGraderCinematicReport({
    reportId: "legacy-sparse-report",
    publicAssets: [{ id: frontImageId, contentType: "image/png", publicUrl: "/storage/front.png", side: "front", evidenceRole: "normalized_card" }],
  });
  assert.ok(report);
  assert.equal(report?.generatedAt, undefined);
  assert.equal(report?.grade, undefined);
  assert.deepEqual(report?.notes, []);
  const html = renderToStaticMarkup(createElement(CinematicReport, { report: report! }));
  assert.match(html, /legacy-sparse-report/);
  assert.doesNotMatch(html, /TK Score|Published grading elements|Report notes|Length|Width/);
});

test("current policy never enables certified cinematic presentation", () => {
  const report = toAiGraderCinematicReport(publicBundle({ certifiedClaim: true }));
  assert.equal(report?.certifiedPresentation, false);
  const html = renderToStaticMarkup(createElement(CinematicReport, { report: report! }));
  assert.match(html, /AI Grade · Not a certified claim/);
  assert.doesNotMatch(html, /CROWN LABEL|PRISTINE|Certified ·/);
});

test("cinematic DTO cannot serialize private URLs, tokens, embedded bodies, or HTML", () => {
  const report = toAiGraderCinematicReport(publicBundle({
    cardIdentity: { title: "<script>bad</script>", sideCount: 2 },
    publicAssets: [{
      id: frontImageId,
      contentType: "image/png",
      publicUrl: "data:image/png;base64,private-image-body",
      bodyBase64: "private-image-body",
      localPath: "C:\\capture-data\\private.png",
      stationToken: "private-station-token",
      side: "front",
      evidenceRole: "normalized_card",
    }],
    assets: [],
    bridgeUrl: "http://127.0.0.1:47652/preview",
    presignedUrl: "https://storage.example.test/private.png?X-Amz-Signature=secret",
    hardwareControls: { lighting: "on" },
  }));
  assert.ok(report);
  assert.equal(report?.title, undefined);
  assert.equal(report?.images.front, undefined);
  const html = renderToStaticMarkup(createElement(CinematicReport, { report: report! }));
  assert.doesNotMatch(html, /capture-data|station-token|127\.0\.0\.1|X-Amz|data:image|private-image-body|hardwareControls|<script>/);

  const safeImageWithPrivateBody = toAiGraderCinematicReport(publicBundle({
    publicAssets: [{
      id: frontImageId,
      contentType: "image/png",
      publicUrl: "/storage/safe-front.png",
      bodyBase64: "private-image-body",
      localPath: "/var/private/front.png",
      bridgeUrl: "https://localhost/private",
      side: "front",
      evidenceRole: "normalized_card",
    }],
    assets: [],
    defectFindings: [],
  }));
  assert.equal(safeImageWithPrivateBody?.images.front?.trueView?.renderUrl, "/storage/safe-front.png");
  assert.doesNotMatch(JSON.stringify(safeImageWithPrivateBody), /bodyBase64|private-image-body|\/var\/private|localhost/);
});

test("cinematic route uses only deliberate sample-defect-v1 fixture support", async () => {
  const calls: string[] = [];
  const dependencies = {
    publicReadsEnabled: () => true,
    async readPublicBundle(reportId: string) {
      calls.push(reportId);
      return publicBundle({ reportId });
    },
    fixtureBundle(reportId: string) {
      return { reportId, schemaVersion: "ai-grader-report-bundle-v0.1" };
    },
  };
  const persisted = await resolveAiGraderCinematicReportRoute("generated-report-7", dependencies);
  assert.equal(persisted?.fixture, false);
  assert.deepEqual(calls, ["generated-report-7"]);
  const fixture = await resolveAiGraderCinematicReportRoute("sample-defect-v1", dependencies);
  assert.equal(fixture?.fixture, true);
  assert.deepEqual(calls, ["generated-report-7"]);
  assert.equal(await resolveAiGraderCinematicReportRoute("sample-final-v0", dependencies), null);
  assert.equal(await resolveAiGraderCinematicReportRoute("sample-pr45", dependencies), null);
  const unversioned = await resolveAiGraderCinematicReportRoute("legacy-public-report", {
    ...dependencies,
    async readPublicBundle(reportId: string) { return { reportId, publicAssets: [] }; },
  });
  assert.equal(unversioned?.fixture, false);
  assert.equal(await resolveAiGraderCinematicReportRoute("unknown-version", {
    ...dependencies,
    async readPublicBundle() { return { reportId: "unknown-version", schemaVersion: "ai-grader-report-bundle-v9.9" }; },
  }), null);
});

test("page-level SSR resolver serializes only the cinematic DTO and fails closed", async () => {
  const dependencies = {
    publicReadsEnabled: () => true,
    async readPublicBundle() { return publicBundle(); },
    fixtureBundle(reportId: string) { return { reportId }; },
  };
  const props = await resolveAiGraderCinematicReportPageProps("persisted-cinematic-report", dependencies);
  assert.equal(props?.fixture, false);
  assert.equal(props?.report.grade?.tkScore, 850);
  assert.equal("assets" in (props?.report ?? {}), false);
  assert.equal("defectFindings" in (props?.report ?? {}), false);
  assert.equal(await resolveAiGraderCinematicReportPageProps("unknown-schema", {
    ...dependencies,
    async readPublicBundle() { return { reportId: "unknown-schema", schemaVersion: "ai-grader-report-bundle-v9.9" }; },
  }), null);
});

test("sample-defect-v1 remains an explicit, isolated cinematic fixture", async () => {
  const fixture = await resolveAiGraderCinematicReportRoute("sample-defect-v1");
  assert.equal(fixture?.fixture, true);
  const report = toAiGraderCinematicReport(fixture?.bundle);
  assert.equal(report?.reportId, "sample-defect-v1");
  assert.equal(report?.findings.back.length, 1);
  assert.equal(report?.findings.front.length, 0);
});
