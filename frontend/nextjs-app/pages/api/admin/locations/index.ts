import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

type LocationRow = {
  id: string;
  name: string;
  slug: string;
};

type ResponseBody = { locations: LocationRow[] } | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const locations = await prisma.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    });

    return res.status(200).json({ locations });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
