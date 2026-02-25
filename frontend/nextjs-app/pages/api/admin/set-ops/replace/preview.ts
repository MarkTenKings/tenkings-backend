import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { SetAuditStatus, SetDatasetType } from "@tenkings/database";
import { normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import { canPerformSetOpsRole, roleDeniedMessage, writeSetOpsAuditEvent } from "../../../../../lib/server/setOps";
import { isSetOpsReplaceWizardEnabled, prepareSetReplacePreview } from "../../../../../lib/server/setOpsReplace";

const previewSchema = z.object({
  setId: z.string().min(1),
  datasetType: z.nativeEnum(SetDatasetType).default(SetDatasetType.PARALLEL_DB),
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
});

type ResponseBody =
  | {
      preview: Awaited<ReturnType<typeof prepareSetReplacePreview>>["preview"];
    }
  | { message: string };

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (!isSetOpsReplaceWizardEnabled()) {
    return res.status(404).json({ message: "Set replace wizard is disabled" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let admin: AdminSession | null = null;
  const attemptedSetId = normalizeSetLabel(String(req.body?.setId ?? ""));

  try {
    admin = await requireAdminSession(req);

    if (!canPerformSetOpsRole(admin, "reviewer")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.replace.preview_generated",
        status: SetAuditStatus.DENIED,
        setId: attemptedSetId || null,
        reason: roleDeniedMessage("reviewer"),
      });
      return res.status(403).json({ message: roleDeniedMessage("reviewer") });
    }

    const payload = previewSchema.parse(req.body ?? {});

    const prepared = await prepareSetReplacePreview({
      setId: payload.setId,
      datasetType: payload.datasetType,
      rows: payload.rows,
    });

    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.replace.preview_generated",
      status: SetAuditStatus.SUCCESS,
      setId: prepared.setId,
      metadata: {
        datasetType: payload.datasetType,
        summary: prepared.preview.summary,
        diff: prepared.preview.diff,
      },
    });

    return res.status(200).json({
      preview: prepared.preview,
    });
  } catch (error) {
    const isValidation = error instanceof z.ZodError;

    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.replace.preview_generated",
      status: isValidation ? SetAuditStatus.DENIED : SetAuditStatus.FAILURE,
      setId: attemptedSetId || null,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    if (isValidation) {
      return res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payload" });
    }

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
