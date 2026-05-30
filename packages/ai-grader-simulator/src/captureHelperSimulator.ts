import {
  buildMicroSpotPackageId,
  type CaptureManifest,
  type CaptureManifestFrame,
  type CaptureSide,
  type DeviceCapabilityManifest,
  type DeviceType,
  type EvidenceArtifactRef,
  type GradingCaptureKind,
  type MicroSpotCapturePackage,
  type MicroSpotElement,
  validateCaptureManifestForMode,
  validateDeviceCapabilityManifest,
  validateMicroSpotCapturePackage,
} from "@tenkings/shared";

export interface CaptureHelperSimulatorConfig {
  tenantId: string;
  captureSessionId: string;
  rigId: string;
  locationId: string;
  operatorId: string;
  helperInstanceId: string;
  helperVersion: string;
  seed: string;
  createdAt: string;
  storagePrefix: string;
  calibrationSnapshotIds: string[];
  standardSurfaceSuspectRegionIds: string[];
}

export type CaptureHelperSimulatorConfigInput = Partial<CaptureHelperSimulatorConfig>;

export interface StandardCaptureSimulation {
  captureManifest: CaptureManifest;
  microSpotPackages: MicroSpotCapturePackage[];
  evidenceArtifacts: EvidenceArtifactRef[];
}

export interface CaptureHelperSimulator {
  readonly config: CaptureHelperSimulatorConfig;
  generateDeviceCapabilityManifests(): DeviceCapabilityManifest[];
  generateQuickCaptureManifest(): CaptureManifest;
  generateStandardCaptureManifest(): CaptureManifest;
  generateStandardCaptureSimulation(): StandardCaptureSimulation;
  generateAuthOnlyCaptureManifest(): CaptureManifest;
}

type SimulatorDeviceDefinition = {
  deviceType: DeviceType;
  idSuffix: string;
  driverName: string;
  driverVersion: string;
  componentSerialKey: string;
  componentSerial: string;
  supportedCapturePackages: string[];
  coordinateUnits: Record<string, "px" | "mm" | "micron" | "degree" | "bitmask">;
  timingCharacteristics: Record<string, number>;
  healthChecks: Array<{ name: string; required: boolean; timeoutMs: number }>;
  requiredCalibrationTypes: string[];
};

const DEFAULT_CREATED_AT = "2026-05-28T12:00:00.000Z";
const DEFAULT_SURFACE_REGION_IDS = [
  "macro-suspect:simulated-session:FRONT:SURFACE:1:sim-threshold",
  "macro-suspect:simulated-session:FRONT:SURFACE:2:sim-threshold",
  "macro-suspect:simulated-session:FRONT:SURFACE:3:sim-threshold",
];

const MICRO_FRAME_DEFINITIONS: Array<{
  key: keyof MicroSpotCapturePackage["frames"];
  kind: GradingCaptureKind;
  label: string;
}> = [
  { key: "edrBase", kind: "EDR_BASE", label: "edr-base" },
  { key: "polarizedAllOn", kind: "POLARIZED_ALL_ON", label: "polarized-all-on" },
  { key: "flcLed0", kind: "FLC_LED_0", label: "flc-led-0" },
  { key: "flcLed1", kind: "FLC_LED_1", label: "flc-led-1" },
  { key: "flcLed2", kind: "FLC_LED_2", label: "flc-led-2" },
  { key: "flcLed3", kind: "FLC_LED_3", label: "flc-led-3" },
  { key: "flcLed4", kind: "FLC_LED_4", label: "flc-led-4" },
  { key: "flcLed5", kind: "FLC_LED_5", label: "flc-led-5" },
  { key: "flcLed6", kind: "FLC_LED_6", label: "flc-led-6" },
  { key: "flcLed7", kind: "FLC_LED_7", label: "flc-led-7" },
];

