import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prisma, SetDatasetType } from "@tenkings/database";
import type { NextApiRequest, NextApiResponse } from "next";
import { buildTaxonomyIngestRows, createDraftVersionPayload, normalizeDraftRows } from "../lib/server/setOpsDrafts";
import type { TaxonomyAdapterParams } from "../lib/server/taxonomyV2AdapterTypes";
import { buildPilotChecklistTaxonomyAdapterOutput, canRunPilotChecklistAdapter, validatePilotChecklistOriginalInput } from "../lib/server/taxonomyV2PilotChecklistAdapter";
import { canRunToppsAdapter } from "../lib/server/taxonomyV2ToppsAdapter";

type RecordValue = Record<string, unknown>;
type RequestDraft = {
  setId: string;
  datasetType: SetDatasetType;
  sourceUrl: string;
  sourceProvider: string;
  parserVersion: string;
  sourceFetchMeta: RecordValue;
  rawPayload: unknown;
};
const packet = JSON.parse(readFileSync(new URL("../../../docs/plans/catalog-pilot-20260916/import-preparation.unreviewed.json", import.meta.url), "utf8")) as {
  requests: Array<{ id: string; requestDraft: RequestDraft }>;
};

function input(id = "sports-checklist") {
  const request = structuredClone(packet.requests.find((entry) => entry.id === id)!.requestDraft);
  const normalized = normalizeDraftRows({ datasetType: request.datasetType, fallbackSetId: request.setId, rawPayload: request.rawPayload });
  const params: TaxonomyAdapterParams = {
    setId: request.setId,
    datasetType: request.datasetType,
    sourceUrl: request.sourceUrl,
    parserVersion: request.parserVersion,
    parseSummary: { sourceProvider: request.sourceProvider, sourceFetchMeta: request.sourceFetchMeta },
    rawPayload: buildTaxonomyIngestRows(normalized.rows),
  };
  return { request, normalized, params };
}

function metadata(params: TaxonomyAdapterParams) {
  return params.parseSummary!.sourceFetchMeta as RecordValue;
}

function rows(params: TaxonomyAdapterParams) {
  return params.rawPayload as RecordValue[];
}

test("actual pinned sports draft composes through normalization and projection into unreviewed identities only", () => {
  const { request, normalized, params } = input();
  assert.equal(validatePilotChecklistOriginalInput({ ...params, rawPayload: request.rawPayload }), true);
  assert.equal(normalized.summary.blockingErrorCount, 0);
  const before = JSON.stringify(params);
  const priorHash = createDraftVersionPayload({ setId: request.setId, datasetType: request.datasetType, rows: normalized.rows }).versionHash;
  assert.equal(canRunPilotChecklistAdapter(params), true);
  assert.equal(canRunToppsAdapter(params), false);
  const output = buildPilotChecklistTaxonomyAdapterOutput(params);
  assert.equal(output.sourceKind, "OFFICIAL_CHECKLIST");
  assert.equal(output.artifactType, "CHECKLIST");
  assert.deepEqual(output.programs.map((program) => [program.label, program.codePrefix, program.programClass]), [["THE BIG KAHUNA", null, null]]);
  assert.deepEqual(output.cards.map((card) => [card.cardNumber, card.playerName]), [
    ["TBK-1", "Caleb Williams"], ["TBK-2", "Drake Maye"], ["TBK-3", "JJ McCarthy"],
  ]);
  assert.deepEqual([output.variations, output.parallels, output.scopes, output.oddsRows], [[], [], [], []]);
  const sourceMetadata = output.metadata as RecordValue;
  assert.equal(sourceMetadata.authority, "unreviewed_source_transcription");
  assert.equal(sourceMetadata.sourcePinMatched, true);
  for (const field of ["sourceBytesVerifiedByAdapter", "transcriptionVerified", "rightsVerified", "humanReviewed"]) {
    assert.equal(sourceMetadata[field], false);
  }
  assert.deepEqual(sourceMetadata.sourceFetchMeta, request.sourceFetchMeta);
  assert.deepEqual(output.cards.map((card) => card.metadata), rows(params).map((row) => row.metadataJson));
  assert.equal(JSON.stringify(params), before);
  assert.equal(createDraftVersionPayload({ setId: request.setId, datasetType: request.datasetType, rows: normalized.rows }).versionHash, priorHash);
});

