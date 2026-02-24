import { Prisma, prisma } from "@tenkings/database";

export type OcrRegionPhotoSide = "FRONT" | "BACK" | "TILT";

export type OcrRegionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string | null;
  targetField?: string | null;
  targetValue?: string | null;
  note?: string | null;
};

export type OcrRegionTemplateInput = {
  photoSide: OcrRegionPhotoSide;
  regions: OcrRegionRect[];
};

const OCR_REGION_PHOTO_SIDES: OcrRegionPhotoSide[] = ["FRONT", "BACK", "TILT"];

function coerceNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeTextKey(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeOcrRegionLayoutClass(value: string | null | undefined): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "base";
}

export function normalizeOcrRegionPhotoSide(value: string | null | undefined): OcrRegionPhotoSide | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "front") {
    return "FRONT";
  }
  if (normalized === "back") {
    return "BACK";
  }
  if (normalized === "tilt") {
    return "TILT";
  }
  return null;
}

function clamp01(value: unknown): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (parsed <= 0) {
    return 0;
  }
  if (parsed >= 1) {
    return 1;
  }
  return Number(parsed.toFixed(6));
}

function parseLabel(value: unknown): string | null {
  const cleaned = coerceNullableString(value);
  return cleaned ? cleaned.slice(0, 120) : null;
}

function parseTargetField(value: unknown): string | null {
  const cleaned = coerceNullableString(value);
  if (!cleaned) {
    return null;
  }
  const normalized = cleaned.replace(/[^a-zA-Z0-9_]+/g, "").slice(0, 48);
  return normalized || null;
}

function parseTargetValue(value: unknown): string | null {
  const cleaned = coerceNullableString(value);
  return cleaned ? cleaned.slice(0, 160) : null;
}

function parseRegionNote(value: unknown): string | null {
  const cleaned = coerceNullableString(value);
  return cleaned ? cleaned.slice(0, 280) : null;
}

export function sanitizeOcrRegionRects(raw: unknown): OcrRegionRect[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const parsed: OcrRegionRect[] = [];
  raw.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const x = clamp01(record.x);
    const y = clamp01(record.y);
    const width = clamp01(record.width);
    const height = clamp01(record.height);
    if (width < 0.01 || height < 0.01) {
      return;
    }
    if (x + width > 1.001 || y + height > 1.001) {
      return;
    }
    parsed.push({
      x,
      y,
      width,
      height,
      label: parseLabel(record.label),
      targetField: parseTargetField(record.targetField),
      targetValue: parseTargetValue(record.targetValue),
      note: parseRegionNote(record.note),
    });
  });
  return parsed.slice(0, 24);
}

function buildTemplatesBySide(
  rows: Array<{ photoSide: string; regionsJson: unknown }>
): Record<OcrRegionPhotoSide, OcrRegionRect[]> {
  const output: Record<OcrRegionPhotoSide, OcrRegionRect[]> = {
    FRONT: [],
    BACK: [],
    TILT: [],
  };
  rows.forEach((row) => {
    const side = normalizeOcrRegionPhotoSide(row.photoSide);
    if (!side) {
      return;
    }
    output[side] = sanitizeOcrRegionRects(row.regionsJson);
  });
  return output;
}

export async function listOcrRegionTemplates(params: {
  setId: string | null | undefined;
  layoutClass: string | null | undefined;
}) {
  const setId = coerceNullableString(params.setId);
  if (!setId) {
    return {
      setId: null,
      layoutClass: normalizeOcrRegionLayoutClass(params.layoutClass),
      templatesBySide: {
        FRONT: [],
        BACK: [],
        TILT: [],
      } as Record<OcrRegionPhotoSide, OcrRegionRect[]>,
      sampleCountBySide: {
        FRONT: 0,
        BACK: 0,
        TILT: 0,
      } as Record<OcrRegionPhotoSide, number>,
    };
  }

  const setIdKey = normalizeTextKey(setId);
  const layoutClass = normalizeOcrRegionLayoutClass(params.layoutClass);
  const layoutClassKey = normalizeTextKey(layoutClass);
  const rows = ((await (prisma as any).ocrRegionTemplate.findMany({
    where: {
      setIdKey,
      layoutClassKey,
      photoSideKey: { in: OCR_REGION_PHOTO_SIDES.map((side) => side.toLowerCase()) },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      photoSide: true,
      regionsJson: true,
      sampleCount: true,
    },
  })) as Array<{ photoSide: string; regionsJson: unknown; sampleCount: number }>) || [];

  const templatesBySide = buildTemplatesBySide(rows);
  const sampleCountBySide: Record<OcrRegionPhotoSide, number> = {
    FRONT: 0,
    BACK: 0,
    TILT: 0,
  };
  rows.forEach((row) => {
    const side = normalizeOcrRegionPhotoSide(row.photoSide);
    if (!side) {
      return;
    }
    sampleCountBySide[side] = Math.max(sampleCountBySide[side], Number(row.sampleCount || 0));
  });

  return {
    setId,
    layoutClass,
    templatesBySide,
    sampleCountBySide,
  };
}

export async function upsertOcrRegionTemplates(params: {
  setId: string | null | undefined;
  layoutClass: string | null | undefined;
  templates: Array<{ photoSide: string; regions: unknown }>;
  createdById?: string | null;
}) {
  const setId = coerceNullableString(params.setId);
  if (!setId) {
    throw new Error("setId is required");
  }
  const layoutClass = normalizeOcrRegionLayoutClass(params.layoutClass);
  const setIdKey = normalizeTextKey(setId);
  const layoutClassKey = normalizeTextKey(layoutClass);
  const now = new Date();
  let updatedCount = 0;

  for (const template of params.templates) {
    const photoSide = normalizeOcrRegionPhotoSide(template.photoSide);
    if (!photoSide) {
      continue;
    }
    const regions = sanitizeOcrRegionRects(template.regions);
    if (!regions.length) {
      continue;
    }
    const photoSideKey = photoSide.toLowerCase();
    const existing = await (prisma as any).ocrRegionTemplate.findFirst({
      where: {
        setIdKey,
        layoutClassKey,
        photoSideKey,
      },
      select: {
        id: true,
        sampleCount: true,
      },
    });
    if (existing?.id) {
      await (prisma as any).ocrRegionTemplate.update({
        where: { id: existing.id },
        data: {
          setId,
          layoutClass,
          photoSide,
          regionsJson: regions as Prisma.InputJsonValue,
          sampleCount: Math.max(1, Number(existing.sampleCount || 0)) + 1,
          createdById: params.createdById ?? undefined,
          updatedAt: now,
        },
      });
      updatedCount += 1;
      continue;
    }
    await (prisma as any).ocrRegionTemplate.create({
      data: {
        setId,
        setIdKey,
        layoutClass,
        layoutClassKey,
        photoSide,
        photoSideKey,
        regionsJson: regions as Prisma.InputJsonValue,
        sampleCount: 1,
        createdById: params.createdById ?? undefined,
      },
    });
    updatedCount += 1;
  }

  return listOcrRegionTemplates({ setId, layoutClass }).then((result) => ({
    ...result,
    updatedCount,
  }));
}
