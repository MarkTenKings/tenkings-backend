const assert = require("node:assert/strict");
const { before, beforeEach, after, test } = require("node:test");
const Module = require("node:module");
const sharp = require("sharp");
const { Prisma } = require("@prisma/client");

// Only the database and storage boundaries are replaced. Queue, request streaming,
// embedding validation, image normalization/crops and quality scoring run real code.
const rows = new Map();
let dbCalls = 0;
let calls = [];
let uploads = [];
let provider;
let onUpload;
let fixture;
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const validEmbeddings = [{ cropUrl: "https://synthetic.invalid/crop.jpg", vector: [0.1, -0.2, 0.3] }];
const remoteCrops = ["https://synthetic.invalid/crop.jpg"];

function matches(row, where) {
  if (where.AND && !where.AND.every((part) => matches(row, part))) return false;
  if (where.OR && !where.OR.some((part) => matches(row, part))) return false;
  if (typeof where.id === "string" && row.id !== where.id) return false;
  if (where.id?.notIn?.includes(row.id)) return false;
  if (where.qaStatus !== undefined && row.qaStatus !== where.qaStatus) return false;
  if (where.ownedStatus !== undefined && row.ownedStatus !== where.ownedStatus) return false;
  if (where.rawImageUrl !== undefined && row.rawImageUrl !== where.rawImageUrl) return false;
  if (where.qualityScore === null && row.qualityScore !== null) return false;
  if (where.updatedAt instanceof Date && +row.updatedAt !== +where.updatedAt) return false;
  if (where.updatedAt?.lte && +row.updatedAt > +where.updatedAt.lte) return false;
  if (where.cropEmbeddings) {
    const expected = where.cropEmbeddings.equals;
    if (expected === Prisma.JsonNull || expected === Prisma.DbNull) return row.cropEmbeddings === null;
    return JSON.stringify(row.cropEmbeddings) === JSON.stringify(expected);
  }
  return true;
}
const prisma = { cardVariantReferenceImage: {
  async findMany({ where, take }) {
    dbCalls++;
    return [...rows.values()].filter((row) => matches(row, where))
      .sort((a, b) => +a.updatedAt - +b.updatedAt || a.id.localeCompare(b.id))
      .slice(0, take).map(({ id }) => ({ id }));
  },
  async findUnique({ where }) {
    dbCalls++;
    return rows.has(where.id) ? structuredClone(rows.get(where.id)) : null;
  },
  async updateMany({ where, data }) {
    dbCalls++;
    let count = 0;
    for (const row of rows.values()) {
      if (matches(row, where)) {
        Object.assign(row, structuredClone(data));
        count++;
      }
    }
    return { count };
  },
} };
function loadQueue() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, ...rest) {
    if (request === "@tenkings/database") return { prisma };
    if (request === "../storage/spaces") return { createSpacesUploader: () => async (buffer, key, contentType, signal) => {
      uploads.push({ buffer, key, contentType, signal });
      if (onUpload) await onUpload(signal);
      return { key, url: `https://synthetic.invalid/${key}` };
    } };
    return originalLoad.call(this, request, parent, ...rest);
  };
  try {
    delete require.cache[require.resolve("../dist/reference/queue")];
    return require("../dist/reference/queue");
  } finally {
    Module._load = originalLoad;
  }
}
const { processPendingReferences, processReferenceImage, REFERENCE_RETRY_DELAY_MS } = loadQueue();
const { computeReferenceEmbeddings, hasUsableEmbeddings } = require("../dist/reference/embedding");
function addRow(id, overrides = {}) {
  const row = { id, updatedAt: new Date(Date.now() - REFERENCE_RETRY_DELAY_MS - 60_000), rawImageUrl: `https://synthetic.invalid/${id}.png`, qualityScore: null, cropEmbeddings: null, cropUrls: [], ...overrides };
  rows.set(id, row);
  return row;
}
before(async () => {
  fixture = await sharp({ create: { width: 420, height: 600, channels: 3, background: "#365a7f" } }).png().toBuffer();
});
beforeEach(() => {
  rows.clear(); dbCalls = 0; calls = []; uploads = []; onUpload = undefined;
  process.env.VARIANT_EMBEDDING_URL = "https://synthetic.invalid/embed";
  delete process.env.VARIANT_CORNER_URL;
  provider = () => ({ embeddings: [], cropUrls: [] });
  global.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url) === process.env.VARIANT_EMBEDDING_URL) {
      return Response.json(await provider(JSON.parse(options.body)));
    }
    assert.match(String(url), /^https:\/\/synthetic\.invalid\//, "test must not reach an external service");
    return new Response(fixture);
  };
});
after(() => {
  global.fetch = originalFetch;
  for (const key of ["VARIANT_EMBEDDING_URL", "VARIANT_CORNER_URL"]) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});

