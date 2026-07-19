import type { NextApiRequest, NextApiResponse } from "next";
import {
  createAiGraderMathematicalCalibrationSnapshotService,
  prisma,
} from "@tenkings/database";
import {
  loadFixedRigMathematicalCalibrationBundleFromStorageV1,
} from "@tenkings/ai-grader-capture-helper/calibration-bundle";
import { requireAdminSession } from "../../../../../lib/server/admin";
import {
  createAiGraderMathematicalCalibrationSnapshotApiHandler,
} from "../../../../../lib/server/aiGraderMathematicalCalibrationSnapshotApi";
import { readStorageBuffer } from "../../../../../lib/server/storage";

export const config = {
  maxDuration: 20,
  api: { bodyParser: { sizeLimit: "64kb" } },
};

const runtime = createAiGraderMathematicalCalibrationSnapshotApiHandler({
  requireAdminSession,
  service: createAiGraderMathematicalCalibrationSnapshotService(prisma as any, {
    readArtifactBytes: async (key) => readStorageBuffer(key),
    loadFinalizedBundle: loadFixedRigMathematicalCalibrationBundleFromStorageV1,
  }),
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return runtime(req, res);
}
