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

function publicStorageLocatorPaths(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, index) => publicStorageLocatorPaths(entry, `${path}[${index}]`));
  if (typeof value === "string") {
    const trimmed = value.trim();
    return (
      /^(?:s3|gs|az|swift):\/\//i.test(trimmed) ||
      /^ai-grader\/reports\/[^/?#]+(?:\/|$)/i.test(trimmed) ||
      /(^|[\s('"=:])(\/Users\/|\/home\/|\/root\/|\/tmp\/|\/var\/|\/app\/|\/workspace\/|\/mnt\/|\/opt\/|\/srv\/|\/etc\/|\/private\/|\/run\/|\/usr\/|\/bin\/|\/sbin\/|\/lib\/|\/lib64\/|\/dev\/|\/proc\/|\/sys\/|\/System\/|\/Library\/|\/Volumes\/)/i.test(trimmed) ||
      /^(?:(?:authorization\s*:\s*)?(?:bearer|basic)\s+\S{8,}|(?:x[-_]?api[-_]?key|api[-_]?key)\s*[:=]\s*\S{8,})$/i.test(trimmed) ||
      /^eyJ[a-z0-9_-]*\.[a-z0-9_-]+\.[a-z0-9_-]+$/i.test(trimmed) ||
      /^(?:iVBORw0KGgo|\/9j\/|R0lGOD|UklGR|SUkq|TU0A)/.test(trimmed)
    ) ? [path] : [];
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    const compact = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const forbidden =
      compact.endsWith("base64") ||
      compact.endsWith("payload") ||
      compact.includes("encoded") ||
      compact.endsWith("body") ||
      compact.includes("binary") ||
      compact.includes("presigned") ||
      compact.includes("bridge") ||
      compact.includes("cookie") ||
      compact.includes("header") ||
      compact === "jwt" ||
      compact.endsWith("jwt") ||
      compact.endsWith("endpoint") ||
      compact === "sourceurl" ||
      [
        "artifactkey",
        "artifactkeys",
        "artifactlocator",
        "artifactlocators",
        "signedurl",
        "signeduri",
        "downloadurl",
        "downloaduri",
        "privateurl",
        "privateuri",
        "internalurl",
        "internaluri",
      ].includes(compact) ||
      compact.includes("provider") ||
      compact.includes("openai") ||
      compact.includes("googlevision") ||
      compact.includes("serpapi") ||
      compact.includes("storagekey") ||
      compact.includes("storageprefix") ||
      compact.includes("storagepath") ||
      compact.includes("storagereference") ||
      compact.includes("storagelocator") ||
      compact.includes("privatestorage") ||
      compact.includes("internalstorage") ||
      compact.includes("privateobject") ||
      compact.includes("internalobject") ||
      [
        "labelpreviewkey",
        "reportbundlekey",
        "productionreleasekey",
        "labeldatakey",
        "assetmanifestkey",
        "reporthtmlkey",
        "publicationmanifestkey",
        "integrationcontractkey",
      ].includes(compact) ||
      (compact.startsWith("storage") &&
        /(?:key|prefix|path|reference|ref|locator|url|uri|object|objectid|bucket|bucketname|blob|blobid)$/.test(compact)) ||
      /(?:object|blob|bucket|s3|spaces)(?:key|path|prefix|reference|ref|locator|id|uri|url|name|handle)$/.test(compact) ||
      compact === "sourcekey";
    return [
      ...(forbidden ? [`${path}.${key}`] : []),
      ...publicStorageLocatorPaths(entry, `${path}.${key}`),
    ];
  });
}

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

test("page-level SSR browser payload recursively excludes storage locators while retaining safe public evidence URLs", async () => {
  const persisted = publicBundle();
  const rawPersistedBundle = publicBundle({
    reportBundleStorageKey: "private-report-bundle",
    storageUrl: "https://private-storage.example.test/report",
    storageObjectId: "private-report-object-id",
    storageBucket: "private-report-bucket",
    storageBlob: "private-report-blob",
    artifactKeys: ["private-report-artifact-key"],
    signedUrl: "https://private-storage.example.test/report?signature=private",
    downloadUrl: "https://private-storage.example.test/download/report",
    providerPrivateIdentifier: "private-provider-identifier",
    serpApiSearchId: "private-serp-search-id",
    openAiOperationName: "private-openai-operation",
    providerId: "private-provider-id",
    helperBridgeUrl: "https://private-bridge.example.test/session",
    requestHeaders: {
      cookie: "private-cookie",
      authorization: "private-authorization-header",
    },
    opaquePayload: "cHJpdmF0ZS1vcGFxdWUtcGF5bG9hZA==",
    encodedImage: "cHJpdmF0ZS1lbmNvZGVkLWltYWdl",
    rawStorageReference: "ai-grader/reports/persisted-cinematic-report/assets/private-hidden-object.png",
    headerMap: { cookie: "private-header-cookie" },
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.private-signature",
    openAiResponseHandle: "private-openai-handle",
    serpApiSearchReference: "private-serp-reference",
    source: "s3://private-bucket/hidden.png",
    objectHandle: "gs://private-bucket/hidden.png",
    sourceKey: "ai-grader/reports/persisted-cinematic-report/assets/private-source-key.png",
    sourceUrl: "https://private-bridge.example.test/status",
    opaqueSource: "ai-grader/reports/persisted-cinematic-report/report-bundle.json",
    reference: "ai-grader/reports/persisted-cinematic-report/production-release.json",
    unixOpaque: "/etc/private-cinematic-report.json",
    opaqueEnvironmentValues: {
      first: "/var/private-cinematic-report.json",
      second: "/usr/private-cinematic-report.json",
      third: "/proc/private-cinematic-report.json",
      fourth: "/dev/private-cinematic-report.json",
      fifth: "/bin/private-cinematic-report.json",
    },
    opaqueTransportValues: {
      first: "Bearer synthetic-cinematic-bearer-value",
      second: "Basic c3ludGhldGljLWNpbmV0aWMtYmFzaWMtdmFsdWU=",
      third: "x-api-key: synthetic-cinematic-api-key-value",
    },
    imageContent: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    opaqueData: "cHJpdmF0ZS1vcGFxdWUtZW5jb2RlZC1iaW5hcnktcGF5bG9hZC1mb3ItcmVhZGJvdW5kYXJ5LXRlc3Rpbmctb25seQ==",
    publicAssets: persisted.publicAssets.map((asset, index) => index === 0
      ? {
          ...asset,
          storageKey: "private-front-storage-key",
          storageKeyPrefix: "private-front-storage-prefix",
          privateObjectReference: "private-front-object-reference",
        }
      : asset),
    productionRelease: {
      ...persisted.productionRelease,
      productionReleaseStorageKey: "private-production-release",
      label: {
        ...persisted.productionRelease.label,
        labelDataStorageKey: "private-label-data",
        labelPreviewKey: "private-label-preview",
      },
      slabbedPhotoContract: {
        photos: [{
          storageKey: "private-slabbed-photo",
          objectUri: "s3://private-bucket/slabbed-front.png",
        }],
      },
    },
    visionLab: {
      defectEvidence: {
        storage_path: "private-defect-path",
        objectReference: "private-defect-object",
        imageBase64: "private-image-body",
        rawBase64: "private-raw-body",
        previewBase64: "private-preview-body",
      },
    },
  });
  const props = await resolveAiGraderCinematicReportPageProps("persisted-cinematic-report", {
    publicReadsEnabled: () => true,
    async readPublicBundle() { return rawPersistedBundle; },
    fixtureBundle(reportId: string) { return { reportId }; },
  });
  assert.ok(props);
  const browserPayload = JSON.parse(JSON.stringify(props));
  assert.deepEqual(publicStorageLocatorPaths(browserPayload), []);
  assert.doesNotMatch(JSON.stringify(browserPayload), /private-/);
  assert.doesNotMatch(JSON.stringify(browserPayload), /cHJpdmF0ZS1vcGFxdWUtcGF5bG9hZA|cHJpdmF0ZS1lbmNvZGVkLWltYWdl|private-header-cookie|private-openai-handle|private-serp-reference|private-bucket|private-source-key|private-bridge|report-bundle\.json|production-release\.json|\/(?:etc|var|usr|proc|dev|bin)\/private-cinematic|synthetic-cinematic-(?:bearer|api-key)-value|c3ludGhldGljLWNpbmV0aWMtYmFzaWMtdmFsdWU=|iVBORw0KGgo|cHJpdmF0ZS1vcGFxdWUtZW5jb2RlZC/);
  assert.equal(props?.report.images.front?.trueView?.renderUrl, "/storage/front-normalized-card.png");
  const html = renderToStaticMarkup(createElement(CinematicReport, { report: props!.report }));
  assert.match(html, /\/storage\/front-normalized-card\.png/);
  assert.doesNotMatch(
    html,
    /private-report|private-front|private-label|private-slabbed|private-defect|storageKey|artifactKeys|signedUrl|downloadUrl/,
  );
});

test("sample-defect-v1 remains an explicit, isolated cinematic fixture", async () => {
  const fixture = await resolveAiGraderCinematicReportRoute("sample-defect-v1");
  assert.equal(fixture?.fixture, true);
  const report = toAiGraderCinematicReport(fixture?.bundle);
  assert.equal(report?.reportId, "sample-defect-v1");
  assert.equal(report?.findings.back.length, 1);
  assert.equal(report?.findings.front.length, 0);
});
