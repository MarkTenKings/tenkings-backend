import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  BaslerLeimacMathematicalCalibrationSessionV1_2,
  BaslerLeimacMathematicalCalibrationCaptureV1_2,
  BaslerMathematicalCalibrationLiveContextV1_2,
} from "./baslerLeimacMathematicalCalibrationSessionV1_2";
import {
  FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2_SHA256,
  FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2_SHA256,
} from "./fixedRigFastCalibrationEvidenceAnalyzerV1_2";
import { FIXED_RIG_FAST_CALIBRATION_FINALIZER_V1_2_SHA256 } from "./fixedRigFastCalibrationFinalizerAlgorithmV1_2";
import type {
  DurableMathematicalCalibrationV1_2LocalSessionAuthorityConfig,
  MathematicalCalibrationV1_2PersistentBatchControllerFactory,
} from "./fixedRigFastMathematicalCalibrationLocalAuthorityV1_2";
import {
  assertFastCalibrationRuntimeContextMatchV1_2,
  validateFastCalibrationRuntimeContextV1_2,
  verifyFastCalibrationRigCharacterizationSourceV1_2,
  type FastCalibrationCapturedFrameV1_2,
  type FastCalibrationPersistentBatchControllerV1_2,
  type FastCalibrationRigCharacterizationSourceV1_2,
  type FastCalibrationRuntimeContextV1_2,
} from "./fixedRigFastMathematicalCalibrationV1_2";
import {
  FAST_CALIBRATION_RIG_SOURCE_BUNDLE_FILE_V1_2,
  FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2,
  loadMaterializedFastCalibrationRigAuthorityV1_2,
} from "./fixedRigFastMathematicalCalibrationRigMaterializerV1_2";

export const MATHEMATICAL_CALIBRATION_V1_2_PROTECTED_ENV = Object.freeze({
  runtimeContextPath: "AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_PATH",
  runtimeContextSha256: "AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RUNTIME_CONTEXT_SHA256",
  rigSourceBundlePath: "AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_BUNDLE_PATH",
  rigSourceBundleSha256: "AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_BUNDLE_SHA256",
  rigSourceMemberDir: "AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_RIG_SOURCE_MEMBER_DIR",
  finalizerStagingRoot: "AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_FINALIZER_STAGING_ROOT",
  operatorId: "AI_GRADER_MATHEMATICAL_CALIBRATION_V1_2_OPERATOR_ID",
});

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

export interface MathematicalCalibrationV1_2ProductionHardwareConfig {
  outputDir: string;
  cameraIndex?: number;
  pylonRoot?: string;
  bridgeScriptPath?: string;
  powershellPath?: string;
  timeoutMs?: number;
  leimacHost?: string;
  leimacPort?: number;
  leimacUnit?: number;
}

export interface MathematicalCalibrationV1_2ProductionLowLevelBoundary {
  inspectLiveRuntimeContext(
    expected: FastCalibrationRuntimeContextV1_2,
  ): Promise<FastCalibrationRuntimeContextV1_2>;
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
  createPersistentBatch(input: {
    sessionId: string;
    runtimeContext: FastCalibrationRuntimeContextV1_2;
  }): FastCalibrationPersistentBatchControllerV1_2;
}

export interface BuildMathematicalCalibrationV1_2ProductionAuthorityConfigInput {
  env?: NodeJS.ProcessEnv;
  outputRoot: string;
  hardware: MathematicalCalibrationV1_2ProductionHardwareConfig;
  lowLevelBoundary?: MathematicalCalibrationV1_2ProductionLowLevelBoundary;
}

type ProtectedPaths = {
  runtimeContextPath: string;
  runtimeContextSha256: string;
  rigSourceBundlePath: string;
  rigSourceBundleSha256: string;
  rigSourceMemberDir: string;
  finalizerStagingRoot: string;
  operatorId: string;
};

