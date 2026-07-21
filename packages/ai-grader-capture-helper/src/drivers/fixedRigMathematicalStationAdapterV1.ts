import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FixedRigApprovedDesignReferencePixelsV1 } from './fixedRigDesignReferenceV1';
import {
  MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST,
  type TrustedPokemonCardFormatAuthorityV1,
} from '@tenkings/shared';
import {
  buildFixedRigMathematicalCalibrationReportPackageV1,
  FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
  type BuildFixedRigMathematicalCalibrationOrchestratorV1Result,
  type FixedRigExactReportEvidenceFileV1,
  type FixedRigMathematicalCardIdentityV1,
  type FixedRigMathematicalCalibrationSideInputV1,
  type FixedRigMathematicalFindingReviewV1,
  type FixedRigMathematicalOrchestrationStageV1,
} from './fixedRigMathematicalCalibrationOrchestratorV1';
import {
  buildFixedRigStandardTradingCardBoundaryV1,
  FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID,
} from './fixedRigStandardCardFormatV1';
import { loadFixedRigMathematicalCalibrationBundleV1 } from './fixedRigMathematicalCalibrationBundleV1';
import type { FastCalibrationRuntimeContextV1_2 } from './fixedRigFastMathematicalCalibrationV1_2';
import { buildFixedRigAutomaticDesignRegistrationV1 } from './fixedRigAutomaticDesignRegistrationV1';
import {
  buildFixedRigPokemonTcgStandardBoundaryV1,
  FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID,
  verifyTrustedPokemonCardFormatAuthorityV1,
} from './fixedRigPokemonStandardCornerProfileV1';

export const FIXED_RIG_MATHEMATICAL_STATION_ADAPTER_V1_VERSION =
  'fixed_rig_mathematical_station_adapter_v1' as const;
export const FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION =
  'fixed_rig_mathematical_station_grading_authority_v1' as const;

export type FixedRigMathematicalStationCenteringAuthorityV1 =
  | {
      profile: 'printed_border_v1';
    }
  | {
      profile: 'registered_design_template_v1';
      approvedReference: FixedRigApprovedDesignReferencePixelsV1;
      /** Exact bridge-private staged file produced by the bounded authenticated upload route. */
      approvedDesignArtifact: FixedRigExactReportEvidenceFileV1;
    };

type FixedRigMathematicalStationGradingAuthorityBaseV1 = {
  schemaVersion: typeof FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION;
  cardIdentity: FixedRigMathematicalCardIdentityV1;
  sides: {
    front: { centering: FixedRigMathematicalStationCenteringAuthorityV1 };
    back: { centering: FixedRigMathematicalStationCenteringAuthorityV1 };
  };
  publication: {
    certId: string;
    publicReportUrl: string;
    qrPayloadUrl: string;
  };
};

export type FixedRigMathematicalStationGradingAuthorityV1 =
  | FixedRigMathematicalStationGradingAuthorityBaseV1 & {
      cardFormatId: typeof FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID;
    }
  | FixedRigMathematicalStationGradingAuthorityBaseV1 & {
      cardFormatId: typeof FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID;
      trustedCardFormatAuthority: TrustedPokemonCardFormatAuthorityV1;
    };

export interface BuildFixedRigMathematicalCalibrationStationPackageV1Input {
  authority: FixedRigMathematicalStationGradingAuthorityV1;
  gradingSessionId: string;
  generatedAt: string;
  reportId: string;
  outputDir: string;
  captureProfileVersion: string;
  calibration: {
    bundlePath: string;
    bundleSha256: string;
    expectedRigId: string;
    expectedRuntimeContext?: FastCalibrationRuntimeContextV1_2;
  };
  warmSides: {
    front: { manifestPath: string; manifestSha256: string };
    back: { manifestPath: string; manifestSha256: string };
  };
  findingReviews?: FixedRigMathematicalFindingReviewV1[];
  cardFormatAuthorityVerification?: {
    hmacKey: string;
    keyId: string;
  };
}

export type BuildFixedRigMathematicalCalibrationStationPackageV1Result =
  BuildFixedRigMathematicalCalibrationOrchestratorV1Result;

