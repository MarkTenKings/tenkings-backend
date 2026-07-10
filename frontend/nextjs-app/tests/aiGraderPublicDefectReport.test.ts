import test from "node:test";
import assert from "node:assert/strict";
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
        reportId: "report-1",
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
