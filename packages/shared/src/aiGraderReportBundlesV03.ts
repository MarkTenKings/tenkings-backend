import { z } from "zod";
import {
  AI_GRADER_DEFECT_FINDING_MAX_COUNT,
  isSafeAiGraderPublicAssetId,
} from "./aiGraderDefectFindings";
import {
  AI_GRADER_DEFECT_FINDING_V2_VERSION,
  aiGraderPublishedDefectFindingV2Schema,
} from "./aiGraderDefectFindingsV2";
import {
  MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION,
  MATHEMATICAL_GRADING_ELEMENTS_V1,
  MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION,
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  aggregateCornerScoreV1,
  aggregateEdgeScoreV1,
  calculateCenteringAxisV1,
  calculateFindingDeductionV1,
  combineMeasurementUncertaintyU95,
  calculateOverallGradeV1,
  calculateRegisteredDesignTemplateAxisV1,
  fuseCenteringFrontBackV1,
  mathematicalCalibrationProfileV1Schema,
  mathematicalCenteringRegistrationV1Schema,
  mathematicalDeductionLedgerV1Schema,
  mathematicalDesignReferenceV1Schema,
  mathematicalLabelGradeV1Schema,
  mathematicalMeasurementUncertaintyComponentsV1Schema,
  mathematicalScoreV1Schema,
  roundMathematicalScoreV1,
  scoreCenteringRatioV1,
  validateMathematicalCalibrationProfileV1,
} from "./aiGraderMathematicalCalibrationV1";
import {
  POKEMON_TCG_STANDARD_CORNER_PROFILE_ID,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256,
  POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION,
  POKEMON_TCG_STANDARD_MEASUREMENT_AUTHORITY_SCHEMA_VERSION,
  pokemonTcgStandardCornerProfileV1Schema,
  trustedPokemonCardFormatAuthorityV1Schema,
} from "./aiGraderPokemonStandardCornerProfileV1";
import {
  aiGraderPublishedAssetSchema,
  aiGraderSafePublishedUrlSchema,
} from "./aiGraderReportBundles";

export const AI_GRADER_REPORT_BUNDLE_V03_VERSION = "ai-grader-report-bundle-v0.3" as const;
export const AI_GRADER_CALIBRATED_V1_GRADE_STATUS = "final_mathematical_grade_v1" as const;

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, "must be a safe public identifier");
const reportIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/, "must be a safe report identifier");
const assetIdSchema = z.string().refine(isSafeAiGraderPublicAssetId, {
  message: "must be a safe logical public asset ID",
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "must be a lowercase SHA-256");
const fractionSchema = z.number().finite().min(0).max(1);
const nonnegativeTwoDecimalSchema = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, {
    message: "must contain at most two decimal places",
  });

const roundNonnegativeTwoDecimals = (value: number) =>
  Math.round((Math.max(0, value) + Number.EPSILON) * 100) / 100;

function isSafePublicText(value: string) {
  return (
    !/(?:data|blob|file):/i.test(value) &&
    !/[a-z]:[\\/]/i.test(value) &&
    !/\\\\/.test(value) &&
    !/(?:authorization\s*:|bearer\s+|api[_ -]?key\s*[=:]|password\s*[=:]|token\s*[=:]|secret\s*[=:]|credential\s*[=:])/i.test(value) &&
    !/[<>]/.test(value)
  );
}

const safeTextSchema = (maximum: number) => z.string().trim().min(1).max(maximum).refine(isSafePublicText, {
  message: "must be safe public text",
});

const uniqueIdentifiers = (maximum: number) => z
  .array(identifierSchema)
  .max(maximum)
  .refine((values) => new Set(values.map((value) => value.toLowerCase())).size === values.length, {
    message: "identifiers must be unique case-insensitively",
  });

const uniqueAssetIds = (minimum = 0) => z
  .array(assetIdSchema)
  .min(minimum)
  .max(128)
  .refine((values) => new Set(values.map((value) => value.toLowerCase())).size === values.length, {
    message: "asset IDs must be unique case-insensitively",
  });

const aiGraderPublishedAssetV03Schema = aiGraderPublishedAssetSchema.superRefine((asset, context) => {
  const hash = asset.sha256 ?? asset.checksumSha256;
  if (!hash) {
    context.addIssue({ code: "custom", path: ["sha256"], message: "calibrated V1 public evidence requires an immutable SHA-256" });
  }
  if (asset.sha256 && asset.checksumSha256 && asset.sha256.toLowerCase() !== asset.checksumSha256.toLowerCase()) {
    context.addIssue({ code: "custom", path: ["checksumSha256"], message: "must match sha256 when both are published" });
  }
});

const confidenceSchema = z
  .strictObject({
    score: fractionSchema,
    band: z.enum(["low", "medium", "high"]),
    validEvidenceCoverage: fractionSchema,
    warnings: z.array(safeTextSchema(500)).max(100),
  })
  .superRefine((confidence, context) => {
    const bands = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.reportConfidenceBands;
    const expectedBand = confidence.score >= bands.highMinimum
      ? "high"
      : confidence.score >= bands.mediumMinimum ? "medium" : "low";
    if (confidence.band !== expectedBand) {
      context.addIssue({
        code: "custom",
        path: ["band"],
        message: "must match the centralized report-confidence thresholds",
      });
    }
  });