type Side = 'front' | 'back';
type JsonObject = Record<string, unknown>;

interface ParsedWarmSideV1 {
  rawAllOn: FixedRigExactReportEvidenceFileV1;
  normalizedAllOn: FixedRigExactReportEvidenceFileV1;
  normalizedCard: FixedRigExactReportEvidenceFileV1;
  darkControl: FixedRigExactReportEvidenceFileV1;
  directionalChannels: Array<FixedRigExactReportEvidenceFileV1 & {
    channel: number;
    channelConfidence: number;
  }>;
  rawToNormalizedTransform: FixedRigMathematicalCalibrationSideInputV1['rawToNormalizedTransform'];
  normalizedCardBytes: Buffer;
  geometry: Record<string, unknown>;
  geometryCaptureDecisions: Record<string, unknown>;
  captureTiming: Record<string, unknown>;
}

function adapterInsufficient(
  stage: FixedRigMathematicalOrchestrationStageV1,
  reasons: string[],
  flags: {
    requiresRecapture?: boolean;
    requiresApprovedDesignReference?: boolean;
    requiresCalibration?: boolean;
    requiresImplementationCorrection?: boolean;
  } = {},
): BuildFixedRigMathematicalCalibrationStationPackageV1Result {
  return {
    version: FIXED_RIG_MATHEMATICAL_CALIBRATION_ORCHESTRATOR_V1_VERSION,
    status: 'insufficient_evidence',
    gradingContract: 'mathematical_calibration_v1',
    v0FallbackUsed: false,
    failedStage: stage,
    reasons: [...new Set(reasons)],
    requiresRecapture: flags.requiresRecapture ?? false,
    requiresApprovedDesignReference: flags.requiresApprovedDesignReference ?? false,
    requiresCalibration: flags.requiresCalibration ?? false,
    requiresImplementationCorrection: flags.requiresImplementationCorrection ?? false,
    reportPackage: null,
    stationInput: null,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object.');
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' must be non-empty.');
  return value;
}

