import type { NextApiRequest, NextApiResponse } from "next";
import { SetAuditStatus, SetDatasetType } from "@tenkings/database";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import { canPerformSetOpsRole, roleDeniedMessage, writeSetOpsAuditEvent } from "../../../../../lib/server/setOps";
import { parseUploadedSourceFile } from "../../../../../lib/server/setOpsDiscovery";

type ResponseBody =
  | {
      rows: Array<Record<string, unknown>>;
      parserName: string;
      rowCount: number;
    }
  | { message: string };

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: NextApiRequest, maxBytes = 8 * 1024 * 1024) {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error("Uploaded file exceeds 8MB limit.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function resolveUploadFileName(req: NextApiRequest) {
  const fromHeader = req.headers["x-file-name"];
  const headerName = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  const fromQuery = Array.isArray(req.query.fileName) ? req.query.fileName[0] : req.query.fileName;
  const rawName = String(headerName ?? fromQuery ?? "").trim();
  if (!rawName) return "upload.bin";
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let admin: AdminSession | null = null;

  try {
    admin = await requireAdminSession(req);
    if (!canPerformSetOpsRole(admin, "reviewer")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.discovery.parse_upload",
        status: SetAuditStatus.DENIED,
        reason: roleDeniedMessage("reviewer"),
      });
      return res.status(403).json({ message: roleDeniedMessage("reviewer") });
    }

    const fileName = resolveUploadFileName(req);
    const fileBuffer = await readRawBody(req);
    const datasetTypeQuery = Array.isArray(req.query.datasetType) ? req.query.datasetType[0] : req.query.datasetType;
    const requestedDatasetType = String(datasetTypeQuery || "")
      .trim()
      .toUpperCase();
    const preferredDatasetType =
      requestedDatasetType && requestedDatasetType in SetDatasetType
        ? (requestedDatasetType as SetDatasetType)
        : null;
    const contentType = Array.isArray(req.headers["content-type"])
      ? req.headers["content-type"][0]
      : req.headers["content-type"] || null;

    const parsed = parseUploadedSourceFile({
      fileName,
      fileBuffer,
      contentType,
      preferredDatasetType,
    });

    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.discovery.parse_upload",
      status: SetAuditStatus.SUCCESS,
      metadata: {
        fileName,
        contentType,
        preferredDatasetType,
        parserName: parsed.parserName,
        rowCount: parsed.rows.length,
      },
    });

    return res.status(200).json({
      rows: parsed.rows,
      parserName: parsed.parserName,
      rowCount: parsed.rows.length,
    });
  } catch (error) {
    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.discovery.parse_upload",
      status: SetAuditStatus.FAILURE,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
