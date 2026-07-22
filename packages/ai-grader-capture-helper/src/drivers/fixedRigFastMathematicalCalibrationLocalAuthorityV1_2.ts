import crypto from "node:crypto";
import {
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
  FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA,
  FixedRigFastMathematicalCalibrationCoreV1_2,
  type FastCalibrationCapturedFrameV1_2,
  type FastCalibrationCoreV1_2Config,
  type FastCalibrationPersistentBatchControllerV1_2,
  type FastCalibrationRigCharacterizationSourceV1_2,
  type FastCalibrationRuntimeContextV1_2,
  verifyFastCalibrationRigCharacterizationSourceV1_2,
} from "./fixedRigFastMathematicalCalibrationV1_2";
import {
  FixedRigFastCalibrationEvidenceAnalyzerV1_2,
  type FastCalibrationEvidenceAnalyzerV1_2,
} from "./fixedRigFastCalibrationEvidenceAnalyzerV1_2";
import {
  MATHEMATICAL_CALIBRATION_V1_2_LIST_DTO_SCHEMA,
  MATHEMATICAL_CALIBRATION_V1_2_STATUS_DTO_SCHEMA,
  validateMathematicalCalibrationV1_2SessionListResponseDto,
  validateMathematicalCalibrationV1_2SessionStatusDto,
  type MathematicalCalibrationV1_2LocalSessionAuthority,
  type MathematicalCalibrationV1_2SessionListResponseDto,
  type MathematicalCalibrationV1_2SessionMutationRequestDto,
  type MathematicalCalibrationV1_2SessionStatusDto,
  type ReplaceMathematicalCalibrationV1_2PoseRequestDto,
  type StartMathematicalCalibrationV1_2SessionRequestDto,
} from "./mathematicalCalibrationV1_2Contract";

export interface MathematicalCalibrationV1_2CheckerboardCaptureAdapter {
  captureCheckerboard(input: {
    sessionId: string;
    slot: number;
    replacement: boolean;
    runtimeContext: FastCalibrationRuntimeContextV1_2;
  }): Promise<FastCalibrationCapturedFrameV1_2>;
  confirmBlankReverseFlip(input: {
    sessionId: string;
    runtimeContext: FastCalibrationRuntimeContextV1_2;
  }): Promise<{ confirmed: true }>;
}

export interface MathematicalCalibrationV1_2PersistentBatchControllerFactory {
  create(input: {
    sessionId: string;
    runtimeContext: FastCalibrationRuntimeContextV1_2;
  }): FastCalibrationPersistentBatchControllerV1_2;
}

export interface DurableMathematicalCalibrationV1_2LocalSessionAuthorityConfig {
  outputRoot: string;
  operatorId: string;
  finalizerStagingRoot?: string;
  loadRuntimeContext(): Promise<FastCalibrationRuntimeContextV1_2>;
  loadRigCharacterizationSource(): Promise<FastCalibrationRigCharacterizationSourceV1_2>;
  verifyLiveRuntimeContext?(expected: FastCalibrationRuntimeContextV1_2): Promise<void>;
  checkerboardCapture: MathematicalCalibrationV1_2CheckerboardCaptureAdapter;
  persistentBatchControllers: MathematicalCalibrationV1_2PersistentBatchControllerFactory;
  evidenceAnalyzer?: FastCalibrationEvidenceAnalyzerV1_2;
  now?: () => Date;
  operationId?: () => string;
  sessionId?: () => string;
}

function exactSafeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value)) {
    throw new Error(`${label} must be one exact safe identifier.`);
  }
  return value;
}