const DEVICE_DEFINITIONS: SimulatorDeviceDefinition[] = [
  {
    deviceType: "MACRO_CAMERA",
    idSuffix: "macro-camera",
    driverName: "simulated-macro-camera",
    driverVersion: "sim-1.0.0",
    componentSerialKey: "macroCamera",
    componentSerial: "SIM-MACRO-0001",
    supportedCapturePackages: ["QUICK_MACRO", "STANDARD_MACRO", "AUTH_ONLY_MACRO"],
    coordinateUnits: { image: "px", exposure: "micron" },
    timingCharacteristics: { captureMs: 120, settleMs: 25 },
    healthChecks: [{ name: "simulated-macro-camera-open", required: true, timeoutMs: 250 }],
    requiredCalibrationTypes: ["COLOR_CHECKER_CCM", "MACRO_INTRINSICS", "MACRO_FLAT_FIELD"],
  },
  {
    deviceType: "LED_CONTROLLER",
    idSuffix: "led-controller",
    driverName: "simulated-led-controller",
    driverVersion: "sim-1.0.0",
    componentSerialKey: "ledController",
    componentSerial: "SIM-LED-0001",
    supportedCapturePackages: ["STANDARD_FLC", "MACRO_DARKFIELD"],
    coordinateUnits: { channelMask: "bitmask" },
    timingCharacteristics: { channelSwitchMs: 8, warmupMs: 20 },
    healthChecks: [{ name: "simulated-led-channel-health", required: true, timeoutMs: 500 }],
    requiredCalibrationTypes: ["LED_INTENSITY_HEALTH"],
  },
  {
    deviceType: "MICROSCOPE",
    idSuffix: "microscope",
    driverName: "simulated-microscope",
    driverVersion: "sim-1.0.0",
    componentSerialKey: "microscope",
    componentSerial: "SIM-MICRO-0001",
    supportedCapturePackages: ["STANDARD_MICRO_SPOT", "AUTH_PATCH"],
    coordinateUnits: { image: "px", scale: "micron" },
    timingCharacteristics: { captureMs: 180, focusMs: 45 },
    healthChecks: [{ name: "simulated-microscope-focus", required: true, timeoutMs: 750 }],
    requiredCalibrationTypes: ["MICROSCOPE_PX_PER_MICRON", "MICROSCOPE_FOCUS_BASELINE"],
  },
  {
    deviceType: "XY_STAGE",
    idSuffix: "xy-stage",
    driverName: "simulated-xy-stage",
    driverVersion: "sim-1.0.0",
    componentSerialKey: "xyStage",
    componentSerial: "SIM-STAGE-0001",
    supportedCapturePackages: ["STANDARD_MICRO_SPOT", "AUTH_PATCH"],
    coordinateUnits: { x: "micron", y: "micron" },
    timingCharacteristics: { moveMs: 80, settleMs: 35 },
    healthChecks: [{ name: "simulated-stage-home", required: true, timeoutMs: 1000 }],
    requiredCalibrationTypes: ["STAGE_HOME", "CARD_JIG_TRANSFORM"],
  },
  {
    deviceType: "ARM_INTERLOCK",
    idSuffix: "arm-interlock",
    driverName: "simulated-arm-interlock",
    driverVersion: "sim-1.0.0",
    componentSerialKey: "armInterlock",
    componentSerial: "SIM-ARM-0001",
    supportedCapturePackages: ["MACRO_ARM_OUT", "MICRO_ARM_IN"],
    coordinateUnits: { position: "bitmask" },
    timingCharacteristics: { readMs: 5 },
    healthChecks: [{ name: "simulated-arm-position-readable", required: true, timeoutMs: 100 }],
    requiredCalibrationTypes: ["ARM_INTERLOCK_HEALTH"],
  },
];

export class CaptureHelperSimulatorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureHelperSimulatorConfigError";
  }
}

