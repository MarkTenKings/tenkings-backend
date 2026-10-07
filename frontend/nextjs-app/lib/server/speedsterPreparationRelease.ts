import type { SpeedsterPreparationIdentity } from "../ai-grader-v2/preparation";
import { HttpError } from "./adminSessionAuthority";

// Exact CPU release reviewed against main CI 34458856659 / attempt 1,
// signed OCI/SPDX/provenance and the live HTTPS preparation contract on 2026-09-10.
// Environment/tag claims cannot activate another release. Detector admission
// remains independent of this CPU-only preparation identity.
const approvedPreparationRelease: SpeedsterPreparationIdentity | null = {
  version: "speedster-preparation-identity-v1",
  sourceCommitSha: "6b75c9399b83f55cca55045b560c205cbe91920b",
  sourceTreeSha: "20536283d5d17819c403824008b1379eadac6350",
  ociDigest: "sha256:5a4f32f12b55a3fd9dce9d768eac11b5e4fa9ede6cbdd89f53df513166a66b90",
  buildId: "34458856659-1",
  pythonVersion: "3.12.14",
  opencvVersion: "4.10.0",
  numpyVersion: "1.26.4",
  decoder: "original-single-frame-exif-oriented-raster-v1",
  rectification: "opencv-float32-source-width-height-card-1270x1778-context-40-v1",
  reveals: "lab-clahe-2-8-morph-9-sobel-v1",
  encoding: "opencv-webp-quality-92-v1",
};

export function currentSpeedsterPreparationRelease(): SpeedsterPreparationIdentity {
  if (!approvedPreparationRelease) {
    throw new HttpError(503, "Verified image preparation is waiting for its compatible release. Your photos and saved draft remain available.");
  }
  return structuredClone(approvedPreparationRelease);
}
