import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_GRADER_LABEL_V1_ASSETS,
  AI_GRADER_LABEL_V1_COORDINATE_MANIFEST,
  AI_GRADER_LABEL_V1_DESIGN_APPROVAL,
  AI_GRADER_LABEL_V1_SHEET_SLOTS,
  AI_GRADER_POKEMON_LABEL_V1_TEMPLATE_ID,
  AI_GRADER_SPORTS_LABEL_V1_TEMPLATE_ID,
  buildAiGraderLabelV1RuntimeRecord,
  buildAiGraderLabelV1Content,
  parseAiGraderLabelV1RuntimeRecord,
  type AiGraderLabelV1Snapshot,
} from "../lib/aiGraderLabelV1";
import {
  aiGraderLabelV1TemplateDigest,
  assertAiGraderLabelV1Assets,
  renderAiGraderLabelSheetCutSvg,
  renderAiGraderLabelSheetV1Pdf,
  renderAiGraderLabelV1Pdf,
  renderAiGraderLabelV1Svg,
} from "../lib/server/aiGraderLabelV1Renderer";

const sports: AiGraderLabelV1Snapshot = {
  templateId: AI_GRADER_SPORTS_LABEL_V1_TEMPLATE_ID,
  reportId: "sports-report",
  certId: "TKG-000001",
  grade: 10,
  publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/sports-report",
  identity: {
    category: "sport",
    year: "2003",
    manufacturer: "Topps",
    productSet: "Chrome",
    playerName: "LeBron James",
    insert: "Rookie",
    parallel: "Refractor",
    cardNumber: "111",
  },
};

const pokemon: AiGraderLabelV1Snapshot = {
  templateId: AI_GRADER_POKEMON_LABEL_V1_TEMPLATE_ID,
  reportId: "pokemon-report",
  certId: "TKG-000002",
  grade: 9.5,
  publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/pokemon-report",
  identity: {
    category: "tcg",
    year: "1999",
    game: "Pokemon",
    productSet: "Base Set",
    productLine: "English",
    insertSet: "1st Edition",
    insert: "Shadowless",
    cardName: "Charizard",
    parallel: "Holo",
    cardNumber: "4",
  },
};

test("Label V1 fixes exact physical dimensions and all row-major slot coordinates", () => {
  const manifest = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST;
  assert.deepEqual(manifest.paper, {
    widthIn: 8.5,
    heightIn: 12,
    widthPt: 612,
    heightPt: 864,
    orientation: "portrait",
  });
  assert.deepEqual(manifest.label, { widthIn: 2.73, heightIn: 0.83, widthPt: 196.56, heightPt: 59.76 });
  assert.equal(AI_GRADER_LABEL_V1_SHEET_SLOTS.length, 16);
  for (const [index, slot] of AI_GRADER_LABEL_V1_SHEET_SLOTS.entries()) {
    assert.equal(slot.slot, index + 1);
    assert.equal(slot.row, Math.floor(index / 2) + 1);
    assert.equal(slot.column, (index % 2) + 1);
    assert.equal(slot.xPt, manifest.sheet.xPositionsPt[index % 2]);
    assert.equal(slot.yFromTopPt, manifest.sheet.yPositionsFromTopPt[Math.floor(index / 2)]);
    assert.ok(Math.abs(slot.pdfYPt - (864 - slot.yFromTopPt - 59.76)) < 0.0001);
  }
});

test("Sports and Pokemon use the approved frozen field hierarchy", () => {
  assert.deepEqual(buildAiGraderLabelV1Content(sports), {
    metadata: "2003 TOPPS CHROME",
    primary: "LEBRON JAMES",
    descriptor: "REFRACTOR / ROOKIE",
    cardNumberAboveGrade: "#111",
    certId: "TKG-000001",
    grade: "10",
  });
  assert.deepEqual(buildAiGraderLabelV1Content(pokemon), {
    metadata: "1999 BASE SET #4",
    primary: "CHARIZARD",
    descriptor: "HOLO",
    certId: "TKG-000002",
    grade: "9.5",
  });
});

