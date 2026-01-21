import { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await requireAdminSession(req);

    if (req.method !== "GET") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : null;
    const cardAssetId = typeof req.query.cardAssetId === "string" ? req.query.cardAssetId : null;

    if (!jobId && !cardAssetId) {
      return res.status(400).json({ message: "jobId or cardAssetId is required" });
    }

    const job = jobId
      ? await prisma.bytebotLiteJob.findUnique({ where: { id: jobId } })
      : await prisma.bytebotLiteJob.findFirst({
          where: { cardAssetId },
          orderBy: { createdAt: "desc" },
        });

    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    return res.status(200).json({ job });
  } catch (error) {
    const { status, message } = toErrorResponse(error);
    return res.status(status).json({ message });
  }
}
