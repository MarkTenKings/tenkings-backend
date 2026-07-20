import { z } from "zod";

/**
 * Ten Kings Mathematical Grading Calibration V1
 *
 * This module is the only source of scoring and acceptance constants for the
 * calibrated V1 contract. Consumers must persist the threshold-set id/hash
 * with every result and must not copy values out of this manifest.
 */

export const MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID =
  "ten-kings-mathematical-grading-v1.0.1" as const;

/** SHA-256 of canonical JSON for the manifest with sourceHash omitted. */
export const MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH =
  "6f4fe21980a14458468d7526278c7b6cff70e39f8a80b07172b1991dfa1187c7" as const;

export const MATHEMATICAL_GRADING_V1_SCHEMA_VERSION =
  "ten-kings-mathematical-grading-v1" as const;
export const MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION =
  "ai-grader-mathematical-calibration-profile-v1" as const;
export const MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION =
  "ai-grader-design-reference-v1" as const;
export const MATHEMATICAL_MEASUREMENT_V1_SCHEMA_VERSION =
  "ai-grader-physical-measurement-v1" as const;
export const MATHEMATICAL_FINDING_V1_SCHEMA_VERSION =
  "ai-grader-mathematical-finding-v1" as const;
export const MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION =
  "ai-grader-deduction-ledger-v1" as const;

export const MATHEMATICAL_GRADING_ELEMENTS_V1 = [
  "centering",
  "corners",
  "edges",
  "surface",
] as const;

export type MathematicalGradingElementV1 =
  (typeof MATHEMATICAL_GRADING_ELEMENTS_V1)[number];

export const MATHEMATICAL_MEASUREMENT_UNITS_V1 = [
  "mm",
  "mm2",
  "px",
  "px2",
  "percent",
  "ratio",
  "delta_e",
  "relief_index",
  "roughness_index",
] as const;

export type MathematicalMeasurementUnitV1 =
  (typeof MATHEMATICAL_MEASUREMENT_UNITS_V1)[number];

export const MATHEMATICAL_MEASUREMENT_KINDS_V1 = [
  "length_mm",
  "width_mm",
  "area_mm2",
  "depth_mm",
  "shape_deviation_mm",
  "deformation_area_mm2",
  "relief_index",
  "roughness_index",
  "delta_e",
  "margin_mm",
  "margin_difference_mm",
  "balance_ratio_percent",
] as const;

export type MathematicalMeasurementKindV1 =
  (typeof MATHEMATICAL_MEASUREMENT_KINDS_V1)[number];

export const MATHEMATICAL_FINDING_CATEGORIES_V1 = [
  "corner_whitening",
  "corner_material_loss",
  "corner_chip",
  "corner_shape_deviation",
  "corner_deformation",
  "corner_delamination",
  "corner_directional_relief",
  "edge_damage",
  "edge_chip",
  "edge_whitening",
  "edge_roughness",
  "edge_fraying",
  "edge_delamination",
  "edge_deformation",
  "scratch",
  "scuff",
  "dent",
  "crease",
  "stain",
  "print_defect",
  "foreign_material",
  "alteration",
  "material_loss",
] as const;

export type MathematicalFindingCategoryV1 =
  (typeof MATHEMATICAL_FINDING_CATEGORIES_V1)[number];

export const MATHEMATICAL_FINDING_DEDUCTION_CURVE_V1 = "linear_clamped" as const;
export const MATHEMATICAL_FINDING_DEDUCTION_FORMULA_V1 =
  "deduction = measuredMeasurement <= max(U95, Grade10Tolerance) ? 0 : maximumDeduction * clamp(max(0, measuredMeasurement - U95) / referenceMeasurement, 0, 1)" as const;

type FindingPolicy = Readonly<{
  element: Exclude<MathematicalGradingElementV1, "centering">;
  primaryMeasurementKind: MathematicalMeasurementKindV1;
  unit: MathematicalMeasurementUnitV1;
  referenceMeasurement: number;
  grade10Tolerance: number;
  maximumDeduction: number;
  curve: typeof MATHEMATICAL_FINDING_DEDUCTION_CURVE_V1;
  severityBreakpoints: Readonly<{
    low: number;
    medium: number;
    high: number;
  }>;
}>;

const FINDING_SEVERITY_BREAKPOINTS = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
} as const;

const findingPolicy = (
  element: FindingPolicy["element"],
  primaryMeasurementKind: MathematicalMeasurementKindV1,
  unit: MathematicalMeasurementUnitV1,
  referenceMeasurement: number,
  grade10Tolerance: number,
  maximumDeduction: number,
): FindingPolicy => ({
  element,
  primaryMeasurementKind,
  unit,
  referenceMeasurement,
  grade10Tolerance,
  maximumDeduction,
  curve: MATHEMATICAL_FINDING_DEDUCTION_CURVE_V1,
  severityBreakpoints: FINDING_SEVERITY_BREAKPOINTS,
});

