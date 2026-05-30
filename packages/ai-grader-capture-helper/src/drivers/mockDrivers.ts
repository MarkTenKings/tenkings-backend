import type {
  CaptureHelperSimulatorConfig,
} from "@tenkings/ai-grader-simulator";
import type {
  CaptureManifestFrame,
  CoordinateUnit,
  DeviceCapabilityManifest,
  DeviceType,
  EvidenceArtifactRef,
} from "@tenkings/shared";
import { validateDeviceCapabilityManifest } from "@tenkings/shared";
import type {
  ArmInterlockDriver,
  ArmInterlockState,
  CaptureHelperDriverSetDrivers,
  DeviceDriver,
  DeviceDriverHealth,
  DriverLifecycleState,
  LEDControllerDriver,
  LedIlluminationRequest,
  MacroCameraDriver,
  MacroFrameRequest,
  MicroFrameRequest,
  MicroscopeDriver,
  StageDriver,
  StagePosition,
} from "./types";

export type MockDriverFailurePoint =
  | "open"
  | "close"
  | "health_check"
  | "capability"
  | "capture"
  | "illumination"
  | "move"
  | "interlock";

export type MockDriverFailures = Partial<Record<MockDriverFailurePoint, string | true>>;

export interface MockDriverOptions {
  failures?: MockDriverFailures;
}

interface MockDriverDefinition {
  idSuffix: string;
  deviceType: DeviceType;
  driverName: string;
  driverVersion: string;
  componentSerial: string;
  supportedCapturePackages: string[];
  coordinateUnits: Record<string, CoordinateUnit>;
  timingCharacteristics: Record<string, number>;
  healthCheckName: string;
  healthTimeoutMs: number;
  requiredCalibrationTypes: string[];
}

export class MockDriverError extends Error {
  constructor(driverName: string, point: MockDriverFailurePoint, message?: string) {
    super(message ?? `${driverName} injected failure at ${point}.`);
    this.name = "MockDriverError";
  }
}

abstract class BaseMockDeviceDriver implements DeviceDriver {
  readonly id: string;
  readonly deviceType: DeviceType;
  readonly driverName: string;
  readonly driverVersion: string;
  readonly componentSerial: string;
  protected readonly config: CaptureHelperSimulatorConfig;
  protected readonly definition: MockDriverDefinition;
  protected readonly failures: MockDriverFailures;
  private lifecycleState: DriverLifecycleState = "closed";

  constructor(config: CaptureHelperSimulatorConfig, definition: MockDriverDefinition, options: MockDriverOptions = {}) {
    this.config = config;
    this.definition = definition;
    this.failures = options.failures ?? {};
    this.id = mockId(config, "driver", definition.idSuffix);
    this.deviceType = definition.deviceType;
    this.driverName = definition.driverName;
    this.driverVersion = definition.driverVersion;
    this.componentSerial = serialFor(config, definition.componentSerial);
  }

  get state(): DriverLifecycleState {
    return this.lifecycleState;
  }

  open(): void {
    this.throwIfFailure("open");
    this.lifecycleState = "open";
  }

  close(): void {
    this.throwIfFailure("close");
    this.lifecycleState = "closed";
  }

  health_check(): DeviceDriverHealth {
    const failure = this.failureMessage("health_check");
    if (failure) {
      return {
        check: this.definition.healthCheckName,
        status: "FAIL",
        detail: failure,
      };
    }
    return {
      check: this.definition.healthCheckName,
      status: "PASS",
      detail: `${this.driverName} mock driver ${this.lifecycleState}.`,
    };
  }

