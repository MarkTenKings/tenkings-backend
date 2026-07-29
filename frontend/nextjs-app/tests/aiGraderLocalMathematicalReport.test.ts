import assert from "node:assert/strict";
import test from "node:test";
import { aiGraderReportBundleV03Schema } from "@tenkings/shared";
import {
  curatedAiGraderMathematicalAssetMetadata,
  loadAiGraderLocalMathematicalAssets,
  revokeAiGraderLocalMathematicalAssets,
} from "../lib/aiGraderLocalMathematicalReport";
import { fetchAiGraderStationReportAsset } from "../lib/aiGraderStationBridgeClient";
import { buildStrictAiGraderReportBundleV03Fixture } from "./fixtures/strictAiGraderReportBundleV03";

const SHA = "c".repeat(64);

function productionSizedStrictBundle() {
  const bundle = structuredClone(buildStrictAiGraderReportBundleV03Fixture());
  const assetTemplate = bundle.publicAssets[0];
  for (const side of ["front", "back"] as const) {
    bundle.publicAssets.push(
      {
        ...assetTemplate,
        id: `${side}/surface-vision.png`,
        fileName: "surface-vision.png",
        side,
        evidenceRole: "surface_vision",
      },
      {
        ...assetTemplate,
        id: `${side}/surface-heatmap.png`,
        fileName: "surface-heatmap.png",
        side,
        evidenceRole: "surface_heatmap",
      },
    );
  }
  while (bundle.publicAssets.length < 152) {
    const index = bundle.publicAssets.length;
    bundle.publicAssets.push({
      ...assetTemplate,
      id: `unreferenced/archive-${index}.png`,
      fileName: `archive-${index}.png`,
      evidenceRole: "other_evidence",
    });
  }
  return aiGraderReportBundleV03Schema.parse(bundle);
}

test("strict Mathematical V1 selects advanced curated evidence instead of the 152-asset legacy dump", () => {
  const bundle = productionSizedStrictBundle();
  const selected = curatedAiGraderMathematicalAssetMetadata(bundle);
  const selectedIds = new Set(selected.map((asset) => asset.id));

  assert.equal(bundle.publicAssets.length, 152);
  assert.ok(selected.length < bundle.publicAssets.length);
  for (const side of ["front", "back"] as const) {
    assert.equal(selectedIds.has(`${side}/normalized.png`), true);
    assert.equal(selectedIds.has(`${side}/center.png`), true);
    assert.equal(selectedIds.has(`${side}/all-on.png`), true);
    assert.equal(selectedIds.has(`${side}/surface-vision.png`), true);
    assert.equal(selectedIds.has(`${side}/surface-heatmap.png`), true);
    for (const location of ["top_left", "top_right", "bottom_right", "bottom_left"]) {
      assert.equal(selectedIds.has(`${side}/corners/${location}/roi.png`), true);
      assert.equal(selectedIds.has(`${side}/corners/${location}/segmentation.png`), true);
      assert.equal(selectedIds.has(`${side}/corners/${location}/illumination.png`), true);
    }
    for (const location of ["top", "right", "bottom", "left"]) {
      assert.equal(selectedIds.has(`${side}/edges/${location}/roi.png`), true);
      assert.equal(selectedIds.has(`${side}/edges/${location}/segmentation.png`), true);
      assert.equal(selectedIds.has(`${side}/edges/${location}/illumination.png`), true);
    }
  }
  assert.equal(
    selected.some((asset) => asset.evidenceRole === "directional_channel"),
    false,
  );
  assert.equal(
    selected.some((asset) => asset.id.startsWith("unreferenced/")),
    false,
  );
});

