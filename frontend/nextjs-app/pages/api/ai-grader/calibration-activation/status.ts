import type { NextApiRequest, NextApiResponse } from "next";
import {
  createAiGraderCalibrationActivationService,
  createAiGraderMathematicalCalibrationSnapshotService,
  parseAiGraderCalibrationWorkstationPublicKeysV1,
  prisma,
} from "@tenkings/database";
import { loadFixedRigMathematicalCalibrationBundleFromStorageV1 } from "@tenkings/ai-grader-capture-helper/calibration-bundle";
import { createAiGraderCalibrationStartAuthorityApiHandler } from "../../../../lib/server/aiGraderCalibrationStartAuthorityApi";
import { requireAiGraderProductionActor } from "../../../../lib/server/aiGraderProductionAuth";
import { readStorageBuffer } from "../../../../lib/server/storage";

export const config = { maxDuration: 20, api: { bodyParser: { sizeLimit: "8kb" } } };

const snapshotService = createAiGraderMathematicalCalibrationSnapshotService(prisma as any, {
  readArtifactBytes: async (key) => readStorageBuffer(key),
  loadFinalizedBundle: loadFixedRigMathematicalCalibrationBundleFromStorageV1,
});

const service = createAiGraderCalibrationActivationService(prisma as any, {
  workstationPublicKeys: parseAiGraderCalibrationWorkstationPublicKeysV1(
    process.env.AI_GRADER_CALIBRATION_WORKSTATION_PUBLIC_KEYS_JSON,
  ),
  verifySnapshotStorage: async (snapshot) => {
    await snapshotService.verifyExact(String(snapshot.id ?? ""), "TRUSTED");
  },
});

const runtime = createAiGraderCalibrationStartAuthorityApiHandler({
  requireHumanActor: async (req) => {
    const actor = await requireAiGraderProductionActor(req, "calibration-status");
    if (actor.type !== "human_operator") {
      throw Object.assign(new Error("Human AI Grader operator session required"), { statusCode: 403 });
    }
    return actor;
  },
  service,
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return runtime(req, res);
}