const manifestWithoutHash = {
  schemaVersion: MATHEMATICAL_GRADING_V1_SCHEMA_VERSION,
  thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
  algorithmVersion: "ai-grader-mathematical-calibration-v1.0.0",
  hashPolicy: "sha256-canonical-json-with-sourceHash-omitted",
  scoreContract: {
    minimum: 1,
    maximum: 10,
    startingScore: 10,
    internalDecimals: 2,
    reportDecimals: 2,
    labelDecimals: 1,
    rounding: "half_away_from_zero",
    missingElementPolicy: "insufficient_evidence_no_weight_redistribution",
  },
  evidenceEncoding: {
    decodedRasterPlane: {
      bitsPerChannel: 8,
      maximumDigitalValue: 255,
      authority:
        "sharp decoded raw RGB/greyscale planes are unsigned 8-bit values; unsupported decoded encodings must fail before grading",
    },
  },
  reportConfidenceBands: {
    highMinimum: 0.9,
    mediumMinimum: 0.75,
    lowMinimum: 0,
    formula:
      "high when confidence >= 0.90; medium when confidence >= 0.75; otherwise low",
  },
  findingReview: {
    operatorMayAuthorConfidence: false,
    operatorDispositionFields: ["status", "reviewedAt"],
    derivedConfidenceFormula:
      "minimum across finding measurements of min(validEvidenceCoverage, usableDirectionalChannelCount / required calibrated channel count)",
  },
  uncertainty: {
    confidenceLevel: 0.95,
    coverageFactor: 1.96,
    combination: "root_sum_of_squares",
    sampleStandardDeviationDenominator: "n_minus_1",
    repeatedMeasurementU95Formula: "coverageFactor * sampleStandardDeviation",
    scaleU95Method: "propagated_scale_fit_and_repeatability",
    scaleU95Formula:
      "sqrt((coverageFactor * sampleStandardDeviation(scaleSamples) / meanScale)^2 + max(physicalSpanU95Mm / physicalSpanMm)^2)",
    residualAggregation: "root_mean_square",
    lensResidualAggregation: "rms_reprojection_error_px",
    registrationResidualAggregation: "rms_control_point_error_px",
    segmentationBoundaryMethod: "outer_cut_boundary_fit_residual_and_repeatability",
    segmentationBoundaryU95Formula:
      "hypot(rootMeanSquare(perSampleOuterContourFitResidualPx), coverageFactor * sampleStandardDeviation(perSampleOuterContourFitResidualPx))",
    normalizationRegistrationMethod:
      "fixed_outer_cut_transform_applied_to_held_out_checkerboard_control_points",
    repeatedPlacementMethod:
      "fixed_normalization_transform_held_constant_across_remove_replace_captures",
    measurementRepeatabilityClasses: [
      "linear_mm",
      "area_mm2",
      "relief_index",
      "roughness_index",
      "color_delta_e",
    ],
    measurementRepeatabilityU95Formula:
      "coverageFactor * sampleStandardDeviation(repeatedMeasurementsOfSamePhysicalFeature)",
    linearMeasurementU95Formula:
      "rootSumSquares(measuredValue * scaleRelativeU95, lensResidualPx * meanMmPerPixel, normalizationResidualPx * meanMmPerPixel, repeatedPlacementU95Mm, segmentationBoundaryU95Px * meanMmPerPixel, classRepeatabilityU95, lightingChannelConfidenceU95)",
    areaMeasurementU95Formula:
      "rootSumSquares(2 * measuredArea * scaleRelativeU95, 2 * sqrt(measuredArea) * linearPositionU95, classRepeatabilityU95, lightingChannelConfidenceU95)",
    dimensionlessMeasurementU95Formula:
      "rootSumSquares(classRepeatabilityU95, maximumFlatFieldDeviationFraction, 1 - minimumUsableChannelConfidence)",
    colorDeltaEMeasurementU95Formula:
      "rootSumSquares(colorDeltaERepeatabilityU95, colorDeltaERepeatabilityU95 * (maximumFlatFieldDeviationFraction + 1 - minimumUsableChannelConfidence))",
    lightingChannelLinearU95Formula:
      "axisMmPerPixel * (maximumCalibratedFlatFieldDeviationFraction + (1 - minimumCalibratedChannelDirectionConfidence))",
    areaComponentPropagationFormula:
      "2 * sqrt(measuredAreaMm2) * applicableLinearPositionU95Mm",
    measurementAxisScalePolicy:
      "use requested calibrated x/y scale for axis measurements; use max(mmPerPixelX, mmPerPixelY) for unknown or rotated linear geometry",
    flatFieldResidualMethod: "maximum_absolute_relative_deviation_after_normalization",
    effectiveMeasurementFormula: "max(0, measuredMeasurement - U95)",
    grade10BufferFormula: "max(U95, explicitGrade10Tolerance)",
    deductionDeadbandFormula:
      "measuredMeasurement <= grade10Buffer ? 0 : effectiveMeasurement",
    requiredSources: [
      "pixel_mm_scale",
      "lens_distortion",
      "normalization_registration",
      "repeated_placement",
      "segmentation_boundary",
      "repeated_measurement",
      "lighting_channel_confidence",
    ],
  },
  calibrationAcceptance: {
    maxTargetPrintScaleErrorMm: 0.2,
    targetPrintVerificationSpansMm: { x: 100, y: 200 },
    maxTargetCutDimensionErrorMm: 0.2,
    targetCutDimensionsMm: { x: 63.5, y: 88.9 },
    targetCutDimensionAcceptanceFormula:
      "abs(measuredCutDimensionMm - nominalCutDimensionMm) + measurementU95Mm <= maxTargetCutDimensionErrorMm",
    targetPrintScaleAcceptanceFormula:
      "abs(measuredSpanMm - nominalSpanMm) + measurementU95Mm <= maxTargetPrintScaleErrorMm",
    maxScaleRelativeU95: 0.005,
    maxLensResidualPx: 0.5,
    maxRegistrationResidualPx: 1,
    maxPlacementU95Mm: 0.05,
    maxSegmentationBoundaryU95Px: 1.5,
    maxFlatFieldDeviationFraction: 0.05,
    minChannelDirectionConfidence: 0.8,
    minimumChannelDirectionMeasurementSamples: 3,
    minimumChannelDirectionSourceRadiusToPointU95Ratio: 5,
    maxChannelDirectionAngularU95Degrees: 4,
    channelDirectionConfidenceSectorScaleDegrees: 22.5,
    channelDirectionConfidenceFormula:
      "max(0, 1 - directionAngularU95Degrees / channelDirectionConfidenceSectorScaleDegrees)",
    channelDirectionAngularU95Formula:
      "rootSumSquares(coverageFactor * sampleStandardDeviation(geometryAngleDegrees), max(atan2(pointU95Mm, sourceRadiusMm) * 180 / pi), rootMeanSquare(geometryVsIrradianceValidationErrorDegrees))",
    uniformTargetCentroidPointU95Formula:
      "hypot(couponWidthMm / (imageWidthPx - 1), couponHeightMm / (imageHeightPx - 1))",
    allowedPhysicalDirectionMeasurementMethods: [
      "fixed_ring_segment_geometry_with_ruler_v1",
    ],
    maxIrradianceDirectionValidationErrorDegrees: 22.5,
    irradianceDirectionValidationFormula:
      "smallestAbsoluteAngle(fixedRingGeometryDirection, uniformTargetIrradianceCentroidDirection)",
    channelDirectionVectorFormula:
      "normalize(sourcePointMm - cardCenterPointMm)",
    requiredChannelCount: 8,
    minimumLensCalibrationViews: 10,
    minimumScaleSamples: 10,
    minimumNormalizationRegistrations: 10,
    minimumRepeatedPlacements: 10,
    minimumSegmentationBoundarySamples: 10,
    minimumFlatFieldFramesPerChannel: 3,
    minimumDarkControlFramesPerChannel: 3,
    minimumIlluminationPatternFramesPerChannel: 3,
    minimumMeasurementRepeatabilitySamplesPerClass: 10,
    captureEvidence: {
      poseDiversity: {
        minimumDetectedTargetCoverageFractionPerView: 0.3,
        geometry: {
          minimumNormalizedCenterSpanX: 0.07,
          minimumNormalizedCenterSpanY: 0.08,
          minimumRotationSpanDegrees: 2,
        },
        normalization: {
          minimumNormalizedCenterSpanX: 0.07,
          minimumNormalizedCenterSpanY: 0.08,
          minimumRotationSpanDegrees: 2,
        },
        targetCoverageFormula:
          "detectedOuterContourAreaPx / sourceFrameAreaPx >= minimumDetectedTargetCoverageFractionPerView for every accepted geometry and normalization view",
        spanFormula: "max(observedPoseValue) - min(observedPoseValue) >= minimumSpan",
      },
      repeatedPlacementAuthority:
        "minimumRepeatedPlacements unique bridge capture operation IDs, timestamps, and source hashes with explicit remove/reseat cycle evidence; no minimum displacement is imposed",
    },
    maximumMeasurementRepeatabilityU95: {
      linearMm: 0.1,
      areaMm2: 0.2,
      reliefIndex: 0.05,
      roughnessIndex: 0.05,
      colorDeltaE: 0.5,
    },
    outerCutBoundaryMeasurement: {
      searchHalfWidthMm: 0.75,
      crossSectionsPerSide: 48,
      endpointExclusionFraction: 0.1,
      minimumSupportedCrossSectionsPerSide: 24,
      minimumDirectionalGradientDigitalUnits: 4,
      robustDistance: "huber_then_mad_clipped_l2",
      madMultiplier: 4,
      minimumResidualLimitPx: 1,
      normalizedProjection:
        "retain exact raw contour and transform; clamp the display/segmentation projection to the closed normalized-card frame because subpixel cut localization may fall just outside the resampled image boundary",
    },
    fixedHoldoutPlacementReference: "first_remove_replace_capture",
    requireIlluminationPatternArtifact: true,
    requireFinalizedArtifactHash: true,
    requireDistinctDirectionVectors: true,
    maximumDistinctDirectionCosineSimilarity: 0.999,
  },
  cardFormats: {
    standardTradingCard: {
      profileId: 'standard_trading_card_63_50x88_90_r3_18_v1',
      profileVersion: 'standard_trading_card_63_50x88_90_r3_18_v1.0.0',
      widthMm: 63.5,
      heightMm: 88.9,
      cornerRadiusMm: 3.18,
      contourArcSegmentsPerCorner: 16,
    },
  },
  centering: {
    profiles: ["printed_border_v1", "registered_design_template_v1"],
    marginDifferenceDeadband: "grade10_buffer_max_u95_and_explicit_tolerance",
    sideAxisFusion: "worse_axis",
    frontBackFusion: {
      worstWeight: 0.7,
      averageWeight: 0.3,
      formula: "0.70 * worstSideScore + 0.30 * averageSideScore",
    },
    balanceCurve: [
      { ratio: 0, score: 1 },
      { ratio: 70, score: 5 },
      { ratio: 75, score: 6 },
      { ratio: 80, score: 7 },
      { ratio: 85, score: 8 },
      { ratio: 90, score: 9 },
      { ratio: 95, score: 10 },
      { ratio: 100, score: 10 },
    ],
    grade10Tolerance: {
      marginDifferenceMm: 0.05,
      minimumBalanceRatio: 95,
    },
    printedBorder: {
      minimumLineSamplesPerSide: 24,
      minimumInlierFraction: 0.7,
      maximumFitResidualPx: 1,
      minimumBoundaryConfidence: 0.8,
      sourceDetector: {
        sourcePlane: "flat_field_normalized_all_on_luminance",
        outerCutScanEnvelope:
          "deterministic convex hull of the exact detector-produced observed contour; report evidence retains the unsimplified measured contour",
        gradientPolarity: "absolute_luminance_gradient",
        insetSearchMinimumFractionOfAxis: 0.01,
        insetSearchMaximumFractionOfAxis: 0.2,
        gradientThresholdPolicy:
          "max(minimumNormalizedGradient, medianGradient + gradientMadMultiplier * medianAbsoluteDeviation)",
        minimumNormalizedGradient: 0.02,
        gradientMadMultiplier: 4,
        minimumCrossSectionsPerAxis: 24,
        minimumCrossSectionSupportFraction: 0.7,
        crossSectionPeakAggregation: "median_supported_peak_then_robust_line_fit",
      },
    },
    registeredDesignTemplate: {
      balanceModel: "expected_margin_error_equivalent_balance",
      balanceFormula:
        "axisError = ((observedA - expectedA) - (observedB - expectedB)) / 2; equivalentA = physicalAxisSpan / 2 + axisError; equivalentB = physicalAxisSpan / 2 - axisError; apply max(U95, explicit Grade-10 tolerance) deadband and the published balance curve",
      arbitrarySymmetryInferenceAllowed: false,
      minimumInlierCount: 24,
      minimumInlierFraction: 0.65,
      maximumRegistrationResidualPx: 1,
      minimumRegistrationConfidence: 0.8,
      registrationConfidence: {
        fullConfidenceResidualPx: 0.2,
        confidenceAtMaximumResidual: 0.8,
        confidenceAtMinimumInlierFraction: 0.8,
        formula:
          'min(piecewise residual confidence from 1.00 at <= 0.20 px to 0.80 at 1.00 px, piecewise inlier confidence from 0.80 at the minimum inlier fraction to 1.00 at complete support)',
      },
      allowedTransforms: ["affine", "homography"],
      requiresApprovedExactIdentity: true,
      requiresArtifactSha256: true,
      automaticRegistration: {
        algorithmVersion: 'deterministic_multiregion_gradient_patch_registration_v1.2.0',
        regionColumns: 6,
        regionRows: 8,
        insetFraction: 0.06,
        patchRadiusPx: 4,
        minimumReferenceCandidateSeparationPx: 8,
        maximumConsensusDisplacementResidualPx: 8,
        maximumReferenceCandidatesPerRegion: 4,
        maximumSupportedTranslationMm: 6.35,
        coarseSearchStridePx: 3,
        coarseCandidateCount: 16,
        coarseRefinementRadiusPx: 3,
        subpixelPeakRefinement: 'separable_three_point_parabolic_ncc',
        minimumGradientDigitalUnits: 12,
        minimumReferencePatchStandardDeviation: 0.03,
        minimumNormalizedCrossCorrelation: 0.8,
        minimumBestVsSecondNccDelta: 0.02,
        ambiguityExclusionRadiusPx: 9,
        maximumCorrespondences: 48,
        transformType: 'affine',
      },
    },
  },
  corners: {
    requiredObservationCount: 8,
    locationsPerSide: ["top_left", "top_right", "bottom_right", "bottom_left"],
    minValidPixelCoverage: 0.8,
    minUsableDirectionalChannels: 3,
    overlapMergeIouThreshold: 0.35,
    overlapMergeCentroidDistanceMm: 0.5,
    frontBackPhysicalMatch: {
      minimumBoundingBoxIou: 0.35,
      maximumNormalizedCentroidDistance: 0.05,
      maximumRelativeEffectiveMeasurementDifference: 0.25,
      u95IntervalMultiplier: 1,
    },
    worstWeight: 0.65,
    averageWeight: 0.35,
    formula: "score = clamp(10 - (0.65 * worstPenalty + 0.35 * averagePenalty), 1, 10)",
  },
  edges: {
    requiredObservationCount: 8,
    locationsPerSide: ["top", "right", "bottom", "left"],
    minValidPixelCoverage: 0.8,
    minUsableDirectionalChannels: 3,
    worstWeight: 0.6,
    averageWeight: 0.4,
    formula: "score = clamp(10 - (0.60 * worstPenalty + 0.40 * averagePenalty), 1, 10)",
    overlapMergeIouThreshold: 0.35,
    overlapMergeSpanFraction: 0.5,
    frontBackPhysicalMatch: {
      minimumBoundingBoxIou: 0.35,
      maximumNormalizedCentroidDistance: 0.05,
      maximumRelativeEffectiveMeasurementDifference: 0.25,
      u95IntervalMultiplier: 1,
    },
  },
  conditionSegmentation: {
    detectorId: "fixed_rig_condition_segmentation_v1",
    detectorVersion: "fixed_rig_condition_segmentation_v1.2.0",
    coordinateFrame: "normalized_card_portrait_pixels",
    calculationDecimals: 6,
    componentConnectivity: "eight_connected",
    componentExtentModel: "pca_projected_pixel_footprint_in_calibrated_mm",
    sourcePlaneContract: "registered_calibrated_scalar_planes_only",
    thresholdComparison: "inclusive_greater_than_or_equal_except_material_presence",
    materialPresenceComparison: "strictly_less_than",
    invalidEvidencePolicy:
      "exclude_clipping_underexposure_specular_low_confidence_and_insufficient_directional_pixels_from_condition_masks",
    invalidPixelsMayProveCleanCondition: false,
    invalidPixelsMayBecomePhysicalDefects: false,
    excludedEvidenceCoveragePolicy: {
      minimumFullCardValidPixelCoverage: 0.7,
      minimumContiguousUngradableRegionPixels: 12,
      recoveredEvidenceMayProceed: true,
      recaptureFormula:
        'recaptureRequired = validEvidenceCoverage < 0.70 OR any contiguous expected-card region with invalid condition evidence contains at least 12 pixels',
      alternateChannelRecoveryRule:
        'a pixel remains condition-valid when at least surfaceEvidence.minValidDirectionalObservations calibrated non-glare channels remain usable; invalid observations from other channels reduce confidence only',
      computedLimitationRule:
        'excluded expected-card pixels below both recapture gates are visible evidence-quality limitations with zero condition deduction and recaptureRequired=false',
    },
    designDifferencePolicy: "exact_approved_registered_design_artifact_only",
    arbitrarySymmetryOrInternetReferenceAllowed: false,
    roiOwnership: "corners_own_corner_squares_edges_exclude_corner_squares",
    regionGeometry: {
      cornerRoiSizeMm: 6,
      edgeRoiDepthMm: 2,
      edgeEndExclusionMm: 6,
      pixelConversion: "ceil_physical_extent_times_calibrated_pixels_per_mm",
    },
    evidenceThresholds: {
      minimumSegmentationConfidence: 0.8,
      minimumBoundaryConfidence: 0.8,
      minimumMaterialPresenceConfidence: 0.5,
      minimumExposedFiberResponse: 0.2,
      minimumBoundaryShapeDeviationMm: 0.03,
      minimumDeformationResponse: 0.08,
      minimumDelaminationResponse: 0.08,
      minimumEdgeChipDepthMm: 0.02,
      minimumEdgeRoughnessIndex: 0.05,
      minimumFrayingResponse: 0.08,
      minimumDirectionalReliefIndex: 0.05,
      minimumScratchLineResponse: 0.6,
      minimumScuffTextureResponse: 0.5,
      minimumCreaseLineResponse: 0.6,
    },
    boundaryMaterialLossQualificationRule:
      "a missing-material pixel contributes to corner or edge condition only when its calibrated chipDepthMm exceeds max(U95(depth_mm), corner_chip Grade-10 tolerance, edge_chip Grade-10 tolerance); observations inside that physical-resolution buffer have zero condition meaning",
    surfaceClassifierFormulas: {
      scratch:
        "scratchLineResponse >= minimumScratchLineResponse AND abs(calibrated directional residual candidate) >= surfaceEvidence.directionalResidualThreshold AND connected-component aspect ratio >= surfaceEvidence.minimumScratchAspectRatio AND width <= surfaceEvidence.maximumScratchWidthMm; downstream measurements use valid pixels only",
      scuff:
        "scuffTextureResponse >= minimumScuffTextureResponse AND abs(calibrated directional residual candidate) >= surfaceEvidence.directionalResidualThreshold AND connected-component area >= surfaceEvidence.minimumScuffAreaMm2; downstream measurements use valid pixels only",
      dent:
        "deformationResponse >= minimumDeformationResponse AND reliefIndex >= surfaceEvidence.minimumDentReliefIndex",
      crease:
        "creaseLineResponse >= minimumCreaseLineResponse AND reliefIndex >= minimumDirectionalReliefIndex AND abs(calibrated directional residual candidate) >= surfaceEvidence.directionalResidualThreshold AND connected-component length >= surfaceEvidence.minimumCreaseLengthMm; downstream measurements use valid pixels only",
      stain: "registeredColorDeltaE >= surfaceEvidence.minimumStainDeltaE",
      printDefect: "registeredPrintDeltaE >= surfaceEvidence.minimumPrintDefectDeltaE",
      foreignMaterial: "registeredResidueDeltaE >= surfaceEvidence.minimumResidueDeltaE",
    },
  },
  conditionPlaneProducer: {
    producerId: "fixed-rig-condition-plane-producer-v1",
    producerVersion: "fixed_rig_condition_plane_producer_v1.0.0",
    coordinateFrame: "normalized_card_portrait_pixels",
    registrationTransformDirection:
      "design_reference_pixels_to_normalized_card_pixels",
    coreRequiredInputs: [
      "normalized_all_on_rgb",
      "normalized_accepted_profile_rgb",
      "outer_cut_contour",
      "photometric_directional_residuals",
      "finalized_physical_calibration",
    ],
    designDependentInputs: ["approved_design_reference_rgb"],
    missingDesignReferencePolicy:
      "design_dependent_planes_unavailable_and_any_significant_unexplained_color_candidate_requires_recapture",
    color: {
      space: "cie_lab_d65",
      linearization: "iec_61966_2_1",
      deltaEFormula: "cie76",
      robustNormalization: "per_channel_trimmed_location_scale",
      trimFraction: 0.1,
      minimumValidSamples: 1024,
      gainClamp: [0.5, 2],
      offsetClamp: [-0.25, 0.25],
      stainLowPassRadiusMm: 0.5,
      printHighPassRadiusMm: 0.2,
      fiberLightnessDeltaFullScale: 20,
      residueChromaDeltaFullScale: 20,
    },
    boundary: {
      fillRule: "even_odd",
      distanceMetric: "euclidean",
      roughnessWindowMm: 1,
      boundaryRoughnessFullScaleMm: 0.5,
    },
    directional: {
      residualRangeFormula:
        "max(validDirectionalResidual) - min(validDirectionalResidual)",
      reliefFullScale: 0.25,
      scratchNormalRadiusMm: 0.15,
      scratchTangentRadiusMm: 0.75,
      creaseNormalRadiusMm: 0.5,
      creaseTangentRadiusMm: 1.5,
      scuffWindowRadiusMm: 0.75,
      deformationWindowRadiusMm: 1,
      delaminationEdgeBandMm: 1,
    },
    unsupportedModalityGates: {
      polarizedResidueSourceRequiredForPositiveResidue: true,
      residueCandidateDeltaEThresholdReference:
        "surfaceEvidence.minimumResidueDeltaE",
      unsupportedCandidatePolicy: "insufficient_evidence_no_deduction",
    },
    formulas: {
      expectedOuterCardMask: "inside exact hash-bound intended outer-boundary contour artifact",
      materialPresenceConfidence: "inside exact hash-bound observed outer-cut contour artifact",
      segmentationConfidence:
        "min(outerCutBoundaryConfidence, photometricValidObservation)",
      designDifferenceConfidence:
        "min(registeredDesignConfidence, photometricValidObservation)",
      boundaryDeviationMm:
        "signed euclidean intended-to-observed boundary distance plane; magnitude and symmetric-difference masks derive missing/chipped material without inferring intended geometry from the observed cut",
      exposedFiberResponse:
        "clamp((observedLabL - designLabL) / fiberLightnessDeltaFullScale, 0, 1)",
      reliefIndex:
        "clamp(directionalResidualRange / reliefFullScale, 0, 1)",
      scratchLineResponse:
        "max_orientation(clamp(abs(centerRelief - mean(normalOffsets)) / reliefFullScale, 0, 1) * tangentSupportFraction)",
      creaseLineResponse:
        "scratchLineResponse evaluated at the versioned crease normal/tangent radii",
      scuffTextureResponse:
        "clamp(localRms(highPassRelief) / reliefFullScale, 0, 1)",
      deformationResponse:
        "clamp(localMean(relief) / reliefFullScale, 0, 1)",
      delaminationResponse:
        "deformationResponse within delaminationEdgeBandMm",
      edgeRoughnessIndex:
        "clamp(localRms(boundaryDeviationMm) / boundaryRoughnessFullScaleMm, 0, 1)",
      frayingResponse:
        "clamp(localRms(highFrequencyObservedBoundaryDeviationMm) / boundaryRoughnessFullScaleMm, 0, 1); printed-image luminance is excluded",
      registeredColorDeltaE:
        "low-pass CIE76 after robust registered color normalization",
      registeredPrintDeltaE:
        "high-pass CIE76 after robust registered color normalization",
      registeredResidueDeltaE:
        "CIE Lab chroma delta gated by calibrated polarized evidence",
    },
  },
  surfaceEvidence: {
    saturationNormalizedThreshold: 0.98,
    underexposureNormalizedThreshold: 0.02,
    commonModeSpecularMinResponse: 0.75,
    commonModeMaxRelativeSpread: 0.15,
    commonModeLowerQuantile: 0.1,
    commonModeUpperQuantile: 0.9,
    commonModeChannelFraction: 0.75,
    calibratedPatternMinCosineSimilarity: 0.92,
    calibratedPatternMaxRelativeResidual: 0.2,
    directionalResidualThreshold: 0.08,
    corroboratingPixelFraction: 0.35,
    minConnectedComponentPixels: 12,
    minimumUngradableRegionPixels: 12,
    minValidPixelCoverage: 0.7,
    minValidDirectionalObservations: 3,
    minCorroboratingChannels: 2,
    glareSuppressionOverlapFraction: 0.6,
    maxClippedPixelFraction: 0.1,
    minLightingChannelConfidence: 0.8,
    alternateChannelRecoveryMinCoverage: 0.6,
    fullyObscuredCoverageThreshold: 0.3,
    minimumScratchAspectRatio: 4,
    maximumScratchWidthMm: 0.5,
    minimumCreaseLengthMm: 1,
    minimumScuffAreaMm2: 0.1,
    minimumDentReliefIndex: 0.08,
    minimumStainDeltaE: 3,
    minimumPrintDefectDeltaE: 3,
    minimumResidueDeltaE: 4,
    candidateOverlapMergeIouThreshold: 0.35,
    candidateOverlapMergeCentroidDistanceMm: 0.5,
    heatmapIsIndependentEvidence: false,
  },
  surface: {
    findingFusion: "sum_unique_physical_defect_deductions",
    formula: "score = clamp(10 - sum(unique measurement-derived physical-defect deductions), 1, 10)",
  },
  findings: {
    corner_whitening: findingPolicy("corners", "area_mm2", "mm2", 1, 0.02, 2.5),
    corner_material_loss: findingPolicy("corners", "area_mm2", "mm2", 0.75, 0.01, 6),
    corner_chip: findingPolicy("corners", "length_mm", "mm", 1, 0.03, 4),
    corner_shape_deviation: findingPolicy("corners", "shape_deviation_mm", "mm", 1, 0.03, 3),
    corner_deformation: findingPolicy("corners", "deformation_area_mm2", "mm2", 2, 0.03, 4),
    corner_delamination: findingPolicy("corners", "length_mm", "mm", 2, 0.05, 4),
    corner_directional_relief: findingPolicy("corners", "relief_index", "relief_index", 1, 0.05, 3),
    edge_damage: findingPolicy("edges", "length_mm", "mm", 20, 0.1, 4),
    edge_chip: findingPolicy("edges", "depth_mm", "mm", 0.75, 0.02, 5),
    edge_whitening: findingPolicy("edges", "area_mm2", "mm2", 4, 0.03, 3),
    edge_roughness: findingPolicy("edges", "roughness_index", "roughness_index", 1, 0.05, 2.5),
    edge_fraying: findingPolicy("edges", "length_mm", "mm", 10, 0.1, 3.5),
    edge_delamination: findingPolicy("edges", "length_mm", "mm", 10, 0.1, 4),
    edge_deformation: findingPolicy("edges", "deformation_area_mm2", "mm2", 5, 0.05, 4),
    scratch: findingPolicy("surface", "length_mm", "mm", 20, 0.1, 4),
    scuff: findingPolicy("surface", "area_mm2", "mm2", 25, 0.1, 4),
    dent: findingPolicy("surface", "deformation_area_mm2", "mm2", 20, 0.1, 5),
    crease: findingPolicy("surface", "length_mm", "mm", 35, 0.1, 9),
    stain: findingPolicy("surface", "area_mm2", "mm2", 50, 0.1, 5),
    print_defect: findingPolicy("surface", "area_mm2", "mm2", 40, 0.1, 4),
    foreign_material: findingPolicy("surface", "area_mm2", "mm2", 25, 0.1, 4),
    alteration: findingPolicy("surface", "area_mm2", "mm2", 10, 0.05, 9),
    material_loss: findingPolicy("surface", "area_mm2", "mm2", 10, 0.05, 8),
  } satisfies Record<MathematicalFindingCategoryV1, FindingPolicy>,
  severeDefectCaps: {
    crease: { measurementKind: "length_mm", thresholdBasis: "effective_measurement_after_u95", comparison: "greater_than_or_equal", threshold: 20, overallCap: 5 },
    dent: { measurementKind: "relief_index", thresholdBasis: "effective_measurement_after_u95", comparison: "greater_than_or_equal", threshold: 0.7, overallCap: 6 },
    alteration: { measurementKind: "area_mm2", thresholdBasis: "effective_measurement_after_u95", comparison: "greater_than_or_equal", threshold: 5, overallCap: 2 },
    material_loss: { measurementKind: "area_mm2", thresholdBasis: "effective_measurement_after_u95", comparison: "greater_than_or_equal", threshold: 2, overallCap: 4 },
  },
  overall: {
    weights: {
      centering: 0.3,
      corners: 0.25,
      edges: 0.25,
      surface: 0.2,
    },
    weakestElementAllowance: 0.5,
    weightedFormula:
      "0.30 * centering + 0.25 * corners + 0.25 * edges + 0.20 * surface",
    finalFormula:
      "min(weightedGrade, weakestElement + 0.50, applicableSevereDefectCaps)",
  },
} as const;

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry));
  }
  return value as Readonly<T>;
}

