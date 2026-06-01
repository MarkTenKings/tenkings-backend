import type { CaptureHelperDeviceRole, CaptureHelperDriverSet } from "./index";

export const CAPTURE_HELPER_DISCOVERY_KINDS = [
  "macroCamera",
  "ledController",
  "microscope",
  "stage",
  "armInterlock",
] as const;

export type CaptureHelperDiscoveryKind = (typeof CAPTURE_HELPER_DISCOVERY_KINDS)[number];
export type CaptureHelperDiscoveryStatus = "NOT_PROBED" | "NOT_IMPLEMENTED";

export interface CaptureHelperDiscoveryResult {
  kind: CaptureHelperDiscoveryKind;
  role: CaptureHelperDeviceRole;
  driverSet: CaptureHelperDriverSet;
  status: CaptureHelperDiscoveryStatus;
  devices: unknown[];
  message: string;
}

function discoveryMessage(kind: CaptureHelperDiscoveryKind, driverSet: CaptureHelperDriverSet) {
  if (driverSet === "real") {
    return `${kind} discovery is not implemented; real hardware probing is disabled in readiness-only mode.`;
  }
  return `${kind} discovery was not probed; mock drivers provide deterministic simulator metadata only.`;
}

export function discoverMacroCameras(driverSet: CaptureHelperDriverSet = "mock"): CaptureHelperDiscoveryResult {
  return {
    kind: "macroCamera",
    role: "macroCamera",
    driverSet,
    status: driverSet === "real" ? "NOT_IMPLEMENTED" : "NOT_PROBED",
    devices: [],
    message: discoveryMessage("macroCamera", driverSet),
  };
}

export function discoverLedControllers(driverSet: CaptureHelperDriverSet = "mock"): CaptureHelperDiscoveryResult {
  return {
    kind: "ledController",
    role: "ledController",
    driverSet,
    status: driverSet === "real" ? "NOT_IMPLEMENTED" : "NOT_PROBED",
    devices: [],
    message: discoveryMessage("ledController", driverSet),
  };
}

export function discoverMicroscopes(driverSet: CaptureHelperDriverSet = "mock"): CaptureHelperDiscoveryResult {
  return {
    kind: "microscope",
    role: "microscope",
    driverSet,
    status: driverSet === "real" ? "NOT_IMPLEMENTED" : "NOT_PROBED",
    devices: [],
    message: discoveryMessage("microscope", driverSet),
  };
}

export function discoverGrblStages(driverSet: CaptureHelperDriverSet = "mock"): CaptureHelperDiscoveryResult {
  return {
    kind: "stage",
    role: "stage",
    driverSet,
    status: driverSet === "real" ? "NOT_IMPLEMENTED" : "NOT_PROBED",
    devices: [],
    message: discoveryMessage("stage", driverSet),
  };
}

export function discoverArmInterlocks(driverSet: CaptureHelperDriverSet = "mock"): CaptureHelperDiscoveryResult {
  return {
    kind: "armInterlock",
    role: "armInterlock",
    driverSet,
    status: driverSet === "real" ? "NOT_IMPLEMENTED" : "NOT_PROBED",
    devices: [],
    message: discoveryMessage("armInterlock", driverSet),
  };
}

export function runCaptureHelperDiscoveryStubs(driverSet: CaptureHelperDriverSet = "mock"): CaptureHelperDiscoveryResult[] {
  return [
    discoverMacroCameras(driverSet),
    discoverLedControllers(driverSet),
    discoverMicroscopes(driverSet),
    discoverGrblStages(driverSet),
    discoverArmInterlocks(driverSet),
  ];
}
