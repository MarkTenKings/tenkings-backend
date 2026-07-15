import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  strictAiGraderLabelV1JsonEqual,
  type AiGraderLabelV1Snapshot,
} from "../lib/aiGraderLabelV1";
import {
  aiGraderLabelV1TemplateDigest,
  aiGraderLabelV1CutTransformMatrix,
  assertAiGraderLabelV1Assets,
  renderAiGraderLabelSheetCutSvg,
  renderAiGraderLabelSheetV1Pdf,
  renderAiGraderLabelV1CalibrationPdf,
  renderAiGraderLabelV1Pdf,
  renderAiGraderLabelV1Svg,
} from "../lib/server/aiGraderLabelV1Renderer";
import { AI_GRADER_LABEL_V1_NFC_FIT_TEST_CARDS } from "../scripts/ai-grader-label-v1-nfc-fit-test-data";

const sheetAssignment = {
  sheetId: "ai-grader-label-sheet-000001",
  sheetNumber: 1,
  slot: 1,
  assignedAt: "2026-07-13T12:00:00.000Z",
};

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function recursivelyReverseJsonObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(recursivelyReverseJsonObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reverse()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = recursivelyReverseJsonObjectKeys((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

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
    heightIn: 11,
    widthPt: 612,
    heightPt: 792,
    orientation: "portrait",
  });
  assert.deepEqual(manifest.label, { widthIn: 2.73, heightIn: 0.83, widthPt: 196.56, heightPt: 59.76 });
  assert.equal(manifest.sheet.columnGapPt, 74.88);
  assert.equal(manifest.sheet.rowGapPt, 18);
  assert.equal(manifest.sheet.marginTopPt, 72);
  assert.equal(manifest.sheet.marginRightPt, 72);
  assert.equal(manifest.sheet.marginBottomPt, 115.92);
  assert.deepEqual(manifest.sheet.xPositionsPt, [72, 343.44]);
  assert.deepEqual(manifest.sheet.yPositionsFromTopPt, [72, 149.76, 227.52, 305.28, 383.04, 460.8, 538.56, 616.32]);
  assert.equal(Number(((manifest.label.heightPt * 2 + manifest.sheet.rowGapPt) / 72).toFixed(2)), 1.91);
  assert.equal(manifest.paper.widthPt - (manifest.sheet.xPositionsPt[1] + manifest.label.widthPt), 72);
  assert.equal(manifest.sheet.yPositionsFromTopPt[0], 72);
  assert.equal(manifest.sheet.yPositionsFromTopPt[7] + manifest.label.heightPt + manifest.sheet.marginBottomPt, manifest.paper.heightPt);
  assert.equal(AI_GRADER_LABEL_V1_SHEET_SLOTS.length, 16);
  for (const [index, slot] of AI_GRADER_LABEL_V1_SHEET_SLOTS.entries()) {
    assert.equal(slot.slot, index + 1);
    assert.equal(slot.row, Math.floor(index / 2) + 1);
    assert.equal(slot.column, (index % 2) + 1);
    assert.equal(slot.xPt, manifest.sheet.xPositionsPt[index % 2]);
    assert.equal(slot.yFromTopPt, manifest.sheet.yPositionsFromTopPt[Math.floor(index / 2)]);
    assert.ok(Math.abs(slot.pdfYPt - (manifest.paper.heightPt - slot.yFromTopPt - manifest.label.heightPt)) < 0.0001);
  }
  assert.deepEqual(
    AI_GRADER_LABEL_V1_SHEET_SLOTS.filter((slot) => slot.column === 1).map((slot) => Number(slot.pdfYPt.toFixed(2))),
    [660.24, 582.48, 504.72, 426.96, 349.2, 271.44, 193.68, 115.92]
  );
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
  assert.equal(AI_GRADER_LABEL_V1_DESIGN_APPROVAL.designRevision, "barlow-readability-v2");
  assert.equal(AI_GRADER_LABEL_V1_DESIGN_APPROVAL.designRevisionPhysicalReprintStatus, "actual_size_foil_readability_approved");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.font.sha256, "830ea186acffc2316ed1a4e42319246ba3b46b04e33a211079249bf901193f04");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.smallTextFont.fileName, "fonts/barlow/Barlow-Regular.ttf");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.smallTextFont.sha256, "77fb1ac54d2ceb980e3ebdfa7a9d0f64e85a66e4fdfb7f914a7b0aa08fb33a5d");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.wordmarkFont.fileName, "fonts/barlow/Barlow-SemiBold.ttf");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.wordmarkFont.sha256, "07ea3ff2743cf6716122a520c5e6f1aed0e75c079bc3b75e512fbf1a85caef9b");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.logo.sha256, "801b4071499af546102c3d703f27deb3dabc7a4374d5d621eb8ad672ceeeae88");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.crown.sha256, "064156a51ee3e7c49bdf102752bbbd5d21ed41eaf2d58c6be7d5b9994aa307ed");
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.logo.approvedForProduction, true);
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.crown.approvedForProduction, true);
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.font.approvedForProduction, true);
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.smallTextFont.approvedForProduction, true);
  assert.equal(AI_GRADER_LABEL_V1_ASSETS.wordmarkFont.approvedForProduction, true);
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
    sheetAssignment,
  });
  assert.deepEqual(record.designApproval, AI_GRADER_LABEL_V1_DESIGN_APPROVAL);
  assert.equal(record.templateId, AI_GRADER_SPORTS_LABEL_V1_TEMPLATE_ID);
  assert.equal(record.templateDigestSha256, digest);
  assert.deepEqual(
    record.renderAssets.map((asset) => [asset.assetId, asset.version]),
    [
      [AI_GRADER_LABEL_V1_ASSETS.crown.assetId, AI_GRADER_LABEL_V1_ASSETS.crown.version],
      [AI_GRADER_LABEL_V1_ASSETS.font.assetId, AI_GRADER_LABEL_V1_ASSETS.font.version],
      [AI_GRADER_LABEL_V1_ASSETS.smallTextFont.assetId, AI_GRADER_LABEL_V1_ASSETS.smallTextFont.version],
      [AI_GRADER_LABEL_V1_ASSETS.wordmarkFont.assetId, AI_GRADER_LABEL_V1_ASSETS.wordmarkFont.version],
    ]
  );
  assert.equal(record.calibrationProfile.status, "provisional_not_physically_calibrated");
  assert.deepEqual(record.immutableSheetAssignment, sheetAssignment);
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
      sheetAssignment,
    }),
    /supports Sports and Pokemon cards only/
  );
});

