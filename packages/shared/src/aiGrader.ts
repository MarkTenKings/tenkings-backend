export type GradingMode =
  | "QUICK"
  | "STANDARD"
  | "FORENSIC"
  | "AUTH_ONLY"
  | "MACRO_ONLY"
  | "MACRO_PLUS_CORNERS"
  | "MACRO_PLUS_EDGES"
  | "FULL_TWO_SCALE";

export type CaptureSide = "FRONT" | "BACK";

export type GradingElement =
  | "CENTERING"
  | "CORNERS"
  | "EDGES"
  | "SURFACE"
  | "COMPOSITE"
  | "MICRO_CORNERS"
  | "MICRO_EDGES"
  | "MICRO_SURFACE"
  | "CMYK_AUTHENTICATION";

export type GradingCaptureKind =
  | "COLOR_CHECKER_FRONT"
  | "COLOR_CHECKER_BACK"
  | "FRONT_DIFFUSE"
  | "BACK_DIFFUSE"
  | "FRONT_DARKFIELD"
  | "BACK_DARKFIELD"
  | "FRONT_LED_0"
  | "FRONT_LED_1"
  | "FRONT_LED_2"
  | "FRONT_LED_3"
  | "FRONT_LED_4"
  | "FRONT_LED_5"
  | "FRONT_LED_6"
  | "FRONT_LED_7"
  | "BACK_LED_0"
  | "BACK_LED_1"
  | "BACK_LED_2"
  | "BACK_LED_3"
  | "BACK_LED_4"
  | "BACK_LED_5"
  | "BACK_LED_6"
  | "BACK_LED_7"
  | "MICRO_CORNER_SPOT"
  | "MICRO_EDGE_SPOT"
  | "MICRO_SURFACE_SPOT"
  | "MICRO_AUTH_PATCH"
  | "MICRO_CORNER_TILE"
  | "MICRO_EDGE_TILE"
  | "MICRO_SURFACE_TILE"
  | "EDR_BASE"
  | "POLARIZED_ALL_ON"
  | "FLC_LED_0"
  | "FLC_LED_1"
  | "FLC_LED_2"
  | "FLC_LED_3"
  | "FLC_LED_4"
  | "FLC_LED_5"
  | "FLC_LED_6"
  | "FLC_LED_7";

export type DeviceType =
  | "MACRO_CAMERA"
  | "LED_CONTROLLER"
  | "MICROSCOPE"
  | "XY_STAGE"
  | "ARM_INTERLOCK"
  | "HOLDER_FIDUCIAL";

export type CoordinateUnit = "px" | "mm" | "micron" | "degree" | "bitmask";

export interface DeviceCapabilityManifest {
  id: string;
  rigId: string;
  helperInstanceId: string;
  driverName: string;
  driverVersion: string;
  deviceType: DeviceType;
  componentSerial: string;
  supportedCapturePackages: string[];
  coordinateUnits: Record<string, CoordinateUnit>;
  timingCharacteristics: Record<string, number>;
  healthChecks: Array<{ name: string; required: boolean; timeoutMs: number }>;
  requiredCalibrationTypes: string[];
  checksum: string;
  observedAt: string;
}

export interface CaptureManifestFrame {
  frameId: string;
  kind: GradingCaptureKind;
  side: CaptureSide;
  storageKey: string;
  checksumSha256: string;
  capturedAt: string;
  exposureUs?: number;
  ledMask?: number;
  stageXMicrons?: number;
  stageYMicrons?: number;
  microMagnification?: number;
  polarizerAngle?: number;
  focusScore?: number;
  sourceSuspectRegionId?: string;
  widthPx?: number;
  heightPx?: number;
}

export type DeviceHealthStatus = "PASS" | "WARN" | "FAIL";

export interface CaptureManifest {
  id: string;
  captureSessionId: string;
  tenantId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId: string;
  helperVersion: string;
  driverVersions: Record<string, string>;
  componentSerials: Record<string, string>;
  calibrationSnapshotIds: string[];
  frameList: CaptureManifestFrame[];
  operatorPrompts: Array<{ prompt: string; shownAt: string; confirmedAt?: string }>;
  deviceHealth: Array<{ check: string; status: DeviceHealthStatus; detail?: string }>;
  checksumSha256: string;
  createdAt: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EvidenceArtifactRef {
  id?: string;
  storageKey: string;
  checksumSha256: string;
  mimeType?: string;
  byteSize?: number;
  widthPx?: number;
  heightPx?: number;
}

export type PhysicalGateStatus = "PASS" | "WARN" | "FAIL" | "REVIEW";

export interface PhysicalGateResult {
  gate: string;
  status: PhysicalGateStatus;
  detail?: string;
  evidenceArtifacts?: EvidenceArtifactRef[];
}

export type CalibrationType =
  | "COLOR_CHECKER_CCM"
  | "MACRO_INTRINSICS"
  | "MACRO_FLAT_FIELD"
  | "STAGE_HOME"
  | "CARD_JIG_TRANSFORM"
  | "MICROSCOPE_PX_PER_MICRON"
  | "MICROSCOPE_FOCUS_BASELINE"
  | "LED_INTENSITY_HEALTH"
  | "ARM_INTERLOCK_HEALTH";

export interface CalibrationSnapshotContract {
  id: string;
  rigId: string;
  calibrationType: CalibrationType;
  componentSerials: Record<string, string>;
  artifactKeys: string[];
  artifactChecksums: string[];
  residuals?: Record<string, unknown>;
  operatorId?: string;
  validityStartsAt: string;
  validityEndsAt?: string;
  createdAt: string;
}

export interface CalibrationFreshnessOptions {
  asOf?: string;
  maxAgeHours?: number;
  cardsSinceCalibration?: number;
  maxCardsSinceCalibration?: number;
}

export interface RequiredCalibrationSetOptions extends CalibrationFreshnessOptions {
  requiredTypes?: readonly CalibrationType[];
  rigId?: string;
}

export type ArmPosition = "ARM_IN" | "ARM_OUT";

export interface ArmInterlockStatus {
  hardwarePosition: ArmPosition;
  operatorConfirmedPosition?: ArmPosition;
  obstructionDetected?: boolean;
  obstructionCheckPassed?: boolean;
  positionReadable?: boolean;
  checkedAt: string;
}

export interface ArmInterlockStateValidationInput {
  status: ArmInterlockStatus;
  requiredPosition?: ArmPosition;
  operatorConfirmedPosition?: ArmPosition;
}

export type PhysicalGateKind =
  | "TRIMMED_CARD_SIZE"
  | "THICKNESS_MASS_LAYER_ANOMALY"
  | "UNEXPECTED_HOLDER_OR_SLEEVE"
  | "COATING_GLOSS_ANOMALY"
  | "RESIDUE_ADHESIVE"
  | "RECOLORING_RESTORATION"
  | "EXCESSIVE_DUST"
  | "FOREIGN_REFLECTIVE_MATERIAL"
  | "FRONT_BACK_SANDWICH_MISMATCH"
  | "CUSTODY_BREAK_AFTER_CERTIFICATION";

export interface PhysicalGateDecision {
  gate: PhysicalGateKind;
  status: PhysicalGateStatus;
  detail?: string;
  evidenceArtifacts?: EvidenceArtifactRef[];
  reviewRequired?: boolean;
  resolved?: boolean;
  reviewerId?: string;
  decidedAt?: string;
}

export type AuthVerdict =
  | "REFERENCE_NEEDED"
  | "AUTHENTIC"
  | "PROBABLY_AUTHENTIC"
  | "SUSPICIOUS"
  | "LIKELY_COUNTERFEIT";

export type PrintProfileStatus =
  | "CANDIDATE"
  | "CURATED_REFERENCE"
  | "ACTIVE"
  | "QUARANTINED"
  | "RETIRED";

export type AuthRunStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED";

export interface CardIdentityInput {
  cardSet: string;
  cardNumber: string;
  printRun?: string;
  identitySource?: "OPERATOR_SUPPLIED" | "MANIFEST" | "CURATED_REFERENCE";
  notes?: string;
}

export interface CardIdentityValidationOptions {
  mode?: GradingMode;
}

export interface CardPrintProfileContract {
  id: string;
  tenantId: string;
  cardSet: string;
  cardNumber: string;
  printRun?: string;
  printRunKey: string;
  state: PrintProfileStatus;
  referenceFingerprint: Record<string, unknown>;
  referenceAuthRunId?: string;
  approvedByOperatorId?: string;
  approvedAt?: string;
  version: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthRunContract {
  id: string;
  captureSessionId?: string;
  captureManifestId?: string;
  algorithmVersionId: string;
  runtimeEnvironmentId: string;
  cardPrintProfileId?: string;
  tenantId: string;
  cardSet: string;
  cardNumber: string;
  printRun?: string;
  verdict: AuthVerdict;
  distance?: number;
  status: AuthRunStatus;
  measurements: Record<string, unknown>;
  evidence: Record<string, unknown>;
  inputChecksum?: string;
  outputChecksum?: string;
  errorCode?: string;
  startedAt: string;
  finishedAt?: string;
  mode?: GradingMode;
  finalGrades?: Record<string, number>;
  profileState?: PrintProfileStatus;
}

export interface AuthProfileLifecycleDecision {
  from: PrintProfileStatus;
  to: PrintProfileStatus;
  actorOperatorId: string;
  reasonCode: string;
  reviewedByOperatorId?: string;
  decidedAt: string;
}

export interface AuthReportClaimBoundaryInput {
  verdict: AuthVerdict;
  reportText: string;
  mode?: GradingMode;
}

export type EvidenceClass = "ORIGINAL" | "DERIVED" | "PUBLIC" | "PRIVATE";
export type CertificateStatus = "DRAFT" | "ACTIVE" | "REVOKED" | "SUPERSEDED";
export type CustodyEventType =
  | "INTAKE"
  | "CAPTURE_START"
  | "CAPTURE_COMPLETE"
  | "VAULT_IN"
  | "VAULT_OUT"
  | "SHIPPED"
  | "RECEIVED"
  | "SLAB_SENT"
  | "SLAB_RETURNED"
  | "CERTIFICATE_ISSUED"
  | "CERTIFICATE_REVOKED"
  | "CUSTODY_BREAK";

export interface EvidenceArtifactContract {
  id: string;
  tenantId: string;
  captureSessionId?: string;
  gradeRunId?: string;
  authRunId?: string;
  certificateId?: string;
  evidenceClass: EvidenceClass;
  kind: string;
  storageKey: string;
  checksumSha256: string;
  mimeType: string;
  byteSize?: number;
  widthPx?: number;
  heightPx?: number;
  retentionUntil?: string;
  publicUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface GradeCertificateContract {
  id: string;
  tenantId: string;
  gradeRunId: string;
  authRunId?: string;
  publicSlug: string;
  certificateNumber: string;
  status: CertificateStatus;
  mode: GradingMode;
  finalGrades?: Record<string, number>;
  publicReportKey?: string;
  custodyStatus: string;
  issuedAt?: string;
  revokedAt?: string;
  revocationReason?: string;
  sourceGradeRunStatus?: "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "REPLAYED";
  createdAt: string;
  updatedAt: string;
}

export interface CustodyEventContract {
  id: string;
  tenantId: string;
  certificateId?: string;
  captureSessionId?: string;
  type: CustodyEventType;
  fromOperatorId?: string;
  toOperatorId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  evidenceArtifactIds?: string[];
  notes?: string;
  checksum: string;
  occurredAt: string;
}

export interface PublicReportDisclosure {
  mode: GradingMode;
  microscopeInspection: "NONE" | "SAMPLED" | "EXHAUSTIVE" | "AUTH_PATCHES";
  inspectedRegions: string[];
  uninspectedLimitations: string[];
  gradeValues?: Record<string, number>;
  evidenceSummaries: string[];
  warnings: string[];
  authVerdictScope: string;
  accessibilityText: string[];
  publicEvidenceArtifacts?: EvidenceArtifactContract[];
  privateManifestExposed?: boolean;
  calibrationArtifactsExposed?: boolean;
  sourceCodeExposed?: boolean;
  proprietaryFusionDetailsExposed?: boolean;
}

export interface PublicReportClaimCheck {
  claimText: string;
  mode?: GradingMode;
}

export interface CenteringMeasurement {
  leftMm?: number;
  rightMm?: number;
  topMm?: number;
  bottomMm?: number;
  horizontalPercent?: number;
  verticalPercent?: number;
  [key: string]: unknown;
}

export interface MacroSuspectRegion {
  id: string;
  sessionId: string;
  side: CaptureSide;
  element: "SURFACE";
  rank: number;
  score: number;
  threshold: number;
  reasonCodes: string[];
  cardMm: Rect;
  warpedPx: Rect;
  sourcePx?: Rect;
  heatmapStorageKey?: string;
  macroCaptureIds: string[];
  thresholdSetId: string;
}

export interface MacroPipelineOutput {
  sessionId: string;
  side: CaptureSide;
  captureManifestId: string;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  centeringMeasurement: CenteringMeasurement;
  provisionalGrades: {
    centering: number;
    corners: number;
    edges: number;
    surface: number;
  };
  macroMeasurements: Record<string, unknown>;
  suspectRegions: MacroSuspectRegion[];
  physicalGateResults: PhysicalGateResult[];
  evidenceArtifacts: EvidenceArtifactRef[];
}

export type MicroSpotElement = "CORNERS" | "EDGES" | "SURFACE" | "CMYK_AUTHENTICATION";
export type StandardSpotPlanElement = Exclude<MicroSpotElement, "CMYK_AUTHENTICATION">;
export type MicroSpotFrameKey =
  | "edrBase"
  | "polarizedAllOn"
  | "flcLed0"
  | "flcLed1"
  | "flcLed2"
  | "flcLed3"
  | "flcLed4"
  | "flcLed5"
  | "flcLed6"
  | "flcLed7";

export interface MicroSpotCapturePackage {
  id: string;
  sessionId: string;
  captureManifestId: string;
  side: CaptureSide;
  element: MicroSpotElement;
  spotIndex: number;
  totalSpots: number;
  sourceSuspectRegionId?: string;
  stageXMicrons: number;
  stageYMicrons: number;
  microMagnification: number;
  amrReading: number;
  focusScore: number;
  frames: {
    edrBase: EvidenceArtifactRef;
    polarizedAllOn: EvidenceArtifactRef;
    flcLed0: EvidenceArtifactRef;
    flcLed1: EvidenceArtifactRef;
    flcLed2: EvidenceArtifactRef;
    flcLed3: EvidenceArtifactRef;
    flcLed4: EvidenceArtifactRef;
    flcLed5: EvidenceArtifactRef;
    flcLed6: EvidenceArtifactRef;
    flcLed7: EvidenceArtifactRef;
  };
  capturedAt: string;
  validForClassification: boolean;
}

export interface BuildMicroSpotPackageIdInput {
  sessionId: string;
  side: CaptureSide;
  element: MicroSpotElement;
  spotIndex: number;
  sourceSuspectRegionId?: string;
}

export interface StandardSpotPlanSpot {
  id: string;
  sessionId: string;
  side: CaptureSide;
  element: StandardSpotPlanElement;
  label: string;
  spotIndex: number;
  totalSpots: number;
  sourceSuspectRegionId?: string;
}

export interface StandardSpotPlan {
  sessionId: string;
  side: CaptureSide;
  surfaceSuspectThreshold: number;
  surfaceTopN: number;
  spots: StandardSpotPlanSpot[];
}

export interface BuildStandardSpotPlanInput {
  sessionId: string;
  side: CaptureSide;
  surfaceSuspects?: MacroSuspectRegion[];
  threshold?: number;
  surfaceTopN?: number;
}

export interface MicroPackageFusionValidationOptions {
  sessionId?: string;
  captureManifestId?: string;
  side?: CaptureSide;
  allowedElements?: readonly MicroSpotElement[];
  sourceSuspectRegionIds?: readonly string[];
}

export type FusionActionType = "LOWER" | "HOLD" | "DUST_CORRECT" | "WARNING_ONLY";

export interface FusionAction {
  action: FusionActionType;
  element: "CORNERS" | "EDGES" | "SURFACE";
  side: CaptureSide;
  regionId?: string;
  spotPackageId: string;
  macroMeasurement: unknown;
  microMeasurement: unknown;
  gradeBefore: number;
  gradeAfter: number;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  reasonCodes: string[];
}

export interface BuildFusionActionInput {
  action: FusionActionType;
  element: StandardSpotPlanElement;
  side: CaptureSide;
  regionId?: string;
  spotPackageId: string;
  macroMeasurement: Record<string, unknown>;
  microMeasurement: Record<string, unknown>;
  gradeBefore: number;
  gradeAfter: number;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  reasonCodes: string[];
}

export interface StandardFusionScopeValidationInput {
  action: FusionAction;
  microPackages: MicroSpotCapturePackage[];
  macroOutput?: MacroPipelineOutput;
  standardSpotPlan?: StandardSpotPlan;
}

export interface DustCorrectionBoundsInput {
  action: FusionAction;
  recomputedMacroGradeWithoutInspectedContamination?: number;
  excessiveDustBurden?: boolean;
}

export interface StandardFusionOutputValidationOptions {
  input?: StandardFusionInput;
}

export interface ModePlan {
  mode: GradingMode;
  macroRequired: boolean;
  microscopePlan:
    | { type: "NONE" }
    | { type: "STANDARD_SPOTS"; cornersPerSide: 4; edgesPerSide: 4; surfaceTopN: number }
    | { type: "FORENSIC_RASTER"; includeCorners: true; includeEdges: true; includeSurface: true; includeAuth: true }
    | { type: "AUTH_PATCHES"; patchCount: 5 };
  producesGrade: boolean;
  producesAuthVerdict: boolean;
  publicModeDescription: string;
}

export interface OfficeGradeRunRequest {
  sessionId: string;
  side: CaptureSide;
  mode: GradingMode;
  operatorId: string;
  rigId: string;
}

export interface StandardFusionInput {
  macroOutput: MacroPipelineOutput;
  microPackages: MicroSpotCapturePackage[];
  captureManifest: CaptureManifest;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  runtimeEnvironmentId: string;
}

export interface StandardFusionOutput {
  gradeRunDraft: {
    macroMeasurements: Record<string, unknown>;
    microMeasurements: Record<string, unknown>;
    fusionActions: FusionAction[];
    finalGrades: Record<string, number>;
    warnings: string[];
  };
}

export type AiGraderValidationIssueCode =
  | "REQUIRED"
  | "INVALID_TYPE"
  | "INVALID_ENUM"
  | "INVALID_TIMESTAMP"
  | "INVALID_CHECKSUM"
  | "INVALID_VERSION"
  | "INVALID_TOLERANCE"
  | "INVALID_RECT"
  | "INVALID_SCORE"
  | "INVALID_RANK"
  | "INVALID_SPOT_PLAN"
  | "INVALID_MICRO_PACKAGE"
  | "INVALID_FUSION_ACTION"
  | "INVALID_FUSION_SCOPE"
  | "INVALID_DUST_CORRECTION"
  | "INVALID_CALIBRATION"
  | "CALIBRATION_STALE"
  | "CALIBRATION_EXPIRED"
  | "MISSING_CALIBRATION"
  | "ARM_POSITION_CONFLICT"
  | "ARM_GATE_BLOCKED"
  | "MACRO_OBSTRUCTION_DETECTED"
  | "PHYSICAL_GATE_REVIEW"
  | "CERTIFICATE_BLOCKED"
  | "AUTH_IDENTITY_REQUIRED"
  | "AUTH_PROFILE_NOT_ACTIVE"
  | "INVALID_AUTH_VERDICT"
  | "INVALID_AUTH_PROFILE_TRANSITION"
  | "INVALID_AUTH_CLAIM"
  | "INVALID_EVIDENCE_ARTIFACT"
  | "INVALID_CERTIFICATE"
  | "INVALID_CUSTODY"
  | "INVALID_PUBLIC_REPORT"
  | "PRIVATE_EVIDENCE_EXPOSED"
  | "INVALID_PUBLIC_CLAIM"
  | "MISSING_FRAME"
  | "MICRO_EVIDENCE_INCOMPLETE"
  | "INVALID_ARRAY"
  | "INVALID_RECORD"
  | "INVALID_NUMBER"
  | "MISSING_TOLERANCE"
  | "REPLAY_TOLERANCE_EXCEEDED"
  | "CENTERING_USES_MICROSCOPE_EVIDENCE"
  | "INVALID_TRANSFORM"
  | "EMPTY_ARRAY"
  | "MODE_MISSING_MACRO_FRAME"
  | "MODE_MISSING_MICRO_SPOTS"
  | "MODE_TOO_MANY_SURFACE_SPOTS"
  | "MODE_MISSING_SURFACE_REGION"
  | "MODE_MISSING_AUTH_PATCHES"
  | "MODE_MISSING_FORENSIC_RASTER";

export interface AiGraderValidationIssue {
  path: string;
  code: AiGraderValidationIssueCode;
  message: string;
}

export interface AiGraderValidationResult {
  valid: boolean;
  issues: AiGraderValidationIssue[];
}

export interface CaptureManifestModeValidationOptions {
  side?: CaptureSide;
  surfaceTopN?: number;
}

export interface MacroSuspectRegionSelectionOptions {
  side?: CaptureSide;
  threshold?: number;
  topN?: number;
}

export interface BuildMacroSuspectRegionIdInput {
  sessionId: string;
  side: CaptureSide;
  rank: number;
  thresholdSetId?: string;
}

export interface CardCoordinateNormalizationInput {
  side: CaptureSide;
  rect: Rect;
  cardWidthMm: number;
  cardHeightMm: number;
  backOrientationCorrected?: boolean;
}

export interface StageTravelBoundsMicrons {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface CardToStageTransformInput {
  side: CaptureSide;
  cardPointMm: { x: number; y: number };
  transformType: "AFFINE" | "HOMOGRAPHY";
  calibrationSnapshotId: string;
  validAt: string;
  expiresAt?: string;
  holderFiducialsVisible: boolean;
  acroHomeEstablished: boolean;
  fiducialPointCount: number;
  rmsResidualMicrons: number;
  backSideOrientationCorrectionStored?: boolean;
  stageTargetMicrons?: { x: number; y: number };
  safeTravelBoundsMicrons?: StageTravelBoundsMicrons;
}

export type NumericToleranceMap = Record<string, number>;

export interface AlgorithmVersionSeed {
  name: string;
  semanticVersion: string;
  sourceHash: string;
  internalReference?: string;
  patentReference?: string;
  numericTolerance: NumericToleranceMap;
  activeFrom?: string;
  activeTo?: string;
}

export interface ThresholdSetVersionSeed {
  name: string;
  semanticVersion: string;
  thresholds: Record<string, unknown>;
  sourceHash?: string;
  activeFrom?: string;
  activeTo?: string;
}

export interface RuntimeEnvironmentFingerprintInput {
  label: string;
  containerDigest: string;
  pythonVersion?: string | null;
  nodeVersion?: string | null;
  opencvVersion?: string | null;
  numpyVersion?: string | null;
  dependencyLockHash: string;
  osInfo?: Record<string, unknown> | null;
}

export interface RuntimeEnvironmentFingerprint {
  label: string;
  containerDigest: string;
  pythonVersion?: string;
  nodeVersion?: string;
  opencvVersion?: string;
  numpyVersion?: string;
  dependencyLockHash: string;
  osInfo?: Record<string, unknown>;
  fingerprintKey: string;
}

export interface ReplayRunInput {
  sourceGradeRunId: string;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  runtimeEnvironmentId: string;
  inputChecksum: string;
  outputChecksum: string;
  deltas: Record<string, number>;
  numericTolerance: NumericToleranceMap;
}

export interface ReplayToleranceFailure {
  path: string;
  delta: number;
  tolerance: number;
}

export interface ReplayToleranceResult {
  validInput: boolean;
  tolerancePassed: boolean;
  checked: number;
  maxAbsDelta: number;
  failures: ReplayToleranceFailure[];
  issues: AiGraderValidationIssue[];
}

const GRADING_MODES = [
  "QUICK",
  "STANDARD",
  "FORENSIC",
  "AUTH_ONLY",
  "MACRO_ONLY",
  "MACRO_PLUS_CORNERS",
  "MACRO_PLUS_EDGES",
  "FULL_TWO_SCALE",
] as const;

const CAPTURE_SIDES = ["FRONT", "BACK"] as const;
const MICRO_SPOT_ELEMENTS = ["CORNERS", "EDGES", "SURFACE", "CMYK_AUTHENTICATION"] as const;
const STANDARD_SPOT_PLAN_ELEMENTS = ["CORNERS", "EDGES", "SURFACE"] as const;
const FUSION_ACTION_TYPES = ["LOWER", "HOLD", "DUST_CORRECT", "WARNING_ONLY"] as const;
const REQUIRED_MICRO_SPOT_FRAME_KEYS = [
  "edrBase",
  "polarizedAllOn",
  "flcLed0",
  "flcLed1",
  "flcLed2",
  "flcLed3",
  "flcLed4",
  "flcLed5",
  "flcLed6",
  "flcLed7",
] as const satisfies readonly MicroSpotFrameKey[];
const REQUIRED_FLC_FRAME_KEYS = [
  "flcLed0",
  "flcLed1",
  "flcLed2",
  "flcLed3",
  "flcLed4",
  "flcLed5",
  "flcLed6",
  "flcLed7",
] as const satisfies readonly MicroSpotFrameKey[];
const STANDARD_CORNER_SPOT_LABELS = ["TOP_LEFT", "TOP_RIGHT", "BOTTOM_RIGHT", "BOTTOM_LEFT"] as const;
const STANDARD_EDGE_SPOT_LABELS = ["TOP_MIDPOINT", "RIGHT_MIDPOINT", "BOTTOM_MIDPOINT", "LEFT_MIDPOINT"] as const;

const GRADING_CAPTURE_KINDS = [
  "COLOR_CHECKER_FRONT",
  "COLOR_CHECKER_BACK",
  "FRONT_DIFFUSE",
  "BACK_DIFFUSE",
  "FRONT_DARKFIELD",
  "BACK_DARKFIELD",
  "FRONT_LED_0",
  "FRONT_LED_1",
  "FRONT_LED_2",
  "FRONT_LED_3",
  "FRONT_LED_4",
  "FRONT_LED_5",
  "FRONT_LED_6",
  "FRONT_LED_7",
  "BACK_LED_0",
  "BACK_LED_1",
  "BACK_LED_2",
  "BACK_LED_3",
  "BACK_LED_4",
  "BACK_LED_5",
  "BACK_LED_6",
  "BACK_LED_7",
  "MICRO_CORNER_SPOT",
  "MICRO_EDGE_SPOT",
  "MICRO_SURFACE_SPOT",
  "MICRO_AUTH_PATCH",
  "MICRO_CORNER_TILE",
  "MICRO_EDGE_TILE",
  "MICRO_SURFACE_TILE",
  "EDR_BASE",
  "POLARIZED_ALL_ON",
  "FLC_LED_0",
  "FLC_LED_1",
  "FLC_LED_2",
  "FLC_LED_3",
  "FLC_LED_4",
  "FLC_LED_5",
  "FLC_LED_6",
  "FLC_LED_7",
] as const;

const DEVICE_TYPES = [
  "MACRO_CAMERA",
  "LED_CONTROLLER",
  "MICROSCOPE",
  "XY_STAGE",
  "ARM_INTERLOCK",
  "HOLDER_FIDUCIAL",
] as const;

const COORDINATE_UNITS = ["px", "mm", "micron", "degree", "bitmask"] as const;
const DEVICE_HEALTH_STATUSES = ["PASS", "WARN", "FAIL"] as const;
const PHYSICAL_GATE_STATUSES = ["PASS", "WARN", "FAIL", "REVIEW"] as const;
const ARM_POSITIONS = ["ARM_IN", "ARM_OUT"] as const;
const CALIBRATION_TYPES = [
  "COLOR_CHECKER_CCM",
  "MACRO_INTRINSICS",
  "MACRO_FLAT_FIELD",
  "STAGE_HOME",
  "CARD_JIG_TRANSFORM",
  "MICROSCOPE_PX_PER_MICRON",
  "MICROSCOPE_FOCUS_BASELINE",
  "LED_INTENSITY_HEALTH",
  "ARM_INTERLOCK_HEALTH",
] as const;
const PHYSICAL_GATE_KINDS = [
  "TRIMMED_CARD_SIZE",
  "THICKNESS_MASS_LAYER_ANOMALY",
  "UNEXPECTED_HOLDER_OR_SLEEVE",
  "COATING_GLOSS_ANOMALY",
  "RESIDUE_ADHESIVE",
  "RECOLORING_RESTORATION",
  "EXCESSIVE_DUST",
  "FOREIGN_REFLECTIVE_MATERIAL",
  "FRONT_BACK_SANDWICH_MISMATCH",
  "CUSTODY_BREAK_AFTER_CERTIFICATION",
] as const;
const AUTH_VERDICTS = [
  "REFERENCE_NEEDED",
  "AUTHENTIC",
  "PROBABLY_AUTHENTIC",
  "SUSPICIOUS",
  "LIKELY_COUNTERFEIT",
] as const;
const PRINT_PROFILE_STATUSES = [
  "CANDIDATE",
  "CURATED_REFERENCE",
  "ACTIVE",
  "QUARANTINED",
  "RETIRED",
] as const;
const AUTH_RUN_STATUSES = ["PENDING", "RUNNING", "COMPLETE", "FAILED"] as const;
const PRODUCTION_AUTH_VERDICTS = [
  "AUTHENTIC",
  "PROBABLY_AUTHENTIC",
  "SUSPICIOUS",
  "LIKELY_COUNTERFEIT",
] as const;
const AUTH_IDENTITY_SOURCES = ["OPERATOR_SUPPLIED", "MANIFEST", "CURATED_REFERENCE"] as const;
const AUTH_PROFILE_ALLOWED_TRANSITIONS = new Set<string>([
  "CANDIDATE->CURATED_REFERENCE",
  "CANDIDATE->QUARANTINED",
  "CANDIDATE->RETIRED",
  "CURATED_REFERENCE->ACTIVE",
  "CURATED_REFERENCE->QUARANTINED",
  "CURATED_REFERENCE->RETIRED",
  "ACTIVE->QUARANTINED",
  "ACTIVE->RETIRED",
  "QUARANTINED->CURATED_REFERENCE",
  "QUARANTINED->RETIRED",
]);
const EVIDENCE_CLASSES = ["ORIGINAL", "DERIVED", "PUBLIC", "PRIVATE"] as const;
const CERTIFICATE_STATUSES = ["DRAFT", "ACTIVE", "REVOKED", "SUPERSEDED"] as const;
const CUSTODY_EVENT_TYPES = [
  "INTAKE",
  "CAPTURE_START",
  "CAPTURE_COMPLETE",
  "VAULT_IN",
  "VAULT_OUT",
  "SHIPPED",
  "RECEIVED",
  "SLAB_SENT",
  "SLAB_RETURNED",
  "CERTIFICATE_ISSUED",
  "CERTIFICATE_REVOKED",
  "CUSTODY_BREAK",
] as const;
const GRADE_RUN_STATUSES = ["PENDING", "RUNNING", "COMPLETE", "FAILED", "REPLAYED"] as const;
const PUBLIC_REPORT_MODES = ["QUICK", "STANDARD", "FORENSIC", "AUTH_ONLY"] as const;
const MICROSCOPE_INSPECTION_DISCLOSURES = ["NONE", "SAMPLED", "EXHAUSTIVE", "AUTH_PATCHES"] as const;
export const DEFAULT_REQUIRED_CALIBRATION_TYPES: readonly CalibrationType[] = [
  "COLOR_CHECKER_CCM",
  "STAGE_HOME",
  "CARD_JIG_TRANSFORM",
  "MICROSCOPE_PX_PER_MICRON",
  "MICROSCOPE_FOCUS_BASELINE",
  "LED_INTENSITY_HEALTH",
  "ARM_INTERLOCK_HEALTH",
] as const;
export const COLOR_CHECKER_MAX_MEAN_DELTA_E = 2.0;
export const STAGE_TRANSFORM_MAX_RMS_RESIDUAL_MICRONS = 50;
export const LED_MAX_CHANNEL_DEVIATION_PERCENT = 10;
export const MICROSCOPE_SCALE_MAX_MISMATCH_PERCENT = 2;
export const FOCUS_BASELINE_MAX_DROP_PERCENT = 15;

const GRADING_MODE_VALUES = new Set<string>(GRADING_MODES);
const CAPTURE_SIDE_VALUES = new Set<string>(CAPTURE_SIDES);
const MICRO_SPOT_ELEMENT_VALUES = new Set<string>(MICRO_SPOT_ELEMENTS);
const STANDARD_SPOT_PLAN_ELEMENT_VALUES = new Set<string>(STANDARD_SPOT_PLAN_ELEMENTS);
const FUSION_ACTION_TYPE_VALUES = new Set<string>(FUSION_ACTION_TYPES);
const GRADING_CAPTURE_KIND_VALUES = new Set<string>(GRADING_CAPTURE_KINDS);
const DEVICE_TYPE_VALUES = new Set<string>(DEVICE_TYPES);
const COORDINATE_UNIT_VALUES = new Set<string>(COORDINATE_UNITS);
const DEVICE_HEALTH_STATUS_VALUES = new Set<string>(DEVICE_HEALTH_STATUSES);
const PHYSICAL_GATE_STATUS_VALUES = new Set<string>(PHYSICAL_GATE_STATUSES);
const ARM_POSITION_VALUES = new Set<string>(ARM_POSITIONS);
const CALIBRATION_TYPE_VALUES = new Set<string>(CALIBRATION_TYPES);
const PHYSICAL_GATE_KIND_VALUES = new Set<string>(PHYSICAL_GATE_KINDS);
const AUTH_VERDICT_VALUES = new Set<string>(AUTH_VERDICTS);
const PRINT_PROFILE_STATUS_VALUES = new Set<string>(PRINT_PROFILE_STATUSES);
const AUTH_RUN_STATUS_VALUES = new Set<string>(AUTH_RUN_STATUSES);
const PRODUCTION_AUTH_VERDICT_VALUES = new Set<string>(PRODUCTION_AUTH_VERDICTS);
const AUTH_IDENTITY_SOURCE_VALUES = new Set<string>(AUTH_IDENTITY_SOURCES);
const EVIDENCE_CLASS_VALUES = new Set<string>(EVIDENCE_CLASSES);
const CERTIFICATE_STATUS_VALUES = new Set<string>(CERTIFICATE_STATUSES);
const CUSTODY_EVENT_TYPE_VALUES = new Set<string>(CUSTODY_EVENT_TYPES);
const GRADE_RUN_STATUS_VALUES = new Set<string>(GRADE_RUN_STATUSES);
const PUBLIC_REPORT_MODE_VALUES = new Set<string>(PUBLIC_REPORT_MODES);
const MICROSCOPE_INSPECTION_DISCLOSURE_VALUES = new Set<string>(MICROSCOPE_INSPECTION_DISCLOSURES);
const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const CONTAINER_DIGEST_RE = /^(?:sha256:)?[a-f0-9]{64}$/i;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const AI_GRADER_SEED_ACTIVE_FROM = "2026-05-28T00:00:00.000Z";
export const STANDARD_CORNERS_PER_SIDE = 4;
export const STANDARD_EDGES_PER_SIDE = 4;
export const DEFAULT_SURFACE_SUSPECT_THRESHOLD = 0.72;
export const DEFAULT_STANDARD_SURFACE_TOP_N = 3;
const STANDARD_SPOT_FUSION_SOURCE_HASH = "1".repeat(64);
const MACRO_PIPELINE_SOURCE_HASH = "2".repeat(64);
const CMYK_PRINT_PROFILE_SOURCE_HASH = "3".repeat(64);
const DEFAULT_THRESHOLDS_SOURCE_HASH = "4".repeat(64);

function validationResult(issues: AiGraderValidationIssue[]): AiGraderValidationResult {
  return {
    valid: issues.length === 0,
    issues,
  };
}

function issue(path: string, code: AiGraderValidationIssueCode, message: string): AiGraderValidationIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValidTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function hasValidSha256(value: unknown): boolean {
  return typeof value === "string" && SHA256_HEX_RE.test(value);
}

function hasValidContainerDigest(value: unknown): boolean {
  return typeof value === "string" && CONTAINER_DIGEST_RE.test(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isContractGradeScore(value: unknown): value is number {
  return (
    isFiniteNumber(value) &&
    value >= 1 &&
    value <= 10 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
  );
}

function validateContractGradeRecord(
  value: Record<string, unknown>,
  path: string,
  issues: AiGraderValidationIssue[],
) {
  Object.entries(value).forEach(([field, grade]) => {
    if (!isContractGradeScore(grade)) {
      issues.push(issue(
        `${path}.${field}`,
        "INVALID_SCORE",
        "grade values must be finite scores from 1.00 through 10.00 with at most two decimal places.",
      ));
    }
  });
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function requireString(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: AiGraderValidationIssue[]
) {
  if (!isNonEmptyString(record[field])) {
    issues.push(issue(`${path}.${field}`, "REQUIRED", `${field} is required.`));
  }
}

function requireStringArray(
  value: unknown,
  path: string,
  issues: AiGraderValidationIssue[],
  options: { allowEmpty?: boolean } = {}
) {
  if (!Array.isArray(value)) {
    issues.push(issue(path, "INVALID_ARRAY", `${path} must be an array.`));
    return;
  }
  if (!options.allowEmpty && value.length === 0) {
    issues.push(issue(path, "EMPTY_ARRAY", `${path} must include at least one value.`));
  }
  value.forEach((entry, index) => {
    if (!isNonEmptyString(entry)) {
      issues.push(issue(`${path}[${index}]`, "REQUIRED", `${path}[${index}] must be a non-empty string.`));
    }
  });
}

function validateStringRecord(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an object.`));
    return;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    issues.push(issue(path, "EMPTY_ARRAY", `${path} must include at least one entry.`));
  }
  entries.forEach(([key, entry]) => {
    if (!isNonEmptyString(key) || !isNonEmptyString(entry)) {
      issues.push(issue(`${path}.${key}`, "REQUIRED", `${path}.${key} must be a non-empty string.`));
    }
  });
}

function validateSemver(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isNonEmptyString(value) || !SEMVER_RE.test(value)) {
    issues.push(issue(path, "INVALID_VERSION", `${path} must be a semantic version string.`));
  }
}

function validateDateWindow(record: Record<string, unknown>, path: string, issues: AiGraderValidationIssue[]) {
  if (record.activeFrom != null && !hasValidTimestamp(record.activeFrom)) {
    issues.push(issue(`${path}.activeFrom`, "INVALID_TIMESTAMP", "activeFrom must be a valid timestamp string."));
  }
  if (record.activeTo != null && !hasValidTimestamp(record.activeTo)) {
    issues.push(issue(`${path}.activeTo`, "INVALID_TIMESTAMP", "activeTo must be a valid timestamp string."));
  }
  if (
    hasValidTimestamp(record.activeFrom) &&
    hasValidTimestamp(record.activeTo) &&
    Date.parse(String(record.activeTo)) <= Date.parse(String(record.activeFrom))
  ) {
    issues.push(issue(`${path}.activeTo`, "INVALID_TIMESTAMP", "activeTo must be later than activeFrom."));
  }
}

function timestampMillis(value: unknown): number | undefined {
  if (!hasValidTimestamp(value)) {
    return undefined;
  }
  return Date.parse(String(value));
}

function validateNumericToleranceMap(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an object.`));
    return;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    issues.push(issue(path, "EMPTY_ARRAY", `${path} must include at least one tolerance.`));
  }

  entries.forEach(([key, tolerance]) => {
    if (!isNonEmptyString(key) || !isFiniteNumber(tolerance) || tolerance < 0) {
      issues.push(issue(`${path}.${key}`, "INVALID_TOLERANCE", "Numeric tolerances must be non-negative finite numbers."));
    }
  });
}

function validateRect(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECT", `${path} must be a rectangle object.`));
    return;
  }

