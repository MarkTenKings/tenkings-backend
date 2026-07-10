import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_AI_GRADER_REPORT_BUNDLE } from "../lib/aiGraderReportBundle";
import {
  aiGraderOcrPrefillReportMetadata,
  findAiGraderNormalizedOcrAssets,
  mergeAiGraderOcrPrefillIntoIdentityDraft,
  runAiGraderOcrPrefillFromLocalReport,
  type AiGraderOcrPrefillResult,
} from "../lib/aiGraderOcrPrefillClient";

const FRONT_HASH = "1".repeat(64);
const BACK_HASH = "2".repeat(64);

function normalizedBundle() {
  return {
    ...SAMPLE_AI_GRADER_REPORT_BUNDLE,
    reportId: "ocr-client-report",
    assets: [
      {
        id: "front/normalized/front-normalized-card.png",
        kind: "image",
        fileName: "front-normalized-card.png",
        contentType: "image/png",
        checksumSha256: FRONT_HASH,
        byteSize: 5,
      },
      {
        id: "back/normalized/back-normalized-card.png",
        kind: "image",
        fileName: "back-normalized-card.png",
        contentType: "image/png",
        checksumSha256: BACK_HASH,
        byteSize: 4,
      },
      {
        id: "front/channel-1.png",
        kind: "image",
        fileName: "channel-1.png",
        contentType: "image/png",
      },
    ],
  };
}

function resultFixture(): AiGraderOcrPrefillResult {
  const known = <T extends string | boolean>(value: T, confidence = 0.9) => ({
    value,
    confidence,
    reviewRequired: confidence < 0.8,
    sources: ["front_ocr"],
  });
  const missing = { value: null, confidence: 0, reviewRequired: true, sources: [] };
  return {
    reportId: "ocr-client-report",
    status: "prefill_ready",
    humanConfirmationRequired: true,
    inventoryMutationPerformed: false,
    publishMutationPerformed: false,
    sourceSides: ["front", "back"],
    fields: {
      category: known("sport"),
      playerName: known("Michael Jordan"),
      cardName: missing,
      year: known("1990"),
      manufacturer: known("SkyBox"),
      productSet: known("1990 SkyBox Basketball"),
      cardNumber: known("41"),
      parallel: known("Base", 0.74),
      insert: missing,
      numbered: missing,
      auto: known(true, 0.84),
      mem: missing,
    },
    reviewFieldNames: ["cardName", "parallel", "insert", "numbered", "mem"],
    provenance: {
      ocrEngine: "google_vision_document_text_detection",
      attributeExtractor: "@tenkings/shared/extractCardAttributes",
      setLookupUsed: true,
      setIdentificationUsed: true,
    },
    warnings: ["Human review required."],
  };
}

test("OCR prefill client selects only normalized front/back report assets", () => {
  const assets = findAiGraderNormalizedOcrAssets(normalizedBundle());
  assert.deepEqual(assets.map((entry) => entry.side), ["front", "back"]);
  assert.equal(assets[0]?.asset.id, "front/normalized/front-normalized-card.png");
  assert.equal(assets[1]?.asset.id, "back/normalized/back-normalized-card.png");
  assert.throws(
    () => findAiGraderNormalizedOcrAssets({ ...normalizedBundle(), assets: [] }),
    /Normalized front\/back card artifacts/
  );
});