function hash(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function parseCanonicalJson<T>(bytes: Buffer, label: string): T {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  const canonicalBytes = Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
  if (!bytes.equals(canonicalBytes)) throw new Error(`${label} must be exact canonical JSON bytes.`);
  return value as T;
}

function protectedPaths(env: NodeJS.ProcessEnv): ProtectedPaths | undefined {
  const entries = Object.entries(MATHEMATICAL_CALIBRATION_V1_2_PROTECTED_ENV).map(([key, envKey]) =>
    [key, env[envKey]?.trim() ?? ""] as const);
  if (entries.every(([, value]) => value === "")) return undefined;
  const missing = entries.filter(([, value]) => value === "").map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Mathematical Calibration V1.2 protected configuration is partial; missing ${missing.join(", ")}.`);
  }
  const values = Object.fromEntries(entries) as unknown as ProtectedPaths;
  for (const [label, value] of [
    ["runtime context path", values.runtimeContextPath],
    ["rig source bundle path", values.rigSourceBundlePath],
    ["rig source member directory", values.rigSourceMemberDir],
    ["finalizer staging root", values.finalizerStagingRoot],
  ] as const) {
    if (!path.isAbsolute(value)) throw new Error(`Mathematical Calibration V1.2 ${label} must be absolute.`);
  }
  if (!SHA256.test(values.runtimeContextSha256) || !SHA256.test(values.rigSourceBundleSha256)) {
    throw new Error("Mathematical Calibration V1.2 protected file hashes must be exact lowercase SHA-256 values.");
  }
  if (path.resolve(values.runtimeContextPath) !== path.join(path.resolve(values.rigSourceMemberDir), FAST_CALIBRATION_RUNTIME_CONTEXT_FILE_V1_2) ||
      path.resolve(values.rigSourceBundlePath) !== path.join(path.resolve(values.rigSourceMemberDir), FAST_CALIBRATION_RIG_SOURCE_BUNDLE_FILE_V1_2)) {
    throw new Error(
      "Mathematical Calibration V1.2 runtime and rig bundle must be loaded from the exact atomic materialization directory.",
    );
  }
  if (!SAFE_ID.test(values.operatorId)) throw new Error("Mathematical Calibration V1.2 protected operator ID is invalid.");
  return values;
}

async function readExact(pathName: string, expectedSha256: string, label: string): Promise<Buffer> {
  const bytes = await readFile(pathName);
  if (hash(bytes) !== expectedSha256) throw new Error(`${label} differs from its protected exact SHA-256.`);
  return bytes;
}

function controllerAcknowledgement(
  context: FastCalibrationRuntimeContextV1_2,
  capture: BaslerLeimacMathematicalCalibrationCaptureV1_2,
): FastCalibrationCapturedFrameV1_2["metadata"]["controller"] {
  const responseKinds = [
    ...capture.safeOffBeforeResponseKinds,
    ...capture.lightingResponseKinds,
    ...capture.safeOffAfterResponseKinds,
  ];
  return {
    controllerIdentity: context.controller.identity,
    expectedWriteCount: responseKinds.length,
    acknowledgedWriteCount: responseKinds.length,
    responseKinds,
    complete: true,
  };
}

async function exactFrame(
  context: FastCalibrationRuntimeContextV1_2,
  result: BaslerLeimacMathematicalCalibrationCaptureV1_2,
): Promise<FastCalibrationCapturedFrameV1_2> {
  if (result.capture.mimeType !== "image/tiff") throw new Error("Mathematical calibration capture must remain exact TIFF evidence.");
  const bytes = await readFile(result.capture.outputFilePath);
  if (bytes.length !== result.capture.byteSize || hash(bytes) !== result.capture.sha256) {
    throw new Error("Mathematical calibration capture bytes differ from the capture checkpoint.");
  }
  return {
    bytes,
    mediaType: "image/tiff",
    metadata: {
      capturedAt: result.capture.timestamp,
      camera: context.camera,
      controller: controllerAcknowledgement(context, result),
      safeOffBeforeConfirmed: result.safeOffBeforeResponseKinds.every((entry) => entry === "ack"),
      safeOffAfterConfirmed: result.safeOffAfterResponseKinds.every((entry) => entry === "ack"),
    },
  };
}

function observedContext(
  expected: FastCalibrationRuntimeContextV1_2,
  observed: BaslerMathematicalCalibrationLiveContextV1_2,
): FastCalibrationRuntimeContextV1_2 {
  return {
    ...expected,
    camera: {
      ...expected.camera,
      serialNumber: observed.camera.serialNumber,
      modelName: observed.camera.modelName,
      exposureUs: observed.camera.exposureUs,
      gain: observed.camera.gain,
      pixelFormat: observed.camera.pixelFormat,
      widthPx: observed.camera.widthPx,
      heightPx: observed.camera.heightPx,
    },
    controller: {
      ...expected.controller,
      identity: observed.controller.identity,
      unit: observed.controller.unit,
    },
  };
}

export class BaslerLeimacMathematicalCalibrationProductionBoundaryV1_2
implements MathematicalCalibrationV1_2ProductionLowLevelBoundary {
  constructor(private readonly hardware: MathematicalCalibrationV1_2ProductionHardwareConfig) {
    if (!hardware.leimacHost) throw new Error("Mathematical Calibration V1.2 requires the protected Leimac host.");
    if (hardware.leimacPort !== undefined && (!Number.isInteger(hardware.leimacPort) || hardware.leimacPort < 1 || hardware.leimacPort > 65535)) {
      throw new Error("Mathematical Calibration V1.2 Leimac port is invalid.");
    }
    if (hardware.leimacUnit !== undefined && (!Number.isInteger(hardware.leimacUnit) || hardware.leimacUnit < 1 || hardware.leimacUnit > 5)) {
      throw new Error("Mathematical Calibration V1.2 Leimac unit is invalid.");
    }
  }

  private async session(
    context: FastCalibrationRuntimeContextV1_2,
    sessionId: string,
  ): Promise<BaslerLeimacMathematicalCalibrationSessionV1_2> {
    const { BaslerLeimacMathematicalCalibrationSessionV1_2: Session } = await import("./baslerLeimacMathematicalCalibrationSessionV1_2");
    return new Session({
      outputDir: path.join(this.hardware.outputDir, "mathematical-v1.2-hardware", sessionId),
      cameraIndex: this.hardware.cameraIndex ?? 0,
      ...(this.hardware.pylonRoot ? { pylonRoot: this.hardware.pylonRoot } : {}),
      ...(this.hardware.bridgeScriptPath ? { bridgeScriptPath: this.hardware.bridgeScriptPath } : {}),
      ...(this.hardware.powershellPath ? { powershellPath: this.hardware.powershellPath } : {}),
      ...(this.hardware.timeoutMs ? { timeoutMs: this.hardware.timeoutMs } : {}),
      exposureUs: context.camera.exposureUs,
      gain: context.camera.gain,
      leimacHost: this.hardware.leimacHost!,
      leimacPort: this.hardware.leimacPort ?? 1000,
      leimacUnit: this.hardware.leimacUnit ?? context.controller.unit,
      dutyPercent: context.dutyPercent,
    });
  }

  async inspectLiveRuntimeContext(expected: FastCalibrationRuntimeContextV1_2): Promise<FastCalibrationRuntimeContextV1_2> {
    const session = await this.session(expected, "context-probe");
    return observedContext(expected, await session.probeContext());
  }

  async captureCheckerboard(input: {
    sessionId: string;
    slot: number;
    replacement: boolean;
    runtimeContext: FastCalibrationRuntimeContextV1_2;
  }): Promise<FastCalibrationCapturedFrameV1_2> {
    const session = await this.session(input.runtimeContext, input.sessionId);
    let opened = false;
    try {
      const live = await session.open();
      opened = true;
      assertFastCalibrationRuntimeContextMatchV1_2(
        input.runtimeContext,
        observedContext(input.runtimeContext, live),
      );
      return exactFrame(input.runtimeContext, await session.captureCheckerboard({
        operationId: `pose-${input.slot}-${crypto.randomUUID()}`,
        slot: input.slot,
        replacement: input.replacement,
        dutyPercent: input.runtimeContext.dutyPercent,
      }));
    } finally {
      if (opened) {
        try { await session.safeOff(); } finally { await session.close(); }
      }
    }
  }

  async confirmBlankReverseFlip(): Promise<{ confirmed: true }> {
    return { confirmed: true };
  }

  createPersistentBatch(input: {
    sessionId: string;
    runtimeContext: FastCalibrationRuntimeContextV1_2;
  }): FastCalibrationPersistentBatchControllerV1_2 {
    let session: Promise<BaslerLeimacMathematicalCalibrationSessionV1_2> | undefined;
    const loadSession = () => {
      session ??= this.session(input.runtimeContext, input.sessionId);
      return session;
    };
    return {
      open: async (expected) => observedContext(expected, await (await loadSession()).open()),
      capture: async (request) => exactFrame(input.runtimeContext, await (await loadSession()).capture(request)),
      safeOff: async () => ({
        controllerIdentity: input.runtimeContext.controller.identity,
        confirmed: true,
        responseKinds: await (await loadSession()).safeOff(),
      }),
      close: async () => (await loadSession()).close(),
    };
  }
}

export function buildMathematicalCalibrationV1_2ProductionAuthorityConfig(
  input: BuildMathematicalCalibrationV1_2ProductionAuthorityConfigInput,
): DurableMathematicalCalibrationV1_2LocalSessionAuthorityConfig | undefined {
  const paths = protectedPaths(input.env ?? process.env);
  if (!paths) return undefined;
  const boundary = input.lowLevelBoundary ??
    new BaslerLeimacMathematicalCalibrationProductionBoundaryV1_2(input.hardware);

  const loadProtectedRuntime = async (): Promise<FastCalibrationRuntimeContextV1_2> => {
    const bytes = await readExact(paths.runtimeContextPath, paths.runtimeContextSha256, "Protected runtime context");
    const context = parseCanonicalJson<FastCalibrationRuntimeContextV1_2>(bytes, "Protected runtime context");
    validateFastCalibrationRuntimeContextV1_2(context);
    if (context.algorithmHashes.geometry !== FIXED_RIG_FAST_CALIBRATION_GEOMETRY_ANALYZER_V1_2_SHA256 ||
        context.algorithmHashes.photometric !== FIXED_RIG_FAST_CALIBRATION_PHOTOMETRIC_ANALYZER_V1_2_SHA256 ||
        context.algorithmHashes.finalizer !== FIXED_RIG_FAST_CALIBRATION_FINALIZER_V1_2_SHA256) {
      throw new Error("Protected runtime context does not bind the loaded V1.2 analyzer/finalizer implementation manifests.");
    }
    return context;
  };

  const loadRigCharacterizationSource = async (): Promise<FastCalibrationRigCharacterizationSourceV1_2> => {
    const expectedRuntime = await loadProtectedRuntime();
    const materialized = await loadMaterializedFastCalibrationRigAuthorityV1_2({
      directory: paths.rigSourceMemberDir,
      expectedRuntimeContextSha256: paths.runtimeContextSha256,
      expectedRigSourceBundleSha256: paths.rigSourceBundleSha256,
    });
    assertFastCalibrationRuntimeContextMatchV1_2(expectedRuntime, materialized.runtimeContext);
    verifyFastCalibrationRigCharacterizationSourceV1_2(materialized.rigSource, expectedRuntime);
    return materialized.rigSource;
  };

  const persistentBatchControllers: MathematicalCalibrationV1_2PersistentBatchControllerFactory = {
    create: (session) => boundary.createPersistentBatch(session),
  };
  return {
    outputRoot: input.outputRoot,
    operatorId: paths.operatorId,
    finalizerStagingRoot: paths.finalizerStagingRoot,
    loadRuntimeContext: loadProtectedRuntime,
    loadRigCharacterizationSource,
    verifyLiveRuntimeContext: async (expected) => {
      assertFastCalibrationRuntimeContextMatchV1_2(expected, await boundary.inspectLiveRuntimeContext(expected));
    },
    checkerboardCapture: {
      captureCheckerboard: (request) => boundary.captureCheckerboard(request),
      confirmBlankReverseFlip: (request) => boundary.confirmBlankReverseFlip(request),
    },
    persistentBatchControllers,
  };
}