test("source URL, hash, bytes, provider, source ID, set binding and worksheet type must all match", () => {
  const mutations: Array<(params: TaxonomyAdapterParams) => void> = [
    (params) => { params.sourceUrl = `${params.sourceUrl}?copy=1`; },
    (params) => { params.sourceUrl = "https://example.invalid/copied-checklist.pdf"; },
    (params) => { metadata(params).url = "https://example.invalid/copied-checklist.pdf"; },
    (params) => { metadata(params).sha256 = "a".repeat(64); },
    (params) => { delete metadata(params).sha256; },
    (params) => { metadata(params).byteSize = 529103; },
    (params) => { metadata(params).byteSize = "529104"; },
    (params) => { metadata(params).sourceId = "sports-odds-round2"; },
    (params) => { params.parseSummary!.sourceProvider = "TRUSTED_SECONDARY"; },
    (params) => { delete params.parseSummary!.sourceFetchMeta; },
    (params) => { params.parseSummary!.sourceKind = "TRUSTED_SECONDARY"; },
    (params) => { metadata(params).sourceKind = "TRUSTED_SECONDARY"; },
    (params) => { metadata(params).setId = "another-set"; },
    (params) => { params.setId = "2023 Bowman University Chrome Football"; },
    (params) => { params.datasetType = SetDatasetType.PARALLEL_DB; },
  ];
  for (const mutate of mutations) {
    const { params } = input();
    mutate(params);
    assert.equal(canRunPilotChecklistAdapter(params), false);
    assert.throws(() => buildPilotChecklistTaxonomyAdapterOutput(params), /pinned checklist source.*canonical set binding/);
  }
});

test("the genuinely pinned Pokémon source stays disabled until its canonical set is reconciled", () => {
  const { params } = input("pokemon-checklist");
  for (const guessedSetId of [params.setId, "Black & White-Legendary Treasures", "2013_Pokemon_Legendary_Treasures"]) {
    params.setId = guessedSetId;
    assert.equal(canRunPilotChecklistAdapter(params), false);
    assert.throws(() => buildPilotChecklistTaxonomyAdapterOutput(params), /configured canonical set binding/);
  }
});

test("projected numbers and source metadata preserve prefixes, zeroes and denominators without printing inference", () => {
  const { params } = input();
  // Synthetic number variations exercise normalization, not new manufacturer facts.
  const numbers = ["TBK-002", "0006", "RC01", "006/113", "RC01/RC25"];
  const original = rows(params)[0];
  params.rawPayload = numbers.map((cardNumber) => ({
    ...structuredClone(original), cardNumber,
    metadataJson: { ...(original.metadataJson as RecordValue), printedNumber: cardNumber, literalMarkers: ["synthetic marker"], unknown: null },
    parallel: "must not become a printing", serial: "/25", odds: "1:99", format: "must not become a scope",
  }));
  const before = JSON.stringify(params);
  const output = buildPilotChecklistTaxonomyAdapterOutput(params);
  assert.deepEqual(output.cards.map((card) => card.cardNumber), numbers);
  assert.deepEqual(output.cards.map((card) => card.metadata), rows(params).map((row) => row.metadataJson));
  assert.deepEqual([output.variations, output.parallels, output.scopes, output.oddsRows], [[], [], [], []]);
  assert.equal(JSON.stringify(params), before);
});

test("malformed or conflicting later rows fail the entire adapter and exact duplicate identities coalesce", () => {
  const { params } = input();
  const first = rows(params)[0];
  params.rawPayload = [...rows(params), structuredClone(first)];
  assert.equal(buildPilotChecklistTaxonomyAdapterOutput(params).cards.length, 3);
  const invalidRows: RecordValue[] = [
    { ...first, metadataJson: null },
    { ...first, sourceUrl: "https://example.invalid/secondary.pdf" },
    { ...first, metadataJson: { ...(first.metadataJson as RecordValue), sourceSha256: "b".repeat(64) } },
    { ...first, metadataJson: { ...(first.metadataJson as RecordValue), sourcePage: 19 } },
    { ...first, metadataJson: { ...(first.metadataJson as RecordValue), sourceKind: "TRUSTED_SECONDARY" } },
    { ...first, cardNumber: "" },
    { ...first, cardNumber: "ALL" },
    { ...first, programLabel: "" },
    { ...first, playerName: "" },
    { ...first, playerName: "Conflicting name", playerSeed: "Conflicting name" },
    { ...first, metadataJson: { ...(first.metadataJson as RecordValue), conflictingNote: "different transcription" } },
  ];
  for (const invalid of invalidRows) {
    const candidate = input().params;
    candidate.rawPayload = [...rows(candidate), invalid];
    const before = JSON.stringify(candidate);
    assert.throws(() => buildPilotChecklistTaxonomyAdapterOutput(candidate), /Checklist/);
    assert.equal(JSON.stringify(candidate), before);
  }
  for (const rawPayload of [[], Array(1001).fill(first), { rows: [first] }]) {
    assert.throws(() => buildPilotChecklistTaxonomyAdapterOutput({ ...params, rawPayload }), /between 1 and 1000 projected rows/);
  }
});

