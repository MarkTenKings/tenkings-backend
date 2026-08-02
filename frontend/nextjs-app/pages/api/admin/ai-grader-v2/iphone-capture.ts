import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { z } from "zod";
import {
  speedsterIphonePairingUrl,
  speedsterIphoneStorageKey,
} from "../../../../lib/server/aiGraderV2IphoneCapture";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";
import { presignReadUrl } from "../../../../lib/server/storage";

const sessionIdSchema = z.string().min(20).max(80);
const activateSchema = z.object({ sessionId: sessionIdSchema }).strict();

type SessionRecord = {
  id: string;
  createdByUserId: string;
  workflowState: string;
};

type DeviceRecord = {
  id: string;
  createdByUserId: string;
  activeSessionId: string | null;
  uploadVersion: number;
  readyVersion: number;
};

type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findSession: (id: string) => Promise<SessionRecord | null>;
  findDevice: (userId: string) => Promise<DeviceRecord | null>;
  createDevice: (userId: string, sessionId: string) => Promise<DeviceRecord>;
  activateDevice: (id: string, sessionId: string) => Promise<DeviceRecord>;
  presignReadUrl: (storageKey: string) => Promise<string>;
};

const dependencies: Dependencies = {
  requireAdminSession,
  findSession: (id) => prisma.aiGraderV2Session.findUnique({
    where: { id },
    select: { id: true, createdByUserId: true, workflowState: true },
  }),
  findDevice: (userId) => prisma.aiGraderV2CaptureDevice.findUnique({
    where: { createdByUserId: userId },
  }),
  createDevice: (createdByUserId, activeSessionId) => prisma.aiGraderV2CaptureDevice.create({
    data: { createdByUserId, activeSessionId },
  }),
  activateDevice: (id, activeSessionId) => prisma.aiGraderV2CaptureDevice.update({
    where: { id },
    data: { activeSessionId, uploadVersion: 0, readyVersion: 0 },
  }),
  presignReadUrl,
};

function validDraft(session: SessionRecord | null, userId: string) {
  return session?.createdByUserId === userId && session.workflowState === "DRAFT";
}

export function createAiGraderV2AdminIphoneCaptureHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "POST" && req.method !== "GET") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ message: "Method not allowed" });
    }

    try {
      const admin = await deps.requireAdminSession(req);
      const sessionId = req.method === "POST"
        ? activateSchema.safeParse(req.body ?? {})
        : sessionIdSchema.safeParse(req.query.sessionId);
      if (!sessionId.success) {
        return res.status(400).json({ message: "Invalid Speedster session ID" });
      }
      const activeSessionId = typeof sessionId.data === "string"
        ? sessionId.data
        : sessionId.data.sessionId;
      const session = await deps.findSession(activeSessionId);
      if (!validDraft(session, admin.user.id)) {
        return res.status(404).json({ message: "Speedster draft not found" });
      }

      let device = await deps.findDevice(admin.user.id);
      if (req.method === "POST") {
        device = device
          ? device.activeSessionId === activeSessionId
            ? device
            : await deps.activateDevice(device.id, activeSessionId)
          : await deps.createDevice(admin.user.id, activeSessionId);
        return res.status(200).json({
          deviceId: device.id,
          pairingUrl: speedsterIphonePairingUrl(device.id),
          readyVersion: device.readyVersion,
        });
      }

      res.setHeader("Cache-Control", "no-store");
      if (!device || device.activeSessionId !== activeSessionId || device.readyVersion < 1) {
        return res.status(200).json({ readyVersion: 0 });
      }
      const frontStorageKey = speedsterIphoneStorageKey(admin.user.id, activeSessionId, "FRONT");
      const backStorageKey = speedsterIphoneStorageKey(admin.user.id, activeSessionId, "BACK");
      const [frontReadUrl, backReadUrl] = await Promise.all([
        deps.presignReadUrl(frontStorageKey),
        deps.presignReadUrl(backStorageKey),
      ]);
      return res.status(200).json({
        readyVersion: device.readyVersion,
        front: { storageKey: frontStorageKey, readUrl: frontReadUrl },
        back: { storageKey: backStorageKey, readUrl: backReadUrl },
      });
    } catch (error) {
      const mapped = toErrorResponse(error);
      return res.status(mapped.status).json({ message: mapped.message });
    }
  };
}

export default createAiGraderV2AdminIphoneCaptureHandler();
