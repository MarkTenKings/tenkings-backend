import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  listOcrEvalCases,
  upsertOcrEvalCase,
  type OcrEvalCaseInput,
} from "../../../../../lib/server/ocrEvalFramework";

type CasesResponse =
  | {
      cases: Awaited<ReturnType<typeof listOcrEvalCases>>;
    }
  | {
      caseItem: Awaited<ReturnType<typeof upsertOcrEvalCase>>;
    }
  | { message: string };

function getString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<CasesResponse>) {
  try {
    await requireAdminSession(req);

    if (req.method === "GET") {
      const cases = await listOcrEvalCases();
      return res.status(200).json({ cases });
    }

    if (req.method === "POST") {
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const payload: OcrEvalCaseInput = {
        slug: getString(body.slug) ?? "",
        title: getString(body.title) ?? "",
        description: getString(body.description),
        cardAssetId: getString(body.cardAssetId) ?? "",
        enabled: typeof body.enabled === "boolean" ? body.enabled : true,
        tags: Array.isArray(body.tags)
          ? body.tags.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
          : [],
        expected: (body.expected ?? {}) as OcrEvalCaseInput["expected"],
        hints: (body.hints ?? {}) as OcrEvalCaseInput["hints"],
      };
      const caseItem = await upsertOcrEvalCase(payload);
      return res.status(200).json({ caseItem });
    }

    if (req.method === "PATCH") {
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const slug = getString(body.slug);
      if (!slug) {
        return res.status(400).json({ message: "slug is required" });
      }
      const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
      await (prisma as any).ocrEvalCase.update({
        where: { slug: slug.toLowerCase() },
        data: { enabled },
      });
      const cases = await listOcrEvalCases();
      return res.status(200).json({ cases });
    }

    if (req.method === "DELETE") {
      const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
      const slug = getString(body.slug);
      if (!slug) {
        return res.status(400).json({ message: "slug is required" });
      }
      await (prisma as any).ocrEvalCase.delete({
        where: { slug: slug.toLowerCase() },
      });
      const cases = await listOcrEvalCases();
      return res.status(200).json({ cases });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