function originalCards(request: RequestDraft): RecordValue[] {
  const programs = (request.rawPayload as { programs: Array<{ cards: RecordValue[] }> }).programs;
  return programs[0].cards;
}

test("original-row validation catches source, marker and rookie conflicts that legacy deduplication erases", () => {
  const mutations: Array<(card: RecordValue) => void> = [
    (card) => { (card.metadata as RecordValue).sourceSha256 = "f".repeat(64); },
    (card) => { (card.metadata as RecordValue).sourcePage = 11; },
    (card) => { (card.metadata as RecordValue).literalMarkers = ["unsupported conflicting marker"]; },
    (card) => { card.isRookie = true; },
  ];
  for (const mutate of mutations) {
    const { request, params } = input();
    const duplicate = structuredClone(originalCards(request)[0]);
    mutate(duplicate);
    originalCards(request).push(duplicate);
    // Reproduce the former integration failure with the actual nested draft.
    const lossy = normalizeDraftRows({ datasetType: request.datasetType, fallbackSetId: request.setId, rawPayload: request.rawPayload });
    assert.equal(lossy.rows.length, 3);
    assert.equal(buildPilotChecklistTaxonomyAdapterOutput({ ...params, rawPayload: buildTaxonomyIngestRows(lossy.rows) }).cards.length, 3);
    let writerCalls = 0;
    const before = JSON.stringify(request.rawPayload);
    assert.throws(() => {
      validatePilotChecklistOriginalInput({ ...params, rawPayload: request.rawPayload });
      const normalized = normalizeDraftRows({ datasetType: request.datasetType, fallbackSetId: request.setId, rawPayload: request.rawPayload });
      buildPilotChecklistTaxonomyAdapterOutput({ ...params, rawPayload: buildTaxonomyIngestRows(normalized.rows) });
      writerCalls += 1;
    }, /Checklist/);
    assert.equal(writerCalls, 0);
    assert.equal(JSON.stringify(request.rawPayload), before);
  }
});

test("strict original shapes reject malformed or blocked rows and leave unrelated legacy inputs untouched", () => {
  const { request, params } = input();
  const raw = request.rawPayload as { programs: Array<{ cards: RecordValue[] }> };
  const invalid = structuredClone(originalCards(request)[0]);
  invalid.playerName = "";
  raw.programs[0].cards.push(invalid);
  const normalized = normalizeDraftRows({ datasetType: request.datasetType, fallbackSetId: request.setId, rawPayload: raw });
  assert.ok(normalized.summary.blockingErrorCount > 0);
  assert.equal(buildTaxonomyIngestRows(normalized.rows).length, 3);
  assert.throws(() => validatePilotChecklistOriginalInput({ ...params, rawPayload: raw }), /Checklist/);
  for (const malformed of [
    { rows: originalCards(request) },
    { ...(request.rawPayload as RecordValue), ignoredRows: [{ sourceSha256: "invalid" }] },
    { ...(request.rawPayload as RecordValue), programs: [null] },
    { ...(request.rawPayload as RecordValue), programs: [{ label: "THE BIG KAHUNA", cards: [] }] },
    { ...(request.rawPayload as RecordValue), programs: [{ label: "THE BIG KAHUNA", cards: [null] }] },
  ]) assert.throws(() => validatePilotChecklistOriginalInput({ ...params, rawPayload: malformed }), /Checklist/);
  const clean = input();
  const flat = rows(clean.params).map((row) => ({ setId: row.setId, sourceUrl: row.sourceUrl, programLabel: row.programLabel,
    cardNumber: row.cardNumber, playerName: row.playerName, team: row.team, isRookie: row.isRookie, metadataJson: row.metadataJson }));
  assert.equal(validatePilotChecklistOriginalInput({ ...clean.params, rawPayload: flat }), true);
  assert.throws(() => validatePilotChecklistOriginalInput({ ...clean.params, rawPayload: [...flat, null] }), /Checklist/);
  assert.equal(validatePilotChecklistOriginalInput({ ...clean.params, sourceUrl: "https://example.invalid/legacy.csv", parseSummary: null, rawPayload: { unsupported: true } }), false);
  assert.equal(validatePilotChecklistOriginalInput({ ...clean.params, datasetType: SetDatasetType.PARALLEL_DB, rawPayload: null }), false);
  const pokemon = input("pokemon-checklist");
  assert.throws(() => validatePilotChecklistOriginalInput({ ...pokemon.params, rawPayload: pokemon.request.rawPayload }), /canonical set binding/);
});