export const MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST = deepFreeze({
  ...manifestWithoutHash,
  sourceHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
});

export type MathematicalGradingV1ThresholdManifest =
  typeof MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST;

export const MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION =
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.maximum -
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.minimum;

export function canonicalizeMathematicalGradingManifestV1(): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key !== "sourceHash")
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST));
}

const finiteNonnegativeSchema = z.number().finite().nonnegative();
const finitePositiveSchema = z.number().finite().positive();
const fractionSchema = z.number().finite().min(0).max(1);
const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const logicalAssetIdSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => {
    if (/^[\\/]/.test(value) || /[\\?#\u0000-\u001f\u007f]/.test(value)) return false;
    const segments = value.split("/");
    return segments.every(
      (segment) => Boolean(segment) && segment !== "." && segment !== ".." &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment),
    );
  }, "must be a safe logical asset ID");
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const timestampSchema = z.string().datetime({ offset: true });

function decimalPlaces(value: number, places: number): boolean {
  const factor = 10 ** places;
  return Math.abs(value * factor - Math.round(value * factor)) < 1e-8;
}

export const mathematicalScoreV1Schema = z
  .number()
  .finite()
  .min(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.minimum)
  .max(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.maximum)
  .refine((value) => decimalPlaces(value, 2), "must contain at most two decimal places");

