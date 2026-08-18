import type { NextApiRequest, NextApiResponse } from "next";
import {
  correctCompletedSpeedsterIdentity,
  prisma,
  type CompletedSpeedsterIdentityInput,
  type Prisma,
  voidCard,
} from "@tenkings/database";
import { z } from "zod";
import {
  SpeedsterIdentityValidationError,
  canonicalizeSpeedsterSessionIdentity,
  type SpeedsterCardProfile,
  type SpeedsterSessionIdentity,
} from "../../../../../lib/ai-grader-v2/identity";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  AI_GRADER_STORAGE_MAX_OBJECT_BYTES,
  getStorageMode,
  presignPrivateSpeedsterUploadUrl,
  presignReadUrl,
  sha256HexToBase64,
  verifyStorageObjectIntegrity,
} from "../../../../../lib/server/storage";

const SESSION_ID = /^[a-z0-9-]{20,40}$/i;
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SLAB_PLAN"),
    side: z.enum(["FRONT", "BACK"]),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteSize: z.number().int().positive().max(AI_GRADER_STORAGE_MAX_OBJECT_BYTES),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  z.object({
    action: z.literal("SLAB_COMPLETE"),
    side: z.enum(["FRONT", "BACK"]),
    storageKey: z.string().min(1).max(500),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteSize: z.number().int().positive().max(AI_GRADER_STORAGE_MAX_OBJECT_BYTES),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  z.object({
    action: z.literal("UPDATE_IDENTITY"),
    identity: z.unknown(),
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
  cardProfile: string;
  workflowState: string;
  publicReportSlug: string | null;
  identity: Prisma.JsonValue;
  slabFrontKey: string | null;
  slabBackKey: string | null;
  collectibleCardV2: PermanentCard | null;
};
type DecimalText = { toString(): string };
type Label = {
  id: string;
  source: "HUMAN" | "SPEEDSTER";
  sourceSessionId: string | null;
  certificateNumber: string | null;
  gradingFormulaVersion: "LEGACY_30_25_25_20" | "EQUAL_25";
  cardType: "SPORTS" | "POKEMON";
  playerName: string | null;
  cardName: string | null;
  year: string;
  manufacturer: string | null;
  productSet: string;
  parallel: string | null;
  insert: string | null;
  cardNumber: string | null;
  centeringGrade: DecimalText;
  cornersGrade: DecimalText;
  edgesGrade: DecimalText;
  surfaceGrade: DecimalText;
  grade: DecimalText;
  slot: number;
  sheet: { sheetNumber: number };
} | null;
type Dependencies = {
  requireAdminSession: (req: NextApiRequest) => Promise<{ user: { id: string } }>;
  findSession: (id: string) => Promise<CompletedSession | null>;
  findLabel: (id: string) => Promise<Label>;
  updateSlabKey: (id: string, side: "FRONT" | "BACK", storageKey: string) => Promise<CompletedSession>;
  correctIdentity: (
    sessionId: string,
    identity: SpeedsterSessionIdentity,
    adminId: string,
  ) => Promise<void>;
  voidCard: (cardId: string, reason: string, adminId: string) => Promise<void>;
  logAdminAction: (entry: {
    action: "UPDATE_IDENTITY" | "VOID_CARD";
    adminId: string;
    cardId: string | null;
    sessionId: string;
    reason: string;
  }) => void;
  presignUpload: (input: {
    storageKey: string;
    contentType: string;
    checksumSha256: string;
  }) => Promise<string>;
  presignRead: typeof presignReadUrl;
  verifyObject?: typeof verifyStorageObjectIntegrity;
  storageReady: () => boolean;
};

const sessionIdFrom = (req: NextApiRequest) => {
  const value = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
  return typeof value === "string" && SESSION_ID.test(value) ? value : null;
};

const slabKey = (
  session: CompletedSession,
  side: "FRONT" | "BACK",
  extension: string,
  checksumSha256: string,
) => `ai-grader-v2/${session.createdByUserId}/${session.id}/slab/${side.toLowerCase()}/sha256-${checksumSha256}.${extension}`;

const identityRecord = (value: Prisma.JsonValue): Record<string, Prisma.JsonValue> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
const identityText = (value: Prisma.JsonValue | undefined) => typeof value === "string" ? value : null;

const authoritativeIdentity = (session: CompletedSession) => {
  const identity = identityRecord(session.identity);
  return session.cardProfile === "SPORTS"
    ? {
        playerName: identityText(identity.playerName),
        year: identityText(identity.year),
        manufacturer: identityText(identity.manufacturer),
        productSet: identityText(identity.productSet),
        parallel: identityText(identity.parallel),
        insert: identityText(identity.insert),
        cardNumber: identityText(identity.cardNumber),
      }
    : {
        cardName: identityText(identity.cardName),
        layoutType: identityText(identity.layoutType),
        year: identityText(identity.year),
        productSet: identityText(identity.productSet),
        parallel: identityText(identity.parallel),
        cardNumber: identityText(identity.cardNumber),
      };
};

const publicState = async (session: CompletedSession, label: Label, presignRead: typeof presignReadUrl) => ({
  id: session.id,
  cardProfile: session.cardProfile,
  authoritativeIdentity: authoritativeIdentity(session),
  publicReportSlug: session.publicReportSlug,
  certificateNumber: label?.certificateNumber ?? null,
  labelSheetNumber: label?.sheet.sheetNumber ?? null,
  labelSlot: label?.slot ?? null,
  linkedLabel: label ? {
    id: label.id,
    source: label.source,
    certificateNumber: label.certificateNumber,
    gradingFormulaVersion: label.gradingFormulaVersion,
    cardType: label.cardType,
    playerName: label.playerName,
    cardName: label.cardName,
    year: label.year,
    manufacturer: label.manufacturer,
    productSet: label.productSet,
    parallel: label.parallel,
    insert: label.insert,
    cardNumber: label.cardNumber,
    centeringGrade: label.centeringGrade.toString(),
    cornersGrade: label.cornersGrade.toString(),
    edgesGrade: label.edgesGrade.toString(),
    surfaceGrade: label.surfaceGrade.toString(),
    grade: label.grade.toString(),
    sheetNumber: label.sheet.sheetNumber,
    slot: label.slot,
  } : null,
  labelPreviewPath: label?.source === "SPEEDSTER" && label.sourceSessionId === session.id
    ? `/api/admin/ai-grader-v2/completed/${encodeURIComponent(session.id)}/label`
    : null,
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
      cardProfile: true,
      workflowState: true,
      publicReportSlug: true,
      identity: true,
      slabFrontKey: true,
      slabBackKey: true,
      collectibleCardV2: {
        select: { id: true, publicToken: true, lifecycleState: true, nfcVerifiedAt: true },
      },
    },
  }),
  findLabel: (id) => prisma.humanGradeLabel.findUnique({
    where: { sourceSessionId: id },
    select: {
      id: true,
      source: true,
      sourceSessionId: true,
      certificateNumber: true,
      gradingFormulaVersion: true,
      cardType: true,
      playerName: true,
      cardName: true,
      year: true,
      manufacturer: true,
      productSet: true,
      parallel: true,
      insert: true,
      cardNumber: true,
      centeringGrade: true,
      cornersGrade: true,
      edgesGrade: true,
      surfaceGrade: true,
      grade: true,
      slot: true,
      sheet: { select: { sheetNumber: true } },
    },
  }),
  updateSlabKey: (id, side, storageKey) => prisma.aiGraderV2Session.update({
    where: { id },
    data: side === "FRONT" ? { slabFrontKey: storageKey } : { slabBackKey: storageKey },
    select: {
      id: true,
      createdByUserId: true,
      cardProfile: true,
      workflowState: true,
      publicReportSlug: true,
      identity: true,
      slabFrontKey: true,
      slabBackKey: true,
      collectibleCardV2: {
        select: { id: true, publicToken: true, lifecycleState: true, nfcVerifiedAt: true },
      },
    },
  }),
  correctIdentity: async (sessionId, identity, adminId) => {
    await prisma.$transaction((tx) => correctCompletedSpeedsterIdentity(
      tx,
      sessionId,
      identity as CompletedSpeedsterIdentityInput,
      adminId,
    ));
  },
  voidCard: async (cardId, reason, adminId) => {
    await prisma.$transaction((tx) => voidCard(tx, cardId, reason, adminId));
  },
  logAdminAction: (entry) => console.info("[TenKingsV2] admin_card_action", entry),
  presignUpload: (input) => presignPrivateSpeedsterUploadUrl({
    ...input,
    requireAclHeader: true,
  }),
  presignRead: presignReadUrl,
  verifyObject: verifyStorageObjectIntegrity,
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
      res.setHeader("Cache-Control", "private, no-store, max-age=0");
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
      if (parsed.data.action === "UPDATE_IDENTITY") {
        if (
          !label ||
          label.source !== "SPEEDSTER" ||
          label.sourceSessionId !== session.id ||
          !label.certificateNumber
        ) {
          return res.status(409).json({
            message: "Identity editing requires this completed card's exact issued Speedster label.",
          });
        }
        if (session.cardProfile !== "SPORTS" && session.cardProfile !== "POKEMON") {
          return res.status(409).json({ message: "This completed card has an unsupported category." });
        }
        let identity: SpeedsterSessionIdentity;
        try {
          identity = canonicalizeSpeedsterSessionIdentity(
            session.cardProfile as SpeedsterCardProfile,
            parsed.data.identity,
          );
        } catch (error) {
          if (error instanceof SpeedsterIdentityValidationError) {
            return res.status(400).json({ message: error.message, fields: error.fields });
          }
          throw error;
        }
        const storedIdentity = identityRecord(session.identity);
        const storedLayoutType = identityText(storedIdentity.layoutType);
        const submittedLayoutType = "cardName" in identity ? identity.layoutType ?? null : null;
        if (storedLayoutType !== submittedLayoutType) {
          return res.status(409).json({
            message: "Completed Pokémon layout type is immutable and must match the stored identity.",
          });
        }
        await deps.correctIdentity(session.id, identity, adminSession.user.id);
        deps.logAdminAction({
          action: "UPDATE_IDENTITY",
          adminId: adminSession.user.id,
          cardId: session.collectibleCardV2?.id ?? null,
          sessionId: session.id,
          reason: "Corrected authoritative Speedster identity",
        });
        const [updated, updatedLabel] = await Promise.all([
          deps.findSession(session.id),
          deps.findLabel(session.id),
        ]);
        if (!updated) throw new Error("Updated completed Speedster session could not be loaded");
        return res.status(200).json({ card: await publicState(updated, updatedLabel, deps.presignRead) });
      }
      if (parsed.data.action === "VOID_CARD") {
        const permanentCard = session.collectibleCardV2;
        if (!permanentCard) {
          return res.status(409).json({ message: "This completed grade does not have a permanent V2 card" });
        }
        const reason = parsed.data.reason;
        await deps.voidCard(permanentCard.id, reason, adminSession.user.id);
        deps.logAdminAction({
          action: parsed.data.action,
          adminId: adminSession.user.id,
          cardId: permanentCard.id,
          sessionId: session.id,
          reason,
        });
        const updated = await deps.findSession(session.id);
        if (!updated) throw new Error("Updated permanent V2 card could not be loaded");
        return res.status(200).json({ card: await publicState(updated, label, deps.presignRead) });
      }
      if (!deps.storageReady()) throw new Error("Speedster slab photos require configured object storage");

      if (parsed.data.action === "SLAB_PLAN") {
        const storageKey = slabKey(
          session,
          parsed.data.side,
          EXTENSIONS[parsed.data.contentType],
          parsed.data.checksumSha256,
        );
        return res.status(200).json({
          storageKey,
          uploadUrl: await deps.presignUpload({
            storageKey,
            contentType: parsed.data.contentType,
            checksumSha256: parsed.data.checksumSha256,
          }),
          uploadMethod: "PUT",
          uploadHeaders: {
            "Content-Type": parsed.data.contentType,
            "x-amz-acl": "private",
            "x-amz-checksum-sha256": sha256HexToBase64(parsed.data.checksumSha256),
          },
          byteSize: parsed.data.byteSize,
          checksumSha256: parsed.data.checksumSha256,
        });
      }

      const completedAction = parsed.data;
      const completedStorageKey = completedAction.storageKey;
      if (completedStorageKey !== slabKey(
        session,
        completedAction.side,
        EXTENSIONS[completedAction.contentType],
        completedAction.checksumSha256,
      )) {
        return res.status(400).json({ message: "Slab photo does not match this card and side" });
      }
      if (!deps.verifyObject) throw new Error("Speedster slab upload verification is unavailable");
      const integrity = await deps.verifyObject({
        storageKey: completedStorageKey,
        expectedByteSize: completedAction.byteSize,
        expectedChecksumSha256: completedAction.checksumSha256,
      });
      if (!integrity.ok
        || integrity.contentType?.trim().toLowerCase() !== completedAction.contentType.toLowerCase()) {
        return res.status(409).json({ message: "Slab photo did not match its exact upload plan" });
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
