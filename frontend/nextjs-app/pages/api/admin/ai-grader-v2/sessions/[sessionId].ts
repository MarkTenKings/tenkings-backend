import type { NextApiRequest, NextApiResponse } from "next";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { SpeedsterMapIntegrityError } from "../../../../../lib/server/speedsterCardTypeMaps";
import { SpeedsterPreparationConflict } from "../../../../../lib/server/speedsterPreparationIntegrity";
import {
  patchSchema, safeSessionResponse, validateCaptureUpdate, savePreparedSpeedsterSessionCapture,
  SpeedsterColorGeometryCaptureReceiptExpiredError, speedsterSessionCaptureDependencies,
  type SpeedsterSessionCaptureDependencies,
} from "../../../../../lib/server/speedsterSessionCapture";
// Preserve existing import paths for reviewed callers while business code lives
// behind a server-only interface reusable by the scoped ATLAS source adapter.
export {
  patchSchema, safeSessionResponse, validateCaptureUpdate, savePreparedSpeedsterSessionCapture,
  validateSpeedsterSubmittedMapBinding, persistPreparedSpeedsterCaptureTransaction,
  parseSpeedsterColorGeometryCaptureRows, SpeedsterColorGeometryCaptureReceiptExpiredError,
  speedsterSessionCaptureDependencies,
} from "../../../../../lib/server/speedsterSessionCapture";
export type {
  PersistedSession, MapBindingInput, SpeedsterSessionCaptureDependencies,
} from "../../../../../lib/server/speedsterSessionCapture";

type Dependencies = SpeedsterSessionCaptureDependencies & {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
};
const dependencies: Dependencies = { ...speedsterSessionCaptureDependencies, requireAdminSession };

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};


export function createAiGraderV2SessionHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET" && req.method !== "PATCH") {
      res.setHeader("Allow", "GET, PATCH");
      return res.status(405).json({ message: "Method not allowed" });
    }

    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Session ID is required" });

      const existing = await deps.findSession(sessionId, admin.user.id);
      if (!existing) return res.status(404).json({ message: "Speedster session not found" });

      if (req.method === "GET") {
        return res.status(200).json({ session: safeSessionResponse(existing) });
      }

      const parsed = patchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid Speedster session update" });
      }
      if (existing.workflowState !== "DRAFT") {
        return res.status(409).json({ message: "Only a DRAFT Speedster session can save its capture" });
      }
      if (deps.preparationStore) {
        const session = await savePreparedSpeedsterSessionCapture(deps, { sessionId, createdByUserId: admin.user.id }, parsed.data.capture, parsed.data.mapBinding);
        return res.status(200).json({ session: session ? safeSessionResponse(session) : null });
      }
      const validated = await validateCaptureUpdate(deps, existing, parsed.data.capture, parsed.data.mapBinding);
      const session = await deps.updateSession(sessionId, admin.user.id, validated.data, validated.colorGeometryEvidence, existing.updatedAt);
      if (!session) {
        return res.status(409).json({ message: "Speedster capture state changed before it could be saved" });
      }
      try {
        await deps.recordInstrumentation?.([validated.event]);
      } catch (error) {
        console.error(`[Speedster] Card-map instrumentation failed for ${sessionId}:`, error);
      }
      return res.status(200).json({ session: safeSessionResponse(session) });
    } catch (error) {
      if (error instanceof SpeedsterColorGeometryCaptureReceiptExpiredError) {
        return res.status(409).json({
          message: error.message,
          colorGeometryReceiptExpired: {
            side: error.side,
            mode: error.mode,
          },
        });
      }
      if (error instanceof SpeedsterMapIntegrityError || error instanceof SpeedsterPreparationConflict) {
        return res.status(409).json({ message: error.message });
      }
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createAiGraderV2SessionHandler();
