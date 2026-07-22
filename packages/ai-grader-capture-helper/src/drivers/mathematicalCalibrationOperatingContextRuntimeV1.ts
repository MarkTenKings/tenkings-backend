import { createHash } from "node:crypto";
import {
  aiGraderOperatingContextV1Schema,
  canonicalAiGraderCalibrationJsonV1,
  type AiGraderOperatingContextV1,
} from "@tenkings/shared";

export const MATHEMATICAL_CALIBRATION_RIG_INVENTORY_V1 =
  "ten-kings-mathematical-calibration-rig-inventory-v1" as const;
export const MATHEMATICAL_CALIBRATION_RUNTIME_OBSERVATION_V1 =
  "ten-kings-mathematical-calibration-runtime-observation-v1" as const;
export const MATHEMATICAL_CALIBRATION_RUNTIME_OBSERVATION_SOURCE_V1 =
  "opened-basler-pylon-and-leimac-acknowledgement-v1" as const;

const SHA256 = /^[a-f0-9]{64}$/;

export interface MathematicalCalibrationRigInventoryV1 {
  schemaVersion: typeof MATHEMATICAL_CALIBRATION_RIG_INVENTORY_V1;
  rig: AiGraderOperatingContextV1["rig"];
  camera: AiGraderOperatingContextV1["camera"];
  optics: AiGraderOperatingContextV1["optics"];
  controller: AiGraderOperatingContextV1["controller"] & {
    controllerTransportIdentity: string;
  };
  lighting: Pick<AiGraderOperatingContextV1["lighting"], "configurationIdentity">;
  capture: Pick<AiGraderOperatingContextV1["capture"], "pixelFormat" | "widthPx" | "heightPx">;
  software: Pick<AiGraderOperatingContextV1["software"], "helperInstanceId" | "helperVersion">;
}

export interface MathematicalCalibrationRuntimeObservationV1 {
  schemaVersion: typeof MATHEMATICAL_CALIBRATION_RUNTIME_OBSERVATION_V1;
  source: typeof MATHEMATICAL_CALIBRATION_RUNTIME_OBSERVATION_SOURCE_V1;
  camera: AiGraderOperatingContextV1["camera"];
  capture: AiGraderOperatingContextV1["capture"];
  controller: {
    controllerTransportIdentity: string;
    selectedChannels: number[];
    dutyPercent: number;
    expectedWriteCount: number;
    acknowledgedWriteCount: number;
    allWritesAcknowledged: true;
  };
  software: Pick<AiGraderOperatingContextV1["software"], "helperInstanceId" | "helperVersion">;
}

export type MathematicalCalibrationOperatingContextRuntimeV1Options = {
  protectedInventoryBytes: Uint8Array;
  protectedInventorySha256: string;
  helperInstanceId: string;
  helperVersion: string;
  observeRuntime(
    expected: AiGraderOperatingContextV1,
  ): MathematicalCalibrationRuntimeObservationV1 | Promise<MathematicalCalibrationRuntimeObservationV1>;
};

export class MathematicalCalibrationOperatingContextRuntimeV1Error extends Error {
  readonly code = "AI_GRADER_LOCAL_CALIBRATION_RUNTIME_CONTEXT_UNTRUSTED";

  constructor(message: string) {
    super(message);
    this.name = "MathematicalCalibrationOperatingContextRuntimeV1Error";
  }
}