export const mathematicalLabelGradeV1Schema = z
  .number()
  .finite()
  .min(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.minimum)
  .max(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.maximum)
  .refine((value) => decimalPlaces(value, 1), "must contain at most one decimal place");

export function clampMathematicalGradeV1(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError("Mathematical grade must be finite.");
  return Math.min(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.maximum,
    Math.max(MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.minimum, value),
  );
}

function roundHalfAwayFromZero(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const absolute = Math.abs(value) * factor;
  const rounded = Math.floor(absolute + 0.5 + Number.EPSILON);
  return (Math.sign(value) * rounded) / factor;
}

export function roundMathematicalScoreV1(value: number): number {
  return roundHalfAwayFromZero(
    clampMathematicalGradeV1(value),
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.internalDecimals,
  );
}

export function roundMathematicalLabelGradeV1(value: number): number {
  return roundHalfAwayFromZero(
    clampMathematicalGradeV1(value),
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.labelDecimals,
  );
}

export function formatMathematicalScoreV1(value: number): string {
  return roundMathematicalScoreV1(value).toFixed(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.reportDecimals,
  );
}

export type MathematicalMeasurementUncertaintyComponentsV1 = Readonly<{
  pixelMmScale: number;
  lensDistortion: number;
  normalizationRegistration: number;
  repeatedPlacement: number;
  segmentationBoundary: number;
  measurementRepeatability: number;
  lightingChannelConfidence: number;
}>;

export const mathematicalMeasurementUncertaintyComponentsV1Schema = z.strictObject({
  pixelMmScale: finiteNonnegativeSchema,
  lensDistortion: finiteNonnegativeSchema,
  normalizationRegistration: finiteNonnegativeSchema,
  repeatedPlacement: finiteNonnegativeSchema,
  segmentationBoundary: finiteNonnegativeSchema,
  measurementRepeatability: finiteNonnegativeSchema,
  lightingChannelConfidence: finiteNonnegativeSchema,
});

export function combineMeasurementUncertaintyU95(
  components: MathematicalMeasurementUncertaintyComponentsV1 | readonly number[],
): number {
  const values = Array.isArray(components)
    ? components
    : Object.values(components as MathematicalMeasurementUncertaintyComponentsV1);
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("U95 components must be a nonempty collection of finite nonnegative values in the measurement unit.");
  }
  return roundHalfAwayFromZero(Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0)), 6);
}

export function effectiveMeasurementV1(measuredMeasurement: number, u95: number): number {
  if (!Number.isFinite(measuredMeasurement) || measuredMeasurement < 0) {
    throw new RangeError("Measured measurement must be finite and nonnegative.");
  }
  if (!Number.isFinite(u95) || u95 < 0) throw new RangeError("U95 must be finite and nonnegative.");
  return roundHalfAwayFromZero(Math.max(0, measuredMeasurement - u95), 6);
}

export function grade10BufferV1(u95: number, explicitGrade10Tolerance: number): number {
  if (!Number.isFinite(u95) || u95 < 0 || !Number.isFinite(explicitGrade10Tolerance) || explicitGrade10Tolerance < 0) {
    throw new RangeError("Grade-10 buffer inputs must be finite and nonnegative.");
  }
  return roundHalfAwayFromZero(Math.max(u95, explicitGrade10Tolerance), 6);
}

export const mathematicalEvidenceReferenceV1Schema = z.strictObject({
  assetId: logicalAssetIdSchema,
  sha256: sha256Schema,
  side: z.enum(["front", "back"]),
  role: z.enum([
    "normalized_card",
    "all_on",
    "accepted_profile",
    "design_reference",
    "directional_channel",
    "confidence_mask",
    "illumination_mask",
    "segmentation_mask",
    "measurement_overlay",
    "roi_crop",
  ]),
  regionId: identifierSchema,
  channelIndex: z.number().int().min(1).max(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount,
  ).optional(),
});

export const mathematicalMeasurementV1Schema = z
  .strictObject({
    schemaVersion: z.literal(MATHEMATICAL_MEASUREMENT_V1_SCHEMA_VERSION),
    measurementId: identifierSchema,
    kind: z.enum(MATHEMATICAL_MEASUREMENT_KINDS_V1),
    unit: z.enum(MATHEMATICAL_MEASUREMENT_UNITS_V1),
    measuredMeasurement: finiteNonnegativeSchema,
    uncertaintyComponentsU95: mathematicalMeasurementUncertaintyComponentsV1Schema,
    u95: finiteNonnegativeSchema,
    effectiveMeasurement: finiteNonnegativeSchema,
    explicitGrade10Tolerance: finiteNonnegativeSchema,
    grade10Buffer: finiteNonnegativeSchema,
    calibrationProfileId: identifierSchema,
    calibrationVersion: identifierSchema,
    algorithmVersion: identifierSchema,
    thresholdSetId: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID),
    thresholdSetHash: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH),
    evidence: z.array(mathematicalEvidenceReferenceV1Schema).min(1).max(64),
    validEvidenceCoverage: fractionSchema,
    usableDirectionalChannelCount: z.number().int().min(0).max(
      MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount,
    ),
  })
  .superRefine((measurement, context) => {
    const combined = combineMeasurementUncertaintyU95(measurement.uncertaintyComponentsU95);
    if (measurement.u95 !== combined) {
      context.addIssue({ code: "custom", path: ["u95"], message: "must equal the root-sum-square U95 components" });
    }
    if (measurement.effectiveMeasurement !== effectiveMeasurementV1(measurement.measuredMeasurement, measurement.u95)) {
      context.addIssue({ code: "custom", path: ["effectiveMeasurement"], message: "must equal max(0, measuredMeasurement - U95)" });
    }
    if (measurement.grade10Buffer !== grade10BufferV1(measurement.u95, measurement.explicitGrade10Tolerance)) {
      context.addIssue({ code: "custom", path: ["grade10Buffer"], message: "must equal max(U95, explicitGrade10Tolerance)" });
    }
    const assetKeys = measurement.evidence.map((entry) => `${entry.assetId.toLowerCase()}:${entry.regionId.toLowerCase()}:${entry.channelIndex ?? 0}`);
    if (new Set(assetKeys).size !== assetKeys.length) {
      context.addIssue({ code: "custom", path: ["evidence"], message: "must not contain duplicate evidence bindings" });
    }
  });

