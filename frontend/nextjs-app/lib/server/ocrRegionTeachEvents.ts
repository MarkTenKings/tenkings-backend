import { prisma } from "@tenkings/database";
import type { Prisma } from "@tenkings/database";
import {
  normalizeOcrRegionLayoutClass,
  normalizeOcrRegionPhotoSide,
} from "./ocrRegionTemplates";
import { normalizeStorageUrl, uploadBuffer } from "./storage";

export type OcrRegionTeachEventType = "TEMPLATE_SAVE" | "CLIENT_ERROR";

export type OcrRegionSnapshotInput = {
  photoSide: string;
  dataUrl: string;
  width?: number | null;
  height?: number | null;
  devicePixelRatio?: number | null;
};

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

function toFiniteInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.round(value));
}

function normalizeEventType(value: unknown): OcrRegionTeachEventType {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "CLIENT_ERROR") {
    return "CLIENT_ERROR";
  }
  return "TEMPLATE_SAVE";
}

function decodePngDataUrl(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) {
    return null;
  }
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
}

function sanitizeDebugPayload(payload: unknown): Prisma.InputJsonValue | null {
  if (payload == null) {
    return null;
  }
  if (typeof payload === "string") {
    return payload.slice(0, 8000);
  }
  if (typeof payload === "number" || typeof payload === "boolean") {
    return payload as Prisma.InputJsonValue;
  }
  if (Array.isArray(payload)) {
    return payload.slice(0, 80).map((entry) => sanitizeDebugPayload(entry)) as Prisma.InputJsonValue;
  }
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const output: Record<string, Prisma.InputJsonValue> = {};
    Object.entries(record)
      .slice(0, 80)
      .forEach(([key, value]) => {
        const cleaned = sanitizeDebugPayload(value);
        if (cleaned !== null) {
          output[key] = cleaned;
        }
      });
    return output as Prisma.InputJsonValue;
  }
  return null;
}

export async function storeOcrRegionSnapshot(params: {
  cardAssetId: string;
  snapshot: OcrRegionSnapshotInput;
}): Promise<{
  photoSide: "FRONT" | "BACK" | "TILT";
  storageKey: string;
  imageUrl: string;
  width: number | null;
  height: number | null;
  devicePixelRatio: number | null;
} | null> {
  const cardAssetId = coerceNullableString(params.cardAssetId);
  if (!cardAssetId) {
    return null;
  }
  const photoSide = normalizeOcrRegionPhotoSide(params.snapshot.photoSide);
  if (!photoSide) {
    return null;
  }
  const buffer = decodePngDataUrl(String(params.snapshot.dataUrl || ""));
  if (!buffer || buffer.length < 32) {
    return null;
  }
  // Prevent extremely large payloads from being stored accidentally.
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error("Teach snapshot exceeds 10MB limit.");
  }

  const card = await prisma.cardAsset.findUnique({
    where: { id: cardAssetId },
    select: {
      id: true,
      storageKey: true,
    },
  });
  if (!card) {
    return null;
  }

  const normalizedStorageKey = String(card.storageKey || "").replace(/\\/g, "/");
  const baseDir = normalizedStorageKey.includes("/")
    ? normalizedStorageKey.slice(0, normalizedStorageKey.lastIndexOf("/"))
    : card.id;
  const timestamp = Date.now();
  const sideKey = photoSide.toLowerCase();
  const storageKey = `${baseDir}/teach/region-${timestamp}-${sideKey}.png`;
  const uploaded = await uploadBuffer(storageKey, buffer, "image/png");
  const imageUrl = normalizeStorageUrl(uploaded) ?? uploaded;

  const width =
    typeof params.snapshot.width === "number" && Number.isFinite(params.snapshot.width)
      ? Math.round(params.snapshot.width)
      : null;
  const height =
    typeof params.snapshot.height === "number" && Number.isFinite(params.snapshot.height)
      ? Math.round(params.snapshot.height)
      : null;
  const devicePixelRatio =
    typeof params.snapshot.devicePixelRatio === "number" && Number.isFinite(params.snapshot.devicePixelRatio)
      ? Number(params.snapshot.devicePixelRatio.toFixed(3))
      : null;

  return {
    photoSide,
    storageKey,
    imageUrl,
    width,
    height,
    devicePixelRatio,
  };
}

export async function createOcrRegionTeachEvent(params: {
  cardAssetId?: string | null;
  setId?: string | null;
  layoutClass?: string | null;
  photoSide?: string | null;
  eventType?: string | null;
  regionCount?: number | null;
  templatesUpdated?: number | null;
  snapshotStorageKey?: string | null;
  snapshotImageUrl?: string | null;
  debugPayload?: unknown;
  createdById?: string | null;
}) {
  const setId = coerceNullableString(params.setId);
  const layoutClass = setId ? normalizeOcrRegionLayoutClass(params.layoutClass) : null;
  const photoSide = normalizeOcrRegionPhotoSide(params.photoSide);
  const eventType = normalizeEventType(params.eventType);
  const cardAssetId = coerceNullableString(params.cardAssetId);
  const snapshotStorageKey = coerceNullableString(params.snapshotStorageKey);
  const snapshotImageUrl = coerceNullableString(params.snapshotImageUrl);
  const createdById = coerceNullableString(params.createdById);
  const regionCount = toFiniteInt(params.regionCount, 0);
  const templatesUpdated = toFiniteInt(params.templatesUpdated, 0);
  const debugPayloadJson = sanitizeDebugPayload(params.debugPayload);

  return (prisma as any).ocrRegionTeachEvent.create({
    data: {
      cardAssetId: cardAssetId ?? undefined,
      setId: setId ?? undefined,
      setIdKey: normalizeTextKey(setId),
      layoutClass: layoutClass ?? undefined,
      layoutClassKey: normalizeTextKey(layoutClass),
      photoSide: photoSide ?? undefined,
      photoSideKey: normalizeTextKey(photoSide),
      eventType,
      regionCount,
      templatesUpdated,
      snapshotStorageKey: snapshotStorageKey ?? undefined,
      snapshotImageUrl: snapshotImageUrl ?? undefined,
      debugPayloadJson: debugPayloadJson ?? null,
      createdById: createdById ?? undefined,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });
}
