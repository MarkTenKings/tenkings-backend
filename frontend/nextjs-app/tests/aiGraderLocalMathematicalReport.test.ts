import assert from "node:assert/strict";
import test from "node:test";
import { aiGraderReportBundleV03Schema } from "@tenkings/shared";
import {
  curatedAiGraderMathematicalAssetMetadata,
  loadAiGraderLocalMathematicalAssets,
  revokeAiGraderLocalMathematicalAssets,
} from "../lib/aiGraderLocalMathematicalReport";
import {
  AiGraderLocalReportBusyOwner,
  AiGraderLocalReportLifecycle,
} from "../lib/aiGraderLocalReportLifecycle";
import {
  fetchAiGraderStationMathematicalReportHydration,
  fetchAiGraderStationReportAsset,
} from "../lib/aiGraderStationBridgeClient";
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
      {
        ...assetTemplate,
        id: `${side}/unused-surface-vision.png`,
        fileName: "unused-surface-vision.png",
        side,
        evidenceRole: "surface_vision",
      },
      {
        ...assetTemplate,
        id: `${side}/unused-surface-heatmap.png`,
        fileName: "unused-surface-heatmap.png",
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
    assert.equal(selectedIds.has(`${side}/outer.png`), true);
    assert.equal(selectedIds.has(`${side}/print.png`), true);
    assert.equal(selectedIds.has(`${side}/all-on.png`), true);
    assert.equal(selectedIds.has(`${side}/surface-vision.png`), true);
    assert.equal(selectedIds.has(`${side}/surface-heatmap.png`), true);
    assert.equal(selectedIds.has(`${side}/channels/channel-1.png`), true);
    assert.equal(selectedIds.has(`${side}/channels/channel-2.png`), false);
    assert.equal(selectedIds.has(`${side}/unused-surface-vision.png`), false);
    assert.equal(selectedIds.has(`${side}/unused-surface-heatmap.png`), false);
    assert.equal(selectedIds.has(`${side}/raw-all-on.png`), false);
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
    true,
  );
  assert.equal(
    selected.some((asset) => asset.id.startsWith("unreferenced/")),
    false,
  );
});

test("strict Mathematical V1 resolves mixed-case references to canonical public asset casing and order", () => {
  const baseline = productionSizedStrictBundle();
  const expectedIds = curatedAiGraderMathematicalAssetMetadata(baseline).map(
    (asset) => asset.id,
  );
  const mixedCase = structuredClone(baseline);
  const canonicalId =
    mixedCase.centeringEvidence.front.measurementOverlayAssetId;
  mixedCase.centeringEvidence.front.measurementOverlayAssetId =
    canonicalId.toUpperCase();
  const parsed = aiGraderReportBundleV03Schema.parse(mixedCase);
  const actualIds = curatedAiGraderMathematicalAssetMetadata(parsed).map(
    (asset) => asset.id,
  );

  assert.deepEqual(actualIds, expectedIds);
  assert.equal(actualIds.includes(canonicalId), true);
  assert.equal(actualIds.includes(canonicalId.toUpperCase()), false);
});

test("asset loader aborts sibling work, drains every worker, and leaks no URL after first failure", async () => {
  const bundle = productionSizedStrictBundle();
  const selected = curatedAiGraderMathematicalAssetMetadata(bundle);
  const fetched: string[] = [];
  const created: string[] = [];
  const revoked: string[] = [];
  let releaseSiblings!: () => void;
  const siblingsHeld = new Promise<void>((resolve) => {
    releaseSiblings = resolve;
  });
  let rejected = false;
  const loading = loadAiGraderLocalMathematicalAssets({
    bundle,
    reportId: bundle.reportId,
    fetchAsset: async ({ reportId, assetId }) => {
      const index = fetched.length;
      fetched.push(assetId);
      if (index === 0) throw new Error("deterministic first asset failure");
      await siblingsHeld;
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
      createObjectUrl: () => {
        const url = `blob:race-${created.length + 1}`;
        created.push(url);
        return url;
      },
      revokeObjectUrl: (url) => revoked.push(url),
    },
  }).catch((error) => {
    rejected = true;
    throw error;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fetched.length, 4, "only the four admitted workers may begin");
  assert.equal(rejected, false, "the loader must wait for held siblings to settle");
  releaseSiblings();
  await assert.rejects(loading, /deterministic first asset failure/);
  assert.equal(fetched.length, 4, "no post-failure worker may fetch another asset");
  assert.deepEqual(created, []);
  assert.deepEqual(revoked, []);
  assert.ok(selected.length > fetched.length);
});

test("asset loader enforces a four-worker bound", async () => {
  const bundle = productionSizedStrictBundle();
  let active = 0;
  let maximum = 0;
  await loadAiGraderLocalMathematicalAssets({
    bundle,
    reportId: bundle.reportId,
    fetchAsset: async ({ reportId, assetId }) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
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
      createObjectUrl: (() => {
        let index = 0;
        return () => `blob:bounded-${++index}`;
      })(),
      revokeObjectUrl: () => undefined,
    },
  });
  assert.equal(maximum, 4);
});

