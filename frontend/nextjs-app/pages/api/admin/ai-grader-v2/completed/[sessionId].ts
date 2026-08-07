import type { NextApiRequest, NextApiResponse } from "next";
import {
  prisma,
  resyncIdentityFromSpeedster,
  voidCard,
} from "@tenkings/database";
import { z } from "zod";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import { getStorageMode, presignReadUrl, presignUploadUrl } from "../../../../../lib/server/storage";

const SESSION_ID = /^[a-z0-9-]{20,40}$/i;
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SLAB_PLAN"),
    side: z.enum(["FRONT", "BACK"]),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  }).strict(),
  z.object({
    action: z.literal("SLAB_COMPLETE"),
    side: z.enum(["FRONT", "BACK"]),
    storageKey: z.string().min(1).max(500),
  }).strict(),
  z.object({
    action: z.literal("RESYNC_IDENTITY"),
  }).strict(),
  z.object({
    action: z.literal("VOID_CARD"),
    reason: z.string().trim().min(1).max(500),
  }).strict(),
]);

type PermanentCard = {
  id: string;
  publicToken: string;
  lifecycleState: string;
  nfcVerifiedAt: Date | null;
};

type CompletedSession = {
  id: string;
  createdByUserId: string;
  workflowState: string;
  publicReportSlug: string | null;
  slabFrontKey: string | null;
  slabBackKey: string | null;
  collectibleCardV2: PermanentCard | null;
};
type Label = { certificateNumber: string | null; slot: number; sheet: { sheetNumber: number } } | null;
type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findSession: (id: string) => Promise<CompletedSession | null>;
  findLabel: (id: string) => Promise<Label>;
  updateSlabKey: (id: string, side: "FRONT" | "BACK", storageKey: string) => Promise<CompletedSession>;
  resyncCard: (cardId: string, adminId: string) => Promise<void>;
  voidCard: (cardId: string, reason: string, adminId: string) => Promise<void>;
  logAdminAction: (entry: {
    action: "RESYNC_IDENTITY" | "VOID_CARD";
    adminId: string;
    cardId: string;
    reason: string;
  }) => void;
  presignUpload: typeof presignUploadUrl;
  presignRead: typeof presignReadUrl;
  storageReady: () => boolean;
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && SESSION_ID.test(value) ? value : null;
};

const slabKey = (session: CompletedSession, side: "FRONT" | "BACK", extension: string) =>
  `ai-grader-v2/${session.createdByUserId}/${session.id}/slab/${side.toLowerCase()}.${extension}`;

const publicState = async (session: CompletedSession, label: Label, presignRead: typeof presignReadUrl) => ({
  id: session.id,
  publicReportSlug: session.publicReportSlug,
  certificateNumber: label?.certificateNumber ?? null,
  labelSheetNumber: label?.sheet.sheetNumber ?? null,
  labelSlot: label?.slot ?? null,
  slabPhotos: {
    front: session.slabFrontKey ? await presignRead(session.slabFrontKey, 60 * 60) : null,
    back: session.slabBackKey ? await presignRead(session.slabBackKey, 60 * 60) : null,
  },
  status: { slabPhotosDone: Boolean(session.slabFrontKey && session.slabBackKey) },
  permanentCard: session.collectibleCardV2 ? {
    id: session.collectibleCardV2.id,
    publicToken: session.collectibleCardV2.publicToken,
    lifecycleState: session.collectibleCardV2.lifecycleState,
    nfcVerifiedAt: session.collectibleCardV2.nfcVerifiedAt?.toISOString() ?? null,
  } : null,
});

