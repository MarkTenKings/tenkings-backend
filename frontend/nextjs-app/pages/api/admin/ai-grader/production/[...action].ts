import type { NextApiRequest, NextApiResponse } from "next";
import { publicUrlFor, uploadBuffer } from "../../../../../lib/server/storage";
import { requireAdminSession } from "../../../../../lib/server/admin";
import { requireUserSession } from "../../../../../lib/server/session";
import {
  createAiGraderProductionApiHandler,
  listProductionReportHistoryRuntime,
  persistProductionReleaseRuntime,
  persistAiGraderCompsRuntime,
  runAiGraderEbayCompsRuntime,
  searchAiGraderCardItemsRuntime,
  uploadAiGraderSlabbedPhotoRuntime,
} from "../../../../../lib/server/aiGraderProductionApi";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const runtime = createAiGraderProductionApiHandler({
    requireAdminSession,
    requireUserSession,
    publicUrlFor,
    uploadArtifact: async ({ storageKey, body, contentType }) => ({
      storageKey,
      publicUrl: await uploadBuffer(storageKey, Buffer.from(body), contentType),
    }),
    persist: persistProductionReleaseRuntime,
    listHistory: listProductionReportHistoryRuntime,
    searchCards: searchAiGraderCardItemsRuntime,
    uploadSlabbedPhoto: uploadAiGraderSlabbedPhotoRuntime,
    runComps: runAiGraderEbayCompsRuntime,
    persistComps: persistAiGraderCompsRuntime,
  });
  return runtime(req, res);
}
