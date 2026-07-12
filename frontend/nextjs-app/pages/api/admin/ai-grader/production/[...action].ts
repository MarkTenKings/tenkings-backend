import type { NextApiRequest, NextApiResponse } from "next";
import {
  getS3ObjectAcl,
  headStorageObject,
  presignUploadUrl,
  publicUrlFor,
  readStoragePrefix,
  verifyStorageObjectIntegrity,
} from "../../../../../lib/server/storage";
import { readAiGraderRasterDimensions } from "../../../../../lib/aiGraderRasterValidation";
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
import { runAiGraderOcrPrefillRuntime } from "../../../../../lib/server/aiGraderOcrPrefillCurrent";

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
        checksumSha256,
      }),
      uploadMethod: "PUT",
      uploadHeaders: {
        "Content-Type": contentType,
        ...(getS3ObjectAcl() ? { "x-amz-acl": String(getS3ObjectAcl()) } : {}),
      },
      publicUrl: publicUrlFor(storageKey),
    }),
    verifyUploadedArtifact: async ({
      storageKey,
      byteSize,
      checksumSha256,
      contentType,
      sourceImageWidthPx,
      sourceImageHeightPx,
    }) => {
      const head = await headStorageObject(storageKey);
      const integrity = verifyStorageObjectIntegrity({
        storageKey,
        expectedByteSize: byteSize,
        expectedChecksumSha256: checksumSha256,
        head,
      });
      if (!integrity.ok || (sourceImageWidthPx === undefined && sourceImageHeightPx === undefined)) {
        return integrity;
      }
      const dimensions = readAiGraderRasterDimensions(
        await readStoragePrefix(storageKey),
        head.contentType ?? contentType ?? "",
      );
      if (!dimensions) {
        return {
          ...integrity,
          ok: false,
          message: `Storage image dimensions could not be verified for ${storageKey}.`,
        };
      }
      return { ...integrity, ...dimensions };
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