export type MathematicalMeasurementV1 = z.infer<typeof mathematicalMeasurementV1Schema>;

export function buildMathematicalMeasurementV1(
  input: Omit<MathematicalMeasurementV1, "schemaVersion" | "u95" | "effectiveMeasurement" | "grade10Buffer" | "thresholdSetId" | "thresholdSetHash">,
): MathematicalMeasurementV1 {
  const u95 = combineMeasurementUncertaintyU95(input.uncertaintyComponentsU95);
  return mathematicalMeasurementV1Schema.parse({
    ...input,
    schemaVersion: MATHEMATICAL_MEASUREMENT_V1_SCHEMA_VERSION,
    u95,
    effectiveMeasurement: effectiveMeasurementV1(input.measuredMeasurement, u95),
    grade10Buffer: grade10BufferV1(u95, input.explicitGrade10Tolerance),
    thresholdSetId: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID,
    thresholdSetHash: MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH,
  });
}

export type FindingDeductionCalculationV1 = Readonly<{
  category: MathematicalFindingCategoryV1;
  measuredMeasurement: number;
  u95: number;
  effectiveMeasurement: number;
  grade10Buffer: number;
  deductionBasisMeasurement: number;
  referenceMeasurement: number;
  normalizedSeverity: number;
  maximumDeduction: number;
  deduction: number;
  curve: typeof MATHEMATICAL_FINDING_DEDUCTION_CURVE_V1;
  formula: typeof MATHEMATICAL_FINDING_DEDUCTION_FORMULA_V1;
}>;

export function calculateFindingDeductionV1(input: {
  category: MathematicalFindingCategoryV1;
  measuredMeasurement: number;
  u95: number;
}): FindingDeductionCalculationV1 {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[input.category];
  if (!policy) throw new RangeError(`Unsupported Mathematical Grading V1 category: ${String(input.category)}`);
  const effective = effectiveMeasurementV1(input.measuredMeasurement, input.u95);
  const buffer = grade10BufferV1(input.u95, policy.grade10Tolerance);
  const deductionBasisMeasurement = input.measuredMeasurement <= buffer ? 0 : effective;
  const normalizedSeverity = roundHalfAwayFromZero(
    Math.min(1, Math.max(0, deductionBasisMeasurement / policy.referenceMeasurement)),
    6,
  );
  const deduction = roundHalfAwayFromZero(policy.maximumDeduction * normalizedSeverity, 2);
  return {
    category: input.category,
    measuredMeasurement: input.measuredMeasurement,
    u95: input.u95,
    effectiveMeasurement: effective,
    grade10Buffer: buffer,
    deductionBasisMeasurement,
    referenceMeasurement: policy.referenceMeasurement,
    normalizedSeverity,
    maximumDeduction: policy.maximumDeduction,
    deduction,
    curve: policy.curve,
    formula: MATHEMATICAL_FINDING_DEDUCTION_FORMULA_V1,
  };
}

export function calculateApplicableSevereDefectCapV1(
  category: MathematicalFindingCategoryV1,
  measurements: readonly Pick<MathematicalMeasurementV1, "kind" | "measuredMeasurement" | "u95">[],
): number | undefined {
  const capPolicy = (
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.severeDefectCaps as Partial<Record<
      MathematicalFindingCategoryV1,
      {
        measurementKind: MathematicalMeasurementKindV1;
        thresholdBasis: "effective_measurement_after_u95";
        comparison: "greater_than_or_equal";
        threshold: number;
        overallCap: number;
      }
    >>
  )[category];
  if (!capPolicy) return undefined;
  const measurement = measurements.find((entry) => entry.kind === capPolicy.measurementKind);
  if (!measurement) return undefined;
  const effective = effectiveMeasurementV1(measurement.measuredMeasurement, measurement.u95);
  return effective >= capPolicy.threshold ? capPolicy.overallCap : undefined;
}

export function scoreCenteringRatioV1(balanceRatio: number): number {
  if (!Number.isFinite(balanceRatio) || balanceRatio < 0 || balanceRatio > 100) {
    throw new RangeError("Centering balance ratio must be a finite percentage from 0 through 100.");
  }
  const curve = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.balanceCurve;
  for (let index = 1; index < curve.length; index += 1) {
    const lower = curve[index - 1];
    const upper = curve[index];
    if (balanceRatio <= upper.ratio) {
      const fraction = (balanceRatio - lower.ratio) / (upper.ratio - lower.ratio);
      return roundMathematicalScoreV1(lower.score + fraction * (upper.score - lower.score));
    }
  }
  return MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.maximum;
}

export type CenteringAxisCalculationV1 = Readonly<{
  marginA: number;
  marginB: number;
  measuredDifference: number;
  differenceU95: number;
  grade10Buffer: number;
  effectiveDifference: number;
  balanceRatio: number;
  score: number;
}>;

export function calculateCenteringAxisV1(marginA: number, marginB: number, differenceU95: number): CenteringAxisCalculationV1 {
  if (![marginA, marginB, differenceU95].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new RangeError("Centering margins and U95 must be finite and nonnegative.");
  }
  const smaller = Math.min(marginA, marginB);
  const measuredDifference = Math.abs(marginA - marginB);
  const buffer = grade10BufferV1(
    differenceU95,
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.grade10Tolerance.marginDifferenceMm,
  );
  const effectiveDifference = measuredDifference <= buffer
    ? 0
    : effectiveMeasurementV1(measuredDifference, differenceU95);
  const adjustedLarger = smaller + effectiveDifference;
  const balanceRatio = adjustedLarger === 0 ? 100 : roundHalfAwayFromZero(100 * smaller / adjustedLarger, 6);
  return {
    marginA,
    marginB,
    measuredDifference: roundHalfAwayFromZero(measuredDifference, 6),
    differenceU95,
    grade10Buffer: buffer,
    effectiveDifference,
    balanceRatio,
    score: scoreCenteringRatioV1(balanceRatio),
  };
}

export type RegisteredDesignTemplateAxisCalculationV1 = CenteringAxisCalculationV1 & Readonly<{
  observedMarginA: number;
  observedMarginB: number;
  expectedMarginA: number;
  expectedMarginB: number;
  physicalAxisSpan: number;
  axisError: number;
}>;

export function calculateRegisteredDesignTemplateAxisV1(input: {
  observedMarginA: number;
  observedMarginB: number;
  expectedMarginA: number;
  expectedMarginB: number;
  physicalAxisSpan: number;
  differenceU95: number;
}): RegisteredDesignTemplateAxisCalculationV1 {
  if (Object.values(input).some((value) => !Number.isFinite(value) || value < 0) || input.physicalAxisSpan <= 0) {
    throw new RangeError("Registered-template margins, span, and U95 must be finite and nonnegative, with a positive span.");
  }
  const axisError =
    ((input.observedMarginA - input.expectedMarginA) -
      (input.observedMarginB - input.expectedMarginB)) / 2;
  const equivalentMarginA = input.physicalAxisSpan / 2 + axisError;
  const equivalentMarginB = input.physicalAxisSpan / 2 - axisError;
  if (equivalentMarginA < 0 || equivalentMarginB < 0) {
    throw new RangeError("Registered-template axis error lies outside the physical axis span.");
  }
  return {
    ...calculateCenteringAxisV1(equivalentMarginA, equivalentMarginB, input.differenceU95),
    observedMarginA: input.observedMarginA,
    observedMarginB: input.observedMarginB,
    expectedMarginA: input.expectedMarginA,
    expectedMarginB: input.expectedMarginB,
    physicalAxisSpan: input.physicalAxisSpan,
    axisError: roundHalfAwayFromZero(axisError, 6),
  };
}

export function fuseCenteringSideAxesV1(horizontalScore: number, verticalScore: number): number {
  mathematicalScoreV1Schema.parse(horizontalScore);
  mathematicalScoreV1Schema.parse(verticalScore);
  return roundMathematicalScoreV1(Math.min(horizontalScore, verticalScore));
}

export function fuseCenteringFrontBackV1(frontScore: number, backScore: number): number {
  mathematicalScoreV1Schema.parse(frontScore);
  mathematicalScoreV1Schema.parse(backScore);
  const { worstWeight, averageWeight } = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.frontBackFusion;
  return roundMathematicalScoreV1(
    worstWeight * Math.min(frontScore, backScore) + averageWeight * ((frontScore + backScore) / 2),
  );
}

export type PenaltyAggregationV1 = Readonly<{
  score: number;
  aggregatePenalty: number;
  worstPenalty: number;
  averagePenalty: number;
  observationPenalties: readonly number[];
  formula: string;
}>;

function aggregateObservationPenaltyV1(
  penalties: readonly number[],
  requiredCount: number,
  worstWeight: number,
  averageWeight: number,
  formula: string,
): PenaltyAggregationV1 {
  if (penalties.length !== requiredCount) {
    throw new RangeError(`Exactly ${requiredCount} observation penalties are required.`);
  }
  if (penalties.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Observation penalties must be finite and nonnegative.");
  }
  const worstPenalty = Math.max(...penalties);
  const averagePenalty = penalties.reduce((sum, value) => sum + value, 0) / penalties.length;
  const aggregatePenalty = roundHalfAwayFromZero(worstWeight * worstPenalty + averageWeight * averagePenalty, 6);
  return {
    score: roundMathematicalScoreV1(10 - aggregatePenalty),
    aggregatePenalty,
    worstPenalty: roundHalfAwayFromZero(worstPenalty, 6),
    averagePenalty: roundHalfAwayFromZero(averagePenalty, 6),
    observationPenalties: [...penalties],
    formula,
  };
}

export function aggregateCornerScoreV1(penalties: readonly number[]): PenaltyAggregationV1 {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners;
  return aggregateObservationPenaltyV1(
    penalties,
    policy.requiredObservationCount,
    policy.worstWeight,
    policy.averageWeight,
    policy.formula,
  );
}

