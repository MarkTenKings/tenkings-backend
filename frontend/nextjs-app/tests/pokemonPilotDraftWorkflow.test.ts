import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { serializeWorksheetDraftRow } from "../lib/setOpsDraftEditor";
import type { SetOpsDraftRow } from "../lib/server/setOpsDrafts";

type RecordValue = Record<string, unknown>;
type StoredRow = RecordValue & { id: string };
type Write = { data: RecordValue };
type Where = { where: RecordValue };
type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;
type DraftResponse = {
  draft: { status: string };
  latestVersion: { version: number; versionHash: string; rows: SetOpsDraftRow[] };
  latestApprovedVersionId: string | null;
};

const packet = JSON.parse(readFileSync(new URL(
  "../../../docs/plans/catalog-pilot-20260916/pokemon-complete-import.unreviewed.json", import.meta.url,
), "utf8")) as {
  requestDraft: {
    setId: string; datasetType: string; sourceFetchMeta: RecordValue; sourceQuery: RecordValue;
    rawPayload: { programs: Array<{ cards: Array<RecordValue & { metadata: RecordValue }> }> };
  };
};

async function invoke(handler: Handler, method: "GET" | "POST", body: unknown, query: Record<string, string> = {}, headers = { authorization: "Bearer offline-pokemon-review" } as Record<string, string>) {
  let status = 0;
  let response: unknown;
  const responseHeaders: Record<string, string> = {};
  const res = {
    status(value: number) { status = value; return this; },
    json(value: unknown) { response = value; return this; },
    setHeader(name: string, value: string) { responseHeaders[name.toLowerCase()] = value; },
  };
  await handler({ method, body, query, headers,
    socket: { remoteAddress: "127.0.0.1" } } as NextApiRequest, res as unknown as NextApiResponse);
  return { status, body: response, headers: responseHeaders };
}

