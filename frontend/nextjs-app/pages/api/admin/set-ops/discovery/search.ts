import type { NextApiRequest, NextApiResponse } from "next";
import { SetAuditStatus } from "@tenkings/database";
import { requireAdminSession, toErrorResponse, type AdminSession } from "../../../../../lib/server/admin";
import { canPerformSetOpsRole, roleDeniedMessage, writeSetOpsAuditEvent } from "../../../../../lib/server/setOps";
import { searchSetSources, type SetOpsDiscoveryQuery } from "../../../../../lib/server/setOpsDiscovery";

type ResponseBody =
  | {
      results: Array<{
        id: string;
        title: string;
        url: string;
        snippet: string;
        provider: string;
        domain: string;
        setIdGuess: string;
        score: number;
        discoveredAt: string;
      }>;
      total: number;
    }
  | { message: string };

function parseQuery(req: NextApiRequest): SetOpsDiscoveryQuery {
  const toStringValue = (value: unknown) => (Array.isArray(value) ? String(value[0] ?? "") : String(value ?? ""));
  const yearRaw = toStringValue(req.query.year).trim();
  const year = yearRaw ? Number(yearRaw) : null;
  const limitRaw = toStringValue(req.query.limit).trim();
  const limit = limitRaw ? Number(limitRaw) : null;
  return {
    year: Number.isFinite(year) ? year : null,
    manufacturer: toStringValue(req.query.manufacturer).trim() || null,
    sport: toStringValue(req.query.sport).trim() || null,
    query: toStringValue(req.query.q).trim() || null,
    limit: Number.isFinite(limit) ? limit : null,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let admin: AdminSession | null = null;
  try {
    admin = await requireAdminSession(req);
    if (!canPerformSetOpsRole(admin, "reviewer")) {
      await writeSetOpsAuditEvent({
        req,
        admin,
        action: "set_ops.discovery.search",
        status: SetAuditStatus.DENIED,
        reason: roleDeniedMessage("reviewer"),
      });
      return res.status(403).json({ message: roleDeniedMessage("reviewer") });
    }

    const query = parseQuery(req);
    const results = await searchSetSources(query);

    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.discovery.search",
      status: SetAuditStatus.SUCCESS,
      metadata: {
        query,
        resultCount: results.length,
      },
    });

    return res.status(200).json({
      results,
      total: results.length,
    });
  } catch (error) {
    await writeSetOpsAuditEvent({
      req,
      admin,
      action: "set_ops.discovery.search",
      status: SetAuditStatus.FAILURE,
      reason: error instanceof Error ? error.message : "Unknown failure",
    });

    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
