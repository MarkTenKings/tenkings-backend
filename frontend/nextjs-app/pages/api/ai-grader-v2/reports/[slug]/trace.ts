import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";

import {
  findSpeedsterPersistedTrace,
  parsePersistedSpeedsterReviewFindings,
} from "../../../../../lib/ai-grader-v2/review-findings";
import { encodeSpeedsterTraceBitmapWireV1 } from "../../../../../lib/ai-grader-v2/trace-bitmap-wire";
import { decodeSpeedsterTraceRleV1 } from "../../../../../lib/ai-grader-v2/trace-codec";
import { activeSpeedsterPublicReportWhere } from "../../../../../lib/server/tenKingsV2PublicReport";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }
  const slugValue = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  const findingValue = Array.isArray(req.query.findingId) ? req.query.findingId[0] : req.query.findingId;
  const slug = typeof slugValue === "string" && SLUG.test(slugValue) ? slugValue : null;
  const findingId = typeof findingValue === "string" && findingValue.trim() ? findingValue.trim() : null;
  if (!slug || !findingId) return res.status(400).json({ message: "Invalid Speedster trace request" });

  const session = await prisma.aiGraderV2Session.findFirst({
    where: activeSpeedsterPublicReportWhere(slug),
    select: { reviewedDefects: true },
  });
  if (!session) return res.status(404).json({ message: "Speedster report not found" });
  try {
    const trace = findSpeedsterPersistedTrace(
      parsePersistedSpeedsterReviewFindings(session.reviewedDefects),
      findingId,
    );
    if (!trace) return res.status(404).json({ message: "Speedster trace not found" });
    return res.status(200).json({
      traceWire: encodeSpeedsterTraceBitmapWireV1(decodeSpeedsterTraceRleV1(trace), trace.sha256),
    });
  } catch {
    return res.status(404).json({ message: "Speedster trace not found" });
  }
}
