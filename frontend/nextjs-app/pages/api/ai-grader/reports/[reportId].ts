import type { NextApiRequest, NextApiResponse } from "next";
import { createAiGraderPublicReportApiHandler } from "../../../../lib/server/aiGraderProductionApi";
import {
  readAiGraderPublishedBundle,
  readAiGraderPublicReportEnrichment,
  readAiGraderPublicReportPresentation,
} from "../../../../lib/server/aiGraderPublicReportData";
import { publicUrlFor } from "../../../../lib/server/storage";
import { readAiGraderPublicNfcRegistration } from "../../../../lib/server/aiGraderNfcPublic";

export default createAiGraderPublicReportApiHandler({
  readPresentation: readAiGraderPublicReportPresentation,
  readPublishedBundle: readAiGraderPublishedBundle,
  readNfcRegistration: readAiGraderPublicNfcRegistration,
  readEnrichment: readAiGraderPublicReportEnrichment,
  publicUrlFor,
});
