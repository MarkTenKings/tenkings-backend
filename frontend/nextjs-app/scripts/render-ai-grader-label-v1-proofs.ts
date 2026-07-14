import { mkdirSync, writeFileSync } from "node:fs";
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

function repoRoot() {
  return process.cwd().endsWith(path.join("frontend", "nextjs-app"))
    ? path.resolve(process.cwd(), "..", "..")
    : process.cwd();
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
  writeFileSync(path.join(pdfDir, files.calibrationPdf), await renderAiGraderLabelV1CalibrationPdf());
  writeFileSync(path.join(proofDir, files.sportsSvg), renderAiGraderLabelV1Svg(sports));
  writeFileSync(path.join(proofDir, files.pokemonSvg), renderAiGraderLabelV1Svg(pokemon));
  writeFileSync(path.join(proofDir, files.cutSvg), renderAiGraderLabelSheetCutSvg());
  writeFileSync(path.join(proofDir, files.calibrationCutSvg), renderAiGraderLabelSheetCutSvg({ calibrationMarks: true }));
  writeFileSync(
    path.join(proofDir, "proof-manifest.json"),
    `${JSON.stringify(
      {
        status: "design_approved_not_physically_calibrated",
        designApproval: AI_GRADER_LABEL_V1_DESIGN_APPROVAL,
        templateDigestSha256: aiGraderLabelV1TemplateDigest(),
        assets: AI_GRADER_LABEL_V1_ASSETS,
        coordinates: AI_GRADER_LABEL_V1_COORDINATE_MANIFEST,
        files,
        notes: [
          "The supplied Ten Kings artwork is preserved exactly, with Mark-authorized deterministic dark-black recoloring and crown-only crop.",
          "OFL Bebas Neue Regular weight 400 is embedded from the user-supplied local TTF for PDF/SVG determinism.",
          "The NFC reserve is an 11 mm circle centered vertically on the label; print and cut offsets remain provisional.",
          "Whole words wrap to approved fixed tiers; words are never split or truncated.",
          "No QR is visible in either NFC template.",
          "Mark approved Label V1 with the exact phrase `Label V1 design approved` on 2026-07-13.",
          "Physical Foil Express and Cricut calibration remains a separate required gate.",
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
