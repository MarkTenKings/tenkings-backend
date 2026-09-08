import { parseSpeedsterDetectorIdentityV1 } from "./speedsterDetectionSideCheckpoint";

// Server admission policy for the owner-approved Release 26 candidate. This is
// deliberately independent of worker-reported policy versions and environment
// switches. Updating it requires review of the new signed image and its source.
// Provenance: .github/workflows/ci.yml, run 32511140945 / attempt 1, main.
// The attestation and digest-addressed OCI config were verified on 2026-09-07.
// This checks reported identity; it is not proof of an actual GPU execution.
const expectedIdentity = {
  version: "speedster-detector-identity-v1",
  detectorVersion: "sam3-local-box-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543",
  source: {
    repository: "https://github.com/MarkTenKings/tenkings-backend",
    commitSha: "7bde06f65959e376e12725186d605cc91c67852b",
    treeSha: "2a323e3889c94ad638b62a81166275f3a098efd9",
  },
  runtime: {
    ociDigest: "sha256:9339614adc8183a87d0df4051c09fc88350f76fe477925d231f718edf393cfd3",
    ociDigestProvenance: "DEPLOYMENT_INJECTED",
    ociImageReference: "ghcr.io/marktenkings/tenkings-backend-speedster-v2:7bde06f65959e376e12725186d605cc91c67852b-32511140945-1",
    buildId: "32511140945-1",
    buildIdentityProvenance: "OCI_IMAGE_ENV",
    platform: "linux/x86_64",
    pythonVersion: "3.12.14",
    frameworkVersion: "sam3@96914d2425f90a64f45ca977c2b5165418099543",
    torchVersion: "2.7.1+cu126",
    cudaVersion: "12.6",
    cudnnVersion: "90501",
    accelerator: "NVIDIA GeForce RTX 4090",
    gpuName: "NVIDIA GeForce RTX 4090",
    gpuCapability: "8.9",
    gpuCount: 1,
    gpuPolicy: {
      policyVersion: "speedster-rtx4090-only-v1",
      required: { gpuName: "NVIDIA GeForce RTX 4090", gpuCapability: "8.9", gpuCount: 1 },
      observed: { gpuName: "NVIDIA GeForce RTX 4090", gpuCapability: "8.9", gpuCount: 1, currentDevice: 0 },
      validation: "OBSERVED_CUDA_RUNTIME_BEFORE_MODEL_LOAD",
    },
    compiler: {
      contractVersion: "speedster-host-compiler-v1",
      ccPath: "/usr/bin/gcc-14",
      packageName: "gcc-14",
      packageVersion: "14.2.0-19",
      libcDevPackageName: "libc6-dev",
      libcDevPackageVersion: "2.41-12+deb13u3",
      version: "14.2.0",
      target: "x86_64-linux-gnu",
      validation: "IMMUTABLE_IMAGE_STARTUP_AND_PRE_TORCH",
    },
  },
  model: {
    name: "sam3-speedster",
    repository: "facebook/sam3",
    revision: "3c879f39826c281e95690f02c7821c4de09afae7",
    checkpointSha256: "9999e2341ceef5e136daa386eecb55cb414446a00ac2b55eb2dfd2f7c3cf8c9e",
    sourceCommitSha: "96914d2425f90a64f45ca977c2b5165418099543",
  },
  policy: {
    detectorVersion: "sam3-local-box-inspection-2mm@96914d2425f90a64f45ca977c2b5165418099543",
    promptVersion: "sam3-box-and-smart-mark-point-v1",
    fusionVersion: "speedster-side-wide-memory-cap-v2",
    measurementVersion: "speedster-exact-canonical-mask-v1",
    memoryVersion: "sam-memory-v2-lesson-verdict-v1",
  },
  determinism: {
    deterministicAlgorithms: true,
    cudnnDeterministic: true,
    cudnnBenchmark: false,
    allowTf32: false,
    evalMode: true,
    compile: false,
    autocastDtype: "bfloat16",
    cublasWorkspaceConfig: ":4096:8",
  },
} as const;

function assertExpectedIdentity(observed: unknown, expected: unknown, path: string): void {
  if (expected !== null && typeof expected === "object") {
    if (observed === null || typeof observed !== "object" || Array.isArray(observed)) {
      throw new Error(`Speedster current release identity is missing ${path}.`);
    }
    for (const [key, value] of Object.entries(expected)) {
      assertExpectedIdentity((observed as Record<string, unknown>)[key], value, `${path}.${key}`);
    }
  } else if (observed !== expected) {
    throw new Error(`Speedster current release identity does not admit ${path}.`);
  }
}

export function admitCurrentSpeedsterDetectorIdentity(value: unknown) {
  // Keep the historical shape parser permissive for old, read-only evidence.
  const identity = parseSpeedsterDetectorIdentityV1(value);
  assertExpectedIdentity(identity, expectedIdentity, "detectorIdentity");
  const compiler = (identity.runtime as unknown as Record<string, unknown>).compiler as Record<string, unknown>;
  // The observed compiler hash must be present, but no GPU-host compiler hash
  // has been independently observed for this release. Do not invent that value.
  if (typeof compiler.ccSha256 !== "string" || !/^[a-f0-9]{64}$/.test(compiler.ccSha256)) {
    throw new Error("Speedster current release identity lacks its observed compiler hash.");
  }
  return identity;
}
