// This exact version is shared by browser-safe map diagnostics and server-only
// learning calibration. Keep it in a dependency-free module so UI code never
// pulls Node crypto into the client bundle.
export const SPEEDSTER_LEARNING_COMPATIBLE_DETECTOR_VERSION =
  "sam3-local-box-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543" as const;