  getCapabilityManifest(): DeviceCapabilityManifest {
    this.throwIfFailure("capability");
    const manifestWithoutChecksum = {
      id: mockId(this.config, "device-capability", this.definition.idSuffix),
      rigId: this.config.rigId,
      helperInstanceId: this.config.helperInstanceId,
      driverName: this.driverName,
      driverVersion: this.driverVersion,
      deviceType: this.deviceType,
      componentSerial: this.componentSerial,
      supportedCapturePackages: this.definition.supportedCapturePackages,
      coordinateUnits: this.definition.coordinateUnits,
      timingCharacteristics: this.definition.timingCharacteristics,
      healthChecks: [
        {
          name: this.definition.healthCheckName,
          required: true,
          timeoutMs: this.definition.healthTimeoutMs,
        },
      ],
      requiredCalibrationTypes: this.definition.requiredCalibrationTypes,
      observedAt: this.config.createdAt,
    };
    const manifest: DeviceCapabilityManifest = {
      ...manifestWithoutChecksum,
      checksum: deterministicHex(manifestWithoutChecksum),
    };
    const validation = validateDeviceCapabilityManifest(manifest);
    if (!validation.valid) {
      const detail = validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      throw new Error(`${this.driverName} produced invalid DeviceCapabilityManifest: ${detail}`);
    }
    return manifest;
  }

  protected throwIfFailure(point: MockDriverFailurePoint): void {
    const message = this.failureMessage(point);
    if (message) {
      throw new MockDriverError(this.driverName, point, message);
    }
  }

  protected failureMessage(point: MockDriverFailurePoint): string | undefined {
    const failure = this.failures[point];
    if (failure == null) return undefined;
    return failure === true ? `${this.driverName} injected failure at ${point}.` : failure;
  }

  protected capturedAt(offsetSeconds: number): string {
    return timestampOffset(this.config, offsetSeconds);
  }

  protected storageKey(...parts: string[]): string {
    return [
      trimSlashes(this.config.storagePrefix),
      this.config.tenantId,
      this.config.captureSessionId,
      this.config.seed,
      "mock-driver",
      ...parts.map((part) => part.split("/").map(slugPart).join("/")),
    ].join("/");
  }
}

export class MockMacroCameraDriver extends BaseMockDeviceDriver implements MacroCameraDriver {
  readonly deviceType = "MACRO_CAMERA" as const;

  constructor(config: CaptureHelperSimulatorConfig, options: MockDriverOptions = {}) {
    super(config, MOCK_DRIVER_DEFINITIONS.macroCamera, options);
  }

  captureFrame(request: MacroFrameRequest): CaptureManifestFrame {
    this.throwIfFailure("capture");
    const storageLabel = request.storageLabel ?? `${request.side.toLowerCase()}-${request.kind.toLowerCase()}`;
    return {
      frameId: mockId(this.config, "frame", "macro", request.kind, request.side, String(request.ordinal), storageLabel),
      kind: request.kind,
      side: request.side,
      storageKey: `${this.storageKey("macro", storageLabel)}.jpg`,
      checksumSha256: deterministicHex([this.config.seed, "macro", request.kind, request.side, request.ordinal, storageLabel]),
      capturedAt: this.capturedAt(10 + request.ordinal),
      exposureUs: request.exposureUs ?? 11000 + request.ordinal * 100,
      widthPx: request.widthPx ?? 4096,
      heightPx: request.heightPx ?? 4096,
    };
  }
}

export class MockLEDControllerDriver extends BaseMockDeviceDriver implements LEDControllerDriver {
  readonly deviceType = "LED_CONTROLLER" as const;

  constructor(config: CaptureHelperSimulatorConfig, options: MockDriverOptions = {}) {
    super(config, MOCK_DRIVER_DEFINITIONS.ledController, options);
  }

  setIllumination(request: LedIlluminationRequest): LedIlluminationRequest & { appliedAt: string } {
    this.throwIfFailure("illumination");
    if (!Number.isInteger(request.ledMask) || request.ledMask < 0) {
      throw new MockDriverError(this.driverName, "illumination", "ledMask must be a non-negative integer.");
    }
    return {
      ...request,
      intensityPct: request.intensityPct ?? 100,
      appliedAt: this.capturedAt(20),
    };
  }

  clearIllumination(): { ledMask: 0; appliedAt: string } {
    this.throwIfFailure("illumination");
    return {
      ledMask: 0,
      appliedAt: this.capturedAt(21),
    };
  }
}

export class MockMicroscopeDriver extends BaseMockDeviceDriver implements MicroscopeDriver {
  readonly deviceType = "MICROSCOPE" as const;