test("missing embedding prerequisite performs zero DB, image, provider or storage work", async () => {
  process.env.VARIANT_EMBEDDING_URL = "   ";
  const row = addRow("missing");
  assert.equal(await processPendingReferences(), 0);
  assert.equal(await processReferenceImage(row.id), false);
  assert.deepEqual(await computeReferenceEmbeddings({ imageUrl: row.rawImageUrl, referenceId: row.id }), { embeddings: [], cropUrls: [] });
  assert.equal(dbCalls, 0);
  assert.deepEqual(calls, []);
  assert.deepEqual(uploads, []);
});

test("empty output keeps existing evidence, rotates past eight rows and survives a worker reload", async () => {
  for (let i = 0; i < 9; i++) addRow(String(i), { qualityScore: 0.6, cropUrls: ["existing-crop"] });
  assert.equal(await processPendingReferences(1000), 8);
  assert.equal(await processPendingReferences(), 1);
  assert.equal(await loadQueue().processPendingReferences(), 0);
  assert.equal(calls.length, 9);
  assert.equal(uploads.length, 0);
  for (const row of rows.values()) {
    assert.equal(row.cropEmbeddings, null);
    assert.equal(row.qualityScore, 0.6);
    assert.deepEqual(row.cropUrls, ["existing-crop"]);
    assert.ok(+row.updatedAt > Date.now() - REFERENCE_RETRY_DELAY_MS);
  }
});

test("fresh edits and zero-sized batches do no work; an expired cooldown permits a bounded retry", async () => {
  const row = addRow("fresh", { updatedAt: new Date() });
  assert.equal(await processPendingReferences(0), 0);
  assert.equal(dbCalls, 0);
  assert.equal(await processPendingReferences(), 0);
  row.updatedAt = new Date(Date.now() - REFERENCE_RETRY_DELAY_MS - 1000);
  assert.equal(await processPendingReferences(), 1);
  assert.equal(await processPendingReferences(), 0);
  assert.equal(calls.length, 1);
});

test("trusted and owned references keep priority, then cooldown opens room for the older backlog", async () => {
  const old = new Date(Date.now() - REFERENCE_RETRY_DELAY_MS - 60_000);
  const veryOld = new Date(+old - 60_000);
  addRow("backlog", { updatedAt: veryOld });
  addRow("trusted-newer", { qaStatus: "keep", updatedAt: old });
  addRow("owned-older", { ownedStatus: "owned", updatedAt: new Date(+old - 1000) });
  const attempts = [];
  provider = ({ referenceId }) => { attempts.push(referenceId); return { embeddings: [] }; };
  assert.equal(await processPendingReferences(2), 2);
  assert.deepEqual(attempts, ["owned-older", "trusted-newer"]);
  assert.equal(await processPendingReferences(2), 1);
  assert.deepEqual(attempts, ["owned-older", "trusted-newer", "backlog"]);
  assert.equal(await processPendingReferences(2), 0);
});

test("malformed and empty embedding responses never trigger original downloads or crop uploads", async () => {
  for (const embeddings of [[], null, [{}], [{ cropUrl: "x", vector: [0, 0] }], [{ cropUrl: "x", vector: ["1"] }], Array(17).fill(validEmbeddings[0])]) {
    addRow(String(rows.size));
    provider = () => ({ embeddings, cropUrls: remoteCrops });
    assert.equal(await processPendingReferences(), 1);
  }
  assert.equal(calls.length, 6);
  assert.equal(uploads.length, 0);
  assert.equal(hasUsableEmbeddings([{ cropUrl: "x", vector: [Infinity] }]), false);
  assert.equal(hasUsableEmbeddings([{ cropUrl: "x", vector: Array(8193).fill(1) }]), false);
});