test("OCR prefill browser flow fetches local normalized bytes and uploads them directly to storage", async () => {
  const bundle = normalizedBundle();
  const productionBodies: unknown[] = [];
  const directUploads: Array<{ url: string; byteSize: number }> = [];
  const result = resultFixture();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/ocr-prefill-init")) {
      const body = JSON.parse(String(init?.body));
      productionBodies.push(body);
      assert.equal(JSON.stringify(body).includes("bodyBase64"), false);
      assert.equal(JSON.stringify(body).includes("data:image"), false);
      assert.deepEqual(body.images.map((image: any) => image.side), ["front", "back"]);
      const images = body.images.map((image: any) => ({
        ...image,
        storageKey: `ai-grader/reports/ocr-client-report/ocr-prefill/${image.side}.png`,
      }));
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            reportId: body.reportId,
            uploadSessionId: "aigocr_test",
            humanConfirmationRequired: true,
            uploadPlan: images.map((image: any) => ({
              ...image,
              publicUrl: `https://cdn.tenkings.test/${image.storageKey}`,
              uploadUrl: `https://uploads.tenkings.test/${image.side}`,
              uploadMethod: "PUT",
              uploadHeaders: { "Content-Type": image.mimeType },
            })),
            requiredFinalizeManifest: {
              reportId: body.reportId,
              uploadSessionId: "aigocr_test",
              images,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url.startsWith("https://uploads.tenkings.test/")) {
      assert.equal(init?.method, "PUT");
      assert.ok(init?.body instanceof Blob);
      directUploads.push({ url, byteSize: (init.body as Blob).size });
      return new Response(null, { status: 200 });
    }
    if (url.endsWith("/ocr-prefill-finalize")) {
      const body = JSON.parse(String(init?.body));
      productionBodies.push(body);
      assert.equal(JSON.stringify(body).includes("uploadUrl"), false);
      assert.equal(JSON.stringify(body).includes("publicUrl"), false);
      return new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const response = await runAiGraderOcrPrefillFromLocalReport(
    {
      baseUrl: "http://127.0.0.1:47652",
      stationToken: "browser-local-token",
      reportId: bundle.reportId,
      authHeaders: { Authorization: "Bearer operator-session" },
      bundle,
    },
    {
      fetchImpl,
      async fetchAsset({ assetId }) {
        const front = assetId.startsWith("front/");
        const bytes = new Uint8Array(front ? [1, 2, 3, 4, 5] : [6, 7, 8, 9]).buffer;
        return {
          bytes,
          contentType: "image/png",
          byteSize: bytes.byteLength,
          checksumSha256: front ? FRONT_HASH : BACK_HASH,
        };
      },
      async digestSha256(bytes) {
        return bytes.byteLength === 5 ? FRONT_HASH : BACK_HASH;
      },
    }
  );

  assert.equal(response.humanConfirmationRequired, true);
  assert.equal(response.inventoryMutationPerformed, false);
  assert.equal(response.publishMutationPerformed, false);
  assert.deepEqual(directUploads, [
    { url: "https://uploads.tenkings.test/front", byteSize: 5 },
    { url: "https://uploads.tenkings.test/back", byteSize: 4 },
  ]);
  assert.equal(productionBodies.length, 2);
  assert.equal(JSON.stringify(productionBodies).includes("browser-local-token"), false);
  assert.equal(JSON.stringify(productionBodies).includes("operator-session"), false);
});

test("OCR prefill merge fills empty fields but preserves operator-edited identity", () => {
  const current = {
    category: "tcg" as const,
    playerName: "",
    cardName: "Operator Chosen Name",
    year: "",
    manufacturer: "Operator Brand",
    productSet: "",
    cardNumber: "",
    insert: "",
    parallel: "",
    numbered: "",
    autograph: false,
    memorabilia: false,
  };
  const merged = mergeAiGraderOcrPrefillIntoIdentityDraft({
    current,
    result: resultFixture(),
    operatorEditedFields: new Set<keyof typeof current>(["category", "cardName", "manufacturer"]),
  });

  assert.equal(merged.draft.category, "tcg");
  assert.equal(merged.draft.cardName, "Operator Chosen Name");
  assert.equal(merged.draft.manufacturer, "Operator Brand");
  assert.equal(merged.draft.playerName, "Michael Jordan");
  assert.equal(merged.draft.year, "1990");
  assert.equal(merged.draft.productSet, "1990 SkyBox Basketball");
  assert.equal(merged.draft.cardNumber, "41");
  assert.equal(merged.draft.autograph, true);
  assert.equal(merged.draft.memorabilia, false);
  assert.equal(merged.appliedFields.includes("manufacturer"), false);
});

test("OCR report metadata keeps only the safe finalize contract", () => {
  const unsafeFixture = Object.assign(resultFixture(), {
    uploadUrl: "https://uploads.tenkings.test/private",
    storageKey: "private/normalized-front.png",
    localPath: "C:\\TenKings\\private.png",
  });
  const metadata = aiGraderOcrPrefillReportMetadata(unsafeFixture);
  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes("uploadUrl"), false);
  assert.equal(serialized.includes("storageKey"), false);
  assert.equal(serialized.includes("localPath"), false);
  assert.equal(serialized.includes("uploads.tenkings.test"), false);
  assert.equal(metadata.humanConfirmationRequired, true);
  assert.equal(metadata.publishMutationPerformed, false);
});
