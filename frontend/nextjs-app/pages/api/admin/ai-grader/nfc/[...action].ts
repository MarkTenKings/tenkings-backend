import type { NextApiRequest, NextApiResponse } from "next";
import {
  completeAiGraderNfcProgramming,
  completeAiGraderNfcManualIos,
  confirmAiGraderNfcManualIosLock,
  getAiGraderNfcStatus,
  initAiGraderNfcProgramming,
  initAiGraderNfcManualIos,
  prisma,
  replaceAiGraderNfcTag,
  replaceAiGraderNfcManualIos,
  revokeAiGraderNfcTag,
  type AiGraderNfcSafeStatus,
} from "@tenkings/database";
import { createAiGraderNfcApiHandler } from "../../../../../lib/server/aiGraderNfcApi";
import { requireAdminSession } from "../../../../../lib/server/admin";
import { requireUserSession } from "../../../../../lib/server/session";

export const config = {
  maxDuration: 20,
  api: {
    bodyParser: {
      sizeLimit: "32kb",
    },
  },
};

async function resolvePublishedLinkage(tenantId: string, reportId: string) {
  const db = prisma as any;
  const report = await db.aiGraderReport.findUnique({
    where: { reportId },
    select: {
      tenantId: true,
      reportId: true,
      publicationStatus: true,
      cardAssetId: true,
      itemId: true,
      labels: {
        orderBy: { updatedAt: "desc" },
        take: 2,
        select: { certId: true },
      },
    },
  });
  const labels = Array.isArray(report?.labels) ? report.labels : [];
  if (
    report?.tenantId !== tenantId ||
    report?.publicationStatus !== "published" ||
    typeof report?.cardAssetId !== "string" ||
    typeof report?.itemId !== "string" ||
    labels.length !== 1 ||
    typeof labels[0]?.certId !== "string"
  ) {
    const error = new Error("NFC requires one exact published report, CardAsset, Item, and certificate linkage.") as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = 409;
    error.code = "AI_GRADER_NFC_CONFIRM_AUTHORITY_MISMATCH";
    throw error;
  }
  return {
    tenantId,
    reportId,
    cardAssetId: report.cardAssetId,
    itemId: report.itemId,
    certId: labels[0].certId,
  };
}

async function resolvePublishedStatusLinkage(tenantId: string, reportId: string) {
  const linkage = await resolvePublishedLinkage(tenantId, reportId);
  const item = await (prisma as any).item.findUnique({
    where: { id: linkage.itemId },
    select: { name: true, set: true },
  });
  if (!item || typeof item.name !== "string" || !item.name.trim()) {
    const error = new Error("NFC requires the exact published Item linkage.") as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = 409;
    error.code = "AI_GRADER_NFC_CONFIRM_AUTHORITY_MISMATCH";
    throw error;
  }
  return {
    reportId: linkage.reportId,
    cardAssetId: linkage.cardAssetId,
    itemId: linkage.itemId,
    certId: linkage.certId,
    cardTitle: item.name,
    ...(typeof item.set === "string" && item.set.trim() ? { cardSet: item.set } : {}),
  };
}

function requireExistingRegistration(status: AiGraderNfcSafeStatus) {
  if (!status.publicTagId || !status.cardAssetId || !status.itemId || !status.certId) {
    const error = new Error("No NFC registration exists for this published report.") as Error & {
      statusCode?: number;
      code?: string;
    };
    error.statusCode = 404;
    error.code = "AI_GRADER_NFC_TAG_NOT_FOUND";
    throw error;
  }
  return {
    reportId: status.reportId,
    cardAssetId: status.cardAssetId,
    itemId: status.itemId,
    certId: status.certId,
    publicTagId: status.publicTagId,
  };
}

