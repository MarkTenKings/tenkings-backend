import assert from "node:assert/strict";
import test from "node:test";
import { productionAssetManifest } from "../lib/aiGraderProductionAssetManifest";
import type { AiGraderReportBundle } from "../lib/aiGraderReportBundle";

test("station production asset manifest retains safe finding alignment metadata", () => {
  const bundle = {
    assets: [
      {
        id: "report/front/front-normalized-card.png",
        kind: "image",
        fileName: "front-normalized-card.png",
        contentType: "image/png",
        sha256: "a".repeat(64),
        byteSize: 42,
        side: "front",
        evidenceRole: "normalized_card",
        widthPx: 1200,
        heightPx: 1680,
        localPath: "C:\\private\\front-normalized-card.png",
        bodyEncoding: "base64",
        bodyBase64: "private-body",
        publicUrl: "https://storage.example/presigned?token=private",
      },
    ],
  } as unknown as AiGraderReportBundle;

  assert.deepEqual(productionAssetManifest(bundle), [
    {
      id: "report/front/front-normalized-card.png",
      kind: "image",
      fileName: "front-normalized-card.png",
      contentType: "image/png",
      checksumSha256: "a".repeat(64),
      byteSize: 42,
      side: "front",
      evidenceRole: "normalized_card",
      widthPx: 1200,
      heightPx: 1680,
      required: true,
    },
  ]);
});

test("station production asset manifest omits invalid optional metadata and non-images", () => {
  const bundle = {
    assets: [
      {
        id: "report/back/back-normalized-card.png",
        kind: "image",
        fileName: "back-normalized-card.png",
        contentType: "image/png",
        checksumSha256: "b".repeat(64),
        byteSize: 84,
        side: "sideways",
        evidenceRole: "unknown_role",
        widthPx: -1,
        heightPx: Number.NaN,
      },
      {
        id: "analysis",
        kind: "analysis",
        fileName: "analysis.json",
        contentType: "application/json",
        checksumSha256: "c".repeat(64),
        byteSize: 12,
      },
    ],
  } as unknown as AiGraderReportBundle;

  assert.deepEqual(productionAssetManifest(bundle), [
    {
      id: "report/back/back-normalized-card.png",
      kind: "image",
      fileName: "back-normalized-card.png",
      contentType: "image/png",
      checksumSha256: "b".repeat(64),
      byteSize: 84,
      required: true,
    },
  ]);
});
