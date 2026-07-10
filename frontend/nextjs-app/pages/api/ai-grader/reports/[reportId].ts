import type { NextApiRequest, NextApiResponse } from "next";
import { createAiGraderPublicReportApiHandler } from "../../../../lib/server/aiGraderProductionApi";
import { readAiGraderPublishedBundle } from "../../../../lib/server/aiGraderPublicReportData";
import { publicUrlFor } from "../../../../lib/server/storage";

export default createAiGraderPublicReportApiHandler({
  readPublishedBundle: readAiGraderPublishedBundle,
  publicUrlFor,
});
