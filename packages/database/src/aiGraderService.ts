import { Prisma } from "@prisma/client";
import type {
  AiGraderValidationIssue,
  AiGraderValidationIssueCode,
  AuthRunContract,
  AuthRunStatus,
  AuthVerdict,
  CaptureManifest,
  CaptureSide,
  CardIdentityInput,
  CardPrintProfileContract,
  CertificateStatus,
  EvidenceArtifactRef,
  EvidenceArtifactContract,
  FusionAction,
  GradeCertificateContract,
  GradingMode,
  MacroPipelineOutput,
  MacroSuspectRegion,
  MicroSpotCapturePackage,
  MicroSpotFrameKey,
  OrchestratorEventType,
  OrchestratorGuardResults,
  OrchestratorState,
  PrintProfileStatus,
  StandardFusionOutput,
} from "@tenkings/shared";
import {
  ORCHESTRATOR_NAMED_ERROR_STATES,
  resolveAuthVerdictFromProfileState,
  transitionOrchestratorState,
  validateAuthProfileLifecycleTransition,
  validateAuthRunContract,
  validateCaptureManifest,
  validateCardIdentityInput,
  validateCardPrintProfileContract,
  validateCertificateEvidenceReadiness,
  validateEvidenceArtifactContract,
  validateMacroPipelineOutput,
  validateMacroSuspectRegion,
  validateMicroSpotCapturePackage,
  validateStandardFusionOutput,
} from "@tenkings/shared";

type NullableJsonInput = Prisma.InputJsonValue | typeof Prisma.JsonNull;

export type CaptureSessionPersistedStatus =
  | "CREATED"
  | "RUNNING"
  | "PAUSED"
  | "MICRO_INCOMPLETE_REQUIRES_REVIEW"
  | "PHYSICAL_GATE_REVIEW"
  | "REVIEW"
  | "COMPLETE"
  | "ABORTED";

export type CaptureSessionDraftCreateData = {
  id?: string;
  tenantId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId: string | null;
  gradingMode: GradingMode;
  status: "CREATED";
  currentState: OrchestratorState;
  rawCardOnly: boolean;
  cardIdentity?: NullableJsonInput;
  physicalGateResults?: NullableJsonInput;
};

export type CaptureSessionUpdateData = {
  currentState: OrchestratorState;
  status: CaptureSessionPersistedStatus;
  errorCode: string | null;
  startedAt?: Date;
  finishedAt?: Date;
};

export type CaptureManifestCreateData = {
  id: string;
  captureSessionId: string;
  tenantId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId: string;
  helperVersion: string;
  driverVersions: Prisma.InputJsonValue;
  componentSerials: Prisma.InputJsonValue;
  calibrationSnapshotIds: Prisma.InputJsonValue;
  frameList: Prisma.InputJsonValue;
  operatorPrompts: Prisma.InputJsonValue;
  deviceHealth: Prisma.InputJsonValue;
  checksum: string;
  createdAt: Date;
};

export type EvidenceArtifactCreateData = {
  id: string;
  tenantId: string;
  captureSessionId: string | null;
  gradeRunId: string | null;
  authRunId: string | null;
  certificateId: string | null;
  evidenceClass: EvidenceArtifactContract["evidenceClass"];
  kind: string;
  storageKey: string;
  checksumSha256: string;
  mimeType: string;
  byteSize?: number;
  widthPx?: number;
  heightPx?: number;
  retentionUntil?: Date;
  publicUrl?: string;
  metadata?: NullableJsonInput;
  createdAt: Date;
};

export type GradingSuspectRegionCreateData = {
  id: string;
  sessionId: string;
  side: CaptureSide;
  element: "SURFACE";
  rank: number;
  score: number;
  threshold: number;
  reasonCodes: Prisma.InputJsonValue;
  cardMm: Prisma.InputJsonValue;
  warpedPx: Prisma.InputJsonValue;
  sourcePx?: Prisma.InputJsonValue;
  heatmapStorageKey?: string;
  macroCaptureIds: Prisma.InputJsonValue;
  routedCaptureIds?: Prisma.InputJsonValue;
  thresholdSetId: string;
};

export type GradeRunStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED" | "REPLAYED";

export type GradeRunCreateData = {
  id?: string;
  captureSessionId: string;
  captureManifestId: string;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  runtimeEnvironmentId: string;
  status: GradeRunStatus;
  mode: GradingMode;
  inputChecksum: string;
  outputChecksum?: string;
  macroMeasurements: Prisma.InputJsonValue;
  microMeasurements?: NullableJsonInput;
  fusionActions: Prisma.InputJsonValue;
  finalGrades?: NullableJsonInput;
  confidence?: NullableJsonInput;
  warnings?: NullableJsonInput;
  errorCode?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
};

export type GradeRunUpdateData = {
  status: GradeRunStatus;
  outputChecksum: string;
  macroMeasurements?: Prisma.InputJsonValue;
  microMeasurements?: NullableJsonInput;
  fusionActions: Prisma.InputJsonValue;
  finalGrades: Prisma.InputJsonValue;
  confidence?: NullableJsonInput;
  warnings?: NullableJsonInput;
  errorCode: string | null;
  finishedAt: Date;
};

export type AuthRunCreateData = {
  id?: string;
  captureSessionId: string;
  captureManifestId: string;
  algorithmVersionId: string;
  runtimeEnvironmentId: string;
  cardPrintProfileId?: string | null;
  tenantId: string;
  cardSet: string;
  cardNumber: string;
  printRun?: string | null;
  verdict: AuthVerdict;
  distance?: number | null;
  status: AuthRunStatus;
  measurements: Prisma.InputJsonValue;
  evidence: Prisma.InputJsonValue;
  inputChecksum?: string | null;
  outputChecksum?: string | null;
  errorCode?: string | null;
  startedAt?: Date;
  finishedAt?: Date | null;
};

export type AuthRunUpdateData = {
  verdict: AuthVerdict;
  distance?: number | null;
  status: AuthRunStatus;
  measurements: Prisma.InputJsonValue;
  evidence: Prisma.InputJsonValue;
  outputChecksum?: string | null;
  errorCode?: string | null;
  finishedAt?: Date | null;
};