export function aggregateEdgeScoreV1(penalties: readonly number[]): PenaltyAggregationV1 {
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges;
  return aggregateObservationPenaltyV1(
    penalties,
    policy.requiredObservationCount,
    policy.worstWeight,
    policy.averageWeight,
    policy.formula,
  );
}

export type MathematicalElementScoresV1 = Readonly<Record<MathematicalGradingElementV1, number>>;

export type MathematicalOverallGradeV1 = Readonly<{
  overall: number;
  weightedGrade: number;
  weakestElement: MathematicalGradingElementV1;
  weakestScore: number;
  weakestElementCap: number;
  applicableSevereDefectCap?: number;
  labelGrade: number;
  weights: typeof MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weights;
  formula: string;
}>;

export function calculateOverallGradeV1(
  elements: MathematicalElementScoresV1,
  applicableSevereDefectCaps: readonly number[] = [],
): MathematicalOverallGradeV1 {
  for (const element of MATHEMATICAL_GRADING_ELEMENTS_V1) mathematicalScoreV1Schema.parse(elements[element]);
  applicableSevereDefectCaps.forEach((cap) => mathematicalScoreV1Schema.parse(cap));
  const weights = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weights;
  const weightedGradeRaw = MATHEMATICAL_GRADING_ELEMENTS_V1.reduce(
    (sum, element) => sum + elements[element] * weights[element],
    0,
  );
  const weakestElement = MATHEMATICAL_GRADING_ELEMENTS_V1.reduce((weakest, element) =>
    elements[element] < elements[weakest] ? element : weakest,
  );
  const weakestScore = elements[weakestElement];
  const weakestElementCap = Math.min(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.maximum,
    weakestScore + MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.weakestElementAllowance,
  );
  const applicableSevereDefectCap = applicableSevereDefectCaps.length
    ? Math.min(...applicableSevereDefectCaps)
    : undefined;
  const overallRaw = Math.min(
    weightedGradeRaw,
    weakestElementCap,
    applicableSevereDefectCap ?? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.scoreContract.maximum,
  );
  const overall = roundMathematicalScoreV1(overallRaw);
  return {
    overall,
    weightedGrade: roundMathematicalScoreV1(weightedGradeRaw),
    weakestElement,
    weakestScore,
    weakestElementCap: roundMathematicalScoreV1(weakestElementCap),
    ...(applicableSevereDefectCap === undefined ? {} : { applicableSevereDefectCap }),
    labelGrade: roundMathematicalLabelGradeV1(overall),
    weights,
    formula: MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.overall.finalFormula,
  };
}

const directionVectorSchema = z
  .strictObject({ x: z.number().finite().min(-1).max(1), y: z.number().finite().min(-1).max(1) })
  .refine((value) => Math.hypot(value.x, value.y) > 0.5 && Math.hypot(value.x, value.y) < 1.5, {
    message: "direction vector must be normalized",
  });

export const mathematicalCalibrationChannelV1Schema = z.strictObject({
  channelIndex: z.number().int().min(1).max(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance.requiredChannelCount,
  ),
  direction: directionVectorSchema,
  directionConfidence: fractionSchema,
  directionMeasurementSampleCount: z.number().int().positive(),
  directionAngularU95Degrees: finiteNonnegativeSchema,
  directionSourceRadiusMm: finitePositiveSchema,
  directionPointU95Mm: finitePositiveSchema,
  flatFieldArtifactId: identifierSchema,
  flatFieldArtifactSha256: sha256Schema,
  flatFieldFrameCount: z.number().int().positive(),
  darkControlFrameCount: z.number().int().positive(),
  maxFlatFieldDeviationFraction: fractionSchema,
  illuminationPatternArtifactId: identifierSchema,
  illuminationPatternArtifactSha256: sha256Schema,
  illuminationPatternFrameCount: z.number().int().positive(),
  responseScale: finitePositiveSchema,
});

const mathematicalMeasurementRepeatabilityEntryV1Schema = z.strictObject({
  sampleCount: z.number().int().positive(),
  u95: finiteNonnegativeSchema,
});

export const mathematicalMeasurementRepeatabilityV1Schema = z.strictObject({
  linearMm: mathematicalMeasurementRepeatabilityEntryV1Schema,
  areaMm2: mathematicalMeasurementRepeatabilityEntryV1Schema,
  reliefIndex: mathematicalMeasurementRepeatabilityEntryV1Schema,
  roughnessIndex: mathematicalMeasurementRepeatabilityEntryV1Schema,
  colorDeltaE: mathematicalMeasurementRepeatabilityEntryV1Schema,
});

export const mathematicalCalibrationProfileV1Schema = z.strictObject({
  schemaVersion: z.literal(MATHEMATICAL_CALIBRATION_PROFILE_V1_SCHEMA_VERSION),
  profileId: identifierSchema,
  calibrationVersion: identifierSchema,
  rigId: identifierSchema,
  isCalibrated: z.literal(true),
  status: z.literal("finalized"),
  coordinateFrame: z.literal("normalized_card_portrait_pixels"),
  thresholdSetId: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID),
  thresholdSetHash: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH),
  artifactId: identifierSchema,
  artifactSha256: sha256Schema,
  finalizedAt: timestampSchema,
  normalizedWidthPx: z.number().int().positive(),
  normalizedHeightPx: z.number().int().positive(),
  mmPerPixelX: finitePositiveSchema,
  mmPerPixelY: finitePositiveSchema,
  scaleRelativeU95: fractionSchema,
  scaleSampleCount: z.number().int().positive(),
  lensCalibrationViewCount: z.number().int().positive(),
  lensResidualPx: finiteNonnegativeSchema,
  normalizationRegistrationResidualPx: finiteNonnegativeSchema,
  normalizationRegistrationSampleCount: z.number().int().positive(),
  repeatedPlacementCount: z.number().int().positive(),
  repeatedPlacementU95Mm: finiteNonnegativeSchema,
  segmentationBoundaryU95Px: finiteNonnegativeSchema,
  segmentationBoundarySampleCount: z.number().int().positive(),
  measurementRepeatability: mathematicalMeasurementRepeatabilityV1Schema,
  channels: z.array(mathematicalCalibrationChannelV1Schema),
});

export type MathematicalCalibrationProfileV1 = z.infer<typeof mathematicalCalibrationProfileV1Schema>;

export type MathematicalCalibrationValidationIssueV1 = Readonly<{
  path: string;
  message: string;
}>;

export type MathematicalCalibrationValidationResultV1 = Readonly<{
  valid: boolean;
  isCalibrated: boolean;
  issues: readonly MathematicalCalibrationValidationIssueV1[];
  profile?: MathematicalCalibrationProfileV1;
}>;

export function validateMathematicalCalibrationProfileV1(value: unknown): MathematicalCalibrationValidationResultV1 {
  const parsed = mathematicalCalibrationProfileV1Schema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      isCalibrated: false,
      issues: parsed.error.issues.map((entry) => ({ path: entry.path.join("."), message: entry.message })),
    };
  }
  const profile = parsed.data;
  const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.calibrationAcceptance;
  const issues: MathematicalCalibrationValidationIssueV1[] = [];
  const maximum = (path: string, actual: number, limit: number) => {
    if (actual > limit) issues.push({ path, message: `must be <= ${limit}; observed ${actual}` });
  };
  const minimum = (path: string, actual: number, limit: number) => {
    if (actual < limit) issues.push({ path, message: `must be >= ${limit}; observed ${actual}` });
  };
  maximum("scaleRelativeU95", profile.scaleRelativeU95, policy.maxScaleRelativeU95);
  maximum("lensResidualPx", profile.lensResidualPx, policy.maxLensResidualPx);
  maximum(
    "normalizationRegistrationResidualPx",
    profile.normalizationRegistrationResidualPx,
    policy.maxRegistrationResidualPx,
  );
  minimum(
    "normalizationRegistrationSampleCount",
    profile.normalizationRegistrationSampleCount,
    policy.minimumNormalizationRegistrations,
  );
  maximum("repeatedPlacementU95Mm", profile.repeatedPlacementU95Mm, policy.maxPlacementU95Mm);
  maximum("segmentationBoundaryU95Px", profile.segmentationBoundaryU95Px, policy.maxSegmentationBoundaryU95Px);
  minimum(
    "segmentationBoundarySampleCount",
    profile.segmentationBoundarySampleCount,
    policy.minimumSegmentationBoundarySamples,
  );
  minimum("scaleSampleCount", profile.scaleSampleCount, policy.minimumScaleSamples);
  minimum("lensCalibrationViewCount", profile.lensCalibrationViewCount, policy.minimumLensCalibrationViews);
  minimum("repeatedPlacementCount", profile.repeatedPlacementCount, policy.minimumRepeatedPlacements);
  const repeatabilityLimits = policy.maximumMeasurementRepeatabilityU95;
  const repeatabilityEntries = [
    ["linearMm", profile.measurementRepeatability.linearMm, repeatabilityLimits.linearMm],
    ["areaMm2", profile.measurementRepeatability.areaMm2, repeatabilityLimits.areaMm2],
    ["reliefIndex", profile.measurementRepeatability.reliefIndex, repeatabilityLimits.reliefIndex],
    ["roughnessIndex", profile.measurementRepeatability.roughnessIndex, repeatabilityLimits.roughnessIndex],
    ["colorDeltaE", profile.measurementRepeatability.colorDeltaE, repeatabilityLimits.colorDeltaE],
  ] as const;
  repeatabilityEntries.forEach(([name, entry, limit]) => {
    minimum(
      `measurementRepeatability.${name}.sampleCount`,
      entry.sampleCount,
      policy.minimumMeasurementRepeatabilitySamplesPerClass,
    );
    maximum(`measurementRepeatability.${name}.u95`, entry.u95, limit);
  });
  if (profile.channels.length !== policy.requiredChannelCount) {
    issues.push({ path: "channels", message: `must contain exactly ${policy.requiredChannelCount} calibrated channels` });
  }
  const channelIndexes = profile.channels.map((channel) => channel.channelIndex);
  if (new Set(channelIndexes).size !== channelIndexes.length ||
      channelIndexes.some((index) => index < 1 || index > policy.requiredChannelCount)) {
    issues.push({ path: "channels.channelIndex", message: "must contain each required channel exactly once" });
  }
  profile.channels.forEach((channel, index) => {
    minimum(`channels.${index}.directionConfidence`, channel.directionConfidence, policy.minChannelDirectionConfidence);
    minimum(
      `channels.${index}.directionMeasurementSampleCount`,
      channel.directionMeasurementSampleCount,
      policy.minimumChannelDirectionMeasurementSamples,
    );
    maximum(
      `channels.${index}.directionAngularU95Degrees`,
      channel.directionAngularU95Degrees,
      policy.maxChannelDirectionAngularU95Degrees,
    );
    minimum(
      `channels.${index}.directionSourceRadiusMm`,
      channel.directionSourceRadiusMm,
      channel.directionPointU95Mm * policy.minimumChannelDirectionSourceRadiusToPointU95Ratio,
    );
    const expectedDirectionConfidence = roundHalfAwayFromZero(
      Math.max(
        0,
        1 - channel.directionAngularU95Degrees / policy.channelDirectionConfidenceSectorScaleDegrees,
      ),
      6,
    );
    if (Math.abs(channel.directionConfidence - expectedDirectionConfidence) > 1e-6) {
      issues.push({
        path: `channels.${index}.directionConfidence`,
        message:
          `must equal ${policy.channelDirectionConfidenceFormula}; expected ${expectedDirectionConfidence}, observed ${channel.directionConfidence}`,
      });
    }
    maximum(
      `channels.${index}.maxFlatFieldDeviationFraction`,
      channel.maxFlatFieldDeviationFraction,
      policy.maxFlatFieldDeviationFraction,
    );
    minimum(
      `channels.${index}.flatFieldFrameCount`,
      channel.flatFieldFrameCount,
      policy.minimumFlatFieldFramesPerChannel,
    );
    minimum(
      `channels.${index}.darkControlFrameCount`,
      channel.darkControlFrameCount,
      policy.minimumDarkControlFramesPerChannel,
    );
    minimum(
      `channels.${index}.illuminationPatternFrameCount`,
      channel.illuminationPatternFrameCount,
      policy.minimumIlluminationPatternFramesPerChannel,
    );
  });
  if (policy.requireDistinctDirectionVectors) {
    for (let left = 0; left < profile.channels.length; left += 1) {
      for (let right = left + 1; right < profile.channels.length; right += 1) {
        const a = profile.channels[left].direction;
        const b = profile.channels[right].direction;
        const cosine = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
        if (cosine > policy.maximumDistinctDirectionCosineSimilarity) {
          issues.push({ path: `channels.${right}.direction`, message: "must be distinct from other calibrated directions" });
        }
      }
    }
  }
  return {
    valid: issues.length === 0,
    isCalibrated: issues.length === 0,
    issues,
    ...(issues.length ? {} : { profile }),
  };
}