  ["x", "y", "w", "h"].forEach((field) => {
    if (!isFiniteNumber(value[field])) {
      issues.push(issue(`${path}.${field}`, "INVALID_RECT", `${field} must be a finite number.`));
    }
  });

  if (isFiniteNumber(value.w) && value.w <= 0) {
    issues.push(issue(`${path}.w`, "INVALID_RECT", "w must be greater than 0."));
  }
  if (isFiniteNumber(value.h) && value.h <= 0) {
    issues.push(issue(`${path}.h`, "INVALID_RECT", "h must be greater than 0."));
  }
}

function validateEvidenceArtifactRef(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an evidence artifact reference object.`));
    return;
  }

  requireString(value, "storageKey", path, issues);
  if (!hasValidSha256(value.checksumSha256)) {
    issues.push(issue(`${path}.checksumSha256`, "INVALID_CHECKSUM", "checksumSha256 must be a 64-character hex SHA-256 digest."));
  }

  ["byteSize", "widthPx", "heightPx"].forEach((field) => {
    if (value[field] != null && (!isFiniteNumber(value[field]) || value[field] < 0)) {
      issues.push(issue(`${path}.${field}`, "INVALID_NUMBER", `${field} must be a non-negative finite number when provided.`));
    }
  });
}

function validateUnknownRecordPresent(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an object.`));
  }
}

function missingMicroSpotFrameKeys(value: unknown): MicroSpotFrameKey[] {
  if (!isRecord(value)) {
    return [...REQUIRED_MICRO_SPOT_FRAME_KEYS];
  }

  return REQUIRED_MICRO_SPOT_FRAME_KEYS.filter((frameKey) => value[frameKey] == null);
}