const dependencies: Dependencies = {
  requireAdminSession,
  findSession: (id) => prisma.aiGraderV2Session.findUnique({
    where: { id },
    select: {
      id: true,
      createdByUserId: true,
      workflowState: true,
      publicReportSlug: true,
      slabFrontKey: true,
      slabBackKey: true,
      collectibleCardV2: {
        select: { id: true, publicToken: true, lifecycleState: true, nfcVerifiedAt: true },
      },
    },
  }),
  findLabel: (id) => prisma.humanGradeLabel.findUnique({
    where: { sourceSessionId: id },
    select: { certificateNumber: true, slot: true, sheet: { select: { sheetNumber: true } } },
  }),
  updateSlabKey: (id, side, storageKey) => prisma.aiGraderV2Session.update({
    where: { id },
    data: side === "FRONT" ? { slabFrontKey: storageKey } : { slabBackKey: storageKey },
    select: {
      id: true,
      createdByUserId: true,
      workflowState: true,
      publicReportSlug: true,
      slabFrontKey: true,
      slabBackKey: true,
      collectibleCardV2: {
        select: { id: true, publicToken: true, lifecycleState: true, nfcVerifiedAt: true },
      },
    },
  }),
  resyncCard: async (cardId, adminId) => {
    await prisma.$transaction((tx) => resyncIdentityFromSpeedster(tx, cardId, adminId));
  },
  voidCard: async (cardId, reason, adminId) => {
    await prisma.$transaction((tx) => voidCard(tx, cardId, reason, adminId));
  },
  logAdminAction: (entry) => console.info("[TenKingsV2] admin_card_action", entry),
  presignUpload: presignUploadUrl,
  presignRead: presignReadUrl,
  storageReady: () => getStorageMode() === "s3",
};

export function createCompletedCardHandler(deps: Dependencies = dependencies) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== "GET" && req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ message: "Method not allowed" });
    }
    try {
      const adminSession = await deps.requireAdminSession(req);
      const sessionId = sessionIdFrom(req);
      if (!sessionId) return res.status(400).json({ message: "Invalid Speedster session ID" });
      const session = await deps.findSession(sessionId);
      if (!session || session.workflowState !== "COMPLETED" || !session.publicReportSlug) {
        return res.status(404).json({ message: "Completed Speedster card not found" });
      }
      const label = await deps.findLabel(sessionId);
      if (req.method === "GET") {
        return res.status(200).json({ card: await publicState(session, label, deps.presignRead) });
      }

      const parsed = actionSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ message: "Invalid post-grading action" });
      if (parsed.data.action === "RESYNC_IDENTITY" || parsed.data.action === "VOID_CARD") {
        const permanentCard = session.collectibleCardV2;
        if (!permanentCard) {
          return res.status(409).json({ message: "This completed grade does not have a permanent V2 card" });
        }
        const reason = parsed.data.action === "VOID_CARD"
          ? parsed.data.reason
          : "Re-synced from authoritative Speedster session";
        if (parsed.data.action === "VOID_CARD") {
          await deps.voidCard(permanentCard.id, reason, adminSession.user.id);
        } else {
          await deps.resyncCard(permanentCard.id, adminSession.user.id);
        }
        deps.logAdminAction({
          action: parsed.data.action,
          adminId: adminSession.user.id,
          cardId: permanentCard.id,
          reason,
        });
        const updated = await deps.findSession(session.id);
        if (!updated) throw new Error("Updated permanent V2 card could not be loaded");
        return res.status(200).json({ card: await publicState(updated, label, deps.presignRead) });
      }
      if (!deps.storageReady()) throw new Error("Speedster slab photos require configured object storage");

      if (parsed.data.action === "SLAB_PLAN") {
        const storageKey = slabKey(session, parsed.data.side, EXTENSIONS[parsed.data.contentType]);
        return res.status(200).json({
          storageKey,
          uploadUrl: await deps.presignUpload(storageKey, parsed.data.contentType),
        });
      }

      const completedAction = parsed.data;
      const expectedPrefix = slabKey(session, completedAction.side, "").slice(0, -1);
      const completedStorageKey = completedAction.storageKey;
      if (!Object.values(EXTENSIONS).some((extension) => completedStorageKey === `${expectedPrefix}.${extension}`)) {
        return res.status(400).json({ message: "Slab photo does not match this card and side" });
      }
      const updated = await deps.updateSlabKey(session.id, completedAction.side, completedStorageKey);
      return res.status(200).json({ card: await publicState(updated, label, deps.presignRead) });
    } catch (error) {
      const response = toErrorResponse(error);
      return res.status(response.status).json({ message: response.message });
    }
  };
}

export default createCompletedCardHandler();
