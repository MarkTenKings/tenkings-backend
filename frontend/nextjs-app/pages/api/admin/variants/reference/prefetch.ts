import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { normalizeCardNumber, normalizeSetLabel } from "@tenkings/shared";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  buildReferenceSeedQuery,
  canonicalSeedParallel,
  primarySeedPlayerLabel,
  ReferenceSeedError,
  seedVariantReferenceImages,
} from "../../../../../lib/server/referenceSeed";
import { normalizeProgramId } from "../../../../../lib/server/taxonomyV2Utils";

type ResponseBody =
  | {
      ok: true;
      setId: string;
      programId: string;
      cardNumber: string;
      parallelCount: number;
      processed: number;
      inserted: number;
      skipped: number;
      failed: number;
      failures: string[];
    }
  | { message: string };

function asString(value: unknown) {
  return String(value || "").trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const setId = normalizeSetLabel(asString(req.body?.setId));
    const cardType = asString(req.body?.cardType);
    const playerName = primarySeedPlayerLabel(asString(req.body?.playerName));
    const cardNumber = normalizeCardNumber(asString(req.body?.cardNumber)) || "ALL";
    const limit = Math.min(20, Math.max(1, Number(req.body?.limit ?? 6) || 6));
    const tbs = asString(req.body?.tbs) || undefined;
    const gl = asString(req.body?.gl) || undefined;
    const hl = asString(req.body?.hl) || undefined;

    if (!setId || !cardType || !playerName) {
      return res.status(400).json({ message: "setId, cardType, and playerName are required." });
    }

    const programId = normalizeProgramId(cardType);
    const scopeRows = await prisma.setParallelScope.findMany({
      where: {
        setId,
        programId,
      },
      select: {
        parallelId: true,
      },
      distinct: ["parallelId"],
      orderBy: [{ parallelId: "asc" }],
      take: 40,
    });

    const parallels = Array.from(
      new Set(
        scopeRows
          .map((row) => canonicalSeedParallel(row.parallelId, cardNumber))
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );
    if (parallels.length < 1) {
      parallels.push("base");
    }

    let processed = 0;
    let inserted = 0;
    let skipped = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const parallelId of parallels) {
      const query = buildReferenceSeedQuery({
        setId,
        cardNumber,
        cardType,
        parallelId,
        playerSeed: playerName,
      });
      if (!query) continue;
      try {
        const result = await seedVariantReferenceImages({
          setId,
          programId,
          cardNumber,
          parallelId,
          playerSeed: playerName,
          query,
          limit,
          tbs,
          gl,
          hl,
        });
        processed += 1;
        inserted += Number(result.inserted ?? 0);
        skipped += Number(result.skipped ?? 0);
      } catch (error) {
        failed += 1;
        if (failures.length < 8) {
          failures.push(
            `${parallelId}: ${error instanceof Error ? error.message : "prefetch_failed"}`
          );
        }
      }
    }

    return res.status(200).json({
      ok: true,
      setId,
      programId,
      cardNumber,
      parallelCount: parallels.length,
      processed,
      inserted,
      skipped,
      failed,
      failures,
    });
  } catch (error) {
    if (error instanceof ReferenceSeedError) {
      return res.status(error.status).json({ message: error.message });
    }
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}