export function buildCaptureHelperSimulatorConfig(
  input: CaptureHelperSimulatorConfigInput = {}
): CaptureHelperSimulatorConfig {
  const captureSessionId = input.captureSessionId ?? "simulated-session";
  const config: CaptureHelperSimulatorConfig = {
    tenantId: input.tenantId ?? "simulated-tenant",
    captureSessionId,
    rigId: input.rigId ?? "simulated-rig",
    locationId: input.locationId ?? "simulated-location",
    operatorId: input.operatorId ?? "simulated-operator",
    helperInstanceId: input.helperInstanceId ?? "simulated-helper-instance",
    helperVersion: input.helperVersion ?? "sim-1.0.0",
    seed: input.seed ?? "simulated-seed",
    createdAt: input.createdAt ?? DEFAULT_CREATED_AT,
    storagePrefix: input.storagePrefix ?? "simulated-captures",
    calibrationSnapshotIds: input.calibrationSnapshotIds ?? [
      "calibration:simulated-rig:macro",
      "calibration:simulated-rig:led",
      "calibration:simulated-rig:microscope",
      "calibration:simulated-rig:stage",
      "calibration:simulated-rig:arm",
    ],
    standardSurfaceSuspectRegionIds:
      input.standardSurfaceSuspectRegionIds ??
      DEFAULT_SURFACE_REGION_IDS.map((id) => id.replace("simulated-session", captureSessionId)),
  };

  validateCaptureHelperSimulatorConfig(config);
  return config;
}

export function validateCaptureHelperSimulatorConfig(
  config: CaptureHelperSimulatorConfigInput
): asserts config is CaptureHelperSimulatorConfig {
  const requiredStringFields: Array<keyof CaptureHelperSimulatorConfig> = [
    "tenantId",
    "captureSessionId",
    "rigId",
    "locationId",
    "operatorId",
    "helperInstanceId",
    "helperVersion",
    "seed",
    "createdAt",
    "storagePrefix",
  ];

  for (const field of requiredStringFields) {
    const value = config[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new CaptureHelperSimulatorConfigError(`${field} must be a non-empty string.`);
    }
  }

  if (!Number.isFinite(Date.parse(config.createdAt as string))) {
    throw new CaptureHelperSimulatorConfigError("createdAt must be an ISO-compatible timestamp.");
  }

  if (!Array.isArray(config.calibrationSnapshotIds) || config.calibrationSnapshotIds.length === 0) {
    throw new CaptureHelperSimulatorConfigError("calibrationSnapshotIds must include at least one calibration id.");
  }
  config.calibrationSnapshotIds.forEach((id, index) => {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new CaptureHelperSimulatorConfigError(`calibrationSnapshotIds[${index}] must be a non-empty string.`);
    }
  });

  if (
    !Array.isArray(config.standardSurfaceSuspectRegionIds) ||
    config.standardSurfaceSuspectRegionIds.length === 0 ||
    config.standardSurfaceSuspectRegionIds.length > 3
  ) {
    throw new CaptureHelperSimulatorConfigError("standardSurfaceSuspectRegionIds must include 1 to 3 region ids.");
  }
  config.standardSurfaceSuspectRegionIds.forEach((id, index) => {
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new CaptureHelperSimulatorConfigError(`standardSurfaceSuspectRegionIds[${index}] must be a non-empty string.`);
    }
  });
}

export function createCaptureHelperSimulator(
  input: CaptureHelperSimulatorConfigInput = {}
): CaptureHelperSimulator {
  const config = buildCaptureHelperSimulatorConfig(input);
  return {
    config,
    generateDeviceCapabilityManifests: () => generateDeviceCapabilityManifests(config),
    generateQuickCaptureManifest: () => generateQuickCaptureManifest(config),
    generateStandardCaptureManifest: () => generateStandardCaptureManifest(config),
    generateStandardCaptureSimulation: () => generateStandardCaptureSimulation(config),
    generateAuthOnlyCaptureManifest: () => generateAuthOnlyCaptureManifest(config),
  };
}

