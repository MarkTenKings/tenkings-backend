import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AI_GRADER_LABEL_V1_ASSETS,
  AI_GRADER_LABEL_V1_COORDINATE_MANIFEST,
  AI_GRADER_LABEL_V1_DESIGN_APPROVAL,
  AI_GRADER_POKEMON_LABEL_V1_TEMPLATE_ID,
  AI_GRADER_SPORTS_LABEL_V1_TEMPLATE_ID,
  type AiGraderLabelV1Snapshot,
} from "../lib/aiGraderLabelV1";
import {
  aiGraderLabelV1TemplateDigest,
  assertAiGraderLabelV1Assets,
  renderAiGraderLabelSheetCutSvg,
  renderAiGraderLabelSheetV1Pdf,
  renderAiGraderLabelV1CalibrationPdf,
  renderAiGraderLabelV1InspectionPdf,
  renderAiGraderLabelV1Pdf,
  renderAiGraderLabelV1Svg,
} from "../lib/server/aiGraderLabelV1Renderer";
import { AI_GRADER_LABEL_V1_NFC_FIT_TEST_CARDS } from "./ai-grader-label-v1-nfc-fit-test-data";

function repoRoot() {
  return process.cwd().endsWith(path.join("frontend", "nextjs-app"))
    ? path.resolve(process.cwd(), "..", "..")
    : process.cwd();
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function assertNfcFitTestCards() {
  if (AI_GRADER_LABEL_V1_NFC_FIT_TEST_CARDS.length !== 16) {
    throw new Error("Label V1 NFC-fit test sheet must contain exactly 16 fixtures.");
  }
  const certIds = new Set<string>();
  for (const [index, card] of AI_GRADER_LABEL_V1_NFC_FIT_TEST_CARDS.entries()) {
    if (card.slot !== index + 1) throw new Error("Label V1 NFC-fit test fixtures must use row-major slots 1 through 16.");
    if (!/^TEST-[SP]\d{2}$/.test(card.snapshot.certId)) {
      throw new Error("Label V1 NFC-fit test fixtures must use visible TEST certificate IDs.");
    }
    if (!card.snapshot.publicReportUrl.startsWith("https://example.invalid/")) {
      throw new Error("Label V1 NFC-fit test fixtures must not use live report URLs.");
    }
    if (certIds.has(card.snapshot.certId)) throw new Error("Label V1 NFC-fit test certificate IDs must be unique.");
    certIds.add(card.snapshot.certId);
  }
}

const sports: AiGraderLabelV1Snapshot = {
  templateId: AI_GRADER_SPORTS_LABEL_V1_TEMPLATE_ID,
  reportId: "label-v1-sports-proof",
  certId: "TKG-001",
  grade: 10,
  publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/label-v1-sports-proof",
  identity: {
    category: "sport",
    year: "2003",
    manufacturer: "Topps",
    productSet: "Chrome",
    playerName: "LeBron James",
    insert: "Rookie",
    parallel: "Refractor",
    cardNumber: "111",
    sport: "Basketball",
  },
};

const pokemon: AiGraderLabelV1Snapshot = {
  templateId: AI_GRADER_POKEMON_LABEL_V1_TEMPLATE_ID,
  reportId: "label-v1-pokemon-proof",
  certId: "TKG-002",
  grade: 10,
  publicReportUrl: "https://collect.tenkings.co/ai-grader/reports/label-v1-pokemon-proof",
  identity: {
    category: "tcg",
    year: "1999",
    game: "Pokémon",
    productSet: "Base Set",
    productLine: "English",
    insertSet: "1st Edition",
    insert: "Shadowless",
    cardName: "Charizard",
    parallel: "Holo",
    cardNumber: "4",
    manufacturer: "Wizards of the Coast",
  },
};

const edgeCases: AiGraderLabelV1Snapshot[] = [
  sports,
  pokemon,
  {
    ...sports,
    reportId: "label-v1-sports-long-name",
    certId: "TKG-2026-000003",
    grade: 9.5,
    identity: {
      ...sports.identity,
      year: "2023-24",
      manufacturer: "Panini",
      productSet: "National Treasures Basketball",
      playerName: "Shai Gilgeous-Alexander",
      insertSet: "Rookie Patch Autographs",
      insert: "Horizontal Premium Edition",
      parallel: "Emerald Foil",
      numbered: "3/5",
      autograph: true,
      memorabilia: true,
    },
  },
  {
    ...pokemon,
    reportId: "label-v1-pokemon-long-name",
    certId: "TKG-2026-000004",
    grade: 8.5,
    identity: {
      ...pokemon.identity,
      year: "2024",
      productSet: "Scarlet & Violet - Temporal Forces",
      productLine: "English",
      insertSet: "Special Illustration Rare",
      insert: "Collector Number 205",
      cardName: "Walking Wake ex",
      parallel: "Hyper Rare Holofoil",
      cardNumber: "205/162",
    },
  },
];

const fullSheetSnapshots = Array.from({ length: 16 }, (_, index) => {
  const source = edgeCases[index % edgeCases.length];
  return {
    ...source,
    reportId: `${source.reportId}-slot-${index + 1}`,
    certId: `TKG-${String(index + 1).padStart(6, "0")}`,
    grade: index % 4 === 0 ? 10 : index % 4 === 1 ? 9.5 : index % 4 === 2 ? 8 : 7.5,
  } satisfies AiGraderLabelV1Snapshot;
});

async function main() {
  assertAiGraderLabelV1Assets();
  assertNfcFitTestCards();
  const root = repoRoot();
  const pdfDir = path.join(root, "output", "pdf");
  const proofDir = path.join(root, "output", "ai-grader-label-v1");
  mkdirSync(pdfDir, { recursive: true });
  mkdirSync(proofDir, { recursive: true });

  const files = {
    sportsActualPdf: "ten-kings-label-v1-sports-actual.pdf",
    pokemonActualPdf: "ten-kings-label-v1-pokemon-actual.pdf",
    inspectionPdf: "ten-kings-label-v1-enlarged-inspection.pdf",
    fullSheetPdf: "ten-kings-label-v1-full-sheet-proof.pdf",
    partialSheetPdf: "ten-kings-label-v1-partial-sheet-proof.pdf",
    nfcFitTestPdf: "ten-kings-label-v1-nfc-fit-test-sheet.pdf",
    calibrationPdf: "ten-kings-label-v1-calibration.pdf",
    sportsSvg: "ten-kings-label-v1-sports.svg",
    pokemonSvg: "ten-kings-label-v1-pokemon.svg",
    cutSvg: "ten-kings-label-v1-cricut-cut.svg",
    calibrationCutSvg: "ten-kings-label-v1-cricut-calibration.svg",
  };

  writeFileSync(path.join(pdfDir, files.sportsActualPdf), await renderAiGraderLabelV1Pdf(sports));
  writeFileSync(path.join(pdfDir, files.pokemonActualPdf), await renderAiGraderLabelV1Pdf(pokemon));
  writeFileSync(path.join(pdfDir, files.inspectionPdf), await renderAiGraderLabelV1InspectionPdf([sports, pokemon, edgeCases[2], edgeCases[3]]));
  writeFileSync(
    path.join(pdfDir, files.fullSheetPdf),
    await renderAiGraderLabelSheetV1Pdf({
      title: "Ten Kings Label V1 full 16-slot design proof",
      entries: fullSheetSnapshots.map((snapshot, index) => ({ slot: index + 1, snapshot })),
    })
  );
  writeFileSync(
    path.join(pdfDir, files.partialSheetPdf),
    await renderAiGraderLabelSheetV1Pdf({
      title: "Ten Kings Label V1 partial 5-slot design proof",
      entries: fullSheetSnapshots.slice(0, 5).map((snapshot, index) => ({ slot: index + 1, snapshot })),
    })
  );
  const nfcFitTestPdf = await renderAiGraderLabelSheetV1Pdf({
    title: "Ten Kings Label V1 NFC fit test - synthetic records - not for production",
    entries: AI_GRADER_LABEL_V1_NFC_FIT_TEST_CARDS.map(({ slot, snapshot }) => ({ slot, snapshot })),
  });
  writeFileSync(path.join(pdfDir, files.nfcFitTestPdf), nfcFitTestPdf);
  const nfcFitTestPdfSha256 = sha256(nfcFitTestPdf);
  writeFileSync(path.join(pdfDir, files.calibrationPdf), await renderAiGraderLabelV1CalibrationPdf());
  writeFileSync(path.join(proofDir, files.sportsSvg), renderAiGraderLabelV1Svg(sports));
  writeFileSync(path.join(proofDir, files.pokemonSvg), renderAiGraderLabelV1Svg(pokemon));
  writeFileSync(path.join(proofDir, files.cutSvg), renderAiGraderLabelSheetCutSvg());
  writeFileSync(path.join(proofDir, files.calibrationCutSvg), renderAiGraderLabelSheetCutSvg({ calibrationMarks: true }));
  const pdfArtifactKeys = new Set([
    "sportsActualPdf",
    "pokemonActualPdf",
    "inspectionPdf",
    "fullSheetPdf",
    "partialSheetPdf",
    "nfcFitTestPdf",
    "calibrationPdf",
  ]);
  const artifacts = Object.fromEntries(
    Object.entries(files).map(([key, fileName]) => {
      const filePath = path.join(pdfArtifactKeys.has(key) ? pdfDir : proofDir, fileName);
      const bytes = readFileSync(filePath);
      return [key, { fileName, byteLength: bytes.length, sha256: sha256(bytes) }];
    })
  );
  writeFileSync(
    path.join(proofDir, "proof-manifest.json"),
    `${JSON.stringify(
      {
        status: "barlow_readability_revision_actual_size_print_approved",
        designApproval: AI_GRADER_LABEL_V1_DESIGN_APPROVAL,
        templateDigestSha256: aiGraderLabelV1TemplateDigest(),
        assets: AI_GRADER_LABEL_V1_ASSETS,
        coordinates: AI_GRADER_LABEL_V1_COORDINATE_MANIFEST,
        files,
        artifacts,
        determinism: {
          algorithm: "sha256",
          requiredIndependentGenerations: 2,
          acceptanceRule: "Every artifact and this manifest must be byte-identical between both same-environment generations.",
        },
        acceptedPhysicalObservations: {
          printer: "FoilXpress AP (Auto-Positioning)",
          media: "8.5 x 11 inch AP paper",
          measuredLabelWidthIn: 2.73,
          measuredLabelHeightIn: 0.83,
          observedPrintScaleX: 1,
          observedPrintScaleY: 1,
          topRightSlotTopEdgeIn: 1.125,
          topRightSlotRightEdgeIn: 1.375,
          observedHorizontalShiftFromPdfPt: -27,
          observedVerticalShiftFromPdfPt: 9,
          correctiveTransformApplied: false,
          operatorAcceptedPlacement: true,
          cricutOperatorAttestation: "handled and accepted by Mark; numeric cut offsets, scale, and rotation not reported",
          realNfcInlayFit: "fits perfectly inside the centered 11 mm logical reserve",
          barlowActualSizePrint: {
            printedBy: "Mark",
            printedOn: "2026-07-15",
            pdfFileName: files.nfcFitTestPdf,
            pdfSha256: nfcFitTestPdfSha256,
            result: "new font looks great; Barlow foil readability approved",
          },
          nfcProgrammed: false,
        },
        nfcFitTest: {
          status: "test_only_not_issued_not_for_production",
          pdfSha256: nfcFitTestPdfSha256,
          realFields: ["card identity", "year", "manufacturer/set", "card number", "variant/descriptor"],
          syntheticFields: ["grade", "certificate ID", "report ID", "public report URL"],
          records: AI_GRADER_LABEL_V1_NFC_FIT_TEST_CARDS,
        },
        notes: [
          "The exact supplied crown artwork remains byte-unchanged and is rendered from the approved crop at 120 percent of its prior visible label size; it was not redrawn, traced, or AI-generated.",
          "Names and grades retain embedded OFL Bebas Neue Regular. Metadata, descriptors, card numbers, certificate IDs, NFC, and GRADING use embedded Barlow Regular. The live TEN KINGS wordmark uses embedded Barlow SemiBold at 130 percent of the prior visible cap height, 0.12-point tracking, and a deterministic 0.88 horizontal fit within the widened internal brand lockup.",
          "The center renders the primary name first and metadata below it. The former center horizontal rule and its center crown are removed; both vertical crown separators remain.",
          "The logical NFC reserve remains centered at 11 mm. Only the printed circular guide is 9 mm. No NFC hole or NFC programming behavior is added to the Cricut authority.",
          "The accepted 8.5 x 11-inch sheet, 2.73 x 0.83-inch label, 0.25-inch row gaps, all 16 slot coordinates, calibration PDF, and Cricut cut/calibration SVGs remain unchanged.",
          "Whole words wrap to approved fixed tiers; words are never split or truncated.",
          "No QR is visible in either NFC template.",
          "The NFC-fit sheet uses real reference card identities with visible TEST certificate IDs and synthetic grades; it is an offline physical-fit artifact, not an issued or production-authorized sheet.",
          "Mark manually printed the exact populated Barlow sheet on the FoilXpress and reported that the new font looks great, then approved the complete physical handoff on 2026-07-15. This closes the actual-size Barlow foil-readability gate for the unchanged label artwork.",
          "The overall calibration profile remains provisional because the exact driver/version, exact AP media SKU/material, independently recorded 100-percent Fit/Scale-disabled dialog state, numeric Cricut X/Y/scale/rotation, and measured NFC-inlay diameter were not reported and are not inferred.",
        ],
      },
      null,
      2
    )}\n`
  );

  process.stdout.write(`${JSON.stringify({ pdfDir, proofDir, files }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