test("actual drafts/build rejects a wrong-hash raw duplicate before writers and forwards valid originals to central ingestion", async (context) => {
  const { request } = input();
  const duplicate = structuredClone(originalCards(request)[0]);
  (duplicate.metadata as RecordValue).sourceSha256 = "f".repeat(64);
  originalCards(request).push(duplicate);
  const userId = "synthetic-pilot-prevalidation-reviewer";
  const env = {
    NEXT_PUBLIC_ADMIN_USER_IDS: userId,
    SET_OPS_REVIEWER_USER_IDS: userId,
    AUTH_SERVICE_URL: "", NEXT_PUBLIC_AUTH_SERVICE_URL: "", TENKINGS_API_BASE_URL: "",
    NEXT_PUBLIC_API_BASE_URL: "", NEXT_PUBLIC_SITE_URL: "", SITE_URL: "",
    TAXONOMY_V2_FORCE_LEGACY: "false", TAXONOMY_V2_INGEST: "true",
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  let unexpectedCalls = 0;
  const blocked = async () => { unexpectedCalls += 1; throw new Error("Writer must not run for rejected original rows"); };
  const restores: Array<() => void> = [];
  const replace = (target: object, name: string, replacement: unknown) => {
    // Prisma delegates expose virtual methods, which node:test.mock.method
    // cannot discover through ordinary property descriptors.
    const object = target as RecordValue;
    const previous = object[name];
    object[name] = replacement;
    restores.push(() => { object[name] = previous; });
  };
  try {
    context.mock.method(globalThis, "fetch", blocked);
    replace(prisma.session, "findUnique", async () => ({ id: "synthetic-session", tokenHash: "a".repeat(64),
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60000), user: { id: userId, phone: null, displayName: "Synthetic reviewer" } }));
    replace(prisma.setIngestionJob, "findUnique", async () => ({ ...request, id: "synthetic-job", draftId: null,
      parseSummaryJson: { sourceProvider: request.sourceProvider, sourceFetchMeta: request.sourceFetchMeta } }));
    replace(prisma.setDraft, "findUnique", blocked);
    replace(prisma.setDraft, "create", blocked);
    replace(prisma.setDraftVersion, "create", blocked);
    replace(prisma.setIngestionJob, "update", blocked);
    replace(prisma.setTaxonomySource, "create", blocked);
    replace(prisma, "$transaction", blocked);
    replace(prisma.setAuditEvent, "create", blocked);
    const { default: handler } = await import("../pages/api/admin/set-ops/drafts/build");
    let status = 0;
    let body: unknown;
    const res = { status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; }, setHeader() {} };
    const req = { method: "POST", headers: { authorization: "Bearer synthetic-pilot-session" }, body: { ingestionJobId: "synthetic-job" },
      socket: { remoteAddress: "127.0.0.1" } } as NextApiRequest;
    await handler(req, res as unknown as NextApiResponse);
    assert.equal(status, 422);
    assert.match((body as { message: string }).message, /invalid source binding/);
    assert.equal(unexpectedCalls, 0);

    request.rawPayload = input().request.rawPayload;
    const createdCards: RecordValue[] = [];
    const createdPrograms: RecordValue[] = [];
    const fakeTx = {
      setTaxonomySource: { create: async ({ data }: { data: RecordValue }) => ({ ...data, id: "synthetic-source" }) },
      setProgram: { findUnique: async () => null, create: async ({ data }: { data: RecordValue }) => { createdPrograms.push(data); return data; } },
      setCard: { findUnique: async () => null, create: async ({ data }: { data: RecordValue }) => { createdCards.push(data); return data; } },
      setIngestionJob: { findUnique: async () => ({ status: "REVIEW_REQUIRED" }) },
    };
    let jobUpdate: RecordValue = {};
    replace(prisma, "$transaction", async (run: (tx: typeof fakeTx) => Promise<unknown>) => run(fakeTx));
    replace(prisma.setDraft, "findUnique", async () => ({ id: "synthetic-draft" }));
    replace(prisma.setDraft, "update", async () => ({}));
    replace(prisma.setDraftVersion, "findFirst", async () => ({ version: 6 }));
    replace(prisma.setDraftVersion, "create", async ({ data }: { data: RecordValue }) => ({ ...data, id: "synthetic-version", createdAt: new Date() }));
    replace(prisma.setIngestionJob, "update", async ({ data }: { data: RecordValue }) => { jobUpdate = data; return {}; });
    replace(prisma.setAuditEvent, "create", async () => ({ id: "synthetic-audit", status: "SUCCESS", action: "set_ops.draft.build", createdAt: new Date() }));
    await handler(req, res as unknown as NextApiResponse);
    assert.equal(status, 200);
    const ingestion = (jobUpdate.parseSummaryJson as RecordValue).taxonomyIngest as RecordValue;
    assert.equal(ingestion.applied, true);
    assert.equal(ingestion.adapter, "pinned-pilot-checklist-v1");
    assert.equal(createdPrograms.length, 1);
    assert.equal(createdCards.length, 3);
    assert.equal(unexpectedCalls, 0);
  } finally {
    for (const restore of restores.reverse()) restore();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("central ingestion rejects pinned backfill omissions, forged markers and mismatched projection before its transaction", async () => {
  const { ingestTaxonomyV2FromIngestionJob } = await import("../lib/server/taxonomyV2Core");
  const { params, request } = input();
  const db = prisma as unknown as RecordValue;
  const originalTransaction = db.$transaction;
  const writerBoundary = new Error("synthetic transaction boundary reached");
  let transactions = 0;
  db.$transaction = async () => { transactions += 1; throw writerBoundary; };
  try {
    const call = { ...params, ingestionJobId: "synthetic-pinned-job" };
    await assert.rejects(ingestTaxonomyV2FromIngestionJob(call), /original raw payload is required/);
    await assert.rejects(ingestTaxonomyV2FromIngestionJob({ ...call,
      parseSummary: { ...call.parseSummary, originalInputValidated: true, pinnedChecklistValidated: true },
    }), /original raw payload is required/);
    await assert.rejects(ingestTaxonomyV2FromIngestionJob({ ...call, originalRawPayload: true }), /unsupported raw shape/);

    const corruptOriginal = structuredClone(request.rawPayload);
    const duplicate = structuredClone(originalCards({ ...request, rawPayload: corruptOriginal })[0]);
    (duplicate.metadata as RecordValue).sourceSha256 = "f".repeat(64);
    originalCards({ ...request, rawPayload: corruptOriginal }).push(duplicate);
    await assert.rejects(ingestTaxonomyV2FromIngestionJob({ ...call, originalRawPayload: corruptOriginal }), /invalid source binding/);

    const changedRows = structuredClone(rows(params));
    changedRows[0].playerName = "Different projected identity";
    changedRows[0].playerSeed = "Different projected identity";
    await assert.rejects(ingestTaxonomyV2FromIngestionJob({ ...call, originalRawPayload: request.rawPayload, rawPayload: changedRows }), /projected rows differ/);
    assert.equal(transactions, 0);

    await assert.rejects(ingestTaxonomyV2FromIngestionJob({ ...call, originalRawPayload: request.rawPayload }), (error) => error === writerBoundary);
    assert.equal(transactions, 1);
    await assert.rejects(ingestTaxonomyV2FromIngestionJob({
      setId: "Synthetic Panini legacy odds", ingestionJobId: "synthetic-legacy-job", datasetType: SetDatasetType.PARALLEL_DB,
      sourceUrl: "https://www.paniniamerica.net/synthetic-odds", parseSummary: { sourceProvider: "Panini" },
      rawPayload: [{ program: "Synthetic Program", parallel: "Silver", serial: "/25" }],
    }), (error) => error === writerBoundary);
    assert.equal(transactions, 2, "non-pilot legacy ingestion still reaches its existing transaction without originalRawPayload");
  } finally {
    db.$transaction = originalTransaction;
  }
});