test("a provider failure does not starve a later reference", async () => {
  addRow("a"); addRow("b");
  provider = ({ referenceId }) => {
    if (referenceId === "a") throw new Error("synthetic failure");
    return { embeddings: validEmbeddings, cropUrls: remoteCrops };
  };
  assert.equal(await processPendingReferences(), 2);
  assert.equal(rows.get("a").cropEmbeddings, null);
  assert.ok(rows.get("b").qualityScore !== null);
  assert.deepEqual(rows.get("b").cropEmbeddings, validEmbeddings);
});

test("one original download serves real quality scoring and six independent normalized crops", async () => {
  const row = addRow("success");
  provider = () => ({ embeddings: validEmbeddings });
  assert.equal(await processPendingReferences(), 1);
  assert.equal(calls.filter((url) => url === row.rawImageUrl).length, 1);
  assert.equal(uploads.length, 6);
  assert.equal(row.cropUrls.length, 6);
  assert.ok(row.qualityScore !== null);
  const dimensions = await Promise.all(uploads.map(async ({ buffer, signal }) => {
    assert.ok(signal instanceof AbortSignal);
    const meta = await sharp(buffer).metadata();
    return [meta.width, meta.height];
  }));
  assert.deepEqual(dimensions, [[800, 132], [800, 132], [96, 1100], [96, 1100], [320, 440], [240, 330]]);
  row.updatedAt = new Date(0);
  assert.equal(await processPendingReferences(), 0);
  assert.equal(await processReferenceImage(row.id), false);
  assert.equal(calls.length, 2);
});

test("a complete remote result preserves existing quality without downloading an original", async () => {
  const row = addRow("remote", { qualityScore: 0.81 });
  provider = () => ({ embeddings: validEmbeddings, cropUrls: remoteCrops });
  assert.equal(await processPendingReferences(), 1);
  assert.equal(row.qualityScore, 0.81);
  assert.deepEqual(row.cropUrls, remoteCrops);
  assert.equal(calls.length, 1);
  assert.equal(uploads.length, 0);
});

test("quality-only recovery reuses saved embeddings and never regenerates crops", async () => {
  const row = addRow("quality", { cropEmbeddings: validEmbeddings, cropUrls: remoteCrops });
  assert.equal(await processPendingReferences(), 1);
  assert.deepEqual(calls, [row.rawImageUrl]);
  assert.equal(uploads.length, 0);
  assert.ok(row.qualityScore !== null);
  assert.deepEqual(row.cropEmbeddings, validEmbeddings);
});

test("two competing workers make only one provider attempt", async () => {
  const row = addRow("contended");
  const result = await Promise.all([processReferenceImage(row.id), processReferenceImage(row.id)]);
  assert.deepEqual(result.sort(), [false, true]);
  assert.equal(calls.length, 1);
});

test("a reference edited while the provider runs is not overwritten by stale output", async () => {
  const row = addRow("edited", { qualityScore: 0.8 });
  provider = () => {
    row.rawImageUrl = "https://synthetic.invalid/replacement.png";
    row.cropUrls = ["newer-evidence"];
    row.updatedAt = new Date(Date.now() + 1000);
    return { embeddings: validEmbeddings, cropUrls: remoteCrops };
  };
  assert.equal(await processPendingReferences(), 1);
  assert.deepEqual(row.cropUrls, ["newer-evidence"]);
  assert.equal(row.cropEmbeddings, null);
});

test("attempt cancellation reaches crop storage and prevents later uploads", { timeout: 3000 }, async () => {
  const controller = new AbortController();
  provider = () => ({ embeddings: validEmbeddings });
  onUpload = async (signal) => {
    assert.equal(signal, controller.signal);
    controller.abort();
    signal.throwIfAborted();
  };
  await computeReferenceEmbeddings({ imageUrl: "https://synthetic.invalid/abort.png", referenceId: "abort", signal: controller.signal });
  assert.equal(uploads.length, 1);
  assert.ok(controller.signal.aborted);
});
