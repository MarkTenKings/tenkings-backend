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

test("public report API serializes only public asset metadata after validating nested legacy storage locators", async () => {
  const storedBundle = {
    schemaVersion: "ai-grader-report-bundle-v0.1",
    reportId: "storage-boundary-report",
    generatedAt: "2026-07-13T12:00:00.000Z",
    certifiedClaim: false,
    reportBundleStorageKey: "private-report-bundle",
    storageKeyPrefix: "private-storage-prefix",
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
    rawStorageReference: "ai-grader/reports/storage-boundary-report/assets/private-hidden-object.png",
    publicAssets: [{
      id: "report/front/normalized.png",
      kind: "report-image",
      fileName: "normalized.png",
      contentType: "image/png",
      storageKey: "ai-grader/reports/storage-boundary-report/assets/001-normalized.png",
      checksumSha256: "d".repeat(64),
      byteSize: 1200 * 1680,
      side: "front",
      evidenceRole: "normalized_card",
    }],
    productionRelease: {
      productionReleaseStorageKey: "private-production-release",
      label: {
        labelDataStorageKey: "private-label-data",
        labelPreviewKey: "private-label-preview",
        nested: { privateObjectReference: "private-label-object" },
      },
      slabbedPhotoContract: {
        photos: [{
          storageKey: "private-slabbed-photo",
          objectUri: "s3://private-bucket/slabbed-front.png",
          publicUrl: "https://collect.tenkings.co/storage/ai-grader/reports/storage-boundary-report/slabbed/front.png",
        }],
      },
      ebayCompsContract: {
        status: "completed",
        compsRefs: [{
          source: "ebay_sold",
          ebayListingId: "public-ebay-listing-123",
          publicUrl: "https://www.ebay.com/itm/public-ebay-listing-123",
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
      defectFindings: [],
    },
  };
  const persistedBeforeRead = JSON.parse(JSON.stringify(storedBundle));
  const handler = createAiGraderPublicReportApiHandler({
    env: { AI_GRADER_PUBLIC_REPORT_DB_ENABLED: "true" },
    async readPublishedBundle() {
      return storedBundle;
    },
  });
  const { state, response } = mockResponse();
  await handler({ method: "GET", query: { reportId: "storage-boundary-report" } } as any, response as any);

  assert.equal(state.statusCode, 200);
  const serialized = JSON.stringify(state.body);
  assert.deepEqual(publicStorageLocatorPaths(JSON.parse(serialized)), []);
  assert.doesNotMatch(serialized, /private-/);
  assert.doesNotMatch(serialized, /cHJpdmF0ZS1vcGFxdWUtcGF5bG9hZA|cHJpdmF0ZS1lbmNvZGVkLWltYWdl/);
  assert.equal(Object.hasOwn(state.body.bundle.publicAssets[0], "storageKey"), false);
  assert.equal(
    state.body.bundle.publicAssets[0].publicUrl,
    "/storage/ai-grader/reports/storage-boundary-report/assets/001-normalized.png",
  );
  assert.equal(
    state.body.bundle.productionRelease.ebayCompsContract.compsRefs[0].ebayListingId,
    "public-ebay-listing-123",
  );
  assert.deepEqual(storedBundle, persistedBeforeRead, "the API reader does not mutate the persisted package");
});

test("public report API recursively projects v0.2 payloads after validating storage-backed evidence", async () => {
  const storedBundle = {
    schemaVersion: "ai-grader-report-bundle-v0.2",
    reportId: "v02-storage-boundary-report",
    generatedAt: "2026-07-13T12:00:00.000Z",
    certifiedClaim: false,
    cardIdentity: { title: "V0.2 Storage Boundary Card", sideCount: 2 },
    productionRelease: {
      finalGrade: {
        overall: 8.4,
        elements: {},
        confidence: { score: 0.61, band: "medium" },
      },
      label: {
        certId: "V02-STORAGE-BOUNDARY",
        labelGradeText: "8.4",
        publicReportUrl: "/ai-grader/reports/v02-storage-boundary-report",
        qrPayloadUrl: "/ai-grader/reports/v02-storage-boundary-report",
      },
      publication: { publicReportUrl: "/ai-grader/reports/v02-storage-boundary-report" },
    },
    defectFindings: [],
    publicAssets: [{
      id: "report/front/normalized.png",
      kind: "report-image",
      fileName: "normalized.png",
      contentType: "image/png",
      storageKey: "ai-grader/reports/v02-storage-boundary-report/assets/001-normalized.png",
      checksumSha256: "e".repeat(64),
      byteSize: 1200 * 1680,
      side: "front",
      evidenceRole: "normalized_card",
      widthPx: 1200,
      heightPx: 1680,
    }],
    geometry: {
      front: {
        storageKey: "private-v02-geometry-key",
        artifactKeys: ["private-v02-artifact-key"],
        signedUrl: "https://private-storage.example.test/v02?signature=private",
        nested: {
          imageBase64: "private-v02-image-body",
          providerPrivateIdentifier: "private-v02-provider-id",
          serpApiSearchId: "private-v02-serp-search-id",
          googleVisionOperationName: "private-v02-google-vision-operation",
          providerId: "private-v02-provider-id-2",
          bridgeEndpoint: "https://private-v02-bridge.example.test/session",
          headers: { cookie: "private-v02-cookie" },
          opaquePayload: "cHJpdmF0ZS12MDItb3BhcXVlLXBheWxvYWQ=",
          encodedImage: "cHJpdmF0ZS12MDItZW5jb2RlZC1pbWFnZQ==",
          rawStorageReference: "ai-grader/reports/v02-storage-boundary-report/assets/private-v02-hidden-object.png",
          headerMap: { cookie: "private-v02-header-cookie" },
          jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.private-signature",
          openAiResponseHandle: "private-v02-openai-handle",
          serpApiSearchReference: "private-v02-serp-reference",
          source: "s3://private-v02-bucket/hidden.png",
          objectHandle: "gs://private-v02-bucket/hidden.png",
          sourceKey: "ai-grader/reports/v02-storage-boundary-report/assets/private-v02-source-key.png",
          sourceUrl: "https://private-v02-bridge.example.test/status",
          opaqueSource: "ai-grader/reports/v02-storage-boundary-report/report-bundle.json",
          reference: "ai-grader/reports/v02-storage-boundary-report/production-release.json",
          unixOpaque: "/etc/private-v02-report.json",
          opaqueEnvironmentValues: {
            first: "/var/private-v02-report.json",
            second: "/usr/private-v02-report.json",
            third: "/proc/private-v02-report.json",
            fourth: "/dev/private-v02-report.json",
            fifth: "/bin/private-v02-report.json",
          },
          opaqueTransportValues: {
            first: "Bearer synthetic-v02-bearer-value",
            second: "Basic c3ludGhldGljLXYwMi1iYXNpYy12YWx1ZQ==",
            third: "x-api-key: synthetic-v02-api-key-value",
          },
          imageContent: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
          opaqueData: "cHJpdmF0ZS12MDItb3BhcXVlLWVuY29kZWQtYmluYXJ5LXBheWxvYWQtZm9yLXJlYWRib3VuZGFyeS10ZXN0aW5nLW9ubHk=",
        },
      },
    },
  };
  const persistedBeforeRead = JSON.parse(JSON.stringify(storedBundle));
  const handler = createAiGraderPublicReportApiHandler({
    env: { AI_GRADER_PUBLIC_REPORT_DB_ENABLED: "true" },
    async readPublishedBundle() {
      return storedBundle;
    },
  });
  const { state, response } = mockResponse();
  await handler({ method: "GET", query: { reportId: "v02-storage-boundary-report" } } as any, response as any);

  assert.equal(state.statusCode, 200);
  const serialized = JSON.stringify(state.body);
  assert.deepEqual(publicStorageLocatorPaths(JSON.parse(serialized)), []);
  assert.doesNotMatch(serialized, /private-v02-/);
  assert.doesNotMatch(serialized, /cHJpdmF0ZS12MDItb3BhcXVlLXBheWxvYWQ|cHJpdmF0ZS12MDItZW5jb2RlZC1pbWFnZQ|private-v02-header-cookie|private-v02-openai-handle|private-v02-serp-reference|private-v02-bucket|private-v02-source-key|private-v02-bridge|report-bundle\.json|production-release\.json|\/(?:etc|var|usr|proc|dev|bin)\/private-v02|synthetic-v02-(?:bearer|api-key)-value|c3ludGhldGljLXYwMi1iYXNpYy12YWx1ZQ==|iVBORw0KGgo|cHJpdmF0ZS12MDItb3BhcXVlLWVuY29kZWQ/);
  assert.equal(Object.hasOwn(state.body.bundle.publicAssets[0], "storageKey"), false);
  assert.equal(
    state.body.bundle.publicAssets[0].publicUrl,
    "/storage/ai-grader/reports/v02-storage-boundary-report/assets/001-normalized.png",
  );
  assert.deepEqual(storedBundle, persistedBeforeRead, "v0.2 source data remains unchanged by the public API projection");
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