export const MATHEMATICAL_DESIGN_REFERENCE_V1_MIN_CONTOUR_POINTS = 4 as const;
export const MATHEMATICAL_DESIGN_REFERENCE_V1_MAX_CONTOUR_POINTS = 64 as const;

export type MathematicalDesignReferencePixelPointV1 = readonly [number, number];
export type MathematicalDesignReferencePixelContourValidationV1 =
  | Readonly<{
      valid: true;
      contour: readonly MathematicalDesignReferencePixelPointV1[];
      signedDoubleArea: number;
    }>
  | Readonly<{ valid: false; issues: readonly string[] }>;

function samePixelPoint(
  left: MathematicalDesignReferencePixelPointV1,
  right: MathematicalDesignReferencePixelPointV1,
): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function orientation(
  first: MathematicalDesignReferencePixelPointV1,
  second: MathematicalDesignReferencePixelPointV1,
  third: MathematicalDesignReferencePixelPointV1,
): number {
  return (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0]);
}

function pointOnSegment(
  point: MathematicalDesignReferencePixelPointV1,
  start: MathematicalDesignReferencePixelPointV1,
  end: MathematicalDesignReferencePixelPointV1,
): boolean {
  return orientation(start, end, point) === 0 &&
    point[0] >= Math.min(start[0], end[0]) && point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) && point[1] <= Math.max(start[1], end[1]);
}

function segmentsIntersect(
  firstStart: MathematicalDesignReferencePixelPointV1,
  firstEnd: MathematicalDesignReferencePixelPointV1,
  secondStart: MathematicalDesignReferencePixelPointV1,
  secondEnd: MathematicalDesignReferencePixelPointV1,
): boolean {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);
  if (
    ((firstOrientation > 0 && secondOrientation < 0) || (firstOrientation < 0 && secondOrientation > 0)) &&
    ((thirdOrientation > 0 && fourthOrientation < 0) || (thirdOrientation < 0 && fourthOrientation > 0))
  ) return true;
  return (firstOrientation === 0 && pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (secondOrientation === 0 && pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (thirdOrientation === 0 && pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (fourthOrientation === 0 && pointOnSegment(firstEnd, secondStart, secondEnd));
}

/**
 * Validates the immutable pixel-coordinate contour before either persistence
 * or projection. A valid contour is a finite, simple polygon inside the exact
 * artifact coordinate extent. Repeated vertices, zero area, and non-adjacent
 * touching/crossing edges are rejected as ambiguous precision references.
 */
export function validateMathematicalDesignReferencePixelContourV1(
  value: unknown,
  artifactWidthPx: number,
  artifactHeightPx: number,
): MathematicalDesignReferencePixelContourValidationV1 {
  const issues: string[] = [];
  if (!Number.isSafeInteger(artifactWidthPx) || artifactWidthPx < 1 ||
      !Number.isSafeInteger(artifactHeightPx) || artifactHeightPx < 1) {
    return { valid: false, issues: ["artifact dimensions must be positive integers"] };
  }
  if (!Array.isArray(value)) return { valid: false, issues: ["contour must be an array"] };
  if (value.length < MATHEMATICAL_DESIGN_REFERENCE_V1_MIN_CONTOUR_POINTS ||
      value.length > MATHEMATICAL_DESIGN_REFERENCE_V1_MAX_CONTOUR_POINTS) {
    issues.push(
      `contour must contain ${MATHEMATICAL_DESIGN_REFERENCE_V1_MIN_CONTOUR_POINTS}-${MATHEMATICAL_DESIGN_REFERENCE_V1_MAX_CONTOUR_POINTS} vertices`,
    );
  }
  const contour: MathematicalDesignReferencePixelPointV1[] = [];
  value.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2 ||
        !Number.isFinite(entry[0]) || !Number.isFinite(entry[1])) {
      issues.push(`contour[${index}] must be an exact finite [x, y] point`);
      return;
    }
    const point = [Number(entry[0]), Number(entry[1])] as const;
    if (point[0] < 0 || point[0] > artifactWidthPx ||
        point[1] < 0 || point[1] > artifactHeightPx) {
      issues.push(`contour[${index}] must lie inside the artifact dimensions`);
    }
    contour.push(point);
  });
  if (issues.length || contour.length < MATHEMATICAL_DESIGN_REFERENCE_V1_MIN_CONTOUR_POINTS) {
    return { valid: false, issues };
  }
  for (let left = 0; left < contour.length; left += 1) {
    for (let right = left + 1; right < contour.length; right += 1) {
      if (samePixelPoint(contour[left]!, contour[right]!)) {
        issues.push(`contour vertices ${left} and ${right} are duplicated`);
      }
    }
  }
  let signedDoubleArea = 0;
  for (let index = 0; index < contour.length; index += 1) {
    const current = contour[index]!;
    const next = contour[(index + 1) % contour.length]!;
    signedDoubleArea += current[0] * next[1] - next[0] * current[1];
  }
  if (!Number.isFinite(signedDoubleArea) || signedDoubleArea === 0) {
    issues.push("contour must enclose a finite non-zero area");
  }
  for (let first = 0; first < contour.length; first += 1) {
    const firstNext = (first + 1) % contour.length;
    for (let second = first + 1; second < contour.length; second += 1) {
      const secondNext = (second + 1) % contour.length;
      const adjacent = first === second || firstNext === second || secondNext === first;
      if (adjacent) continue;
      if (segmentsIntersect(
        contour[first]!, contour[firstNext]!, contour[second]!, contour[secondNext]!,
      )) {
        issues.push(`contour edges ${first} and ${second} intersect or touch ambiguously`);
      }
    }
  }
  return issues.length
    ? { valid: false, issues }
    : { valid: true, contour, signedDoubleArea };
}

const normalizedPointSchema = z.strictObject({ x: fractionSchema, y: fractionSchema });
const normalizedDesignContourSchema = z
  .array(normalizedPointSchema)
  .min(MATHEMATICAL_DESIGN_REFERENCE_V1_MIN_CONTOUR_POINTS)
  .max(MATHEMATICAL_DESIGN_REFERENCE_V1_MAX_CONTOUR_POINTS)
  .superRefine((contour, context) => {
    const validation = validateMathematicalDesignReferencePixelContourV1(
      contour.map((point) => [point.x, point.y]),
      1,
      1,
    );
    if (!validation.valid) {
      validation.issues.forEach((message) => context.addIssue({ code: "custom", message }));
    }
  });

export const mathematicalDesignReferenceV1Schema = z
  .strictObject({
    schemaVersion: z.literal(MATHEMATICAL_DESIGN_REFERENCE_V1_SCHEMA_VERSION),
    designReferenceId: identifierSchema,
    profile: z.literal("registered_design_template_v1"),
    tenantId: identifierSchema,
    setId: identifierSchema,
    programId: identifierSchema,
    cardNumber: identifierSchema,
    variantId: identifierSchema.nullable(),
    parallelId: identifierSchema.nullable(),
    side: z.enum(["front", "back"]),
    artifactId: identifierSchema,
    artifactSha256: sha256Schema,
    version: z.number().int().positive(),
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
    intendedPrintBoundary: normalizedDesignContourSchema,
    approvedBy: identifierSchema,
    approvedAt: timestampSchema,
  });

export type MathematicalDesignReferenceV1 = z.infer<typeof mathematicalDesignReferenceV1Schema>;

export const mathematicalCenteringRegistrationV1Schema = z
  .strictObject({
    profile: z.enum(["printed_border_v1", "registered_design_template_v1"]),
    designReferenceId: identifierSchema.optional(),
    designReferenceSha256: sha256Schema.optional(),
    transformType: z.enum(["robust_line_fit", "affine", "homography"]),
    transformMatrix: z.array(z.number().finite()).min(6).max(9),
    registrationResidualPx: finiteNonnegativeSchema,
    inlierCount: z.number().int().positive(),
    inlierFraction: fractionSchema,
    confidence: fractionSchema,
  })
  .superRefine((registration, context) => {
    if (registration.profile === "printed_border_v1") {
      if (registration.transformType !== "robust_line_fit") {
        context.addIssue({ code: "custom", path: ["transformType"], message: "printed borders require the robust line-fit transform" });
      }
      if (registration.designReferenceId || registration.designReferenceSha256) {
        context.addIssue({ code: "custom", path: ["designReferenceId"], message: "printed borders must not claim a design reference" });
      }
      return;
    }
    if (!registration.designReferenceId || !registration.designReferenceSha256) {
      context.addIssue({ code: "custom", path: ["designReferenceId"], message: "registered templates require an exact design-reference identity and hash" });
    }
    if (registration.transformType === "robust_line_fit") {
      context.addIssue({ code: "custom", path: ["transformType"], message: "registered templates require a computed affine or homography transform" });
    }
  });

