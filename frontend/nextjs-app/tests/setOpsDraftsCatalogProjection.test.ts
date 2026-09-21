import assert from "node:assert/strict";
import test from "node:test";
import { SetDatasetType } from "@tenkings/database";
import {
  buildTaxonomyIngestRows,
  createDraftVersionPayload,
  normalizeDraftRows,
} from "../lib/server/setOpsDrafts";
import { buildToppsTaxonomyAdapterOutput } from "../lib/server/taxonomyV2ToppsAdapter";

const setId = "Synthetic Topps catalog projection";
const sourceUrl = "https://example.invalid/catalog-projection.pdf";
const datasetType = SetDatasetType.PARALLEL_DB;
const rawBase = { setId, program: "Synthetic Program", parallel: "Ordinary", sourceUrl };

function normalize(raw: Record<string, unknown>) {
  return normalizeDraftRows({ datasetType, fallbackSetId: setId, rawPayload: [raw] });
}

function adapter(rows: ReturnType<typeof buildTaxonomyIngestRows>) {
  return buildToppsTaxonomyAdapterOutput({
    setId,
    datasetType,
    sourceUrl,
    rawPayload: rows,
    parseSummary: { sourceProvider: "Topps" },
  });
}

test("explicit catalog-only aliases survive normalization and taxonomy projection without inventing odds or scope", () => {
  const signals: Record<string, unknown>[] = [
    { parallelCatalog: true },
    { parallelCatalog: " TRUE " },
    { isParallelCatalog: "yes" },
    { catalogOnly: "1" },
    { catalogOnly: 1 },
    { parallelCatalog: null, isParallelCatalog: true },
    { parallelCatalog: undefined, isParallelCatalog: null, catalogOnly: true },
  ];
  for (const signal of signals) {
    const normalized = normalize({ ...rawBase, ...signal });
    assert.equal(normalized.summary.blockingErrorCount, 0);
    assert.equal(normalized.rows.length, 1);
    const rowsBefore = JSON.stringify(normalized.rows);
    const hashBefore = createDraftVersionPayload({ setId, datasetType, rows: normalized.rows }).versionHash;
    const projected = buildTaxonomyIngestRows(normalized.rows);
    assert.equal(projected.length, 1);
    assert.equal(projected[0].parallelCatalog, true);
    assert.equal(projected[0].odds, null);
    assert.equal(projected[0].serial, null);
    assert.equal(projected[0].format, null);
    assert.equal(projected[0].channel, null);
    assert.equal(projected[0].sourceUrl, sourceUrl);
    const output = adapter(projected);
    assert.deepEqual(output.parallels.map((row) => [row.label, row.serialDenominator]), [["Ordinary", null]]);
    assert.deepEqual(output.scopes.map((row) => [row.programLabel, row.formatKey, row.channelKey]), [
      ["Synthetic Program", null, null],
    ]);
    assert.deepEqual(output.oddsRows, []);
    assert.equal(JSON.stringify(normalized.rows), rowsBefore);
    assert.equal(createDraftVersionPayload({ setId, datasetType, rows: normalized.rows }).versionHash, hashBefore);
  }
});

test("absent, false and unrecognized signals cannot promote a no-odds row, including conflicting aliases", () => {
  const signals: Record<string, unknown>[] = [
    {},
    { parallelCatalog: false },
    { parallelCatalog: "false" },
    { parallelCatalog: "0" },
    { parallelCatalog: 0 },
    { parallelCatalog: "on" },
    { isParallelCatalog: false },
    { catalogOnly: "no" },
    { parallelCatalog: false, isParallelCatalog: true, catalogOnly: true },
    { parallelCatalog: "false", catalogOnly: true },
    { isParallelCatalog: false, catalogOnly: true },
  ];
  const retained = normalize({ ...rawBase, parallelCatalog: true }).rows[0];
  for (const signal of signals) {
    assert.deepEqual(normalize({ ...rawBase, ...signal }).rows, []);
    // Historical draft readers can supply retained rows directly to projection.
    const projected = buildTaxonomyIngestRows([{ ...retained, raw: { ...rawBase, ...signal } }]);
    assert.equal(projected[0].parallelCatalog, false);
    const output = adapter(projected);
    assert.deepEqual(output.parallels, []);
    assert.deepEqual(output.scopes, []);
    assert.deepEqual(output.oddsRows, []);
  }
});

test("real odds, serial and source metadata remain unchanged in direct and per-format projections", () => {
  const metadataJson = { sourceSha256: "a".repeat(64), sourcePage: 2, authority: "synthetic-test" };
  const normalized = normalize({
    ...rawBase,
    parallel: "Orange Refractor",
    serial: "/25",
    odds: "1:100",
    format: "Hobby",
    channel: "Retail",
    parallelCatalog: false,
    metadataJson,
  });
  const direct = buildTaxonomyIngestRows(normalized.rows);
  assert.equal(direct.length, 1);
  assert.deepEqual(
    direct.map((row) => ({
      parallelCatalog: row.parallelCatalog,
      parallel: row.parallel,
      serial: row.serial,
      odds: row.odds,
      oddsNumeric: row.oddsNumeric,
      format: row.format,
      channel: row.channel,
      sourceUrl: row.sourceUrl,
      metadataJson: row.metadataJson,
    })),
    [{ parallelCatalog: false, parallel: "Orange Refractor", serial: "/25", odds: "1:100", oddsNumeric: 100,
      format: "Hobby", channel: "Retail", sourceUrl, metadataJson }]
  );
  const perFormat = buildTaxonomyIngestRows(normalized.rows.map((row) => ({
    ...row,
    raw: { ...row.raw, oddsByFormat: [
      { oddsText: "1:100", format: "Hobby", channel: "Retail" },
      { oddsText: "1:200", format: "Value Box", channel: "Retail" },
    ] },
  })));
  assert.deepEqual(perFormat.map((row) => ({ ...row, odds: null, oddsNumeric: null, format: null })),
    Array(2).fill({ ...direct[0], odds: null, oddsNumeric: null, format: null }));
  assert.deepEqual(perFormat.map((row) => [row.odds, row.oddsNumeric, row.format]), [
    ["1:100", 100, "Hobby"], ["1:200", 200, "Value Box"],
  ]);
  const serialOnly = buildTaxonomyIngestRows(normalize({ ...rawBase, serial: "/25" }).rows);
  assert.equal(serialOnly[0].parallelCatalog, false);
  assert.equal(serialOnly[0].serial, "/25");
  assert.equal(serialOnly[0].odds, null);
  assert.equal(adapter(serialOnly).parallels[0].serialDenominator, 25);
});
