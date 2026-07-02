import type { NextApiRequest, NextApiResponse } from "next";
import { publicUrlFor, uploadBuffer } from "../../../../../lib/server/storage";
import { requireAdminSession } from "../../../../../lib/server/admin";
import {
  createAiGraderProductionApiHandler,
  listProductionReportHistoryRuntime,
  persistProductionReleaseRuntime,
} from "../../../../../lib/server/aiGraderProductionApi";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const runtime = createAiGraderProductionApiHandler({
    requireAdminSession,
    publicUrlFor,
    uploadArtifact: async ({ storageKey, body, contentType }) => ({
      storageKey,
      publicUrl: await uploadBuffer(storageKey, Buffer.from(body), contentType),
    }),
    persist: persistProductionReleaseRuntime,
    listHistory: listProductionReportHistoryRuntime,
  });
  return runtime(req, res);
}