test("Label V1 JSONB validation ignores object-key order but remains exact and array-order sensitive", () => {
  const digest = aiGraderLabelV1TemplateDigest();
  const record = buildAiGraderLabelV1RuntimeRecord({
    templateDigestSha256: digest,
    reportId: sports.reportId,
    certId: sports.certId,
    grade: sports.grade,
    publicReportUrl: sports.publicReportUrl,
    identity: sports.identity,
    sheetAssignment,
  });
  const jsonbReload = recursivelyReverseJsonObjectKeys(record);
  assert.equal(strictAiGraderLabelV1JsonEqual(record, jsonbReload), true);
  assert.deepEqual(parseAiGraderLabelV1RuntimeRecord(jsonbReload, digest), record);

  const mutations: Array<[string, (value: any) => void]> = [
    ["missing field", (value) => delete value.renderSnapshot.reportId],
    ["extra field", (value) => { value.unexpected = true; }],
    ["identity", (value) => { value.immutableIdentitySnapshot.year = "2004"; }],
    ["asset", (value) => { value.renderAssets[0].sha256 = "0".repeat(64); }],
    ["asset array order", (value) => { value.renderAssets.reverse(); }],
    ["template", (value) => { value.templateId = AI_GRADER_POKEMON_LABEL_V1_TEMPLATE_ID; }],
    ["calibration", (value) => { value.calibrationProfile.printOffsetXPt = 1; }],
  ];
  for (const [label, mutate] of mutations) {
    const changed = jsonClone(record) as any;
    mutate(changed);
    assert.equal(parseAiGraderLabelV1RuntimeRecord(changed, digest), null, label);
  }

  assert.equal(strictAiGraderLabelV1JsonEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
  assert.equal(strictAiGraderLabelV1JsonEqual({ a: [1, 2] }, { a: [2, 1] }), false);
  assert.equal(strictAiGraderLabelV1JsonEqual({ a: 1 }, { a: "1" }), false);
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
  assert.match(structuralSvg, /@font-face \{ font-family: "Bebas Neue";/);
  assert.match(structuralSvg, /@font-face \{ font-family: "Barlow";/);
  assert.match(structuralSvg, /@font-face \{ font-family: "Barlow SemiBold";/);
  assert.match(structuralSvg, /id="brand-crown"[^>]+width="25\.007616"[^>]+height="16\.258954"/);
  assert.match(structuralSvg, /id="brand-wordmark-transform" transform="translate\(22\.00 0\) scale\(0\.88 1\) translate\(-22\.00 0\)"/);
  assert.match(structuralSvg, /id="brand-wordmark"[^>]+class="wordmark-font"[^>]*>TEN KINGS<\/text>/);
  assert.match(structuralSvg, /id="grading-word"[^>]+class="small-font"/);
  assert.match(structuralSvg, /id="nfc-word"[^>]+class="small-font"/);
  assert.equal((structuralSvg.match(/<image\b[^>]*href="data:embedded"/g) ?? []).length, 3);
  assert.ok(structuralSvg.indexOf('id="primary-name"') < structuralSvg.indexOf('id="metadata"'));
  assert.doesNotMatch(structuralSvg, /center-divider|width="5\.7" height="3\.7"/);
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
  const match = svg.match(/<text x="181\.35" y="([\d.]+)"[^>]+class="display-font" font-size="([\d.]+)"[^>]*>10<\/text>/);
  assert.ok(match);
  const visualCenter = Number(match[1]) - Number(match[2]) * 0.35;
  assert.ok(Math.abs(visualCenter - AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.label.heightPt / 2) < 0.01);
});

test("revised proof geometry keeps the 11 mm reserve, prints a 9 mm guide, and freezes the exact crown/wordmark scale", () => {
  const zones = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.labelZones;
  const typography = AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.typography;
  assert.equal(zones.legacyLogoReference.scaleFromInitialProof, 0.6);
  assert.equal(zones.legacyLogoReference.rendered, false);
  assert.equal(zones.brandCrown.scaleFromApprovedLogoCrown, 1.2);
  assert.equal(zones.brandCrown.widthPt, 25.007616);
  assert.equal(zones.brandCrown.heightPt, 16.258954);
  assert.equal(typography.wordmark.family, "Barlow SemiBold");
  assert.equal(typography.wordmark.weight, 600);
  assert.equal(typography.wordmark.characterSpacingPt, 0.12);
  assert.equal(typography.wordmark.visibleCapHeightScale, 1.3);
  assert.equal(typography.wordmark.horizontalScale, 0.88);
  assert.ok(Math.abs(typography.wordmark.visibleCapHeightPt / typography.wordmark.referenceVisibleCapHeightPt - 1.3) < 0.000001);
  assert.equal(AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.layoutPolicy.centerDividerRendered, false);
  assert.equal(zones.nfcReserved.diameterMm, 11);
  assert.equal(zones.nfcReserved.printedGuideDiameterMm, 9);
  assert.equal(zones.nfcReserved.printedGuideDiameterPt, 25.511811);
  assert.equal(zones.nfcReserved.centerYPt, AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.label.heightPt / 2);
  assert.equal(zones.nfcReserved.certTopPt, 46.25);
  assert.ok(
    zones.nfcReserved.certTopPt + 11.5 <= AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.label.heightPt - 2,
    "two-line certificate IDs retain at least a 2-point geometric bottom safety margin"
  );
  assert.ok(Math.abs(zones.nfcReserved.widthPt / 72 * 25.4 - 11) < 0.01);
  assert.ok(Math.abs(zones.nfcReserved.printedGuideDiameterPt / 72 * 25.4 - 9) < 0.0001);
  const svg = renderAiGraderLabelV1Svg(sports).replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, "data:embedded");
  assert.match(svg, /<circle id="nfc-printed-guide" cx="149\.84" cy="29\.88" r="12\.7559055"\/>/);
});

test("individual and sheet PDFs have exact MediaBoxes; duplicate slots fail closed", async () => {
  const labelPdf = await renderAiGraderLabelV1Pdf(sports);
  assert.match(labelPdf.toString("latin1"), /\/MediaBox \[0 0 196\.56 59\.76\]/);
  assert.match(labelPdf.toString("latin1"), /BebasNeue-Regular/);
  assert.match(labelPdf.toString("latin1"), /Barlow-Regular/);
  assert.match(labelPdf.toString("latin1"), /Barlow-SemiBold/);
  const sheetPdf = await renderAiGraderLabelSheetV1Pdf({ entries: [{ slot: 1, snapshot: sports }], title: "partial" });
  assert.match(sheetPdf.toString("latin1"), /\/MediaBox \[0 0 612 792\]/);
  const repeatedSheetPdf = await renderAiGraderLabelSheetV1Pdf({ entries: [{ slot: 1, snapshot: sports }], title: "partial" });
  assert.deepEqual(repeatedSheetPdf, sheetPdf);
  const fullSheetPdf = await renderAiGraderLabelSheetV1Pdf({
    entries: AI_GRADER_LABEL_V1_SHEET_SLOTS.map((slot) => ({ slot: slot.slot, snapshot: slot.slot % 2 ? sports : pokemon })),
    title: "full",
  });
  assert.match(fullSheetPdf.toString("latin1"), /\/MediaBox \[0 0 612 792\]/);
  const calibrationPdf = await renderAiGraderLabelV1CalibrationPdf();
  assert.match(calibrationPdf.toString("latin1"), /\/MediaBox \[0 0 612 792\]/);
  assert.match(calibrationPdf.toString("latin1"), /BebasNeue-Regular/);
  assert.doesNotMatch(calibrationPdf.toString("latin1"), /Barlow-(?:Regular|SemiBold)/);
  assert.equal(
    createHash("sha256").update(calibrationPdf).digest("hex"),
    "23008d9372e252c30f0f89c56ce6478a57c8c40fe10a1094dbe0652a0a42ff92"
  );
  assert.ok(fullSheetPdf.length > sheetPdf.length);
  for (let count = 1; count <= 16; count += 1) {
    const partial = await renderAiGraderLabelSheetV1Pdf({
      entries: Array.from({ length: count }, (_, index) => ({ slot: index + 1, snapshot: index % 2 ? pokemon : sports })),
      title: `partial-${count}`,
    });
    assert.match(partial.toString("latin1"), /\/MediaBox \[0 0 612 792\]/, `partial sheet count ${count}`);
  }
  await assert.rejects(
    renderAiGraderLabelSheetV1Pdf({ entries: [], title: "empty" }),
    /require 1 through 16 assigned labels/
  );
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
  assert.match(svg, /width="8\.5in" height="11in" viewBox="0 0 612 792"/);
  for (const slot of AI_GRADER_LABEL_V1_SHEET_SLOTS) {
    assert.match(
      svg,
      new RegExp(`id="slot-${slot.slot}" x="${slot.xPt}" y="${slot.yFromTopPt}" width="196.56" height="59.76"`)
    );
  }
  assert.equal((svg.match(/<rect id="slot-/g) ?? []).length, 16);
  assert.match(svg, /id="cut-calibration-transform" transform="matrix\(1 0 0 1 0 0\)"/);
  assert.doesNotMatch(svg, /scale\(|\/Users\/|127\.0\.0\.1|localhost|<circle|NFC|<text/i);
  assert.equal(createHash("sha256").update(svg).digest("hex"), "095f2cc2322a46966818a3df8bf696a790af2665ffd0230f12d4b0c88f6b0df6");
  const calibrationSvg = renderAiGraderLabelSheetCutSvg({ calibrationMarks: true });
  assert.match(calibrationSvg, /M 532 676\.08 H 548 M 540 668\.08 V 684\.08/);
  assert.doesNotMatch(calibrationSvg, /CALIBRATION ONLY|<text/);
  assert.equal(
    createHash("sha256").update(calibrationSvg).digest("hex"),
    "3a69afb0ea776c1233c7380c8ef614a053440c033d5f49b527e9a6ce855b75eb"
  );
});

test("NFC-fit fixtures use 16 real card identities with unmistakably synthetic issuance fields", () => {
  assert.equal(AI_GRADER_LABEL_V1_NFC_FIT_TEST_CARDS.length, 16);
  assert.deepEqual(AI_GRADER_LABEL_V1_NFC_FIT_TEST_CARDS.map((card) => card.slot), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.deepEqual(
    AI_GRADER_LABEL_V1_NFC_FIT_TEST_CARDS.map((card) => card.snapshot.identity.playerName ?? card.snapshot.identity.cardName),
    [
      "Michael Jordan",
      "Kobe Bryant",
      "Shaquille O'Neal",
      "Babe Ruth",
      "Tom Brady",
      "Barry Sanders",
      "Wayne Gretzky",
      "LeBron James",
      "Charizard",
      "Pikachu",
      "Blastoise",
      "Venusaur",
      "Mewtwo",
      "Gengar",
      "Lugia",
      "Rayquaza",
    ]
  );
  for (const card of AI_GRADER_LABEL_V1_NFC_FIT_TEST_CARDS) {
    assert.match(card.snapshot.certId, /^TEST-[SP]\d{2}$/);
    assert.match(card.snapshot.publicReportUrl, /^https:\/\/example\.invalid\//);
    assert.ok(card.sourceUrls.length >= 1);
    assert.doesNotMatch(JSON.stringify(card), /(?:qr|qrcode)/i);
  }
});

test("synthetic calibration applies print and cut transforms in the documented order", async () => {
  const calibration = {
    ...AI_GRADER_LABEL_V1_COORDINATE_MANIFEST.calibration,
    printOffsetXPt: 4,
    printOffsetYPt: -3,
    printScaleX: 1.01,
    printScaleY: 0.99,
    cutOffsetXPt: 4,
    cutOffsetYPt: 5,
    cutScaleX: 2,
    cutScaleY: 3,
    cutRotationDeg: 90,
  };
  const pdf = await renderAiGraderLabelSheetV1Pdf({
    entries: [{ slot: 1, snapshot: sports }],
    title: "synthetic calibration",
    calibration,
  });
  assert.match(pdf.toString("latin1"), /1\.01 0 0 0\.99 4 -3 cm/);

  assert.deepEqual(aiGraderLabelV1CutTransformMatrix(calibration), ["0", "2", "-3", "0", "4", "5"]);
  const svg = renderAiGraderLabelSheetCutSvg({ calibration });
  assert.match(svg, /transform="matrix\(0 2 -3 0 4 5\)"/);
});