  constructor(config: CaptureHelperSimulatorConfig, options: MockDriverOptions = {}) {
    super(config, MOCK_DRIVER_DEFINITIONS.microscope, options);
  }

  captureEvidence(request: MicroFrameRequest): EvidenceArtifactRef {
    this.throwIfFailure("capture");
    const widthPx = request.widthPx ?? 2448;
    const heightPx = request.heightPx ?? 2048;
    const storageKey = `${this.storageKey("micro", request.packageId, request.label)}.tiff`;
    return {
      id: mockId(this.config, "evidence", request.packageId, request.label),
      storageKey,
      checksumSha256: deterministicHex([this.config.seed, "micro", request.packageId, request.label, request.ordinal]),
      mimeType: "image/tiff",
      byteSize: 512000 + request.ordinal * 4096,
      widthPx,
      heightPx,
    };
  }
}

export class MockStageDriver extends BaseMockDeviceDriver implements StageDriver {
  readonly deviceType = "XY_STAGE" as const;
  private position: StagePosition = { xMicrons: 0, yMicrons: 0 };

  constructor(config: CaptureHelperSimulatorConfig, options: MockDriverOptions = {}) {
    super(config, MOCK_DRIVER_DEFINITIONS.stage, options);
  }

  home(): StagePosition {
    this.throwIfFailure("move");
    this.position = { xMicrons: 0, yMicrons: 0 };
    return this.getPosition();
  }

  moveTo(position: StagePosition): StagePosition {
    this.throwIfFailure("move");
    if (!Number.isFinite(position.xMicrons) || !Number.isFinite(position.yMicrons)) {
      throw new MockDriverError(this.driverName, "move", "Stage position must include finite micron coordinates.");
    }
    this.position = { ...position };
    return this.getPosition();
  }

  getPosition(): StagePosition {
    return { ...this.position };
  }
}

export class MockArmInterlockDriver extends BaseMockDeviceDriver implements ArmInterlockDriver {
  readonly deviceType = "ARM_INTERLOCK" as const;

  constructor(config: CaptureHelperSimulatorConfig, options: MockDriverOptions = {}) {
    super(config, MOCK_DRIVER_DEFINITIONS.armInterlock, options);
  }

  readState(): ArmInterlockState {
    this.throwIfFailure("interlock");
    return {
      armInPosition: true,
      safeForMacro: true,
      safeForMicro: true,
      detail: "mock arm interlock reports safe simulated position",
    };
  }
}

export interface CreateMockDriverSetOptions {
  failures?: Partial<Record<keyof CaptureHelperDriverSetDrivers, MockDriverFailures>>;
}

export function createMockDriverSet(
  config: CaptureHelperSimulatorConfig,
  options: CreateMockDriverSetOptions = {}
): CaptureHelperDriverSetDrivers {
  return {
    macroCamera: new MockMacroCameraDriver(config, { failures: options.failures?.macroCamera }),
    ledController: new MockLEDControllerDriver(config, { failures: options.failures?.ledController }),
    microscope: new MockMicroscopeDriver(config, { failures: options.failures?.microscope }),
    stage: new MockStageDriver(config, { failures: options.failures?.stage }),
    armInterlock: new MockArmInterlockDriver(config, { failures: options.failures?.armInterlock }),
  };
}

export function mockDriverCapabilities(drivers: CaptureHelperDriverSetDrivers): DeviceCapabilityManifest[] {
  return [
    drivers.macroCamera.getCapabilityManifest(),
    drivers.ledController.getCapabilityManifest(),
    drivers.microscope.getCapabilityManifest(),
    drivers.stage.getCapabilityManifest(),
    drivers.armInterlock.getCapabilityManifest(),
  ];
}