const locationScoreSchema = z
  .strictObject({
    side: z.enum(["front", "back"]),
    location: identifierSchema,
    score: mathematicalScoreV1Schema,
    penalty: nonnegativeTwoDecimalSchema.max(MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION),
    findingIds: uniqueIdentifiers(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
    confidence: confidenceSchema,
  })
  .superRefine((location, context) => {
    if (location.score !== roundMathematicalScoreV1(10 - location.penalty)) {
      context.addIssue({ code: "custom", path: ["score"], message: "must equal clamp(10 - location penalty, 1, 10)" });
    }
  });

const elementScoreSchema = z.strictObject({
  score: mathematicalScoreV1Schema,
  startingScore: z.literal(10),
  frontScore: mathematicalScoreV1Schema,
  backScore: mathematicalScoreV1Schema,
  aggregatePenalty: nonnegativeTwoDecimalSchema.max(
    MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION,
  ),
  locationScores: z.array(locationScoreSchema).max(32),
  findingIds: uniqueIdentifiers(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
  confidence: confidenceSchema,
  formula: safeTextSchema(1000),
  explanation: safeTextSchema(1000),
});

const finalGradeSchema = z.strictObject({
  status: z.literal(AI_GRADER_CALIBRATED_V1_GRADE_STATUS),
  overall: mathematicalScoreV1Schema,
  labelGrade: mathematicalLabelGradeV1Schema,
  weightedGrade: mathematicalScoreV1Schema,
  weakestElement: z.enum(MATHEMATICAL_GRADING_ELEMENTS_V1),
  weakestScore: mathematicalScoreV1Schema,
  weakestElementCap: mathematicalScoreV1Schema,
  applicableSevereDefectCap: mathematicalScoreV1Schema.optional(),
  elements: z.strictObject({
    centering: elementScoreSchema,
    corners: elementScoreSchema,
    edges: elementScoreSchema,
    surface: elementScoreSchema,
  }),
  confidence: confidenceSchema,
  weights: z.strictObject({
    centering: z.number().finite(),
    corners: z.number().finite(),
    edges: z.number().finite(),
    surface: z.number().finite(),
  }),
  weightedFormula: safeTextSchema(1000),
  formula: safeTextSchema(1000),
  whyNot10: z.array(z.strictObject({
    id: identifierSchema,
    element: z.enum(MATHEMATICAL_GRADING_ELEMENTS_V1),
    findingIds: uniqueIdentifiers(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
    overlayAssetIds: uniqueAssetIds(1),
    explanation: safeTextSchema(1000),
  })).max(100),
});

const centeringAxisSchema = z
  .strictObject({
    axis: z.enum(["horizontal", "vertical"]),
    marginAName: z.enum(["left", "top"]),
    marginBName: z.enum(["right", "bottom"]),
    marginAPx: z.number().finite().nonnegative(),
    marginBPx: z.number().finite().nonnegative(),
    marginAMm: z.number().finite().nonnegative(),
    marginBMm: z.number().finite().nonnegative(),
    measuredDifferenceMm: z.number().finite().nonnegative(),
    u95Mm: z.number().finite().nonnegative(),
    u95Components: mathematicalMeasurementUncertaintyComponentsV1Schema,
    boundaryFitU95Mm: z.number().finite().nonnegative().optional(),
    effectiveDifferenceMm: z.number().finite().nonnegative(),
    grade10ToleranceMm: z.number().finite().nonnegative(),
    balanceRatio: z.number().finite().min(0).max(100),
    score: mathematicalScoreV1Schema,
    observedMarginAMm: z.number().finite().nonnegative().optional(),
    observedMarginBMm: z.number().finite().nonnegative().optional(),
    expectedMarginAMm: z.number().finite().nonnegative().optional(),
    expectedMarginBMm: z.number().finite().nonnegative().optional(),
    physicalAxisSpanMm: z.number().finite().positive().optional(),
    axisErrorMm: z.number().finite().optional(),
  })
  .superRefine((axis, context) => {
    const calibratedU95 = combineMeasurementUncertaintyU95(axis.u95Components);
    const expected = Math.round(
      Math.hypot(calibratedU95, axis.boundaryFitU95Mm ?? 0) * 1_000_000,
    ) / 1_000_000;
    if (Math.abs(axis.u95Mm - expected) > 1e-6) {
      context.addIssue({ code: "custom", path: ["u95Mm"], message: "must reproduce the profile-derived and boundary-fit U95 components" });
    }
  });

const centeringRegistrationEvidenceSchema = z.strictObject({
  designReferenceId: identifierSchema,
  designReferenceVersion: z.number().int().positive(),
  designReferenceSha256: sha256Schema,
  normalizedSourceEvidenceId: assetIdSchema,
  normalizedSourceEvidenceSha256: sha256Schema,
  registrationAlgorithmVersion: identifierSchema,
  correspondenceCount: z.number().int().positive(),
  inlierCorrespondenceIds: uniqueIdentifiers(256),
  correspondenceLedgerSha256: sha256Schema,
  correspondenceLedgerAssetId: assetIdSchema,
  registrationSha256: sha256Schema,
});

const observedOuterCutArtifactSchema = z.strictObject({
  schemaVersion: z.literal("fixed-rig-raw-bound-observed-outer-cut-artifact-v1"),
  detectorId: identifierSchema,
  detectorVersion: identifierSchema,
  rawCoordinateFrame: z.literal("auto_oriented_raw_image_pixels"),
  normalizedCoordinateFrame: z.literal("normalized_card_portrait_pixels"),
  rawAllOnAssetId: assetIdSchema,
  rawAllOnAssetSha256: sha256Schema,
  rawAllOnScalarPlaneSha256: sha256Schema,
  rawWidthPx: z.number().int().positive(),
  rawHeightPx: z.number().int().positive(),
  normalizedAllOnAssetId: assetIdSchema,
  normalizedAllOnAssetSha256: sha256Schema,
  normalizedWidthPx: z.number().int().positive(),
  normalizedHeightPx: z.number().int().positive(),
  rawToNormalizedTransformSha256: sha256Schema,
  calibrationProfileId: identifierSchema,
  calibrationVersion: identifierSchema,
  calibrationSha256: sha256Schema,
  pixelsPerMmX: z.number().finite().positive(),
  pixelsPerMmY: z.number().finite().positive(),
  segmentationBoundaryU95Px: z.number().finite().positive(),
  intendedBoundaryArtifactSha256: sha256Schema,
  intendedBoundaryProfileId: identifierSchema,
  intendedBoundaryProfileVersion: identifierSchema,
  rawContour: z.array(z.strictObject({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
  })).min(4).max(10000),
  normalizedContour: z.array(z.strictObject({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
  })).min(4).max(10000),
  crossSectionCount: z.number().int().positive(),
  supportedCrossSectionCount: z.number().int().positive(),
  minimumGradientDigitalUnits: z.number().finite().nonnegative(),
  meanDetectedGradientDigitalUnits: z.number().finite().nonnegative(),
  minimumDetectedGradientDigitalUnits: z.number().finite().nonnegative(),
  confidence: fractionSchema,
  u95ComponentsMm: z.strictObject({
    calibratedSegmentationBoundary: z.number().finite().nonnegative(),
    rawDetectorLocalization: z.number().finite().nonnegative(),
  }),
  u95Mm: z.number().finite().nonnegative(),
  artifactSha256: sha256Schema,
});

const centeringSideEvidenceSchema = z
  .strictObject({
    side: z.enum(["front", "back"]),
    profile: z.enum(["printed_border_v1", "registered_design_template_v1"]),
    score: mathematicalScoreV1Schema,
    horizontal: centeringAxisSchema,
    vertical: centeringAxisSchema,
    outerCutContourAssetId: assetIdSchema,
    printedDesignContourAssetId: assetIdSchema,
    measurementOverlayAssetId: assetIdSchema,
    registration: mathematicalCenteringRegistrationV1Schema,
    registrationEvidence: centeringRegistrationEvidenceSchema.optional(),
    outerCutGeometryEvidence: z.strictObject({
      coordinateFrame: z.literal("normalized_card_portrait_pixels"),
      observedContourSha256: sha256Schema,
      intendedContourSha256: sha256Schema,
      intendedBoundaryProfileId: identifierSchema,
      intendedBoundaryProfileVersion: identifierSchema,
      observedContourPointCount: z.number().int().min(4).max(10000),
      intendedContourPointCount: z.number().int().min(4).max(10000),
      observedContourDetectorId: identifierSchema,
      observedContourDetectorVersion: identifierSchema,
      rawAllOnAssetId: assetIdSchema,
      rawAllOnAssetSha256: sha256Schema,
      rawAllOnScalarPlaneSha256: sha256Schema,
      rawToNormalizedTransformSha256: sha256Schema,
      normalizedAllOnAssetId: assetIdSchema,
      normalizedAllOnAssetSha256: sha256Schema,
      boundaryConfidence: fractionSchema,
      boundaryU95Mm: z.number().finite().nonnegative(),
      observedArtifact: observedOuterCutArtifactSchema,
    }),
    evidenceAssetIds: uniqueAssetIds(1),
  })
  .superRefine((side, context) => {
    if (side.registration.profile !== side.profile) {
      context.addIssue({ code: "custom", path: ["registration", "profile"], message: "must match the centering profile" });
    }
    if (side.profile === "registered_design_template_v1") {
      if (!side.registrationEvidence) {
        context.addIssue({ code: "custom", path: ["registrationEvidence"], message: "registered design centering requires the exact correspondence-ledger and registration hashes" });
      } else if (
        side.registration.designReferenceId !== side.registrationEvidence.designReferenceId ||
        side.registration.designReferenceSha256 !== side.registrationEvidence.designReferenceSha256 ||
        !side.evidenceAssetIds.some((assetId) =>
          assetId.toLowerCase() === side.registrationEvidence!.normalizedSourceEvidenceId.toLowerCase())
      ) {
        context.addIssue({ code: "custom", path: ["registrationEvidence"], message: "must match registration identity/hash and published normalized-source evidence" });
      }
    } else if (side.registrationEvidence) {
      context.addIssue({ code: "custom", path: ["registrationEvidence"], message: "printed-border centering must not claim design-template registration evidence" });
    }
  });

const centeringEvidenceSchema = z.strictObject({
  front: centeringSideEvidenceSchema,
  back: centeringSideEvidenceSchema,
  fusedScore: mathematicalScoreV1Schema,
  deduction: nonnegativeTwoDecimalSchema.max(MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION),
  formula: safeTextSchema(1000),
  balanceCurve: z.array(z.strictObject({
    ratio: z.number().finite().min(0).max(100),
    score: mathematicalScoreV1Schema,
  })).min(2).max(32),
});

const conditionObservationEvidenceSchema = z
  .strictObject({
    element: z.enum(["corners", "edges"]),
    side: z.enum(["front", "back"]),
    location: identifierSchema,
    regionId: identifierSchema,
    score: mathematicalScoreV1Schema,
    penalty: nonnegativeTwoDecimalSchema.max(MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION),
    validEvidenceCoverage: fractionSchema,
    usableDirectionalChannelCount: z.number().int().min(0).max(64),
    findingIds: uniqueIdentifiers(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
    measurementIds: uniqueIdentifiers(512),
    roiAssetId: assetIdSchema,
    segmentationMaskAssetId: assetIdSchema,
    confidenceMaskAssetId: assetIdSchema,
    illuminationMaskAssetId: assetIdSchema,
    channelAssetIds: uniqueAssetIds(1),
  })
  .superRefine((observation, context) => {
    if (observation.score !== roundMathematicalScoreV1(10 - observation.penalty)) {
      context.addIssue({ code: "custom", path: ["score"], message: "must equal clamp(10 - observation penalty, 1, 10)" });
    }
  });

const evidenceQualityLimitationSchema = z.strictObject({
  limitationId: identifierSchema,
  side: z.enum(["front", "back"]),
  regionId: identifierSchema,
  classification: z.enum([
    "clipping",
    "underexposure",
    "common_mode_specular_glare",
    "low_confidence",
    "insufficient_directional_observations",
    "ungradable",
  ]),
  validEvidenceCoverage: fractionSchema,
  excludedPixelFraction: fractionSchema,
  recoveredFromAlternateChannels: z.boolean(),
  recaptureRequired: z.boolean(),
  deduction: z.literal(0),
  evidenceAssetIds: uniqueAssetIds(1),
  explanation: safeTextSchema(1000),
});

const cardIdentitySchema = z.strictObject({
  title: safeTextSchema(300),
  sideCount: z.literal(2),
  tenantId: identifierSchema.optional(),
  cardAssetId: identifierSchema.optional(),
  itemId: identifierSchema.optional(),
  set: safeTextSchema(300).optional(),
  setId: identifierSchema.optional(),
  programId: identifierSchema.optional(),
  cardNumber: safeTextSchema(128).optional(),
  variantId: identifierSchema.nullable().optional(),
  parallelId: identifierSchema.nullable().optional(),
});

const gradingStandardSchema = z.strictObject({
  id: z.literal("mathematical_calibration_v1"),
  thresholdSetId: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID),
  thresholdSetHash: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH),
  algorithmVersion: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.algorithmVersion),
  defectFindingSchemaVersion: z.literal(AI_GRADER_DEFECT_FINDING_V2_VERSION),
  designReferenceSchemaVersion: z.literal(MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION),
});

const pokemonStandardCornerMeasurementSchema = z.strictObject({
  side: z.enum(["front", "back"]),
  location: z.enum(["top_left", "top_right", "bottom_right", "bottom_left"]),
  profileId: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_ID),
  profileVersion: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION),
  profileArtifactSha256: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256),
  expectedRadiusMm: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_RADIUS_MM),
  measuredContourDeviationMm: z.number().finite().nonnegative(),
  calibratedU95Mm: z.number().finite().nonnegative(),
  effectiveContourDeviationMm: z.number().finite().nonnegative(),
  grade10ToleranceMm: z.number().finite().nonnegative(),
  thresholdDecision: z.enum(["within_grade_10_buffer", "deducted"]),
  thresholdDeduction: nonnegativeTwoDecimalSchema,
  appliedContourDeduction: nonnegativeTwoDecimalSchema,
  measurementId: identifierSchema,
  sourceImageAssetId: assetIdSchema,
  sourceImageSha256: sha256Schema,
  observedContourSha256: sha256Schema,
  intendedContourSha256: sha256Schema,
  contourFindingIds: uniqueIdentifiers(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
  damageFindingIds: z.strictObject({
    whitening: uniqueIdentifiers(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
    chippingOrMaterialLoss: uniqueIdentifiers(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
    deformation: uniqueIdentifiers(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
    delamination: uniqueIdentifiers(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
    otherVisibleDamage: uniqueIdentifiers(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
  }),
});

const pokemonStandardCornerAuthoritySchema = z.strictObject({
  profile: pokemonTcgStandardCornerProfileV1Schema,
  profileArtifactSha256: z.literal(POKEMON_TCG_STANDARD_CORNER_PROFILE_SHA256),
  trustedCardFormatAuthority: trustedPokemonCardFormatAuthorityV1Schema,
  productionMeasurementAuthority: z.strictObject({
    schemaVersion: z.literal(POKEMON_TCG_STANDARD_MEASUREMENT_AUTHORITY_SCHEMA_VERSION),
    artifact: z.strictObject({
      gradingSessionId: reportIdSchema,
      reportId: reportIdSchema,
      analyzerVersions: z.strictObject({
        conditionSegmentation: z.literal("fixed_rig_condition_segmentation_v1.2.0"),
        cornerMeasurement: z.literal("fixed_rig_corner_edge_v1"),
        stationAdapter: z.literal("fixed_rig_mathematical_station_adapter_v1"),
      }),
      thresholdSetId: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID),
      thresholdSetHash: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH),
      calibration: z.strictObject({
        profileId: identifierSchema,
        version: identifierSchema,
        artifactSha256: sha256Schema,
        bundleManifestSha256: sha256Schema,
        sourceCaptureManifestSha256: sha256Schema,
        memberLedgerSha256: sha256Schema,
      }),
      callerCreatedProfilesAccepted: z.literal(false),
      callerCreatedMeasurementsAccepted: z.literal(false),
      measurements: z.array(pokemonStandardCornerMeasurementSchema).length(8),
    }),
    artifactSha256: sha256Schema,
    authentication: z.strictObject({
      algorithm: z.literal("hmac-sha256"),
      keyId: identifierSchema,
      signature: sha256Schema,
    }),
  }),
});

const calibrationBundleAuthorityMemberSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.enum(["calibration_profile", "physical_calibration_artifact", "calibration_acceptance", "illumination_pattern"]),
    fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/),
    sha256: sha256Schema,
  }),
  z.strictObject({
    role: z.literal("flat_field"),
    channelIndex: z.number().int().min(1).max(8),
    fileName: z.string().regex(/^flat-field-channel-[1-8]-v1\.json$/),
    sha256: sha256Schema,
  }),
]);

