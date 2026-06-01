import type {
  CaptureManifestFrame,
  CaptureSide,
  DeviceCapabilityManifest,
  DeviceHealthStatus,
  DeviceType,
  EvidenceArtifactRef,
  GradingCaptureKind,
} from "@tenkings/shared";

export type CaptureHelperDriverSet = "mock" | "real";

export type DriverLifecycleState = "closed" | "open";

export interface DeviceDriverHealth {
  check: string;
  status: DeviceHealthStatus;
  detail?: string;
}

export interface DeviceDriver {
  readonly id: string;
  readonly deviceType: DeviceType;
  readonly driverName: string;
  readonly driverVersion: string;
  readonly componentSerial: string;
  readonly state: DriverLifecycleState;
  open(): void;
  close(): void;
  health_check(): DeviceDriverHealth;
  getCapabilityManifest(): DeviceCapabilityManifest;
}

export interface MacroFrameRequest {
  kind: GradingCaptureKind;
  side: CaptureSide;
  ordinal: number;
  storageLabel?: string;
  exposureUs?: number;
  widthPx?: number;
  heightPx?: number;
}

export interface MicroFrameRequest {
  packageId: string;
  label: string;
  ordinal: number;
  widthPx?: number;
  heightPx?: number;
}

export interface LedIlluminationRequest {
  ledMask: number;
  intensityPct?: number;
  exposureUs?: number;
}

export interface StagePosition {
  xMicrons: number;
  yMicrons: number;
}

export interface ArmInterlockState {
  armInPosition: boolean;
  safeForMacro: boolean;
  safeForMicro: boolean;
  detail: string;
}

export interface MacroCameraDriver extends DeviceDriver {
  readonly deviceType: "MACRO_CAMERA";
  captureFrame(request: MacroFrameRequest): CaptureManifestFrame;
}

export interface LEDControllerDriver extends DeviceDriver {
  readonly deviceType: "LED_CONTROLLER";
  setIllumination(request: LedIlluminationRequest): LedIlluminationRequest & { appliedAt: string };
  clearIllumination(): { ledMask: 0; appliedAt: string };
}

export interface MicroscopeDriver extends DeviceDriver {
  readonly deviceType: "MICROSCOPE";
  captureEvidence(request: MicroFrameRequest): EvidenceArtifactRef;
}

export interface StageDriver extends DeviceDriver {
  readonly deviceType: "XY_STAGE";
  home(): StagePosition;
  moveTo(position: StagePosition): StagePosition;
  getPosition(): StagePosition;
}

export interface ArmInterlockDriver extends DeviceDriver {
  readonly deviceType: "ARM_INTERLOCK";
  readState(): ArmInterlockState;
}

export interface CaptureHelperDriverSetDrivers {
  macroCamera: MacroCameraDriver;
  ledController: LEDControllerDriver;
  microscope: MicroscopeDriver;
  stage: StageDriver;
  armInterlock: ArmInterlockDriver;
}
