import test from "node:test";
import assert from "node:assert/strict";
import { defectFindingsForExactImage } from "../lib/aiGraderDefectFindings";
import { createAiGraderPublicReportApiHandler } from "../lib/server/aiGraderProductionApi";

function mockResponse() {
  const state: { statusCode?: number; body?: any; headers: Record<string, string> } = { headers: {} };
  return {
    state,
    response: {
      setHeader(name: string, value: string) {
        state.headers[name] = value;
      },
      status(statusCode: number) {
        state.statusCode = statusCode;
        return this;
      },
      json(body: any) {
        state.body = body;
        return this;
      },
    },
  };
}

test("public report API revalidates defect assets and strips private finding state on read", async () => {
  const findingId = "dfv1_1234567890abcdef12345678";
  const handler = createAiGraderPublicReportApiHandler({
    env: { AI_GRADER_PUBLIC_REPORT_DB_ENABLED: "true" },
    async readPublishedBundle() {
      return {
        schemaVersion: "ai-grader-report-bundle-v0.1",
        reportId: "report-1",
        generatedAt: "2026-07-10T12:00:00.000Z",
        certifiedClaim: false,
        publicAssets: [
          {
            id: "report/back/normalized.png",
            kind: "report-image",
            contentType: "image/png",
            storageKey: "ai-grader/reports/report-1/assets/001-normalized.png",
            publicUrl: "https://cdn.tenkings.test/ai-grader/reports/report-1/assets/001-normalized.png",
            checksumSha256: "a".repeat(64),
            byteSize: 100,
            side: "back",
            evidenceRole: "normalized_card",
          },
          {
            id: "report/back/tracker.png",
            kind: "report-image",
            contentType: "image/png",
            storageKey: "ai-grader/reports/report-1/assets/002-tracker.png",
            publicUrl: "https://tracker.example.test/pixel.png",
            checksumSha256: "b".repeat(64),
            byteSize: 1,
          },
        ],
        provisionalGrade: {
          gradeImpactCandidates: [{ id: "surface-1", findingIds: [findingId, "missing-finding"] }],
        },
        visionLab: {
          defectFindings: [
            {
              schemaVersion: "ai-grader-defect-finding-v1",
              findingId,
              side: "back",
              category: "surface_anomaly",
              detector: { id: "surface-v1", version: "1.0.0" },
              severity: { score: 72, band: "high" },
              confidence: 0.8,
              review: { status: "confirmed", reviewedAt: "2026-07-10T12:00:00.000Z" },
              geometry: {
                coordinateFrame: "normalized_card",
                units: "fraction",
                shape: { type: "box", x: 0.1, y: 0.2, width: 0.2, height: 0.1 },
              },
              evidence: {
                trueViewAssetId: "report/back/normalized.png",
                channelAssetIds: [],
                roiAssetIds: [],
              },
              explanation: "Caller supplied wording.",
              rawRect: { x: 1, y: 2, width: 3, height: 4 },
            },
          ],
        },
      };
    },
  });
  const { state, response } = mockResponse();
  await handler({ method: "GET", query: { reportId: "report-1" } } as any, response as any);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body.bundle.publicAssets.map((asset: any) => asset.id), [
    "report/back/normalized.png",
    "report/back/tracker.png",
  ]);
  assert.equal(
    state.body.bundle.publicAssets[1].publicUrl,
    "/storage/ai-grader/reports/report-1/assets/002-tracker.png",
  );
  assert.deepEqual(state.body.bundle.visionLab.defectFindings[0].review, { status: "unreviewed" });
  assert.equal(state.body.bundle.visionLab.defectFindings[0].rawRect, undefined);
  assert.match(state.body.bundle.visionLab.defectFindings[0].explanation, /^AI-detected provisional/);
  assert.deepEqual(state.body.bundle.provisionalGrade.gradeImpactCandidates[0].findingIds, [findingId]);
  assert.doesNotMatch(JSON.stringify(state.body), /tracker\.example|rawRect|reviewedAt|Caller supplied/);
});