export function generateDeviceCapabilityManifests(
  input: CaptureHelperSimulatorConfigInput = {}
): DeviceCapabilityManifest[] {
  const config = buildCaptureHelperSimulatorConfig(input);
  const manifests = DEVICE_DEFINITIONS.map((definition) => {
    const manifestWithoutChecksum = {
      id: simulatorId(config, "device-capability", definition.idSuffix),
      rigId: config.rigId,
      helperInstanceId: config.helperInstanceId,
      driverName: definition.driverName,
      driverVersion: definition.driverVersion,
      deviceType: definition.deviceType,
      componentSerial: serialFor(config, definition.componentSerial),
      supportedCapturePackages: definition.supportedCapturePackages,
      coordinateUnits: definition.coordinateUnits,
      timingCharacteristics: definition.timingCharacteristics,
      healthChecks: definition.healthChecks,
      requiredCalibrationTypes: definition.requiredCalibrationTypes,
      observedAt: config.createdAt,
    };
    const manifest: DeviceCapabilityManifest = {
      ...manifestWithoutChecksum,
      checksum: deterministicSha256Hex(manifestWithoutChecksum),
    };
    assertValid("DeviceCapabilityManifest", validateDeviceCapabilityManifest(manifest));
    return manifest;
  });

  return manifests;
}

export function generateQuickCaptureManifest(
  input: CaptureHelperSimulatorConfigInput = {}
): CaptureManifest {
  const config = buildCaptureHelperSimulatorConfig(input);
  const manifest = buildCaptureManifest(config, "quick", [
    macroFrame(config, "FRONT_DIFFUSE", "FRONT", 1),
    macroFrame(config, "BACK_DIFFUSE", "BACK", 2),
    macroFrame(config, "COLOR_CHECKER_FRONT", "FRONT", 3),
    macroFrame(config, "COLOR_CHECKER_BACK", "BACK", 4),
  ]);
  assertValid("QUICK CaptureManifest", validateCaptureManifestForMode(manifest, "QUICK"));
  return manifest;
}

export function generateStandardCaptureManifest(
  input: CaptureHelperSimulatorConfigInput = {}
): CaptureManifest {
  return generateStandardCaptureSimulation(input).captureManifest;
}

export function generateStandardCaptureSimulation(
  input: CaptureHelperSimulatorConfigInput = {}
): StandardCaptureSimulation {
  const config = buildCaptureHelperSimulatorConfig(input);
  const microSpotPackages = buildStandardMicroSpotPackages(config);
  const microSpotFrames = microSpotPackages.map((microPackage) => microPackageManifestFrame(config, microPackage));
  const captureManifest = buildCaptureManifest(config, "standard", [
    macroFrame(config, "FRONT_DIFFUSE", "FRONT", 1),
    macroFrame(config, "BACK_DIFFUSE", "BACK", 2),
    macroFrame(config, "FRONT_DARKFIELD", "FRONT", 3),
    macroFrame(config, "BACK_DARKFIELD", "BACK", 4),
    ...microSpotFrames,
  ]);
  const normalizedPackages = microSpotPackages.map((microPackage) => ({
    ...microPackage,
    captureManifestId: captureManifest.id,
  }));

  assertValid("STANDARD CaptureManifest", validateCaptureManifestForMode(captureManifest, "STANDARD", { side: "FRONT" }));
  normalizedPackages.forEach((microPackage) => {
    assertValid("MicroSpotCapturePackage", validateMicroSpotCapturePackage(microPackage));
  });

  return {
    captureManifest,
    microSpotPackages: normalizedPackages,
    evidenceArtifacts: normalizedPackages.flatMap((microPackage) => Object.values(microPackage.frames)),
  };
}