function validateMicroSpotCaptureFramesInternal(
  value: unknown,
  path: string
): AiGraderValidationIssue[] {
  const issues: AiGraderValidationIssue[] = [];

  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be a micro spot frame object.`));
    return issues;
  }

  REQUIRED_MICRO_SPOT_FRAME_KEYS.forEach((frameKey) => {
    const frame = value[frameKey];
    const framePath = `${path}.${frameKey}`;
    if (frame == null) {
      issues.push(issue(framePath, "MISSING_FRAME", `${frameKey} is required.`));
      return;
    }
    validateEvidenceArtifactRef(frame, framePath, issues);
  });

  return issues;
}

function centeringReferencesMicroscopeEvidence(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => centeringReferencesMicroscopeEvidence(entry));
  }
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("micro") ||
      normalizedKey.includes("microscope") ||
      normalizedKey.includes("spotpackage") ||
      normalizedKey.includes("spot_package")
    ) {
      return true;
    }
    return centeringReferencesMicroscopeEvidence(entry);
  });
}

function actionReferencesCentering(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return value.element === "CENTERING";
}

function validateFusionActionsIgnoreCentering(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!Array.isArray(value)) {
    return;
  }
  value.forEach((entry, index) => {
    if (actionReferencesCentering(entry)) {
      issues.push(issue(`${path}[${index}].element`, "CENTERING_USES_MICROSCOPE_EVIDENCE", "Fusion actions must not target centering."));
    }
  });
}

function finiteRecordNumber(record: unknown, fields: string[]): number | undefined {
  if (!isRecord(record)) {
    return undefined;
  }
  for (const field of fields) {
    const value = record[field];
    if (isFiniteNumber(value)) {
      return value;
    }
  }
  return undefined;
}

function recordBoolean(record: unknown, fields: string[]): boolean | undefined {
  if (!isRecord(record)) {
    return undefined;
  }
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function recordString(record: unknown, fields: string[]): string | undefined {
  if (!isRecord(record)) {
    return undefined;
  }
  for (const field of fields) {
    const value = record[field];
    if (isNonEmptyString(value)) {
      return value;
    }
  }
  return undefined;
}

function validateCaptureManifestFrameInternal(value: unknown, path: string): AiGraderValidationIssue[] {
  const issues: AiGraderValidationIssue[] = [];

  if (!isRecord(value)) {
    return [issue(path, "INVALID_RECORD", `${path} must be an object.`)];
  }

  requireString(value, "frameId", path, issues);
  requireString(value, "storageKey", path, issues);

  if (!isNonEmptyString(value.kind) || !GRADING_CAPTURE_KIND_VALUES.has(value.kind)) {
    issues.push(issue(`${path}.kind`, "INVALID_ENUM", "kind must be a supported GradingCaptureKind."));
  }

  if (!isNonEmptyString(value.side) || !CAPTURE_SIDE_VALUES.has(value.side)) {
    issues.push(issue(`${path}.side`, "INVALID_ENUM", "side must be FRONT or BACK."));
  }

  if (!hasValidSha256(value.checksumSha256)) {
    issues.push(issue(`${path}.checksumSha256`, "INVALID_CHECKSUM", "checksumSha256 must be a 64-character hex SHA-256 digest."));
  }

  if (!hasValidTimestamp(value.capturedAt)) {
    issues.push(issue(`${path}.capturedAt`, "INVALID_TIMESTAMP", "capturedAt must be a valid timestamp string."));
  }

  [
    "exposureUs",
    "ledMask",
    "stageXMicrons",
    "stageYMicrons",
    "microMagnification",
    "polarizerAngle",
    "focusScore",
    "widthPx",
    "heightPx",
  ].forEach((field) => {
    if (value[field] != null && !isFiniteNumber(value[field])) {
      issues.push(issue(`${path}.${field}`, "INVALID_NUMBER", `${field} must be a finite number when provided.`));
    }
  });

  if (value.sourceSuspectRegionId != null && !isNonEmptyString(value.sourceSuspectRegionId)) {
    issues.push(issue(`${path}.sourceSuspectRegionId`, "REQUIRED", "sourceSuspectRegionId must be non-empty when provided."));
  }

  return issues;
}

export function buildModePlan(mode: GradingMode): ModePlan {
  switch (mode) {
    case "QUICK":
    case "MACRO_ONLY":
      return {
        mode,
        macroRequired: true,
        microscopePlan: { type: "NONE" },
        producesGrade: true,
        producesAuthVerdict: false,
        publicModeDescription: "Macro-only grade; microscope evidence is not required.",
      };
    case "STANDARD":
    case "MACRO_PLUS_CORNERS":
    case "MACRO_PLUS_EDGES":
      return {
        mode,
        macroRequired: true,
        microscopePlan: { type: "STANDARD_SPOTS", cornersPerSide: 4, edgesPerSide: 4, surfaceTopN: 3 },
        producesGrade: true,
        producesAuthVerdict: false,
        publicModeDescription: "STANDARD spot-check grade with corner, edge, and routed surface microscope evidence.",
      };
    case "FORENSIC":
    case "FULL_TWO_SCALE":
      return {
        mode,
        macroRequired: true,
        microscopePlan: { type: "FORENSIC_RASTER", includeCorners: true, includeEdges: true, includeSurface: true, includeAuth: true },
        producesGrade: true,
        producesAuthVerdict: true,
        publicModeDescription: "FORENSIC raster capture with microscope evidence for grade and authentication support.",
      };
    case "AUTH_ONLY":
      return {
        mode,
        macroRequired: true,
        microscopePlan: { type: "AUTH_PATCHES", patchCount: 5 },
        producesGrade: false,
        producesAuthVerdict: true,
        publicModeDescription: "Authentication-only capture; no grade values are produced.",
      };
  }
}

export function validateDeviceCapabilityManifest(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "manifest";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "DeviceCapabilityManifest must be an object.")]);
  }

  [
    "id",
    "rigId",
    "helperInstanceId",
    "driverName",
    "driverVersion",
    "componentSerial",
    "checksum",
    "observedAt",
  ].forEach((field) => requireString(value, field, path, issues));

  if (!isNonEmptyString(value.deviceType) || !DEVICE_TYPE_VALUES.has(value.deviceType)) {
    issues.push(issue(`${path}.deviceType`, "INVALID_ENUM", "deviceType must be a supported DeviceType."));
  }

  if (!hasValidTimestamp(value.observedAt)) {
    issues.push(issue(`${path}.observedAt`, "INVALID_TIMESTAMP", "observedAt must be a valid timestamp string."));
  }

  requireStringArray(value.supportedCapturePackages, `${path}.supportedCapturePackages`, issues);
  requireStringArray(value.requiredCalibrationTypes, `${path}.requiredCalibrationTypes`, issues, { allowEmpty: true });

  if (!isRecord(value.coordinateUnits)) {
    issues.push(issue(`${path}.coordinateUnits`, "INVALID_RECORD", "coordinateUnits must be an object."));
  } else {
    Object.entries(value.coordinateUnits).forEach(([key, unit]) => {
      if (!isNonEmptyString(key) || typeof unit !== "string" || !COORDINATE_UNIT_VALUES.has(unit)) {
        issues.push(issue(`${path}.coordinateUnits.${key}`, "INVALID_ENUM", "coordinateUnits values must be supported coordinate units."));
      }
    });
  }

  if (!isRecord(value.timingCharacteristics)) {
    issues.push(issue(`${path}.timingCharacteristics`, "INVALID_RECORD", "timingCharacteristics must be an object."));
  } else {
    Object.entries(value.timingCharacteristics).forEach(([key, entry]) => {
      if (!isFiniteNumber(entry) || entry < 0) {
        issues.push(issue(`${path}.timingCharacteristics.${key}`, "INVALID_NUMBER", "timingCharacteristics values must be non-negative finite numbers."));
      }
    });
  }

  if (!Array.isArray(value.healthChecks)) {
    issues.push(issue(`${path}.healthChecks`, "INVALID_ARRAY", "healthChecks must be an array."));
  } else if (value.healthChecks.length === 0) {
    issues.push(issue(`${path}.healthChecks`, "EMPTY_ARRAY", "healthChecks must include at least one check."));
  } else {
    value.healthChecks.forEach((entry, index) => {
      const entryPath = `${path}.healthChecks[${index}]`;
      if (!isRecord(entry)) {
        issues.push(issue(entryPath, "INVALID_RECORD", `${entryPath} must be an object.`));
        return;
      }
      requireString(entry, "name", entryPath, issues);
      if (typeof entry.required !== "boolean") {
        issues.push(issue(`${entryPath}.required`, "INVALID_TYPE", "required must be a boolean."));
      }
      if (!isFiniteNumber(entry.timeoutMs) || entry.timeoutMs <= 0) {
        issues.push(issue(`${entryPath}.timeoutMs`, "INVALID_NUMBER", "timeoutMs must be a positive finite number."));
      }
    });
  }

  return validationResult(issues);
}

export function validateCaptureManifestFrame(value: unknown): AiGraderValidationResult {
  return validationResult(validateCaptureManifestFrameInternal(value, "frame"));
}

export function validateCaptureManifest(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "manifest";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "CaptureManifest must be an object.")]);
  }

  [
    "id",
    "captureSessionId",
    "tenantId",
    "rigId",
    "locationId",
    "operatorId",
    "helperInstanceId",
    "helperVersion",
    "createdAt",
  ].forEach((field) => requireString(value, field, path, issues));

  if (!hasValidSha256(value.checksumSha256)) {
    issues.push(issue(`${path}.checksumSha256`, "INVALID_CHECKSUM", "checksumSha256 must be a 64-character hex SHA-256 digest."));
  }

  if (!hasValidTimestamp(value.createdAt)) {
    issues.push(issue(`${path}.createdAt`, "INVALID_TIMESTAMP", "createdAt must be a valid timestamp string."));
  }

  validateStringRecord(value.driverVersions, `${path}.driverVersions`, issues);
  validateStringRecord(value.componentSerials, `${path}.componentSerials`, issues);
  requireStringArray(value.calibrationSnapshotIds, `${path}.calibrationSnapshotIds`, issues);

  if (!Array.isArray(value.frameList)) {
    issues.push(issue(`${path}.frameList`, "INVALID_ARRAY", "frameList must be an array."));
  } else if (value.frameList.length === 0) {
    issues.push(issue(`${path}.frameList`, "EMPTY_ARRAY", "frameList must include at least one frame."));
  } else {
    value.frameList.forEach((frame, index) => {
      issues.push(...validateCaptureManifestFrameInternal(frame, `${path}.frameList[${index}]`));
    });
  }

  if (!Array.isArray(value.operatorPrompts)) {
    issues.push(issue(`${path}.operatorPrompts`, "INVALID_ARRAY", "operatorPrompts must be an array."));
  } else {
    value.operatorPrompts.forEach((entry, index) => {
      const entryPath = `${path}.operatorPrompts[${index}]`;
      if (!isRecord(entry)) {
        issues.push(issue(entryPath, "INVALID_RECORD", `${entryPath} must be an object.`));
        return;
      }
      requireString(entry, "prompt", entryPath, issues);
      if (!hasValidTimestamp(entry.shownAt)) {
        issues.push(issue(`${entryPath}.shownAt`, "INVALID_TIMESTAMP", "shownAt must be a valid timestamp string."));
      }
      if (entry.confirmedAt != null && !hasValidTimestamp(entry.confirmedAt)) {
        issues.push(issue(`${entryPath}.confirmedAt`, "INVALID_TIMESTAMP", "confirmedAt must be a valid timestamp string."));
      }
    });
  }

  if (!Array.isArray(value.deviceHealth)) {
    issues.push(issue(`${path}.deviceHealth`, "INVALID_ARRAY", "deviceHealth must be an array."));
  } else if (value.deviceHealth.length === 0) {
    issues.push(issue(`${path}.deviceHealth`, "EMPTY_ARRAY", "deviceHealth must include at least one check result."));
  } else {
    value.deviceHealth.forEach((entry, index) => {
      const entryPath = `${path}.deviceHealth[${index}]`;
      if (!isRecord(entry)) {
        issues.push(issue(entryPath, "INVALID_RECORD", `${entryPath} must be an object.`));
        return;
      }
      requireString(entry, "check", entryPath, issues);
      if (!isNonEmptyString(entry.status) || !DEVICE_HEALTH_STATUS_VALUES.has(entry.status)) {
        issues.push(issue(`${entryPath}.status`, "INVALID_ENUM", "deviceHealth status must be PASS, WARN, or FAIL."));
      }
      if (entry.detail != null && typeof entry.detail !== "string") {
        issues.push(issue(`${entryPath}.detail`, "INVALID_TYPE", "deviceHealth detail must be a string when provided."));
      }
    });
  }

  return validationResult(issues);
}

function captureFramesForMode(value: unknown): CaptureManifestFrame[] {
  if (!isRecord(value) || !Array.isArray(value.frameList)) {
    return [];
  }
  return value.frameList.filter(isRecord) as unknown as CaptureManifestFrame[];
}

function frameMatchesSide(frame: CaptureManifestFrame, side?: CaptureSide): boolean {
  return !side || frame.side === side;
}

function isMacroFrame(frame: CaptureManifestFrame): boolean {
  return (
    frame.kind === "COLOR_CHECKER_FRONT" ||
    frame.kind === "COLOR_CHECKER_BACK" ||
    frame.kind === "FRONT_DIFFUSE" ||
    frame.kind === "BACK_DIFFUSE" ||
    frame.kind === "FRONT_DARKFIELD" ||
    frame.kind === "BACK_DARKFIELD" ||
    frame.kind.startsWith("FRONT_LED_") ||
    frame.kind.startsWith("BACK_LED_")
  );
}

function countFrames(frames: CaptureManifestFrame[], kind: GradingCaptureKind, side?: CaptureSide): number {
  return frames.filter((frame) => frame.kind === kind && frameMatchesSide(frame, side)).length;
}

export function validateCaptureManifestForMode(
  manifest: unknown,
  mode: GradingMode,
  options: CaptureManifestModeValidationOptions = {}
): AiGraderValidationResult {
  const issues = [...validateCaptureManifest(manifest).issues];

  if (!GRADING_MODE_VALUES.has(mode)) {
    issues.push(issue("mode", "INVALID_ENUM", "mode must be a supported GradingMode."));
    return validationResult(issues);
  }

  const plan = buildModePlan(mode);
  const frames = captureFramesForMode(manifest).filter((frame) => frameMatchesSide(frame, options.side));
  const sideLabel = options.side ? ` for ${options.side}` : "";
  const macroFrameCount = frames.filter(isMacroFrame).length;

  if (plan.macroRequired && macroFrameCount < 1) {
    issues.push(issue("manifest.frameList", "MODE_MISSING_MACRO_FRAME", `Mode ${mode} requires at least one macro frame${sideLabel}.`));
  }

  if (plan.microscopePlan.type === "STANDARD_SPOTS") {
    const cornerCount = countFrames(frames, "MICRO_CORNER_SPOT", options.side);
    const edgeCount = countFrames(frames, "MICRO_EDGE_SPOT", options.side);
    const surfaceCount = countFrames(frames, "MICRO_SURFACE_SPOT", options.side);
    const surfaceTopN = options.surfaceTopN ?? plan.microscopePlan.surfaceTopN;

    if (cornerCount < plan.microscopePlan.cornersPerSide || edgeCount < plan.microscopePlan.edgesPerSide) {
      issues.push(issue("manifest.frameList", "MODE_MISSING_MICRO_SPOTS", `STANDARD requires 4 corner and 4 edge microscope spots per side${sideLabel}.`));
    }
    if (surfaceCount > surfaceTopN) {
      issues.push(issue("manifest.frameList", "MODE_TOO_MANY_SURFACE_SPOTS", `STANDARD allows at most ${surfaceTopN} routed surface spots per side${sideLabel}.`));
    }
    frames
      .filter((frame) => frame.kind === "MICRO_SURFACE_SPOT")
      .forEach((frame) => {
        if (!isNonEmptyString(frame.sourceSuspectRegionId)) {
          issues.push(issue(`manifest.frameList.${frame.frameId}.sourceSuspectRegionId`, "MODE_MISSING_SURFACE_REGION", "STANDARD surface microscope spots must link to a source suspect region."));
        }
      });
  }

  if (plan.microscopePlan.type === "AUTH_PATCHES") {
    const authPatchCount = countFrames(frames, "MICRO_AUTH_PATCH", options.side);
    if (authPatchCount < plan.microscopePlan.patchCount) {
      issues.push(issue("manifest.frameList", "MODE_MISSING_AUTH_PATCHES", `AUTH_ONLY requires ${plan.microscopePlan.patchCount} microscope auth patches${sideLabel}.`));
    }
  }

  if (plan.microscopePlan.type === "FORENSIC_RASTER") {
    const authPatchCount = countFrames(frames, "MICRO_AUTH_PATCH", options.side);
    const hasCornerRaster = countFrames(frames, "MICRO_CORNER_TILE", options.side) > 0;
    const hasEdgeRaster = countFrames(frames, "MICRO_EDGE_TILE", options.side) > 0;
    const hasSurfaceRaster = countFrames(frames, "MICRO_SURFACE_TILE", options.side) > 0;
    if (!hasCornerRaster || !hasEdgeRaster || !hasSurfaceRaster) {
      issues.push(issue("manifest.frameList", "MODE_MISSING_FORENSIC_RASTER", `FORENSIC requires corner, edge, and surface raster evidence at contract level${sideLabel}.`));
    }
    if (authPatchCount < 5) {
      issues.push(issue("manifest.frameList", "MODE_MISSING_AUTH_PATCHES", `FORENSIC requires at least 5 microscope auth patches${sideLabel}.`));
    }
  }

  return validationResult(issues);
}

export function buildMacroSuspectRegionId(input: BuildMacroSuspectRegionIdInput): string {
  const base = [
    "macro-suspect",
    input.sessionId.trim(),
    input.side,
    "SURFACE",
    String(input.rank),
  ];
  if (isNonEmptyString(input.thresholdSetId)) {
    base.push(input.thresholdSetId.trim());
  }
  return base.join(":");
}

export function normalizeBackSideCardCoordinates(input: CardCoordinateNormalizationInput): Rect {
  if (input.side !== "BACK" || input.backOrientationCorrected) {
    return { ...input.rect };
  }

  return {
    x: input.cardWidthMm - input.rect.x - input.rect.w,
    y: input.rect.y,
    w: input.rect.w,
    h: input.rect.h,
  };
}

export function sortAndSelectStandardSurfaceSuspects(
  suspects: MacroSuspectRegion[],
  options: MacroSuspectRegionSelectionOptions = {}
): MacroSuspectRegion[] {
  const threshold = options.threshold ?? DEFAULT_SURFACE_SUSPECT_THRESHOLD;
  const topN = options.topN ?? DEFAULT_STANDARD_SURFACE_TOP_N;
  if (topN <= 0) {
    return [];
  }

  return suspects
    .filter((suspect) => suspect.element === "SURFACE")
    .filter((suspect) => !options.side || suspect.side === options.side)
    .filter((suspect) => suspect.score >= threshold)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.rank - right.rank;
    })
    .slice(0, topN)
    .map((suspect) => ({ ...suspect }));
}

export function validateMacroSuspectRegion(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "suspect";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "MacroSuspectRegion must be an object.")]);
  }

  ["id", "sessionId", "thresholdSetId"].forEach((field) => requireString(value, field, path, issues));

  if (!isNonEmptyString(value.side) || !CAPTURE_SIDE_VALUES.has(value.side)) {
    issues.push(issue(`${path}.side`, "INVALID_ENUM", "side must be FRONT or BACK."));
  }
  if (value.element !== "SURFACE") {
    issues.push(issue(`${path}.element`, "INVALID_ENUM", "MacroSuspectRegion.element must be SURFACE."));
  }
  const rank = value.rank;
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) {
    issues.push(issue(`${path}.rank`, "INVALID_RANK", "rank must be a positive integer."));
  }
  if (!isFiniteNumber(value.score) || value.score < 0 || value.score > 1) {
    issues.push(issue(`${path}.score`, "INVALID_SCORE", "score must be a normalized value from 0 to 1."));
  }
  if (!isFiniteNumber(value.threshold) || value.threshold < 0 || value.threshold > 1) {
    issues.push(issue(`${path}.threshold`, "INVALID_SCORE", "threshold must be a normalized value from 0 to 1."));
  }

  requireStringArray(value.reasonCodes, `${path}.reasonCodes`, issues);
  requireStringArray(value.macroCaptureIds, `${path}.macroCaptureIds`, issues);
  validateRect(value.cardMm, `${path}.cardMm`, issues);
  validateRect(value.warpedPx, `${path}.warpedPx`, issues);
  if (value.sourcePx != null) {
    validateRect(value.sourcePx, `${path}.sourcePx`, issues);
  }
  if (value.heatmapStorageKey != null && !isNonEmptyString(value.heatmapStorageKey)) {
    issues.push(issue(`${path}.heatmapStorageKey`, "REQUIRED", "heatmapStorageKey must be non-empty when provided."));
  }

  return validationResult(issues);
}

export function validateMacroPipelineOutput(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "macroOutput";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "MacroPipelineOutput must be an object.")]);
  }

  [
    "sessionId",
    "captureManifestId",
    "algorithmVersionId",
    "thresholdSetVersionId",
  ].forEach((field) => requireString(value, field, path, issues));

  if (!isNonEmptyString(value.side) || !CAPTURE_SIDE_VALUES.has(value.side)) {
    issues.push(issue(`${path}.side`, "INVALID_ENUM", "side must be FRONT or BACK."));
  }

  if (!isRecord(value.centeringMeasurement)) {
    issues.push(issue(`${path}.centeringMeasurement`, "INVALID_RECORD", "centeringMeasurement must be an object."));
  } else if (centeringReferencesMicroscopeEvidence(value.centeringMeasurement)) {
    issues.push(issue(`${path}.centeringMeasurement`, "CENTERING_USES_MICROSCOPE_EVIDENCE", "Centering must not reference microscope evidence."));
  }

  if (!isRecord(value.provisionalGrades)) {
    issues.push(issue(`${path}.provisionalGrades`, "INVALID_RECORD", "provisionalGrades must be an object."));
  } else {
    const provisionalGrades = value.provisionalGrades;
    ["centering", "corners", "edges", "surface"].forEach((field) => {
      if (!isContractGradeScore(provisionalGrades[field])) {
        issues.push(issue(`${path}.provisionalGrades.${field}`, "INVALID_SCORE", `${field} provisional grade must be from 1.00 through 10.00 with at most two decimal places.`));
      }
    });
  }

  if (!isRecord(value.macroMeasurements)) {
    issues.push(issue(`${path}.macroMeasurements`, "INVALID_RECORD", "macroMeasurements must be an object."));
  }

  if (!Array.isArray(value.suspectRegions)) {
    issues.push(issue(`${path}.suspectRegions`, "INVALID_ARRAY", "suspectRegions must be an array."));
  } else {
    value.suspectRegions.forEach((suspect, index) => {
      const result = validateMacroSuspectRegion(suspect);
      result.issues.forEach((entry) => {
        issues.push({
          ...entry,
          path: `${path}.suspectRegions[${index}]${entry.path.startsWith("suspect") ? entry.path.slice("suspect".length) : `.${entry.path}`}`,
        });
      });
      if (isRecord(suspect) && suspect.sessionId !== value.sessionId) {
        issues.push(issue(`${path}.suspectRegions[${index}].sessionId`, "INVALID_RECORD", "suspect sessionId must match macro output sessionId."));
      }
      if (isRecord(suspect) && suspect.side !== value.side) {
        issues.push(issue(`${path}.suspectRegions[${index}].side`, "INVALID_ENUM", "suspect side must match macro output side."));
      }
    });
  }

  if (!Array.isArray(value.physicalGateResults)) {
    issues.push(issue(`${path}.physicalGateResults`, "INVALID_ARRAY", "physicalGateResults must be an array."));
  } else {
    value.physicalGateResults.forEach((gate, index) => {
      const gatePath = `${path}.physicalGateResults[${index}]`;
      if (!isRecord(gate)) {
        issues.push(issue(gatePath, "INVALID_RECORD", `${gatePath} must be an object.`));
        return;
      }
      requireString(gate, "gate", gatePath, issues);
      if (!isNonEmptyString(gate.status) || !["PASS", "WARN", "FAIL", "REVIEW"].includes(gate.status)) {
        issues.push(issue(`${gatePath}.status`, "INVALID_ENUM", "physical gate status must be PASS, WARN, FAIL, or REVIEW."));
      }
    });
  }

  if (!Array.isArray(value.evidenceArtifacts)) {
    issues.push(issue(`${path}.evidenceArtifacts`, "INVALID_ARRAY", "evidenceArtifacts must be an array."));
  } else {
    value.evidenceArtifacts.forEach((artifact, index) => {
      validateEvidenceArtifactRef(artifact, `${path}.evidenceArtifacts[${index}]`, issues);
    });
  }

  return validationResult(issues);
}

export function validateCardToStageTransformInput(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "transform";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "CardToStageTransformInput must be an object.")]);
  }

  requireString(value, "calibrationSnapshotId", path, issues);

  if (!isNonEmptyString(value.side) || !CAPTURE_SIDE_VALUES.has(value.side)) {
    issues.push(issue(`${path}.side`, "INVALID_ENUM", "side must be FRONT or BACK."));
  }
  if (value.transformType !== "AFFINE" && value.transformType !== "HOMOGRAPHY") {
    issues.push(issue(`${path}.transformType`, "INVALID_ENUM", "transformType must be AFFINE or HOMOGRAPHY."));
  }
  if (!hasValidTimestamp(value.validAt)) {
    issues.push(issue(`${path}.validAt`, "INVALID_TIMESTAMP", "validAt must be a valid timestamp string."));
  }
  if (value.expiresAt != null && !hasValidTimestamp(value.expiresAt)) {
    issues.push(issue(`${path}.expiresAt`, "INVALID_TIMESTAMP", "expiresAt must be a valid timestamp string."));
  }
  if (
    hasValidTimestamp(value.validAt) &&
    hasValidTimestamp(value.expiresAt) &&
    Date.parse(String(value.expiresAt)) <= Date.parse(String(value.validAt))
  ) {
    issues.push(issue(`${path}.expiresAt`, "INVALID_TIMESTAMP", "expiresAt must be later than validAt."));
  }
  if (value.holderFiducialsVisible !== true) {
    issues.push(issue(`${path}.holderFiducialsVisible`, "INVALID_TRANSFORM", "holder fiducials must be visible."));
  }
  if (value.acroHomeEstablished !== true) {
    issues.push(issue(`${path}.acroHomeEstablished`, "INVALID_TRANSFORM", "ACRO home must be established."));
  }
  const fiducialPointCount = value.fiducialPointCount;
  if (typeof fiducialPointCount !== "number" || !Number.isInteger(fiducialPointCount) || fiducialPointCount < 4) {
    issues.push(issue(`${path}.fiducialPointCount`, "INVALID_TRANSFORM", "at least 4 fiducial points are required."));
  }
  if (!isFiniteNumber(value.rmsResidualMicrons) || value.rmsResidualMicrons < 0 || value.rmsResidualMicrons > 50) {
    issues.push(issue(`${path}.rmsResidualMicrons`, "INVALID_TRANSFORM", "RMS residual must be 0-50 microns."));
  }
  if (value.side === "BACK" && value.backSideOrientationCorrectionStored !== true) {
    issues.push(issue(`${path}.backSideOrientationCorrectionStored`, "INVALID_TRANSFORM", "back-side orientation correction must be stored."));
  }

  if (!isRecord(value.cardPointMm)) {
    issues.push(issue(`${path}.cardPointMm`, "INVALID_RECORD", "cardPointMm must be an object."));
  } else {
    const cardPointMm = value.cardPointMm;
    ["x", "y"].forEach((field) => {
      if (!isFiniteNumber(cardPointMm[field])) {
        issues.push(issue(`${path}.cardPointMm.${field}`, "INVALID_NUMBER", `${field} must be a finite number.`));
      }
    });
  }

  if (value.stageTargetMicrons != null) {
    if (!isRecord(value.stageTargetMicrons)) {
      issues.push(issue(`${path}.stageTargetMicrons`, "INVALID_RECORD", "stageTargetMicrons must be an object when provided."));
    } else {
      const stageTargetMicrons = value.stageTargetMicrons;
      ["x", "y"].forEach((field) => {
        if (!isFiniteNumber(stageTargetMicrons[field])) {
          issues.push(issue(`${path}.stageTargetMicrons.${field}`, "INVALID_NUMBER", `${field} must be a finite number.`));
        }
      });
    }
  }

  if (value.safeTravelBoundsMicrons != null) {
    if (!isRecord(value.safeTravelBoundsMicrons)) {
      issues.push(issue(`${path}.safeTravelBoundsMicrons`, "INVALID_RECORD", "safeTravelBoundsMicrons must be an object when provided."));
    } else {
      const safeTravelBoundsMicrons = value.safeTravelBoundsMicrons;
      ["minX", "maxX", "minY", "maxY"].forEach((field) => {
        if (!isFiniteNumber(safeTravelBoundsMicrons[field])) {
          issues.push(issue(`${path}.safeTravelBoundsMicrons.${field}`, "INVALID_NUMBER", `${field} must be a finite number.`));
        }
      });
      if (
        isFiniteNumber(safeTravelBoundsMicrons.minX) &&
        isFiniteNumber(safeTravelBoundsMicrons.maxX) &&
        safeTravelBoundsMicrons.minX >= safeTravelBoundsMicrons.maxX
      ) {
        issues.push(issue(`${path}.safeTravelBoundsMicrons.maxX`, "INVALID_TRANSFORM", "maxX must be greater than minX."));
      }
      if (
        isFiniteNumber(safeTravelBoundsMicrons.minY) &&
        isFiniteNumber(safeTravelBoundsMicrons.maxY) &&
        safeTravelBoundsMicrons.minY >= safeTravelBoundsMicrons.maxY
      ) {
        issues.push(issue(`${path}.safeTravelBoundsMicrons.maxY`, "INVALID_TRANSFORM", "maxY must be greater than minY."));
      }
    }
  }

  if (isRecord(value.stageTargetMicrons) && isRecord(value.safeTravelBoundsMicrons)) {
    const x = value.stageTargetMicrons.x;
    const y = value.stageTargetMicrons.y;
    const bounds = value.safeTravelBoundsMicrons;
    if (
      isFiniteNumber(x) &&
      isFiniteNumber(bounds.minX) &&
      isFiniteNumber(bounds.maxX) &&
      (x < bounds.minX || x > bounds.maxX)
    ) {
      issues.push(issue(`${path}.stageTargetMicrons.x`, "INVALID_TRANSFORM", "stage target x is outside safe travel bounds."));
    }
    if (
      isFiniteNumber(y) &&
      isFiniteNumber(bounds.minY) &&
      isFiniteNumber(bounds.maxY) &&
      (y < bounds.minY || y > bounds.maxY)
    ) {
      issues.push(issue(`${path}.stageTargetMicrons.y`, "INVALID_TRANSFORM", "stage target y is outside safe travel bounds."));
    }
  }

  return validationResult(issues);
}

export function buildMicroSpotPackageId(input: BuildMicroSpotPackageIdInput): string {
  const base = [
    "micro-spot",
    input.sessionId.trim(),
    input.side,
    input.element,
    String(input.spotIndex),
  ];
  if (isNonEmptyString(input.sourceSuspectRegionId)) {
    base.push(input.sourceSuspectRegionId.trim());
  }
  return base.join(":");
}

export function validateMicroSpotCaptureFrames(value: unknown): AiGraderValidationResult {
  return validationResult(validateMicroSpotCaptureFramesInternal(value, "frames"));
}

export function validateMicroSpotCapturePackage(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "microPackage";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "MicroSpotCapturePackage must be an object.")]);
  }

  ["id", "sessionId", "captureManifestId"].forEach((field) => requireString(value, field, path, issues));

  if (!isNonEmptyString(value.side) || !CAPTURE_SIDE_VALUES.has(value.side)) {
    issues.push(issue(`${path}.side`, "INVALID_ENUM", "side must be FRONT or BACK."));
  }

  if (!isNonEmptyString(value.element) || !MICRO_SPOT_ELEMENT_VALUES.has(value.element)) {
    issues.push(issue(`${path}.element`, "INVALID_ENUM", "element must be CORNERS, EDGES, SURFACE, or CMYK_AUTHENTICATION."));
  }

  if (!isPositiveInteger(value.spotIndex)) {
    issues.push(issue(`${path}.spotIndex`, "INVALID_MICRO_PACKAGE", "spotIndex must be a positive integer."));
  }
  if (!isPositiveInteger(value.totalSpots)) {
    issues.push(issue(`${path}.totalSpots`, "INVALID_MICRO_PACKAGE", "totalSpots must be a positive integer."));
  }
  if (isPositiveInteger(value.spotIndex) && isPositiveInteger(value.totalSpots) && value.spotIndex > value.totalSpots) {
    issues.push(issue(`${path}.spotIndex`, "INVALID_MICRO_PACKAGE", "spotIndex must be less than or equal to totalSpots."));
  }

  if (value.element === "SURFACE") {
    if (!isNonEmptyString(value.sourceSuspectRegionId)) {
      issues.push(issue(`${path}.sourceSuspectRegionId`, "MODE_MISSING_SURFACE_REGION", "SURFACE packages must link to a source suspect region."));
    }
  } else if (value.sourceSuspectRegionId != null) {
    issues.push(issue(`${path}.sourceSuspectRegionId`, "INVALID_MICRO_PACKAGE", "non-surface packages must not link to a source suspect region."));
  }

  ["stageXMicrons", "stageYMicrons", "amrReading"].forEach((field) => {
    if (!isFiniteNumber(value[field])) {
      issues.push(issue(`${path}.${field}`, "INVALID_NUMBER", `${field} must be a finite number.`));
    }
  });
  if (!isFiniteNumber(value.microMagnification) || value.microMagnification <= 0) {
    issues.push(issue(`${path}.microMagnification`, "INVALID_NUMBER", "microMagnification must be a positive finite number."));
  }
  if (!isFiniteNumber(value.focusScore) || value.focusScore < 0) {
    issues.push(issue(`${path}.focusScore`, "INVALID_NUMBER", "focusScore must be a non-negative finite number."));
  }
  if (!hasValidTimestamp(value.capturedAt)) {
    issues.push(issue(`${path}.capturedAt`, "INVALID_TIMESTAMP", "capturedAt must be a valid timestamp string."));
  }
  if (typeof value.validForClassification !== "boolean") {
    issues.push(issue(`${path}.validForClassification`, "INVALID_TYPE", "validForClassification must be a boolean."));
  }

  const frameIssues = validateMicroSpotCaptureFramesInternal(value.frames, `${path}.frames`);
  issues.push(...frameIssues);

  const missingFlcFrames = missingMicroSpotFrameKeys(value.frames).filter((frameKey) =>
    REQUIRED_FLC_FRAME_KEYS.some((requiredFrameKey) => requiredFrameKey === frameKey)
  );
  if (missingFlcFrames.length > 0 && value.validForClassification === true) {
    issues.push(issue(`${path}.validForClassification`, "MICRO_EVIDENCE_INCOMPLETE", "missing FLC frames cannot be marked valid for classification."));
  }

  return validationResult(issues);
}

export function buildStandardSpotPlan(input: BuildStandardSpotPlanInput): StandardSpotPlan {
  const surfaceTopN = input.surfaceTopN ?? DEFAULT_STANDARD_SURFACE_TOP_N;
  const threshold = input.threshold ?? DEFAULT_SURFACE_SUSPECT_THRESHOLD;
  const surfaceSuspects = sortAndSelectStandardSurfaceSuspects(input.surfaceSuspects ?? [], {
    side: input.side,
    threshold,
    topN: surfaceTopN,
  });

  const cornerSpots: StandardSpotPlanSpot[] = STANDARD_CORNER_SPOT_LABELS.map((label, index) => ({
    id: buildMicroSpotPackageId({
      sessionId: input.sessionId,
      side: input.side,
      element: "CORNERS",
      spotIndex: index + 1,
    }),
    sessionId: input.sessionId,
    side: input.side,
    element: "CORNERS",
    label,
    spotIndex: index + 1,
    totalSpots: STANDARD_CORNERS_PER_SIDE,
  }));

  const edgeSpots: StandardSpotPlanSpot[] = STANDARD_EDGE_SPOT_LABELS.map((label, index) => ({
    id: buildMicroSpotPackageId({
      sessionId: input.sessionId,
      side: input.side,
      element: "EDGES",
      spotIndex: index + 1,
    }),
    sessionId: input.sessionId,
    side: input.side,
    element: "EDGES",
    label,
    spotIndex: index + 1,
    totalSpots: STANDARD_EDGES_PER_SIDE,
  }));

  const surfaceSpots: StandardSpotPlanSpot[] = surfaceSuspects.map((suspect, index) => ({
    id: buildMicroSpotPackageId({
      sessionId: input.sessionId,
      side: input.side,
      element: "SURFACE",
      spotIndex: index + 1,
      sourceSuspectRegionId: suspect.id,
    }),
    sessionId: input.sessionId,
    side: input.side,
    element: "SURFACE",
    label: `SURFACE_${index + 1}`,
    spotIndex: index + 1,
    totalSpots: surfaceSuspects.length,
    sourceSuspectRegionId: suspect.id,
  }));

  return {
    sessionId: input.sessionId,
    side: input.side,
    surfaceSuspectThreshold: threshold,
    surfaceTopN,
    spots: [...cornerSpots, ...edgeSpots, ...surfaceSpots],
  };
}

function validateStandardSpotPlanSpot(
  spot: unknown,
  path: string,
  plan: Record<string, unknown>,
  issues: AiGraderValidationIssue[]
) {
  if (!isRecord(spot)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be a spot plan object.`));
    return;
  }

  ["id", "sessionId", "label"].forEach((field) => requireString(spot, field, path, issues));
  if (spot.sessionId !== plan.sessionId) {
    issues.push(issue(`${path}.sessionId`, "INVALID_SPOT_PLAN", "spot sessionId must match plan sessionId."));
  }
  if (!isNonEmptyString(spot.side) || !CAPTURE_SIDE_VALUES.has(spot.side)) {
    issues.push(issue(`${path}.side`, "INVALID_ENUM", "spot side must be FRONT or BACK."));
  } else if (spot.side !== plan.side) {
    issues.push(issue(`${path}.side`, "INVALID_SPOT_PLAN", "spot side must match plan side."));
  }
  if (!isNonEmptyString(spot.element) || !STANDARD_SPOT_PLAN_ELEMENT_VALUES.has(spot.element)) {
    issues.push(issue(`${path}.element`, "INVALID_ENUM", "STANDARD spot plan element must be CORNERS, EDGES, or SURFACE."));
  }
  if (!isPositiveInteger(spot.spotIndex)) {
    issues.push(issue(`${path}.spotIndex`, "INVALID_SPOT_PLAN", "spotIndex must be a positive integer."));
  }
  if (!isPositiveInteger(spot.totalSpots)) {
    issues.push(issue(`${path}.totalSpots`, "INVALID_SPOT_PLAN", "totalSpots must be a positive integer."));
  }
  if (isPositiveInteger(spot.spotIndex) && isPositiveInteger(spot.totalSpots) && spot.spotIndex > spot.totalSpots) {
    issues.push(issue(`${path}.spotIndex`, "INVALID_SPOT_PLAN", "spotIndex must be less than or equal to totalSpots."));
  }
  if (spot.element === "SURFACE") {
    if (!isNonEmptyString(spot.sourceSuspectRegionId)) {
      issues.push(issue(`${path}.sourceSuspectRegionId`, "MODE_MISSING_SURFACE_REGION", "surface plan spots must link to a source suspect region."));
    }
  } else if (spot.sourceSuspectRegionId != null) {
    issues.push(issue(`${path}.sourceSuspectRegionId`, "INVALID_SPOT_PLAN", "corner and edge plan spots must not link to a source suspect region."));
  }
}

