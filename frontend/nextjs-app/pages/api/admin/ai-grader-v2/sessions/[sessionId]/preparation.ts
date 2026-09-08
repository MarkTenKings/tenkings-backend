import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../../../lib/server/admin";
import { createPrismaSpeedsterPreparationStore } from "../../../../../../lib/server/speedsterPreparationStore";
import { readSpeedsterPreparationStatus } from "../../../../../../lib/server/speedsterPreparationService";
import { SpeedsterPreparationConflict } from "../../../../../../lib/server/speedsterPreparationIntegrity";
import { presignReadUrl } from "../../../../../../lib/server/storage";

const defaults = { requireAdminSession, read: (sessionId: string, createdByUserId: string) => readSpeedsterPreparationStatus(
  { sessionId, createdByUserId }, { store: createPrismaSpeedsterPreparationStore(), readUrl: presignReadUrl }),
};
type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  read: typeof defaults.read;
};
export function createSpeedsterPreparationStatusHandler(deps: Dependencies = defaults) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ message: "Method not allowed" }); }
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = req.query.sessionId;
      if (typeof sessionId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(sessionId)) return res.status(400).json({ message: "Session ID is invalid" });
      return res.status(200).json(await deps.read(sessionId, admin.user.id));
    } catch (error) {
      if (error instanceof SpeedsterPreparationConflict) return res.status(409).json({ message: error.message });
      const mapped = toErrorResponse(error);
      return res.status(mapped.status).json({ message: mapped.message });
    }
  };
}
export default createSpeedsterPreparationStatusHandler();