export function generateAuthOnlyCaptureManifest(
  input: CaptureHelperSimulatorConfigInput = {}
): CaptureManifest {
  const config = buildCaptureHelperSimulatorConfig(input);
  const authPatchFrames = Array.from({ length: 5 }, (_, index) =>
    frame(config, {
      manifestKind: "auth-only",
      kind: "MICRO_AUTH_PATCH",
      side: "FRONT",
      ordinal: index + 1,
      storageLabel: `auth-patch-${index + 1}`,
      widthPx: 2448,
      heightPx: 2048,
      stageXMicrons: 14000 + index * 700,
      stageYMicrons: 22000 + index * 500,
      microMagnification: 220,
      focusScore: 0.95 - index * 0.01,
    })
  );
  const manifest = buildCaptureManifest(config, "auth-only", [
    macroFrame(config, "FRONT_DIFFUSE", "FRONT", 1),
    ...authPatchFrames,
  ]);
  assertValid("AUTH_ONLY CaptureManifest", validateCaptureManifestForMode(manifest, "AUTH_ONLY", { side: "FRONT" }));
  return manifest;
}

function buildStandardMicroSpotPackages(config: CaptureHelperSimulatorConfig): MicroSpotCapturePackage[] {
  return [
    ...Array.from({ length: 4 }, (_, index) =>
      microSpotPackage(config, "CORNERS", index + 1, 4, 5000 + index * 800, 6000 + index * 650)
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      microSpotPackage(config, "EDGES", index + 1, 4, 10000 + index * 900, 8000 + index * 600)
    ),
    ...config.standardSurfaceSuspectRegionIds.map((regionId, index) =>
      microSpotPackage(config, "SURFACE", index + 1, config.standardSurfaceSuspectRegionIds.length, 16000 + index * 900, 12000 + index * 750, regionId)
    ),
  ];
}

function microSpotPackage(
  config: CaptureHelperSimulatorConfig,
  element: MicroSpotElement,
  spotIndex: number,
  totalSpots: number,
  stageXMicrons: number,
  stageYMicrons: number,
  sourceSuspectRegionId?: string
): MicroSpotCapturePackage {
  const id = buildMicroSpotPackageId({
    sessionId: config.captureSessionId,
    side: "FRONT",
    element,
    spotIndex,
    sourceSuspectRegionId,
  });

  const base = {
    id,
    sessionId: config.captureSessionId,
    captureManifestId: pendingStandardManifestId(config),
    side: "FRONT" as CaptureSide,
    element,
    spotIndex,
    totalSpots,
    ...(sourceSuspectRegionId ? { sourceSuspectRegionId } : {}),
    stageXMicrons,
    stageYMicrons,
    microMagnification: 220,
    amrReading: 0.82 + spotIndex * 0.01,
    focusScore: 0.91 + spotIndex * 0.005,
    capturedAt: timestampOffset(config, 120 + spotIndex),
    validForClassification: true,
  };

  return {
    ...base,
    frames: MICRO_FRAME_DEFINITIONS.reduce((frames, definition, frameIndex) => {
      frames[definition.key] = evidenceArtifact(config, {
        manifestKind: "standard",
        packageId: id,
        label: definition.label,
        ordinal: frameIndex + 1,
        widthPx: 2448,
        heightPx: 2048,
      });
      return frames;
    }, {} as MicroSpotCapturePackage["frames"]),
  };
}

function buildCaptureManifest(
  config: CaptureHelperSimulatorConfig,
  manifestKind: "quick" | "standard" | "auth-only",
  frameList: CaptureManifestFrame[]
): CaptureManifest {
  const manifestWithoutChecksum = {
    id: manifestKind === "standard" ? pendingStandardManifestId(config) : simulatorId(config, "capture-manifest", manifestKind),
    captureSessionId: config.captureSessionId,
    tenantId: config.tenantId,
    rigId: config.rigId,
    locationId: config.locationId,
    operatorId: config.operatorId,
    helperInstanceId: config.helperInstanceId,
    helperVersion: config.helperVersion,
    driverVersions: Object.fromEntries(DEVICE_DEFINITIONS.map((definition) => [definition.componentSerialKey, definition.driverVersion])),
    componentSerials: Object.fromEntries(DEVICE_DEFINITIONS.map((definition) => [definition.componentSerialKey, serialFor(config, definition.componentSerial)])),
    calibrationSnapshotIds: config.calibrationSnapshotIds,
    frameList,
    operatorPrompts: [
      {
        prompt: "SIMULATOR_ONLY_CONFIRM_NO_REAL_HARDWARE",
        shownAt: timestampOffset(config, 1),
        confirmedAt: timestampOffset(config, 2),
      },
    ],
    deviceHealth: DEVICE_DEFINITIONS.map((definition) => ({
      check: definition.healthChecks[0]?.name ?? `${definition.idSuffix}-health`,
      status: "PASS" as const,
      detail: "simulated local-only health result",
    })),
    createdAt: config.createdAt,
  };

  return {
    ...manifestWithoutChecksum,
    checksumSha256: deterministicSha256Hex(manifestWithoutChecksum),
  };
}

