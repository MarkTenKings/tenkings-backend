import type { NextApiRequest, NextApiResponse } from "next";
import { getS3ObjectAcl, headStorageObject, presignUploadUrl, publicUrlFor } from "../../../../../lib/server/storage";
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
      uploadUrl: await presignUploadUrl(storageKey, contentType, { metadata: { sha256: checksumSha256 } }),
      uploadMethod: "PUT",
      uploadHeaders: {
        "Content-Type": contentType,
        "x-amz-meta-sha256": checksumSha256,
        ...(getS3ObjectAcl() ? { "x-amz-acl": String(getS3ObjectAcl()) } : {}),
      },
      publicUrl: publicUrlFor(storageKey),
    }),
    verifyUploadedArtifact: async ({ storageKey, byteSize, checksumSha256 }) => {
      const head = await headStorageObject(storageKey);
      const storedChecksum = head.metadata?.sha256 ?? head.metadata?.["x-amz-meta-sha256"] ?? null;
      return {
        ok: true,
        byteSize: typeof head.byteSize === "number" ? head.byteSize : undefined,
        contentType: head.contentType,
        checksumSha256: storedChecksum ?? checksumSha256,
        message:
          typeof head.byteSize === "number" && head.byteSize !== byteSize
            ? `Storage byte size mismatch for ${storageKey}.`
            : undefined,
      };
    },
    persist: persistProductionReleaseRuntime,
    listHistory: listProductionReportHistoryRuntime,
    searchCards: searchAiGraderCardItemsRuntime,
    uploadSlabbedPhoto: uploadAiGraderSlabbedPhotoRuntime,
    runComps: runAiGraderEbayCompsRuntime,
    persistComps: persistAiGraderCompsRuntime,
  });
  return runtime(req, res);
}
