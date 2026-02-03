import { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await requireAdminSession(req);

    if (req.method === "GET") {
      const source = typeof req.query.source === "string" ? req.query.source : undefined;
      const rules = await prisma.bytebotPlaybookRule.findMany({
        where: {
          ...(source ? { source } : {}),
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      });
      return res.status(200).json({ rules });
    }

    if (req.method === "POST") {
      const { source, action, selector, urlContains, label, priority, enabled } = req.body ?? {};
      if (!source || !action || !selector) {
        return res.status(400).json({ message: "Missing required fields." });
      }
      const rule = await prisma.bytebotPlaybookRule.create({
        data: {
          source,
          action,
          selector,
          urlContains: urlContains || null,
          label: label || null,
          priority: typeof priority === "number" ? priority : Number(priority ?? 0) || 0,
          enabled: typeof enabled === "boolean" ? enabled : true,
          createdById: session?.user?.id ?? null,
        },
      });
      return res.status(200).json({ rule });
    }

    if (req.method === "DELETE") {
      const id = typeof req.query.id === "string" ? req.query.id : undefined;
      if (!id) {
        return res.status(400).json({ message: "Missing rule id." });
      }
      await prisma.bytebotPlaybookRule.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
