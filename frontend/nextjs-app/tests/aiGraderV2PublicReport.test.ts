import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { GetServerSidePropsContext } from "next";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;

const reportModulePromise = import("../pages/ai-grader-v2/reports/[slug]");

const grade = {
  front: {
    centering: { leftRightBalance: [50, 50], topBottomBalance: [50, 50], score: 10 },
    corners: { weightedDamagePercent: 0, score: 10 },
    edges: { weightedDamagePercent: 0, score: 10 },
    surface: { weightedDamagePercent: 0.4, score: 9 },
  },
  back: {
    centering: { leftRightBalance: [52, 48], topBottomBalance: [51, 49], score: 10 },
    corners: { weightedDamagePercent: 0, score: 10 },
    edges: { weightedDamagePercent: 0, score: 10 },
    surface: { weightedDamagePercent: 0, score: 10 },
  },
  subgrades: { centering: 10, corners: 10, edges: 10, surface: 9.3 },
  overall: { rawGrade: 9.825, displayGrade: 9.8 },
};

const defect = {
  id: "front-surface-1",
  side: "FRONT",
  zone: "SURFACE",
  defectType: "LIGHT_SCRATCH_SCUFF",
  confidence: 0.92,
  canonicalContour: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.3 }],
  sourceViewId: "DIRECTIONAL",
  supportingViewIds: ["MICRO_DEFECT"],
  reviewResult: "ACCEPTED",
  measurement: {
    widthMm: 1.2,
    heightMm: 0.4,
    areaMm2: 0.32,
    zonePercent: 0.4,
    multiplier: 1,
    weightedAreaMm2: 0.32,
    subgradeEffect: 0.7,
  },
};

function persisted(workflowState = "COMPLETED") {
  const side = (name: string) => ({
    originalStorageKey: `${name}/raw.webp`,
    rectifiedStorageKey: `${name}/rectified.webp`,
    viewStorageKeys: {
      NORMALIZED: `${name}/normalized.webp`,
      MICRO_DEFECT: `${name}/micro.webp`,
      DIRECTIONAL: `${name}/directional.webp`,
    },
    uploadUrl: "https://storage.example/private-upload",
  });
  return {
    id: "private-session-id",
    createdByUserId: "private-admin-id",
    workflowState,
    cardProfile: "POKEMON",
    identity: { cardName: "Charizard", year: "2025", productSet: "Journey Together", internalNote: "private" },
    capture: { front: side("front"), back: side("back"), helperToken: "private" },
    reviewedDefects: [
      defect,
      { ...defect, id: "removed", reviewResult: "REMOVED" },
      { ...defect, id: "unreviewed", reviewResult: "UNREVIEWED" },
      { ...defect, id: "unknown", reviewResult: "UNKNOWN" },
    ],
    gradeReport: grade,
    slabFrontKey: "slab/front.jpg",
    slabBackKey: null,
  };
}

test("maps only a completed session into public identity, reviewed evidence, grade, and stable image keys", async () => {
  const reportModule = await reportModulePromise;
  const source = reportModule.mapCompletedSpeedsterSession(persisted());
  assert.ok(source);
  assert.deepEqual(source.identity, {
    cardProfile: "POKEMON",
    cardName: "Charizard",
    year: "2025",
    productSet: "Journey Together",
  });
  assert.equal(source.defects.length, 1);
  assert.equal(source.defects[0].id, "front-surface-1");
  assert.equal(source.grade.overall.displayGrade, 9.8);
  assert.equal(source.sourceKeys.FRONT.master, "front/rectified.webp");
  assert.equal(source.slabKeys.front, "slab/front.jpg");
  assert.equal(JSON.stringify(source).includes("private-admin-id"), false);
  assert.equal(JSON.stringify(source).includes("private-upload"), false);
});

test("returns no public source for an incomplete workflow", async () => {
  const reportModule = await reportModulePromise;
  assert.equal(reportModule.mapCompletedSpeedsterSession(persisted("CAPTURED")), null);
});

test("materializes short-lived image URLs without returning object keys or private session fields", async () => {
  const reportModule = await reportModulePromise;
  const source = reportModule.mapCompletedSpeedsterSession(persisted());
  assert.ok(source);
  const props = await reportModule.materializeSpeedsterReport(source, async (key) => `https://read.example/${encodeURIComponent(key)}`);
  assert.match(props.imageUrls.FRONT.views.DIRECTIONAL, /^https:\/\/read\.example\//);
  assert.match(props.slabImageUrls.front ?? "", /^https:\/\/read\.example\//);
  assert.equal(props.slabImageUrls.back, null);
  const serialized = JSON.stringify(props);
  assert.equal(serialized.includes("StorageKey"), false);
  assert.equal(serialized.includes("private-session-id"), false);
  assert.equal(serialized.includes("private-admin-id"), false);
  assert.equal(serialized.includes("private-upload"), false);
});

test("SSR returns notFound for absent or incomplete reports and public props for a completed report", async () => {
  const reportModule = await reportModulePromise;
  const headers: Record<string, string> = {};
  const context = (slug: string): GetServerSidePropsContext => ({
    params: { slug },
    req: {} as GetServerSidePropsContext["req"],
    res: { setHeader: (name: string, value: string) => { headers[name] = value; } } as unknown as GetServerSidePropsContext["res"],
    query: {},
    resolvedUrl: `/ai-grader-v2/reports/${slug}`,
  });
  const missing = reportModule.createSpeedsterReportGetServerSideProps({
    async findCompletedSession() { return null; },
    async presign(key: string) { return `https://read.example/${key}`; },
  });
  assert.deepEqual(await missing(context("missing-card")), { notFound: true });

  const complete = reportModule.createSpeedsterReportGetServerSideProps({
    async findCompletedSession(slug: string) { assert.equal(slug, "charizard-2025"); return persisted(); },
    async presign(key: string) { return `https://read.example/${key}`; },
  });
  const result = await complete(context("charizard-2025"));
  assert.ok("props" in result);
  assert.equal(headers["Cache-Control"], "private, no-store");
});