test("public findings keep canonical 1200x1680 fractions after a 35-degree capture normalization", async () => {
  const frontFindingId = "dfv1_35degfront1234567890abcd";
  const backFindingId = "dfv1_35degback1234567890abcde";
  const mismatchedFindingId = "dfv1_wrongside1234567890abcd";
  const canonicalBox = (x: number, y: number, width: number, height: number) => ({
    type: "box" as const,
    x: x / 1200,
    y: y / 1680,
    width: width / 1200,
    height: height / 1680,
  });
  const finding = (
    findingId: string,
    side: "front" | "back",
    trueViewAssetId: string,
    shape: ReturnType<typeof canonicalBox>,
  ) => ({
    schemaVersion: "ai-grader-defect-finding-v1",
    findingId,
    side,
    category: "surface_anomaly",
    detector: { id: "surface-v1", version: "1.0.0" },
    severity: { score: 62, band: "medium" },
    confidence: 0.81,
    review: { status: "unreviewed" },
    geometry: { coordinateFrame: "normalized_card", units: "fraction", shape },
    evidence: { trueViewAssetId, channelAssetIds: [], roiAssetIds: [] },
    explanation: "AI-detected provisional surface finding.",
  });
  const frontShape = canonicalBox(180, 420, 300, 252);
  const backShape = canonicalBox(720, 840, 240, 336);
  const handler = createAiGraderPublicReportApiHandler({
    env: { AI_GRADER_PUBLIC_REPORT_DB_ENABLED: "true" },
    async readPublishedBundle() {
      return {
        reportId: "normalized-35-degree-report",
        geometry: {
          front: { sourceRotationDegrees: 34.8, normalizedWidth: 1200, normalizedHeight: 1680 },
          back: { sourceRotationDegrees: -34.6, normalizedWidth: 1200, normalizedHeight: 1680 },
        },
        publicAssets: [
          {
            id: "report/front/normalized.png",
            kind: "report-image",
            contentType: "image/png",
            storageKey: "ai-grader/reports/normalized-35-degree-report/assets/001-front-normalized.png",
            publicUrl: "https://cdn.tenkings.test/front-normalized.png",
            checksumSha256: "a".repeat(64),
            byteSize: 1200 * 1680,
            side: "front",
            evidenceRole: "normalized_card",
          },
          {
            id: "report/back/normalized.png",
            kind: "report-image",
            contentType: "image/png",
            storageKey: "ai-grader/reports/normalized-35-degree-report/assets/002-back-normalized.png",
            publicUrl: "https://cdn.tenkings.test/back-normalized.png",
            checksumSha256: "b".repeat(64),
            byteSize: 1200 * 1680,
            side: "back",
            evidenceRole: "normalized_card",
          },
        ],
        provisionalGrade: {
          gradeImpactCandidates: [
            { id: "front-surface", findingIds: [frontFindingId, mismatchedFindingId] },
            { id: "back-surface", findingIds: [backFindingId] },
          ],
        },
        visionLab: {
          candidateCount: 3,
          defectFindings: [
            finding(frontFindingId, "front", "report/front/normalized.png", frontShape),
            finding(backFindingId, "back", "report/back/normalized.png", backShape),
            finding(mismatchedFindingId, "front", "report/back/normalized.png", canonicalBox(60, 84, 120, 168)),
          ],
        },
      };
    },
  });
  const { state, response } = mockResponse();
  await handler(
    { method: "GET", query: { reportId: "normalized-35-degree-report" } } as any,
    response as any,
  );

  assert.equal(state.statusCode, 200);
  const publicFindings = state.body.bundle.visionLab.defectFindings;
  assert.deepEqual(publicFindings.map((entry: any) => entry.findingId), [frontFindingId, backFindingId]);
  assert.deepEqual(publicFindings[0].geometry, {
    coordinateFrame: "normalized_card",
    units: "fraction",
    shape: frontShape,
  });
  assert.deepEqual(publicFindings[1].geometry, {
    coordinateFrame: "normalized_card",
    units: "fraction",
    shape: backShape,
  });
  assert.equal(publicFindings[0].evidence.trueViewAssetId, "report/front/normalized.png");
  assert.equal(publicFindings[1].evidence.trueViewAssetId, "report/back/normalized.png");
  assert.deepEqual(
    defectFindingsForExactImage(publicFindings, "report/front/normalized.png").map((entry) => entry.findingId),
    [frontFindingId],
  );
  assert.deepEqual(
    defectFindingsForExactImage(publicFindings, "report/back/normalized.png").map((entry) => entry.findingId),
    [backFindingId],
  );
  assert.deepEqual(state.body.bundle.provisionalGrade.gradeImpactCandidates[0].findingIds, [frontFindingId]);
  assert.deepEqual(state.body.bundle.provisionalGrade.gradeImpactCandidates[1].findingIds, [backFindingId]);
});

test("candidate-free public reports remain readable and never fabricate defect markers", async () => {
  const handler = createAiGraderPublicReportApiHandler({
    env: { AI_GRADER_PUBLIC_REPORT_DB_ENABLED: "true" },
    async readPublishedBundle() {
      return {
        reportId: "candidate-free-report",
        localPath: "C:\\TenKings\\capture-data\\private.png",
        bridgeUrl: "http://127.0.0.1:47652/preview/stream",
        stationToken: "private-station-token",
        presignedUrl: "https://storage.example.test/file.png?X-Amz-Signature=secret",
        previewImage: "data:image/png;base64,private-image-body",
        hardwareControls: { lighting: "on", capture: true },
        publicAssets: [
          {
            id: "report/front/normalized.png",
            kind: "report-image",
            contentType: "image/png",
            storageKey: "ai-grader/reports/candidate-free-report/assets/001-front-normalized.png",
            publicUrl: "https://cdn.tenkings.test/front-normalized.png",
            checksumSha256: "c".repeat(64),
            byteSize: 1200 * 1680,
            side: "front",
            evidenceRole: "normalized_card",
          },
        ],
        provisionalGrade: { gradeImpactCandidates: [] },
        visionLab: { available: true, candidateCount: 0, missingDataWarnings: [] },
      };
    },
  });
  const { state, response } = mockResponse();
  await handler({ method: "GET", query: { reportId: "candidate-free-report" } } as any, response as any);

  assert.equal(state.statusCode, 200);
  assert.equal(state.body.bundle.reportId, "candidate-free-report");
  assert.equal(state.body.bundle.visionLab.candidateCount, 0);
  assert.deepEqual(state.body.bundle.visionLab.defectFindings, []);
  assert.deepEqual(state.body.bundle.provisionalGrade.gradeImpactCandidates, []);
  assert.deepEqual(defectFindingsForExactImage([], "report/front/normalized.png"), []);
  assert.doesNotMatch(
    JSON.stringify(state.body),
    /C:\\TenKings|127\.0\.0\.1|station-token|X-Amz-Signature|data:image|hardwareControls|lighting|capture/,
  );
});
