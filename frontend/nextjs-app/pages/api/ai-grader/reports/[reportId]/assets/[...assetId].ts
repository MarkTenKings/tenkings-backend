import type { NextApiRequest, NextApiResponse } from "next";
import { aiGraderPublicReportDbReadsEnabled } from "../../../../../../lib/server/aiGraderProductionApi";
import { readAiGraderPublicOpaqueEvidence } from "../../../../../../lib/server/aiGraderPublicReportData";

export default async function aiGraderPublicOpaqueEvidenceHandler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }
  if (!aiGraderPublicReportDbReadsEnabled()) {
    return res.status(503).json({
      ok: false,
      code: "AI_GRADER_PUBLIC_REPORT_DB_DISABLED",
      message: "Persisted AI Grader public report reads are disabled.",
    });
  }
  const reportId = Array.isArray(req.query.reportId)
    ? req.query.reportId[0]
    : req.query.reportId;
  const assetParts = Array.isArray(req.query.assetId)
    ? req.query.assetId
    : typeof req.query.assetId === "string"
      ? [req.query.assetId]
      : [];
  if (!reportId || !assetParts.length) {
    return res.status(400).json({ ok: false, message: "reportId and assetId are required." });
  }
  const evidence = await readAiGraderPublicOpaqueEvidence(
    reportId,
    assetParts.join("/"),
  );
  if (!evidence) {
    return res.status(404).json({ ok: false, message: "Published evidence not found." });
  }
  const etag = '"' + evidence.checksumSha256 + '"';
  res.setHeader("ETag", etag);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="' + evidence.fileName + '"',
  );
  if (req.headers["if-none-match"] === etag) return res.status(304).end();
  return res.status(200).send(evidence.bytes);
}