function exactSha(value: unknown, label: string): string {
  const result = string(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(label + ' must be an exact SHA-256.');
  return result;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(label + ' must be an array.');
  return value;
}

function within(root: string, filePath: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(filePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(label + ' path escapes its immutable warm package.');
  }
  return resolved;
}

async function readExact(filePath: string, expectedSha256: string, label: string): Promise<Buffer> {
  const bytes = await readFile(filePath);
  if (sha256(bytes) !== expectedSha256.toLowerCase()) {
    throw new Error(label + ' file SHA-256 mismatch.');
  }
  return bytes;
}

function contentType(filePath: string): string {
  return path.extname(filePath).toLowerCase() === '.tiff' ||
    path.extname(filePath).toLowerCase() === '.tif' ? 'image/tiff' : 'image/png';
}

function evidenceFrom(input: {
  packageDir: string;
  artifact: JsonObject;
  pathField: 'localOutputPath' | 'outputFilePath';
  assetId: string;
  label: string;
}): FixedRigExactReportEvidenceFileV1 {
  const filePath = within(
    input.packageDir,
    string(input.artifact[input.pathField], input.label + ' path'),
    input.label,
  );
  return {
    filePath,
    sha256: exactSha(input.artifact.sha256, input.label + ' sha256'),
    assetId: input.assetId,
    fileName: path.basename(filePath),
    contentType: contentType(filePath),
  };
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function parseWarmSideV1(input: {
  side: Side;
  manifestPath: string;
  manifestSha256: string;
  channelConfidences: ReadonlyMap<number, number>;
}): Promise<ParsedWarmSideV1> {
  const manifestPath = path.resolve(input.manifestPath);
  const packageDir = path.dirname(manifestPath);
  const bytes = await readExact(
    manifestPath,
    exactSha(input.manifestSha256, input.side + ' warm manifest sha256'),
    input.side + ' warm manifest',
  );
  const manifest = object(JSON.parse(bytes.toString('utf8')), input.side + ' warm manifest');
  if (manifest.status !== 'completed' || manifest.executionPath !== 'warm_full_forensic_runner' ||
      manifest.captureProfile !== 'full_forensic' || manifest.evidenceSide !== input.side) {
    throw new Error(input.side + ' warm manifest is not one completed full-forensic side package.');
  }
  if (path.resolve(string(manifest.packageDir, input.side + ' packageDir')) !== packageDir) {
    throw new Error(input.side + ' warm manifest packageDir does not match its protected location.');
  }
  const rawIntegrity = object(manifest.rawEvidenceIntegrity, input.side + ' raw evidence integrity');
  if (rawIntegrity.verified !== true) {
    throw new Error(input.side + ' raw evidence integrity was not verified.');
  }
  const side = object(manifest[input.side], input.side + ' side evidence');
  const allOn = object(side.allOn, input.side + ' all-on evidence');
  const accepted = object(side.acceptedProfile, input.side + ' accepted-profile evidence');
  const dark = object(side.darkControl, input.side + ' dark-control evidence');
  const normalizedDark = object(dark.normalized, input.side + ' normalized dark-control evidence');
  const normalizedCard = object(side.normalizedCard, input.side + ' normalized-card evidence');
  const rawAllOn = evidenceFrom({
    packageDir,
    artifact: object(allOn.capture, input.side + ' raw all-on capture'),
    pathField: 'outputFilePath',
    assetId: input.side + '-raw-all-on',
    label: input.side + ' raw all-on',
  });
  const normalizedAllOnArtifact = object(
    allOn.analysisArtifact,
    input.side + ' normalized all-on artifact',
  );
  const normalizedAllOn = evidenceFrom({
    packageDir,
    artifact: normalizedAllOnArtifact,
    pathField: 'localOutputPath',
    assetId: input.side + '-normalized-all-on',
    label: input.side + ' normalized all-on',
  });
  const acceptedArtifact = object(
    accepted.analysisArtifact,
    input.side + ' accepted-profile artifact',
  );
  const normalizedAccepted = evidenceFrom({
    packageDir,
    artifact: acceptedArtifact,
    pathField: 'localOutputPath',
    assetId: input.side + '-accepted-profile',
    label: input.side + ' accepted profile',
  });
  const darkControl = evidenceFrom({
    packageDir,
    artifact: object(normalizedDark.analysisArtifact, input.side + ' normalized dark artifact'),
    pathField: 'localOutputPath',
    assetId: input.side + '-normalized-dark-control',
    label: input.side + ' normalized dark control',
  });
  const channels = array(side.channels, input.side + ' directional channels')
    .map((value) => object(value, input.side + ' directional channel'))
    .sort((left, right) => Number(left.channel) - Number(right.channel));
  if (channels.length !== 8 || channels.some((entry, index) => entry.channel !== index + 1)) {
    throw new Error(input.side + ' warm manifest must contain channels 1 through 8 exactly once.');
  }
  const directionalChannels = channels.map((entry, index) => {
    const channel = index + 1;
    const channelConfidence = input.channelConfidences.get(channel);
    if (!Number.isFinite(channelConfidence)) {
      throw new Error('Finalized calibration has no direction confidence for channel ' + channel + '.');
    }
    return {
      ...evidenceFrom({
        packageDir,
        artifact: object(entry.analysisArtifact, input.side + ' channel ' + channel + ' artifact'),
        pathField: 'localOutputPath',
        assetId: input.side + '-directional-channel-' + channel,
        label: input.side + ' directional channel ' + channel,
      }),
      channel,
      channelConfidence: Number(channelConfidence),
    };
  });
  const normalizedCardArtifact = object(
    normalizedCard.normalizedArtifact,
    input.side + ' normalization authority artifact',
  );
  const rawToNormalizedTransform = object(
    normalizedCardArtifact.rawToNormalizedTransform,
    input.side + ' raw-to-normalized transform',
  ) as unknown as FixedRigMathematicalCalibrationSideInputV1['rawToNormalizedTransform'];
  if (rawToNormalizedTransform.sourceSha256 !== rawAllOn.sha256 ||
      rawToNormalizedTransform.transformSha256 !==
        (normalizedAllOnArtifact.rawToNormalizedTransform as JsonObject | undefined)?.transformSha256) {
    throw new Error(input.side + ' all-on transform is not bound to the exact raw/normalized role.');
  }
  const allFiles = [
    rawAllOn,
    normalizedAllOn,
    normalizedAccepted,
    darkControl,
    ...directionalChannels,
  ];
  await Promise.all(allFiles.map((file) =>
    readExact(file.filePath, file.sha256, input.side + ' ' + file.assetId)));
  return {
    rawAllOn,
    normalizedAllOn,
    normalizedCard: normalizedAccepted,
    darkControl,
    directionalChannels,
    rawToNormalizedTransform,
    normalizedCardBytes: await readExact(
      normalizedAccepted.filePath,
      normalizedAccepted.sha256,
      input.side + ' accepted-profile registration source',
    ),
    geometry: recordOrEmpty(normalizedCard.geometry),
    geometryCaptureDecisions: recordOrEmpty(manifest.geometryPolicy),
    captureTiming: recordOrEmpty(manifest.captureTiming),
  };
}

async function resolveCenteringAuthorityV1(input: {
  side: Side;
  authority: FixedRigMathematicalStationCenteringAuthorityV1;
  cardIdentity: FixedRigMathematicalCardIdentityV1;
  source: ParsedWarmSideV1;
  normalizedWidthPx: number;
  normalizedHeightPx: number;
  pixelsPerMmX: number;
  pixelsPerMmY: number;
}): Promise<
  | {
      status: 'computed';
      centering: FixedRigMathematicalCalibrationSideInputV1['centering'];
      designReference?: FixedRigMathematicalCalibrationSideInputV1['designReference'];
      designReferenceArtifact?: FixedRigExactReportEvidenceFileV1;
      designRegistration?: FixedRigMathematicalCalibrationSideInputV1['designRegistration'];
    }
  | { status: 'insufficient_evidence'; reasons: string[] }
> {
  if (input.authority.profile === 'printed_border_v1') {
    return { status: 'computed', centering: { profileInput: { profile: 'printed_border_v1' } } };
  }
  const approved = input.authority.approvedReference;
  const artifact = input.authority.approvedDesignArtifact;
  const identityMatches =
    approved.side === input.side &&
    approved.tenantId === input.cardIdentity.tenantId &&
    approved.setId === input.cardIdentity.setId &&
    approved.programId === input.cardIdentity.programId &&
    approved.cardNumber === input.cardIdentity.cardNumber &&
    approved.variantId === input.cardIdentity.variantId &&
    approved.parallelId === input.cardIdentity.parallelId;
  if (!identityMatches || approved.status !== 'approved' ||
      approved.artifactWidthPx !== input.normalizedWidthPx ||
      approved.artifactHeightPx !== input.normalizedHeightPx ||
      approved.artifactSha256 !== artifact.sha256.toLowerCase()) {
    return { status: 'insufficient_evidence', reasons: [
      input.side + ' approved design reference does not match the exact card, side, frame, or staged artifact.',
    ] };
  }
  let artifactBytes: Buffer;
  try {
    artifactBytes = await readExact(
      artifact.filePath,
      artifact.sha256,
      input.side + ' approved design artifact',
    );
  } catch (error) {
    return { status: 'insufficient_evidence', reasons: [
      error instanceof Error ? error.message : input.side + ' approved design artifact is unavailable.',
    ] };
  }
  const registration = await buildFixedRigAutomaticDesignRegistrationV1({
    approvedReference: approved,
    artifactEvidence: {
      assetId: artifact.assetId,
      sha256: artifact.sha256.toLowerCase(),
      bytes: artifactBytes,
    },
    normalizedSourceEvidence: {
      assetId: input.source.normalizedCard.assetId,
      sha256: input.source.normalizedCard.sha256.toLowerCase(),
      bytes: input.source.normalizedCardBytes,
      side: input.side,
      coordinateFrame: 'normalized_card_portrait_pixels',
      widthPx: input.normalizedWidthPx,
      heightPx: input.normalizedHeightPx,
    },
    measurementCalibration: {
      pixelsPerMmX: input.pixelsPerMmX,
      pixelsPerMmY: input.pixelsPerMmY,
    },
  });
  if (registration.status !== 'computed') {
    return { status: 'insufficient_evidence', reasons: registration.reasons };
  }
  return {
    status: 'computed',
    centering: { profileInput: registration.projection.centeringProfileInput },
    designReference: registration.projection.designReference,
    designReferenceArtifact: artifact,
    designRegistration: registration.conditionRegistration,
  };
}

export async function buildFixedRigMathematicalCalibrationStationPackageV1(
  input: BuildFixedRigMathematicalCalibrationStationPackageV1Input,
): Promise<BuildFixedRigMathematicalCalibrationStationPackageV1Result> {
  if (input.authority.schemaVersion !==
      FIXED_RIG_MATHEMATICAL_STATION_GRADING_AUTHORITY_V1_VERSION ||
      (input.authority.cardFormatId !== FIXED_RIG_STANDARD_TRADING_CARD_FORMAT_V1_ID &&
        input.authority.cardFormatId !== FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID)) {
    return adapterInsufficient('input_contract', [
      'Station authority must select one exact supported card-format contract.',
    ], { requiresImplementationCorrection: true });
  }
  let trustedPokemonAuthority: TrustedPokemonCardFormatAuthorityV1 | undefined;
  if (input.authority.cardFormatId === FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID) {
    try {
      trustedPokemonAuthority = verifyTrustedPokemonCardFormatAuthorityV1({
        authority: input.authority.trustedCardFormatAuthority,
        hmacKey: input.cardFormatAuthorityVerification?.hmacKey,
        expectedKeyId: input.cardFormatAuthorityVerification?.keyId,
        expectedCardIdentity: input.authority.cardIdentity,
      });
    } catch (error) {
      return adapterInsufficient('input_contract', [
        error instanceof Error ? error.message :
          'Trusted Pokémon physical-format authority could not be verified.',
      ], { requiresImplementationCorrection: true });
    }
  } else if ('trustedCardFormatAuthority' in input.authority) {
    return adapterInsufficient('input_contract', [
      'Generic standard-card authority cannot carry a Pokémon profile artifact.',
    ], { requiresImplementationCorrection: true });
  }
  let loaded: ReturnType<typeof loadFixedRigMathematicalCalibrationBundleV1>;
  try {
    loaded = loadFixedRigMathematicalCalibrationBundleV1({
      bundlePath: input.calibration.bundlePath,
      bundleSha256: input.calibration.bundleSha256,
      expectedRigId: input.calibration.expectedRigId,
      ...(input.calibration.expectedRuntimeContext
        ? { expectedRuntimeContext: input.calibration.expectedRuntimeContext }
        : {}),
    });
  } catch (error) {
    return adapterInsufficient('calibration_ingestion', [
      error instanceof Error ? error.message : 'Finalized calibration bundle could not be verified.',
    ], { requiresCalibration: true });
  }
  const channelConfidences = new Map(
    loaded.profile.channels.map((entry) => [entry.channelIndex, entry.directionConfidence]),
  );
  let warm: { front: ParsedWarmSideV1; back: ParsedWarmSideV1 };
  try {
    const [front, back] = await Promise.all([
      parseWarmSideV1({
        side: 'front',
        ...input.warmSides.front,
        channelConfidences,
      }),
      parseWarmSideV1({
        side: 'back',
        ...input.warmSides.back,
        channelConfidences,
      }),
    ]);
    warm = { front, back };
  } catch (error) {
    return adapterInsufficient('capture_evidence_ingestion', [
      error instanceof Error ? error.message : 'Warm front/back evidence could not be verified.',
    ], { requiresRecapture: true });
  }
  const intendedOuterBoundary = input.authority.cardFormatId ===
      FIXED_RIG_POKEMON_TCG_STANDARD_FORMAT_V1_ID
    ? buildFixedRigPokemonTcgStandardBoundaryV1({
        normalizedWidthPx: loaded.profile.normalizedWidthPx,
        normalizedHeightPx: loaded.profile.normalizedHeightPx,
      })
    : buildFixedRigStandardTradingCardBoundaryV1({
        normalizedWidthPx: loaded.profile.normalizedWidthPx,
        normalizedHeightPx: loaded.profile.normalizedHeightPx,
      });
  const resolvedCentering = await Promise.all((['front', 'back'] as const).map((side) =>
    resolveCenteringAuthorityV1({
      side,
      authority: input.authority.sides[side].centering,
      cardIdentity: input.authority.cardIdentity,
      source: warm[side],
      normalizedWidthPx: loaded.profile.normalizedWidthPx,
      normalizedHeightPx: loaded.profile.normalizedHeightPx,
      pixelsPerMmX: 1 / loaded.profile.mmPerPixelX,
      pixelsPerMmY: 1 / loaded.profile.mmPerPixelY,
    })));
  if (resolvedCentering.some((entry) => entry.status !== 'computed')) {
    return adapterInsufficient('centering', resolvedCentering.flatMap((entry) =>
      entry.status === 'insufficient_evidence' ? entry.reasons : []), {
      requiresApprovedDesignReference: true,
      requiresRecapture: true,
    });
  }
  const centering = {
    front: resolvedCentering[0] as Extract<typeof resolvedCentering[number], { status: 'computed' }>,
    back: resolvedCentering[1] as Extract<typeof resolvedCentering[number], { status: 'computed' }>,
  };
  const sideInput = (side: Side): FixedRigMathematicalCalibrationSideInputV1 => ({
    rawAllOn: warm[side].rawAllOn,
    rawToNormalizedTransform: warm[side].rawToNormalizedTransform,
    normalizedAllOn: warm[side].normalizedAllOn,
    normalizedCard: warm[side].normalizedCard,
    directionalChannels: warm[side].directionalChannels,
    darkControl: warm[side].darkControl,
    intendedOuterBoundary,
    ...(centering[side].designReference ? {
      designReference: centering[side].designReference,
      designReferenceArtifact: centering[side].designReferenceArtifact,
      designRegistration: centering[side].designRegistration,
    } : {}),
    centering: centering[side].centering,
    measurementCalibration: {
      profile: loaded.profile,
      calibrationProfileId: loaded.profile.profileId,
      calibrationVersion: loaded.profile.calibrationVersion,
      calibrationSha256: loaded.profile.artifactSha256,
      pixelsPerMmX: 1 / loaded.profile.mmPerPixelX,
      pixelsPerMmY: 1 / loaded.profile.mmPerPixelY,
    },
    algorithmVersion: FIXED_RIG_MATHEMATICAL_STATION_ADAPTER_V1_VERSION,
  });
  return buildFixedRigMathematicalCalibrationReportPackageV1({
    gradingContract: 'mathematical_calibration_v1',
    gradingSessionId: input.gradingSessionId,
    generatedAt: input.generatedAt,
    reportId: input.reportId,
    outputDir: input.outputDir,
    captureProfileVersion: input.captureProfileVersion,
    cardIdentity: input.authority.cardIdentity,
    ...(trustedPokemonAuthority ? {
      pokemonStandardCornerAuthority: trustedPokemonAuthority,
      pokemonStandardCornerAuthorityVerification: input.cardFormatAuthorityVerification,
    } : {}),
    calibration: {
      finalizedProfile: loaded.profile,
      bundleAuthority: loaded.authority,
      physicalArtifact: {
        filePath: loaded.files.physicalArtifact.path,
        sha256: loaded.files.physicalArtifact.sha256,
      },
      flatFieldArtifacts: loaded.files.flatFields.map((file) => ({
        filePath: file.path,
        sha256: file.sha256,
      })),
      illuminationPatternArtifact: {
        filePath: loaded.files.illuminationPattern.path,
        sha256: loaded.files.illuminationPattern.sha256,
      },
      sensorMaximumValue:
        MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.evidenceEncoding.decodedRasterPlane
          .maximumDigitalValue,
    },
    sides: {
      front: sideInput('front'),
      back: sideInput('back'),
    },
    findingReviews: input.findingReviews,
    report: {
      publication: input.authority.publication,
      geometry: {
        front: warm.front.geometry,
        back: warm.back.geometry,
      },
      geometryCaptureDecisions: {
        front: warm.front.geometryCaptureDecisions,
        back: warm.back.geometryCaptureDecisions,
      },
      captureTiming: {
        front: warm.front.captureTiming,
        back: warm.back.captureTiming,
      },
      limitations: [
        'Registered design centering is available only when automatic local image registration satisfies every centralized acceptance gate.',
      ],
    },
  });
}
