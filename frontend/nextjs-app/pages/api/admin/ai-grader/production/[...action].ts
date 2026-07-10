import type { NextApiRequest, NextApiResponse } from "next";
import {
  getS3ObjectAcl,
  headStorageObject,
  presignUploadUrl,
  publicUrlFor,
  sha256HexToBase64,
  verifyStorageObjectIntegrity,
} from "../../../../../lib/server/storage";
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
import { runAiGraderOcrPrefillRuntime } from "../../../../../lib/server/aiGraderOcrPrefill";

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
    presignUpload: async ({ storageKey, contentType, checksumSha256 }) => ({
      storageKey,
      uploadUrl: await presignUploadUrl(storageKey, contentType, {
        metadata: { sha256: checksumSha256.toLowerCase() },
        checksumSha256,
      }),
      uploadMethod: "PUT",
      uploadHeaders: {
        "Content-Type": contentType,
        "x-amz-meta-sha256": checksumSha256.toLowerCase(),
        "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
        ...(getS3ObjectAcl() ? { "x-amz-acl": String(getS3ObjectAcl()) } : {}),
      },
      publicUrl: publicUrlFor(storageKey),
    }),
    verifyUploadedArtifact: async ({ storageKey, byteSize, checksumSha256 }) => {
      const head = await headStorageObject(storageKey);
      return verifyStorageObjectIntegrity({
        storageKey,
        expectedByteSize: byteSize,
        expectedChecksumSha256: checksumSha256,
        head,
      });
    },
    persist: persistProductionReleaseRuntime,
    listHistory: listProductionReportHistoryRuntime,
    listFinishQueue: ({ tenantId }) => listAiGraderFinishCardsQueueRuntime({ tenantId }),
    listLabelSheets: ({ tenantId }) => listAiGraderLabelSheetsRuntime({ tenantId }),
    searchCards: searchAiGraderCardItemsRuntime,
    createCardFromReport: createAiGraderCardFromReportRuntime,
    finalizeSlabbedPhotoUpload: finalizeAiGraderSlabbedPhotoUploadRuntime,
    runOcrPrefill: runAiGraderOcrPrefillRuntime,
    runComps: runAiGraderEbayCompsRuntime,
    persistComps: persistAiGraderCompsRuntime,
    persistSelectedComps: persistAiGraderSelectedCompsRuntime,
    prepareLabelSheetPrint: prepareAiGraderLabelSheetPrintRuntime,
    markLabelSheetPrinted: markAiGraderLabelSheetPrintedRuntime,
    addToInventory: addAiGraderCardToInventoryRuntime,
  });
  return runtime(req, res);
}