function fail(message: string): never {
  throw new MathematicalCalibrationOperatingContextRuntimeV1Error(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${label} must be one exact JSON object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} fields do not match the protected V1 contract.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 256) {
    return fail(`${label} must be canonical non-empty text.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    return fail(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function nonnegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fail(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function orderedChannels(value: unknown, label: string): number[] {
  if (!Array.isArray(value) ||
      JSON.stringify(value) !== JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8])) {
    return fail(`${label} must contain ordered channels 1 through 8.`);
  }
  return [...value];
}

function exactMatch(actual: unknown, expected: unknown, label: string) {
  if (canonicalAiGraderCalibrationJsonV1(actual) !== canonicalAiGraderCalibrationJsonV1(expected)) {
    fail(`${label} does not match the exact protected inventory and hosted context.`);
  }
}

function parseRig(value: unknown): MathematicalCalibrationRigInventoryV1["rig"] {
  const result = record(value, "inventory.rig");
  exactKeys(result, ["tenantId", "rigId", "rigVersion", "locationId", "locationIdentity"], "inventory.rig");
  return {
    tenantId: text(result.tenantId, "inventory.rig.tenantId"),
    rigId: text(result.rigId, "inventory.rig.rigId"),
    rigVersion: text(result.rigVersion, "inventory.rig.rigVersion"),
    locationId: text(result.locationId, "inventory.rig.locationId"),
    locationIdentity: text(result.locationIdentity, "inventory.rig.locationIdentity"),
  };
}

function parseCamera(value: unknown, label: string): AiGraderOperatingContextV1["camera"] {
  const result = record(value, label);
  exactKeys(result, ["serial", "model"], label);
  return { serial: text(result.serial, `${label}.serial`), model: text(result.model, `${label}.model`) };
}

function parseOptics(value: unknown): MathematicalCalibrationRigInventoryV1["optics"] {
  const result = record(value, "inventory.optics");
  exactKeys(result, ["lensIdentity", "mountIdentity"], "inventory.optics");
  return {
    lensIdentity: text(result.lensIdentity, "inventory.optics.lensIdentity"),
    mountIdentity: text(result.mountIdentity, "inventory.optics.mountIdentity"),
  };
}

function parseController(value: unknown): MathematicalCalibrationRigInventoryV1["controller"] {
  const result = record(value, "inventory.controller");
  exactKeys(result, [
    "controllerIdentity",
    "controllerTransportIdentity",
    "channelWiringMapIdentity",
    "channelMap",
  ], "inventory.controller");
  if (!Array.isArray(result.channelMap) || result.channelMap.length !== 8) {
    return fail("inventory.controller.channelMap must contain eight exact entries.");
  }
  const channelMap = result.channelMap.map((entry, index) => {
    const row = record(entry, `inventory.controller.channelMap[${index}]`);
    exactKeys(row, ["channelIndex", "controllerOutput", "lightingRole"], `inventory.controller.channelMap[${index}]`);
    if (row.channelIndex !== index + 1) {
      fail("inventory.controller.channelMap must be ordered channels 1 through 8.");
    }
    return {
      channelIndex: index + 1,
      controllerOutput: text(row.controllerOutput, `inventory.controller.channelMap[${index}].controllerOutput`),
      lightingRole: text(row.lightingRole, `inventory.controller.channelMap[${index}].lightingRole`),
    };
  });
  return {
    controllerIdentity: text(result.controllerIdentity, "inventory.controller.controllerIdentity"),
    controllerTransportIdentity: text(
      result.controllerTransportIdentity,
      "inventory.controller.controllerTransportIdentity",
    ),
    channelWiringMapIdentity: text(
      result.channelWiringMapIdentity,
      "inventory.controller.channelWiringMapIdentity",
    ),
    channelMap,
  };
}

export function parseMathematicalCalibrationRigInventoryV1(
  bytes: Uint8Array,
  expectedSha256: string,
): MathematicalCalibrationRigInventoryV1 {
  if (!SHA256.test(expectedSha256) ||
      createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
    return fail("Protected rig inventory bytes do not match the pinned SHA-256.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return fail("Protected rig inventory must be valid UTF-8 JSON.");
  }
  const value = record(parsed, "inventory");
  exactKeys(value, ["schemaVersion", "rig", "camera", "optics", "controller", "lighting", "capture", "software"], "inventory");
  if (value.schemaVersion !== MATHEMATICAL_CALIBRATION_RIG_INVENTORY_V1) {
    return fail("Protected rig inventory schemaVersion is invalid.");
  }
  const lighting = record(value.lighting, "inventory.lighting");
  exactKeys(lighting, ["configurationIdentity"], "inventory.lighting");
  const capture = record(value.capture, "inventory.capture");
  exactKeys(capture, ["pixelFormat", "widthPx", "heightPx"], "inventory.capture");
  const software = record(value.software, "inventory.software");
  exactKeys(software, ["helperInstanceId", "helperVersion"], "inventory.software");
  return {
    schemaVersion: MATHEMATICAL_CALIBRATION_RIG_INVENTORY_V1,
    rig: parseRig(value.rig),
    camera: parseCamera(value.camera, "inventory.camera"),
    optics: parseOptics(value.optics),
    controller: parseController(value.controller),
    lighting: {
      configurationIdentity: text(
        lighting.configurationIdentity,
        "inventory.lighting.configurationIdentity",
      ),
    },
    capture: {
      pixelFormat: text(capture.pixelFormat, "inventory.capture.pixelFormat"),
      widthPx: positiveInteger(capture.widthPx, "inventory.capture.widthPx"),
      heightPx: positiveInteger(capture.heightPx, "inventory.capture.heightPx"),
    },
    software: {
      helperInstanceId: text(software.helperInstanceId, "inventory.software.helperInstanceId"),
      helperVersion: text(software.helperVersion, "inventory.software.helperVersion"),
    },
  };
}

function parseRuntimeObservation(value: unknown): MathematicalCalibrationRuntimeObservationV1 {
  const observation = record(value, "runtime observation");
  exactKeys(observation, ["schemaVersion", "source", "camera", "capture", "controller", "software"], "runtime observation");
  if (observation.schemaVersion !== MATHEMATICAL_CALIBRATION_RUNTIME_OBSERVATION_V1 ||
      observation.source !== MATHEMATICAL_CALIBRATION_RUNTIME_OBSERVATION_SOURCE_V1) {
    return fail("Runtime observation is not sourced from the trusted opened-device adapter.");
  }
  const capture = record(observation.capture, "runtime observation.capture");
  exactKeys(capture, ["exposureUs", "gain", "pixelFormat", "widthPx", "heightPx"], "runtime observation.capture");
  const controller = record(observation.controller, "runtime observation.controller");
  exactKeys(controller, [
    "controllerTransportIdentity",
    "selectedChannels",
    "dutyPercent",
    "expectedWriteCount",
    "acknowledgedWriteCount",
    "allWritesAcknowledged",
  ], "runtime observation.controller");
  const software = record(observation.software, "runtime observation.software");
  exactKeys(software, ["helperInstanceId", "helperVersion"], "runtime observation.software");
  const expectedWriteCount = positiveInteger(
    controller.expectedWriteCount,
    "runtime observation.controller.expectedWriteCount",
  );
  const acknowledgedWriteCount = positiveInteger(
    controller.acknowledgedWriteCount,
    "runtime observation.controller.acknowledgedWriteCount",
  );
  if (controller.allWritesAcknowledged !== true || expectedWriteCount !== acknowledgedWriteCount) {
    return fail("Leimac runtime observation does not prove complete controller acknowledgement.");
  }
  return {
    schemaVersion: MATHEMATICAL_CALIBRATION_RUNTIME_OBSERVATION_V1,
    source: MATHEMATICAL_CALIBRATION_RUNTIME_OBSERVATION_SOURCE_V1,
    camera: parseCamera(observation.camera, "runtime observation.camera"),
    capture: {
      exposureUs: positiveInteger(capture.exposureUs, "runtime observation.capture.exposureUs"),
      gain: nonnegativeNumber(capture.gain, "runtime observation.capture.gain"),
      pixelFormat: text(capture.pixelFormat, "runtime observation.capture.pixelFormat"),
      widthPx: positiveInteger(capture.widthPx, "runtime observation.capture.widthPx"),
      heightPx: positiveInteger(capture.heightPx, "runtime observation.capture.heightPx"),
    },
    controller: {
      controllerTransportIdentity: text(
        controller.controllerTransportIdentity,
        "runtime observation.controller.controllerTransportIdentity",
      ),
      selectedChannels: orderedChannels(
        controller.selectedChannels,
        "runtime observation.controller.selectedChannels",
      ),
      dutyPercent: nonnegativeNumber(
        controller.dutyPercent,
        "runtime observation.controller.dutyPercent",
      ),
      expectedWriteCount,
      acknowledgedWriteCount,
      allWritesAcknowledged: true,
    },
    software: {
      helperInstanceId: text(
        software.helperInstanceId,
        "runtime observation.software.helperInstanceId",
      ),
      helperVersion: text(software.helperVersion, "runtime observation.software.helperVersion"),
    },
  };
}

export function createMathematicalCalibrationOperatingContextRuntimeV1(
  options: MathematicalCalibrationOperatingContextRuntimeV1Options,
) {
  const inventory = parseMathematicalCalibrationRigInventoryV1(
    options.protectedInventoryBytes,
    options.protectedInventorySha256,
  );
  const helperIdentity = {
    helperInstanceId: text(options.helperInstanceId, "helperInstanceId"),
    helperVersion: text(options.helperVersion, "helperVersion"),
  };
  exactMatch(inventory.software, helperIdentity, "Running helper identity");

  return async function trustedLiveOperatingContext(
    expectedValue: AiGraderOperatingContextV1,
  ): Promise<AiGraderOperatingContextV1> {
    const expected = aiGraderOperatingContextV1Schema.parse(expectedValue);
    exactMatch(expected.rig, inventory.rig, "Rig/location identity");
    exactMatch(expected.camera, inventory.camera, "Camera inventory identity");
    exactMatch(expected.optics, inventory.optics, "Lens/mount identity");
    exactMatch(expected.controller, {
      controllerIdentity: inventory.controller.controllerIdentity,
      channelWiringMapIdentity: inventory.controller.channelWiringMapIdentity,
      channelMap: inventory.controller.channelMap,
    }, "Controller/wiring identity");
    exactMatch(
      { configurationIdentity: expected.lighting.configurationIdentity },
      inventory.lighting,
      "Lighting configuration identity",
    );
    exactMatch(
      {
        pixelFormat: expected.capture.pixelFormat,
        widthPx: expected.capture.widthPx,
        heightPx: expected.capture.heightPx,
      },
      inventory.capture,
      "Camera pixel-format/resolution inventory",
    );
    exactMatch(
      {
        helperInstanceId: expected.software.helperInstanceId,
        helperVersion: expected.software.helperVersion,
      },
      helperIdentity,
      "Hosted helper identity",
    );

    const observed = parseRuntimeObservation(await options.observeRuntime(expected));
    exactMatch(observed.camera, expected.camera, "Opened Basler camera identity");
    exactMatch(observed.capture, expected.capture, "Applied Basler capture settings");
    exactMatch(
      observed.controller.controllerTransportIdentity,
      inventory.controller.controllerTransportIdentity,
      "Opened Leimac controller transport",
    );
    exactMatch(
      observed.controller.selectedChannels,
      expected.lighting.selectedChannels,
      "Acknowledged Leimac channel selection",
    );
    exactMatch(
      observed.controller.dutyPercent,
      expected.lighting.dutyPercent,
      "Acknowledged Leimac duty",
    );
    exactMatch(observed.software, helperIdentity, "Observed helper identity");
    return expected;
  };
}
