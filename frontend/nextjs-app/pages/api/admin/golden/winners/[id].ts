import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { updateAdminGoldenTicketWinner } from "../../../../../lib/server/goldenAdminWinners";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";

const requestSchema = z
  .object({
    caption: z.string().max(1200, "Caption is too long").nullable().optional(),
    featured: z.boolean().optional(),
    winnerPhotoApproved: z.boolean().optional(),
    publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
    unpublished: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.publishedAt !== undefined && value.unpublished !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unpublished"],
        message: "Provide either publishedAt or unpublished, not both.",
      });
    }
  });

type ResponseBody =
  | {
      winner: Awaited<ReturnType<typeof updateAdminGoldenTicketWinner>>;
      message: string;
    }
  | { message: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { id } = req.query;
  if (typeof id !== "string") {
    return res.status(400).json({ message: "Winner profile id is required" });
  }

  try {
    await requireAdminSession(req);

    const payload = requestSchema.parse(req.body ?? {});
    const winner = await updateAdminGoldenTicketWinner(id, {
      caption: payload.caption,
      featured: payload.featured,
      winnerPhotoApproved: payload.winnerPhotoApproved,
      publishedAt: payload.publishedAt === undefined ? undefined : payload.publishedAt ? new Date(payload.publishedAt) : null,
      unpublished: payload.unpublished,
    });

    return res.status(200).json({
      winner,
      message: "Golden Ticket winner profile updated.",
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
