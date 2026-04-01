import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { withAdminCors } from "../../../../lib/server/cors";
import {
  identifySetByCardIdentity,
  type IdentifySetCandidate,
  type IdentifySetConfidence,
  type IdentifySetTextSource,
  type IdentifySetTiebreaker,
} from "../../../../lib/server/cardSetIdentification";

type IdentifySetResponse =
  | {
      setId: string | null;
      setName: string | null;
      programId: string | null;
      programLabel: string | null;
      cardNumber: string | null;
      playerName: string | null;
      teamName: string | null;
      confidence: IdentifySetConfidence;
      reason: string;
      candidateSetIds: string[];
      candidateCount: number;
      scopedSetCount: number;
      candidates: IdentifySetCandidate[];
      tiebreaker: IdentifySetTiebreaker;
      textSource: IdentifySetTextSource;
    }
  | { message: string };

const identifySetSchema = z.object({
  year: z.string().trim().optional().nullable(),
  manufacturer: z.string().trim().optional().nullable(),
  sport: z.string().trim().optional().nullable(),
  cardNumber: z.string().trim().optional().nullable(),
  playerName: z.string().trim().optional().nullable(),
  teamName: z.string().trim().optional().nullable(),
  insertSet: z.string().trim().optional().nullable(),
  frontCardText: z.string().trim().optional().nullable(),
  combinedText: z.string().trim().optional().nullable(),
});

async function handler(req: NextApiRequest, res: NextApiResponse<IdentifySetResponse>) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await requireAdminSession(req);
    const payload = identifySetSchema.parse(req.body ?? {});
    const result = await identifySetByCardIdentity({
      year: payload.year ?? null,
      manufacturer: payload.manufacturer ?? null,
      sport: payload.sport ?? null,
      cardNumber: payload.cardNumber ?? null,
      playerName: payload.playerName ?? null,
      teamName: payload.teamName ?? null,
      insertSet: payload.insertSet ?? null,
      frontCardText: payload.frontCardText ?? null,
      combinedText: payload.combinedText ?? null,
    });
    return res.status(200).json(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

export default withAdminCors(handler);