function macroFrame(
  config: CaptureHelperSimulatorConfig,
  kind: GradingCaptureKind,
  side: CaptureSide,
  ordinal: number
): CaptureManifestFrame {
  return frame(config, {
    manifestKind: "macro",
    kind,
    side,
    ordinal,
    storageLabel: `${side.toLowerCase()}-${kind.toLowerCase()}`,
    widthPx: 4096,
    heightPx: 4096,
    exposureUs: 11000 + ordinal * 100,
  });
}

function microPackageManifestFrame(
  config: CaptureHelperSimulatorConfig,
  microPackage: MicroSpotCapturePackage
): CaptureManifestFrame {
  const kindByElement: Record<MicroSpotElement, GradingCaptureKind> = {
    CORNERS: "MICRO_CORNER_SPOT",
    EDGES: "MICRO_EDGE_SPOT",
    SURFACE: "MICRO_SURFACE_SPOT",
    CMYK_AUTHENTICATION: "MICRO_AUTH_PATCH",
  };
  return frame(config, {
    manifestKind: "standard",
    kind: kindByElement[microPackage.element],
    side: microPackage.side,
    ordinal: microPackage.spotIndex,
    storageLabel: `${microPackage.id}/manifest-frame`,
    widthPx: 2448,
    heightPx: 2048,
    stageXMicrons: microPackage.stageXMicrons,
    stageYMicrons: microPackage.stageYMicrons,
    microMagnification: microPackage.microMagnification,
    focusScore: microPackage.focusScore,
    sourceSuspectRegionId: microPackage.sourceSuspectRegionId,
  });
}

function frame(
  config: CaptureHelperSimulatorConfig,
  input: {
    manifestKind: string;
    kind: GradingCaptureKind;
    side: CaptureSide;
    ordinal: number;
    storageLabel: string;
    widthPx: number;
    heightPx: number;
    exposureUs?: number;
    stageXMicrons?: number;
    stageYMicrons?: number;
    microMagnification?: number;
    focusScore?: number;
    sourceSuspectRegionId?: string;
  }
): CaptureManifestFrame {
  const checksumInput = [
    config.seed,
    config.captureSessionId,
    input.manifestKind,
    input.kind,
    input.side,
    input.ordinal,
    input.storageLabel,
  ].join("|");

  return {
    frameId: simulatorId(config, "frame", input.manifestKind, input.kind, input.side, String(input.ordinal), input.storageLabel),
    kind: input.kind,
    side: input.side,
    storageKey: storageKey(config, input.manifestKind, input.storageLabel, "jpg"),
    checksumSha256: deterministicSha256Hex(checksumInput),
    capturedAt: timestampOffset(config, input.ordinal + 10),
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    ...(input.exposureUs != null ? { exposureUs: input.exposureUs } : {}),
    ...(input.stageXMicrons != null ? { stageXMicrons: input.stageXMicrons } : {}),
    ...(input.stageYMicrons != null ? { stageYMicrons: input.stageYMicrons } : {}),
    ...(input.microMagnification != null ? { microMagnification: input.microMagnification } : {}),
    ...(input.focusScore != null ? { focusScore: input.focusScore } : {}),
    ...(input.sourceSuspectRegionId ? { sourceSuspectRegionId: input.sourceSuspectRegionId } : {}),
  };
}

