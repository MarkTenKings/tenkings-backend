import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertGenericImportPayload, parsePreparedChecklistImport, PREPARED_CHECKLIST_MAX_BYTES } from "../lib/preparedChecklistImport";
import { validatePilotChecklistOriginalInput } from "../lib/server/taxonomyV2PilotChecklistAdapter";
import { SetDatasetType } from "@tenkings/database";

const text = readFileSync(new URL("../../../docs/plans/catalog-pilot-20260916/pokemon-complete-import.unreviewed.json", import.meta.url), "utf8");
const packet = JSON.parse(text);

test("the actual 138-row wrapper produces the exact preserved request, with no authority promoted", () => {
  const before = JSON.stringify(packet);
  const preview = parsePreparedChecklistImport(text);
  assert.equal(preview.rowCount, 138);
  assert.equal(preview.displayLabel, "Black & White—Legendary Treasures");
  assert.deepEqual(preview.requestDraft, packet.requestDraft);
  assert.deepEqual(JSON.parse(preview.requestBody), packet.requestDraft);
  assert.equal(JSON.stringify(packet), before);
  const request = preview.requestDraft;
  assert.equal(validatePilotChecklistOriginalInput({ ...request, datasetType: SetDatasetType.PLAYER_WORKSHEET,
    parseSummary: { sourceProvider: request.sourceProvider, sourceFetchMeta: request.sourceFetchMeta } }), true);
  assert.equal(request.sourceFetchMeta.humanReviewed, false);
  assert.equal(request.sourceFetchMeta.rightsVerified, false);
});

test("malformed, unsupported, authority-bearing and inconsistent prepared files fail closed", () => {
  for (const value of [null, [], packet.requestDraft, { ...packet, extra: true }, { ...packet, schemaVersion: "v2" }]) {
    assert.throws(() => parsePreparedChecklistImport(JSON.stringify(value)), /Unsupported prepared checklist/);
  }
  assert.throws(() => parsePreparedChecklistImport("not JSON"), /JSON file/);
  assert.throws(() => parsePreparedChecklistImport(" ".repeat(PREPARED_CHECKLIST_MAX_BYTES + 1)), /768 KiB/);
  const mutations = [
    (p: typeof packet) => { p.requestDraft.approve = true; },
    (p: typeof packet) => { p.requestDraft.sourceQuery.ignored = "extra"; },
    (p: typeof packet) => { p.requestDraft.sourceFetchMeta.humanReviewed = true; },
    (p: typeof packet) => { p.requestDraft.sourceFetchMeta.sourceBytesVerifiedByPreparation = true; },
    (p: typeof packet) => { p.reviewer = "guessed reviewer"; },
    (p: typeof packet) => { p.publication = {}; },
    (p: typeof packet) => { p.images.push({}); },
    (p: typeof packet) => { p.binding.databaseRecordCreated = true; },
    (p: typeof packet) => { p.binding.setId = "different set"; },
    (p: typeof packet) => { p.requestDraft.rawPayload.ignoredRows = []; },
    (p: typeof packet) => { p.requestDraft.rawPayload.programs[0].cards[137].extra = true; },
    (p: typeof packet) => { p.requestDraft.rawPayload.programs[0].cards[137].metadata.extra = true; },
    (p: typeof packet) => { p.requestDraft.rawPayload.programs[0].cards[137].metadata.sourceSha256 = "a".repeat(64); },
    (p: typeof packet) => { p.requestDraft.rawPayload.programs[0].cards[137].metadata.printedName = "different name"; },
    (p: typeof packet) => { p.requestDraft.rawPayload.programs[0].cards.pop(); },
    (p: typeof packet) => { p.requestDraft.rawPayload.programs[0].cards[137] = p.requestDraft.rawPayload.programs[0].cards[0]; },
    (p: typeof packet) => { p.requestDraft.sourceUrl = "javascript:alert(1)"; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(packet); mutate(changed);
    assert.throws(() => parsePreparedChecklistImport(JSON.stringify(changed)), /prepared checklist|Prepared checklist/);
  }
});

test("client consistency is not a substitute for existing server pinned-source validation", () => {
  const changed = structuredClone(packet);
  changed.requestDraft.sourceFetchMeta.sha256 = "a".repeat(64);
  for (const card of changed.requestDraft.rawPayload.programs[0].cards) card.metadata.sourceSha256 = "a".repeat(64);
  const request = parsePreparedChecklistImport(JSON.stringify(changed)).requestDraft;
  assert.throws(() => validatePilotChecklistOriginalInput({ ...request, datasetType: SetDatasetType.PLAYER_WORKSHEET,
    parseSummary: { sourceProvider: request.sourceProvider, sourceFetchMeta: request.sourceFetchMeta } }), /Exact pinned checklist source/);
});

test("generic imports remain accepted while prepared envelopes receive a clear routing error", () => {
  for (const value of [[{ cardNumber: "1", playerName: "Example" }], { rows: [] }, { programs: [] }, { playerName: "Example" }]) {
    assert.doesNotThrow(() => assertGenericImportPayload(value));
  }
  for (const value of [packet, { requestDraft: {} }, { schemaVersion: "tenkings-complete-checklist-import-draft/v99" }]) {
    assert.throws(() => assertGenericImportPayload(value), /Use Prepared checklist import/);
  }
});