test("hash-bound assets are required and the template digest is stable within a process", () => {
  assertAiGraderLabelV1Assets();
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.font.sha256, "830ea186acffc2316ed1a4e42319246ba3b46b04e33a211079249bf901193f04");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.logo.sha256, "801b4071499af546102c3d703f27deb3dabc7a4374d5d621eb8ad672ceeeae88");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.crown.sha256, "064156a51ee3e7c49bdf102752bbbd5d21ed41eaf2d58c6be7d5b9994aa307ed");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.logo.approvedForProduction, true);
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.crown.approvedForProduction, true);
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.font.approvedForProduction, true);
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.logoSource.approvedForProduction, false);
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.sportsReference.approvedForProduction, false);
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.pokemonReference.approvedForProduction, false);
  assert.equal(aiGraderLabelV1TemplateDigest(), aiGraderLabelV1TemplateDigest());
});

test("approved runtime records freeze template, assets, calibration, identity, and render authority", () => {
  const digest = aiGraderLabelV1TemplateDigest();
  const record = buildAiGraderLabelV1RuntimeRecord({
    templateDigestSha256: digest,
    reportId: sports.reportId,
    certId: sports.certId,
    grade: sports.grade,
    publicReportUrl: sports.publicReportUrl,
    identity: sports.identity,
  });
  assert.deepEqual(record.designApproval, AI_GRADER_LABEL_V1_DESIGN_APPROVAL);
  assert.equal(record.templateId, AI_GRADER_SPORTS_LABEL_V1_TEMPLATE_ID);
  assert.equal(record.templateDigestSha256, digest);
  assert.deepEqual(record.renderAssets.map((asset) => asset.assetId), [
    AI_GRADER_LABEL_V1_ASSETS.logo.assetId,
    AI_GRADER_LABEL_V1_ASSETS.crown.assetId,
    AI_GRADER_LABEL_V1_ASSETS.font.assetId,
  ]);
  assert.equal(record.calibrationProfile.status, "provisional_not_physically_calibrated");
  assert.deepEqual(record.immutableIdentitySnapshot, sports.identity);
  assert.deepEqual(record.renderSnapshot, { ...sports, grade: "10" });
  assert.deepEqual(parseAiGraderLabelV1RuntimeRecord(record, digest), record);
  assert.equal(parseAiGraderLabelV1RuntimeRecord({ ...record, templateDigestSha256: "0".repeat(64) }, digest), null);
  assert.equal(
    parseAiGraderLabelV1RuntimeRecord(
      { ...record, immutableIdentitySnapshot: { ...record.immutableIdentitySnapshot, year: "2004" } },
      digest
    ),
    null
  );
  assert.throws(
    () => buildAiGraderLabelV1RuntimeRecord({
      templateDigestSha256: digest,
      reportId: "unsupported",
      certId: "TKG-UNSUPPORTED",
      grade: 9,
      publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/unsupported",
      identity: { category: "tcg", game: "Magic", cardName: "Black Lotus", year: "1993", productSet: "Alpha" },
    }),
    /supports Sports and Pokemon cards only/
  );
});

test("label SVG preserves whole words without truncation and has no visible QR or local paths", () => {
  const long = {
    ...pokemon,
    certId: "TKG-123456",
    identity: {
      ...pokemon.identity,
      productSet: "Scarlet and Violet Temporal Forces",
      insertSet: "Special Illustration Rare Extended Collector Variant",
      cardName: "Walking Wake ex",
      parallel: "Hyper Rare Holofoil Premium Parallel",
      numbered: "123456789/123456789",
    },
  } satisfies AiGraderLabelV1Snapshot;
  const svg = renderAiGraderLabelV1Svg(long);
  const structuralSvg = svg.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, "data:embedded");
  assert.match(structuralSvg, /width="2\.73in" height="0\.83in" viewBox="0 0 196\.56 59\.76"/);
  assert.doesNotMatch(structuralSvg, /\.\.\.|…|<image[^>]+qr|qrcode|\/Users\/|[A-Za-z]:\\|127\.0\.0\.1|localhost/i);
  for (const word of ["SCARLET", "VIOLET", "TEMPORAL", "FORCES", "WALKING", "WAKE", "HYPER", "HOLOFOIL", "PARALLEL"]) {
    assert.match(structuralSvg, new RegExp(word));
  }
  assert.match(structuralSvg, />NFC<\/text>/);
  assert.equal((structuralSvg.match(/<image href="data:embedded"/g) ?? []).length, 4);
  assert.doesNotMatch(structuralSvg, /54\.30/);
});