const runtime = createAiGraderNfcApiHandler({
  requireAdminSession,
  requireUserSession,
  publishedLinkage(input) {
    return resolvePublishedStatusLinkage(input.tenantId, input.reportId);
  },
  async init(input) {
    const linkage = await resolvePublishedLinkage(input.tenantId, input.reportId);
    return initAiGraderNfcProgramming({
      ...linkage,
      requestedByUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      attemptTtlMs: input.attemptTtlSeconds * 1000,
      dbClient: prisma,
    });
  },
  async manualIosInit(input) {
    const linkage = await resolvePublishedLinkage(input.tenantId, input.reportId);
    return initAiGraderNfcManualIos({
      ...linkage,
      requestedByUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      attemptTtlMs: input.attemptTtlSeconds * 1000,
      dbClient: prisma,
    });
  },
  complete(input) {
    return completeAiGraderNfcProgramming({
      tenantId: input.tenantId,
      reportId: input.reportId,
      cardAssetId: input.cardAssetId,
      itemId: input.itemId,
      certId: input.certId,
      requestedByUserId: input.actorUserId,
      attemptId: input.attemptId,
      attemptToken: input.attemptToken,
      idempotencyKey: input.idempotencyKey,
      publicTagId: input.publicTagId,
      uidFingerprintSha256: input.uidFingerprintSha256,
      normalizedNdefUrl: input.normalizedUrl,
      readbackPayloadSha256: input.readbackPayloadSha256,
      chipType: input.chipType,
      securityMode: "static_url_v1",
      readerResultCode: input.readerResultCode,
      helperProtocolVersion: input.helperProtocolVersion,
      operationalAttestation: input.operationalAttestation,
      dbClient: prisma,
    });
  },
  manualIosConfirmLock(input) {
    return confirmAiGraderNfcManualIosLock({
      tenantId: input.tenantId,
      reportId: input.reportId,
      cardAssetId: input.cardAssetId,
      itemId: input.itemId,
      certId: input.certId,
      requestedByUserId: input.actorUserId,
      attemptId: input.attemptId,
      publicTagId: input.publicTagId,
      writableNoConfirmed: true,
      dbClient: prisma,
    });
  },
  manualIosComplete(input) {
    return completeAiGraderNfcManualIos({
      tenantId: input.tenantId,
      reportId: input.reportId,
      cardAssetId: input.cardAssetId,
      itemId: input.itemId,
      certId: input.certId,
      requestedByUserId: input.actorUserId,
      attemptId: input.attemptId,
      publicTagId: input.publicTagId,
      normalizedNdefUrl: input.normalizedUrl,
      idempotencyKey: input.idempotencyKey,
      dbClient: prisma,
    });
  },
  async status(input) {
    const status = await getAiGraderNfcStatus({ tenantId: input.tenantId, reportId: input.reportId, dbClient: prisma });
    const item = status.itemId
      ? await (prisma as any).item.findUnique({ where: { id: status.itemId }, select: { name: true, set: true, number: true } })
      : null;
    return {
      ...status,
      ...(item?.name ? { cardTitle: item.name } : {}),
      ...(item?.set ? { cardSet: item.set } : {}),
    };
  },
  async revoke(input) {
    const status = requireExistingRegistration(
      await getAiGraderNfcStatus({ tenantId: input.tenantId, reportId: input.reportId, dbClient: prisma }),
    );
    return revokeAiGraderNfcTag({
      tenantId: input.tenantId,
      ...status,
      requestedByUserId: input.actorUserId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      dbClient: prisma,
    });
  },
  async manualIosReplace(input) {
    const status = requireExistingRegistration(await getAiGraderNfcStatus({
      tenantId: input.tenantId,
      reportId: input.reportId,
      dbClient: prisma,
    }));
    return replaceAiGraderNfcManualIos({
      tenantId: input.tenantId,
      reportId: status.reportId,
      cardAssetId: status.cardAssetId,
      itemId: status.itemId,
      certId: status.certId,
      requestedByUserId: input.actorUserId,
      replacedPublicTagId: input.replacedPublicTagId,
      revocationReason: input.reason,
      revocationReasonCode: "AI_GRADER_NFC_REPLACED",
      idempotencyKey: input.idempotencyKey,
      attemptTtlMs: input.attemptTtlSeconds * 1000,
      dbClient: prisma,
    });
  },
  async replace(input) {
    const status = requireExistingRegistration(await getAiGraderNfcStatus({
      tenantId: input.tenantId,
      reportId: input.reportId,
      dbClient: prisma,
    }));
    return replaceAiGraderNfcTag({
      tenantId: input.tenantId,
      reportId: status.reportId,
      cardAssetId: status.cardAssetId,
      itemId: status.itemId,
      certId: status.certId,
      requestedByUserId: input.actorUserId,
      replacedPublicTagId: input.replacedPublicTagId,
      revocationReason: input.reason,
      revocationReasonCode: "AI_GRADER_NFC_REPLACED",
      idempotencyKey: input.idempotencyKey,
      attemptTtlMs: input.attemptTtlSeconds * 1000,
      dbClient: prisma,
    });
  },
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return runtime(req, res);
}
