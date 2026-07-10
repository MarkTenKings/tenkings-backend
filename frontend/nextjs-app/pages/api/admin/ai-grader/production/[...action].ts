import type { NextApiRequest, NextApiResponse } from "next";
import { getS3ObjectAcl, headStorageObject, presignUploadUrl, publicUrlFor } from "../../../../../lib/server/storage";
import { requireAdminSession } from "../../../../../lib/server/admin";
import { requireUserSession } from "../../../../../lib/server/session";
import {
  addAiGraderCardToInventoryRuntime,
  createAiGraderProductionApiHandler,
  createAiGraderCardFromReportRuntime,
  finalizeAiGraderSlabbedPhotoUploadRuntime,
  listAiGraderFinishCardsQueueRuntime,
  listProductionReportHistoryRuntime,
  persistAiGraderCompsRuntime,
  persistAiGraderSelectedCompsRuntime,
  persistProductionReleaseRuntime,
  runAiGraderEbayCompsRuntime,
  searchAiGraderCardItemsRuntime,
} from "../../../../../lib/server/aiGraderProductionApi";
import {
  listAiGraderLabelSheetsRuntime,
  markAiGraderLabelSheetPrintedRuntime,
  prepareAiGraderLabelSheetPrintRuntime,
} from "../../../../../lib/server/aiGraderLabelSheetRuntime";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const runtime = createAiGraderProductionApiHandler({
    requireAdminSession,
    requireUserSession,
    publicUrlFor,
    presignUpload: async ({ storageKey, contentType }) => ({
      storageKey,
      uploadUrl: await presignUploadUrl(storageKey, contentType),
      uploadMethod: "PUT",
      uploadHeaders: {
        "Content-Type": contentType,
        ...(getS3ObjectAcl() ? { "x-amz-acl": String(getS3ObjectAcl()) } : {}),
      },
      publicUrl: publicUrlFor(storageKey),
    }),
    verifyUploadedArtifact: async ({ storageKey, byteSize, checksumSha256 }) => {
      const head = await headStorageObject(storageKey);
      const storedChecksum = head.metadata?.sha256 ?? null;
      return {
        ok: true,
        byteSize: typeof head.byteSize === "number" ? head.byteSize : undefined,
        contentType: head.contentType,
        checksumSha256: storedChecksum,
        message:
          typeof head.byteSize === "number" && head.byteSize !== byteSize
            ? `Storage byte size mismatch for ${storageKey}.`
            : undefined,
      };
    },
    persist: persistProductionReleaseRuntime,
    listHistory: listProductionReportHistoryRuntime,
    listFinishQueue: ({ tenantId }) => listAiGraderFinishCardsQueueRuntime({ tenantId }),
    listLabelSheets: ({ tenantId }) => listAiGraderLabelSheetsRuntime({ tenantId }),
    searchCards: searchAiGraderCardItemsRuntime,
    createCardFromReport: createAiGraderCardFromReportRuntime,
    finalizeSlabbedPhotoUpload: finalizeAiGraderSlabbedPhotoUploadRuntime,
    runComps: runAiGraderEbayCompsRuntime,
    persistComps: persistAiGraderCompsRuntime,
    persistSelectedComps: persistAiGraderSelectedCompsRuntime,
    prepareLabelSheetPrint: prepareAiGraderLabelSheetPrintRuntime,
    markLabelSheetPrinted: markAiGraderLabelSheetPrintedRuntime,
    addToInventory: addAiGraderCardToInventoryRuntime,
  });
  return runtime(req, res);
}
