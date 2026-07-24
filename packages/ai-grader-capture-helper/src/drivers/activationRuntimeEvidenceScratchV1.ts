import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export const ACTIVATION_RUNTIME_EVIDENCE_FILE_NAME_V1 =
  "activation-runtime-evidence.png" as const;
export const ACTIVATION_RUNTIME_PYLON_CAPTURE_LABEL_V1 =
  "activation-runtime" as const;
export const ACTIVATION_RUNTIME_PYLON_OUTPUT_DIR_MAX_LENGTH_V1 = 180;
export const ACTIVATION_RUNTIME_FAILED_SCRATCH_DIRECTORY_V1 =
  "pylon-scratch-v1" as const;

type ActivationRuntimeCaptureFileV1 = {
  outputFilePath: string;
  sha256: string;
  byteSize: number;
};

type ActivationRuntimePylonCaptureInputV1 = {
  outputDir: string;
  label: typeof ACTIVATION_RUNTIME_PYLON_CAPTURE_LABEL_V1;
};

export type ActivationRuntimeEvidenceScratchV1 = {
  readonly pylonOutputDirectory: string;
  readonly pylonCaptureLabel: typeof ACTIVATION_RUNTIME_PYLON_CAPTURE_LABEL_V1;
  readonly targetEvidencePath: string;
  capture<T extends ActivationRuntimeCaptureFileV1>(
    runCapture: (input: ActivationRuntimePylonCaptureInputV1) => Promise<T>,
  ): Promise<T>;
  retainFailure(): Promise<void>;
};

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

async function exists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function removeEmptyDirectory(directory: string) {
  try {
    await rmdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" &&
        (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
      throw error;
    }
  }
}

function assertDirectScratchFile(filePath: string, scratchDirectory: string) {
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== scratchDirectory || path.basename(resolved) !== path.basename(filePath)) {
    throw new Error("Activation runtime capture returned a file outside its bounded scratch directory.");
  }
  return resolved;
}

export async function prepareActivationRuntimeEvidenceScratchV1(input: {
  helperOutputRoot: string;
  evidenceDirectory: string;
  attemptToken?: string;
}): Promise<ActivationRuntimeEvidenceScratchV1> {
  const helperOutputRoot = path.resolve(input.helperOutputRoot);
  const evidenceDirectory = path.resolve(input.evidenceDirectory);
  const targetEvidencePath = path.join(
    evidenceDirectory,
    ACTIVATION_RUNTIME_EVIDENCE_FILE_NAME_V1,
  );
  if (await exists(targetEvidencePath)) {
    throw new Error("Activation runtime evidence create-new target already exists.");
  }

  const attemptToken = input.attemptToken ?? randomUUID().replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/.test(attemptToken)) {
    throw new Error("Activation runtime scratch attempt identity is invalid.");
  }
  const scratchRoot = path.join(helperOutputRoot, ".activation-runtime-scratch-v1");
  const scratchDirectory = path.join(scratchRoot, `attempt-${attemptToken}`);
  if (scratchDirectory.length > ACTIVATION_RUNTIME_PYLON_OUTPUT_DIR_MAX_LENGTH_V1) {
    throw new Error(
      `Activation runtime Pylon scratch directory exceeds the bounded ${ACTIVATION_RUNTIME_PYLON_OUTPUT_DIR_MAX_LENGTH_V1}-character limit.`,
    );
  }

  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  await mkdir(scratchDirectory, { recursive: false, mode: 0o700 });

  let state: "READY" | "CAPTURING" | "PROMOTED" | "RETAINED" | "EMPTY_FAILURE" = "READY";

  async function retainFailure() {
    if (state === "PROMOTED" || state === "RETAINED" || state === "EMPTY_FAILURE") return;
    if (!await exists(scratchDirectory)) {
      state = "EMPTY_FAILURE";
      return;
    }
    const scratchEntries = await readdir(scratchDirectory);
    if (scratchEntries.length === 0) {
      await removeEmptyDirectory(scratchDirectory);
      await removeEmptyDirectory(scratchRoot);
      state = "EMPTY_FAILURE";
      return;
    }
    const retainedScratchDirectory = path.join(
      evidenceDirectory,
      ACTIVATION_RUNTIME_FAILED_SCRATCH_DIRECTORY_V1,
    );
    if (await exists(retainedScratchDirectory)) {
      throw new Error("Activation runtime failed-scratch create-new target already exists.");
    }
    await rename(scratchDirectory, retainedScratchDirectory);
    await removeEmptyDirectory(scratchRoot);
    state = "RETAINED";
  }

  return {
    pylonOutputDirectory: scratchDirectory,
    pylonCaptureLabel: ACTIVATION_RUNTIME_PYLON_CAPTURE_LABEL_V1,
    targetEvidencePath,
    async capture<T extends ActivationRuntimeCaptureFileV1>(
      runCapture: (captureInput: ActivationRuntimePylonCaptureInputV1) => Promise<T>,
    ) {
      if (state !== "READY") {
        throw new Error("Activation runtime scratch capture is single-use; automatic retry is prohibited.");
      }
      state = "CAPTURING";
      let result: T;
      try {
        result = await runCapture({
          outputDir: scratchDirectory,
          label: ACTIVATION_RUNTIME_PYLON_CAPTURE_LABEL_V1,
        });
        const sourcePath = assertDirectScratchFile(result.outputFilePath, scratchDirectory);
        const scratchEntries = await readdir(scratchDirectory, { withFileTypes: true });
        if (
          scratchEntries.length !== 1 ||
          !scratchEntries[0]?.isFile() ||
          path.join(scratchDirectory, scratchEntries[0].name) !== sourcePath
        ) {
          throw new Error("Activation runtime scratch contains unexpected capture evidence.");
        }
        const sourceBytes = await readFile(sourcePath);
        if (
          sourceBytes.byteLength !== result.byteSize ||
          sha256(sourceBytes) !== result.sha256
        ) {
          throw new Error("Activation runtime scratch bytes do not match the Pylon capture result.");
        }
        await copyFile(sourcePath, targetEvidencePath, constants.COPYFILE_EXCL);
        const promotedBytes = await readFile(targetEvidencePath);
        if (
          promotedBytes.byteLength !== result.byteSize ||
          sha256(promotedBytes) !== result.sha256 ||
          !promotedBytes.equals(sourceBytes)
        ) {
          throw new Error("Promoted activation runtime evidence does not exactly match its scratch bytes.");
        }
        await chmod(targetEvidencePath, 0o600);
        await unlink(sourcePath);
        await removeEmptyDirectory(scratchDirectory);
        await removeEmptyDirectory(scratchRoot);
        state = "PROMOTED";
        return { ...result, outputFilePath: targetEvidencePath };
      } catch (error) {
        await retainFailure();
        throw error;
      }
    },
    retainFailure,
  };
}
