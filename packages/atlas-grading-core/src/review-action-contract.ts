import { z } from "zod";

const FINDING_ID = z.string().trim().min(1).max(180);
const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
const defectType = z.enum([
  "FAINT_COLOR_VARIATION",
  "VISIBLE_WHITENING",
  "FRAYING",
  "CHIPPING_EXPOSED_STOCK",
  "LIFTING_DEFORMATION",
  "LIGHT_SCRATCH_SCUFF",
  "VISIBLE_SCRATCH_PRINT_COATING_LOSS",
  "DENT_MATERIAL_DAMAGE",
  "PEELING_HEAVY_DAMAGE",
]);
const traceWire = z.object({
  format: z.literal("TK_SPEEDSTER_TRACE_BITMAP_WIRE_V1"),
  width: z.literal(1270),
  height: z.literal(1778),
  origin: z.literal("TOP_LEFT"),
  order: z.literal("ROW_MAJOR_Y_X"),
  bitOrder: z.literal("MSB_FIRST"),
  byteLength: z.literal(282258),
  dataBase64: z.string().length(376344),
  rleSha256: SHA256,
}).strict();
const traceProvenance = z.object({
  version: z.literal("speedster-trace-provenance-v1"),
  sourceViewId: z.string().trim().min(1).max(180),
  cropTransform: z.object({
    version: z.literal("speedster-canonical-crop-affine-v1"),
    crop: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().finite(),
      height: z.number().finite(),
    }).strict(),
  }).strict(),
  highlighterStrokes: z.array(z.object({
    canonicalPoints: z.array(z.object({
      x: z.number().int().min(0).max(1269),
      y: z.number().int().min(0).max(1777),
    }).strict()).min(1),
    strokeWidthMm: z.number().finite().positive(),
  }).strict()),
  finalTraceSha256: SHA256,
}).strict();
const traceEdit = z.object({ traceWire, traceProvenance }).strict();
const action = z.union([
  z.object({ type: z.literal("INITIALIZE") }).strict(),
  z.object({
    type: z.literal("TRACE_SAVE"),
    side: z.enum(["FRONT", "BACK"]),
    findingId: FINDING_ID,
    trace: traceEdit,
  }).strict(),
  z.object({
    type: z.literal("TRACE_SAVE"),
    side: z.enum(["FRONT", "BACK"]),
    findingId: z.null(),
    trace: traceEdit.extend({
      id: FINDING_ID,
      defectType,
      sourceViewId: z.string().trim().min(1).max(180),
    }).strict(),
  }).strict(),
  z.object({ type: z.literal("REMOVE"), defectIds: z.array(FINDING_ID).min(1) }).strict(),
  z.object({ type: z.literal("UNDO"), defectIds: z.array(FINDING_ID).min(1) }).strict(),
  z.object({ type: z.literal("CHANGE_TYPE"), defectId: FINDING_ID, defectType }).strict(),
]);
export const speedsterReviewPostSchema = z.object({ action }).strict();

export type SpeedsterReviewWireAction = z.infer<typeof speedsterReviewPostSchema>["action"];