test("all 138 real source rows survive ingestion, review and one visible edit without publication", async (context) => {
  const request = structuredClone(packet.requestDraft);
  const originals = request.rawPayload.programs[0].cards;
  assert.equal(originals.length, 138);
  const userId = "offline-pokemon-reviewer";
  const env = {
    NEXT_PUBLIC_ADMIN_USER_IDS: userId, SET_OPS_REVIEWER_USER_IDS: userId,
    AUTH_SERVICE_URL: "", NEXT_PUBLIC_AUTH_SERVICE_URL: "", TENKINGS_API_BASE_URL: "",
    NEXT_PUBLIC_API_BASE_URL: "", NEXT_PUBLIC_SITE_URL: "", SITE_URL: "",
    TAXONOMY_V2_FORCE_LEGACY: "false", TAXONOMY_V2_INGEST: "true",
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let unexpectedCalls = 0;
  const blocked = async () => { unexpectedCalls += 1; throw new Error("Offline fixture forbids real DB/network or unplanned writes"); };
  // This file runs in its own node:test process. Any delegate omitted below is
  // stopped before the Prisma engine; no database URL or server is required.
  prisma.$use(blocked);
  context.mock.method(globalThis, "fetch", blocked);
  const restores: Array<() => void> = [];
  const replace = (target: object, name: string, replacement: unknown) => {
    const object = target as RecordValue;
    const previous = object[name];
    object[name] = replacement;
    restores.push(() => { object[name] = previous; });
  };
  const now = new Date("2026-09-17T00:00:00.000Z");
  const drafts = new Map<string, StoredRow>();
  const existingSports: StoredRow = { id: "existing-sports", setId: "Unrelated Sports Set", status: "APPROVED", normalizedLabel: "Unrelated Sports Set" };
  drafts.set(String(existingSports.setId), structuredClone(existingSports));
  const jobs: StoredRow[] = [];
  const versions: StoredRow[] = [];
  const sources: StoredRow[] = [];
  const programs: RecordValue[] = [];
  const cards: RecordValue[] = [];
  const audits: RecordValue[] = [];
  let transactions = 0;
  const checkSet = (value: unknown) => assert.equal(value, request.setId, "every write stays on the exact new set key");
  const fakeTx = {
    setTaxonomySource: { create: async ({ data }: Write) => {
      checkSet(data.setId);
      const source = { ...structuredClone(data), id: `source-${sources.length + 1}` };
      sources.push(source); return source;
    } },
    setProgram: {
      findUnique: async ({ where }: Where) => { checkSet((where.setId_programId as RecordValue).setId); return null; },
      create: async ({ data }: Write) => { checkSet(data.setId); programs.push(structuredClone(data)); return data; },
    },
    setCard: {
      findUnique: async ({ where }: Where) => { checkSet((where.setId_programId_cardNumber as RecordValue).setId); return null; },
      create: async ({ data }: Write) => { checkSet(data.setId); cards.push(structuredClone(data)); return data; },
    },
    setIngestionJob: { findUnique: async ({ where }: Where) => jobs.find(job => job.id === where.id) ?? null },
  };
  try {
    replace(prisma.session, "findUnique", async () => ({ id: "offline-session", tokenHash: "a".repeat(64),
      createdAt: now, expiresAt: new Date(Date.now() + 60_000), user: { id: userId, phone: null, displayName: "Offline reviewer" } }));
    replace(prisma.setDraft, "upsert", async ({ where, create, update }: Where & { create: RecordValue; update: RecordValue }) => {
      checkSet(where.setId);
      const prior = drafts.get(String(where.setId));
      const value = prior ? { ...prior, ...structuredClone(update) }
        : { ...structuredClone(create), id: "pokemon-draft", updatedAt: now, archivedAt: null };
      drafts.set(String(where.setId), value); return value;
    });
    replace(prisma.setDraft, "findUnique", async ({ where }: Where) =>
      where.id ? [...drafts.values()].find(row => row.id === where.id) ?? null : drafts.get(String(where.setId)) ?? null);
    replace(prisma.setDraft, "update", async ({ where, data }: Where & Write) => {
      const prior = [...drafts.values()].find(row => row.id === where.id)!;
      checkSet(prior.setId);
      const value = { ...prior, ...structuredClone(data) }; drafts.set(String(prior.setId), value); return value;
    });
    replace(prisma.setIngestionJob, "create", async ({ data }: Write) => {
      checkSet(data.setId);
      const job = { ...structuredClone(data), id: "pokemon-job", createdAt: now, updatedAt: now, parsedAt: null, reviewedAt: null };
      jobs.push(job); return job;
    });
    replace(prisma.setIngestionJob, "findUnique", fakeTx.setIngestionJob.findUnique);
    replace(prisma.setIngestionJob, "update", async ({ where, data }: Where & Write) => {
      const job = jobs.find(row => row.id === where.id)!; Object.assign(job, structuredClone(data)); return job;
    });
    replace(prisma.setDraftVersion, "findFirst", async () => versions.at(-1) ?? null);
    replace(prisma.setDraftVersion, "findMany", async () => structuredClone([...versions].reverse()));
    replace(prisma.setDraftVersion, "create", async ({ data }: Write) => {
      assert.equal(data.draftId, "pokemon-draft");
      const version = { ...structuredClone(data), id: `version-${versions.length + 1}`, createdAt: now };
      versions.push(version); return version;
    });
    replace(prisma.setApproval, "findFirst", async () => null);
    replace(prisma.setAuditEvent, "create", async ({ data }: Write) => {
      audits.push(structuredClone(data)); return { ...data, id: `audit-${audits.length}`, createdAt: now };
    });
    replace(prisma, "$transaction", async (run: (tx: typeof fakeTx) => Promise<unknown>) => {
      transactions += 1; return run(fakeTx);
    });
    const [{ default: ingest }, { default: build }, { default: read }, { default: save }, { resolveTaxonomyScopeForMatcher }] = await Promise.all([
      import("../pages/api/admin/set-ops/ingestion"), import("../pages/api/admin/set-ops/drafts/build"),
      import("../pages/api/admin/set-ops/drafts"), import("../pages/api/admin/set-ops/drafts/version"),
      import("../lib/server/taxonomyV2Core"),
    ]);

    const unsigned = await invoke(ingest, "GET", null, {}, {});
    assert.equal(unsigned.status, 401);
    assert.equal(unsigned.headers["cache-control"], "private, no-store");
    const queued = await invoke(ingest, "POST", request);
    assert.equal(queued.headers["cache-control"], "private, no-store");
    assert.equal(queued.status, 200, JSON.stringify(queued.body));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, "QUEUED");
    assert.deepEqual(jobs[0].rawPayload, request.rawPayload);
    const queueMeta = jobs[0].parseSummaryJson as RecordValue;
    assert.deepEqual(queueMeta.sourceFetchMeta, request.sourceFetchMeta);
    assert.deepEqual(queueMeta.sourceQuery, request.sourceQuery);

    const built = await invoke(build, "POST", { ingestionJobId: jobs[0].id });
    assert.equal(built.status, 200, JSON.stringify(built.body));
    const result = (jobs[0].parseSummaryJson as RecordValue).taxonomyIngest as RecordValue;
    assert.equal(result.applied, true);
    assert.equal(built.headers["cache-control"], "private, no-store");
    const outcome = (built.body as RecordValue).taxonomyIngest as RecordValue;
    assert.equal(outcome.outcome, "applied");
    assert.equal((outcome.result as RecordValue).sourceId, result.sourceId);
    assert.deepEqual((outcome.result as RecordValue).counts, result.counts);
    assert.equal(result.adapter, "pinned-pilot-checklist-v1");
    assert.deepEqual(result.counts, { programs: 1, cards: 138, variations: 0, parallels: 0, scopes: 0,
      oddsRows: 0, conflicts: 0, ambiguities: 0, bridges: 0 });
    assert.equal(transactions, 1);
    assert.equal(sources.length, 1);
    assert.equal(programs.length, 1);
    assert.equal(cards.length, 138);
    assert.equal(sources[0].ingestionJobId, jobs[0].id);
    const sourceMetadata = sources[0].metadataJson as RecordValue;
    assert.equal(sourceMetadata.authority, "unreviewed_source_transcription");
    for (const field of ["humanReviewed", "rightsVerified", "sourceBytesVerifiedByAdapter", "transcriptionVerified"]) {
      assert.equal(sourceMetadata[field], false);
    }
    assert.deepEqual(sourceMetadata.sourceFetchMeta, request.sourceFetchMeta);
    assert.deepEqual(cards.map(card => [card.cardNumber, card.playerName, card.metadataJson]),
      originals.map(card => [card.cardNumber, card.playerName, card.metadata]));
    assert.ok(cards.every(card => card.isRookie === null));
    assert.equal(jobs[0].status, "REVIEW_REQUIRED");
    assert.equal(drafts.get(request.setId)!.status, "REVIEW_REQUIRED");

    // Exercise the real matcher publication filter, with its SQL delegate
    // substituted. This asserts the query contract, not PostgreSQL execution.
    replace(prisma.setProgram, "count", async ({ where }: Where) => {
      assert.deepEqual(where, { setId: request.setId, OR: [
        { sourceId: null }, { source: { is: { OR: [{ ingestionJobId: null }, { ingestionJob: { status: "APPROVED" } }] } } },
      ] });
      return 0;
    });
    assert.equal((await resolveTaxonomyScopeForMatcher({ setId: request.setId })).hasTaxonomy, false);

    const query = { setId: request.setId, datasetType: request.datasetType };
    const loaded = await invoke(read, "GET", undefined, query);
    assert.equal(loaded.status, 200);
    const before = loaded.body as DraftResponse;
    assert.equal(before.latestApprovedVersionId, null);
    assert.equal(before.latestVersion.rows.length, 138);
    const firstVersion = structuredClone(versions[0]);
    const firstJob = structuredClone(jobs[0]);
    const firstSources = structuredClone(sources);
    const firstCards = structuredClone(cards);
    const editedName = "Tangela (review note)";
    const edited = before.latestVersion.rows.map((row, index) => serializeWorksheetDraftRow(
      index === 0 ? { ...row, playerSeed: editedName } : row,
      { team: "", subset: row.cardType ?? "", rookie: false },
    ));
    assert.deepEqual(edited.map(row => row.metadataJson), originals.map(card => card.metadata));
    assert.ok(edited.every(row => row.isRookie === null && row.rookie === null));
    const saved = await invoke(save, "POST", { ...query, rows: edited });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const reloaded = await invoke(read, "GET", undefined, query);
    assert.equal(reloaded.status, 200);
    const after = reloaded.body as DraftResponse;
    assert.equal(after.latestVersion.version, 2);
    assert.equal(after.latestVersion.rows.length, 138);
    assert.notEqual(after.latestVersion.versionHash, before.latestVersion.versionHash);
    assert.equal(after.latestVersion.rows[0].playerSeed, editedName);
    assert.deepEqual(after.latestVersion.rows.slice(1).map(row => [row.cardNumber, row.playerSeed]),
      before.latestVersion.rows.slice(1).map(row => [row.cardNumber, row.playerSeed]));
    assert.deepEqual(after.latestVersion.rows.map(row => row.raw.metadataJson), originals.map(card => card.metadata));
    assert.ok(after.latestVersion.rows.every(row => row.raw.isRookie === null));
    assert.equal(after.latestApprovedVersionId, null);
    assert.equal(after.draft.status, "REVIEW_REQUIRED");
    assert.deepEqual(versions[0], firstVersion, "save adds an immutable revision");
    assert.deepEqual(jobs[0], firstJob, "review save cannot rewrite pinned ingestion input");
    assert.deepEqual(sources, firstSources);
    assert.deepEqual(cards, firstCards, "review save cannot overwrite taxonomy or publish edited values");

    // A forged later source row still fails before any writer, even after an
    // ordinary review save has succeeded.
    const jobPayload = jobs[0].rawPayload as typeof request.rawPayload;
    jobPayload.programs[0].cards[137].metadata.sourceSha256 = "f".repeat(64);
    const rejected = await invoke(build, "POST", { ingestionJobId: jobs[0].id });
    assert.equal(rejected.status, 422);
    assert.match((rejected.body as { message: string }).message, /invalid source binding/);
    assert.equal(transactions, 1);
    assert.equal(versions.length, 2);
    assert.deepEqual(sources, firstSources);
    assert.deepEqual(cards, firstCards);
    assert.deepEqual(drafts.get(String(existingSports.setId)), existingSports);
    assert.equal(unexpectedCalls, 0);
    assert.ok(audits.every(audit => !String(audit.action).includes("approval")));
  } finally {
    for (const restore of restores.reverse()) restore();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("untouched missing, blank and unknown rookie values remain unknown; known values and control edits remain boolean", () => {
  const row = { setId: "synthetic", cardNumber: "1", playerSeed: "Example", sourceUrl: null,
    raw: { metadataJson: { humanReviewed: false }, parallelCatalog: { authority: "unreviewed" } } as RecordValue };
  const fields = { team: "", subset: "", rookie: false };
  for (const unknown of [{}, { isRookie: null }, { rookie: null }, { isRookie: "" }, { rookie: "  " }, { isRookie: "unknown" }]) {
    const result = serializeWorksheetDraftRow({ ...row, raw: { ...row.raw, ...unknown } }, fields);
    assert.equal(result.isRookie, null);
    assert.equal(result.rookie, null);
    assert.deepEqual(result.metadataJson, row.raw.metadataJson);
    assert.deepEqual(result.parallelCatalog, row.raw.parallelCatalog);
    for (const value of [true, false]) {
      // The actual control writes both fields on change, including explicit
      // false after a user selects Rookie and then returns to '-'.
      const changed = serializeWorksheetDraftRow({ ...row, raw: { ...row.raw, ...unknown,
        isRookie: value, rookie: value ? "Rookie" : "" } }, { ...fields, rookie: value });
      assert.equal(changed.isRookie, value);
    }
  }
  for (const [raw, expected] of [
    [{ isRookie: true }, true], [{ isRookie: false }, false], [{ rookie: true }, true], [{ rookie: false }, false],
    [{ isRookie: "yes" }, true], [{ rookie: "RC" }, true], [{ isRookie: "false" }, false], [{ rookie: "no" }, false],
    [{ isRookie: 1 }, true], [{ rookie: 0 }, false],
  ] as const) {
    assert.equal(serializeWorksheetDraftRow({ ...row, raw: { ...row.raw, ...raw } }, { ...fields, rookie: expected }).isRookie, expected);
  }
});
