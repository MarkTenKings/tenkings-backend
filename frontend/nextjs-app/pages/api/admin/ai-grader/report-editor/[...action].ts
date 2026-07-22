import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession } from "../../../../../lib/server/admin";
import {
  createAiGraderReportEditorApiHandler,
  createAiGraderReportEditorService,
} from "../../../../../lib/server/aiGraderReportEditor";
import {
  publicUrlFor,
  readStorageBuffer,
} from "../../../../../lib/server/storage";

export const config = {
  maxDuration: 20,
  api: {
    bodyParser: {
      sizeLimit: "64kb",
    },
  },
};

const runtime = createAiGraderReportEditorApiHandler({
  requireAdminSession,
  service: createAiGraderReportEditorService({
    db: prisma as any,
    readBundleBytes: (storageKey) => readStorageBuffer(storageKey),
    publicUrlFor,
  }),
});

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return runtime(req, res);
}