export function validateStandardSpotPlan(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "standardSpotPlan";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "StandardSpotPlan must be an object.")]);
  }

  requireString(value, "sessionId", path, issues);
  if (!isNonEmptyString(value.side) || !CAPTURE_SIDE_VALUES.has(value.side)) {
    issues.push(issue(`${path}.side`, "INVALID_ENUM", "side must be FRONT or BACK."));
  }
  if (!isFiniteNumber(value.surfaceSuspectThreshold) || value.surfaceSuspectThreshold < 0 || value.surfaceSuspectThreshold > 1) {
    issues.push(issue(`${path}.surfaceSuspectThreshold`, "INVALID_SCORE", "surfaceSuspectThreshold must be 0-1."));
  }
  if (!Number.isInteger(value.surfaceTopN) || !isFiniteNumber(value.surfaceTopN) || value.surfaceTopN < 0 || value.surfaceTopN > DEFAULT_STANDARD_SURFACE_TOP_N) {
    issues.push(issue(`${path}.surfaceTopN`, "INVALID_SPOT_PLAN", "surfaceTopN must be an integer from 0 to 3."));
  }

  if (!Array.isArray(value.spots)) {
    issues.push(issue(`${path}.spots`, "INVALID_ARRAY", "spots must be an array."));
    return validationResult(issues);
  }

  value.spots.forEach((spot, index) => validateStandardSpotPlanSpot(spot, `${path}.spots[${index}]`, value, issues));

  const typedSpots = value.spots.filter(isRecord);
  const cornerSpots = typedSpots.filter((spot) => spot.element === "CORNERS" && spot.side === value.side);
  const edgeSpots = typedSpots.filter((spot) => spot.element === "EDGES" && spot.side === value.side);
  const surfaceSpots = typedSpots.filter((spot) => spot.element === "SURFACE" && spot.side === value.side);

  if (cornerSpots.length !== STANDARD_CORNERS_PER_SIDE || edgeSpots.length !== STANDARD_EDGES_PER_SIDE) {
    issues.push(issue(`${path}.spots`, "MODE_MISSING_MICRO_SPOTS", "STANDARD spot plan must include 4 corner and 4 edge spots per side."));
  }
  if (surfaceSpots.length > DEFAULT_STANDARD_SURFACE_TOP_N || surfaceSpots.length > Number(value.surfaceTopN)) {
    issues.push(issue(`${path}.spots`, "MODE_TOO_MANY_SURFACE_SPOTS", "STANDARD spot plan allows at most 3 routed surface suspect spots per side."));
  }

  [
    { element: "CORNERS", expectedTotal: STANDARD_CORNERS_PER_SIDE, spots: cornerSpots },
    { element: "EDGES", expectedTotal: STANDARD_EDGES_PER_SIDE, spots: edgeSpots },
    { element: "SURFACE", expectedTotal: surfaceSpots.length, spots: surfaceSpots },
  ].forEach(({ element, expectedTotal, spots }) => {
    const seen = new Set<number>();
    spots.forEach((spot) => {
      if (spot.totalSpots !== expectedTotal) {
        issues.push(issue(`${path}.spots.${element}.totalSpots`, "INVALID_SPOT_PLAN", `${element} totalSpots must match the planned spot count.`));
      }
      if (typeof spot.spotIndex === "number") {
        seen.add(spot.spotIndex);
      }
    });
    for (let index = 1; index <= expectedTotal; index += 1) {
      if (!seen.has(index)) {
        issues.push(issue(`${path}.spots.${element}.spotIndex`, "INVALID_SPOT_PLAN", `${element} spot indexes must be contiguous from 1 to ${expectedTotal}.`));
        break;
      }
    }
  });

  return validationResult(issues);
}

export function validateMicroPackageForFusion(
  value: unknown,
  options: MicroPackageFusionValidationOptions = {}
): AiGraderValidationResult {
  const issues = [...validateMicroSpotCapturePackage(value).issues];
  const path = "microPackage";

  if (!isRecord(value)) {
    return validationResult(issues);
  }

  const allowedElements = options.allowedElements ?? STANDARD_SPOT_PLAN_ELEMENTS;
  if (!isNonEmptyString(value.element) || !allowedElements.includes(value.element as MicroSpotElement)) {
    issues.push(issue(`${path}.element`, "INVALID_ENUM", "package element is not allowed for this fusion context."));
  }
  if (value.validForClassification !== true) {
    issues.push(issue(`${path}.validForClassification`, "MICRO_EVIDENCE_INCOMPLETE", "incomplete micro evidence must be reviewed and cannot enter fusion as clean evidence."));
  }
  if (isNonEmptyString(options.sessionId) && value.sessionId !== options.sessionId) {
    issues.push(issue(`${path}.sessionId`, "INVALID_MICRO_PACKAGE", "package sessionId does not match the fusion context."));
  }
  if (isNonEmptyString(options.captureManifestId) && value.captureManifestId !== options.captureManifestId) {
    issues.push(issue(`${path}.captureManifestId`, "INVALID_MICRO_PACKAGE", "package captureManifestId does not match the fusion context."));
  }
  if (isNonEmptyString(options.side) && value.side !== options.side) {
    issues.push(issue(`${path}.side`, "INVALID_MICRO_PACKAGE", "package side does not match the fusion context."));
  }
  if (
    Array.isArray(options.sourceSuspectRegionIds) &&
    value.element === "SURFACE" &&
    isNonEmptyString(value.sourceSuspectRegionId) &&
    !options.sourceSuspectRegionIds.includes(value.sourceSuspectRegionId)
  ) {
    issues.push(issue(`${path}.sourceSuspectRegionId`, "MODE_MISSING_SURFACE_REGION", "surface package source suspect region is not part of the routed plan."));
  }

  return validationResult(issues);
}

export function buildFusionAction(input: BuildFusionActionInput): FusionAction {
  const action: FusionAction = {
    action: input.action,
    element: input.element,
    side: input.side,
    spotPackageId: input.spotPackageId.trim(),
    macroMeasurement: { ...input.macroMeasurement },
    microMeasurement: { ...input.microMeasurement },
    gradeBefore: input.gradeBefore,
    gradeAfter: input.gradeAfter,
    algorithmVersionId: input.algorithmVersionId.trim(),
    thresholdSetVersionId: input.thresholdSetVersionId.trim(),
    reasonCodes: [...input.reasonCodes],
  };

  if (isNonEmptyString(input.regionId)) {
    action.regionId = input.regionId.trim();
  }

  return action;
}

export function validateFusionAction(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "fusionAction";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "FusionAction must be an object.")]);
  }

  if (!isNonEmptyString(value.action) || !FUSION_ACTION_TYPE_VALUES.has(value.action)) {
    issues.push(issue(`${path}.action`, "INVALID_ENUM", "action must be LOWER, HOLD, DUST_CORRECT, or WARNING_ONLY."));
  }
  if (!isNonEmptyString(value.element) || !STANDARD_SPOT_PLAN_ELEMENT_VALUES.has(value.element)) {
    issues.push(issue(`${path}.element`, "INVALID_ENUM", "STANDARD fusion actions may target only CORNERS, EDGES, or SURFACE."));
  }
  if (!isNonEmptyString(value.side) || !CAPTURE_SIDE_VALUES.has(value.side)) {
    issues.push(issue(`${path}.side`, "INVALID_ENUM", "side must be FRONT or BACK."));
  }

  ["spotPackageId", "algorithmVersionId", "thresholdSetVersionId"].forEach((field) => requireString(value, field, path, issues));
  requireStringArray(value.reasonCodes, `${path}.reasonCodes`, issues);
  validateUnknownRecordPresent(value.macroMeasurement, `${path}.macroMeasurement`, issues);
  validateUnknownRecordPresent(value.microMeasurement, `${path}.microMeasurement`, issues);

  if (!isContractGradeScore(value.gradeBefore)) {
    issues.push(issue(`${path}.gradeBefore`, "INVALID_SCORE", "gradeBefore must be from 1.00 through 10.00 with at most two decimal places."));
  }
  if (!isContractGradeScore(value.gradeAfter)) {
    issues.push(issue(`${path}.gradeAfter`, "INVALID_SCORE", "gradeAfter must be from 1.00 through 10.00 with at most two decimal places."));
  }

  if (value.regionId != null && !isNonEmptyString(value.regionId)) {
    issues.push(issue(`${path}.regionId`, "REQUIRED", "regionId must be non-empty when provided."));
  }
  if ((value.element === "SURFACE" || value.action === "DUST_CORRECT") && !isNonEmptyString(value.regionId)) {
    issues.push(issue(`${path}.regionId`, "INVALID_FUSION_ACTION", "surface and dust-correction actions must record the inspected regionId."));
  }
  if (value.action === "LOWER" && isFiniteNumber(value.gradeBefore) && isFiniteNumber(value.gradeAfter) && value.gradeAfter > value.gradeBefore) {
    issues.push(issue(`${path}.gradeAfter`, "INVALID_FUSION_ACTION", "LOWER actions may lower or hold, but must not raise the grade."));
  }
  if (value.action === "HOLD" && isFiniteNumber(value.gradeBefore) && isFiniteNumber(value.gradeAfter) && value.gradeAfter !== value.gradeBefore) {
    issues.push(issue(`${path}.gradeAfter`, "INVALID_FUSION_ACTION", "HOLD actions must leave the grade unchanged."));
  }
  if (value.action === "WARNING_ONLY" && isFiniteNumber(value.gradeBefore) && isFiniteNumber(value.gradeAfter) && value.gradeAfter !== value.gradeBefore) {
    issues.push(issue(`${path}.gradeAfter`, "INVALID_FUSION_ACTION", "WARNING_ONLY actions must not change grades."));
  }

  issues.push(...validateDustCorrectionBounds({ action: value as unknown as FusionAction }).issues);

  return validationResult(issues);
}