test("long metadata and hyphenated names use balanced intentional line breaks", () => {
  const longSports = {
    ...sports,
    identity: {
      ...sports.identity,
      year: "2023-24",
      manufacturer: "Panini",
      productSet: "National Treasures Basketball",
      playerName: "Shai Gilgeous-Alexander",
    },
  } satisfies AiGraderLabelV1Snapshot;
  const svg = renderAiGraderLabelV1Svg(longSports).replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, "data:embedded");
  assert.match(svg, />2023-24 PANINI NATIONAL<\/text>/);
  assert.match(svg, />TREASURES BASKETBALL<\/text>/);
  assert.match(svg, />SHAI GILGEOUS<\/text>/);
  assert.match(svg, />-ALEXANDER<\/text>/);
  assert.doesNotMatch(svg, />BASKETBALL<\/text>/);
});

test("content that cannot fit a whole word fails closed instead of splitting or truncating", () => {
  assert.throws(
    () => renderAiGraderLabelV1Svg({ ...pokemon, identity: { ...pokemon.identity, cardName: "SUPERCALIFRAGILISTICEXPIALIDOCIOUS" } }),
    /cannot fit.*without splitting or truncating a word/i
  );
});

test("decimal grades use an exact fixed tier and are never truncated", () => {
  const svg = renderAiGraderLabelV1Svg({ ...pokemon, grade: 9.5 });
  assert.match(svg, />9\.5<\/text>/);
  assert.doesNotMatch(svg, />9\.\.\.<\/text>/);
});

test("grade glyph center is aligned to the label centerline", () => {
  const svg = renderAiGraderLabelV1Svg(sports);
  const match = svg.match(/<text x="181\.35" y="([\d.]+)"[^>]+font-size="([\d.]+)">10<\/text>/);
  assert.ok(match);
  const visualCenter = Number(match[1]) - Number(match[2]) * 0.35;
  assert.ok(Math.abs(visualCenter - AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.label.heightPt / 2) < 0.01);
});

test("approved proof geometry uses a centered 11 mm NFC circle and a 40 percent smaller logo", () => {
  const zones = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones;
  assert.equal(zones.logo.scaleFromInitialProof, 0.6);
  assert.equal(zones.nfcReserved.diameterMm, 11);
  assert.equal(zones.nfcReserved.centerYPt, AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.label.heightPt / 2);
  assert.ok(Math.abs(zones.nfcReserved.widthPt / 72 * 25.4 - 11) < 0.01);
});

test("individual and sheet PDFs have exact MediaBoxes; duplicate slots fail closed", async () => {
  const labelPdf = await renderAiGraderLabelV1Pdf(sports);
  assert.match(labelPdf.toString("latin1"), /\/MediaBox \[0 0 196\.56 59\.76\]/);
  const sheetPdf = await renderAiGraderLabelSheetV1Pdf({ entries: [{ slot: 1, snapshot: sports }], title: "partial" });
  assert.match(sheetPdf.toString("latin1"), /\/MediaBox \[0 0 612 864\]/);
  const repeatedSheetPdf = await renderAiGraderLabelSheetV1Pdf({ entries: [{ slot: 1, snapshot: sports }], title: "partial" });
  assert.deepEqual(repeatedSheetPdf, sheetPdf);
  const fullSheetPdf = await renderAiGraderLabelSheetV1Pdf({
    entries: AI_GRADER_LABEL_V1_SHEET_SLOTS.map((slot) => ({ slot: slot.slot, snapshot: slot.slot % 2 ? sports : pokemon })),
    title: "full",
  });
  assert.match(fullSheetPdf.toString("latin1"), /\/MediaBox \[0 0 612 864\]/);
  assert.ok(fullSheetPdf.length > sheetPdf.length);
  await assert.rejects(
    renderAiGraderLabelSheetV1Pdf({
      entries: [
        { slot: 1, snapshot: sports },
        { slot: 1, snapshot: pokemon },
      ],
      title: "duplicate",
    }),
    /duplicate slot/
  );
});

test("Cricut cut SVG uses the same 16-slot manifest and carries no browser scaling", () => {
  const svg = renderAiGraderLabelSheetCutSvg();
  assert.match(svg, /width="8\.5in" height="12in" viewBox="0 0 612 864"/);
  for (const slot of AI_GRADER_LABEL_V1_SHEET_SLOTS) {
    assert.match(
      svg,
      new RegExp(`id="slot-${slot.slot}" x="${slot.xPt}" y="${slot.yFromTopPt}" width="196.56" height="59.76"`)
    );
  }
  assert.equal((svg.match(/<rect id="slot-/g) ?? []).length, 16);
  assert.doesNotMatch(svg, /transform=|scale\(|\/Users\/|127\.0\.0\.1|localhost/);
});