test("report lifecycle revokes ready assets and aborts in-flight work on exact identity change", () => {
  const revoked: string[] = [];
  const lifecycle = new AiGraderLocalReportLifecycle((assets) => {
    revoked.push(...assets.objectUrls);
  });
  const owner = new AiGraderLocalReportBusyOwner();
  const firstClaim = owner.claim();
  const first = lifecycle.begin("queue-a:session-a:report-a", firstClaim).load;
  const firstAssets = {
    reportId: "report-a",
    assetIds: ["front/a.png"],
    urlsByAssetId: { "front/a.png": "blob:a" },
    objectUrls: ["blob:a"],
  };
  assert.equal(lifecycle.adoptAssets(first, firstAssets), true);
  lifecycle.finish(first);
  const readySwitch = lifecycle.switchIdentity("queue-b:session-b:report-b");
  assert.equal(readySwitch.changed, true);
  assert.deepEqual(revoked, ["blob:a"]);

  const secondClaim = owner.claim();
  const second = lifecycle.begin(
    "queue-b:session-b:report-b",
    secondClaim,
  ).load;
  const inFlightSwitch = lifecycle.switchIdentity(
    "queue-c:session-c:report-c",
  );
  assert.equal(second.abortController.signal.aborted, true);
  assert.equal(inFlightSwitch.retiredClaim, secondClaim);
  assert.equal(
    lifecycle.isCurrent(second, "queue-b:session-b:report-b"),
    false,
  );
});

test("open-report busy ownership cannot clear a newer claim or a different busy operation", () => {
  const owner = new AiGraderLocalReportBusyOwner();
  const first = owner.claim();
  const second = owner.claim();
  assert.equal(owner.release(first, "open-report"), "open-report");
  assert.equal(owner.release(second, "publish"), "publish");
  const third = owner.claim();
  assert.equal(owner.release(third, "open-report"), null);
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

test("one token-gated Mathematical hydration response preserves exact identity and selected bytes", async () => {
  const bundle = productionSizedStrictBundle();
  const selectedAsset = curatedAiGraderMathematicalAssetMetadata(bundle)[0];
  const bodyBase64 = Buffer.alloc(1000).toString("base64");
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};
  let requestToken = "";
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requestToken = new Headers(init?.headers).get("x-ai-grader-station-token") ?? "";
    return Response.json({
      ok: true,
      result: {
        queueItemId: "queue-1",
        gradingSessionId: "session-1",
        reportId: bundle.reportId,
        bundle,
        assets: [{
          reportId: bundle.reportId,
          assetId: selectedAsset.id,
          contentType: selectedAsset.contentType,
          byteSize: 1000,
          checksumSha256: SHA,
          bodyBase64,
        }],
      },
    });
  };
  const hydrated = await fetchAiGraderStationMathematicalReportHydration({
    baseUrl: "http://127.0.0.1:47652",
    stationToken: "private-station-token",
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    reportId: bundle.reportId,
    assetIds: [selectedAsset.id],
  }, fetchImpl as typeof fetch);

  assert.equal(
    requestUrl,
    `http://127.0.0.1:47652/reports/${bundle.reportId}/mathematical-hydration`,
  );
  assert.equal(requestToken, "private-station-token");
  assert.deepEqual(requestBody, {
    queueItemId: "queue-1",
    gradingSessionId: "session-1",
    assetIds: [selectedAsset.id],
  });
  assert.equal(hydrated.assets[0].bytes.byteLength, 1000);
  assert.equal(hydrated.bundle.reportId, bundle.reportId);
  assert.equal("stationToken" in hydrated, false);
});
