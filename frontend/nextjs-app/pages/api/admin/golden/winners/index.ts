import type { NextApiRequest, NextApiResponse } from "next";
import type { AdminGoldenTicketWinnerSort } from "../../../../../lib/server/goldenAdminWinners";
import { listAdminGoldenTicketWinners } from "../../../../../lib/server/goldenAdminWinners";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

function parsePositiveInt(value: string | string[] | undefined, fallback: number) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSort(value: string | string[] | undefined): AdminGoldenTicketWinnerSort {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "oldest" ? "oldest" : "recent";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);

    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 20);
    const sort = parseSort(req.query.sort);
    const result = await listAdminGoldenTicketWinners({ page, limit, sort });
    return res.status(200).json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
