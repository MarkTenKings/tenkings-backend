import type { NextApiRequest, NextApiResponse } from "next";
import { prisma, readCachedAiGraderNfcSchemaReadiness } from "@tenkings/database";
import {
  deleteStorageObject,
  getS3ObjectAcl,
  deleteStoragePrefix,
  presignUploadUrl,
  publicUrlFor,
  readStoragePrefix,
  sha256HexToBase64,
  verifyStorageObjectIntegrity,
} from "../../../../../lib/server/storage";
import { readAiGraderRasterDimensions } from "../../../../../lib/aiGraderRasterValidation";
import { requireAdminSession } from "../../../../../lib/server/admin";
import { requireUserSession } from "../../../../../lib/server/session";
import {
  addAiGraderCardToInventoryRuntime,
  createAiGraderProductionApiHandler,
  createAiGraderCardFromReportRuntime,
  discardAiGraderFinishCardRuntime,
  finalizeAiGraderSlabbedPhotoUploadRuntime,
  listAiGraderFinishCardsQueueRuntime,
  listProductionReportHistoryRuntime,
  persistAiGraderCompsRuntime,
  persistAiGraderSelectedCompsRuntime,
  persistProductionReleaseRuntime,
  resolveAiGraderPublishAuthorityRuntime,
  runAiGraderEbayCompsRuntime,
  searchAiGraderCardItemsRuntime,
} from "../../../../../lib/server/aiGraderProductionApi";
import { resolvePokemonStandardCardAuthorityRuntime } from "../../../../../lib/server/aiGraderTrustedCardFormatAuthority";
import {
  listAiGraderLabelSheetsRuntime,
  markAiGraderLabelSheetPrintedRuntime,
  prepareAiGraderLabelSheetPrintRuntime,
  renderAiGraderLabelSheetCutSvgRuntime,
  renderAiGraderLabelSheetPdfRuntime,
} from "../../../../../lib/server/aiGraderLabelSheetRuntime";
import { runAiGraderOcrPrefillRuntime } from "../../../../../lib/server/aiGraderOcrPrefill";

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const runtime = createAiGraderProductionApiHandler({
    nfcSchemaReadiness: async () => (await readCachedAiGraderNfcSchemaReadiness(prisma as any)).ready,
    requireAdminSession,
    requireUserSession,
    publicUrlFor,
    resolvePublishAuthority: resolveAiGraderPublishAuthorityRuntime,
    presignUpload: async ({ storageKey, contentType, checksumSha256 }) => ({
      storageKey,
      uploadUrl: await presignUploadUrl(storageKey, contentType, {
        checksumSha256,
      }),
      uploadMethod: "PUT",
      uploadHeaders: {
        "Content-Type": contentType,
        ...(getS3ObjectAcl() ? { "x-amz-acl": String(getS3ObjectAcl()) } : {}),
        "x-amz-checksum-sha256": sha256HexToBase64(checksumSha256),
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
      const integrity = await verifyStorageObjectIntegrity({
        storageKey,
        expectedByteSize: byteSize,
        expectedChecksumSha256: checksumSha256,
      });
      if (!integrity.ok || (sourceImageWidthPx === undefined && sourceImageHeightPx === undefined)) {
        return integrity;
      }
      const dimensions = readAiGraderRasterDimensions(
        await readStoragePrefix(storageKey),
        integrity.contentType ?? contentType ?? "",
      );
      if (!dimensions) {
        return {
          ...integrity,
          ok: false,
          message: "Storage image dimensions could not be verified.",
        };
      }
      return { ...integrity, ...dimensions };
    },
    persist: persistProductionReleaseRuntime,
    listHistory: ({ tenantId }) => listProductionReportHistoryRuntime({ tenantId }),
    listFinishQueue: ({ tenantId }) => listAiGraderFinishCardsQueueRuntime({ tenantId }),
    listLabelSheets: ({ tenantId }) => listAiGraderLabelSheetsRuntime({ tenantId }),
    searchCards: searchAiGraderCardItemsRuntime,
    resolveMathematicalCardAuthority: resolvePokemonStandardCardAuthorityRuntime,
    createCardFromReport: createAiGraderCardFromReportRuntime,
    finalizeSlabbedPhotoUpload: finalizeAiGraderSlabbedPhotoUploadRuntime,
    runOcrPrefill: runAiGraderOcrPrefillRuntime,
    recordOcrProviderDiagnostics(diagnostics) {
      console.info("AI Grader OCR provider diagnostics", {
        schemaVersion: diagnostics.schemaVersion,
        googleElapsedMs: diagnostics.googleElapsedMs,
        openAiElapsedMs: diagnostics.openAiElapsedMs,
        totalProviderElapsedMs: diagnostics.totalProviderElapsedMs,
        actualOpenAiModel: diagnostics.actualOpenAiModel,
      });
    },
    runComps: runAiGraderEbayCompsRuntime,
    persistComps: persistAiGraderCompsRuntime,
    persistSelectedComps: persistAiGraderSelectedCompsRuntime,
    prepareLabelSheetPrint: prepareAiGraderLabelSheetPrintRuntime,
    markLabelSheetPrinted: markAiGraderLabelSheetPrintedRuntime,
    renderLabelSheetPdf: renderAiGraderLabelSheetPdfRuntime,
    renderLabelSheetCutSvg: renderAiGraderLabelSheetCutSvgRuntime,
    addToInventory: addAiGraderCardToInventoryRuntime,
    discardFinishCard: (input) => discardAiGraderFinishCardRuntime({
      ...input,
      deleteStorageObject,
      deleteStoragePrefix,
    }),
  });
  return runtime(req, res);
}