const MOCK_DRIVER_DEFINITIONS = {
  macroCamera: {
    idSuffix: "macro-camera",
    deviceType: "MACRO_CAMERA",
    driverName: "mock-macro-camera",
    driverVersion: "mock-1.0.0",
    componentSerial: "MOCK-MACRO-0001",
    supportedCapturePackages: ["QUICK_MACRO", "STANDARD_MACRO", "AUTH_ONLY_MACRO"],
    coordinateUnits: { image: "px", exposure: "micron" },
    timingCharacteristics: { captureMs: 120, settleMs: 25 },
    healthCheckName: "mock-macro-camera-open",
    healthTimeoutMs: 250,
    requiredCalibrationTypes: ["COLOR_CHECKER_CCM", "MACRO_INTRINSICS", "MACRO_FLAT_FIELD"],
  },
  ledController: {
    idSuffix: "led-controller",
    deviceType: "LED_CONTROLLER",
    driverName: "mock-led-controller",
    driverVersion: "mock-1.0.0",
    componentSerial: "MOCK-LED-0001",
    supportedCapturePackages: ["STANDARD_FLC", "MACRO_DARKFIELD"],
    coordinateUnits: { channelMask: "bitmask" },
    timingCharacteristics: { channelSwitchMs: 8, warmupMs: 20 },
    healthCheckName: "mock-led-channel-health",
    healthTimeoutMs: 500,
    requiredCalibrationTypes: ["LED_INTENSITY_HEALTH"],
  },
  microscope: {
    idSuffix: "microscope",
    deviceType: "MICROSCOPE",
    driverName: "mock-microscope",
    driverVersion: "mock-1.0.0",
    componentSerial: "MOCK-MICRO-0001",
    supportedCapturePackages: ["STANDARD_MICRO_SPOT", "AUTH_PATCH"],
    coordinateUnits: { image: "px", scale: "micron" },
    timingCharacteristics: { captureMs: 180, focusMs: 45 },
    healthCheckName: "mock-microscope-focus",
    healthTimeoutMs: 750,
    requiredCalibrationTypes: ["MICROSCOPE_PX_PER_MICRON", "MICROSCOPE_FOCUS_BASELINE"],
  },
  stage: {
    idSuffix: "xy-stage",
    deviceType: "XY_STAGE",
    driverName: "mock-xy-stage",
    driverVersion: "mock-1.0.0",
    componentSerial: "MOCK-STAGE-0001",
    supportedCapturePackages: ["STANDARD_MICRO_SPOT", "AUTH_PATCH"],
    coordinateUnits: { x: "micron", y: "micron" },
    timingCharacteristics: { moveMs: 80, settleMs: 35 },
    healthCheckName: "mock-stage-home",
    healthTimeoutMs: 1000,
    requiredCalibrationTypes: ["STAGE_HOME", "CARD_JIG_TRANSFORM"],
  },
  armInterlock: {
    idSuffix: "arm-interlock",
    deviceType: "ARM_INTERLOCK",
    driverName: "mock-arm-interlock",
    driverVersion: "mock-1.0.0",
    componentSerial: "MOCK-ARM-0001",
    supportedCapturePackages: ["MACRO_ARM_OUT", "MICRO_ARM_IN"],
    coordinateUnits: { position: "bitmask" },
    timingCharacteristics: { readMs: 5 },
    healthCheckName: "mock-arm-position-readable",
    healthTimeoutMs: 100,
    requiredCalibrationTypes: ["ARM_INTERLOCK_HEALTH"],
  },
} satisfies Record<string, MockDriverDefinition>;

function mockId(config: CaptureHelperSimulatorConfig, ...parts: string[]): string {
  return `mock:${config.captureSessionId}:${parts.map(slugPart).join(":")}`;
}

function serialFor(config: CaptureHelperSimulatorConfig, serial: string): string {
  return `${serial}-${slugPart(config.seed).slice(0, 12)}`;
}

function timestampOffset(config: CaptureHelperSimulatorConfig, seconds: number): string {
  return new Date(Date.parse(config.createdAt) + seconds * 1000).toISOString();
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function slugPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "mock";
}

function deterministicHex(value: unknown): string {
  const text = typeof value === "string" ? value : stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let output = "";
  for (let index = 0; index < 8; index += 1) {
    hash ^= index + text.length;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    output += hash.toString(16).padStart(8, "0");
  }
  return output.slice(0, 64);
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