const calibrationBundleAuthoritySchema = z.strictObject({
  schemaVersion: z.literal("ten-kings-mathematical-calibration-bundle-v1"),
  bundleManifestSha256: sha256Schema,
  sourceCaptureManifestSha256: sha256Schema,
  memberLedgerSha256: sha256Schema,
  members: z.array(calibrationBundleAuthorityMemberSchema).length(12),
  captureContractVersion: z.literal("1.2.0").optional(),
  runtimeContextSha256: sha256Schema.optional(),
  rigCharacterizationSha256: sha256Schema.optional(),
}).superRefine((authority, context) => {
  const values = [
    authority.captureContractVersion,
    authority.runtimeContextSha256,
    authority.rigCharacterizationSha256,
  ];
  const present = values.filter((value) => value !== undefined).length;
  if (present !== 0 && present !== values.length) {
    context.addIssue({
      code: "custom",
      message: "V1.2 calibration bundle authority requires the exact contract, runtime-context, and rig-characterization hashes together",
    });
  }
});

export const aiGraderReportBundleV03Schema = z
  .strictObject({
    schemaVersion: z.literal(AI_GRADER_REPORT_BUNDLE_V03_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    reportId: reportIdSchema,
    certifiedClaim: z.literal(false),
    cardIdentity: cardIdentitySchema,
    gradingStandard: gradingStandardSchema,
    pokemonStandardCornerAuthority: pokemonStandardCornerAuthoritySchema.optional(),
    productionRelease: z.strictObject({
      finalGrade: finalGradeSchema,
      label: z.strictObject({
        certId: safeTextSchema(128),
        labelGradeText: z.string().regex(/^(?:10\.0|[1-9]\.\d)$/),
        publicReportUrl: aiGraderSafePublishedUrlSchema,
        qrPayloadUrl: aiGraderSafePublishedUrlSchema,
      }),
      publication: z.strictObject({ publicReportUrl: aiGraderSafePublishedUrlSchema }),
    }),
    calibrationProfile: mathematicalCalibrationProfileV1Schema,
    calibrationBundleAuthority: calibrationBundleAuthoritySchema,
    designReferences: z.array(mathematicalDesignReferenceV1Schema).max(10),
    centeringEvidence: centeringEvidenceSchema,
    conditionObservationEvidence: z.strictObject({
      corners: z.array(conditionObservationEvidenceSchema).length(8),
      edges: z.array(conditionObservationEvidenceSchema).length(8),
    }),
    defectFindings: z.array(aiGraderPublishedDefectFindingV2Schema).max(AI_GRADER_DEFECT_FINDING_MAX_COUNT),
    deductionLedger: mathematicalDeductionLedgerV1Schema,
    evidenceQualityLimitations: z.array(evidenceQualityLimitationSchema).max(200),
    publicAssets: z.array(aiGraderPublishedAssetV03Schema).max(1000),
    geometry: z.record(z.string(), z.unknown()).optional(),
    geometryCaptureDecisions: z.record(z.string(), z.unknown()).optional(),
    captureTiming: z.record(z.string(), z.unknown()).optional(),
    ocrPrefill: z.record(z.string(), z.unknown()).optional(),
    warnings: z.array(safeTextSchema(500)).max(100).optional(),
    limitations: z.array(safeTextSchema(500)).max(100).optional(),
  })
  .superRefine((bundle, context) => {
    const calibration = validateMathematicalCalibrationProfileV1(bundle.calibrationProfile);
    if (!calibration.valid || !calibration.isCalibrated) {
      context.addIssue({ code: "custom", path: ["calibrationProfile"], message: "must satisfy every calibrated V1 acceptance criterion" });
    }
    const intendedProfileIds = new Set([
      bundle.centeringEvidence.front.outerCutGeometryEvidence.intendedBoundaryProfileId,
      bundle.centeringEvidence.back.outerCutGeometryEvidence.intendedBoundaryProfileId,
    ]);
    const pokemonProfileSelected = intendedProfileIds.has(POKEMON_TCG_STANDARD_CORNER_PROFILE_ID);
    if (pokemonProfileSelected &&
        (intendedProfileIds.size !== 1 ||
          bundle.centeringEvidence.front.outerCutGeometryEvidence.intendedBoundaryProfileVersion !==
            POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION ||
          bundle.centeringEvidence.back.outerCutGeometryEvidence.intendedBoundaryProfileVersion !==
            POKEMON_TCG_STANDARD_CORNER_PROFILE_VERSION)) {
      context.addIssue({
        code: "custom",
        path: ["centeringEvidence"],
        message: "both sides must use the exact same Pokémon standard contour profile and version",
      });
    }
    const pokemonAuthority = bundle.pokemonStandardCornerAuthority;
    if (pokemonProfileSelected && !pokemonAuthority) {
      context.addIssue({
        code: "custom",
        path: ["pokemonStandardCornerAuthority"],
        message: "the Pokémon standard contour requires its exact trusted profile and measurement provenance",
      });
    }
    if (!pokemonProfileSelected && pokemonAuthority) {
      context.addIssue({
        code: "custom",
        path: ["pokemonStandardCornerAuthority"],
        message: "must not be present when the Pokémon standard contour was not selected",
      });
    }
    if (pokemonAuthority) {
      const production = pokemonAuthority.productionMeasurementAuthority.artifact;
      const trustedIdentity = pokemonAuthority.trustedCardFormatAuthority.artifact.cardIdentity;
      const exactIdentityMatches =
        trustedIdentity.tenantId === bundle.cardIdentity.tenantId &&
        trustedIdentity.setId === bundle.cardIdentity.setId &&
        trustedIdentity.programId === bundle.cardIdentity.programId &&
        trustedIdentity.cardNumber === bundle.cardIdentity.cardNumber &&
        trustedIdentity.variantId === bundle.cardIdentity.variantId &&
        trustedIdentity.parallelId === bundle.cardIdentity.parallelId &&
        trustedIdentity.title === bundle.cardIdentity.title &&
        trustedIdentity.sideCount === bundle.cardIdentity.sideCount;
      if (!exactIdentityMatches ||
          production.reportId !== bundle.reportId ||
          production.calibration.profileId !== bundle.calibrationProfile.profileId ||
          production.calibration.version !== bundle.calibrationProfile.calibrationVersion ||
          production.calibration.artifactSha256 !== bundle.calibrationProfile.artifactSha256 ||
          production.calibration.bundleManifestSha256 !== bundle.calibrationBundleAuthority.bundleManifestSha256 ||
          production.calibration.sourceCaptureManifestSha256 !== bundle.calibrationBundleAuthority.sourceCaptureManifestSha256 ||
          production.calibration.memberLedgerSha256 !== bundle.calibrationBundleAuthority.memberLedgerSha256) {
        context.addIssue({
          code: "custom",
          path: ["pokemonStandardCornerAuthority"],
          message: "must bind the exact trusted card, report, calibration, and complete bundle authority",
        });
      }
      const expectedLocations = ["top_left", "top_right", "bottom_right", "bottom_left"];
      const expectedKeys = new Set(
        ["front", "back"].flatMap((side) => expectedLocations.map((location) => `${side}:${location}`)),
      );
      const actualKeys = production.measurements.map((entry) => `${entry.side}:${entry.location}`);
      if (new Set(actualKeys).size !== 8 || actualKeys.some((key) => !expectedKeys.has(key))) {
        context.addIssue({
          code: "custom",
          path: ["pokemonStandardCornerAuthority", "productionMeasurementAuthority", "measurements"],
          message: "must contain one independent result for every front/back physical corner",
        });
      }
      const findings = new Map(bundle.defectFindings.map((finding) => [finding.findingId, finding]));
      for (const [index, measurement] of production.measurements.entries()) {
        const sideGeometry = bundle.centeringEvidence[measurement.side].outerCutGeometryEvidence;
        const observed = sideGeometry.observedArtifact;
        const calculation = calculateFindingDeductionV1({
          category: "corner_shape_deviation",
          measuredMeasurement: measurement.measuredContourDeviationMm,
          u95: measurement.calibratedU95Mm,
        });
        const expectedEffective = Math.round(
          Math.max(0, measurement.measuredContourDeviationMm - measurement.calibratedU95Mm) * 1e6,
        ) / 1e6;
        const expectedDecision = calculation.deductionBasisMeasurement === 0
          ? "within_grade_10_buffer"
          : "deducted";
        if (measurement.sourceImageAssetId !== observed.rawAllOnAssetId ||
            measurement.sourceImageSha256 !== observed.rawAllOnAssetSha256 ||
            measurement.observedContourSha256 !== observed.artifactSha256 ||
            measurement.intendedContourSha256 !== observed.intendedBoundaryArtifactSha256 ||
            measurement.grade10ToleranceMm !==
              MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings.corner_shape_deviation.grade10Tolerance ||
            measurement.effectiveContourDeviationMm !== expectedEffective ||
            measurement.thresholdDecision !== expectedDecision ||
            measurement.thresholdDeduction !== calculation.deduction ||
            measurement.appliedContourDeduction > measurement.thresholdDeduction) {
          context.addIssue({
            code: "custom",
            path: ["pokemonStandardCornerAuthority", "productionMeasurementAuthority", "measurements", index],
            message: "must reproduce the calibrated contour/U95 threshold result and exact source contour hashes",
          });
        }
        const categoryGroups: Array<[readonly string[], Set<string>]> = [
          [measurement.contourFindingIds, new Set(["corner_shape_deviation"])],
          [measurement.damageFindingIds.whitening, new Set(["corner_whitening"])],
          [measurement.damageFindingIds.chippingOrMaterialLoss, new Set(["corner_chip", "corner_material_loss"])],
          [measurement.damageFindingIds.deformation, new Set(["corner_deformation"])],
          [measurement.damageFindingIds.delamination, new Set(["corner_delamination"])],
          [measurement.damageFindingIds.otherVisibleDamage, new Set(["corner_directional_relief"])],
        ];
        for (const [findingIds, allowed] of categoryGroups) {
          if (findingIds.some((findingId) => {
            const finding = findings.get(findingId);
            return !finding || finding.side !== measurement.side || finding.location !== measurement.location ||
              (!allowed.has(finding.category) &&
                !finding.secondaryEvidenceCategories.some((category) => allowed.has(category)));
          })) {
            context.addIssue({
              code: "custom",
              path: ["pokemonStandardCornerAuthority", "productionMeasurementAuthority", "measurements", index],
              message: "contour deviation and each visible damage category must remain separately classified",
            });
          }
        }
      }
    }
    const expectedAuthorityMembers = [
      { role: "calibration_profile", fileName: "mathematical-calibration-profile-v1.json" },
      { role: "physical_calibration_artifact", fileName: "mathematical-calibration-artifact-v1.json" },
      { role: "calibration_acceptance", fileName: "mathematical-calibration-acceptance-v1.json" },
      ...Array.from({ length: 8 }, (_, index) => ({
        role: "flat_field",
        channelIndex: index + 1,
        fileName: "flat-field-channel-" + (index + 1) + "-v1.json",
      })),
      { role: "illumination_pattern", fileName: "illumination-pattern-v1.json" },
    ] as const;
    expectedAuthorityMembers.forEach((expected, index) => {
      const member = bundle.calibrationBundleAuthority.members[index];
      if (
        !member || member.role !== expected.role || member.fileName !== expected.fileName ||
        (expected.role === "flat_field" && (member.role !== "flat_field" || member.channelIndex !== expected.channelIndex))
      ) {
        context.addIssue({ code: "custom", path: ["calibrationBundleAuthority", "members", index], message: "must preserve the exact verified calibration-bundle member order, role, channel, and file name" });
      }
    });
    const flatFieldMembers = new Map(
      bundle.calibrationBundleAuthority.members
        .filter((member) => member.role === "flat_field")
        .map((member) => [member.channelIndex, member.sha256]),
    );
    for (const channel of bundle.calibrationProfile.channels) {
      if (flatFieldMembers.get(channel.channelIndex) !== channel.flatFieldArtifactSha256) {
        context.addIssue({ code: "custom", path: ["calibrationBundleAuthority", "members"], message: "flat-field member must match the finalized calibration profile channel" });
      }
    }
    const illuminationMember = bundle.calibrationBundleAuthority.members.find((member) => member.role === "illumination_pattern");
    if (
      !illuminationMember ||
      bundle.calibrationProfile.channels.some((channel) => channel.illuminationPatternArtifactSha256 !== illuminationMember.sha256)
    ) {
      context.addIssue({ code: "custom", path: ["calibrationBundleAuthority", "members"], message: "illumination-pattern member must match every finalized calibration-profile channel" });
    }

    const assetsById = new Map<string, (typeof bundle.publicAssets)[number]>();
    bundle.publicAssets.forEach((asset, index) => {
      const key = asset.id.toLowerCase();
      if (assetsById.has(key)) {
        context.addIssue({ code: "custom", path: ["publicAssets", index, "id"], message: "must be unique case-insensitively" });
      }
      assetsById.set(key, asset);
    });
    const requireAsset = (assetId: string, path: Array<string | number>) => {
      if (!assetsById.has(assetId.toLowerCase())) {
        context.addIssue({ code: "custom", path, message: "must reference an asset in publicAssets" });
      }
    };
    const requireAssetRole = (
      assetId: string | undefined,
      side: "front" | "back",
      role: string,
      path: Array<string | number>,
    ) => {
      if (!assetId) return;
      requireAsset(assetId, path);
      const asset = assetsById.get(assetId.toLowerCase());
      if (asset && (asset.side !== side || asset.evidenceRole !== role)) {
        context.addIssue({ code: "custom", path, message: `must reference a ${side} ${role} asset` });
      }
    };

    const findingsById = new Map<string, (typeof bundle.defectFindings)[number]>();
    const physicalDefectIds = new Set<string>();
    bundle.defectFindings.forEach((finding, index) => {
      const findingKey = finding.findingId.toLowerCase();
      const physicalKey = finding.physicalDefectId.toLowerCase();
      if (findingsById.has(findingKey)) {
        context.addIssue({ code: "custom", path: ["defectFindings", index, "findingId"], message: "must be unique case-insensitively" });
      }
      if (physicalDefectIds.has(physicalKey)) {
        context.addIssue({ code: "custom", path: ["defectFindings", index, "physicalDefectId"], message: "a physical defect may deduct only once" });
      }
      findingsById.set(findingKey, finding);
      physicalDefectIds.add(physicalKey);
      if (finding.evidenceQuality === "insufficient") {
        context.addIssue({ code: "custom", path: ["defectFindings", index, "evidenceQuality"], message: "a final calibrated V1 report cannot score an insufficient-evidence finding; recapture is required" });
      }
      if (finding.review.status !== "confirmed" && finding.review.status !== "adjusted") {
        context.addIssue({
          code: "custom",
          path: ["defectFindings", index, "review", "status"],
          message: "a final calibrated V1 report requires an explicit confirmed or adjusted human finding review",
        });
      }
      const evidenceIds = [
        finding.evidence.trueViewAssetId,
        finding.evidence.overlayAssetId,
        finding.evidence.segmentationMaskAssetId,
        finding.evidence.confidenceMaskAssetId,
        finding.evidence.illuminationMaskAssetId,
        finding.evidence.heatmapAssetId,
        finding.evidence.surfaceVisionAssetId,
        ...finding.evidence.channelAssetIds,
        ...finding.evidence.roiAssetIds,
        ...(finding.evidence.additionalEvidenceAssetIds ?? []),
      ].filter((entry): entry is string => Boolean(entry));
      evidenceIds.forEach((assetId) => requireAsset(assetId, ["defectFindings", index, "evidence"]));
      requireAssetRole(finding.evidence.trueViewAssetId, finding.side, "normalized_card", ["defectFindings", index, "evidence", "trueViewAssetId"]);
      requireAssetRole(finding.evidence.overlayAssetId, finding.side, "deduction_overlay", ["defectFindings", index, "evidence", "overlayAssetId"]);
      requireAssetRole(finding.evidence.segmentationMaskAssetId, finding.side, "segmentation_mask", ["defectFindings", index, "evidence", "segmentationMaskAssetId"]);
      requireAssetRole(finding.evidence.confidenceMaskAssetId, finding.side, "confidence_mask", ["defectFindings", index, "evidence", "confidenceMaskAssetId"]);
      requireAssetRole(finding.evidence.illuminationMaskAssetId, finding.side, "illumination_mask", ["defectFindings", index, "evidence", "illuminationMaskAssetId"]);
      finding.evidence.channelAssetIds.forEach((assetId, assetIndex) => {
        requireAssetRole(assetId, finding.side, "directional_channel", ["defectFindings", index, "evidence", "channelAssetIds", assetIndex]);
      });
      finding.evidence.roiAssetIds.forEach((assetId, assetIndex) => {
        requireAssetRole(assetId, finding.side, "roi_crop", ["defectFindings", index, "evidence", "roiAssetIds", assetIndex]);
      });
      finding.measurements.forEach((measurement, measurementIndex) => {
        measurement.evidence.forEach((binding, bindingIndex) => {
          const asset = assetsById.get(binding.assetId.toLowerCase());
          const assetHash = asset?.sha256 ?? asset?.checksumSha256;
          if (!assetHash || assetHash.toLowerCase() !== binding.sha256.toLowerCase()) {
            context.addIssue({
              code: "custom",
              path: ["defectFindings", index, "measurements", measurementIndex, "evidence", bindingIndex, "sha256"],
              message: "must match the immutable published evidence asset hash",
            });
          }
        });
      });
    });

    const ledgerByFinding = new Map(bundle.deductionLedger.entries.map((entry) => [entry.findingId.toLowerCase(), entry]));
    bundle.defectFindings.forEach((finding, index) => {
      const ledger = ledgerByFinding.get(finding.findingId.toLowerCase());
      if (!ledger) {
        context.addIssue({ code: "custom", path: ["defectFindings", index, "findingId"], message: "must have one deduction-ledger entry" });
        return;
      }
      const basis = finding.measurements.find((measurement) =>
        measurement.measurementId.toLowerCase() === finding.deductionBasisMeasurementId.toLowerCase()
      );
      const basisEvidenceIds = new Set(
        (basis?.evidence ?? []).map((binding) => binding.assetId.toLowerCase()),
      );
      const ledgerEvidenceIds = new Set(
        ledger.evidenceAssetIds.map((assetId) => assetId.toLowerCase()),
      );
      if (
        !basis ||
        ledger.physicalDefectId.toLowerCase() !== finding.physicalDefectId.toLowerCase() ||
        ledger.element !== finding.primaryElement ||
        ledger.deduction !== finding.deduction ||
        ledger.category !== finding.category ||
        ledger.measurementId.toLowerCase() !== finding.deductionBasisMeasurementId.toLowerCase() ||
        ledger.measuredMeasurement !== basis.measuredMeasurement ||
        ledger.unit !== basis.unit ||
        ledger.u95 !== basis.u95 ||
        ledger.grade10Tolerance !== basis.explicitGrade10Tolerance ||
        ledger.effectiveMeasurement !== basis.effectiveMeasurement ||
        ledger.normalizedSeverity !== finding.severity.normalized ||
        basisEvidenceIds.size !== ledgerEvidenceIds.size ||
        [...basisEvidenceIds].some((assetId) => !ledgerEvidenceIds.has(assetId)) ||
        ledger.calibrationProfileId !== finding.calibrationProfileId ||
        ledger.calibrationVersion !== finding.calibrationVersion ||
        ledger.algorithmVersion !== finding.detector.algorithmVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["deductionLedger", "entries"],
          message: "must exactly match the finding's deduction-basis measurement, calculation, immutable evidence, and provenance",
        });
      }
      ledger.evidenceAssetIds.forEach((assetId) => requireAsset(assetId, ["deductionLedger", "entries", "evidenceAssetIds"]));
    });
    bundle.deductionLedger.entries.forEach((entry, index) => {
      if (!findingsById.has(entry.findingId.toLowerCase())) {
        context.addIssue({ code: "custom", path: ["deductionLedger", "entries", index, "findingId"], message: "must reference a published V2 finding" });
      }
    });

    for (const [sideName, side] of [["front", bundle.centeringEvidence.front], ["back", bundle.centeringEvidence.back]] as const) {
      if (side.side !== sideName) {
        context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, "side"], message: `must be ${sideName}` });
      }
      for (const [axisName, axis] of [["horizontal", side.horizontal], ["vertical", side.vertical]] as const) {
        if (axis.axis !== axisName) {
          context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, axisName, "axis"], message: `must be ${axisName}` });
        }
        if (axis.grade10ToleranceMm !== MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.grade10Tolerance.marginDifferenceMm) {
          context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, axisName, "grade10ToleranceMm"], message: "must match the manifest Grade-10 centering tolerance" });
        }
        let calculation;
        try {
          calculation = side.profile === "registered_design_template_v1" &&
            axis.observedMarginAMm !== undefined && axis.observedMarginBMm !== undefined &&
            axis.expectedMarginAMm !== undefined && axis.expectedMarginBMm !== undefined &&
            axis.physicalAxisSpanMm !== undefined
            ? calculateRegisteredDesignTemplateAxisV1({
                observedMarginA: axis.observedMarginAMm,
                observedMarginB: axis.observedMarginBMm,
                expectedMarginA: axis.expectedMarginAMm,
                expectedMarginB: axis.expectedMarginBMm,
                physicalAxisSpan: axis.physicalAxisSpanMm,
                differenceU95: axis.u95Mm,
              })
            : side.profile === "printed_border_v1"
              ? calculateCenteringAxisV1(axis.marginAMm, axis.marginBMm, axis.u95Mm)
              : undefined;
        } catch {
          calculation = undefined;
        }
        if (!calculation) {
          context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, axisName], message: "registered-template centering requires observed and approved expected margins plus physical axis span" });
        } else if (
          axis.measuredDifferenceMm !== calculation.measuredDifference ||
          axis.effectiveDifferenceMm !== calculation.effectiveDifference ||
          axis.balanceRatio !== calculation.balanceRatio ||
          axis.score !== calculation.score ||
          Math.abs(axis.marginAMm - calculation.marginA) > 1e-6 ||
          Math.abs(axis.marginBMm - calculation.marginB) > 1e-6 ||
          ("axisError" in calculation && axis.axisErrorMm !== calculation.axisError)
        ) {
          context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, axisName], message: "must match the profile-specific U95-adjusted margin calculation and balance curve" });
        }
        const mmPerPixel = axisName === "horizontal"
          ? bundle.calibrationProfile.mmPerPixelX
          : bundle.calibrationProfile.mmPerPixelY;
        if (
          Math.abs(axis.marginAPx * mmPerPixel - axis.marginAMm) > 0.0001 ||
          Math.abs(axis.marginBPx * mmPerPixel - axis.marginBMm) > 0.0001
        ) {
          context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, axisName], message: "pixel and millimeter margins must match the finalized calibration scale" });
        }
      }
      if (side.score !== Math.min(side.horizontal.score, side.vertical.score)) {
        context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, "score"], message: "must use the worse axis" });
      }
      requireAssetRole(side.outerCutContourAssetId, sideName, "outer_cut_contour", ["centeringEvidence", sideName, "outerCutContourAssetId"]);
      requireAssetRole(side.printedDesignContourAssetId, sideName, "printed_design_contour", ["centeringEvidence", sideName, "printedDesignContourAssetId"]);
      requireAssetRole(side.measurementOverlayAssetId, sideName, "centering_overlay", ["centeringEvidence", sideName, "measurementOverlayAssetId"]);
      side.evidenceAssetIds.forEach((assetId) => requireAsset(assetId, ["centeringEvidence", sideName, "evidenceAssetIds"]));
      const geometry = side.outerCutGeometryEvidence;
      const observed = geometry.observedArtifact;
      const rawAllOnAsset = assetsById.get(geometry.rawAllOnAssetId.toLowerCase());
      const rawAllOnAssetHash = rawAllOnAsset?.sha256 ?? rawAllOnAsset?.checksumSha256;
      const allOnAsset = assetsById.get(geometry.normalizedAllOnAssetId.toLowerCase());
      const allOnAssetHash = allOnAsset?.sha256 ?? allOnAsset?.checksumSha256;
      if (
        geometry.observedContourSha256 !== observed.artifactSha256 ||
        geometry.intendedContourSha256 !== observed.intendedBoundaryArtifactSha256 ||
        geometry.intendedBoundaryProfileId !== observed.intendedBoundaryProfileId ||
        geometry.intendedBoundaryProfileVersion !== observed.intendedBoundaryProfileVersion ||
        geometry.observedContourPointCount !== observed.normalizedContour.length ||
        geometry.observedContourDetectorId !== observed.detectorId ||
        geometry.observedContourDetectorVersion !== observed.detectorVersion ||
        geometry.rawAllOnAssetId !== observed.rawAllOnAssetId ||
        geometry.rawAllOnAssetSha256 !== observed.rawAllOnAssetSha256 ||
        geometry.rawAllOnScalarPlaneSha256 !== observed.rawAllOnScalarPlaneSha256 ||
        geometry.rawToNormalizedTransformSha256 !== observed.rawToNormalizedTransformSha256 ||
        geometry.normalizedAllOnAssetId !== observed.normalizedAllOnAssetId ||
        geometry.normalizedAllOnAssetSha256 !== observed.normalizedAllOnAssetSha256 ||
        geometry.boundaryConfidence !== observed.confidence ||
        geometry.boundaryU95Mm !== observed.u95Mm ||
        observed.supportedCrossSectionCount !== observed.crossSectionCount ||
        observed.normalizedWidthPx !== bundle.calibrationProfile.normalizedWidthPx ||
        observed.normalizedHeightPx !== bundle.calibrationProfile.normalizedHeightPx ||
        observed.calibrationProfileId !== bundle.calibrationProfile.profileId ||
        observed.calibrationVersion !== bundle.calibrationProfile.calibrationVersion ||
        observed.calibrationSha256 !== bundle.calibrationProfile.artifactSha256 ||
        Math.abs(observed.pixelsPerMmX - 1 / bundle.calibrationProfile.mmPerPixelX) > 1e-9 ||
        Math.abs(observed.pixelsPerMmY - 1 / bundle.calibrationProfile.mmPerPixelY) > 1e-9 ||
        observed.segmentationBoundaryU95Px !== bundle.calibrationProfile.segmentationBoundaryU95Px ||
        !rawAllOnAssetHash ||
        rawAllOnAssetHash.toLowerCase() !== observed.rawAllOnAssetSha256.toLowerCase() ||
        !allOnAssetHash ||
        allOnAssetHash.toLowerCase() !== observed.normalizedAllOnAssetSha256.toLowerCase() ||
        !side.evidenceAssetIds.some((assetId) =>
          assetId.toLowerCase() === observed.rawAllOnAssetId.toLowerCase()) ||
        !side.evidenceAssetIds.some((assetId) =>
          assetId.toLowerCase() === observed.normalizedAllOnAssetId.toLowerCase()) ||
        observed.rawContour.some((point) =>
          point.x > observed.rawWidthPx || point.y > observed.rawHeightPx) ||
        observed.normalizedContour.some((point) =>
          point.x > observed.normalizedWidthPx || point.y > observed.normalizedHeightPx)
      ) {
        context.addIssue({
          code: "custom",
          path: ["centeringEvidence", sideName, "outerCutGeometryEvidence"],
          message: "must retain the exact source-, calibration-, intended-format-, detector-, scale-, U95-, and contour-bound observed outer-cut artifact",
        });
      }
      if (side.registration.profile !== side.profile) {
        context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, "registration", "profile"], message: "must match the selected centering profile" });
      }
      if (side.profile === "registered_design_template_v1") {
        const ledgerAsset = side.registrationEvidence
          ? assetsById.get(side.registrationEvidence.correspondenceLedgerAssetId.toLowerCase())
          : undefined;
        const ledgerAssetHash = ledgerAsset?.sha256 ?? ledgerAsset?.checksumSha256;
        if (
          !side.registrationEvidence ||
          !ledgerAsset ||
          ledgerAsset.evidenceRole !== "other_evidence" ||
          ledgerAsset.contentType !== "application/json" ||
          ledgerAssetHash?.toLowerCase() !==
            side.registrationEvidence.correspondenceLedgerSha256.toLowerCase() ||
          !side.evidenceAssetIds.some((assetId) =>
            assetId.toLowerCase() ===
              side.registrationEvidence!.correspondenceLedgerAssetId.toLowerCase())
        ) {
          context.addIssue({
            code: "custom",
            path: ["centeringEvidence", sideName, "registrationEvidence", "correspondenceLedgerAssetId"],
            message: "must publish the exact SHA-bound full correspondence ledger as immutable JSON evidence",
          });
        }
        const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate;
        if (
          !policy.allowedTransforms.includes(side.registration.transformType as "affine" | "homography") ||
          side.registration.registrationResidualPx > policy.maximumRegistrationResidualPx ||
          side.registration.inlierCount < policy.minimumInlierCount ||
          side.registration.inlierFraction < policy.minimumInlierFraction ||
          side.registration.confidence < policy.minimumRegistrationConfidence
        ) {
          context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, "registration"], message: "must satisfy every registered-template fit acceptance threshold" });
        }
        const exactIdentityPresent =
          bundle.cardIdentity.tenantId !== undefined &&
          bundle.cardIdentity.setId !== undefined &&
          bundle.cardIdentity.programId !== undefined &&
          bundle.cardIdentity.cardNumber !== undefined &&
          bundle.cardIdentity.variantId !== undefined &&
          bundle.cardIdentity.parallelId !== undefined;
        if (!exactIdentityPresent) {
          context.addIssue({
            code: "custom",
            path: ["cardIdentity"],
            message: "registered-template centering requires the exact tenant/set/program/card/variant/parallel identity tuple",
          });
        }
        const designReference = bundle.designReferences.find((reference) =>
          reference.designReferenceId === side.registration.designReferenceId &&
          reference.artifactSha256 === side.registration.designReferenceSha256,
        );
        if (!designReference) {
          context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, "registration"], message: "must bind an exact approved design reference and hash" });
        } else {
          const designReferenceAsset = bundle.publicAssets.find((asset) =>
            asset.side === sideName &&
            asset.evidenceRole === "design_reference" &&
            (asset.sha256 ?? asset.checksumSha256)?.toLowerCase() ===
              designReference.artifactSha256.toLowerCase());
          if (!designReferenceAsset) {
            context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, "registration"], message: "must publish the exact SHA-bound approved design artifact with the design_reference evidence role" });
          }
          if (
            !side.registrationEvidence ||
            side.registrationEvidence.designReferenceVersion !== designReference.version ||
            designReference.side !== sideName ||
            designReference.tenantId !== bundle.cardIdentity.tenantId ||
            designReference.setId !== bundle.cardIdentity.setId ||
            designReference.programId !== bundle.cardIdentity.programId ||
            designReference.cardNumber !== bundle.cardIdentity.cardNumber ||
            designReference.variantId !== bundle.cardIdentity.variantId ||
            designReference.parallelId !== bundle.cardIdentity.parallelId
          ) {
            context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, "registration"], message: "must match the exact design-reference version, report identity tuple, and side" });
          }
          if (side.registrationEvidence) {
            const expectedInlierFraction = Math.round(
              (side.registrationEvidence.inlierCorrespondenceIds.length /
                side.registrationEvidence.correspondenceCount) * 1_000_000,
            ) / 1_000_000;
            if (
              side.registrationEvidence.inlierCorrespondenceIds.length >
                side.registrationEvidence.correspondenceCount ||
              side.registration.inlierCount !==
                side.registrationEvidence.inlierCorrespondenceIds.length ||
              side.registration.inlierFraction !== expectedInlierFraction
            ) {
              context.addIssue({
                code: "custom",
                path: ["centeringEvidence", sideName, "registrationEvidence"],
                message: "must reproduce the exact correspondence count, inlier ledger, and inlier fraction",
              });
            }
          }
        }
      } else if (side.registration.designReferenceId || side.registration.designReferenceSha256) {
        context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, "registration"], message: "printed-border fitting must not claim a design template" });
      } else {
        const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.printedBorder;
        if (
          side.registration.transformType !== "robust_line_fit" ||
          side.registration.registrationResidualPx > policy.maximumFitResidualPx ||
          side.registration.inlierCount < policy.minimumLineSamplesPerSide ||
          side.registration.inlierFraction < policy.minimumInlierFraction ||
          side.registration.confidence < policy.minimumBoundaryConfidence
        ) {
          context.addIssue({ code: "custom", path: ["centeringEvidence", sideName, "registration"], message: "must satisfy every robust printed-border fit acceptance threshold" });
        }
      }
    }
    if (
      !mathematicalScoreV1Schema.safeParse(bundle.centeringEvidence.front.score).success ||
      !mathematicalScoreV1Schema.safeParse(bundle.centeringEvidence.back.score).success
    ) return;
    const expectedCentering = fuseCenteringFrontBackV1(
      bundle.centeringEvidence.front.score,
      bundle.centeringEvidence.back.score,
    );
    if (bundle.centeringEvidence.fusedScore !== expectedCentering ||
        bundle.productionRelease.finalGrade.elements.centering.score !== expectedCentering) {
      context.addIssue({ code: "custom", path: ["centeringEvidence", "fusedScore"], message: "must match the conservative front/back fusion and final centering score" });
    }
    if (bundle.centeringEvidence.deduction !== roundNonnegativeTwoDecimals(10 - expectedCentering)) {
      context.addIssue({ code: "custom", path: ["centeringEvidence", "deduction"], message: "must equal 10.00 minus the fused centering score" });
    }

    const finalGrade = bundle.productionRelease.finalGrade;
    const requiredElementFormulas = {
      centering: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula,
      corners: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.formula,
      edges: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.formula,
      surface: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surface.formula,
    };
    for (const element of MATHEMATICAL_GRADING_ELEMENTS_V1) {
      if (finalGrade.elements[element].formula !== requiredElementFormulas[element]) {
        context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", element, "formula"], message: "must publish the exact manifest formula" });
      }
    }
    if (
      JSON.stringify(finalGrade.weights) !==
        JSON.stringify(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weights) ||
      finalGrade.weightedFormula !== MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weightedFormula ||
      finalGrade.formula !== MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.finalFormula ||
      bundle.centeringEvidence.formula !== MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion.formula ||
      JSON.stringify(bundle.centeringEvidence.balanceCurve) !==
        JSON.stringify(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.balanceCurve)
    ) {
      context.addIssue({
        code: "custom",
        path: ["productionRelease", "finalGrade", "formula"],
        message: "must publish the exact overall weights/formulas and centering fusion/balance curve",
      });
    }
    if (
      finalGrade.elements.centering.frontScore !== bundle.centeringEvidence.front.score ||
      finalGrade.elements.centering.backScore !== bundle.centeringEvidence.back.score ||
      finalGrade.elements.centering.aggregatePenalty !== bundle.centeringEvidence.deduction ||
      finalGrade.elements.centering.findingIds.length !== 0
    ) {
      context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", "centering"], message: "must match centering evidence and must not claim physical defect findings" });
    }
    const elementScores = {
      centering: finalGrade.elements.centering.score,
      corners: finalGrade.elements.corners.score,
      edges: finalGrade.elements.edges.score,
      surface: finalGrade.elements.surface.score,
    };
    if (Object.values(elementScores).some((score) => !mathematicalScoreV1Schema.safeParse(score).success)) return;
    const severeCaps = bundle.defectFindings
      .map((finding) => finding.severeDefectCap)
      .filter((cap): cap is number => cap !== undefined);
    const overall = calculateOverallGradeV1(elementScores, severeCaps);
    for (const key of ["overall", "weightedGrade", "weakestElement", "weakestScore", "weakestElementCap"] as const) {
      if (finalGrade[key] !== overall[key]) {
        context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", key], message: "must match the exact calibrated V1 formula" });
      }
    }
    if (finalGrade.labelGrade !== overall.labelGrade ||
        bundle.productionRelease.label.labelGradeText !== overall.labelGrade.toFixed(1)) {
      context.addIssue({ code: "custom", path: ["productionRelease", "label", "labelGradeText"], message: "must match the one-decimal V1 label grade" });
    }
    if (finalGrade.applicableSevereDefectCap !== overall.applicableSevereDefectCap) {
      context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "applicableSevereDefectCap"], message: "must match the lowest applicable severe-defect cap" });
    }

    const cornerLocations = finalGrade.elements.corners.locationScores;
    const validateLocationElement = (
      element: "corners" | "edges",
      locations: typeof cornerLocations,
      names: readonly string[],
      worstWeight: number,
      averageWeight: number,
    ) => {
      const result = finalGrade.elements[element];
      const expectedKeys = new Set(["front", "back"].flatMap((side) => names.map((name) => `${side}:${name}`)));
      const actualKeys = locations.map((location) => `${location.side}:${location.location}`);
      if (new Set(actualKeys).size !== actualKeys.length || actualKeys.some((key) => !expectedKeys.has(key))) {
        context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", element, "locationScores"], message: "must contain each canonical front/back location exactly once" });
      }
      locations.forEach((location, index) => {
        const expectedFindings = bundle.defectFindings.filter((finding) =>
          finding.primaryElement === element && finding.side === location.side && finding.location === location.location,
        );
        const expectedPenalty = roundNonnegativeTwoDecimals(Math.min(
          MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION,
          expectedFindings.reduce((sum, finding) => sum + finding.deduction, 0),
        ));
        const expectedFindingIds = new Set(expectedFindings.map((finding) => finding.findingId.toLowerCase()));
        if (
          location.penalty !== expectedPenalty ||
          location.findingIds.length !== expectedFindingIds.size ||
          location.findingIds.some((findingId) => !expectedFindingIds.has(findingId.toLowerCase()))
        ) {
          context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", element, "locationScores", index], message: "must contain the exact unique deductions assigned to this physical location" });
        }
      });
      for (const side of ["front", "back"] as const) {
        const penalties = locations.filter((location) => location.side === side).map((location) => location.penalty);
        if (!penalties.length) continue;
        const sidePenalty = worstWeight * Math.max(...penalties) +
          averageWeight * (penalties.reduce((sum, penalty) => sum + penalty, 0) / penalties.length);
        const expectedSideScore = roundMathematicalScoreV1(10 - sidePenalty);
        if (result[side === "front" ? "frontScore" : "backScore"] !== expectedSideScore) {
          context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", element, `${side}Score`], message: "must match the manifest worst-plus-average side subscore" });
        }
      }
    };
    if (cornerLocations.length !== MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.requiredObservationCount) {
      context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", "corners", "locationScores"], message: "must contain all eight visible corner observations" });
    } else {
      validateLocationElement(
        "corners",
        cornerLocations,
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.locationsPerSide,
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.worstWeight,
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.averageWeight,
      );
      const aggregation = aggregateCornerScoreV1(cornerLocations.map((location) => location.penalty));
      if (finalGrade.elements.corners.score !== aggregation.score ||
          finalGrade.elements.corners.aggregatePenalty !== roundNonnegativeTwoDecimals(aggregation.aggregatePenalty)) {
        context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", "corners"], message: "must match 0.65 worst plus 0.35 average aggregation" });
      }
    }
    const edgeLocations = finalGrade.elements.edges.locationScores;
    if (edgeLocations.length !== MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.requiredObservationCount) {
      context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", "edges", "locationScores"], message: "must contain all eight visible edge observations" });
    } else {
      validateLocationElement(
        "edges",
        edgeLocations,
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.locationsPerSide,
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.worstWeight,
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.averageWeight,
      );
      const aggregation = aggregateEdgeScoreV1(edgeLocations.map((location) => location.penalty));
      if (finalGrade.elements.edges.score !== aggregation.score ||
          finalGrade.elements.edges.aggregatePenalty !== roundNonnegativeTwoDecimals(aggregation.aggregatePenalty)) {
        context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", "edges"], message: "must match 0.60 worst plus 0.40 average aggregation" });
      }
    }
    const validateObservationEvidence = (
      element: "corners" | "edges",
      observations: typeof bundle.conditionObservationEvidence.corners,
      locations: typeof cornerLocations,
      canonicalLocations: readonly string[],
    ) => {
      const expectedKeys = new Set(
        ["front", "back"].flatMap((side) =>
          canonicalLocations.map((location) => side + ":" + location),
        ),
      );
      const actualKeys = observations.map((observation) =>
        observation.side + ":" + observation.location,
      );
      if (
        new Set(actualKeys).size !== actualKeys.length ||
        actualKeys.some((key) => !expectedKeys.has(key))
      ) {
        context.addIssue({
          code: "custom",
          path: ["conditionObservationEvidence", element],
          message: "must contain every canonical front/back physical observation exactly once",
        });
      }
      observations.forEach((observation, index) => {
        const path = ["conditionObservationEvidence", element, index] as Array<string | number>;
        const location = locations.find((entry) =>
          entry.side === observation.side && entry.location === observation.location
        );
        const findings = bundle.defectFindings.filter((finding) =>
          finding.primaryElement === element &&
          finding.side === observation.side &&
          finding.location === observation.location
        );
        const expectedFindingIds = new Set(
          findings.map((finding) => finding.findingId.toLowerCase()),
        );
        const expectedMeasurementIds = new Set(
          findings.flatMap((finding) =>
            finding.measurements.map((measurement) => measurement.measurementId.toLowerCase()),
          ),
        );
        if (
          observation.element !== element ||
          !location ||
          observation.score !== location.score ||
          observation.penalty !== location.penalty ||
          observation.findingIds.length !== expectedFindingIds.size ||
          observation.findingIds.some((findingId) =>
            !expectedFindingIds.has(findingId.toLowerCase())) ||
          observation.measurementIds.length !== expectedMeasurementIds.size ||
          observation.measurementIds.some((measurementId) =>
            !expectedMeasurementIds.has(measurementId.toLowerCase())) ||
          findings.some((finding) => finding.regionId !== observation.regionId)
        ) {
          context.addIssue({
            code: "custom",
            path,
            message: "must match the exact location score, findings, regions, and measured observations",
          });
        }
        const requiredChannelCount =
          MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount;
        if (
          observation.channelAssetIds.length !== requiredChannelCount ||
          observation.usableDirectionalChannelCount > requiredChannelCount
        ) {
          context.addIssue({
            code: "custom",
            path: [...path, "channelAssetIds"],
            message: "must expose every calibrated directional channel exactly once",
          });
        }
        requireAssetRole(observation.roiAssetId, observation.side, "roi_crop", [...path, "roiAssetId"]);
        requireAssetRole(
          observation.segmentationMaskAssetId,
          observation.side,
          "segmentation_mask",
          [...path, "segmentationMaskAssetId"],
        );
        requireAssetRole(
          observation.confidenceMaskAssetId,
          observation.side,
          "confidence_mask",
          [...path, "confidenceMaskAssetId"],
        );
        requireAssetRole(
          observation.illuminationMaskAssetId,
          observation.side,
          "illumination_mask",
          [...path, "illuminationMaskAssetId"],
        );
        observation.channelAssetIds.forEach((assetId, channelIndex) =>
          requireAssetRole(
            assetId,
            observation.side,
            "directional_channel",
            [...path, "channelAssetIds", channelIndex],
          ));
      });
    };
    validateObservationEvidence(
      "corners",
      bundle.conditionObservationEvidence.corners,
      cornerLocations,
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.locationsPerSide,
    );
    validateObservationEvidence(
      "edges",
      bundle.conditionObservationEvidence.edges,
      edgeLocations,
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.locationsPerSide,
    );
    const surfaceDeduction = bundle.defectFindings
      .filter((finding) => finding.primaryElement === "surface")
      .reduce((sum, finding) => sum + finding.deduction, 0);
    const expectedSurface = roundMathematicalScoreV1(10 - surfaceDeduction);
    if (finalGrade.elements.surface.score !== expectedSurface ||
        finalGrade.elements.surface.aggregatePenalty !== roundNonnegativeTwoDecimals(Math.min(
          MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION,
          surfaceDeduction,
        ))) {
      context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", "surface"], message: "must equal 10 minus unique surface deductions" });
    }
    for (const side of ["front", "back"] as const) {
      const sideDeduction = bundle.defectFindings
        .filter((finding) => finding.primaryElement === "surface" && finding.side === side)
        .reduce((sum, finding) => sum + finding.deduction, 0);
      const expectedSideScore = roundMathematicalScoreV1(10 - sideDeduction);
      if (finalGrade.elements.surface[side === "front" ? "frontScore" : "backScore"] !== expectedSideScore) {
        context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", "surface", `${side}Score`], message: "must equal 10 minus the side's unique physical deductions" });
      }
    }

    Object.entries(finalGrade.elements).forEach(([element, result]) => {
      const expectedFindingIds = new Set(bundle.defectFindings
        .filter((finding) => finding.primaryElement === element)
        .map((finding) => finding.findingId.toLowerCase()));
      if (
        result.findingIds.length !== expectedFindingIds.size ||
        result.findingIds.some((findingId) => !expectedFindingIds.has(findingId.toLowerCase()))
      ) {
        context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", element, "findingIds"], message: "must list every and only finding assigned to this primary element" });
      }
      result.findingIds.forEach((findingId, index) => {
        const finding = findingsById.get(findingId.toLowerCase());
        if (!finding || finding.primaryElement !== element) {
          context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "elements", element, "findingIds", index], message: "must reference a finding assigned to this primary element" });
        }
      });
    });
    finalGrade.whyNot10.forEach((entry, index) => {
      entry.findingIds.forEach((findingId) => {
        const finding = findingsById.get(findingId.toLowerCase());
        if (!finding) {
          context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "whyNot10", index, "findingIds"], message: "must reference a published finding" });
        } else if (
          entry.element !== finding.primaryElement ||
          !entry.overlayAssetIds.some((assetId) => assetId.toLowerCase() === finding.evidence.overlayAssetId.toLowerCase())
        ) {
          context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "whyNot10", index], message: "must link the finding to its exact primary element and deduction overlay" });
        }
      });
      entry.overlayAssetIds.forEach((assetId) => requireAsset(assetId, ["productionRelease", "finalGrade", "whyNot10", index, "overlayAssetIds"]));
    });
    if (finalGrade.overall < 10 && finalGrade.whyNot10.length === 0) {
      context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "whyNot10"], message: "must explain every calibrated result below 10.00" });
    }
    const explainedFindingIds = new Set(finalGrade.whyNot10.flatMap((entry) => entry.findingIds.map((findingId) => findingId.toLowerCase())));
    bundle.defectFindings.forEach((finding, index) => {
      if (finding.deduction > 0 && !explainedFindingIds.has(finding.findingId.toLowerCase())) {
        context.addIssue({ code: "custom", path: ["defectFindings", index, "findingId"], message: "every physical deduction must appear in Why Not 10" });
      }
    });
    if (
      bundle.centeringEvidence.deduction > 0 &&
      !finalGrade.whyNot10.some((entry) =>
        entry.element === "centering" &&
        entry.overlayAssetIds.some((assetId) =>
          assetId === bundle.centeringEvidence.front.measurementOverlayAssetId ||
          assetId === bundle.centeringEvidence.back.measurementOverlayAssetId,
        ),
      )
    ) {
      context.addIssue({ code: "custom", path: ["productionRelease", "finalGrade", "whyNot10"], message: "centering deduction must link to an exact centering measurement overlay" });
    }
    bundle.evidenceQualityLimitations.forEach((limitation, index) => {
      const allowedRoles = limitation.classification === "common_mode_specular_glare"
        ? new Set(["common_mode_response", "illumination_mask", "confidence_mask"])
        : limitation.classification === "low_confidence"
          ? new Set(["confidence_mask"])
          : limitation.classification === "clipping" ||
              limitation.classification === "underexposure"
            ? new Set(["illumination_mask", "confidence_mask"])
            : new Set(["illumination_mask", "confidence_mask", "common_mode_response"]);
      const referencedRoles = new Set<string>();
      limitation.evidenceAssetIds.forEach((assetId) => {
        const path = ["evidenceQualityLimitations", index, "evidenceAssetIds"];
        requireAsset(assetId, path);
        const asset = assetsById.get(assetId.toLowerCase());
        if (
          asset &&
          (asset.side !== limitation.side ||
            !asset.evidenceRole ||
            !allowedRoles.has(asset.evidenceRole))
        ) {
          context.addIssue({
            code: "custom",
            path,
            message: "must reference only same-side confidence/illumination evidence appropriate to the limitation classification",
          });
        }
        if (asset?.evidenceRole) referencedRoles.add(asset.evidenceRole);
      });
      const requiredRole =
        limitation.classification === "common_mode_specular_glare"
          ? "common_mode_response"
          : limitation.classification === "low_confidence"
            ? "confidence_mask"
            : "illumination_mask";
      if (!referencedRoles.has(requiredRole)) {
        context.addIssue({
          code: "custom",
          path: ["evidenceQualityLimitations", index, "evidenceAssetIds"],
          message: "must include the classification's exact immutable mask/response authority",
        });
      }
      if (limitation.recaptureRequired || limitation.classification === "ungradable") {
        context.addIssue({ code: "custom", path: ["evidenceQualityLimitations", index], message: "ungradable or recapture-required evidence cannot produce a final calibrated V1 grade" });
      }
    });
  });

export type AiGraderReportBundleV03 = z.infer<typeof aiGraderReportBundleV03Schema>;