test("local Mathematical V1 assets are identity/hash/size/MIME verified before object URL use and revoked", async () => {
  const bundle = productionSizedStrictBundle();
  const fetched: string[] = [];
  const revoked: string[] = [];
  let nextUrl = 0;
  const assets = await loadAiGraderLocalMathematicalAssets({
    bundle,
    reportId: bundle.reportId,
    fetchAsset: async ({ reportId, assetId }) => {
      fetched.push(`${reportId}:${assetId}`);
      return {
        reportId,
        assetId,
        bytes: new ArrayBuffer(1000),
        contentType: "image/png",
        byteSize: 1000,
        checksumSha256: SHA,
      };
    },
    dependencies: {
      sha256Hex: async () => SHA,
      assertRaster: async () => ({ widthPx: 1200, heightPx: 1680 }),
      createObjectUrl: () => `blob:verified-${++nextUrl}`,
      revokeObjectUrl: (url) => revoked.push(url),
    },
  });

  assert.equal(fetched.length, assets.assetIds.length);
  assert.deepEqual(
    fetched.map((entry) => entry.slice(entry.indexOf(":") + 1)),
    assets.assetIds,
  );
  assert.equal(
    Object.values(assets.urlsByAssetId).every((url) =>
      url.startsWith("blob:verified-")),
    true,
  );
  assert.equal(
    Object.values(assets.urlsByAssetId).some((url) => url.startsWith("/api/")),
    false,
  );
  revokeAiGraderLocalMathematicalAssets(assets, (url) => revoked.push(url));
  assert.deepEqual(revoked.sort(), [...assets.objectUrls].sort());
});

for (const mismatch of ["identity", "hash", "size", "mime"] as const) {
  test(`local Mathematical V1 asset ${mismatch} mismatch fails closed`, async () => {
    const bundle = productionSizedStrictBundle();
    await assert.rejects(
      loadAiGraderLocalMathematicalAssets({
        bundle,
        reportId: bundle.reportId,
        fetchAsset: async ({ reportId, assetId }) => ({
          reportId: mismatch === "identity" ? "wrong-report" : reportId,
          assetId,
          bytes: new ArrayBuffer(mismatch === "size" ? 999 : 1000),
          contentType: mismatch === "mime" ? "text/html" : "image/png",
          byteSize: mismatch === "size" ? 999 : 1000,
          checksumSha256: mismatch === "hash" ? "d".repeat(64) : SHA,
        }),
        dependencies: {
          sha256Hex: async () => SHA,
          assertRaster: async () => ({ widthPx: 1200, heightPx: 1680 }),
          createObjectUrl: () => "blob:must-not-survive",
          revokeObjectUrl: () => undefined,
        },
      }),
      /identity mismatch|SHA-256 mismatch|byte size mismatch|MIME type mismatch/,
    );
  });
}

test("token-gated report-asset fetch binds exact report and asset response headers", async () => {
  let requestUrl = "";
  let requestToken = "";
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestToken = new Headers(init?.headers).get("x-ai-grader-station-token") ?? "";
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "image/png",
        "x-ai-grader-report-id": "report-1",
        "x-ai-grader-asset-id": "front/center.png",
        "x-ai-grader-sha256": SHA,
      },
    });
  };
  const result = await fetchAiGraderStationReportAsset({
    baseUrl: "http://127.0.0.1:47652",
    stationToken: "private-station-token",
    reportId: "report-1",
    assetId: "front/center.png",
  }, fetchImpl as typeof fetch);

  assert.equal(
    requestUrl,
    "http://127.0.0.1:47652/reports/report-1/asset?assetId=front%2Fcenter.png",
  );
  assert.equal(requestToken, "private-station-token");
  assert.equal(result.reportId, "report-1");
  assert.equal(result.assetId, "front/center.png");
  assert.equal("stationToken" in result, false);

  const wrongIdentityFetch = async () => new Response(new Uint8Array([1]), {
    status: 200,
    headers: {
      "content-type": "image/png",
      "x-ai-grader-report-id": "report-other",
      "x-ai-grader-asset-id": "front/center.png",
      "x-ai-grader-sha256": SHA,
    },
  });
  await assert.rejects(
    fetchAiGraderStationReportAsset({
      baseUrl: "http://127.0.0.1:47652",
      stationToken: "private-station-token",
      reportId: "report-1",
      assetId: "front/center.png",
    }, wrongIdentityFetch as typeof fetch),
    /asset response identity mismatch/,
  );
});