export function validateMathematicalDesignReferenceV1(value: unknown) {
  return mathematicalDesignReferenceV1Schema.safeParse(value);
}

export const mathematicalFindingV1Schema = z
  .strictObject({
    schemaVersion: z.literal(MATHEMATICAL_FINDING_V1_SCHEMA_VERSION),
    findingId: identifierSchema,
    physicalDefectId: identifierSchema,
    category: z.enum(MATHEMATICAL_FINDING_CATEGORIES_V1),
    primaryElement: z.enum(["corners", "edges", "surface"]),
    side: z.enum(["front", "back"]),
    location: identifierSchema,
    regionId: identifierSchema,
    detectorId: identifierSchema,
    detectorVersion: identifierSchema,
    algorithmVersion: identifierSchema,
    thresholdSetId: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID),
    thresholdSetHash: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH),
    calibrationProfileId: identifierSchema,
    calibrationVersion: identifierSchema,
    measurements: z.array(mathematicalMeasurementV1Schema).min(1).max(32),
    deductionBasisMeasurementId: identifierSchema,
    normalizedSeverity: fractionSchema,
    deduction: z.number().finite().min(0)
      .max(MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION)
      .refine((value) => decimalPlaces(value, 2)),
    severeDefectCap: mathematicalScoreV1Schema.optional(),
    confidence: fractionSchema,
    evidenceQuality: z.enum(["sufficient", "limited", "insufficient"]),
    secondaryEvidenceCategories: z.array(identifierSchema).max(32),
    explanation: z.string().trim().min(1).max(1000),
  })
  .superRefine((finding, context) => {
    const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[finding.category];
    if (finding.primaryElement !== policy.element) {
      context.addIssue({ code: "custom", path: ["primaryElement"], message: "must match the category primary element" });
    }
    const ids = finding.measurements.map((measurement) => measurement.measurementId.toLowerCase());
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["measurements"], message: "measurement IDs must be unique" });
    }
    const basis = finding.measurements.find(
      (measurement) => measurement.measurementId.toLowerCase() === finding.deductionBasisMeasurementId.toLowerCase(),
    );
    if (!basis) {
      context.addIssue({ code: "custom", path: ["deductionBasisMeasurementId"], message: "must reference a finding measurement" });
      return;
    }
    if (basis.kind !== policy.primaryMeasurementKind || basis.unit !== policy.unit) {
      context.addIssue({ code: "custom", path: ["deductionBasisMeasurementId"], message: "must reference the category primary measurement kind and unit" });
    }
    if (basis.calibrationProfileId !== finding.calibrationProfileId || basis.calibrationVersion !== finding.calibrationVersion) {
      context.addIssue({ code: "custom", path: ["measurements"], message: "must use the finding calibration profile and version" });
    }
    const minimumCoverage = policy.element === "corners"
      ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.minValidPixelCoverage
      : policy.element === "edges"
        ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.minValidPixelCoverage
        : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surfaceEvidence.minValidPixelCoverage;
    const minimumChannels = policy.element === "corners"
      ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.corners.minUsableDirectionalChannels
      : policy.element === "edges"
        ? MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.edges.minUsableDirectionalChannels
        : MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.surfaceEvidence.minValidDirectionalObservations;
    if (
      (basis.validEvidenceCoverage < minimumCoverage ||
        basis.usableDirectionalChannelCount < minimumChannels) &&
      finding.evidenceQuality !== "insufficient"
    ) {
      context.addIssue({ code: "custom", path: ["evidenceQuality"], message: "must be insufficient when manifest valid-pixel or usable-channel evidence gates fail" });
    }
    const calculation = calculateFindingDeductionV1({
      category: finding.category,
      measuredMeasurement: basis.measuredMeasurement,
      u95: basis.u95,
    });
    if (finding.normalizedSeverity !== calculation.normalizedSeverity) {
      context.addIssue({ code: "custom", path: ["normalizedSeverity"], message: "must equal the manifest-derived normalized severity" });
    }
    const expectedDeduction = finding.evidenceQuality === "insufficient" ? 0 : calculation.deduction;
    if (finding.deduction !== expectedDeduction) {
      context.addIssue({ code: "custom", path: ["deduction"], message: "must equal the exact manifest-derived deduction" });
    }
    const applicableSevereCap = finding.evidenceQuality === "insufficient"
      ? undefined
      : calculateApplicableSevereDefectCapV1(finding.category, finding.measurements);
    if (finding.severeDefectCap !== applicableSevereCap) {
      context.addIssue({ code: "custom", path: ["severeDefectCap"], message: "must equal the applicable manifest severe-defect cap" });
    }
    if (finding.evidenceQuality === "insufficient" && finding.deduction !== 0) {
      context.addIssue({ code: "custom", path: ["deduction"], message: "insufficient evidence must not deduct as physical damage" });
    }
  });

export type MathematicalFindingV1 = z.infer<typeof mathematicalFindingV1Schema>;

export const mathematicalDeductionLedgerEntryV1Schema = z.strictObject({
  findingId: identifierSchema,
  physicalDefectId: identifierSchema,
  element: z.enum(["corners", "edges", "surface"]),
  category: z.enum(MATHEMATICAL_FINDING_CATEGORIES_V1),
  measurementId: identifierSchema,
  measuredMeasurement: finiteNonnegativeSchema,
  unit: z.enum(MATHEMATICAL_MEASUREMENT_UNITS_V1),
  u95: finiteNonnegativeSchema,
  grade10Tolerance: finiteNonnegativeSchema,
  effectiveMeasurement: finiteNonnegativeSchema,
  referenceMeasurement: finitePositiveSchema,
  maximumDeduction: finiteNonnegativeSchema,
  curve: z.literal(MATHEMATICAL_FINDING_DEDUCTION_CURVE_V1),
  formula: z.literal(MATHEMATICAL_FINDING_DEDUCTION_FORMULA_V1),
  normalizedSeverity: fractionSchema,
  deduction: z.number().finite().min(0)
    .max(MATHEMATICAL_GRADING_V1_MAXIMUM_SCORE_DEDUCTION)
    .refine((value) => decimalPlaces(value, 2)),
  evidenceAssetIds: z.array(logicalAssetIdSchema).min(1).max(64),
  thresholdSetId: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID),
  thresholdSetHash: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH),
  algorithmVersion: identifierSchema,
  calibrationProfileId: identifierSchema,
  calibrationVersion: identifierSchema,
});

export const mathematicalDeductionLedgerV1Schema = z
  .strictObject({
    schemaVersion: z.literal(MATHEMATICAL_DEDUCTION_LEDGER_V1_SCHEMA_VERSION),
    thresholdSetId: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_ID),
    thresholdSetHash: z.literal(MATHEMATICAL_GRADING_V1_THRESHOLD_SET_HASH),
    startingScores: z.strictObject({
      centering: z.literal(10),
      corners: z.literal(10),
      edges: z.literal(10),
      surface: z.literal(10),
    }),
    entries: z.array(mathematicalDeductionLedgerEntryV1Schema).max(200),
  })
  .superRefine((ledger, context) => {
    const findingIds = new Set<string>();
    const physicalDefectIds = new Set<string>();
    ledger.entries.forEach((entry, index) => {
      const policy = MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.findings[entry.category];
      const calculation = calculateFindingDeductionV1({
        category: entry.category,
        measuredMeasurement: entry.measuredMeasurement,
        u95: entry.u95,
      });
      if (
        entry.element !== policy.element ||
        entry.unit !== policy.unit ||
        entry.grade10Tolerance !== policy.grade10Tolerance ||
        entry.effectiveMeasurement !== calculation.effectiveMeasurement ||
        entry.referenceMeasurement !== policy.referenceMeasurement ||
        entry.maximumDeduction !== policy.maximumDeduction ||
        entry.curve !== calculation.curve ||
        entry.formula !== calculation.formula ||
        entry.normalizedSeverity !== calculation.normalizedSeverity ||
        entry.deduction !== calculation.deduction
      ) {
        context.addIssue({ code: "custom", path: ["entries", index], message: "must reproduce the exact manifest measurement, uncertainty, severity, and deduction calculation" });
      }
      const findingId = entry.findingId.toLowerCase();
      const physicalDefectId = entry.physicalDefectId.toLowerCase();
      if (findingIds.has(findingId)) {
        context.addIssue({ code: "custom", path: ["entries", index, "findingId"], message: "a finding may deduct only once" });
      }
      if (physicalDefectIds.has(physicalDefectId)) {
        context.addIssue({ code: "custom", path: ["entries", index, "physicalDefectId"], message: "a physical defect may deduct only once across categories" });
      }
      findingIds.add(findingId);
      physicalDefectIds.add(physicalDefectId);
    });
  });

export type MathematicalDeductionLedgerEntryV1 = z.infer<typeof mathematicalDeductionLedgerEntryV1Schema>;
export type MathematicalDeductionLedgerV1 = z.infer<typeof mathematicalDeductionLedgerV1Schema>;

export function validateNoDoubleDeductionV1(
  findings: readonly Pick<MathematicalFindingV1, "findingId" | "physicalDefectId">[],
): { valid: boolean; duplicateFindingIds: string[]; duplicatePhysicalDefectIds: string[] } {
  const duplicateFindingIds: string[] = [];
  const duplicatePhysicalDefectIds: string[] = [];
  const findingIds = new Set<string>();
  const physicalDefectIds = new Set<string>();
  findings.forEach((finding) => {
    const findingId = finding.findingId.toLowerCase();
    const physicalDefectId = finding.physicalDefectId.toLowerCase();
    if (findingIds.has(findingId)) duplicateFindingIds.push(finding.findingId);
    if (physicalDefectIds.has(physicalDefectId)) duplicatePhysicalDefectIds.push(finding.physicalDefectId);
    findingIds.add(findingId);
    physicalDefectIds.add(physicalDefectId);
  });
  return {
    valid: duplicateFindingIds.length === 0 && duplicatePhysicalDefectIds.length === 0,
    duplicateFindingIds,
    duplicatePhysicalDefectIds,
  };
}