function evidenceArtifact(
  config: CaptureHelperSimulatorConfig,
  input: {
    manifestKind: string;
    packageId: string;
    label: string;
    ordinal: number;
    widthPx: number;
    heightPx: number;
  }
): EvidenceArtifactRef {
  const storage = storageKey(config, input.manifestKind, `${input.packageId}/${input.label}`, "tiff");
  return {
    id: simulatorId(config, "evidence", input.packageId, input.label),
    storageKey: storage,
    checksumSha256: deterministicSha256Hex([config.seed, config.captureSessionId, input.packageId, input.label, storage].join("|")),
    mimeType: "image/tiff",
    byteSize: 512000 + input.ordinal * 4096,
    widthPx: input.widthPx,
    heightPx: input.heightPx,
  };
}

function assertValid(label: string, result: { valid: boolean; issues: Array<{ path: string; message: string }> }) {
  if (!result.valid) {
    const detail = result.issues.map((entry) => `${entry.path}: ${entry.message}`).join("; ");
    throw new Error(`${label} failed shared validation: ${detail}`);
  }
}

function pendingStandardManifestId(config: CaptureHelperSimulatorConfig): string {
  return simulatorId(config, "capture-manifest", "standard");
}

function simulatorId(config: CaptureHelperSimulatorConfig, ...parts: string[]): string {
  const slug = parts.map(slugPart).join(":");
  return `sim:${config.captureSessionId}:${slug}`;
}

function storageKey(
  config: CaptureHelperSimulatorConfig,
  manifestKind: string,
  label: string,
  extension: string
): string {
  return [
    trimSlashes(config.storagePrefix),
    config.tenantId,
    config.captureSessionId,
    config.seed,
    manifestKind,
    `${label.split("/").map(slugPart).join("/")}.${extension}`,
  ].join("/");
}

function timestampOffset(config: CaptureHelperSimulatorConfig, seconds: number): string {
  return new Date(Date.parse(config.createdAt) + seconds * 1000).toISOString();
}

function serialFor(config: CaptureHelperSimulatorConfig, serial: string): string {
  return `${serial}-${slugPart(config.seed).slice(0, 12)}`;
}

function slugPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "sim";
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function deterministicSha256Hex(value: unknown): string {
  const text = typeof value === "string" ? value : stableStringify(value);
  return sha256Hex(text);
}

function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const words: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >> 2] = (words[index >> 2] ?? 0) | (bytes[index] << (24 - (index % 4) * 8));
  }
  words[bytes.length >> 2] = (words[bytes.length >> 2] ?? 0) | (0x80 << (24 - (bytes.length % 4) * 8));

  const bitLength = bytes.length * 8;
  const lengthIndex = (((bytes.length + 8) >> 6) << 4) + 15;
  words[lengthIndex - 1] = Math.floor(bitLength / 0x100000000);
  words[lengthIndex] = bitLength;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  for (let offset = 0; offset < words.length; offset += 16) {
    const w = new Array<number>(64);
    for (let index = 0; index < 16; index += 1) {
      w[index] = words[offset + index] ?? 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(w[index - 15], 7) ^ rightRotate(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rightRotate(w[index - 2], 17) ^ rightRotate(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = add32(w[index - 16], s0, w[index - 7], s1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = add32(h, s1, ch, SHA256_K[index], w[index]);
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = add32(s0, maj);

      h = g;
      g = f;
      f = e;
      e = add32(d, temp1);
      d = c;
      c = b;
      b = a;
      a = add32(temp1, temp2);
    }

    h0 = add32(h0, a);
    h1 = add32(h1, b);
    h2 = add32(h2, c);
    h3 = add32(h3, d);
    h4 = add32(h4, e);
    h5 = add32(h5, f);
    h6 = add32(h6, g);
    h7 = add32(h7, h);
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, "0")).join("");
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function add32(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0);
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