export function validateCenteringIgnoresMicroEvidence(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];

  if (!isRecord(value)) {
    return validationResult([issue("centering", "INVALID_RECORD", "Input must be an object.")]);
  }

  if (isRecord(value.centeringMeasurement) && centeringReferencesMicroscopeEvidence(value.centeringMeasurement)) {
    issues.push(issue("centeringMeasurement", "CENTERING_USES_MICROSCOPE_EVIDENCE", "Centering must not reference microscope evidence."));
  }

  if (isRecord(value.macroOutput) && isRecord(value.macroOutput.centeringMeasurement) && centeringReferencesMicroscopeEvidence(value.macroOutput.centeringMeasurement)) {
    issues.push(issue("macroOutput.centeringMeasurement", "CENTERING_USES_MICROSCOPE_EVIDENCE", "Centering must not reference microscope evidence."));
  }

  validateFusionActionsIgnoreCentering(value.fusionActions, "fusionActions", issues);
  if (isRecord(value.gradeRunDraft)) {
    validateFusionActionsIgnoreCentering(value.gradeRunDraft.fusionActions, "gradeRunDraft.fusionActions", issues);
  }

  return validationResult(issues);
}

export function validateStandardFusionScope(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "fusionScope";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "StandardFusionScopeValidationInput must be an object.")]);
  }

  const action = value.action;
  const microPackages = Array.isArray(value.microPackages) ? value.microPackages.filter(isRecord) : [];
  if (!Array.isArray(value.microPackages)) {
    issues.push(issue(`${path}.microPackages`, "INVALID_ARRAY", "microPackages must be an array."));
  }
  issues.push(...validateFusionAction(action).issues.map((entry) => ({ ...entry, path: `${path}.${entry.path}` })));

  if (!isRecord(action)) {
    return validationResult(issues);
  }

  const packageMatch = microPackages.find((entry) => entry.id === action.spotPackageId);
  if (!packageMatch) {
    issues.push(issue(`${path}.action.spotPackageId`, "INVALID_FUSION_SCOPE", "fusion action must link to an inspected micro spot package."));
    return validationResult(issues);
  }

  if (packageMatch.validForClassification !== true) {
    issues.push(issue(`${path}.microPackages.${String(packageMatch.id)}.validForClassification`, "MICRO_EVIDENCE_INCOMPLETE", "fusion cannot consume incomplete micro evidence as clean evidence."));
  }
  if (packageMatch.element !== action.element) {
    issues.push(issue(`${path}.action.element`, "INVALID_FUSION_SCOPE", "fusion action element must match the inspected micro package element."));
  }
  if (packageMatch.side !== action.side) {
    issues.push(issue(`${path}.action.side`, "INVALID_FUSION_SCOPE", "fusion action side must match the inspected micro package side."));
  }

  if (action.element === "SURFACE") {
    if (!isNonEmptyString(packageMatch.sourceSuspectRegionId) || packageMatch.sourceSuspectRegionId !== action.regionId) {
      issues.push(issue(`${path}.action.regionId`, "INVALID_FUSION_SCOPE", "surface fusion may affect only the inspected source suspect region."));
    }
    if (isRecord(value.macroOutput)) {
      const suspectIds = Array.isArray(value.macroOutput.suspectRegions)
        ? value.macroOutput.suspectRegions.filter(isRecord).map((suspect) => suspect.id)
        : [];
      if (!suspectIds.includes(action.regionId)) {
        issues.push(issue(`${path}.action.regionId`, "INVALID_FUSION_SCOPE", "surface fusion regionId must exist in macro suspect regions."));
      }
    }
  } else if (action.regionId != null && isRecord(value.standardSpotPlan)) {
    const visitedRegionIds = Array.isArray(value.standardSpotPlan.spots)
      ? value.standardSpotPlan.spots
          .filter(isRecord)
          .map((spot) => spot.id)
          .concat(value.standardSpotPlan.spots.filter(isRecord).map((spot) => spot.label).filter(isNonEmptyString))
      : [];
    if (!visitedRegionIds.includes(action.regionId)) {
      issues.push(issue(`${path}.action.regionId`, "INVALID_FUSION_SCOPE", "corner/edge fusion regionId must be in the inspected spot plan when provided."));
    }
  }

  return validationResult(issues);
}

export function validateDustCorrectionBounds(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "dustCorrection";

  if (!isRecord(value) || !isRecord(value.action)) {
    return validationResult([issue(path, "INVALID_RECORD", "DustCorrectionBoundsInput must include an action object.")]);
  }

  const action = value.action;
  const excessiveDustBurden =
    value.excessiveDustBurden === true ||
    recordBoolean(action.microMeasurement, ["excessiveDustBurden", "excessiveDust", "broadDustBurden"]) === true ||
    recordBoolean(action.macroMeasurement, ["excessiveDustBurden", "excessiveDust", "broadDustBurden"]) === true;

  if (excessiveDustBurden) {
    if (action.action === "DUST_CORRECT") {
      issues.push(issue(`${path}.action`, "INVALID_DUST_CORRECTION", "excessive dust burden requires warning/review, not broad dust correction."));
    }
    if (action.action === "WARNING_ONLY" && isFiniteNumber(action.gradeBefore) && isFiniteNumber(action.gradeAfter) && action.gradeAfter !== action.gradeBefore) {
      issues.push(issue(`${path}.gradeAfter`, "INVALID_DUST_CORRECTION", "excessive dust warning actions must not change grades."));
    }
  }

  if (action.action !== "DUST_CORRECT") {
    return validationResult(issues);
  }

  if (action.element !== "SURFACE") {
    issues.push(issue(`${path}.element`, "INVALID_DUST_CORRECTION", "DUST_CORRECT actions must be scoped to a surface suspect region."));
  }
  if (!isNonEmptyString(action.regionId)) {
    issues.push(issue(`${path}.regionId`, "INVALID_DUST_CORRECTION", "DUST_CORRECT actions must record the overlapping macro suspect region."));
  }
  if (isFiniteNumber(action.gradeBefore) && isFiniteNumber(action.gradeAfter) && action.gradeAfter < action.gradeBefore) {
    issues.push(issue(`${path}.gradeAfter`, "INVALID_DUST_CORRECTION", "DUST_CORRECT actions must not lower the grade."));
  }

  const overlapConfirmed =
    recordBoolean(action.microMeasurement, ["directlyOverlapsMacroSuspectRegion", "overlapsMacroSuspectRegion", "dustDirectlyOverlapsRegion"]) === true ||
    recordString(action.microMeasurement, ["overlappingRegionId", "overlappedRegionId", "sourceSuspectRegionId"]) === action.regionId;
  if (!overlapConfirmed) {
    issues.push(issue(`${path}.microMeasurement`, "INVALID_DUST_CORRECTION", "dust correction requires micro evidence directly overlapping the macro suspect region."));
  }

  const recomputedBound = isFiniteNumber(value.recomputedMacroGradeWithoutInspectedContamination)
    ? value.recomputedMacroGradeWithoutInspectedContamination
    : finiteRecordNumber(action.macroMeasurement, [
        "recomputedMacroGradeWithoutInspectedContamination",
        "macroGradeWithInspectedContaminationExcluded",
        "maxGradeAfterDustCorrection",
      ]);
  if (!isFiniteNumber(recomputedBound)) {
    issues.push(issue(`${path}.recomputedMacroGradeWithoutInspectedContamination`, "REQUIRED", "dust correction must record the recomputed macro grade bound."));
  } else if (isFiniteNumber(action.gradeAfter) && action.gradeAfter > recomputedBound) {
    issues.push(issue(`${path}.gradeAfter`, "INVALID_DUST_CORRECTION", "dust correction must not exceed the recomputed macro grade with inspected contamination excluded."));
  }

  return validationResult(issues);
}

export function validateStandardFusionInput(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "standardFusionInput";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "StandardFusionInput must be an object.")]);
  }

  ["algorithmVersionId", "thresholdSetVersionId", "runtimeEnvironmentId"].forEach((field) => requireString(value, field, path, issues));

  const macroResult = validateMacroPipelineOutput(value.macroOutput);
  issues.push(...macroResult.issues.map((entry) => ({ ...entry, path: `${path}.${entry.path}` })));
  const captureResult = validateCaptureManifest(value.captureManifest);
  issues.push(...captureResult.issues.map((entry) => ({ ...entry, path: `${path}.${entry.path}` })));
  const centeringResult = validateCenteringIgnoresMicroEvidence(value);
  issues.push(...centeringResult.issues.map((entry) => ({ ...entry, path: `${path}.${entry.path}` })));

  if (isRecord(value.macroOutput)) {
    if (value.macroOutput.algorithmVersionId !== value.algorithmVersionId) {
      issues.push(issue(`${path}.algorithmVersionId`, "INVALID_FUSION_SCOPE", "algorithmVersionId must match the macro output provenance."));
    }
    if (value.macroOutput.thresholdSetVersionId !== value.thresholdSetVersionId) {
      issues.push(issue(`${path}.thresholdSetVersionId`, "INVALID_FUSION_SCOPE", "thresholdSetVersionId must match the macro output provenance."));
    }
    if (isRecord(value.captureManifest) && value.macroOutput.captureManifestId !== value.captureManifest.id) {
      issues.push(issue(`${path}.captureManifest.id`, "INVALID_FUSION_SCOPE", "captureManifest must match macroOutput.captureManifestId."));
    }
  }

  if (!Array.isArray(value.microPackages)) {
    issues.push(issue(`${path}.microPackages`, "INVALID_ARRAY", "microPackages must be an array."));
  } else {
    const sourceSuspectRegionIds =
      isRecord(value.macroOutput) && Array.isArray(value.macroOutput.suspectRegions)
        ? value.macroOutput.suspectRegions.filter(isRecord).map((suspect) => String(suspect.id))
        : [];
    value.microPackages.forEach((microPackage, index) => {
      const result = validateMicroPackageForFusion(microPackage, {
        sessionId: isRecord(value.macroOutput) && isNonEmptyString(value.macroOutput.sessionId) ? value.macroOutput.sessionId : undefined,
        captureManifestId: isRecord(value.captureManifest) && isNonEmptyString(value.captureManifest.id) ? value.captureManifest.id : undefined,
        side: isRecord(value.macroOutput) && isNonEmptyString(value.macroOutput.side) && CAPTURE_SIDE_VALUES.has(value.macroOutput.side) ? (value.macroOutput.side as CaptureSide) : undefined,
        sourceSuspectRegionIds,
      });
      issues.push(...result.issues.map((entry) => ({ ...entry, path: `${path}.microPackages[${index}].${entry.path}` })));
    });
  }

  return validationResult(issues);
}

export function validateStandardFusionOutput(
  value: unknown,
  options: StandardFusionOutputValidationOptions = {}
): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "standardFusionOutput";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "StandardFusionOutput must be an object.")]);
  }
  if (!isRecord(value.gradeRunDraft)) {
    return validationResult([issue(`${path}.gradeRunDraft`, "INVALID_RECORD", "gradeRunDraft must be an object.")]);
  }

  const draft = value.gradeRunDraft;
  validateUnknownRecordPresent(draft.macroMeasurements, `${path}.gradeRunDraft.macroMeasurements`, issues);
  validateUnknownRecordPresent(draft.microMeasurements, `${path}.gradeRunDraft.microMeasurements`, issues);
  requireStringArray(draft.warnings, `${path}.gradeRunDraft.warnings`, issues, { allowEmpty: true });

  if (!isRecord(draft.finalGrades)) {
    issues.push(issue(`${path}.gradeRunDraft.finalGrades`, "INVALID_RECORD", "finalGrades must be an object."));
  } else {
    validateContractGradeRecord(
      draft.finalGrades,
      `${path}.gradeRunDraft.finalGrades`,
      issues,
    );
  }

  if (!Array.isArray(draft.fusionActions)) {
    issues.push(issue(`${path}.gradeRunDraft.fusionActions`, "INVALID_ARRAY", "fusionActions must be an array."));
  } else {
    draft.fusionActions.forEach((action, index) => {
      const actionResult = validateFusionAction(action);
      issues.push(...actionResult.issues.map((entry) => ({ ...entry, path: `${path}.gradeRunDraft.fusionActions[${index}].${entry.path}` })));
      if (options.input) {
        const scopeResult = validateStandardFusionScope({
          action,
          microPackages: options.input.microPackages,
          macroOutput: options.input.macroOutput,
        });
        issues.push(...scopeResult.issues.map((entry) => ({ ...entry, path: `${path}.gradeRunDraft.fusionActions[${index}].${entry.path}` })));
      }
    });
  }

  const centeringResult = validateCenteringIgnoresMicroEvidence(value);
  issues.push(...centeringResult.issues.map((entry) => ({ ...entry, path: `${path}.${entry.path}` })));

  return validationResult(issues);
}

function requireCalibrationMetric(
  residuals: unknown,
  fields: string[],
  path: string,
  issues: AiGraderValidationIssue[]
): number | undefined {
  const value = finiteRecordNumber(residuals, fields);
  if (!isFiniteNumber(value)) {
    issues.push(issue(path, "REQUIRED", `${path} is required for this calibration type.`));
    return undefined;
  }
  return value;
}

function validateCalibrationThresholds(value: Record<string, unknown>, path: string, issues: AiGraderValidationIssue[]) {
  const residuals = value.residuals;

  switch (value.calibrationType) {
    case "COLOR_CHECKER_CCM": {
      const meanDeltaE = requireCalibrationMetric(residuals, ["meanPatchDeltaE", "meanDeltaE"], `${path}.residuals.meanDeltaE`, issues);
      if (isFiniteNumber(meanDeltaE) && meanDeltaE > COLOR_CHECKER_MAX_MEAN_DELTA_E) {
        issues.push(issue(`${path}.residuals.meanDeltaE`, "INVALID_CALIBRATION", "ColorChecker mean DeltaE must be <= 2.0."));
      }
      break;
    }
    case "CARD_JIG_TRANSFORM": {
      const residual = requireCalibrationMetric(residuals, ["rmsResidualMicrons", "rmsResidualUm"], `${path}.residuals.rmsResidualMicrons`, issues);
      if (isFiniteNumber(residual) && residual > STAGE_TRANSFORM_MAX_RMS_RESIDUAL_MICRONS) {
        issues.push(issue(`${path}.residuals.rmsResidualMicrons`, "INVALID_CALIBRATION", "card-jig transform RMS residual must be <= 50 microns."));
      }
      break;
    }
    case "LED_INTENSITY_HEALTH": {
      const deviation = requireCalibrationMetric(
        residuals,
        ["maxChannelDeviationPercent", "ledChannelDeviationPercent", "channelDeviationPercent"],
        `${path}.residuals.maxChannelDeviationPercent`,
        issues
      );
      if (isFiniteNumber(deviation) && deviation > LED_MAX_CHANNEL_DEVIATION_PERCENT) {
        issues.push(issue(`${path}.residuals.maxChannelDeviationPercent`, "INVALID_CALIBRATION", "LED channel deviation must be <= 10%."));
      }
      break;
    }
    case "STAGE_HOME": {
      if (recordBoolean(residuals, ["homeSuccess"]) !== true) {
        issues.push(issue(`${path}.residuals.homeSuccess`, "INVALID_CALIBRATION", "ACRO home calibration must record homeSuccess=true."));
      }
      if (recordBoolean(residuals, ["positionReadable"]) !== true) {
        issues.push(issue(`${path}.residuals.positionReadable`, "INVALID_CALIBRATION", "ACRO home calibration must record positionReadable=true."));
      }
      break;
    }
    case "MICROSCOPE_PX_PER_MICRON": {
      const mismatch = requireCalibrationMetric(
        residuals,
        ["scaleMismatchPercent", "maxScaleMismatchPercent"],
        `${path}.residuals.scaleMismatchPercent`,
        issues
      );
      if (isFiniteNumber(mismatch) && mismatch > MICROSCOPE_SCALE_MAX_MISMATCH_PERCENT) {
        issues.push(issue(`${path}.residuals.scaleMismatchPercent`, "INVALID_CALIBRATION", "microscope scale mismatch must be <= 2%."));
      }
      break;
    }
    case "MICROSCOPE_FOCUS_BASELINE": {
      const drop = requireCalibrationMetric(
        residuals,
        ["focusScoreDropPercent", "maxFocusScoreDropPercent"],
        `${path}.residuals.focusScoreDropPercent`,
        issues
      );
      if (isFiniteNumber(drop) && drop > FOCUS_BASELINE_MAX_DROP_PERCENT) {
        issues.push(issue(`${path}.residuals.focusScoreDropPercent`, "INVALID_CALIBRATION", "focus baseline drop must be <= 15%."));
      }
      break;
    }
    case "ARM_INTERLOCK_HEALTH": {
      if (recordBoolean(residuals, ["interlockOperatorMismatch", "operatorMismatch"]) === true) {
        issues.push(issue(`${path}.residuals.interlockOperatorMismatch`, "ARM_POSITION_CONFLICT", "arm interlock calibration must not show operator/hardware mismatch."));
      }
      break;
    }
    default:
      break;
  }
}

export function validateCalibrationSnapshotContract(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "calibration";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "CalibrationSnapshotContract must be an object.")]);
  }

  ["id", "rigId", "validityStartsAt", "createdAt"].forEach((field) => requireString(value, field, path, issues));

  if (!isNonEmptyString(value.calibrationType) || !CALIBRATION_TYPE_VALUES.has(value.calibrationType)) {
    issues.push(issue(`${path}.calibrationType`, "INVALID_ENUM", "calibrationType must match the supported CalibrationType enum."));
  }
  validateStringRecord(value.componentSerials, `${path}.componentSerials`, issues);
  requireStringArray(value.artifactKeys, `${path}.artifactKeys`, issues);

  if (!Array.isArray(value.artifactChecksums)) {
    issues.push(issue(`${path}.artifactChecksums`, "INVALID_ARRAY", "artifactChecksums must be an array."));
  } else if (value.artifactChecksums.length === 0) {
    issues.push(issue(`${path}.artifactChecksums`, "EMPTY_ARRAY", "artifactChecksums must include at least one checksum."));
  } else {
    value.artifactChecksums.forEach((entry, index) => {
      if (!hasValidSha256(entry)) {
        issues.push(issue(`${path}.artifactChecksums[${index}]`, "INVALID_CHECKSUM", "artifact checksum must be a 64-character hex SHA-256 digest."));
      }
    });
  }

  if (value.residuals != null && !isRecord(value.residuals)) {
    issues.push(issue(`${path}.residuals`, "INVALID_RECORD", "residuals must be an object when provided."));
  }
  if (value.operatorId != null && !isNonEmptyString(value.operatorId)) {
    issues.push(issue(`${path}.operatorId`, "REQUIRED", "operatorId must be non-empty when provided."));
  }
  if (!hasValidTimestamp(value.validityStartsAt)) {
    issues.push(issue(`${path}.validityStartsAt`, "INVALID_TIMESTAMP", "validityStartsAt must be a valid timestamp string."));
  }
  if (!hasValidTimestamp(value.createdAt)) {
    issues.push(issue(`${path}.createdAt`, "INVALID_TIMESTAMP", "createdAt must be a valid timestamp string."));
  }
  if (value.validityEndsAt != null && !hasValidTimestamp(value.validityEndsAt)) {
    issues.push(issue(`${path}.validityEndsAt`, "INVALID_TIMESTAMP", "validityEndsAt must be a valid timestamp string when provided."));
  }
  if (
    hasValidTimestamp(value.validityStartsAt) &&
    hasValidTimestamp(value.validityEndsAt) &&
    Date.parse(String(value.validityEndsAt)) <= Date.parse(String(value.validityStartsAt))
  ) {
    issues.push(issue(`${path}.validityEndsAt`, "INVALID_TIMESTAMP", "validityEndsAt must be later than validityStartsAt."));
  }

  validateCalibrationThresholds(value, path, issues);

  return validationResult(issues);
}

export function validateCalibrationFreshness(
  value: unknown,
  options: CalibrationFreshnessOptions = {}
): AiGraderValidationResult {
  const issues = [...validateCalibrationSnapshotContract(value).issues];
  const path = "calibration";

  if (!isRecord(value)) {
    return validationResult(issues);
  }

  const asOfMs = timestampMillis(options.asOf) ?? Date.now();
  const startsAtMs = timestampMillis(value.validityStartsAt);
  const endsAtMs = timestampMillis(value.validityEndsAt);
  const createdAtMs = timestampMillis(value.createdAt);

  if (isFiniteNumber(startsAtMs) && startsAtMs > asOfMs) {
    issues.push(issue(`${path}.validityStartsAt`, "CALIBRATION_STALE", "calibration is not active yet."));
  }
  if (isFiniteNumber(endsAtMs) && endsAtMs <= asOfMs) {
    issues.push(issue(`${path}.validityEndsAt`, "CALIBRATION_EXPIRED", "expired calibration blocks certifiable GradeRun."));
  }
  if (isFiniteNumber(createdAtMs) && isFiniteNumber(options.maxAgeHours)) {
    const ageHours = (asOfMs - createdAtMs) / 3_600_000;
    if (ageHours > options.maxAgeHours) {
      issues.push(issue(`${path}.createdAt`, "CALIBRATION_STALE", "stale calibration blocks certifiable GradeRun."));
    }
  }
  if (
    isFiniteNumber(options.cardsSinceCalibration) &&
    isFiniteNumber(options.maxCardsSinceCalibration) &&
    options.cardsSinceCalibration > options.maxCardsSinceCalibration
  ) {
    issues.push(issue(`${path}.cardsSinceCalibration`, "CALIBRATION_STALE", "calibration card cadence has expired."));
  }

  return validationResult(issues);
}

