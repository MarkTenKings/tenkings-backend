#!/usr/bin/env node
import {
  FAST_CALIBRATION_RIG_MATERIALIZATION_CONFIRMATION_V1_2,
  materializeFastCalibrationRigAuthorityV1_2,
} from "./drivers/fixedRigFastMathematicalCalibrationRigMaterializerV1_2";

export interface MaterializeMathematicalCalibrationV1_2RigAuthorityCliIo {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

type Parsed = {
  help: boolean;
  inputManifestPath?: string;
  inputManifestSha256?: string;
  acceptanceRoot?: string;
  confirmation?: string;
};

const HELP = `Protected one-time Mathematical Calibration V1.2 rig authority materializer

Usage:
  tk-ai-grader-materialize-mathematical-calibration-v1-2-rig-authority \\
    --input-manifest <absolute canonical input manifest path> \\
    --input-manifest-sha256 <exact lowercase sha256> \\
    --acceptance-root <absolute protected write-once root> \\
    --confirm "${FAST_CALIBRATION_RIG_MATERIALIZATION_CONFIRMATION_V1_2}"

This command reruns the pinned physical analyzer from exact supervised capture/measurement
bytes, writes no browser/hosted state, performs no activation, and opens no hardware.
`;

function readValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires one value.`);
  return value;
}

function parse(args: string[]): Parsed {
  const parsed: Parsed = { help: false };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (option === "--help" || option === "-h") {
      parsed.help = true;
    } else if (option === "--input-manifest") {
      parsed.inputManifestPath = readValue(args, index, option); index += 1;
    } else if (option === "--input-manifest-sha256") {
      parsed.inputManifestSha256 = readValue(args, index, option); index += 1;
    } else if (option === "--acceptance-root") {
      parsed.acceptanceRoot = readValue(args, index, option); index += 1;
    } else if (option === "--confirm") {
      parsed.confirmation = readValue(args, index, option); index += 1;
    } else {
      throw new Error(`Unknown materializer option: ${option}`);
    }
  }
  return parsed;
}

export async function runMaterializeMathematicalCalibrationV1_2RigAuthorityCli(
  args: string[],
  io: MaterializeMathematicalCalibrationV1_2RigAuthorityCliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  try {
    const parsed = parse(args);
    if (parsed.help) {
      stdout(HELP);
      return 0;
    }
    if (!parsed.inputManifestPath || !parsed.inputManifestSha256 || !parsed.acceptanceRoot || !parsed.confirmation) {
      throw new Error("The input manifest/path hash, acceptance root, and exact confirmation are all required.");
    }
    const result = await materializeFastCalibrationRigAuthorityV1_2({
      inputManifestPath: parsed.inputManifestPath,
      inputManifestSha256: parsed.inputManifestSha256,
      acceptanceRoot: parsed.acceptanceRoot,
      confirmation: parsed.confirmation,
    });
    stdout(`${JSON.stringify({
      ok: true,
      command: "materialize-mathematical-calibration-v1.2-rig-authority",
      productionMutation: false,
      activationPerformed: false,
      v0FallbackUsed: false,
      directoryName: result.directoryName,
      runtimeContextSha256: result.runtimeContextSha256,
      rigSourceBundleSha256: result.rigSourceBundleSha256,
      sourceEvidenceManifestSha256: result.sourceEvidenceManifestSha256,
      physicalAnalysisSha256: result.physicalAnalysisSha256,
      handoffSha256: result.handoffSha256,
    })}\n`);
    return 0;
  } catch (error) {
    stderr(`${JSON.stringify({
      ok: false,
      command: "materialize-mathematical-calibration-v1.2-rig-authority",
      productionMutation: false,
      activationPerformed: false,
      v0FallbackUsed: false,
      error: error instanceof Error ? error.message : "Rig authority materialization failed closed.",
    })}\n`);
    return 1;
  }
}

if (require.main === module) {
  void runMaterializeMathematicalCalibrationV1_2RigAuthorityCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
