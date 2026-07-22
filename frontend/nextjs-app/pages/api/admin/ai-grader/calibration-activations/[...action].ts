import type { NextApiRequest, NextApiResponse } from "next";
import {
  createAiGraderCalibrationActivationService,
  createAiGraderMathematicalCalibrationSnapshotService,
  parseAiGraderCalibrationHostedAuthoritySigningKeyV1,
  parseAiGraderCalibrationWorkstationPublicKeysV1,
  prisma,
} from "@tenkings/database";
import { loadFixedRigMathematicalCalibrationBundleFromStorageV1 } from "@tenkings/ai-grader-capture-helper/calibration-bundle";
import {
  requireAdminSession,
  requireFreshHumanAdminSession,
} from "../../../../../lib/server/admin";
import { createAiGraderCalibrationActivationApiHandler } from "../../../../../lib/server/aiGraderCalibrationActivationApi";
import { readStorageBuffer } from "../../../../../lib/server/storage";

export const config = {
  maxDuration: 20,
  api: { bodyParser: { sizeLimit: "64kb" } },
};

const snapshotService = createAiGraderMathematicalCalibrationSnapshotService(prisma as any, {
  readArtifactBytes: async (key) => readStorageBuffer(key),
  loadFinalizedBundle: loadFixedRigMathematicalCalibrationBundleFromStorageV1,
});

const activationService = createAiGraderCalibrationActivationService(prisma as any, {
  workstationPublicKeys: parseAiGraderCalibrationWorkstationPublicKeysV1(
    process.env.AI_GRADER_CALIBRATION_WORKSTATION_PUBLIC_KEYS_JSON,
  ),
  hostedAuthoritySigningKey: parseAiGraderCalibrationHostedAuthoritySigningKeyV1(
    process.env.AI_GRADER_CALIBRATION_HOSTED_AUTHORITY_SIGNING_KEY_PKCS8_BASE64,
  ),
  verifySnapshotStorage: async (snapshot) => {
    await snapshotService.verifyExact(String(snapshot.id ?? ""), "TRUSTED");
  },
});

const runtime = createAiGraderCalibrationActivationApiHandler({
  requireAdminSession,
  requireFreshAdminSession: requireFreshHumanAdminSession,
  service: activationService,
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return runtime(req, res);
}