export function validateRequiredCalibrationSet(
  value: unknown,
  options: RequiredCalibrationSetOptions = {}
): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "calibrationSet";

  if (!Array.isArray(value)) {
    return validationResult([issue(path, "INVALID_ARRAY", "calibration set must be an array.")]);
  }

  const requiredTypes = options.requiredTypes ?? DEFAULT_REQUIRED_CALIBRATION_TYPES;
  const activeTypes = new Set<string>();

  value.forEach((snapshot, index) => {
    const result = validateCalibrationFreshness(snapshot, options);
    issues.push(...result.issues.map((entry) => ({ ...entry, path: `${path}[${index}].${entry.path}` })));

    if (!isRecord(snapshot)) {
      return;
    }
    if (isNonEmptyString(options.rigId) && snapshot.rigId !== options.rigId) {
      issues.push(issue(`${path}[${index}].rigId`, "INVALID_CALIBRATION", "calibration rigId must match the active rig."));
    }
    if (isNonEmptyString(snapshot.calibrationType) && CALIBRATION_TYPE_VALUES.has(snapshot.calibrationType) && result.valid) {
      activeTypes.add(snapshot.calibrationType);
    }
  });

  requiredTypes.forEach((calibrationType) => {
    if (!activeTypes.has(calibrationType)) {
      issues.push(issue(`${path}.${calibrationType}`, "MISSING_CALIBRATION", `${calibrationType} calibration is required.`));
    }
  });

  return validationResult(issues);
}

