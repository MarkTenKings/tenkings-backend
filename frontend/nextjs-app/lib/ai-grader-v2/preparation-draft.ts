import { z } from "zod";
import { parseSpeedsterColorGeometryProposal, parseSpeedsterPhysicalGeometryLearning, type SpeedsterColorGeometryProposal, type SpeedsterMatColor, type SpeedsterPhysicalGeometryLearning } from "./color-geometry";
import { sanitizeSpeedsterUnitQuad } from "./geometry";
import type { SpeedsterCardSide, SpeedsterQuad } from "./contracts";
import type { SpeedsterPreparationExpectedHead } from "./preparation";

export type SpeedsterPreparationRequestDraft = { idempotencyKey: string; expectedHead: SpeedsterPreparationExpectedHead };
export type SpeedsterPreparationPhotoDraft = {
  originalStorageKey: string; corners: SpeedsterQuad | null; matColor: SpeedsterMatColor;
  physicalColorGeometry: SpeedsterColorGeometryProposal; physicalColorGeometryReceipt: string;
  physicalGeometryLearning?: SpeedsterPhysicalGeometryLearning;
};
export type SpeedsterPreparationDraft = {
  version: "speedster-preparation-draft-v1"; sessionId: string; cornerShape: "SQUARE" | "ROUNDED_3_18_MM";
  sides: Record<SpeedsterCardSide, { photo: SpeedsterPreparationPhotoDraft; request?: SpeedsterPreparationRequestDraft }>;
};
const uuid = z.string().uuid();
const request = z.object({ idempotencyKey: uuid, expectedHead: z.object({ sideRevision: z.number().int().nonnegative(), attemptId: uuid.nullable() }).strict() }).strict();
const photo = z.object({ originalStorageKey: z.string().max(500), corners: z.unknown(), matColor: z.enum(["BLACK", "WHITE", "MAGENTA"]),
  physicalColorGeometry: z.unknown(), physicalColorGeometryReceipt: z.string().min(20).max(16_384), physicalGeometryLearning: z.unknown().optional() }).strict();
const side = z.object({ photo, request: request.optional() }).strict();
const schema = z.object({ version: z.literal("speedster-preparation-draft-v1"), sessionId: z.string(), cornerShape: z.enum(["SQUARE", "ROUNDED_3_18_MM"]), sides: z.object({ FRONT: side, BACK: side }).strict() }).strict();

export const speedsterPreparationDraftKey = (sessionId: string) => `tenkings:speedster:preparation-draft:v1:${sessionId}`;
export function parseSpeedsterPreparationDraft(serialized: string, sessionId: string): SpeedsterPreparationDraft {
  if (new TextEncoder().encode(serialized).byteLength > 512 * 1024) throw new Error("Saved preparation exceeds the size limit.");
  const value = schema.parse(JSON.parse(serialized));
  if (value.sessionId !== sessionId) throw new Error("Saved preparation belongs to a different session.");
  for (const name of ["FRONT", "BACK"] as const) {
    const entry = value.sides[name].photo;
    if (!entry.originalStorageKey.startsWith("ai-grader-v2/") || !entry.originalStorageKey.includes(`/${sessionId}/original/`)
      || !entry.originalStorageKey.endsWith(`/${name.toLowerCase()}.${entry.originalStorageKey.split(".").pop()}`)
      || !/\.(jpg|png|webp)$/.test(entry.originalStorageKey) || /[?#\\]|\.\./.test(entry.originalStorageKey)) throw new Error("Saved preparation source is invalid.");
    const corners = entry.corners === null ? null : sanitizeSpeedsterUnitQuad(entry.corners);
    if (entry.corners !== null && !corners) throw new Error("Saved physical corners are invalid.");
    entry.corners = corners;
    entry.physicalColorGeometry = parseSpeedsterColorGeometryProposal(entry.physicalColorGeometry, { mode: "PHYSICAL_OUTER", matColor: entry.matColor });
    if (entry.physicalGeometryLearning !== undefined) {
      const learning = parseSpeedsterPhysicalGeometryLearning(entry.physicalGeometryLearning, { targetSessionId: sessionId, side: name });
      if (!learning?.usedLesson) throw new Error("Saved physical geometry learning is invalid.");
      entry.physicalGeometryLearning = learning;
    }
  }
  return value as SpeedsterPreparationDraft;
}

/** Persist synchronously before dispatch. Failure must stop the request. */
export function writeSpeedsterPreparationDraft(storage: Pick<Storage, "getItem" | "setItem">, draft: SpeedsterPreparationDraft): void {
  const serialized = JSON.stringify(draft);
  parseSpeedsterPreparationDraft(serialized, draft.sessionId);
  const key = speedsterPreparationDraftKey(draft.sessionId);
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("Preparation could not be preserved before dispatch.");
}