export class DurableMathematicalCalibrationV1_2LocalSessionAuthority
implements MathematicalCalibrationV1_2LocalSessionAuthority {
  private readonly analyzer: FastCalibrationEvidenceAnalyzerV1_2;
  private readonly mutating = new Set<string>();

  constructor(private readonly config: DurableMathematicalCalibrationV1_2LocalSessionAuthorityConfig) {
    if (!config.outputRoot) throw new Error("Mathematical Calibration V1.2 local outputRoot is required.");
    exactSafeId(config.operatorId, "Mathematical Calibration V1.2 operatorId");
    this.analyzer = config.evidenceAnalyzer ?? new FixedRigFastCalibrationEvidenceAnalyzerV1_2();
  }

  private coreConfig(): FastCalibrationCoreV1_2Config {
    return {
      outputRoot: this.config.outputRoot,
      evidenceAnalyzer: this.analyzer,
      ...(this.config.finalizerStagingRoot ? { finalizerStagingRoot: this.config.finalizerStagingRoot } : {}),
      ...(this.config.now ? { now: this.config.now } : {}),
      ...(this.config.operationId ? { operationId: this.config.operationId } : {}),
    };
  }

  private async openLive(sessionId: string): Promise<{
    core: FixedRigFastMathematicalCalibrationCoreV1_2;
    runtimeContext: FastCalibrationRuntimeContextV1_2;
  }> {
    const runtimeContext = await this.config.loadRuntimeContext();
    const core = await FixedRigFastMathematicalCalibrationCoreV1_2.open(this.coreConfig(), {
      sessionId: exactSafeId(sessionId, "sessionId"),
      operatorId: this.config.operatorId,
      runtimeContext,
      resume: true,
    });
    return { core, runtimeContext };
  }

  private toStatus(core: FixedRigFastMathematicalCalibrationCoreV1_2): MathematicalCalibrationV1_2SessionStatusDto {
    const status = core.status();
    const audit = core.auditProjection();
    const acceptedPhotometric = status.captureCounts.acceptedPhotometricFrames;
    const nextPhotometric = acceptedPhotometric < 72
      ? (() => {
        const withinChannel = acceptedPhotometric % 9;
        const roles = ["dark_control", "flat_field", "illumination_pattern"] as const;
        return {
          role: roles[Math.floor(withinChannel / 3)]!,
          channelIndex: Math.floor(acceptedPhotometric / 9) + 1,
          sampleIndex: withinChannel % 3 + 1,
        };
      })()
      : undefined;
    return validateMathematicalCalibrationV1_2SessionStatusDto({
      schemaVersion: MATHEMATICAL_CALIBRATION_V1_2_STATUS_DTO_SCHEMA,
      sessionSchemaVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_SESSION_SCHEMA,
      contractVersion: FIXED_RIG_FAST_MATHEMATICAL_CALIBRATION_V1_2_CONTRACT,
      sessionId: status.sessionId,
      revision: audit.revisionSha256,
      phase: status.phase,
      expectedAction: status.nextAction,
      acceptedPoses: audit.acceptedPoses,
      failedAttempts: audit.failedAttempts,
      aggregateSpans: status.aggregatePoseSpans,
      blankReverseFlip: {
        confirmed: audit.blankReverseFlipCount === 1,
        count: audit.blankReverseFlipCount,
      },
      automaticSweep: {
        acceptedFrames: status.captureCounts.acceptedPhotometricFrames,
        requiredFrames: 72,
        darkAccepted: audit.automaticSweep.darkAccepted,
        darkRequired: 24,
        flatFieldAccepted: audit.automaticSweep.flatFieldAccepted,
        flatFieldRequired: 24,
        illuminationPatternAccepted: audit.automaticSweep.illuminationPatternAccepted,
        illuminationPatternRequired: 24,
        batchCleanupConfirmed: audit.automaticSweep.batchCleanupConfirmed,
        nextRole: nextPhotometric?.role ?? null,
        nextChannelIndex: nextPhotometric?.channelIndex ?? null,
        nextSampleIndex: nextPhotometric?.sampleIndex ?? null,
      },
      analysis: audit.analysis,
      finalization: {
        ...audit.finalization,
        runtimeContextSha256: status.runtimeContextSha256,
        rigCharacterizationSha256: status.rigCharacterizationSha256,
      },
      activationEligible: status.phase === "ready_for_explicit_activation" &&
        audit.finalization.state === "completed",
    });
  }

  private assertRevision(
    core: FixedRigFastMathematicalCalibrationCoreV1_2,
    expectedRevision: string,
  ): void {
    if (core.auditProjection().revisionSha256 !== expectedRevision) {
      throw new Error("Mathematical Calibration V1.2 revision conflict; refresh exact local status.");
    }
  }

  private async serialize<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    if (this.mutating.has(sessionId)) throw new Error("Mathematical Calibration V1.2 session mutation is already in progress.");
    this.mutating.add(sessionId);
    try {
      return await action();
    } finally {
      this.mutating.delete(sessionId);
    }
  }

  async listSessions(): Promise<MathematicalCalibrationV1_2SessionListResponseDto> {
    const cores = await FixedRigFastMathematicalCalibrationCoreV1_2.listStored(this.coreConfig());
    return validateMathematicalCalibrationV1_2SessionListResponseDto({
      schemaVersion: MATHEMATICAL_CALIBRATION_V1_2_LIST_DTO_SCHEMA,
      sessions: cores.map((core) => {
        const status = this.toStatus(core);
        return {
          sessionId: status.sessionId,
          revision: status.revision,
          contractVersion: status.contractVersion,
          phase: status.phase,
          expectedAction: status.expectedAction.action,
          acceptedImageCount: status.acceptedPoses.filter((pose) => pose.active).length +
            status.automaticSweep.acceptedFrames,
          requiredImageCount: 76 as const,
          activationEligible: status.activationEligible,
        };
      }),
    });
  }

  async startOrResume(
    request: StartMathematicalCalibrationV1_2SessionRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
    if (request.resumeSessionId) {
      return this.serialize(request.resumeSessionId, async () => {
        const { core, runtimeContext } = await this.openLive(request.resumeSessionId!);
        await this.config.verifyLiveRuntimeContext?.(runtimeContext);
        if (!request.expectedRevision) throw new Error("Explicit resume requires the server-issued expectedRevision.");
        this.assertRevision(core, request.expectedRevision);
        return this.toStatus(core);
      });
    }
    if (request.expectedRevision !== undefined) throw new Error("A new V1.2 session cannot declare a prior revision.");
    const sessionId = exactSafeId(
      this.config.sessionId?.() ?? `mathematical-v1.2-${crypto.randomUUID()}`,
      "generated sessionId",
    );
    return this.serialize(sessionId, async () => {
      const runtimeContext = await this.config.loadRuntimeContext();
      await this.config.verifyLiveRuntimeContext?.(runtimeContext);
      const rigCharacterizationSource = await this.config.loadRigCharacterizationSource();
      const core = await FixedRigFastMathematicalCalibrationCoreV1_2.open(this.coreConfig(), {
        sessionId,
        operatorId: this.config.operatorId,
        runtimeContext,
        rigCharacterizationSource,
      });
      return this.toStatus(core);
    });
  }

  async status(sessionId: string): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
    return this.toStatus((await this.openLive(sessionId)).core);
  }

  private async geometryAuthority(runtimeContext: FastCalibrationRuntimeContextV1_2) {
    const source = await this.config.loadRigCharacterizationSource();
    const verified = verifyFastCalibrationRigCharacterizationSourceV1_2(source, runtimeContext);
    return {
      lensModel: verified.oneTimeBuilderInput.lensModel,
      directionCoordinateAuthority: verified.directionCoordinateAuthority,
    };
  }

  private async execute(
    request: MathematicalCalibrationV1_2SessionMutationRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
    const { core, runtimeContext } = await this.openLive(request.sessionId);
    this.assertRevision(core, request.expectedRevision);
    const next = core.status().nextAction;
    if (next.action === "capture_checkerboard") {
      if (this.analyzer.geometryAlgorithmSha256 !== runtimeContext.algorithmHashes.geometry) {
        throw new Error("Configured checkerboard analyzer differs from the protected runtime geometry hash.");
      }
      const frame = await this.config.checkerboardCapture.captureCheckerboard({
        sessionId: request.sessionId,
        slot: next.slot,
        replacement: false,
        runtimeContext,
      });
      const derived = await this.analyzer.derivePose(frame.bytes, runtimeContext, await this.geometryAuthority(runtimeContext));
      await core.captureCheckerboard({ frame, pose: derived.pose });
    } else if (next.action === "confirm_blank_reverse_flip") {
      const acknowledgement = await this.config.checkerboardCapture.confirmBlankReverseFlip({
        sessionId: request.sessionId,
        runtimeContext,
      });
      await core.confirmBlankReverseFlip(acknowledgement.confirmed);
    } else if (next.action === "capture_photometric" || next.action === "complete_batch_cleanup") {
      const controller = this.config.persistentBatchControllers.create({
        sessionId: request.sessionId,
        runtimeContext,
      });
      await core.runPhotometricBatch(controller);
    } else {
      throw new Error("Capture/retry may execute only the server-owned capture, flip, or batch-cleanup step.");
    }
    return this.toStatus(core);
  }

  executeExpectedStep(
    request: MathematicalCalibrationV1_2SessionMutationRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
    return this.serialize(request.sessionId, () => this.execute(request));
  }

  retryExpectedStep(
    request: MathematicalCalibrationV1_2SessionMutationRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
    return this.serialize(request.sessionId, () => this.execute(request));
  }

  replaceAcceptedPose(
    request: ReplaceMathematicalCalibrationV1_2PoseRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
    return this.serialize(request.sessionId, async () => {
      const { core, runtimeContext } = await this.openLive(request.sessionId);
      this.assertRevision(core, request.expectedRevision);
      if (!core.auditProjection().acceptedPoses.some((pose) => pose.active && pose.slot === request.acceptedSlot)) {
        throw new Error("Explicit pose replacement requires an existing active accepted slot.");
      }
      const frame = await this.config.checkerboardCapture.captureCheckerboard({
        sessionId: request.sessionId,
        slot: request.acceptedSlot,
        replacement: true,
        runtimeContext,
      });
      const derived = await this.analyzer.derivePose(frame.bytes, runtimeContext, await this.geometryAuthority(runtimeContext));
      await core.captureCheckerboard({ frame, pose: derived.pose, replaceSlot: request.acceptedSlot });
      return this.toStatus(core);
    });
  }

  analyze(
    request: MathematicalCalibrationV1_2SessionMutationRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
    return this.serialize(request.sessionId, async () => {
      const { core } = await this.openLive(request.sessionId);
      this.assertRevision(core, request.expectedRevision);
      await core.analyze();
      return this.toStatus(core);
    });
  }

  finalize(
    request: MathematicalCalibrationV1_2SessionMutationRequestDto,
  ): Promise<MathematicalCalibrationV1_2SessionStatusDto> {
    return this.serialize(request.sessionId, async () => {
      const { core } = await this.openLive(request.sessionId);
      this.assertRevision(core, request.expectedRevision);
      await core.finalize();
      return this.toStatus(core);
    });
  }
}