function validateArmInterlockStatusShape(value: unknown, path: string, issues: AiGraderValidationIssue[]): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an ArmInterlockStatus object.`));
    return undefined;
  }
  if (!isNonEmptyString(value.hardwarePosition) || !ARM_POSITION_VALUES.has(value.hardwarePosition)) {
    issues.push(issue(`${path}.hardwarePosition`, "INVALID_ENUM", "hardwarePosition must be ARM_IN or ARM_OUT."));
  }
  if (value.operatorConfirmedPosition != null && (!isNonEmptyString(value.operatorConfirmedPosition) || !ARM_POSITION_VALUES.has(value.operatorConfirmedPosition))) {
    issues.push(issue(`${path}.operatorConfirmedPosition`, "INVALID_ENUM", "operatorConfirmedPosition must be ARM_IN or ARM_OUT when provided."));
  }
  if (!hasValidTimestamp(value.checkedAt)) {
    issues.push(issue(`${path}.checkedAt`, "INVALID_TIMESTAMP", "checkedAt must be a valid timestamp string."));
  }
  ["obstructionDetected", "obstructionCheckPassed", "positionReadable"].forEach((field) => {
    if (value[field] != null && typeof value[field] !== "boolean") {
      issues.push(issue(`${path}.${field}`, "INVALID_TYPE", `${field} must be a boolean when provided.`));
    }
  });
  if (value.positionReadable === false) {
    issues.push(issue(`${path}.positionReadable`, "ARM_GATE_BLOCKED", "arm interlock position must be readable."));
  }
  if (
    isNonEmptyString(value.hardwarePosition) &&
    isNonEmptyString(value.operatorConfirmedPosition) &&
    value.hardwarePosition !== value.operatorConfirmedPosition
  ) {
    issues.push(issue(`${path}.operatorConfirmedPosition`, "ARM_POSITION_CONFLICT", "hardware/operator disagreement maps to ARM_POSITION_CONFLICT."));
  }
  return value;
}

export function validateArmInterlockForState(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "armInterlock";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "ArmInterlockStateValidationInput must be an object.")]);
  }

  const status = validateArmInterlockStatusShape(value.status, `${path}.status`, issues);
  const requiredPosition = value.requiredPosition;
  if (requiredPosition != null && (!isNonEmptyString(requiredPosition) || !ARM_POSITION_VALUES.has(requiredPosition))) {
    issues.push(issue(`${path}.requiredPosition`, "INVALID_ENUM", "requiredPosition must be ARM_IN or ARM_OUT when provided."));
  }
  if (status && isNonEmptyString(requiredPosition) && ARM_POSITION_VALUES.has(requiredPosition) && status.hardwarePosition !== requiredPosition) {
    issues.push(issue(`${path}.status.hardwarePosition`, "ARM_GATE_BLOCKED", `hardware arm must be ${requiredPosition}.`));
  }
  if (value.operatorConfirmedPosition != null && status) {
    if (!isNonEmptyString(value.operatorConfirmedPosition) || !ARM_POSITION_VALUES.has(value.operatorConfirmedPosition)) {
      issues.push(issue(`${path}.operatorConfirmedPosition`, "INVALID_ENUM", "operatorConfirmedPosition must be ARM_IN or ARM_OUT when provided."));
    } else if (status.hardwarePosition !== value.operatorConfirmedPosition) {
      issues.push(issue(`${path}.operatorConfirmedPosition`, "ARM_POSITION_CONFLICT", "hardware/operator disagreement maps to ARM_POSITION_CONFLICT."));
    }
  }

  return validationResult(issues);
}

export function validateMacroCaptureArmGate(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const status = validateArmInterlockStatusShape(value, "macroArmGate", issues);

  if (status) {
    issues.push(...validateArmInterlockForState({ status, requiredPosition: "ARM_OUT" }).issues.map((entry) => ({ ...entry, path: entry.path.replace("armInterlock", "macroArmGate") })));
    if (status.obstructionDetected === true || status.obstructionCheckPassed !== true) {
      issues.push(issue("macroArmGate.obstructionCheckPassed", "MACRO_OBSTRUCTION_DETECTED", "macro capture is blocked unless obstruction detection passes."));
    }
  }

  return validationResult(issues);
}

export function validateMicroscopeCaptureArmGate(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const status = validateArmInterlockStatusShape(value, "microscopeArmGate", issues);

  if (status) {
    issues.push(...validateArmInterlockForState({ status, requiredPosition: "ARM_IN" }).issues.map((entry) => ({ ...entry, path: entry.path.replace("armInterlock", "microscopeArmGate") })));
  }

  return validationResult(issues);
}

function physicalGateStatus(value: unknown): PhysicalGateStatus | undefined {
  if (isRecord(value) && isNonEmptyString(value.status) && PHYSICAL_GATE_STATUS_VALUES.has(value.status)) {
    return value.status as PhysicalGateStatus;
  }
  return undefined;
}

export function requiresPhysicalGateReview(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.resolved === true) {
    return false;
  }
  const status = physicalGateStatus(value);
  return value.reviewRequired === true || status === "FAIL" || status === "REVIEW";
}

export function validatePhysicalGateResult(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "physicalGate";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "PhysicalGateDecision must be an object.")]);
  }

  if (!isNonEmptyString(value.gate) || !PHYSICAL_GATE_KIND_VALUES.has(value.gate)) {
    issues.push(issue(`${path}.gate`, "INVALID_ENUM", "gate must be a supported PhysicalGateKind."));
  }
  if (!isNonEmptyString(value.status) || !PHYSICAL_GATE_STATUS_VALUES.has(value.status)) {
    issues.push(issue(`${path}.status`, "INVALID_ENUM", "status must be PASS, WARN, FAIL, or REVIEW."));
  }
  if (value.detail != null && typeof value.detail !== "string") {
    issues.push(issue(`${path}.detail`, "INVALID_TYPE", "detail must be a string when provided."));
  }
  if (value.reviewRequired != null && typeof value.reviewRequired !== "boolean") {
    issues.push(issue(`${path}.reviewRequired`, "INVALID_TYPE", "reviewRequired must be a boolean when provided."));
  }
  if (value.resolved != null && typeof value.resolved !== "boolean") {
    issues.push(issue(`${path}.resolved`, "INVALID_TYPE", "resolved must be a boolean when provided."));
  }
  if (value.reviewerId != null && !isNonEmptyString(value.reviewerId)) {
    issues.push(issue(`${path}.reviewerId`, "REQUIRED", "reviewerId must be non-empty when provided."));
  }
  if (value.decidedAt != null && !hasValidTimestamp(value.decidedAt)) {
    issues.push(issue(`${path}.decidedAt`, "INVALID_TIMESTAMP", "decidedAt must be a valid timestamp when provided."));
  }
  if (Array.isArray(value.evidenceArtifacts)) {
    value.evidenceArtifacts.forEach((artifact, index) => {
      validateEvidenceArtifactRef(artifact, `${path}.evidenceArtifacts[${index}]`, issues);
    });
  } else if (value.evidenceArtifacts != null) {
    issues.push(issue(`${path}.evidenceArtifacts`, "INVALID_ARRAY", "evidenceArtifacts must be an array when provided."));
  }

  if (requiresPhysicalGateReview(value)) {
    issues.push(issue(path, "PHYSICAL_GATE_REVIEW", "physical gate requires authorized review before certificate issuance."));
  }
  if (value.resolved === true && !isNonEmptyString(value.reviewerId)) {
    issues.push(issue(`${path}.reviewerId`, "REQUIRED", "resolved physical gates require reviewerId."));
  }

  return validationResult(issues);
}

export function validateCertificateAllowedByPhysicalGates(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "physicalGates";

  if (!Array.isArray(value)) {
    return validationResult([issue(path, "INVALID_ARRAY", "physical gates must be an array.")]);
  }

  value.forEach((gate, index) => {
    const result = validatePhysicalGateResult(gate);
    const nonBlockingIssues = result.issues.filter((entry) => entry.code !== "PHYSICAL_GATE_REVIEW");
    issues.push(...nonBlockingIssues.map((entry) => ({ ...entry, path: `${path}[${index}].${entry.path}` })));
    if (requiresPhysicalGateReview(gate)) {
      issues.push(issue(`${path}[${index}]`, "CERTIFICATE_BLOCKED", "unresolved physical gate blocks certificate issuance."));
    }
  });

  return validationResult(issues);
}

function isProductionAuthVerdict(value: unknown): value is Exclude<AuthVerdict, "REFERENCE_NEEDED"> {
  return isNonEmptyString(value) && PRODUCTION_AUTH_VERDICT_VALUES.has(value);
}

function profileStatusFrom(value: unknown): PrintProfileStatus | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (isNonEmptyString(value.state) && PRINT_PROFILE_STATUS_VALUES.has(value.state)) {
    return value.state as PrintProfileStatus;
  }
  return undefined;
}

function validateOptionalNonEmptyString(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: AiGraderValidationIssue[]
) {
  if (record[field] != null && !isNonEmptyString(record[field])) {
    issues.push(issue(`${path}.${field}`, "REQUIRED", `${field} must be non-empty when provided.`));
  }
}

function recordSuggestsImageDerivedIdentity(value: Record<string, unknown>): boolean {
  const identitySource = isNonEmptyString(value.identitySource) ? value.identitySource.toUpperCase() : "";
  const source = isNonEmptyString(value.source) ? value.source.toUpperCase() : "";
  return (
    identitySource === "IMAGE" ||
    source === "IMAGE" ||
    value.inferredFromImage === true ||
    value.imageDerivedIdentity === true ||
    value.cardIdentifiedFromImage === true
  );
}

function validateAuthIdentityFields(
  value: Record<string, unknown>,
  path: string,
  issues: AiGraderValidationIssue[]
) {
  if (!isNonEmptyString(value.cardSet)) {
    issues.push(issue(`${path}.cardSet`, "AUTH_IDENTITY_REQUIRED", "operator-supplied cardSet is required for auth."));
  }
  if (!isNonEmptyString(value.cardNumber)) {
    issues.push(issue(`${path}.cardNumber`, "AUTH_IDENTITY_REQUIRED", "operator-supplied cardNumber is required for auth."));
  }
  validateOptionalNonEmptyString(value, "printRun", path, issues);
  validateOptionalNonEmptyString(value, "notes", path, issues);
}

export function validateCardIdentityInput(
  value: unknown,
  options: CardIdentityValidationOptions = {}
): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "cardIdentity";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "CardIdentityInput must be an object.")]);
  }

  validateAuthIdentityFields(value, path, issues);

  if (
    value.identitySource != null &&
    (!isNonEmptyString(value.identitySource) || !AUTH_IDENTITY_SOURCE_VALUES.has(value.identitySource))
  ) {
    issues.push(issue(`${path}.identitySource`, "INVALID_ENUM", "identitySource must be OPERATOR_SUPPLIED, MANIFEST, or CURATED_REFERENCE."));
  }

  if ((options.mode === "AUTH_ONLY" || options.mode === "FORENSIC") && value.identitySource !== "OPERATOR_SUPPLIED") {
    issues.push(issue(`${path}.identitySource`, "AUTH_IDENTITY_REQUIRED", `${options.mode} auth requires an operator-supplied card identity.`));
  }

  if (recordSuggestsImageDerivedIdentity(value)) {
    issues.push(issue(path, "AUTH_IDENTITY_REQUIRED", "v5 auth does not identify the card from images."));
  }

  return validationResult(issues);
}

export function validateCardPrintProfileContract(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "cardPrintProfile";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "CardPrintProfileContract must be an object.")]);
  }

  ["id", "tenantId", "cardSet", "cardNumber", "printRunKey", "createdAt", "updatedAt"].forEach((field) => {
    requireString(value, field, path, issues);
  });
  validateOptionalNonEmptyString(value, "printRun", path, issues);
  validateOptionalNonEmptyString(value, "referenceAuthRunId", path, issues);
  validateOptionalNonEmptyString(value, "approvedByOperatorId", path, issues);
  validateOptionalNonEmptyString(value, "notes", path, issues);

  if (!isNonEmptyString(value.state) || !PRINT_PROFILE_STATUS_VALUES.has(value.state)) {
    issues.push(issue(`${path}.state`, "INVALID_ENUM", "state must match the supported PrintProfileStatus enum."));
  }
  if (!isRecord(value.referenceFingerprint) || Object.keys(value.referenceFingerprint).length === 0) {
    issues.push(issue(`${path}.referenceFingerprint`, "INVALID_RECORD", "referenceFingerprint must be a non-empty object."));
  }
  if (!isPositiveInteger(value.version)) {
    issues.push(issue(`${path}.version`, "INVALID_VERSION", "version must be a positive integer."));
  }
  if (!hasValidTimestamp(value.createdAt)) {
    issues.push(issue(`${path}.createdAt`, "INVALID_TIMESTAMP", "createdAt must be a valid timestamp string."));
  }
  if (!hasValidTimestamp(value.updatedAt)) {
    issues.push(issue(`${path}.updatedAt`, "INVALID_TIMESTAMP", "updatedAt must be a valid timestamp string."));
  }
  if (value.approvedAt != null && !hasValidTimestamp(value.approvedAt)) {
    issues.push(issue(`${path}.approvedAt`, "INVALID_TIMESTAMP", "approvedAt must be a valid timestamp string when provided."));
  }

  if ((value.state === "CURATED_REFERENCE" || value.state === "ACTIVE") && !isNonEmptyString(value.approvedByOperatorId)) {
    issues.push(issue(`${path}.approvedByOperatorId`, "REQUIRED", "approved profiles require an authorized approving operator."));
  }
  if ((value.state === "CURATED_REFERENCE" || value.state === "ACTIVE") && !hasValidTimestamp(value.approvedAt)) {
    issues.push(issue(`${path}.approvedAt`, "INVALID_TIMESTAMP", "approved profiles require approvedAt."));
  }

  return validationResult(issues);
}

export function resolveAuthVerdictFromProfileState(
  profile: unknown,
  requestedVerdict: unknown = "REFERENCE_NEEDED"
): AuthVerdict {
  if (profileStatusFrom(profile) !== "ACTIVE") {
    return "REFERENCE_NEEDED";
  }
  if (isProductionAuthVerdict(requestedVerdict)) {
    return requestedVerdict;
  }
  return "REFERENCE_NEEDED";
}

export function validateAuthRunContract(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "authRun";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "AuthRunContract must be an object.")]);
  }

  [
    "id",
    "algorithmVersionId",
    "runtimeEnvironmentId",
    "tenantId",
    "cardSet",
    "cardNumber",
    "startedAt",
  ].forEach((field) => requireString(value, field, path, issues));
  [
    "captureSessionId",
    "captureManifestId",
    "cardPrintProfileId",
    "printRun",
    "errorCode",
  ].forEach((field) => validateOptionalNonEmptyString(value, field, path, issues));

  validateAuthIdentityFields(value, path, issues);

  if (!isNonEmptyString(value.verdict) || !AUTH_VERDICT_VALUES.has(value.verdict)) {
    issues.push(issue(`${path}.verdict`, "INVALID_AUTH_VERDICT", "verdict must match the supported AuthVerdict enum."));
  }
  if (!isNonEmptyString(value.status) || !AUTH_RUN_STATUS_VALUES.has(value.status)) {
    issues.push(issue(`${path}.status`, "INVALID_ENUM", "status must match the supported AuthRunStatus enum."));
  }
  if (!isRecord(value.measurements)) {
    issues.push(issue(`${path}.measurements`, "INVALID_RECORD", "measurements must be an object."));
  }
  if (!isRecord(value.evidence)) {
    issues.push(issue(`${path}.evidence`, "INVALID_RECORD", "evidence must be an object."));
  }
  if (value.distance != null && (!isFiniteNumber(value.distance) || value.distance < 0)) {
    issues.push(issue(`${path}.distance`, "INVALID_NUMBER", "distance must be a non-negative finite number when provided."));
  }
  if (value.inputChecksum != null && !hasValidSha256(value.inputChecksum)) {
    issues.push(issue(`${path}.inputChecksum`, "INVALID_CHECKSUM", "inputChecksum must be a 64-character hex SHA-256 digest when provided."));
  }
  if (value.outputChecksum != null && !hasValidSha256(value.outputChecksum)) {
    issues.push(issue(`${path}.outputChecksum`, "INVALID_CHECKSUM", "outputChecksum must be a 64-character hex SHA-256 digest when provided."));
  }
  if (!hasValidTimestamp(value.startedAt)) {
    issues.push(issue(`${path}.startedAt`, "INVALID_TIMESTAMP", "startedAt must be a valid timestamp string."));
  }
  if (value.finishedAt != null && !hasValidTimestamp(value.finishedAt)) {
    issues.push(issue(`${path}.finishedAt`, "INVALID_TIMESTAMP", "finishedAt must be a valid timestamp string when provided."));
  }
  if (
    hasValidTimestamp(value.startedAt) &&
    hasValidTimestamp(value.finishedAt) &&
    Date.parse(String(value.finishedAt)) <= Date.parse(String(value.startedAt))
  ) {
    issues.push(issue(`${path}.finishedAt`, "INVALID_TIMESTAMP", "finishedAt must be later than startedAt."));
  }
  if (value.mode != null && (!isNonEmptyString(value.mode) || !GRADING_MODE_VALUES.has(value.mode))) {
    issues.push(issue(`${path}.mode`, "INVALID_ENUM", "mode must be a supported GradingMode when provided."));
  }
  if (value.profileState != null && (!isNonEmptyString(value.profileState) || !PRINT_PROFILE_STATUS_VALUES.has(value.profileState))) {
    issues.push(issue(`${path}.profileState`, "INVALID_ENUM", "profileState must match PrintProfileStatus when provided."));
  }
  if (value.finalGrades != null && !isRecord(value.finalGrades)) {
    issues.push(issue(`${path}.finalGrades`, "INVALID_RECORD", "finalGrades must be an object when provided."));
  } else if (isRecord(value.finalGrades)) {
    validateContractGradeRecord(value.finalGrades, `${path}.finalGrades`, issues);
  }

  if (value.mode === "AUTH_ONLY" && isRecord(value.finalGrades) && Object.keys(value.finalGrades).length > 0) {
    issues.push(issue(`${path}.finalGrades`, "INVALID_AUTH_CLAIM", "AUTH_ONLY produces an auth verdict contract but no grade values."));
  }

  if (isProductionAuthVerdict(value.verdict)) {
    if (value.profileState !== "ACTIVE" || !isNonEmptyString(value.cardPrintProfileId)) {
      issues.push(issue(`${path}.verdict`, "AUTH_PROFILE_NOT_ACTIVE", "only an ACTIVE curated print profile can produce production auth verdicts."));
    }
  }

  return validationResult(issues);
}

export function validateAuthProfileLifecycleTransition(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "authProfileLifecycle";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "AuthProfileLifecycleDecision must be an object.")]);
  }

  if (!isNonEmptyString(value.from) || !PRINT_PROFILE_STATUS_VALUES.has(value.from)) {
    issues.push(issue(`${path}.from`, "INVALID_ENUM", "from must match PrintProfileStatus."));
  }
  if (!isNonEmptyString(value.to) || !PRINT_PROFILE_STATUS_VALUES.has(value.to)) {
    issues.push(issue(`${path}.to`, "INVALID_ENUM", "to must match PrintProfileStatus."));
  }
  requireString(value, "actorOperatorId", path, issues);
  requireString(value, "reasonCode", path, issues);
  if (!hasValidTimestamp(value.decidedAt)) {
    issues.push(issue(`${path}.decidedAt`, "INVALID_TIMESTAMP", "decidedAt must be a valid timestamp string."));
  }
  validateOptionalNonEmptyString(value, "reviewedByOperatorId", path, issues);

  if (isNonEmptyString(value.from) && isNonEmptyString(value.to) && PRINT_PROFILE_STATUS_VALUES.has(value.from) && PRINT_PROFILE_STATUS_VALUES.has(value.to)) {
    const transitionKey = `${value.from}->${value.to}`;
    if (!AUTH_PROFILE_ALLOWED_TRANSITIONS.has(transitionKey)) {
      issues.push(issue(path, "INVALID_AUTH_PROFILE_TRANSITION", `${transitionKey} is not an allowed CardPrintProfile lifecycle transition.`));
    }
  }

  if ((value.to === "CURATED_REFERENCE" || value.to === "ACTIVE") && !isNonEmptyString(value.reviewedByOperatorId)) {
    issues.push(issue(`${path}.reviewedByOperatorId`, "REQUIRED", "curated or active profile transitions require reviewer approval."));
  }
  if (isNonEmptyString(value.reviewedByOperatorId) && value.reviewedByOperatorId === value.actorOperatorId) {
    issues.push(issue(`${path}.reviewedByOperatorId`, "INVALID_AUTH_PROFILE_TRANSITION", "auth profile approval requires role separation."));
  }

  return validationResult(issues);
}

export function validateAuthReportClaimBoundary(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "authReport";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "AuthReportClaimBoundaryInput must be an object.")]);
  }

  if (!isNonEmptyString(value.verdict) || !AUTH_VERDICT_VALUES.has(value.verdict)) {
    issues.push(issue(`${path}.verdict`, "INVALID_AUTH_VERDICT", "verdict must match the supported AuthVerdict enum."));
  }
  if (!isNonEmptyString(value.reportText)) {
    issues.push(issue(`${path}.reportText`, "REQUIRED", "reportText is required."));
    return validationResult(issues);
  }
  if (value.mode != null && (!isNonEmptyString(value.mode) || !GRADING_MODE_VALUES.has(value.mode))) {
    issues.push(issue(`${path}.mode`, "INVALID_ENUM", "mode must be a supported GradingMode when provided."));
  }

  const normalizedText = value.reportText.toLowerCase();
  const overbroadClaimPatterns = [
    /\bfully authentic\b/,
    /\bfull authenticity\b/,
    /\bproves full authenticity\b/,
    /\bguaranteed authentic\b/,
    /\b100%\s*authentic\b/,
    /\bproves authentic\b/,
    /\bcertifies authentic\b/,
    /\bcomplete authenticity\b/,
  ];
  if (overbroadClaimPatterns.some((pattern) => pattern.test(normalizedText))) {
    issues.push(issue(`${path}.reportText`, "INVALID_AUTH_CLAIM", "CMYK print-profile comparison alone must not claim full authenticity."));
  }

  if (!normalizedText.includes("print-profile") && !normalizedText.includes("cmyk")) {
    issues.push(issue(`${path}.reportText`, "INVALID_AUTH_CLAIM", "public auth language must state the CMYK print-profile comparison scope."));
  }

  if (value.verdict === "REFERENCE_NEEDED") {
    const explainsReferenceNeeded =
      normalizedText.includes("reference_needed") ||
      normalizedText.includes("reference needed") ||
      normalizedText.includes("no active curated profile") ||
      normalizedText.includes("no active curated reference");
    if (!explainsReferenceNeeded) {
      issues.push(issue(`${path}.reportText`, "INVALID_AUTH_CLAIM", "REFERENCE_NEEDED reports must say no active curated profile/reference was available."));
    }
  }

  return validationResult(issues);
}

function hasEvidenceSourceLinkage(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.captureSessionId) ||
    isNonEmptyString(value.gradeRunId) ||
    isNonEmptyString(value.authRunId) ||
    isNonEmptyString(value.certificateId)
  );
}

function validateOptionalPositiveNumber(
  record: Record<string, unknown>,
  field: string,
  path: string,
  issues: AiGraderValidationIssue[]
) {
  if (record[field] != null && (!isFiniteNumber(record[field]) || record[field] < 0)) {
    issues.push(issue(`${path}.${field}`, "INVALID_NUMBER", `${field} must be a non-negative finite number when provided.`));
  }
}

function validateStringArrayShape(
  value: unknown,
  path: string,
  issues: AiGraderValidationIssue[],
  options: { allowEmpty?: boolean } = {}
) {
  if (!Array.isArray(value)) {
    issues.push(issue(path, "INVALID_ARRAY", `${path} must be an array.`));
    return;
  }
  if (!options.allowEmpty && value.length === 0) {
    issues.push(issue(path, "EMPTY_ARRAY", `${path} must include at least one value.`));
  }
  value.forEach((entry, index) => {
    if (!isNonEmptyString(entry)) {
      issues.push(issue(`${path}[${index}]`, "REQUIRED", `${path}[${index}] must be a non-empty string.`));
    }
  });
}

function containsPrivateEvidenceMarker(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const kind = isNonEmptyString(value.kind) ? value.kind.toLowerCase() : "";
  const storageKey = isNonEmptyString(value.storageKey) ? value.storageKey.toLowerCase() : "";
  return (
    value.evidenceClass === "PRIVATE" ||
    value.evidenceClass === "ORIGINAL" ||
    kind.includes("manifest") ||
    kind.includes("calibration") ||
    kind.includes("source_code") ||
    kind.includes("source-code") ||
    kind.includes("algorithm") ||
    storageKey.includes("/private/") ||
    storageKey.includes("manifest") ||
    storageKey.includes("calibration")
  );
}

export function validateEvidenceArtifactContract(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "evidenceArtifact";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "EvidenceArtifactContract must be an object.")]);
  }

  ["id", "tenantId", "kind", "storageKey", "mimeType", "createdAt"].forEach((field) => requireString(value, field, path, issues));
  ["captureSessionId", "gradeRunId", "authRunId", "certificateId", "publicUrl"].forEach((field) => {
    validateOptionalNonEmptyString(value, field, path, issues);
  });

  if (!isNonEmptyString(value.evidenceClass) || !EVIDENCE_CLASS_VALUES.has(value.evidenceClass)) {
    issues.push(issue(`${path}.evidenceClass`, "INVALID_ENUM", "evidenceClass must match the supported EvidenceClass enum."));
  }
  if (!hasValidSha256(value.checksumSha256)) {
    issues.push(issue(`${path}.checksumSha256`, "INVALID_CHECKSUM", "checksumSha256 must be a 64-character hex SHA-256 digest."));
  }
  if (!hasValidTimestamp(value.createdAt)) {
    issues.push(issue(`${path}.createdAt`, "INVALID_TIMESTAMP", "createdAt must be a valid timestamp string."));
  }
  if (value.retentionUntil != null && !hasValidTimestamp(value.retentionUntil)) {
    issues.push(issue(`${path}.retentionUntil`, "INVALID_TIMESTAMP", "retentionUntil must be a valid timestamp string when provided."));
  }
  ["byteSize", "widthPx", "heightPx"].forEach((field) => validateOptionalPositiveNumber(value, field, path, issues));
  if (value.metadata != null && !isRecord(value.metadata)) {
    issues.push(issue(`${path}.metadata`, "INVALID_RECORD", "metadata must be an object when provided."));
  }

  if (value.evidenceClass === "ORIGINAL" && !hasEvidenceSourceLinkage(value)) {
    issues.push(issue(path, "INVALID_EVIDENCE_ARTIFACT", "original evidence artifacts require capture, grade, auth, or certificate source linkage."));
  }
  if ((value.evidenceClass === "ORIGINAL" || value.evidenceClass === "PRIVATE") && value.publicUrl != null) {
    issues.push(issue(`${path}.publicUrl`, "PRIVATE_EVIDENCE_EXPOSED", "original and private evidence artifacts must not be directly public."));
  }

  return validationResult(issues);
}

export function validateGradeCertificateContract(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "certificate";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "GradeCertificateContract must be an object.")]);
  }

  [
    "id",
    "tenantId",
    "gradeRunId",
    "publicSlug",
    "certificateNumber",
    "custodyStatus",
    "createdAt",
    "updatedAt",
  ].forEach((field) => requireString(value, field, path, issues));
  ["authRunId", "publicReportKey", "revocationReason"].forEach((field) => {
    validateOptionalNonEmptyString(value, field, path, issues);
  });

  if (!isNonEmptyString(value.status) || !CERTIFICATE_STATUS_VALUES.has(value.status)) {
    issues.push(issue(`${path}.status`, "INVALID_ENUM", "status must match the supported CertificateStatus enum."));
  }
  if (!isNonEmptyString(value.mode) || !GRADING_MODE_VALUES.has(value.mode)) {
    issues.push(issue(`${path}.mode`, "INVALID_ENUM", "mode must be a supported GradingMode."));
  }
  if (value.finalGrades != null && !isRecord(value.finalGrades)) {
    issues.push(issue(`${path}.finalGrades`, "INVALID_RECORD", "finalGrades must be an object when provided."));
  } else if (isRecord(value.finalGrades)) {
    validateContractGradeRecord(value.finalGrades, `${path}.finalGrades`, issues);
  }
  if (!hasValidTimestamp(value.createdAt)) {
    issues.push(issue(`${path}.createdAt`, "INVALID_TIMESTAMP", "createdAt must be a valid timestamp string."));
  }
  if (!hasValidTimestamp(value.updatedAt)) {
    issues.push(issue(`${path}.updatedAt`, "INVALID_TIMESTAMP", "updatedAt must be a valid timestamp string."));
  }
  if (value.issuedAt != null && !hasValidTimestamp(value.issuedAt)) {
    issues.push(issue(`${path}.issuedAt`, "INVALID_TIMESTAMP", "issuedAt must be a valid timestamp string when provided."));
  }
  if (value.revokedAt != null && !hasValidTimestamp(value.revokedAt)) {
    issues.push(issue(`${path}.revokedAt`, "INVALID_TIMESTAMP", "revokedAt must be a valid timestamp string when provided."));
  }
  if (value.sourceGradeRunStatus != null && (!isNonEmptyString(value.sourceGradeRunStatus) || !GRADE_RUN_STATUS_VALUES.has(value.sourceGradeRunStatus))) {
    issues.push(issue(`${path}.sourceGradeRunStatus`, "INVALID_ENUM", "sourceGradeRunStatus must match GradeRunStatus when provided."));
  }
  if (value.status === "ACTIVE" && !hasValidTimestamp(value.issuedAt)) {
    issues.push(issue(`${path}.issuedAt`, "INVALID_CERTIFICATE", "active certificates require issuedAt."));
  }
  if (value.status === "ACTIVE" && !isNonEmptyString(value.publicReportKey)) {
    issues.push(issue(`${path}.publicReportKey`, "INVALID_CERTIFICATE", "active certificates require publicReportKey."));
  }
  if (value.status === "REVOKED" && (!hasValidTimestamp(value.revokedAt) || !isNonEmptyString(value.revocationReason))) {
    issues.push(issue(`${path}.revokedAt`, "INVALID_CERTIFICATE", "revoked certificates require revokedAt and revocationReason."));
  }

  if (value.mode === "AUTH_ONLY" && isRecord(value.finalGrades) && Object.keys(value.finalGrades).length > 0) {
    issues.push(issue(`${path}.finalGrades`, "CERTIFICATE_BLOCKED", "AUTH_ONLY cannot certify grade values."));
  }

  return validationResult(issues);
}

export function validateCustodyEventContract(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "custodyEvent";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "CustodyEventContract must be an object.")]);
  }

  ["id", "tenantId", "checksum", "occurredAt"].forEach((field) => requireString(value, field, path, issues));
  ["certificateId", "captureSessionId", "fromOperatorId", "toOperatorId", "fromLocationId", "toLocationId", "notes"].forEach((field) => {
    validateOptionalNonEmptyString(value, field, path, issues);
  });

  if (!isNonEmptyString(value.type) || !CUSTODY_EVENT_TYPE_VALUES.has(value.type)) {
    issues.push(issue(`${path}.type`, "INVALID_ENUM", "type must match the supported CustodyEventType enum."));
  }
  if (!hasValidSha256(value.checksum)) {
    issues.push(issue(`${path}.checksum`, "INVALID_CHECKSUM", "checksum must be a 64-character hex SHA-256 digest."));
  }
  if (!hasValidTimestamp(value.occurredAt)) {
    issues.push(issue(`${path}.occurredAt`, "INVALID_TIMESTAMP", "occurredAt must be a valid timestamp string."));
  }
  if (value.evidenceArtifactIds != null) {
    validateStringArrayShape(value.evidenceArtifactIds, `${path}.evidenceArtifactIds`, issues, { allowEmpty: true });
  }
  if (!isNonEmptyString(value.certificateId) && !isNonEmptyString(value.captureSessionId)) {
    issues.push(issue(path, "INVALID_CUSTODY", "custody events require certificateId or captureSessionId linkage."));
  }
  if (
    (value.type === "CERTIFICATE_ISSUED" || value.type === "CERTIFICATE_REVOKED" || value.type === "CUSTODY_BREAK") &&
    !isNonEmptyString(value.certificateId)
  ) {
    issues.push(issue(`${path}.certificateId`, "INVALID_CUSTODY", `${value.type} custody events require certificateId.`));
  }

  return validationResult(issues);
}

export function validateCertificateAllowedForMode(value: unknown): AiGraderValidationResult {
  const issues = [...validateGradeCertificateContract(value).issues];

  if (!isRecord(value)) {
    return validationResult(issues);
  }

  const finalGrades = isRecord(value.finalGrades) ? value.finalGrades : {};
  if ((value.mode === "STANDARD" || value.mode === "FORENSIC" || value.mode === "QUICK") && Object.keys(finalGrades).length === 0) {
    issues.push(issue("certificate.finalGrades", "INVALID_CERTIFICATE", `${value.mode} certificates require grade values.`));
  }
  if (value.mode === "AUTH_ONLY" && Object.keys(finalGrades).length > 0) {
    issues.push(issue("certificate.finalGrades", "CERTIFICATE_BLOCKED", "AUTH_ONLY cannot certify grade values."));
  }

  return validationResult(issues);
}

export function validateCertificateEvidenceReadiness(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "certificateReadiness";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "certificate readiness input must be an object.")]);
  }

  const certificateResult = validateCertificateAllowedForMode(value.certificate);
  issues.push(...certificateResult.issues.map((entry) => ({ ...entry, path: `${path}.${entry.path}` })));

  const certificate = isRecord(value.certificate) ? value.certificate : undefined;
  const certificateSourceGradeRunStatus = certificate?.sourceGradeRunStatus;

  if (certificateSourceGradeRunStatus !== "COMPLETE") {
    issues.push(
      issue(
        `${path}.certificate.sourceGradeRunStatus`,
        "CERTIFICATE_BLOCKED",
        "GradeCertificate sourceGradeRunStatus must be COMPLETE for certificate readiness."
      )
    );
  }

  if (value.gradeRunStatus !== "COMPLETE") {
    issues.push(issue(`${path}.gradeRunStatus`, "CERTIFICATE_BLOCKED", "GradeCertificate requires a complete GradeRun."));
  }
  if (
    value.gradeRunStatus != null &&
    certificateSourceGradeRunStatus != null &&
    value.gradeRunStatus !== certificateSourceGradeRunStatus
  ) {
    issues.push(
      issue(
        `${path}.gradeRunStatus`,
        "CERTIFICATE_BLOCKED",
        "supplied gradeRunStatus must match GradeCertificate sourceGradeRunStatus."
      )
    );
  }

  if (!Array.isArray(value.evidenceArtifacts)) {
    issues.push(issue(`${path}.evidenceArtifacts`, "INVALID_ARRAY", "evidenceArtifacts must be an array."));
  } else {
    let originalCount = 0;
    value.evidenceArtifacts.forEach((artifact, index) => {
      const result = validateEvidenceArtifactContract(artifact);
      issues.push(...result.issues.map((entry) => ({ ...entry, path: `${path}.evidenceArtifacts[${index}].${entry.path}` })));
      if (isRecord(artifact) && artifact.evidenceClass === "ORIGINAL") {
        originalCount += 1;
      }
    });
    if (originalCount === 0) {
      issues.push(issue(`${path}.evidenceArtifacts`, "CERTIFICATE_BLOCKED", "certifiable grade evidence requires at least one original artifact."));
    }
  }

  return validationResult(issues);
}

export function validateCustodyChainForCertificate(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "custodyChain";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "custody chain input must be an object.")]);
  }
  requireString(value, "certificateId", path, issues);

  if (!Array.isArray(value.custodyEvents)) {
    issues.push(issue(`${path}.custodyEvents`, "INVALID_ARRAY", "custodyEvents must be an array."));
    return validationResult(issues);
  }

  value.custodyEvents.forEach((event, index) => {
    const result = validateCustodyEventContract(event);
    issues.push(...result.issues.map((entry) => ({ ...entry, path: `${path}.custodyEvents[${index}].${entry.path}` })));
    if (isRecord(event) && event.type === "CUSTODY_BREAK") {
      issues.push(issue(`${path}.custodyEvents[${index}]`, "CERTIFICATE_BLOCKED", "custody break blocks or flags certificate trust."));
    }
    if (isRecord(event) && isNonEmptyString(value.certificateId) && isNonEmptyString(event.certificateId) && event.certificateId !== value.certificateId) {
      issues.push(issue(`${path}.custodyEvents[${index}].certificateId`, "INVALID_CUSTODY", "custody event certificateId must match the certificate."));
    }
  });

  return validationResult(issues);
}

export function validatePublicClaimText(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "publicClaim";

  const claimText = typeof value === "string" ? value : isRecord(value) ? value.claimText : undefined;
  const mode = isRecord(value) ? value.mode : undefined;

  if (!isNonEmptyString(claimText)) {
    return validationResult([issue(`${path}.claimText`, "REQUIRED", "claimText is required.")]);
  }
  if (mode != null && (!isNonEmptyString(mode) || !GRADING_MODE_VALUES.has(mode))) {
    issues.push(issue(`${path}.mode`, "INVALID_ENUM", "mode must be a supported GradingMode when provided."));
  }

  const normalized = claimText.toLowerCase();
  const disallowedPatterns = [
    /standard\s+(?:is\s+)?(?:a\s+)?full[- ]card microscope inspection/,
    /standard.*full[- ]card.*microscope/,
    /full[- ]card.*microscope.*standard/,
    /physical recapture.*always.*(?:same|identical|matching).*grade/,
    /always.*same grade.*physical recapture/,
    /cmyk.*(?:alone|comparison alone|print-profile comparison alone).*proves.*full authenticity/,
    /cmyk.*proves.*full authenticity/,
    /12\s*second.*standard/,
    /standard.*12\s*second/,
    /industrial[- ]rig.*pixel density.*lean/,
    /lean.*industrial[- ]rig.*pixel density/,
  ];

  if (disallowedPatterns.some((pattern) => pattern.test(normalized))) {
    issues.push(issue(`${path}.claimText`, "INVALID_PUBLIC_CLAIM", "public claim is disallowed by v5 legal guardrails."));
  }

  return validationResult(issues);
}

export function validatePublicReportDisclosure(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "publicReport";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "PublicReportDisclosure must be an object.")]);
  }

  if (!isNonEmptyString(value.mode) || !PUBLIC_REPORT_MODE_VALUES.has(value.mode)) {
    issues.push(issue(`${path}.mode`, "INVALID_PUBLIC_REPORT", "public reports must disclose mode as QUICK, STANDARD, FORENSIC, or AUTH_ONLY."));
  }
  if (!isNonEmptyString(value.microscopeInspection) || !MICROSCOPE_INSPECTION_DISCLOSURE_VALUES.has(value.microscopeInspection)) {
    issues.push(issue(`${path}.microscopeInspection`, "INVALID_PUBLIC_REPORT", "public reports must disclose whether microscope inspection was sampled or exhaustive."));
  }
  validateStringArrayShape(value.inspectedRegions, `${path}.inspectedRegions`, issues);
  validateStringArrayShape(value.uninspectedLimitations, `${path}.uninspectedLimitations`, issues);
  validateStringArrayShape(value.evidenceSummaries, `${path}.evidenceSummaries`, issues);
  validateStringArrayShape(value.warnings, `${path}.warnings`, issues, { allowEmpty: true });
  validateStringArrayShape(value.accessibilityText, `${path}.accessibilityText`, issues);
  if (!isNonEmptyString(value.authVerdictScope)) {
    issues.push(issue(`${path}.authVerdictScope`, "INVALID_PUBLIC_REPORT", "public reports must disclose auth verdict scope, including REFERENCE_NEEDED when applicable."));
  }
  if (value.gradeValues != null && !isRecord(value.gradeValues)) {
    issues.push(issue(`${path}.gradeValues`, "INVALID_RECORD", "gradeValues must be an object when provided."));
  } else if (isRecord(value.gradeValues)) {
    validateContractGradeRecord(value.gradeValues, `${path}.gradeValues`, issues);
  }

  [
    "privateManifestExposed",
    "calibrationArtifactsExposed",
    "sourceCodeExposed",
    "proprietaryFusionDetailsExposed",
  ].forEach((field) => {
    if (value[field] === true) {
      issues.push(issue(`${path}.${field}`, "PRIVATE_EVIDENCE_EXPOSED", "public reports must not expose private manifests, calibration artifacts, source code, or proprietary fusion details."));
    } else if (value[field] != null && typeof value[field] !== "boolean") {
      issues.push(issue(`${path}.${field}`, "INVALID_TYPE", `${field} must be a boolean when provided.`));
    }
  });

  if (Array.isArray(value.publicEvidenceArtifacts)) {
    value.publicEvidenceArtifacts.forEach((artifact, index) => {
      const result = validateEvidenceArtifactContract(artifact);
      issues.push(...result.issues.map((entry) => ({ ...entry, path: `${path}.publicEvidenceArtifacts[${index}].${entry.path}` })));
      if (containsPrivateEvidenceMarker(artifact)) {
        issues.push(issue(`${path}.publicEvidenceArtifacts[${index}]`, "PRIVATE_EVIDENCE_EXPOSED", "public reports must not expose original, private, manifest, calibration, source code, or algorithm artifacts."));
      }
    });
  } else if (value.publicEvidenceArtifacts != null) {
    issues.push(issue(`${path}.publicEvidenceArtifacts`, "INVALID_ARRAY", "publicEvidenceArtifacts must be an array when provided."));
  }

  return validationResult(issues);
}

export function buildInitialAiGraderAlgorithmVersions(): AlgorithmVersionSeed[] {
  const seeds: AlgorithmVersionSeed[] = [
    {
      name: "STANDARD_SPOT_FUSION_V1",
      semanticVersion: "1.0.0",
      sourceHash: STANDARD_SPOT_FUSION_SOURCE_HASH,
      internalReference: "v5.standard.spot_fusion",
      numericTolerance: {
        finalGrade: 0,
        elementGrade: 0,
        measurement: 0.000001,
      },
      activeFrom: AI_GRADER_SEED_ACTIVE_FROM,
    },
    {
      name: "MACRO_PIPELINE_V1",
      semanticVersion: "1.0.0",
      sourceHash: MACRO_PIPELINE_SOURCE_HASH,
      internalReference: "v5.macro.pipeline",
      numericTolerance: {
        centeringMicrons: 15,
        suspectScore: 0.000001,
        provisionalGrade: 0,
      },
      activeFrom: AI_GRADER_SEED_ACTIVE_FROM,
    },
    {
      name: "CMYK_PRINT_PROFILE_V1",
      semanticVersion: "1.0.0",
      sourceHash: CMYK_PRINT_PROFILE_SOURCE_HASH,
      internalReference: "v5.auth.cmyk_print_profile",
      numericTolerance: {
        cmykDistance: 0.000001,
        fingerprintComponent: 0.000001,
      },
      activeFrom: AI_GRADER_SEED_ACTIVE_FROM,
    },
  ];

  return seeds.map((seed) => ({
    ...seed,
    numericTolerance: { ...seed.numericTolerance },
  }));
}

export function buildInitialAiGraderThresholdSets(): ThresholdSetVersionSeed[] {
  const seeds: ThresholdSetVersionSeed[] = [
    {
      name: "DEFAULT_AI_GRADER_THRESHOLDS_V1",
      semanticVersion: "1.0.0",
      sourceHash: DEFAULT_THRESHOLDS_SOURCE_HASH,
      thresholds: {
        surfaceSuspectThreshold: 0.72,
        standardSurfaceTopN: 3,
        standardCornersPerSide: 4,
        standardEdgesPerSide: 4,
        authPatchCount: 5,
        replayTolerance: {
          finalGrade: 0,
          elementGrade: 0,
          measurement: 0.000001,
        },
      },
      activeFrom: AI_GRADER_SEED_ACTIVE_FROM,
    },
  ];

  return seeds.map((seed) => ({
    ...seed,
    thresholds: { ...seed.thresholds },
  }));
}

export function buildRuntimeEnvironmentFingerprint(
  input: RuntimeEnvironmentFingerprintInput
): RuntimeEnvironmentFingerprint {
  const normalized: RuntimeEnvironmentFingerprint = {
    label: input.label.trim(),
    containerDigest: input.containerDigest.trim(),
    dependencyLockHash: input.dependencyLockHash.trim(),
    fingerprintKey: `${input.containerDigest.trim()}::${input.dependencyLockHash.trim()}`,
  };

  if (isNonEmptyString(input.pythonVersion)) {
    normalized.pythonVersion = input.pythonVersion.trim();
  }
  if (isNonEmptyString(input.nodeVersion)) {
    normalized.nodeVersion = input.nodeVersion.trim();
  }
  if (isNonEmptyString(input.opencvVersion)) {
    normalized.opencvVersion = input.opencvVersion.trim();
  }
  if (isNonEmptyString(input.numpyVersion)) {
    normalized.numpyVersion = input.numpyVersion.trim();
  }
  if (isRecord(input.osInfo)) {
    normalized.osInfo = { ...input.osInfo };
  }

  return normalized;
}

export function validateAlgorithmVersionSeed(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "seed";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "AlgorithmVersionSeed must be an object.")]);
  }

  requireString(value, "name", path, issues);
  validateSemver(value.semanticVersion, `${path}.semanticVersion`, issues);

  if (!hasValidSha256(value.sourceHash)) {
    issues.push(issue(`${path}.sourceHash`, "INVALID_CHECKSUM", "sourceHash must be a 64-character hex SHA-256 digest."));
  }

  if (value.internalReference != null && !isNonEmptyString(value.internalReference)) {
    issues.push(issue(`${path}.internalReference`, "REQUIRED", "internalReference must be non-empty when provided."));
  }
  if (value.patentReference != null && !isNonEmptyString(value.patentReference)) {
    issues.push(issue(`${path}.patentReference`, "REQUIRED", "patentReference must be non-empty when provided."));
  }

  validateNumericToleranceMap(value.numericTolerance, `${path}.numericTolerance`, issues);
  validateDateWindow(value, path, issues);

  return validationResult(issues);
}

export function validateThresholdSetVersionSeed(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "seed";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "ThresholdSetVersionSeed must be an object.")]);
  }

  requireString(value, "name", path, issues);
  validateSemver(value.semanticVersion, `${path}.semanticVersion`, issues);

  if (!isRecord(value.thresholds)) {
    issues.push(issue(`${path}.thresholds`, "INVALID_RECORD", "thresholds must be an object."));
  } else if (Object.keys(value.thresholds).length === 0) {
    issues.push(issue(`${path}.thresholds`, "EMPTY_ARRAY", "thresholds must include at least one threshold."));
  }

  if (value.sourceHash != null && !hasValidSha256(value.sourceHash)) {
    issues.push(issue(`${path}.sourceHash`, "INVALID_CHECKSUM", "sourceHash must be a 64-character hex SHA-256 digest when provided."));
  }

  validateDateWindow(value, path, issues);

  return validationResult(issues);
}

export function validateRuntimeEnvironmentFingerprint(value: unknown): AiGraderValidationResult {
  const issues: AiGraderValidationIssue[] = [];
  const path = "fingerprint";

  if (!isRecord(value)) {
    return validationResult([issue(path, "INVALID_RECORD", "RuntimeEnvironmentFingerprint must be an object.")]);
  }

  requireString(value, "label", path, issues);
  requireString(value, "containerDigest", path, issues);
  requireString(value, "dependencyLockHash", path, issues);
  requireString(value, "fingerprintKey", path, issues);

  if (!hasValidContainerDigest(value.containerDigest)) {
    issues.push(issue(`${path}.containerDigest`, "INVALID_CHECKSUM", "containerDigest must be a sha256 digest."));
  }
  if (!hasValidSha256(value.dependencyLockHash)) {
    issues.push(issue(`${path}.dependencyLockHash`, "INVALID_CHECKSUM", "dependencyLockHash must be a 64-character hex SHA-256 digest."));
  }
  if (
    isNonEmptyString(value.containerDigest) &&
    isNonEmptyString(value.dependencyLockHash) &&
    value.fingerprintKey !== `${value.containerDigest}::${value.dependencyLockHash}`
  ) {
    issues.push(issue(`${path}.fingerprintKey`, "INVALID_CHECKSUM", "fingerprintKey must match containerDigest and dependencyLockHash."));
  }

  ["pythonVersion", "nodeVersion", "opencvVersion", "numpyVersion"].forEach((field) => {
    if (value[field] != null && !isNonEmptyString(value[field])) {
      issues.push(issue(`${path}.${field}`, "REQUIRED", `${field} must be non-empty when provided.`));
    }
  });

  if (value.osInfo != null && !isRecord(value.osInfo)) {
    issues.push(issue(`${path}.osInfo`, "INVALID_RECORD", "osInfo must be an object when provided."));
  }

  return validationResult(issues);
}

export function validateReplayTolerance(input: ReplayRunInput): ReplayToleranceResult {
  const issues: AiGraderValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      validInput: false,
      tolerancePassed: false,
      checked: 0,
      maxAbsDelta: 0,
      failures: [],
      issues: [issue("replay", "INVALID_RECORD", "ReplayRunInput must be an object.")],
    };
  }

  [
    "sourceGradeRunId",
    "algorithmVersionId",
    "thresholdSetVersionId",
    "runtimeEnvironmentId",
  ].forEach((field) => requireString(input as unknown as Record<string, unknown>, field, "replay", issues));

  if (!hasValidSha256(input.inputChecksum)) {
    issues.push(issue("replay.inputChecksum", "INVALID_CHECKSUM", "inputChecksum must be a 64-character hex SHA-256 digest."));
  }
  if (!hasValidSha256(input.outputChecksum)) {
    issues.push(issue("replay.outputChecksum", "INVALID_CHECKSUM", "outputChecksum must be a 64-character hex SHA-256 digest."));
  }

  if (!isRecord(input.deltas)) {
    issues.push(issue("replay.deltas", "INVALID_RECORD", "deltas must be an object."));
  }
  validateNumericToleranceMap(input.numericTolerance, "replay.numericTolerance", issues);

  const failures: ReplayToleranceFailure[] = [];
  let checked = 0;
  let maxAbsDelta = 0;

  if (isRecord(input.deltas) && isRecord(input.numericTolerance)) {
    Object.entries(input.deltas).forEach(([path, rawDelta]) => {
      if (!isFiniteNumber(rawDelta)) {
        issues.push(issue(`replay.deltas.${path}`, "INVALID_NUMBER", "Replay deltas must be finite numbers."));
        return;
      }

      const rawTolerance = input.numericTolerance[path];
      if (!isFiniteNumber(rawTolerance)) {
        issues.push(issue(`replay.numericTolerance.${path}`, "MISSING_TOLERANCE", "Each replay delta must have a numeric tolerance."));
        return;
      }

      checked += 1;
      const absDelta = Math.abs(rawDelta);
      maxAbsDelta = Math.max(maxAbsDelta, absDelta);
      if (absDelta > rawTolerance) {
        failures.push({ path, delta: rawDelta, tolerance: rawTolerance });
      }
    });
  }

  return {
    validInput: issues.length === 0,
    tolerancePassed: issues.length === 0 && failures.length === 0,
    checked,
    maxAbsDelta,
    failures,
    issues,
  };
}

export type OrchestratorState =
  | "INIT"
  | "MACRO_PREFLIGHT"
  | "MACRO_CAPTURE"
  | "MACRO_PIPELINE"
  | "ARM_IN_PROMPT"
  | "ARM_IN_CONFIRMED"
  | "STAGE_HOME"
  | "MICRO_SPOTS"
  | "ARM_OUT_PROMPT"
  | "ARM_OUT_CONFIRMED"
  | "FUSION"
  | "REVIEW"
  | "OPERATOR_OVERRIDE_PENDING"
  | "COMPLETE"
  | "STAGE_HOME_FAILED"
  | "MICRO_INCOMPLETE_REQUIRES_REVIEW"
  | "ARM_POSITION_CONFLICT"
  | "MACRO_OBSTRUCTION_DETECTED"
  | "UPLOAD_FAILED"
  | "SPOT_FAILED_REQUIRES_DECISION"
  | "PHYSICAL_GATE_REVIEW"
  | "PAUSED_OPERATOR_TIMEOUT"
  | "ABORTED";

export type OrchestratorEventType =
  | "SESSION_CREATED"
  | "PREFLIGHT_PASS"
  | "MACRO_UPLOADED"
  | "MACRO_PIPELINE_COMPLETE"
  | "ARM_IN_CONFIRMED"
  | "STAGE_HOME_COMPLETE"
  | "MICRO_SPOTS_COMPLETE"
  | "ARM_OUT_CONFIRMED"
  | "FUSION_COMPLETE"
  | "OPERATOR_APPROVED"
  | "OPERATOR_OVERRIDE_SUBMITTED"
  | "ERROR"
  | "ABORT";

export type OrchestratorGuardValue = boolean | string | number;
export type OrchestratorGuardResults = Record<string, OrchestratorGuardValue>;

export interface OrchestratorEvent {
  sessionId: string;
  from: OrchestratorState;
  to: OrchestratorState;
  event: OrchestratorEventType;
  guardResults: OrchestratorGuardResults;
  errorCode?: string;
  occurredAt: string;
}

export interface OrchestratorTransitionResult {
  accepted: boolean;
  nextState: OrchestratorState;
  auditEventId: string;
  userVisibleMessage?: string;
}

export interface OrchestratorTransitionInput {
  sessionId: string;
  currentState: OrchestratorState;
  event: OrchestratorEventType;
  guardResults?: OrchestratorGuardResults;
  errorCode?: string;
  occurredAt?: string;
}

export const ORCHESTRATOR_NAMED_ERROR_STATES: readonly OrchestratorState[] = [
  "STAGE_HOME_FAILED",
  "MICRO_INCOMPLETE_REQUIRES_REVIEW",
  "ARM_POSITION_CONFLICT",
  "MACRO_OBSTRUCTION_DETECTED",
  "UPLOAD_FAILED",
  "SPOT_FAILED_REQUIRES_DECISION",
  "PHYSICAL_GATE_REVIEW",
  "PAUSED_OPERATOR_TIMEOUT",
  "ABORTED",
];

type TransitionRule = {
  from: OrchestratorState;
  to: OrchestratorState;
  event: OrchestratorEventType;
  guard?: (guards: OrchestratorGuardResults) => boolean;
  errorCode?: string;
  userVisibleMessage?: string;
};

const MICROSCOPE_MODES = new Set<GradingMode>([
  "STANDARD",
  "FORENSIC",
  "AUTH_ONLY",
  "MACRO_PLUS_CORNERS",
  "MACRO_PLUS_EDGES",
  "FULL_TWO_SCALE",
]);

function guardIsTrue(guards: OrchestratorGuardResults, key: string): boolean {
  return guards[key] === true;
}

function guardIsNotFalse(guards: OrchestratorGuardResults, key: string): boolean {
  return guards[key] !== false;
}

function guardString(guards: OrchestratorGuardResults, key: string): string {
  const value = guards[key];
  return typeof value === "string" ? value : "";
}

function hasMode(guards: OrchestratorGuardResults, modes: ReadonlySet<GradingMode>): boolean {
  const mode = guardString(guards, "mode") as GradingMode;
  return modes.has(mode);
}

function isMacroOnlyMode(guards: OrchestratorGuardResults): boolean {
  const mode = guardString(guards, "mode");
  return mode === "QUICK" || mode === "MACRO_ONLY";
}

function isArmPosition(guards: OrchestratorGuardResults, position: "ARM_IN" | "ARM_OUT"): boolean {
  return guardString(guards, "interlockPosition") === position || guardString(guards, "armPosition") === position;
}

function hasErrorCode(input: OrchestratorTransitionInput, rule: TransitionRule): boolean {
  if (!rule.errorCode) {
    return true;
  }
  return input.errorCode === rule.errorCode || input.guardResults?.errorCode === rule.errorCode;
}

const TRANSITION_RULES: readonly TransitionRule[] = [
  {
    from: "INIT",
    to: "MACRO_PREFLIGHT",
    event: "SESSION_CREATED",
    guard: (guards) =>
      guardIsTrue(guards, "sessionBelongsToTenant") &&
      guardIsTrue(guards, "rigActive") &&
      guardIsTrue(guards, "operatorAuthorized"),
  },
  {
    from: "INIT",
    to: "ABORTED",
    event: "ABORT",
    userVisibleMessage: "Session was aborted before capture started.",
  },
  {
    from: "MACRO_PREFLIGHT",
    to: "MACRO_CAPTURE",
    event: "PREFLIGHT_PASS",
    guard: (guards) =>
      isArmPosition(guards, "ARM_OUT") && guardIsTrue(guards, "noObstruction") && guardIsTrue(guards, "cardStable"),
  },
  {
    from: "MACRO_PREFLIGHT",
    to: "ARM_POSITION_CONFLICT",
    event: "ERROR",
    errorCode: "ARM_POSITION_CONFLICT",
    userVisibleMessage: "Arm position confirmation does not match the interlock.",
  },
  {
    from: "MACRO_PREFLIGHT",
    to: "MACRO_OBSTRUCTION_DETECTED",
    event: "ERROR",
    errorCode: "MACRO_OBSTRUCTION_DETECTED",
    userVisibleMessage: "Macro preview is obstructed; clear the view before recapture.",
  },
  {
    from: "MACRO_PREFLIGHT",
    to: "PHYSICAL_GATE_REVIEW",
    event: "ERROR",
    errorCode: "PHYSICAL_GATE_REVIEW",
    userVisibleMessage: "Physical gate triggered; authorized review is required.",
  },
  {
    from: "MACRO_CAPTURE",
    to: "MACRO_PIPELINE",
    event: "MACRO_UPLOADED",
    guard: (guards) => guardIsTrue(guards, "requiredFramesUploaded"),
  },
  {
    from: "MACRO_CAPTURE",
    to: "UPLOAD_FAILED",
    event: "ERROR",
    errorCode: "UPLOAD_FAILED",
    userVisibleMessage: "Required frame upload failed after retries.",
  },
  {
    from: "MACRO_PIPELINE",
    to: "FUSION",
    event: "MACRO_PIPELINE_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "macroOutputValid") && isMacroOnlyMode(guards),
  },
  {
    from: "MACRO_PIPELINE",
    to: "ARM_IN_PROMPT",
    event: "MACRO_PIPELINE_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "macroOutputValid") && hasMode(guards, MICROSCOPE_MODES),
  },
  {
    from: "MACRO_PIPELINE",
    to: "PHYSICAL_GATE_REVIEW",
    event: "ERROR",
    errorCode: "PHYSICAL_GATE_REVIEW",
    userVisibleMessage: "Physical gate triggered; authorized review is required.",
  },
  {
    from: "ARM_IN_PROMPT",
    to: "PAUSED_OPERATOR_TIMEOUT",
    event: "ERROR",
    errorCode: "PAUSED_OPERATOR_TIMEOUT",
    userVisibleMessage: "Operator confirmation timed out; the session remains resumable.",
  },
  {
    from: "ARM_IN_PROMPT",
    to: "ARM_IN_CONFIRMED",
    event: "ARM_IN_CONFIRMED",
    guard: (guards) => guardIsTrue(guards, "operatorConfirmed") && isArmPosition(guards, "ARM_IN"),
  },
  {
    from: "ARM_IN_PROMPT",
    to: "ARM_POSITION_CONFLICT",
    event: "ERROR",
    errorCode: "ARM_POSITION_CONFLICT",
    userVisibleMessage: "Arm position confirmation does not match the interlock.",
  },
  {
    from: "ARM_IN_CONFIRMED",
    to: "STAGE_HOME",
    event: "ARM_IN_CONFIRMED",
    guard: (guards) => isArmPosition(guards, "ARM_IN"),
  },
  {
    from: "ARM_IN_CONFIRMED",
    to: "ARM_POSITION_CONFLICT",
    event: "ERROR",
    errorCode: "ARM_POSITION_CONFLICT",
    userVisibleMessage: "Arm moved out of the confirmed microscope position.",
  },
  {
    from: "STAGE_HOME",
    to: "MICRO_SPOTS",
    event: "STAGE_HOME_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "homeSuccess") && guardIsTrue(guards, "positionReadable"),
  },
  {
    from: "STAGE_HOME",
    to: "STAGE_HOME_FAILED",
    event: "ERROR",
    errorCode: "STAGE_HOME_FAILED",
    userVisibleMessage: "Stage homing failed after retry; mechanical inspection is required.",
  },
  {
    from: "MICRO_SPOTS",
    to: "ARM_OUT_PROMPT",
    event: "MICRO_SPOTS_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "allRequiredPackagesValid"),
  },
  {
    from: "MICRO_SPOTS",
    to: "SPOT_FAILED_REQUIRES_DECISION",
    event: "ERROR",
    errorCode: "SPOT_FAILED_REQUIRES_DECISION",
    userVisibleMessage: "A microscope spot failed after retry; operator decision is required.",
  },
  {
    from: "MICRO_SPOTS",
    to: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    event: "ERROR",
    errorCode: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    userVisibleMessage: "Microscope evidence is incomplete and requires review.",
  },
  {
    from: "SPOT_FAILED_REQUIRES_DECISION",
    to: "MICRO_SPOTS",
    event: "MICRO_SPOTS_COMPLETE",
    guard: (guards) => guardString(guards, "operatorDecision") === "RETRY_SPOT",
  },
  {
    from: "SPOT_FAILED_REQUIRES_DECISION",
    to: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    event: "ERROR",
    errorCode: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    guard: (guards) => guardString(guards, "operatorDecision") === "COMPLETE_WITH_WARNING",
    userVisibleMessage: "Microscope evidence is incomplete and requires review.",
  },
  {
    from: "SPOT_FAILED_REQUIRES_DECISION",
    to: "ABORTED",
    event: "ABORT",
    userVisibleMessage: "Session was aborted after a failed microscope spot.",
  },
  {
    from: "ARM_OUT_PROMPT",
    to: "ARM_OUT_CONFIRMED",
    event: "ARM_OUT_CONFIRMED",
    guard: (guards) => guardIsTrue(guards, "operatorConfirmed") && isArmPosition(guards, "ARM_OUT"),
  },
  {
    from: "ARM_OUT_PROMPT",
    to: "ARM_POSITION_CONFLICT",
    event: "ERROR",
    errorCode: "ARM_POSITION_CONFLICT",
    userVisibleMessage: "Arm position confirmation does not match the interlock.",
  },
  {
    from: "ARM_OUT_CONFIRMED",
    to: "FUSION",
    event: "ARM_OUT_CONFIRMED",
    guard: (guards) => guardIsNotFalse(guards, "obstructionClear"),
  },
  {
    from: "ARM_OUT_CONFIRMED",
    to: "MACRO_OBSTRUCTION_DETECTED",
    event: "ERROR",
    errorCode: "MACRO_OBSTRUCTION_DETECTED",
    userVisibleMessage: "Macro preview is obstructed; clear the view before recapture.",
  },
  {
    from: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    to: "FUSION",
    event: "FUSION_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "warningAccepted"),
  },
  {
    from: "FUSION",
    to: "REVIEW",
    event: "FUSION_COMPLETE",
    guard: (guards) => guardIsTrue(guards, "gradeRunWritten"),
  },
  {
    from: "FUSION",
    to: "ABORTED",
    event: "ERROR",
    errorCode: "ABORTED",
    userVisibleMessage: "Session was aborted during fusion.",
  },
  {
    from: "REVIEW",
    to: "COMPLETE",
    event: "OPERATOR_APPROVED",
    guard: (guards) => guards.blockingGates !== true,
  },
  {
    from: "REVIEW",
    to: "OPERATOR_OVERRIDE_PENDING",
    event: "OPERATOR_OVERRIDE_SUBMITTED",
  },
  {
    from: "REVIEW",
    to: "ABORTED",
    event: "ABORT",
    userVisibleMessage: "Session was rejected during review.",
  },
  {
    from: "OPERATOR_OVERRIDE_PENDING",
    to: "COMPLETE",
    event: "OPERATOR_APPROVED",
    guard: (guards) => guardIsTrue(guards, "overrideReviewedApproved"),
  },
  {
    from: "OPERATOR_OVERRIDE_PENDING",
    to: "ABORTED",
    event: "ABORT",
    userVisibleMessage: "Operator override was rejected.",
  },
];

function buildPendingAuditEventId(input: OrchestratorTransitionInput, nextState: OrchestratorState): string {
  const occurredAt = input.occurredAt ?? "";
  return ["pending", input.sessionId, input.currentState, input.event, nextState, occurredAt].join(":");
}

export function transitionOrchestratorState(
  input: OrchestratorTransitionInput
): OrchestratorTransitionResult {
  const guards = input.guardResults ?? {};
  const rule = TRANSITION_RULES.find(
    (candidate) =>
      candidate.from === input.currentState &&
      candidate.event === input.event &&
      hasErrorCode(input, candidate) &&
      (!candidate.guard || candidate.guard(guards))
  );

  const nextState = rule?.to ?? input.currentState;

  return {
    accepted: Boolean(rule),
    nextState,
    auditEventId: buildPendingAuditEventId(input, nextState),
    userVisibleMessage: rule?.userVisibleMessage,
  };
}
