import type { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomUUID } from "node:crypto";
import { createAiGraderDesignReferenceService, prisma } from "@tenkings/database";
import { requireAdminSession } from "../../../../../lib/server/admin";
import { createAiGraderDesignReferenceApiHandler } from "../../../../../lib/server/aiGraderDesignReferenceApi";
import {
  AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SECRET_ENV,
  createAiGraderDesignReferenceUploadReceiptAuthorityV1,
} from "../../../../../lib/server/aiGraderDesignReferenceUploadReceipt";
import {
  presignPrivateDesignReferenceUploadUrl,
  readStorageBuffer,
  sha256HexToBase64,
} from "../../../../../lib/server/storage";

export const config = {
  maxDuration: 20,
  api: { bodyParser: { sizeLimit: "64kb" } },
};

function uploadReceiptAuthority() {
  return createAiGraderDesignReferenceUploadReceiptAuthorityV1({
    secret: String(process.env[AI_GRADER_DESIGN_REFERENCE_UPLOAD_RECEIPT_SECRET_ENV] ?? ""),
  });
}

const runtime = createAiGraderDesignReferenceApiHandler({
  requireAdminSession,
  uploadReceiptAuthority: {
    issue: (binding) => uploadReceiptAuthority().issue(binding),
    verify: (uploadReceipt) => uploadReceiptAuthority().verify(uploadReceipt),
  },
  planArtifactUpload: async (input) => {
    const identityHash = createHash("sha256").update(JSON.stringify({
      tenantId: input.tenantId,
      setId: input.setId,
      programId: input.programId,
      cardNumber: input.cardNumber,
      variantId: input.variantId,
      parallelId: input.parallelId,
      side: input.side,
      profile: input.profile,
      version: input.version,
    })).digest("hex");
    const extension = input.contentType === "image/png" ? "png" : "jpg";
    const storageKey = [
      "ai-grader/design-references/imports",
      identityHash,
      `v${input.version}-${input.side}-${randomUUID()}.${extension}`,
    ].join("/");
    return {
      storageKey,
      uploadUrl: await presignPrivateDesignReferenceUploadUrl({
        storageKey,
        contentType: input.contentType,
        checksumSha256: input.checksumSha256,
      }),
      uploadMethod: "PUT" as const,
      uploadHeaders: {
        "Content-Type": input.contentType,
        "x-amz-acl": "private",
        "x-amz-checksum-sha256": sha256HexToBase64(input.checksumSha256),
      },
      contentType: input.contentType,
      byteSize: input.byteSize,
      checksumSha256: input.checksumSha256,
    };
  },
  readArtifactBytes: async (storageKey) => readStorageBuffer(storageKey),
  service: createAiGraderDesignReferenceService(prisma as any, {
    readArtifactBytes: async (storageKey) => readStorageBuffer(storageKey),
  }),
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return runtime(req, res);
}