export type CardPrintProfileCreateData = {
  id?: string;
  tenantId: string;
  cardSet: string;
  cardNumber: string;
  printRun?: string | null;
  printRunKey: string;
  state: PrintProfileStatus;
  referenceFingerprint: Prisma.InputJsonValue;
  referenceAuthRunId?: string | null;
  approvedByOperatorId?: string | null;
  approvedAt?: Date | null;
  version?: number;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type CardPrintProfileUpdateData = {
  state: PrintProfileStatus;
  approvedByOperatorId?: string | null;
  approvedAt?: Date | null;
  notes?: string | null;
  updatedAt?: Date;
};

export type GradeCertificateCreateData = {
  id?: string;
  tenantId: string;
  gradeRunId: string;
  authRunId?: string | null;
  publicSlug: string;
  certificateNumber: string;
  status: CertificateStatus;
  mode: GradingMode;
  finalGrades?: NullableJsonInput;
  publicReportKey?: string | null;
  custodyStatus: string;
  issuedAt?: Date | null;
  revokedAt?: Date | null;
  revocationReason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type GradeCertificateUpdateData = {
  status: CertificateStatus;
  publicReportKey?: string | null;
  issuedAt?: Date | null;
  revokedAt?: Date | null;
  revocationReason?: string | null;
  updatedAt?: Date;
};

export type AuditEventCreateData = {
  id?: string;
  tenantId: string;
  actorOperatorId: string | null;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED" | "WARNING";
  before?: NullableJsonInput;
  after?: NullableJsonInput;
  reasonCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  checksum: string;
  createdAt?: Date;
};

export type CaptureSessionState = {
  id: string;
  tenantId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId: string | null;
  gradingMode: GradingMode;
  status: string;
  currentState: string;
  errorCode: string | null;
  rawCardOnly: boolean;
  physicalGateResults: Prisma.JsonValue | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GradeRunState = {
  id: string;
  captureSessionId: string;
  captureManifestId: string;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  runtimeEnvironmentId: string;
  status: GradeRunStatus;
  mode: GradingMode;
  inputChecksum: string;
  outputChecksum: string | null;
  macroMeasurements: Prisma.JsonValue;
  microMeasurements: Prisma.JsonValue | null;
  fusionActions: Prisma.JsonValue;
  finalGrades: Prisma.JsonValue | null;
  confidence: Prisma.JsonValue | null;
  warnings: Prisma.JsonValue | null;
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type AuthRunState = {
  id: string;
  tenantId: string;
  captureSessionId: string | null;
  captureManifestId: string | null;
  algorithmVersionId: string;
  runtimeEnvironmentId: string;
  cardPrintProfileId: string | null;
  cardSet: string;
  cardNumber: string;
  printRun: string | null;
  verdict: AuthVerdict;
  distance: number | null;
  status: AuthRunStatus;
  measurements: Prisma.JsonValue;
  evidence: Prisma.JsonValue;
  inputChecksum: string | null;
  outputChecksum: string | null;
  errorCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type AuthRunScope = AuthRunState;

export type CardPrintProfileState = {
  id: string;
  tenantId: string;
  cardSet: string;
  cardNumber: string;
  printRun: string | null;
  printRunKey: string;
  state: PrintProfileStatus;
  referenceFingerprint: Prisma.JsonValue;
  referenceAuthRunId: string | null;
  approvedByOperatorId: string | null;
  approvedAt: Date | null;
  version: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GradeCertificateState = {
  id: string;
  tenantId: string;
  gradeRunId: string;
  authRunId: string | null;
  publicSlug: string;
  certificateNumber: string;
  status: CertificateStatus;
  mode: GradingMode;
  finalGrades: Prisma.JsonValue | null;
  publicReportKey: string | null;
  custodyStatus: string;
  issuedAt: Date | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GradeCertificateScope = GradeCertificateState;

export type EvidenceArtifactState = {
  id: string;
  tenantId: string;
  captureSessionId: string | null;
  gradeRunId: string | null;
  authRunId: string | null;
  certificateId: string | null;
  evidenceClass: EvidenceArtifactContract["evidenceClass"];
  kind: string;
  storageKey: string;
  checksumSha256: string;
  mimeType: string;
  byteSize: number | null;
  widthPx: number | null;
  heightPx: number | null;
  retentionUntil: Date | null;
  publicUrl: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
};

export type OperatorOverrideState = {
  id: string;
  tenantId: string;
  captureSessionId: string;
  gradeRunId: string | null;
  certificateId: string | null;
  reviewStatus: string;
};

export type CustodyEventState = {
  id: string;
  tenantId: string;
  certificateId: string | null;
  captureSessionId: string | null;
  type: string;
};

type AuthRunContractSource = {
  id?: string;
  captureSessionId?: string | null;
  captureManifestId?: string | null;
  algorithmVersionId: string;
  runtimeEnvironmentId: string;
  cardPrintProfileId?: string | null;
  tenantId: string;
  cardSet: string;
  cardNumber: string;
  printRun?: string | null;
  verdict: AuthVerdict;
  distance?: number | null;
  status: AuthRunStatus;
  measurements: unknown;
  evidence: unknown;
  inputChecksum?: string | null;
  outputChecksum?: string | null;
  errorCode?: string | null;
  startedAt?: string | Date;
  finishedAt?: string | Date | null;
};

export type AiGraderServiceTransactionClient = {
  auditEvent: {
    create(args: { data: AuditEventCreateData }): Promise<unknown>;
  };
  captureManifest: {
    create(args: { data: CaptureManifestCreateData }): Promise<unknown>;
  };
  captureSession: {
    create(args: { data: CaptureSessionDraftCreateData }): Promise<unknown>;
    updateMany(args: {
      where: { id: string; tenantId: string };
      data: CaptureSessionUpdateData;
    }): Promise<{ count: number }>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: typeof captureSessionStateSelect;
    }): Promise<CaptureSessionState | null>;
  };
  evidenceArtifact: {
    create(args: { data: EvidenceArtifactCreateData }): Promise<unknown>;
    findMany(args: {
      where: {
        tenantId: string;
        OR: Array<{
          captureSessionId?: string;
          gradeRunId?: string;
          authRunId?: string;
          certificateId?: string;
        }>;
      };
      select: typeof evidenceArtifactStateSelect;
    }): Promise<EvidenceArtifactState[]>;
  };
  gradeRun: {
    create(args: { data: GradeRunCreateData }): Promise<unknown>;
    updateMany(args: {
      where: { id: string; captureSession: { tenantId: string } };
      data: GradeRunUpdateData;
    }): Promise<{ count: number }>;
    findFirst(args: {
      where: { id: string; captureSession: { tenantId: string } };
      select: typeof gradeRunStateSelect;
    }): Promise<GradeRunState | null>;
  };
  authRun: {
    create(args: { data: AuthRunCreateData }): Promise<unknown>;
    updateMany(args: {
      where: { id: string; tenantId: string };
      data: AuthRunUpdateData;
    }): Promise<{ count: number }>;
    findFirst(args: {
      where: { id: string; tenantId: string };
      select: typeof authRunStateSelect;
    }): Promise<AuthRunScope | null>;
  };
  cardPrintProfile: {
    create(args: { data: CardPrintProfileCreateData }): Promise<unknown>;
    updateMany(args: {
      where: {
        id: string;
        tenantId: string;
        cardSet?: string;
        cardNumber?: string;
        printRunKey?: string;
      };
      data: CardPrintProfileUpdateData;
    }): Promise<{ count: number }>;
    findFirst(args: {
      where: {
        id?: string;
        tenantId: string;
        cardSet?: string;
        cardNumber?: string;
        printRunKey?: string;
        state?: PrintProfileStatus;
      };
      select: typeof cardPrintProfileStateSelect;
    }): Promise<CardPrintProfileState | null>;
  };
  gradeCertificate: {
    create(args: { data: GradeCertificateCreateData }): Promise<unknown>;
    updateMany(args: {
      where: { id: string; tenantId: string };
      data: GradeCertificateUpdateData;
    }): Promise<{ count: number }>;
    findFirst(args: {
      where: { id?: string; tenantId: string; gradeRunId?: string };
      select: typeof gradeCertificateStateSelect;
    }): Promise<GradeCertificateScope | null>;
  };
  operatorOverride: {
    findMany(args: {
      where: { tenantId: string; captureSessionId?: string; gradeRunId?: string; certificateId?: string };
      select: typeof operatorOverrideStateSelect;
    }): Promise<OperatorOverrideState[]>;
  };
  custodyEvent: {
    findMany(args: {
      where: { tenantId: string; captureSessionId?: string; certificateId?: string };
      select: typeof custodyEventStateSelect;
    }): Promise<CustodyEventState[]>;
  };
  gradingSuspectRegion: {
    createMany(args: { data: GradingSuspectRegionCreateData[] }): Promise<{ count: number }>;
  };
};

export type AiGraderServicePrismaClient = AiGraderServiceTransactionClient & {
  $transaction?: <T>(
    fn: (tx: AiGraderServiceTransactionClient) => Promise<T>
  ) => Promise<T>;
};

export type CreateCaptureSessionDraftInput = {
  id?: string;
  tenantId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId?: string | null;
  gradingMode?: GradingMode;
  rawCardOnly?: boolean;
  cardIdentity?: Prisma.InputJsonValue | null;
  physicalGateResults?: Prisma.InputJsonValue | null;
  currentState?: OrchestratorState;
};

export type ReadCaptureSessionStateInput = {
  tenantId: string;
  captureSessionId: string;
};

export type RecordAuditEventInput = {
  id?: string;
  tenantId: string;
  actorOperatorId?: string | null;
  actorUserId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED" | "WARNING";
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  reasonCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  checksum: string;
  createdAt?: string | Date;
};

export type PersistOrchestratorTransitionInput = {
  tenantId: string;
  captureSessionId: string;
  event: OrchestratorEventType;
  guardResults?: OrchestratorGuardResults;
  errorCode?: string;
  actorOperatorId?: string | null;
  actorUserId?: string | null;
  reasonCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: string | Date;
};

export type CommonCaptureSessionStateUpdateInput = {
  tenantId: string;
  captureSessionId: string;
  actorOperatorId?: string | null;
  actorUserId?: string | null;
  reasonCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: string | Date;
};

export type PersistedOrchestratorTransition = {
  session: CaptureSessionState;
  fromState: string;
  toState: OrchestratorState;
  status: CaptureSessionPersistedStatus;
  errorCode: string | null;
  transitionAuditEventId: string;
  auditEvent: unknown;
  updatedCount: number;
  userVisibleMessage?: string;
};

export type PersistMacroSuspectRegionsInput = {
  tenantId: string;
  captureSessionId: string;
  side: CaptureSide;
  regions: MacroSuspectRegion[];
};

export type PersistedMacroSuspectRegions = {
  session: CaptureSessionState;
  side: CaptureSide;
  count: number;
  regions: MacroSuspectRegion[];
};

export type RecordMacroPipelineCompletionInput = {
  tenantId: string;
  captureSessionId: string;
  output: MacroPipelineOutput;
  actorOperatorId?: string | null;
  actorUserId?: string | null;
  reasonCode?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: string | Date;
  advanceOrchestrator?: boolean;
  orchestratorGuardResults?: OrchestratorGuardResults;
};

export type RecordedMacroPipelineCompletion = {
  session: CaptureSessionState;
  auditEvent: unknown;
  orchestratorTransition?: PersistedOrchestratorTransition;
};

export type PersistMicroSpotPackageInput = {
  tenantId: string;
  captureSessionId: string;
  microSpotPackage: MicroSpotCapturePackage;
  createdAt?: string | Date;
};

export type PersistedMicroSpotPackage = {
  session: CaptureSessionState;
  microSpotPackage: MicroSpotCapturePackage;
  evidenceArtifacts: unknown[];
};

export type CreateGradeRunDraftInput = {
  id?: string;
  tenantId: string;
  captureSessionId: string;
  captureManifestId: string;
  algorithmVersionId: string;
  thresholdSetVersionId: string;
  runtimeEnvironmentId: string;
  mode?: GradingMode;
  status?: Extract<GradeRunStatus, "PENDING" | "RUNNING">;
  inputChecksum: string;
  macroMeasurements: Record<string, unknown>;
  microMeasurements?: Record<string, unknown> | null;
  fusionActions?: FusionAction[];
  startedAt?: string | Date;
};

export type CreatedGradeRunDraft = {
  session: CaptureSessionState;
  gradeRun: unknown;
};

export type FinalizeGradeRunInput = {
  tenantId: string;
  gradeRunId: string;
  outputChecksum: string;
  finalGrades: Record<string, number>;
  fusionActions: FusionAction[];
  macroMeasurements?: Record<string, unknown>;
  microMeasurements?: Record<string, unknown> | null;
  confidence?: Record<string, unknown> | null;
  warnings?: string[];
  finishedAt?: string | Date;
};

export type FinalizedGradeRun = {
  gradeRun: GradeRunState;
  updatedCount: number;
};

export type CreateAuthRunDraftInput = {
  id?: string;
  tenantId: string;
  captureSessionId: string;
  captureManifestId: string;
  cardIdentity: CardIdentityInput;
  algorithmVersionId: string;
  runtimeEnvironmentId: string;
  cardPrintProfileId?: string;
  status?: Extract<AuthRunStatus, "PENDING" | "RUNNING">;
  measurements?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  inputChecksum?: string;
  startedAt?: string | Date;
};

export type CreatedAuthRunDraft = {
  session: CaptureSessionState;
  profile: CardPrintProfileState | null;
  verdict: AuthVerdict;
  authRun: unknown;
};

export type FinalizeAuthRunInput = {
  tenantId: string;
  authRunId: string;
  requestedVerdict: AuthVerdict;
  status?: Extract<AuthRunStatus, "COMPLETE" | "FAILED">;
  distance?: number | null;
  measurements: Record<string, unknown>;
  evidence: Record<string, unknown>;
  outputChecksum?: string | null;
  errorCode?: string | null;
  finishedAt?: string | Date;
};

export type FinalizedAuthRun = {
  authRun: AuthRunState;
  profile: CardPrintProfileState | null;
  resolvedVerdict: AuthVerdict;
  updatedCount: number;
};

export type CreateCandidateCardPrintProfileInput = {
  id?: string;
  tenantId: string;
  cardIdentity: CardIdentityInput;
  referenceFingerprint: Record<string, unknown>;
  referenceAuthRunId?: string | null;
  version?: number;
  notes?: string | null;
  createdAt?: string | Date;
};

export type CreatedCandidateCardPrintProfile = {
  profile: unknown;
};

export type ApproveCardPrintProfileInput = {
  tenantId: string;
  profileId: string;
  cardSet: string;
  cardNumber: string;
  printRun?: string;
  toState?: Extract<PrintProfileStatus, "CURATED_REFERENCE" | "ACTIVE">;
  actorOperatorId: string;
  reviewedByOperatorId: string;
  reasonCode: string;
  decidedAt?: string | Date;
  notes?: string | null;
};

export type UpdateCardPrintProfileLifecycleInput = {
  tenantId: string;
  profileId: string;
  cardSet: string;
  cardNumber: string;
  printRun?: string;
  actorOperatorId: string;
  reasonCode: string;
  decidedAt?: string | Date;
  notes?: string | null;
};

export type UpdatedCardPrintProfile = {
  profile: CardPrintProfileState;
  updatedCount: number;
};

export type CheckGradeCertificateReadinessInput = {
  tenantId: string;
  gradeRunId: string;
  authRunId?: string | null;
  certificateId?: string;
  publicSlug?: string;
  certificateNumber?: string;
  custodyStatus?: string;
};

export type GradeCertificateReadinessResult = {
  ready: boolean;
  issues: AiGraderValidationIssue[];
  gradeRun: GradeRunState | null;
  authRun: AuthRunState | null;
  certificate: GradeCertificateContract | null;
  evidenceArtifacts: EvidenceArtifactContract[];
  blockingOverrides: OperatorOverrideState[];
  custodyBreaks: CustodyEventState[];
};

export type CreateGradeCertificateDraftInput = CheckGradeCertificateReadinessInput & {
  id?: string;
  publicSlug: string;
  certificateNumber: string;
  createdAt?: string | Date;
};

export type CreatedGradeCertificateDraft = {
  readiness: GradeCertificateReadinessResult;
  certificate: unknown;
};

export type IssueGradeCertificateInput = {
  tenantId: string;
  certificateId: string;
  publicReportKey: string;
  actorOperatorId: string;
  actorUserId?: string | null;
  reasonCode?: string | null;
  issuedAt?: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type IssuedGradeCertificate = {
  readiness: GradeCertificateReadinessResult;
  certificate: GradeCertificateState;
  updatedCount: number;
  auditEvent: unknown;
};

export type RevokeGradeCertificateInput = {
  tenantId: string;
  certificateId: string;
  revocationReason: string;
  actorOperatorId: string;
  actorUserId?: string | null;
  revokedAt?: string | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type RevokedGradeCertificate = {
  certificate: GradeCertificateState;
  updatedCount: number;
  auditEvent: unknown;
};

export type LinkedEvidenceArtifact = {
  artifact: unknown;
  scopes: {
    captureSession?: CaptureSessionState;
    gradeRun?: GradeRunState;
    authRun?: AuthRunScope;
    certificate?: GradeCertificateScope;
  };
};

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const NAMED_ERROR_STATES = new Set<OrchestratorState>(ORCHESTRATOR_NAMED_ERROR_STATES);
const REQUIRED_MICRO_SPOT_FRAME_KEYS: MicroSpotFrameKey[] = [
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
];
const AUTH_RUN_STATUSES = new Set<AuthRunStatus>(["PENDING", "RUNNING", "COMPLETE", "FAILED"]);
const AUTH_VERDICTS = new Set<AuthVerdict>([
  "REFERENCE_NEEDED",
  "AUTHENTIC",
  "PROBABLY_AUTHENTIC",
  "SUSPICIOUS",
  "LIKELY_COUNTERFEIT",
]);
const CERTIFICATE_ACCEPTABLE_AUTH_VERDICTS = new Set<AuthVerdict>([
  "REFERENCE_NEEDED",
  "AUTHENTIC",
  "PROBABLY_AUTHENTIC",
]);
const BLOCKING_PHYSICAL_GATE_STATUSES = new Set(["FAIL", "BLOCK", "REVIEW"]);

const captureSessionStateSelect = {
  id: true,
  tenantId: true,
  rigId: true,
  locationId: true,
  operatorId: true,
  helperInstanceId: true,
  gradingMode: true,
  status: true,
  currentState: true,
  errorCode: true,
  rawCardOnly: true,
  physicalGateResults: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const gradeRunStateSelect = {
  id: true,
  captureSessionId: true,
  captureManifestId: true,
  algorithmVersionId: true,
  thresholdSetVersionId: true,
  runtimeEnvironmentId: true,
  status: true,
  mode: true,
  inputChecksum: true,
  outputChecksum: true,
  macroMeasurements: true,
  microMeasurements: true,
  fusionActions: true,
  finalGrades: true,
  confidence: true,
  warnings: true,
  errorCode: true,
  startedAt: true,
  finishedAt: true,
} as const;

const authRunStateSelect = {
  id: true,
  tenantId: true,
  captureSessionId: true,
  captureManifestId: true,
  algorithmVersionId: true,
  runtimeEnvironmentId: true,
  cardPrintProfileId: true,
  cardSet: true,
  cardNumber: true,
  printRun: true,
  verdict: true,
  distance: true,
  status: true,
  measurements: true,
  evidence: true,
  inputChecksum: true,
  outputChecksum: true,
  errorCode: true,
  startedAt: true,
  finishedAt: true,
} as const;

const authRunScopeSelect = authRunStateSelect;

const cardPrintProfileStateSelect = {
  id: true,
  tenantId: true,
  cardSet: true,
  cardNumber: true,
  printRun: true,
  printRunKey: true,
  state: true,
  referenceFingerprint: true,
  referenceAuthRunId: true,
  approvedByOperatorId: true,
  approvedAt: true,
  version: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} as const;

const gradeCertificateStateSelect = {
  id: true,
  tenantId: true,
  gradeRunId: true,
  authRunId: true,
  publicSlug: true,
  certificateNumber: true,
  status: true,
  mode: true,
  finalGrades: true,
  publicReportKey: true,
  custodyStatus: true,
  issuedAt: true,
  revokedAt: true,
  revocationReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

const gradeCertificateScopeSelect = gradeCertificateStateSelect;

const evidenceArtifactStateSelect = {
  id: true,
  tenantId: true,
  captureSessionId: true,
  gradeRunId: true,
  authRunId: true,
  certificateId: true,
  evidenceClass: true,
  kind: true,
  storageKey: true,
  checksumSha256: true,
  mimeType: true,
  byteSize: true,
  widthPx: true,
  heightPx: true,
  retentionUntil: true,
  publicUrl: true,
  metadata: true,
  createdAt: true,
} as const;

const operatorOverrideStateSelect = {
  id: true,
  tenantId: true,
  captureSessionId: true,
  gradeRunId: true,
  certificateId: true,
  reviewStatus: true,
} as const;

const custodyEventStateSelect = {
  id: true,
  tenantId: true,
  certificateId: true,
  captureSessionId: true,
  type: true,
} as const;

export class AiGraderServiceValidationError extends Error {
  readonly issues: AiGraderValidationIssue[];

  constructor(message: string, issues: AiGraderValidationIssue[]) {
    super(message);
    this.name = "AiGraderServiceValidationError";
    this.issues = issues;
  }
}

function issue(
  path: string,
  code: AiGraderValidationIssueCode,
  message: string
): AiGraderValidationIssue {
  return { path, code, message };
}

function requireNonEmptyString(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(issue(path, "REQUIRED", `${path} is required.`));
  }
}

function throwIfInvalid(message: string, issues: AiGraderValidationIssue[]) {
  if (issues.length > 0) {
    throw new AiGraderServiceValidationError(message, issues);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prefixedIssue(pathPrefix: string, entry: AiGraderValidationIssue): AiGraderValidationIssue {
  if (entry.path.length === 0) {
    return { ...entry, path: pathPrefix };
  }
  return { ...entry, path: `${pathPrefix}.${entry.path}` };
}

function validateCaptureSessionDraftInput(input: CreateCaptureSessionDraftInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.rigId, "captureSession.rigId", issues);
  requireNonEmptyString(input.locationId, "captureSession.locationId", issues);
  requireNonEmptyString(input.operatorId, "captureSession.operatorId", issues);
  if (input.id != null) requireNonEmptyString(input.id, "captureSession.id", issues);
  if (input.helperInstanceId != null) {
    requireNonEmptyString(input.helperInstanceId, "captureSession.helperInstanceId", issues);
  }

  throwIfInvalid("Invalid capture session draft input.", issues);
}

function validateReadCaptureSessionStateInput(input: ReadCaptureSessionStateInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "captureSession.id", issues);

  throwIfInvalid("Invalid capture session state input.", issues);
}

function validateOrchestratorTransitionInput(input: PersistOrchestratorTransitionInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "captureSession.id", issues);
  requireNonEmptyString(input.event, "orchestrator.event", issues);
  if (input.errorCode != null) requireNonEmptyString(input.errorCode, "orchestrator.errorCode", issues);
  if (input.reasonCode != null) requireNonEmptyString(input.reasonCode, "orchestrator.reasonCode", issues);

  throwIfInvalid("Invalid orchestrator transition input.", issues);
}

function validateMacroSuspectRegionCollection(
  regions: unknown,
  input: Pick<PersistMacroSuspectRegionsInput, "captureSessionId" | "side">
): AiGraderValidationIssue[] {
  const issues: AiGraderValidationIssue[] = [];

  if (!Array.isArray(regions)) {
    issues.push(issue("macroSuspectRegions", "INVALID_ARRAY", "macroSuspectRegions must be an array."));
    return issues;
  }

  const ranks = new Set<number>();
  const ids = new Set<string>();
  regions.forEach((region, index) => {
    const path = `macroSuspectRegions[${index}]`;
    const result = validateMacroSuspectRegion(region);
    issues.push(...result.issues.map((entry) => prefixedIssue(path, entry)));

    if (!isRecord(region)) {
      return;
    }

    if (region.sessionId !== input.captureSessionId) {
      issues.push(issue(`${path}.sessionId`, "INVALID_RECORD", "suspect sessionId must match captureSessionId."));
    }
    if (region.side !== input.side) {
      issues.push(issue(`${path}.side`, "INVALID_ENUM", "suspect side must match the requested side."));
    }
    if (typeof region.rank === "number" && Number.isInteger(region.rank) && region.rank >= 1) {
      if (ranks.has(region.rank)) {
        issues.push(issue(`${path}.rank`, "INVALID_RANK", "suspect ranks must be unique per session, side, and element."));
      }
      ranks.add(region.rank);
    }
    if (typeof region.id === "string" && region.id.trim().length > 0) {
      if (ids.has(region.id)) {
        issues.push(issue(`${path}.id`, "INVALID_RECORD", "suspect ids must be unique."));
      }
      ids.add(region.id);
    }
  });

  return issues;
}

function validatePersistMacroSuspectRegionsInput(input: PersistMacroSuspectRegionsInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "captureSession.id", issues);
  if (input.side !== "FRONT" && input.side !== "BACK") {
    issues.push(issue("macroSuspectRegions.side", "INVALID_ENUM", "side must be FRONT or BACK."));
  }
  issues.push(...validateMacroSuspectRegionCollection(input.regions, input));

  throwIfInvalid("Invalid macro suspect regions input.", issues);
}

function validateMacroPipelineCompletionInput(input: RecordMacroPipelineCompletionInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "captureSession.id", issues);
  if (input.reasonCode != null) requireNonEmptyString(input.reasonCode, "macroPipeline.reasonCode", issues);

  const result = validateMacroPipelineOutput(input.output);
  issues.push(...result.issues.map((entry) => prefixedIssue("macroPipeline", entry)));
  if (input.output?.sessionId !== input.captureSessionId) {
    issues.push(issue("macroPipeline.output.sessionId", "INVALID_RECORD", "macro output sessionId must match captureSessionId."));
  }
  if (input.output && Array.isArray(input.output.suspectRegions)) {
    issues.push(...validateMacroSuspectRegionCollection(input.output.suspectRegions, {
      captureSessionId: input.captureSessionId,
      side: input.output.side,
    }));
  }

  throwIfInvalid("Invalid macro pipeline completion input.", issues);
}

function validateSha256(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
    issues.push(issue(path, "INVALID_CHECKSUM", `${path} must be a 64-character hex SHA-256 digest.`));
  }
}

function validateRecordInput(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an object.`));
  }
}

function validateOptionalRecordInput(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (value != null) {
    validateRecordInput(value, path, issues);
  }
}

function validateWarnings(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    issues.push(issue(path, "INVALID_ARRAY", `${path} must be an array when provided.`));
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      issues.push(issue(`${path}[${index}]`, "REQUIRED", `${path}[${index}] must be a non-empty string.`));
    }
  });
}

function validateFinalGrades(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (!isRecord(value)) {
    issues.push(issue(path, "INVALID_RECORD", `${path} must be an object.`));
    return;
  }

  Object.entries(value).forEach(([key, grade]) => {
    if (typeof grade !== "number" || !Number.isFinite(grade)) {
      issues.push(issue(`${path}.${key}`, "INVALID_NUMBER", "final grade values must be finite numbers."));
    }
  });
}

function hasEvidenceSourceLinkage(artifact: EvidenceArtifactContract): boolean {
  return Boolean(
    artifact.captureSessionId ||
      artifact.gradeRunId ||
      artifact.authRunId ||
      artifact.certificateId
  );
}

function validatePersistMicroSpotPackageInput(input: PersistMicroSpotPackageInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "captureSession.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "captureSession.id", issues);

  const result = validateMicroSpotCapturePackage(input.microSpotPackage);
  issues.push(...result.issues.map((entry) => prefixedIssue("microSpotPackage", entry)));

  if (input.microSpotPackage?.sessionId !== input.captureSessionId) {
    issues.push(issue("microSpotPackage.sessionId", "INVALID_MICRO_PACKAGE", "micro package sessionId must match captureSessionId."));
  }
  if (input.microSpotPackage?.element === "CMYK_AUTHENTICATION") {
    issues.push(issue("microSpotPackage.element", "INVALID_ENUM", "STANDARD micro package persistence accepts CORNERS, EDGES, or SURFACE only."));
  }
  REQUIRED_MICRO_SPOT_FRAME_KEYS.forEach((frameKey) => {
    if (!input.microSpotPackage?.frames || input.microSpotPackage.frames[frameKey] == null) {
      issues.push(issue(`microSpotPackage.frames.${frameKey}`, "MISSING_FRAME", `${frameKey} is required.`));
    }
  });

  throwIfInvalid("Invalid micro spot package input.", issues);
}

function validateCreateGradeRunDraftInput(input: CreateGradeRunDraftInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "gradeRun.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "gradeRun.captureSessionId", issues);
  requireNonEmptyString(input.captureManifestId, "gradeRun.captureManifestId", issues);
  requireNonEmptyString(input.algorithmVersionId, "gradeRun.algorithmVersionId", issues);
  requireNonEmptyString(input.thresholdSetVersionId, "gradeRun.thresholdSetVersionId", issues);
  requireNonEmptyString(input.runtimeEnvironmentId, "gradeRun.runtimeEnvironmentId", issues);
  if (input.id != null) requireNonEmptyString(input.id, "gradeRun.id", issues);
  if (input.mode != null) requireNonEmptyString(input.mode, "gradeRun.mode", issues);
  if (input.status != null && input.status !== "PENDING" && input.status !== "RUNNING") {
    issues.push(issue("gradeRun.status", "INVALID_ENUM", "draft status must be PENDING or RUNNING."));
  }
  validateSha256(input.inputChecksum, "gradeRun.inputChecksum", issues);
  validateRecordInput(input.macroMeasurements, "gradeRun.macroMeasurements", issues);
  validateOptionalRecordInput(input.microMeasurements, "gradeRun.microMeasurements", issues);
  if (input.fusionActions != null && !Array.isArray(input.fusionActions)) {
    issues.push(issue("gradeRun.fusionActions", "INVALID_ARRAY", "fusionActions must be an array when provided."));
  }

  throwIfInvalid("Invalid grade run draft input.", issues);
}

function validateFinalizeGradeRunInput(input: FinalizeGradeRunInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "gradeRun.tenantId", issues);
  requireNonEmptyString(input.gradeRunId, "gradeRun.id", issues);
  validateSha256(input.outputChecksum, "gradeRun.outputChecksum", issues);
  validateFinalGrades(input.finalGrades, "gradeRun.finalGrades", issues);
  if (!Array.isArray(input.fusionActions)) {
    issues.push(issue("gradeRun.fusionActions", "INVALID_ARRAY", "fusionActions must be an array."));
  }
  validateOptionalRecordInput(input.macroMeasurements, "gradeRun.macroMeasurements", issues);
  validateOptionalRecordInput(input.microMeasurements, "gradeRun.microMeasurements", issues);
  validateOptionalRecordInput(input.confidence, "gradeRun.confidence", issues);
  validateWarnings(input.warnings, "gradeRun.warnings", issues);

  throwIfInvalid("Invalid grade run finalization input.", issues);
}

function printRunKeyFrom(printRun: string | null | undefined) {
  return printRun ?? "";
}

function requireOptionalSha256(value: unknown, path: string, issues: AiGraderValidationIssue[]) {
  if (value != null) {
    validateSha256(value, path, issues);
  }
}

function validateCardIdentityContractInput(value: CardIdentityInput, pathPrefix: string, issues: AiGraderValidationIssue[]) {
  const result = validateCardIdentityInput(value);
  issues.push(...result.issues.map((entry) => prefixedIssue(pathPrefix, entry)));
}

function validateCreateAuthRunDraftInput(input: CreateAuthRunDraftInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "authRun.tenantId", issues);
  requireNonEmptyString(input.captureSessionId, "authRun.captureSessionId", issues);
  requireNonEmptyString(input.captureManifestId, "authRun.captureManifestId", issues);
  requireNonEmptyString(input.algorithmVersionId, "authRun.algorithmVersionId", issues);
  requireNonEmptyString(input.runtimeEnvironmentId, "authRun.runtimeEnvironmentId", issues);
  if (input.id != null) requireNonEmptyString(input.id, "authRun.id", issues);
  if (input.cardPrintProfileId != null) requireNonEmptyString(input.cardPrintProfileId, "authRun.cardPrintProfileId", issues);
  if (input.status != null && input.status !== "PENDING" && input.status !== "RUNNING") {
    issues.push(issue("authRun.status", "INVALID_ENUM", "draft status must be PENDING or RUNNING."));
  }
  validateCardIdentityContractInput(input.cardIdentity, "authRun", issues);
  validateOptionalRecordInput(input.measurements, "authRun.measurements", issues);
  validateOptionalRecordInput(input.evidence, "authRun.evidence", issues);
  requireOptionalSha256(input.inputChecksum, "authRun.inputChecksum", issues);

  throwIfInvalid("Invalid auth run draft input.", issues);
}

function validateFinalizeAuthRunInput(input: FinalizeAuthRunInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "authRun.tenantId", issues);
  requireNonEmptyString(input.authRunId, "authRun.id", issues);
  requireNonEmptyString(input.requestedVerdict, "authRun.requestedVerdict", issues);
  if (input.requestedVerdict && !AUTH_VERDICTS.has(input.requestedVerdict)) {
    issues.push(issue("authRun.requestedVerdict", "INVALID_AUTH_VERDICT", "requestedVerdict must match AuthVerdict."));
  }
  if (input.status != null && input.status !== "COMPLETE" && input.status !== "FAILED") {
    issues.push(issue("authRun.status", "INVALID_ENUM", "final status must be COMPLETE or FAILED."));
  }
  if (input.distance != null && (typeof input.distance !== "number" || !Number.isFinite(input.distance) || input.distance < 0)) {
    issues.push(issue("authRun.distance", "INVALID_NUMBER", "distance must be a non-negative finite number when provided."));
  }
  validateRecordInput(input.measurements, "authRun.measurements", issues);
  validateRecordInput(input.evidence, "authRun.evidence", issues);
  requireOptionalSha256(input.outputChecksum, "authRun.outputChecksum", issues);
  if (input.errorCode != null) requireNonEmptyString(input.errorCode, "authRun.errorCode", issues);

  throwIfInvalid("Invalid auth run finalization input.", issues);
}

function validateCreateCandidateCardPrintProfileInput(input: CreateCandidateCardPrintProfileInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "cardPrintProfile.tenantId", issues);
  if (input.id != null) requireNonEmptyString(input.id, "cardPrintProfile.id", issues);
  validateCardIdentityContractInput(input.cardIdentity, "cardPrintProfile", issues);
  validateRecordInput(input.referenceFingerprint, "cardPrintProfile.referenceFingerprint", issues);
  if (input.referenceAuthRunId != null) requireNonEmptyString(input.referenceAuthRunId, "cardPrintProfile.referenceAuthRunId", issues);
  if (input.version != null && (!Number.isInteger(input.version) || input.version < 1)) {
    issues.push(issue("cardPrintProfile.version", "INVALID_VERSION", "version must be a positive integer."));
  }
  if (input.notes != null) requireNonEmptyString(input.notes, "cardPrintProfile.notes", issues);

  throwIfInvalid("Invalid card print profile candidate input.", issues);
}

function validateApproveCardPrintProfileInput(input: ApproveCardPrintProfileInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "cardPrintProfile.tenantId", issues);
  requireNonEmptyString(input.profileId, "cardPrintProfile.id", issues);
  requireNonEmptyString(input.cardSet, "cardPrintProfile.cardSet", issues);
  requireNonEmptyString(input.cardNumber, "cardPrintProfile.cardNumber", issues);
  if (input.printRun != null) requireNonEmptyString(input.printRun, "cardPrintProfile.printRun", issues);
  requireNonEmptyString(input.actorOperatorId, "cardPrintProfile.actorOperatorId", issues);
  requireNonEmptyString(input.reviewedByOperatorId, "cardPrintProfile.reviewedByOperatorId", issues);
  requireNonEmptyString(input.reasonCode, "cardPrintProfile.reasonCode", issues);
  if (input.toState != null && input.toState !== "CURATED_REFERENCE" && input.toState !== "ACTIVE") {
    issues.push(issue("cardPrintProfile.toState", "INVALID_ENUM", "approval state must be CURATED_REFERENCE or ACTIVE."));
  }
  if (input.notes != null) requireNonEmptyString(input.notes, "cardPrintProfile.notes", issues);

  throwIfInvalid("Invalid card print profile approval input.", issues);
}

function validateUpdateCardPrintProfileLifecycleInput(
  input: UpdateCardPrintProfileLifecycleInput,
  action: "quarantine" | "retire"
) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "cardPrintProfile.tenantId", issues);
  requireNonEmptyString(input.profileId, "cardPrintProfile.id", issues);
  requireNonEmptyString(input.cardSet, "cardPrintProfile.cardSet", issues);
  requireNonEmptyString(input.cardNumber, "cardPrintProfile.cardNumber", issues);
  if (input.printRun != null) requireNonEmptyString(input.printRun, "cardPrintProfile.printRun", issues);
  requireNonEmptyString(input.actorOperatorId, "cardPrintProfile.actorOperatorId", issues);
  requireNonEmptyString(input.reasonCode, `cardPrintProfile.${action}ReasonCode`, issues);
  if (input.notes != null) requireNonEmptyString(input.notes, "cardPrintProfile.notes", issues);

  throwIfInvalid(`Invalid card print profile ${action} input.`, issues);
}

function validateCheckGradeCertificateReadinessInput(input: CheckGradeCertificateReadinessInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "certificate.tenantId", issues);
  requireNonEmptyString(input.gradeRunId, "certificate.gradeRunId", issues);
  if (input.authRunId != null) requireNonEmptyString(input.authRunId, "certificate.authRunId", issues);
  if (input.certificateId != null) requireNonEmptyString(input.certificateId, "certificate.id", issues);
  if (input.publicSlug != null) requireNonEmptyString(input.publicSlug, "certificate.publicSlug", issues);
  if (input.certificateNumber != null) requireNonEmptyString(input.certificateNumber, "certificate.certificateNumber", issues);
  if (input.custodyStatus != null) requireNonEmptyString(input.custodyStatus, "certificate.custodyStatus", issues);

  throwIfInvalid("Invalid certificate readiness input.", issues);
}

function validateCreateGradeCertificateDraftInput(input: CreateGradeCertificateDraftInput) {
  validateCheckGradeCertificateReadinessInput(input);
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.publicSlug, "certificate.publicSlug", issues);
  requireNonEmptyString(input.certificateNumber, "certificate.certificateNumber", issues);

  throwIfInvalid("Invalid certificate draft input.", issues);
}

function validateIssueGradeCertificateInput(input: IssueGradeCertificateInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "certificate.tenantId", issues);
  requireNonEmptyString(input.certificateId, "certificate.id", issues);
  requireNonEmptyString(input.publicReportKey, "certificate.publicReportKey", issues);
  requireNonEmptyString(input.actorOperatorId, "certificate.actorOperatorId", issues);
  if (input.reasonCode != null) requireNonEmptyString(input.reasonCode, "certificate.reasonCode", issues);

  throwIfInvalid("Invalid certificate issue input.", issues);
}

function validateRevokeGradeCertificateInput(input: RevokeGradeCertificateInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "certificate.tenantId", issues);
  requireNonEmptyString(input.certificateId, "certificate.id", issues);
  requireNonEmptyString(input.revocationReason, "certificate.revocationReason", issues);
  requireNonEmptyString(input.actorOperatorId, "certificate.actorOperatorId", issues);

  throwIfInvalid("Invalid certificate revoke input.", issues);
}

function validateLinkEvidenceArtifactInput(artifact: EvidenceArtifactContract) {
  assertValidEvidenceArtifact(artifact);

  if (!hasEvidenceSourceLinkage(artifact)) {
    throw new AiGraderServiceValidationError("Invalid evidence artifact linkage.", [
      issue("evidenceArtifact", "INVALID_EVIDENCE_ARTIFACT", "evidence artifacts must link to a capture session, grade run, auth run, or certificate."),
    ]);
  }
}

function validateAuditEventInput(input: RecordAuditEventInput) {
  const issues: AiGraderValidationIssue[] = [];

  requireNonEmptyString(input.tenantId, "auditEvent.tenantId", issues);
  requireNonEmptyString(input.entityType, "auditEvent.entityType", issues);
  requireNonEmptyString(input.entityId, "auditEvent.entityId", issues);
  requireNonEmptyString(input.action, "auditEvent.action", issues);
  requireNonEmptyString(input.outcome, "auditEvent.outcome", issues);
  requireNonEmptyString(input.checksum, "auditEvent.checksum", issues);
  if (input.checksum && !SHA256_HEX_RE.test(input.checksum)) {
    issues.push(issue("auditEvent.checksum", "INVALID_CHECKSUM", "checksum must be a 64-character hex SHA-256 digest."));
  }

  throwIfInvalid("Invalid audit event input.", issues);
}

function optionalNullableJson(value: Prisma.InputJsonValue | null | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return value === null ? Prisma.JsonNull : value;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildAuditChecksum(value: unknown) {
  const encoded = new TextEncoder().encode(stableJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

function isoDate(value: string, path: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AiGraderServiceValidationError("Invalid timestamp.", [
      issue(path, "INVALID_TIMESTAMP", `${path} must be a valid timestamp.`),
    ]);
  }
  return parsed;
}

function optionalDate(value: string | Date | undefined, path: string) {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new AiGraderServiceValidationError("Invalid timestamp.", [
        issue(path, "INVALID_TIMESTAMP", `${path} must be a valid timestamp.`),
      ]);
    }
    return value;
  }
  return isoDate(value, path);
}

function dateFromOptional(value: string | Date | undefined, path: string) {
  return optionalDate(value, path) ?? new Date();
}

function timestampString(value: string | Date, path: string) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new AiGraderServiceValidationError("Invalid timestamp.", [
        issue(path, "INVALID_TIMESTAMP", `${path} must be a valid timestamp.`),
      ]);
    }
    return value.toISOString();
  }
  return isoDate(value, path).toISOString();
}

function optionalTimestampString(value: string | Date | null | undefined, path: string) {
  if (value == null) {
    return undefined;
  }
  return timestampString(value, path);
}

function nonNullRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function optionalString(value: string | null | undefined) {
  return value ?? undefined;
}

function assertValidManifest(manifest: CaptureManifest) {
  const result = validateCaptureManifest(manifest);
  throwIfInvalid("Invalid capture manifest.", result.issues);
}

function assertValidEvidenceArtifact(artifact: EvidenceArtifactContract) {
  const result = validateEvidenceArtifactContract(artifact);
  throwIfInvalid("Invalid evidence artifact.", result.issues);
}

function evidenceArtifactCreateData(artifact: EvidenceArtifactContract): EvidenceArtifactCreateData {
  return {
    id: artifact.id,
    tenantId: artifact.tenantId,
    captureSessionId: artifact.captureSessionId ?? null,
    gradeRunId: artifact.gradeRunId ?? null,
    authRunId: artifact.authRunId ?? null,
    certificateId: artifact.certificateId ?? null,
    evidenceClass: artifact.evidenceClass,
    kind: artifact.kind,
    storageKey: artifact.storageKey,
    checksumSha256: artifact.checksumSha256,
    mimeType: artifact.mimeType,
    byteSize: artifact.byteSize,
    widthPx: artifact.widthPx,
    heightPx: artifact.heightPx,
    retentionUntil: artifact.retentionUntil ? isoDate(artifact.retentionUntil, "evidenceArtifact.retentionUntil") : undefined,
    publicUrl: artifact.publicUrl,
    metadata: optionalNullableJson(artifact.metadata as Prisma.InputJsonValue | undefined),
    createdAt: isoDate(artifact.createdAt, "evidenceArtifact.createdAt"),
  };
}

function evidenceArtifactContractFromState(artifact: EvidenceArtifactState): EvidenceArtifactContract {
  return {
    id: artifact.id,
    tenantId: artifact.tenantId,
    ...(artifact.captureSessionId ? { captureSessionId: artifact.captureSessionId } : {}),
    ...(artifact.gradeRunId ? { gradeRunId: artifact.gradeRunId } : {}),
    ...(artifact.authRunId ? { authRunId: artifact.authRunId } : {}),
    ...(artifact.certificateId ? { certificateId: artifact.certificateId } : {}),
    evidenceClass: artifact.evidenceClass,
    kind: artifact.kind,
    storageKey: artifact.storageKey,
    checksumSha256: artifact.checksumSha256,
    mimeType: artifact.mimeType,
    ...(artifact.byteSize != null ? { byteSize: artifact.byteSize } : {}),
    ...(artifact.widthPx != null ? { widthPx: artifact.widthPx } : {}),
    ...(artifact.heightPx != null ? { heightPx: artifact.heightPx } : {}),
    ...(artifact.retentionUntil ? { retentionUntil: artifact.retentionUntil.toISOString() } : {}),
    ...(artifact.publicUrl ? { publicUrl: artifact.publicUrl } : {}),
    ...(isRecord(artifact.metadata) ? { metadata: artifact.metadata } : {}),
    createdAt: artifact.createdAt.toISOString(),
  };
}

function cardPrintProfileContractFromState(profile: CardPrintProfileState): CardPrintProfileContract {
  return {
    id: profile.id,
    tenantId: profile.tenantId,
    cardSet: profile.cardSet,
    cardNumber: profile.cardNumber,
    ...(profile.printRun ? { printRun: profile.printRun } : {}),
    printRunKey: profile.printRunKey,
    state: profile.state,
    referenceFingerprint: nonNullRecord(profile.referenceFingerprint),
    ...(profile.referenceAuthRunId ? { referenceAuthRunId: profile.referenceAuthRunId } : {}),
    ...(profile.approvedByOperatorId ? { approvedByOperatorId: profile.approvedByOperatorId } : {}),
    ...(profile.approvedAt ? { approvedAt: profile.approvedAt.toISOString() } : {}),
    version: profile.version,
    ...(profile.notes ? { notes: profile.notes } : {}),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function cardPrintProfileContractFromCreateData(data: CardPrintProfileCreateData, now: Date): CardPrintProfileContract {
  return {
    id: data.id ?? "card-print-profile-draft",
    tenantId: data.tenantId,
    cardSet: data.cardSet,
    cardNumber: data.cardNumber,
    ...(data.printRun ? { printRun: data.printRun } : {}),
    printRunKey: data.printRunKey,
    state: data.state,
    referenceFingerprint: nonNullRecord(data.referenceFingerprint),
    ...(data.referenceAuthRunId ? { referenceAuthRunId: data.referenceAuthRunId } : {}),
    ...(data.approvedByOperatorId ? { approvedByOperatorId: data.approvedByOperatorId } : {}),
    ...(data.approvedAt ? { approvedAt: data.approvedAt.toISOString() } : {}),
    version: data.version ?? 1,
    ...(data.notes ? { notes: data.notes } : {}),
    createdAt: (data.createdAt ?? now).toISOString(),
    updatedAt: (data.updatedAt ?? now).toISOString(),
  };
}

function authRunContractFromData(
  data: AuthRunContractSource,
  profileState?: PrintProfileStatus
): AuthRunContract {
  return {
    id: data.id ?? "auth-run-draft",
    ...(data.captureSessionId ? { captureSessionId: data.captureSessionId } : {}),
    ...(data.captureManifestId ? { captureManifestId: data.captureManifestId } : {}),
    algorithmVersionId: data.algorithmVersionId,
    runtimeEnvironmentId: data.runtimeEnvironmentId,
    ...(data.cardPrintProfileId ? { cardPrintProfileId: data.cardPrintProfileId } : {}),
    tenantId: data.tenantId,
    cardSet: data.cardSet,
    cardNumber: data.cardNumber,
    ...(data.printRun ? { printRun: data.printRun } : {}),
    verdict: data.verdict,
    ...(data.distance != null ? { distance: data.distance } : {}),
    status: data.status,
    measurements: nonNullRecord(data.measurements),
    evidence: nonNullRecord(data.evidence),
    ...(data.inputChecksum ? { inputChecksum: data.inputChecksum } : {}),
    ...(data.outputChecksum ? { outputChecksum: data.outputChecksum } : {}),
    ...(data.errorCode ? { errorCode: data.errorCode } : {}),
    startedAt: timestampString(data.startedAt ?? new Date(), "authRun.startedAt"),
    ...(data.finishedAt ? { finishedAt: timestampString(data.finishedAt, "authRun.finishedAt") } : {}),
    ...(profileState ? { profileState } : {}),
  };
}

function gradeCertificateContractFromState(
  certificate: GradeCertificateState,
  sourceGradeRunStatus?: GradeRunStatus
): GradeCertificateContract {
  return {
    id: certificate.id,
    tenantId: certificate.tenantId,
    gradeRunId: certificate.gradeRunId,
    ...(certificate.authRunId ? { authRunId: certificate.authRunId } : {}),
    publicSlug: certificate.publicSlug,
    certificateNumber: certificate.certificateNumber,
    status: certificate.status,
    mode: certificate.mode,
    ...(isRecord(certificate.finalGrades) ? { finalGrades: certificate.finalGrades as Record<string, number> } : {}),
    ...(certificate.publicReportKey ? { publicReportKey: certificate.publicReportKey } : {}),
    custodyStatus: certificate.custodyStatus,
    ...(certificate.issuedAt ? { issuedAt: certificate.issuedAt.toISOString() } : {}),
    ...(certificate.revokedAt ? { revokedAt: certificate.revokedAt.toISOString() } : {}),
    ...(certificate.revocationReason ? { revocationReason: certificate.revocationReason } : {}),
    ...(sourceGradeRunStatus ? { sourceGradeRunStatus } : {}),
    createdAt: certificate.createdAt.toISOString(),
    updatedAt: certificate.updatedAt.toISOString(),
  };
}

function gradeCertificateContractFromCreateData(
  data: GradeCertificateCreateData,
  gradeRun: GradeRunState,
  now: Date
): GradeCertificateContract {
  return {
    id: data.id ?? "certificate-draft",
    tenantId: data.tenantId,
    gradeRunId: data.gradeRunId,
    ...(data.authRunId ? { authRunId: data.authRunId } : {}),
    publicSlug: data.publicSlug,
    certificateNumber: data.certificateNumber,
    status: data.status,
    mode: data.mode,
    ...(isRecord(data.finalGrades) ? { finalGrades: data.finalGrades as Record<string, number> } : {}),
    ...(data.publicReportKey ? { publicReportKey: data.publicReportKey } : {}),
    custodyStatus: data.custodyStatus,
    ...(data.issuedAt ? { issuedAt: data.issuedAt.toISOString() } : {}),
    ...(data.revokedAt ? { revokedAt: data.revokedAt.toISOString() } : {}),
    ...(data.revocationReason ? { revocationReason: data.revocationReason } : {}),
    sourceGradeRunStatus: gradeRun.status,
    createdAt: (data.createdAt ?? now).toISOString(),
    updatedAt: (data.updatedAt ?? now).toISOString(),
  };
}

function statusForOrchestratorState(state: OrchestratorState): CaptureSessionPersistedStatus {
  if (state === "INIT") return "CREATED";
  if (state === "COMPLETE") return "COMPLETE";
  if (state === "ABORTED") return "ABORTED";
  if (state === "PAUSED_OPERATOR_TIMEOUT") return "PAUSED";
  if (state === "MICRO_INCOMPLETE_REQUIRES_REVIEW") return "MICRO_INCOMPLETE_REQUIRES_REVIEW";
  if (state === "PHYSICAL_GATE_REVIEW") return "PHYSICAL_GATE_REVIEW";
  if (state === "REVIEW" || state === "OPERATOR_OVERRIDE_PENDING" || NAMED_ERROR_STATES.has(state)) return "REVIEW";
  return "RUNNING";
}

function errorCodeForOrchestratorState(
  state: OrchestratorState,
  input: Pick<PersistOrchestratorTransitionInput, "errorCode" | "reasonCode">
) {
  if (!NAMED_ERROR_STATES.has(state)) {
    return null;
  }
  if (state === "ABORTED" && input.reasonCode) {
    return input.reasonCode;
  }
  return input.errorCode ?? input.reasonCode ?? state;
}

function auditOutcomeForStatus(status: CaptureSessionPersistedStatus): RecordAuditEventInput["outcome"] {
  if (status === "ABORTED") return "FAILURE";
  if (
    status === "PAUSED" ||
    status === "MICRO_INCOMPLETE_REQUIRES_REVIEW" ||
    status === "PHYSICAL_GATE_REVIEW" ||
    status === "REVIEW"
  ) {
    return "WARNING";
  }
  return "SUCCESS";
}

async function buildTransitionAuditInput(
  session: CaptureSessionState,
  input: PersistOrchestratorTransitionInput,
  nextState: OrchestratorState,
  status: CaptureSessionPersistedStatus,
  errorCode: string | null,
  occurredAt: Date,
  transitionAuditEventId: string,
  userVisibleMessage?: string
): Promise<RecordAuditEventInput> {
  const before = {
    currentState: session.currentState,
    status: session.status,
    errorCode: session.errorCode,
  };
  const after = {
    currentState: nextState,
    status,
    errorCode,
    event: input.event,
    guardResults: input.guardResults ?? {},
    transitionAuditEventId,
    userVisibleMessage: userVisibleMessage ?? null,
  };
  const checksum = await buildAuditChecksum({
    tenantId: input.tenantId,
    captureSessionId: input.captureSessionId,
    before,
    after,
    occurredAt: occurredAt.toISOString(),
  });

  return {
    tenantId: input.tenantId,
    actorOperatorId: input.actorOperatorId ?? null,
    actorUserId: input.actorUserId ?? null,
    entityType: "CaptureSession",
    entityId: input.captureSessionId,
    action: "ai_grader.orchestrator.transition",
    outcome: auditOutcomeForStatus(status),
    before: before as Prisma.InputJsonValue,
    after: after as Prisma.InputJsonValue,
    reasonCode: input.reasonCode ?? input.errorCode ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    checksum,
    createdAt: occurredAt,
  };
}

async function buildMacroPipelineCompletionAuditInput(
  session: CaptureSessionState,
  input: RecordMacroPipelineCompletionInput,
  occurredAt: Date
): Promise<RecordAuditEventInput> {
  const output = input.output;
  const before = {
    currentState: session.currentState,
    status: session.status,
    errorCode: session.errorCode,
  };
  const after = {
    sessionId: output.sessionId,
    side: output.side,
    captureManifestId: output.captureManifestId,
    algorithmVersionId: output.algorithmVersionId,
    thresholdSetVersionId: output.thresholdSetVersionId,
    suspectRegionCount: output.suspectRegions.length,
    physicalGateResultCount: output.physicalGateResults.length,
    evidenceArtifactCount: output.evidenceArtifacts.length,
    provisionalGrades: output.provisionalGrades,
    macroMeasurements: output.macroMeasurements,
    advanceOrchestrator: input.advanceOrchestrator === true,
  };
  const checksum = await buildAuditChecksum({
    tenantId: input.tenantId,
    captureSessionId: input.captureSessionId,
    before,
    after,
    occurredAt: occurredAt.toISOString(),
  });

  return {
    tenantId: input.tenantId,
    actorOperatorId: input.actorOperatorId ?? null,
    actorUserId: input.actorUserId ?? null,
    entityType: "CaptureSession",
    entityId: input.captureSessionId,
    action: "ai_grader.macro_pipeline.completed",
    outcome: "SUCCESS",
    before: before as Prisma.InputJsonValue,
    after: after as Prisma.InputJsonValue,
    reasonCode: input.reasonCode ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    checksum,
    createdAt: occurredAt,
  };
}

function transitionUpdateData(
  session: CaptureSessionState,
  nextState: OrchestratorState,
  status: CaptureSessionPersistedStatus,
  errorCode: string | null,
  occurredAt: Date
): CaptureSessionUpdateData {
  return {
    currentState: nextState,
    status,
    errorCode,
    ...(status === "RUNNING" && !session.startedAt ? { startedAt: occurredAt } : {}),
    ...(status === "COMPLETE" || status === "ABORTED" ? { finishedAt: occurredAt } : {}),
  };
}

function runInAiGraderTransaction<T>(
  db: AiGraderServicePrismaClient,
  fn: (tx: AiGraderServiceTransactionClient) => Promise<T>
) {
  if (db.$transaction) {
    return db.$transaction(fn);
  }
  return fn(db);
}

function macroSuspectRegionCreateData(region: MacroSuspectRegion): GradingSuspectRegionCreateData {
  return {
    id: region.id,
    sessionId: region.sessionId,
    side: region.side,
    element: "SURFACE",
    rank: region.rank,
    score: region.score,
    threshold: region.threshold,
    reasonCodes: region.reasonCodes,
    cardMm: region.cardMm as unknown as Prisma.InputJsonValue,
    warpedPx: region.warpedPx as unknown as Prisma.InputJsonValue,
    sourcePx: region.sourcePx as unknown as Prisma.InputJsonValue | undefined,
    heatmapStorageKey: region.heatmapStorageKey,
    macroCaptureIds: region.macroCaptureIds,
    thresholdSetId: region.thresholdSetId,
  };
}

function evidenceArtifactRefId(
  microSpotPackage: MicroSpotCapturePackage,
  frameKey: MicroSpotFrameKey,
  frame: EvidenceArtifactRef
) {
  return frame.id ?? `${microSpotPackage.id}:${frameKey}`;
}

function microSpotFrameEvidenceArtifact(
  input: PersistMicroSpotPackageInput,
  frameKey: MicroSpotFrameKey,
  frame: EvidenceArtifactRef,
  createdAt: Date
): EvidenceArtifactContract {
  const microSpotPackage = input.microSpotPackage;
  return {
    id: evidenceArtifactRefId(microSpotPackage, frameKey, frame),
    tenantId: input.tenantId,
    captureSessionId: input.captureSessionId,
    evidenceClass: "ORIGINAL",
    kind: "MICRO_SPOT_FRAME",
    storageKey: frame.storageKey,
    checksumSha256: frame.checksumSha256,
    mimeType: frame.mimeType ?? "image/tiff",
    byteSize: frame.byteSize,
    widthPx: frame.widthPx,
    heightPx: frame.heightPx,
    metadata: {
      captureManifestId: microSpotPackage.captureManifestId,
      microSpotPackageId: microSpotPackage.id,
      frameKey,
      side: microSpotPackage.side,
      element: microSpotPackage.element,
      spotIndex: microSpotPackage.spotIndex,
      totalSpots: microSpotPackage.totalSpots,
      sourceSuspectRegionId: microSpotPackage.sourceSuspectRegionId ?? null,
      stageXMicrons: microSpotPackage.stageXMicrons,
      stageYMicrons: microSpotPackage.stageYMicrons,
      microMagnification: microSpotPackage.microMagnification,
      amrReading: microSpotPackage.amrReading,
      focusScore: microSpotPackage.focusScore,
      validForClassification: microSpotPackage.validForClassification,
    },
    createdAt: createdAt.toISOString(),
  };
}

async function microSpotPackageEvidenceArtifacts(
  input: PersistMicroSpotPackageInput,
  createdAt: Date
): Promise<EvidenceArtifactContract[]> {
  const frameArtifacts = REQUIRED_MICRO_SPOT_FRAME_KEYS.map((frameKey) =>
    microSpotFrameEvidenceArtifact(input, frameKey, input.microSpotPackage.frames[frameKey], createdAt)
  );
  const packageChecksum = await buildAuditChecksum({
    tenantId: input.tenantId,
    captureSessionId: input.captureSessionId,
    microSpotPackage: input.microSpotPackage,
    frameArtifactIds: frameArtifacts.map((artifact) => artifact.id),
  });

  return [
    {
      id: `${input.microSpotPackage.id}:metadata`,
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
      evidenceClass: "DERIVED",
      kind: "MICRO_SPOT_PACKAGE_METADATA",
      storageKey: `ai-grader/${input.captureSessionId}/micro-packages/${encodeURIComponent(input.microSpotPackage.id)}.json`,
      checksumSha256: packageChecksum,
      mimeType: "application/json",
      metadata: {
        captureManifestId: input.microSpotPackage.captureManifestId,
        microSpotPackage: input.microSpotPackage,
        frameArtifactIds: frameArtifacts.map((artifact) => artifact.id),
      },
      createdAt: createdAt.toISOString(),
    },
    ...frameArtifacts,
  ];
}

function standardFusionOutputForFinalization(
  input: FinalizeGradeRunInput,
  gradeRun: GradeRunState
): StandardFusionOutput {
  return {
    gradeRunDraft: {
      macroMeasurements: input.macroMeasurements ?? (gradeRun.macroMeasurements as Record<string, unknown>),
      microMeasurements:
        input.microMeasurements ??
        (gradeRun.microMeasurements as Record<string, unknown> | null) ??
        {},
      fusionActions: input.fusionActions,
      finalGrades: input.finalGrades,
      warnings: input.warnings ?? [],
    },
  };
}

export async function createCaptureSessionDraft(
  db: AiGraderServicePrismaClient,
  input: CreateCaptureSessionDraftInput
) {
  validateCaptureSessionDraftInput(input);

  const data: CaptureSessionDraftCreateData = {
    ...(input.id ? { id: input.id } : {}),
    tenantId: input.tenantId,
    rigId: input.rigId,
    locationId: input.locationId,
    operatorId: input.operatorId,
    helperInstanceId: input.helperInstanceId ?? null,
    gradingMode: input.gradingMode ?? "STANDARD",
    status: "CREATED",
    currentState: input.currentState ?? "INIT",
    rawCardOnly: input.rawCardOnly ?? true,
    cardIdentity: optionalNullableJson(input.cardIdentity),
    physicalGateResults: optionalNullableJson(input.physicalGateResults),
  };

  return db.captureSession.create({ data });
}

export async function recordCaptureManifest(
  db: AiGraderServicePrismaClient,
  manifest: CaptureManifest
) {
  assertValidManifest(manifest);

  const data: CaptureManifestCreateData = {
    id: manifest.id,
    captureSessionId: manifest.captureSessionId,
    tenantId: manifest.tenantId,
    rigId: manifest.rigId,
    locationId: manifest.locationId,
    operatorId: manifest.operatorId,
    helperInstanceId: manifest.helperInstanceId,
    helperVersion: manifest.helperVersion,
    driverVersions: manifest.driverVersions as Prisma.InputJsonValue,
    componentSerials: manifest.componentSerials as Prisma.InputJsonValue,
    calibrationSnapshotIds: manifest.calibrationSnapshotIds,
    frameList: manifest.frameList as unknown as Prisma.InputJsonValue,
    operatorPrompts: manifest.operatorPrompts as unknown as Prisma.InputJsonValue,
    deviceHealth: manifest.deviceHealth as unknown as Prisma.InputJsonValue,
    checksum: manifest.checksumSha256,
    createdAt: isoDate(manifest.createdAt, "manifest.createdAt"),
  };

  return db.captureManifest.create({ data });
}

export async function recordEvidenceArtifact(
  db: AiGraderServicePrismaClient,
  artifact: EvidenceArtifactContract
) {
  assertValidEvidenceArtifact(artifact);

  return db.evidenceArtifact.create({ data: evidenceArtifactCreateData(artifact) });
}

export async function recordAuditEvent(
  db: AiGraderServicePrismaClient,
  input: RecordAuditEventInput
) {
  validateAuditEventInput(input);

  const data: AuditEventCreateData = {
    ...(input.id ? { id: input.id } : {}),
    tenantId: input.tenantId,
    actorOperatorId: input.actorOperatorId ?? null,
    actorUserId: input.actorUserId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    outcome: input.outcome,
    before: optionalNullableJson(input.before),
    after: optionalNullableJson(input.after),
    reasonCode: input.reasonCode ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    checksum: input.checksum,
    createdAt: optionalDate(input.createdAt, "auditEvent.createdAt"),
  };

  return db.auditEvent.create({ data });
}

export async function persistMacroSuspectRegions(
  db: AiGraderServicePrismaClient,
  input: PersistMacroSuspectRegionsInput
): Promise<PersistedMacroSuspectRegions> {
  validatePersistMacroSuspectRegionsInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for tenant.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession was not found for the supplied tenant and session id."),
      ]);
    }

    if (input.regions.length === 0) {
      return {
        session,
        side: input.side,
        count: 0,
        regions: [],
      };
    }

    const result = await tx.gradingSuspectRegion.createMany({
      data: input.regions.map(macroSuspectRegionCreateData),
    });

    return {
      session,
      side: input.side,
      count: result.count,
      regions: input.regions.map((region) => ({ ...region })),
    };
  });
}

export async function recordMacroPipelineCompletion(
  db: AiGraderServicePrismaClient,
  input: RecordMacroPipelineCompletionInput
): Promise<RecordedMacroPipelineCompletion> {
  validateMacroPipelineCompletionInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for tenant.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession was not found for the supplied tenant and session id."),
      ]);
    }

    const occurredAt = dateFromOptional(input.occurredAt, "macroPipeline.occurredAt");
    const orchestratorTransition = input.advanceOrchestrator
      ? await persistOrchestratorTransition(tx, {
          tenantId: input.tenantId,
          captureSessionId: input.captureSessionId,
          event: "MACRO_PIPELINE_COMPLETE",
          guardResults: {
            macroOutputValid: true,
            mode: session.gradingMode,
            ...(input.orchestratorGuardResults ?? {}),
          },
          actorOperatorId: input.actorOperatorId ?? null,
          actorUserId: input.actorUserId ?? null,
          reasonCode: input.reasonCode ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          occurredAt,
        })
      : undefined;

    const auditEvent = await recordAuditEvent(
      tx,
      await buildMacroPipelineCompletionAuditInput(session, input, occurredAt)
    );

    return {
      session,
      auditEvent,
      ...(orchestratorTransition ? { orchestratorTransition } : {}),
    };
  });
}

export async function persistMicroSpotPackage(
  db: AiGraderServicePrismaClient,
  input: PersistMicroSpotPackageInput
): Promise<PersistedMicroSpotPackage> {
  validatePersistMicroSpotPackageInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for tenant.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession was not found for the supplied tenant and session id."),
      ]);
    }

    const createdAt = dateFromOptional(input.createdAt ?? input.microSpotPackage.capturedAt, "microSpotPackage.createdAt");
    const artifacts = await microSpotPackageEvidenceArtifacts(input, createdAt);
    artifacts.forEach(assertValidEvidenceArtifact);

    const persistedArtifacts = [];
    for (const artifact of artifacts) {
      persistedArtifacts.push(await tx.evidenceArtifact.create({ data: evidenceArtifactCreateData(artifact) }));
    }

    return {
      session,
      microSpotPackage: { ...input.microSpotPackage },
      evidenceArtifacts: persistedArtifacts,
    };
  });
}

export async function createGradeRunDraft(
  db: AiGraderServicePrismaClient,
  input: CreateGradeRunDraftInput
): Promise<CreatedGradeRunDraft> {
  validateCreateGradeRunDraftInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for tenant.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession was not found for the supplied tenant and session id."),
      ]);
    }

    const mode = input.mode ?? session.gradingMode;
    if (input.mode != null && input.mode !== session.gradingMode) {
      throw new AiGraderServiceValidationError("Grade run mode does not match capture session.", [
        issue("gradeRun.mode", "INVALID_RECORD", "grade run mode must match the scoped capture session gradingMode."),
      ]);
    }

    const data: GradeRunCreateData = {
      ...(input.id ? { id: input.id } : {}),
      captureSessionId: input.captureSessionId,
      captureManifestId: input.captureManifestId,
      algorithmVersionId: input.algorithmVersionId,
      thresholdSetVersionId: input.thresholdSetVersionId,
      runtimeEnvironmentId: input.runtimeEnvironmentId,
      status: input.status ?? "RUNNING",
      mode,
      inputChecksum: input.inputChecksum,
      macroMeasurements: input.macroMeasurements as Prisma.InputJsonValue,
      microMeasurements: optionalNullableJson(input.microMeasurements as Prisma.InputJsonValue | null | undefined),
      fusionActions: (input.fusionActions ?? []) as unknown as Prisma.InputJsonValue,
      startedAt: optionalDate(input.startedAt, "gradeRun.startedAt"),
    };

    return {
      session,
      gradeRun: await tx.gradeRun.create({ data }),
    };
  });
}

export async function finalizeGradeRun(
  db: AiGraderServicePrismaClient,
  input: FinalizeGradeRunInput
): Promise<FinalizedGradeRun> {
  validateFinalizeGradeRunInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const gradeRun = await tx.gradeRun.findFirst({
      where: {
        id: input.gradeRunId,
        captureSession: { tenantId: input.tenantId },
      },
      select: gradeRunStateSelect,
    });

    if (!gradeRun) {
      throw new AiGraderServiceValidationError("Grade run not found for tenant.", [
        issue("gradeRun", "INVALID_RECORD", "GradeRun was not found for the supplied tenant and grade run id."),
      ]);
    }
    if (gradeRun.status !== "PENDING" && gradeRun.status !== "RUNNING") {
      throw new AiGraderServiceValidationError("Grade run cannot be finalized from current status.", [
        issue("gradeRun.status", "INVALID_RECORD", "GradeRun finalization requires PENDING or RUNNING status."),
      ]);
    }
    if (gradeRun.mode === "STANDARD" && input.fusionActions.length === 0) {
      throw new AiGraderServiceValidationError("STANDARD grade run finalization requires fusion actions.", [
        issue("gradeRun.fusionActions", "EMPTY_ARRAY", "STANDARD completion requires at least one fusion action."),
      ]);
    }

    if (gradeRun.mode === "STANDARD") {
      const fusionResult = validateStandardFusionOutput(standardFusionOutputForFinalization(input, gradeRun));
      throwIfInvalid("Invalid STANDARD grade run finalization payload.", fusionResult.issues);
    }

    const update = await tx.gradeRun.updateMany({
      where: {
        id: input.gradeRunId,
        captureSession: { tenantId: input.tenantId },
      },
      data: {
        status: "COMPLETE",
        outputChecksum: input.outputChecksum,
        macroMeasurements: input.macroMeasurements as Prisma.InputJsonValue | undefined,
        microMeasurements: optionalNullableJson(input.microMeasurements as Prisma.InputJsonValue | null | undefined),
        fusionActions: input.fusionActions as unknown as Prisma.InputJsonValue,
        finalGrades: input.finalGrades as Prisma.InputJsonValue,
        confidence: optionalNullableJson(input.confidence as Prisma.InputJsonValue | null | undefined),
        warnings: optionalNullableJson((input.warnings ?? []) as Prisma.InputJsonValue),
        errorCode: null,
        finishedAt: dateFromOptional(input.finishedAt, "gradeRun.finishedAt"),
      },
    });

    if (update.count !== 1) {
      throw new AiGraderServiceValidationError("Grade run update failed.", [
        issue("gradeRun", "INVALID_RECORD", "GradeRun update did not match exactly one scoped row."),
      ]);
    }

    return {
      gradeRun,
      updatedCount: update.count,
    };
  });
}

async function readCardPrintProfileById(
  tx: AiGraderServiceTransactionClient,
  input: { tenantId: string; profileId: string }
) {
  return tx.cardPrintProfile.findFirst({
    where: {
      id: input.profileId,
      tenantId: input.tenantId,
    },
    select: cardPrintProfileStateSelect,
  });
}

async function readActiveCardPrintProfileForIdentity(
  tx: AiGraderServiceTransactionClient,
  input: { tenantId: string; cardIdentity: CardIdentityInput }
) {
  return tx.cardPrintProfile.findFirst({
    where: {
      tenantId: input.tenantId,
      cardSet: input.cardIdentity.cardSet,
      cardNumber: input.cardIdentity.cardNumber,
      printRunKey: printRunKeyFrom(input.cardIdentity.printRun),
      state: "ACTIVE",
    },
    select: cardPrintProfileStateSelect,
  });
}

function assertCardPrintProfileScoped(
  profile: CardPrintProfileState,
  input: { cardSet: string; cardNumber: string; printRun?: string }
) {
  const issues: AiGraderValidationIssue[] = [];

  if (profile.cardSet !== input.cardSet) {
    issues.push(issue("cardPrintProfile.cardSet", "INVALID_RECORD", "profile cardSet must match the scoped input."));
  }
  if (profile.cardNumber !== input.cardNumber) {
    issues.push(issue("cardPrintProfile.cardNumber", "INVALID_RECORD", "profile cardNumber must match the scoped input."));
  }
  if (profile.printRunKey !== printRunKeyFrom(input.printRun)) {
    issues.push(issue("cardPrintProfile.printRun", "INVALID_RECORD", "profile printRun must match the scoped input."));
  }

  throwIfInvalid("Card print profile scope mismatch.", issues);
}

function assertValidProfileLifecycleTransition(
  profile: CardPrintProfileState,
  toState: PrintProfileStatus,
  input: {
    actorOperatorId: string;
    reviewedByOperatorId?: string;
    reasonCode: string;
    decidedAt: Date;
  }
) {
  const result = validateAuthProfileLifecycleTransition({
    from: profile.state,
    to: toState,
    actorOperatorId: input.actorOperatorId,
    reviewedByOperatorId: input.reviewedByOperatorId,
    reasonCode: input.reasonCode,
    decidedAt: input.decidedAt.toISOString(),
  });
  throwIfInvalid("Invalid card print profile lifecycle transition.", result.issues);
}

export async function createAuthRunDraft(
  db: AiGraderServicePrismaClient,
  input: CreateAuthRunDraftInput
): Promise<CreatedAuthRunDraft> {
  validateCreateAuthRunDraftInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for auth run.", [
        issue("authRun.captureSessionId", "INVALID_RECORD", "captureSessionId must belong to the auth run tenant."),
      ]);
    }

    const profile = input.cardPrintProfileId
      ? await readCardPrintProfileById(tx, { tenantId: input.tenantId, profileId: input.cardPrintProfileId })
      : await readActiveCardPrintProfileForIdentity(tx, input);

    if (input.cardPrintProfileId && !profile) {
      throw new AiGraderServiceValidationError("Card print profile not found for auth run.", [
        issue("authRun.cardPrintProfileId", "INVALID_RECORD", "cardPrintProfileId must belong to the auth run tenant."),
      ]);
    }

    if (profile) {
      assertCardPrintProfileScoped(profile, input.cardIdentity);
    }

    const startedAt = optionalDate(input.startedAt, "authRun.startedAt");
    const verdict = resolveAuthVerdictFromProfileState(profile, "REFERENCE_NEEDED");
    const data: AuthRunCreateData = {
      ...(input.id ? { id: input.id } : {}),
      captureSessionId: input.captureSessionId,
      captureManifestId: input.captureManifestId,
      algorithmVersionId: input.algorithmVersionId,
      runtimeEnvironmentId: input.runtimeEnvironmentId,
      cardPrintProfileId: profile?.state === "ACTIVE" ? profile.id : null,
      tenantId: input.tenantId,
      cardSet: input.cardIdentity.cardSet,
      cardNumber: input.cardIdentity.cardNumber,
      printRun: input.cardIdentity.printRun ?? null,
      verdict,
      status: input.status ?? "RUNNING",
      measurements: (input.measurements ?? {}) as Prisma.InputJsonValue,
      evidence: (input.evidence ?? {}) as Prisma.InputJsonValue,
      inputChecksum: input.inputChecksum ?? null,
      startedAt,
    };

    const contract = authRunContractFromData(data, profile?.state);
    const result = validateAuthRunContract(contract);
    throwIfInvalid("Invalid auth run draft payload.", result.issues);

    return {
      session,
      profile,
      verdict,
      authRun: await tx.authRun.create({ data }),
    };
  });
}

export async function finalizeAuthRun(
  db: AiGraderServicePrismaClient,
  input: FinalizeAuthRunInput
): Promise<FinalizedAuthRun> {
  validateFinalizeAuthRunInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const authRun = await tx.authRun.findFirst({
      where: {
        id: input.authRunId,
        tenantId: input.tenantId,
      },
      select: authRunStateSelect,
    });

    if (!authRun) {
      throw new AiGraderServiceValidationError("Auth run not found for tenant.", [
        issue("authRun", "INVALID_RECORD", "AuthRun was not found for the supplied tenant and auth run id."),
      ]);
    }
    if (authRun.status !== "PENDING" && authRun.status !== "RUNNING") {
      throw new AiGraderServiceValidationError("Auth run cannot be finalized from current status.", [
        issue("authRun.status", "INVALID_RECORD", "AuthRun finalization requires PENDING or RUNNING status."),
      ]);
    }

    const profile = authRun.cardPrintProfileId
      ? await readCardPrintProfileById(tx, { tenantId: input.tenantId, profileId: authRun.cardPrintProfileId })
      : null;
    const resolvedVerdict = resolveAuthVerdictFromProfileState(profile, input.requestedVerdict);
    const status = input.status ?? "COMPLETE";
    const finishedAt = dateFromOptional(input.finishedAt, "authRun.finishedAt");
    const updateData: AuthRunUpdateData = {
      verdict: status === "FAILED" ? "REFERENCE_NEEDED" : resolvedVerdict,
      distance: input.distance ?? null,
      status,
      measurements: input.measurements as Prisma.InputJsonValue,
      evidence: input.evidence as Prisma.InputJsonValue,
      outputChecksum: input.outputChecksum ?? null,
      errorCode: input.errorCode ?? null,
      finishedAt,
    };
    const contract = authRunContractFromData(
      {
        ...authRun,
        ...updateData,
      },
      profile?.state
    );
    const result = validateAuthRunContract(contract);
    throwIfInvalid("Invalid auth run finalization payload.", result.issues);

    const update = await tx.authRun.updateMany({
      where: {
        id: input.authRunId,
        tenantId: input.tenantId,
      },
      data: updateData,
    });

    if (update.count !== 1) {
      throw new AiGraderServiceValidationError("Auth run update failed.", [
        issue("authRun", "INVALID_RECORD", "AuthRun update did not match exactly one scoped row."),
      ]);
    }

    return {
      authRun,
      profile,
      resolvedVerdict: updateData.verdict,
      updatedCount: update.count,
    };
  });
}

export async function createCandidateCardPrintProfile(
  db: AiGraderServicePrismaClient,
  input: CreateCandidateCardPrintProfileInput
): Promise<CreatedCandidateCardPrintProfile> {
  validateCreateCandidateCardPrintProfileInput(input);

  const now = dateFromOptional(input.createdAt, "cardPrintProfile.createdAt");
  const data: CardPrintProfileCreateData = {
    ...(input.id ? { id: input.id } : {}),
    tenantId: input.tenantId,
    cardSet: input.cardIdentity.cardSet,
    cardNumber: input.cardIdentity.cardNumber,
    printRun: input.cardIdentity.printRun ?? null,
    printRunKey: printRunKeyFrom(input.cardIdentity.printRun),
    state: "CANDIDATE",
    referenceFingerprint: input.referenceFingerprint as Prisma.InputJsonValue,
    referenceAuthRunId: input.referenceAuthRunId ?? null,
    approvedByOperatorId: null,
    approvedAt: null,
    version: input.version ?? 1,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const result = validateCardPrintProfileContract(cardPrintProfileContractFromCreateData(data, now));
  throwIfInvalid("Invalid card print profile candidate payload.", result.issues);

  return {
    profile: await db.cardPrintProfile.create({ data }),
  };
}

export async function approveCardPrintProfile(
  db: AiGraderServicePrismaClient,
  input: ApproveCardPrintProfileInput
): Promise<UpdatedCardPrintProfile> {
  validateApproveCardPrintProfileInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const profile = await readCardPrintProfileById(tx, {
      tenantId: input.tenantId,
      profileId: input.profileId,
    });
    if (!profile) {
      throw new AiGraderServiceValidationError("Card print profile not found for tenant.", [
        issue("cardPrintProfile", "INVALID_RECORD", "CardPrintProfile was not found for the supplied tenant and profile id."),
      ]);
    }
    assertCardPrintProfileScoped(profile, input);

    const decidedAt = dateFromOptional(input.decidedAt, "cardPrintProfile.decidedAt");
    const toState = input.toState ?? "CURATED_REFERENCE";
    assertValidProfileLifecycleTransition(profile, toState, {
      actorOperatorId: input.actorOperatorId,
      reviewedByOperatorId: input.reviewedByOperatorId,
      reasonCode: input.reasonCode,
      decidedAt,
    });

    const data: CardPrintProfileUpdateData = {
      state: toState,
      approvedByOperatorId: input.reviewedByOperatorId,
      approvedAt: decidedAt,
      notes: input.notes ?? profile.notes,
      updatedAt: decidedAt,
    };
    const updatedProfile = {
      ...profile,
      ...data,
    };
    const result = validateCardPrintProfileContract(cardPrintProfileContractFromState(updatedProfile));
    throwIfInvalid("Invalid card print profile approval payload.", result.issues);

    const update = await tx.cardPrintProfile.updateMany({
      where: {
        id: input.profileId,
        tenantId: input.tenantId,
        cardSet: input.cardSet,
        cardNumber: input.cardNumber,
        printRunKey: printRunKeyFrom(input.printRun),
      },
      data,
    });

    if (update.count !== 1) {
      throw new AiGraderServiceValidationError("Card print profile update failed.", [
        issue("cardPrintProfile", "INVALID_RECORD", "CardPrintProfile update did not match exactly one scoped row."),
      ]);
    }

    return {
      profile,
      updatedCount: update.count,
    };
  });
}

async function updateCardPrintProfileLifecycle(
  db: AiGraderServicePrismaClient,
  input: UpdateCardPrintProfileLifecycleInput,
  toState: Extract<PrintProfileStatus, "QUARANTINED" | "RETIRED">
): Promise<UpdatedCardPrintProfile> {
  validateUpdateCardPrintProfileLifecycleInput(input, toState === "QUARANTINED" ? "quarantine" : "retire");

  return runInAiGraderTransaction(db, async (tx) => {
    const profile = await readCardPrintProfileById(tx, {
      tenantId: input.tenantId,
      profileId: input.profileId,
    });
    if (!profile) {
      throw new AiGraderServiceValidationError("Card print profile not found for tenant.", [
        issue("cardPrintProfile", "INVALID_RECORD", "CardPrintProfile was not found for the supplied tenant and profile id."),
      ]);
    }
    assertCardPrintProfileScoped(profile, input);

    const decidedAt = dateFromOptional(input.decidedAt, "cardPrintProfile.decidedAt");
    assertValidProfileLifecycleTransition(profile, toState, {
      actorOperatorId: input.actorOperatorId,
      reasonCode: input.reasonCode,
      decidedAt,
    });

    const data: CardPrintProfileUpdateData = {
      state: toState,
      notes: input.notes ?? profile.notes,
      updatedAt: decidedAt,
    };
    const updatedProfile = {
      ...profile,
      ...data,
    };
    const result = validateCardPrintProfileContract(cardPrintProfileContractFromState(updatedProfile));
    throwIfInvalid("Invalid card print profile lifecycle payload.", result.issues);

    const update = await tx.cardPrintProfile.updateMany({
      where: {
        id: input.profileId,
        tenantId: input.tenantId,
        cardSet: input.cardSet,
        cardNumber: input.cardNumber,
        printRunKey: printRunKeyFrom(input.printRun),
      },
      data,
    });

    if (update.count !== 1) {
      throw new AiGraderServiceValidationError("Card print profile update failed.", [
        issue("cardPrintProfile", "INVALID_RECORD", "CardPrintProfile update did not match exactly one scoped row."),
      ]);
    }

    return {
      profile,
      updatedCount: update.count,
    };
  });
}

export function quarantineCardPrintProfile(
  db: AiGraderServicePrismaClient,
  input: UpdateCardPrintProfileLifecycleInput
) {
  return updateCardPrintProfileLifecycle(db, input, "QUARANTINED");
}

export function retireCardPrintProfile(
  db: AiGraderServicePrismaClient,
  input: UpdateCardPrintProfileLifecycleInput
) {
  return updateCardPrintProfileLifecycle(db, input, "RETIRED");
}

export async function linkEvidenceArtifact(
  db: AiGraderServicePrismaClient,
  artifact: EvidenceArtifactContract
): Promise<LinkedEvidenceArtifact> {
  validateLinkEvidenceArtifactInput(artifact);

  return runInAiGraderTransaction(db, async (tx) => {
    const scopes: LinkedEvidenceArtifact["scopes"] = {};

    if (artifact.captureSessionId) {
      const captureSession = await readCaptureSessionState(tx, {
        tenantId: artifact.tenantId,
        captureSessionId: artifact.captureSessionId,
      });
      if (!captureSession) {
        throw new AiGraderServiceValidationError("Capture session not found for evidence artifact.", [
          issue("evidenceArtifact.captureSessionId", "INVALID_RECORD", "captureSessionId must belong to the artifact tenant."),
        ]);
      }
      scopes.captureSession = captureSession;
    }

    if (artifact.gradeRunId) {
      const gradeRun = await tx.gradeRun.findFirst({
        where: {
          id: artifact.gradeRunId,
          captureSession: { tenantId: artifact.tenantId },
        },
        select: gradeRunStateSelect,
      });
      if (!gradeRun) {
        throw new AiGraderServiceValidationError("Grade run not found for evidence artifact.", [
          issue("evidenceArtifact.gradeRunId", "INVALID_RECORD", "gradeRunId must belong to the artifact tenant."),
        ]);
      }
      scopes.gradeRun = gradeRun;
    }

    if (artifact.authRunId) {
      const authRun = await tx.authRun.findFirst({
        where: {
          id: artifact.authRunId,
          tenantId: artifact.tenantId,
        },
        select: authRunScopeSelect,
      });
      if (!authRun) {
        throw new AiGraderServiceValidationError("Auth run not found for evidence artifact.", [
          issue("evidenceArtifact.authRunId", "INVALID_RECORD", "authRunId must belong to the artifact tenant."),
        ]);
      }
      scopes.authRun = authRun;
    }

    if (artifact.certificateId) {
      const certificate = await tx.gradeCertificate.findFirst({
        where: {
          id: artifact.certificateId,
          tenantId: artifact.tenantId,
        },
        select: gradeCertificateScopeSelect,
      });
      if (!certificate) {
        throw new AiGraderServiceValidationError("Certificate not found for evidence artifact.", [
          issue("evidenceArtifact.certificateId", "INVALID_RECORD", "certificateId must belong to the artifact tenant."),
        ]);
      }
      scopes.certificate = certificate;
    }

    return {
      artifact: await tx.evidenceArtifact.create({ data: evidenceArtifactCreateData(artifact) }),
      scopes,
    };
  });
}

function certificateReadinessIssue(path: string, message: string): AiGraderValidationIssue {
  return issue(path, "CERTIFICATE_BLOCKED", message);
}

function physicalGateReadinessIssues(session: CaptureSessionState | null) {
  const issues: AiGraderValidationIssue[] = [];
  const gates = session?.physicalGateResults;
  if (!Array.isArray(gates)) {
    return issues;
  }

  gates.forEach((gate, index) => {
    if (!isRecord(gate)) {
      return;
    }
    const status = typeof gate.status === "string" ? gate.status : undefined;
    const resolved = gate.resolved === true;
    const reviewRequired = gate.reviewRequired === true;
    if ((status && BLOCKING_PHYSICAL_GATE_STATUSES.has(status)) || (reviewRequired && !resolved)) {
      issues.push(
        certificateReadinessIssue(
          `certificateReadiness.physicalGateResults[${index}]`,
          "certificate readiness requires blocking physical gates to be reviewed and resolved."
        )
      );
    }
  });

  return issues;
}

function validateReadyForCertificateIssue(readiness: GradeCertificateReadinessResult) {
  if (!readiness.ready) {
    throw new AiGraderServiceValidationError("Grade certificate is not ready.", readiness.issues);
  }
}

async function readGradeCertificateById(
  tx: AiGraderServiceTransactionClient,
  input: { tenantId: string; certificateId: string }
) {
  return tx.gradeCertificate.findFirst({
    where: {
      id: input.certificateId,
      tenantId: input.tenantId,
    },
    select: gradeCertificateStateSelect,
  });
}

export async function checkGradeCertificateReadiness(
  db: AiGraderServicePrismaClient,
  input: CheckGradeCertificateReadinessInput
): Promise<GradeCertificateReadinessResult> {
  validateCheckGradeCertificateReadinessInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const issues: AiGraderValidationIssue[] = [];
    const gradeRun = await tx.gradeRun.findFirst({
      where: {
        id: input.gradeRunId,
        captureSession: { tenantId: input.tenantId },
      },
      select: gradeRunStateSelect,
    });

    if (!gradeRun) {
      issues.push(issue("certificate.gradeRunId", "INVALID_RECORD", "GradeRun was not found for the supplied tenant."));
      return {
        ready: false,
        issues,
        gradeRun: null,
        authRun: null,
        certificate: null,
        evidenceArtifacts: [],
        blockingOverrides: [],
        custodyBreaks: [],
      };
    }

    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: gradeRun.captureSessionId,
    });
    const authRun = input.authRunId
      ? await tx.authRun.findFirst({
          where: {
            id: input.authRunId,
            tenantId: input.tenantId,
          },
          select: authRunStateSelect,
        })
      : null;
    if (input.authRunId && !authRun) {
      issues.push(issue("certificate.authRunId", "INVALID_RECORD", "AuthRun was not found for the supplied tenant."));
    }

    const persistedCertificate = input.certificateId
      ? await readGradeCertificateById(tx, { tenantId: input.tenantId, certificateId: input.certificateId })
      : await tx.gradeCertificate.findFirst({
          where: {
            tenantId: input.tenantId,
            gradeRunId: input.gradeRunId,
          },
          select: gradeCertificateStateSelect,
        });

    const evidenceArtifacts = (
      await tx.evidenceArtifact.findMany({
        where: {
          tenantId: input.tenantId,
          OR: [
            { captureSessionId: gradeRun.captureSessionId },
            { gradeRunId: gradeRun.id },
            ...(authRun ? [{ authRunId: authRun.id }] : []),
            ...(persistedCertificate ? [{ certificateId: persistedCertificate.id }] : []),
          ],
        },
        select: evidenceArtifactStateSelect,
      })
    ).map(evidenceArtifactContractFromState);

    const blockingOverrides = (
      await tx.operatorOverride.findMany({
        where: {
          tenantId: input.tenantId,
          captureSessionId: gradeRun.captureSessionId,
        },
        select: operatorOverrideStateSelect,
      })
    ).filter((override) => override.reviewStatus !== "APPROVED");

    const custodyBreaks = (
      await tx.custodyEvent.findMany({
        where: {
          tenantId: input.tenantId,
          captureSessionId: gradeRun.captureSessionId,
        },
        select: custodyEventStateSelect,
      })
    ).filter((event) => event.type === "CUSTODY_BREAK");

    const now = new Date();
    const certificate = persistedCertificate
      ? gradeCertificateContractFromState(persistedCertificate, gradeRun.status)
      : gradeCertificateContractFromCreateData(
          {
            tenantId: input.tenantId,
            gradeRunId: gradeRun.id,
            authRunId: authRun?.id ?? input.authRunId ?? null,
            publicSlug: input.publicSlug ?? "certificate-readiness",
            certificateNumber: input.certificateNumber ?? "certificate-readiness",
            status: "DRAFT",
            mode: gradeRun.mode,
            finalGrades: optionalNullableJson(gradeRun.finalGrades as Prisma.InputJsonValue | null | undefined),
            custodyStatus: input.custodyStatus ?? "IN_TEN_KINGS_CUSTODY",
            createdAt: now,
            updatedAt: now,
          },
          gradeRun,
          now
        );

    const readiness = validateCertificateEvidenceReadiness({
      certificate,
      gradeRunStatus: gradeRun.status,
      evidenceArtifacts,
    });
    issues.push(...readiness.issues);
    issues.push(...physicalGateReadinessIssues(session));

    if (authRun) {
      if (authRun.status !== "COMPLETE") {
        issues.push(
          certificateReadinessIssue("certificate.authRun.status", "certificate readiness requires AuthRun COMPLETE when authRunId is supplied.")
        );
      }
      if (!CERTIFICATE_ACCEPTABLE_AUTH_VERDICTS.has(authRun.verdict)) {
        issues.push(
          certificateReadinessIssue("certificate.authRun.verdict", "certificate readiness blocks suspicious or counterfeit auth verdicts.")
        );
      }
    }

    if (blockingOverrides.length > 0) {
      issues.push(
        certificateReadinessIssue("certificate.operatorOverrides", "certificate readiness requires operator overrides to be reviewed.")
      );
    }
    if (custodyBreaks.length > 0) {
      issues.push(certificateReadinessIssue("certificate.custody", "certificate readiness blocks custody breaks."));
    }

    return {
      ready: issues.length === 0,
      issues,
      gradeRun,
      authRun,
      certificate,
      evidenceArtifacts,
      blockingOverrides,
      custodyBreaks,
    };
  });
}

export async function createGradeCertificateDraft(
  db: AiGraderServicePrismaClient,
  input: CreateGradeCertificateDraftInput
): Promise<CreatedGradeCertificateDraft> {
  validateCreateGradeCertificateDraftInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const readiness = await checkGradeCertificateReadiness(tx, input);
    validateReadyForCertificateIssue(readiness);
    const gradeRun = readiness.gradeRun;
    if (!gradeRun) {
      throw new AiGraderServiceValidationError("Grade run not found for certificate draft.", [
        issue("certificate.gradeRunId", "INVALID_RECORD", "GradeRun was not found for the supplied tenant."),
      ]);
    }

    const now = dateFromOptional(input.createdAt, "certificate.createdAt");
    const data: GradeCertificateCreateData = {
      ...(input.id ? { id: input.id } : {}),
      tenantId: input.tenantId,
      gradeRunId: input.gradeRunId,
      authRunId: readiness.authRun?.id ?? input.authRunId ?? null,
      publicSlug: input.publicSlug,
      certificateNumber: input.certificateNumber,
      status: "DRAFT",
      mode: gradeRun.mode,
      finalGrades: optionalNullableJson(gradeRun.finalGrades as Prisma.InputJsonValue | null | undefined),
      publicReportKey: null,
      custodyStatus: input.custodyStatus ?? "IN_TEN_KINGS_CUSTODY",
      issuedAt: null,
      revokedAt: null,
      revocationReason: null,
      createdAt: now,
      updatedAt: now,
    };
    const certificateContract = gradeCertificateContractFromCreateData(data, gradeRun, now);
    const result = validateCertificateEvidenceReadiness({
      certificate: certificateContract,
      gradeRunStatus: gradeRun.status,
      evidenceArtifacts: readiness.evidenceArtifacts,
    });
    throwIfInvalid("Invalid certificate draft payload.", result.issues);

    return {
      readiness,
      certificate: await tx.gradeCertificate.create({ data }),
    };
  });
}

export async function issueGradeCertificate(
  db: AiGraderServicePrismaClient,
  input: IssueGradeCertificateInput
): Promise<IssuedGradeCertificate> {
  validateIssueGradeCertificateInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const certificate = await readGradeCertificateById(tx, {
      tenantId: input.tenantId,
      certificateId: input.certificateId,
    });
    if (!certificate) {
      throw new AiGraderServiceValidationError("Grade certificate not found for tenant.", [
        issue("certificate", "INVALID_RECORD", "GradeCertificate was not found for the supplied tenant and certificate id."),
      ]);
    }
    if (certificate.status !== "DRAFT") {
      throw new AiGraderServiceValidationError("Grade certificate cannot be issued from current status.", [
        issue("certificate.status", "INVALID_CERTIFICATE", "only DRAFT certificates can be issued."),
      ]);
    }

    const readiness = await checkGradeCertificateReadiness(tx, {
      tenantId: input.tenantId,
      gradeRunId: certificate.gradeRunId,
      authRunId: certificate.authRunId,
      certificateId: certificate.id,
      publicSlug: certificate.publicSlug,
      certificateNumber: certificate.certificateNumber,
      custodyStatus: certificate.custodyStatus,
    });
    validateReadyForCertificateIssue(readiness);
    const gradeRun = readiness.gradeRun;
    if (!gradeRun) {
      throw new AiGraderServiceValidationError("Grade run not found for certificate issue.", [
        issue("certificate.gradeRunId", "INVALID_RECORD", "GradeRun was not found for the supplied tenant."),
      ]);
    }

    const issuedAt = dateFromOptional(input.issuedAt, "certificate.issuedAt");
    const data: GradeCertificateUpdateData = {
      status: "ACTIVE",
      publicReportKey: input.publicReportKey,
      issuedAt,
      updatedAt: issuedAt,
    };
    const activeCertificate = {
      ...certificate,
      ...data,
    };
    const activeContract = gradeCertificateContractFromState(activeCertificate, gradeRun.status);
    const result = validateCertificateEvidenceReadiness({
      certificate: activeContract,
      gradeRunStatus: gradeRun.status,
      evidenceArtifacts: readiness.evidenceArtifacts,
    });
    throwIfInvalid("Invalid certificate issue payload.", result.issues);

    const update = await tx.gradeCertificate.updateMany({
      where: {
        id: input.certificateId,
        tenantId: input.tenantId,
      },
      data,
    });
    if (update.count !== 1) {
      throw new AiGraderServiceValidationError("Grade certificate update failed.", [
        issue("certificate", "INVALID_RECORD", "GradeCertificate update did not match exactly one scoped row."),
      ]);
    }

    const auditChecksum = await buildAuditChecksum({
      tenantId: input.tenantId,
      certificateId: input.certificateId,
      action: "issue",
      issuedAt: issuedAt.toISOString(),
      publicReportKey: input.publicReportKey,
    });
    const auditEvent = await recordAuditEvent(tx, {
      tenantId: input.tenantId,
      actorOperatorId: input.actorOperatorId,
      actorUserId: input.actorUserId ?? null,
      entityType: "GradeCertificate",
      entityId: input.certificateId,
      action: "ai_grader.certificate.issued",
      outcome: "SUCCESS",
      before: { status: certificate.status } as Prisma.InputJsonValue,
      after: {
        status: "ACTIVE",
        publicReportKey: input.publicReportKey,
        issuedAt: issuedAt.toISOString(),
      } as Prisma.InputJsonValue,
      reasonCode: input.reasonCode ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      checksum: auditChecksum,
      createdAt: issuedAt,
    });

    return {
      readiness,
      certificate,
      updatedCount: update.count,
      auditEvent,
    };
  });
}

export async function revokeGradeCertificate(
  db: AiGraderServicePrismaClient,
  input: RevokeGradeCertificateInput
): Promise<RevokedGradeCertificate> {
  validateRevokeGradeCertificateInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const certificate = await readGradeCertificateById(tx, {
      tenantId: input.tenantId,
      certificateId: input.certificateId,
    });
    if (!certificate) {
      throw new AiGraderServiceValidationError("Grade certificate not found for tenant.", [
        issue("certificate", "INVALID_RECORD", "GradeCertificate was not found for the supplied tenant and certificate id."),
      ]);
    }

    const revokedAt = dateFromOptional(input.revokedAt, "certificate.revokedAt");
    const data: GradeCertificateUpdateData = {
      status: "REVOKED",
      revokedAt,
      revocationReason: input.revocationReason,
      updatedAt: revokedAt,
    };
    const update = await tx.gradeCertificate.updateMany({
      where: {
        id: input.certificateId,
        tenantId: input.tenantId,
      },
      data,
    });
    if (update.count !== 1) {
      throw new AiGraderServiceValidationError("Grade certificate update failed.", [
        issue("certificate", "INVALID_RECORD", "GradeCertificate update did not match exactly one scoped row."),
      ]);
    }

    const auditChecksum = await buildAuditChecksum({
      tenantId: input.tenantId,
      certificateId: input.certificateId,
      action: "revoke",
      revokedAt: revokedAt.toISOString(),
      revocationReason: input.revocationReason,
    });
    const auditEvent = await recordAuditEvent(tx, {
      tenantId: input.tenantId,
      actorOperatorId: input.actorOperatorId,
      actorUserId: input.actorUserId ?? null,
      entityType: "GradeCertificate",
      entityId: input.certificateId,
      action: "ai_grader.certificate.revoked",
      outcome: "SUCCESS",
      before: { status: certificate.status } as Prisma.InputJsonValue,
      after: {
        status: "REVOKED",
        revokedAt: revokedAt.toISOString(),
        revocationReason: input.revocationReason,
      } as Prisma.InputJsonValue,
      reasonCode: input.revocationReason,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      checksum: auditChecksum,
      createdAt: revokedAt,
    });

    return {
      certificate,
      updatedCount: update.count,
      auditEvent,
    };
  });
}

export async function persistOrchestratorTransition(
  db: AiGraderServicePrismaClient,
  input: PersistOrchestratorTransitionInput
): Promise<PersistedOrchestratorTransition> {
  validateOrchestratorTransitionInput(input);

  return runInAiGraderTransaction(db, async (tx) => {
    const session = await readCaptureSessionState(tx, {
      tenantId: input.tenantId,
      captureSessionId: input.captureSessionId,
    });

    if (!session) {
      throw new AiGraderServiceValidationError("Capture session not found for tenant.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession was not found for the supplied tenant and session id."),
      ]);
    }

    const occurredAt = dateFromOptional(input.occurredAt, "orchestrator.occurredAt");
    const transition = transitionOrchestratorState({
      sessionId: input.captureSessionId,
      currentState: session.currentState as OrchestratorState,
      event: input.event,
      guardResults: input.guardResults,
      errorCode: input.errorCode,
      occurredAt: occurredAt.toISOString(),
    });

    if (!transition.accepted) {
      throw new AiGraderServiceValidationError("Invalid orchestrator transition.", [
        issue(
          "orchestrator.transition",
          "INVALID_TRANSFORM",
          `Transition ${input.event} is not valid from ${session.currentState}.`
        ),
      ]);
    }

    const status = statusForOrchestratorState(transition.nextState);
    const errorCode = errorCodeForOrchestratorState(transition.nextState, input);
    const update = await tx.captureSession.updateMany({
      where: {
        id: input.captureSessionId,
        tenantId: input.tenantId,
      },
      data: transitionUpdateData(session, transition.nextState, status, errorCode, occurredAt),
    });

    if (update.count !== 1) {
      throw new AiGraderServiceValidationError("Capture session update failed.", [
        issue("captureSession", "INVALID_RECORD", "CaptureSession update did not match exactly one scoped row."),
      ]);
    }

    const auditEvent = await recordAuditEvent(
      tx,
      await buildTransitionAuditInput(
        session,
        input,
        transition.nextState,
        status,
        errorCode,
        occurredAt,
        transition.auditEventId,
        transition.userVisibleMessage
      )
    );

    return {
      session,
      fromState: session.currentState,
      toState: transition.nextState,
      status,
      errorCode,
      transitionAuditEventId: transition.auditEventId,
      auditEvent,
      updatedCount: update.count,
      userVisibleMessage: transition.userVisibleMessage,
    };
  });
}

export async function markCaptureSessionPausedForOperatorTimeout(
  db: AiGraderServicePrismaClient,
  input: CommonCaptureSessionStateUpdateInput
) {
  return persistOrchestratorTransition(db, {
    ...input,
    event: "ERROR",
    errorCode: "PAUSED_OPERATOR_TIMEOUT",
    reasonCode: input.reasonCode ?? "PAUSED_OPERATOR_TIMEOUT",
  });
}

export async function markCaptureSessionMicroIncompleteRequiresReview(
  db: AiGraderServicePrismaClient,
  input: CommonCaptureSessionStateUpdateInput
) {
  return persistOrchestratorTransition(db, {
    ...input,
    event: "ERROR",
    errorCode: "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    reasonCode: input.reasonCode ?? "MICRO_INCOMPLETE_REQUIRES_REVIEW",
    guardResults: { operatorDecision: "COMPLETE_WITH_WARNING" },
  });
}

export async function markCaptureSessionPhysicalGateReview(
  db: AiGraderServicePrismaClient,
  input: CommonCaptureSessionStateUpdateInput
) {
  return persistOrchestratorTransition(db, {
    ...input,
    event: "ERROR",
    errorCode: "PHYSICAL_GATE_REVIEW",
    reasonCode: input.reasonCode ?? "PHYSICAL_GATE_REVIEW",
  });
}

export async function markCaptureSessionAborted(
  db: AiGraderServicePrismaClient,
  input: CommonCaptureSessionStateUpdateInput & { reasonCode: string }
) {
  return persistOrchestratorTransition(db, {
    ...input,
    event: "ABORT",
    errorCode: input.reasonCode,
  });
}

export async function markCaptureSessionComplete(
  db: AiGraderServicePrismaClient,
  input: CommonCaptureSessionStateUpdateInput
) {
  return persistOrchestratorTransition(db, {
    ...input,
    event: "OPERATOR_APPROVED",
    guardResults: {
      blockingGates: false,
      overrideReviewedApproved: true,
    },
  });
}

export async function readCaptureSessionState(
  db: AiGraderServicePrismaClient,
  input: ReadCaptureSessionStateInput
): Promise<CaptureSessionState | null> {
  validateReadCaptureSessionStateInput(input);

  return db.captureSession.findFirst({
    where: {
      id: input.captureSessionId,
      tenantId: input.tenantId,
    },
    select: captureSessionStateSelect,
  });
}

export function createAiGraderService(db: AiGraderServicePrismaClient) {
  return {
    createCaptureSessionDraft: (input: CreateCaptureSessionDraftInput) =>
      createCaptureSessionDraft(db, input),
    recordCaptureManifest: (manifest: CaptureManifest) =>
      recordCaptureManifest(db, manifest),
    recordEvidenceArtifact: (artifact: EvidenceArtifactContract) =>
      recordEvidenceArtifact(db, artifact),
    recordAuditEvent: (input: RecordAuditEventInput) => recordAuditEvent(db, input),
    persistMacroSuspectRegions: (input: PersistMacroSuspectRegionsInput) =>
      persistMacroSuspectRegions(db, input),
    recordMacroPipelineCompletion: (input: RecordMacroPipelineCompletionInput) =>
      recordMacroPipelineCompletion(db, input),
    persistMicroSpotPackage: (input: PersistMicroSpotPackageInput) =>
      persistMicroSpotPackage(db, input),
    createGradeRunDraft: (input: CreateGradeRunDraftInput) =>
      createGradeRunDraft(db, input),
    finalizeGradeRun: (input: FinalizeGradeRunInput) =>
      finalizeGradeRun(db, input),
    createAuthRunDraft: (input: CreateAuthRunDraftInput) =>
      createAuthRunDraft(db, input),
    finalizeAuthRun: (input: FinalizeAuthRunInput) =>
      finalizeAuthRun(db, input),
    createCandidateCardPrintProfile: (input: CreateCandidateCardPrintProfileInput) =>
      createCandidateCardPrintProfile(db, input),
    approveCardPrintProfile: (input: ApproveCardPrintProfileInput) =>
      approveCardPrintProfile(db, input),
    quarantineCardPrintProfile: (input: UpdateCardPrintProfileLifecycleInput) =>
      quarantineCardPrintProfile(db, input),
    retireCardPrintProfile: (input: UpdateCardPrintProfileLifecycleInput) =>
      retireCardPrintProfile(db, input),
    checkGradeCertificateReadiness: (input: CheckGradeCertificateReadinessInput) =>
      checkGradeCertificateReadiness(db, input),
    createGradeCertificateDraft: (input: CreateGradeCertificateDraftInput) =>
      createGradeCertificateDraft(db, input),
    issueGradeCertificate: (input: IssueGradeCertificateInput) =>
      issueGradeCertificate(db, input),
    revokeGradeCertificate: (input: RevokeGradeCertificateInput) =>
      revokeGradeCertificate(db, input),
    linkEvidenceArtifact: (artifact: EvidenceArtifactContract) =>
      linkEvidenceArtifact(db, artifact),
    persistOrchestratorTransition: (input: PersistOrchestratorTransitionInput) =>
      persistOrchestratorTransition(db, input),
    markCaptureSessionPausedForOperatorTimeout: (input: CommonCaptureSessionStateUpdateInput) =>
      markCaptureSessionPausedForOperatorTimeout(db, input),
    markCaptureSessionMicroIncompleteRequiresReview: (input: CommonCaptureSessionStateUpdateInput) =>
      markCaptureSessionMicroIncompleteRequiresReview(db, input),
    markCaptureSessionPhysicalGateReview: (input: CommonCaptureSessionStateUpdateInput) =>
      markCaptureSessionPhysicalGateReview(db, input),
    markCaptureSessionAborted: (input: CommonCaptureSessionStateUpdateInput & { reasonCode: string }) =>
      markCaptureSessionAborted(db, input),
    markCaptureSessionComplete: (input: CommonCaptureSessionStateUpdateInput) =>
      markCaptureSessionComplete(db, input),
    readCaptureSessionState: (input: ReadCaptureSessionStateInput) =>
      readCaptureSessionState(db, input),
  };
}
