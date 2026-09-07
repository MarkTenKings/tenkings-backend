import type { SpeedsterCardSide } from "../ai-grader-v2/contracts";

export const SPEEDSTER_IPHONE_SHORTCUT_NAME = "Ten Kings Speedster Capture";
export const SPEEDSTER_IPHONE_CONTENT_TYPE = "image/jpeg";
const SPEEDSTER_RECAPTURE_ATTEMPT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function exactRecaptureAttemptId(value: string) {
  if (!SPEEDSTER_RECAPTURE_ATTEMPT_ID.test(value)) {
    throw new Error("Speedster recapture attempt ID must be an exact UUID.");
  }
  return value.toLowerCase();
}

function exactPreparedStorageGeneration(value: string) {
  if (/^iphone-v[1-9][0-9]*-sha256-[a-f0-9]{64}$/.test(value)) return value;
  if (/^sha256-[a-f0-9]{64}$/.test(value)) return value;
  if (/^recapture-/.test(value)) return `recapture-${exactRecaptureAttemptId(value.slice("recapture-".length))}`;
  throw new Error("Speedster prepared storage generation is invalid.");
}

export function speedsterIphoneStorageKey(
  userId: string,
  sessionId: string,
  side: SpeedsterCardSide,
  uploadVersion: number,
  checksumSha256: string,
) {
  if (!Number.isSafeInteger(uploadVersion) || uploadVersion < 1) {
    throw new Error("Speedster iPhone upload version must be a positive integer.");
  }
  const checksum = exactSha256(checksumSha256);
  return `ai-grader-v2/${userId}/${sessionId}/original/iphone-v${uploadVersion}-sha256-${checksum}/${side.toLowerCase()}.jpg`;
}

function exactSha256(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("Speedster SHA-256 must be exactly 64 hexadecimal characters.");
  return normalized;
}

export function speedsterContentAddressedOriginalStorageKey(
  userId: string,
  sessionId: string,
  side: SpeedsterCardSide,
  checksumSha256: string,
  extension: "jpg" | "png" | "webp",
) {
  return `ai-grader-v2/${userId}/${sessionId}/original/sha256-${exactSha256(checksumSha256)}/${side.toLowerCase()}.${extension}`;
}

export function legacySpeedsterOriginalStorageKey(
  userId: string,
  sessionId: string,
  side: SpeedsterCardSide,
  extension: "jpg" | "png" | "webp" = "jpg",
) {
  return `ai-grader-v2/${userId}/${sessionId}/original/${side.toLowerCase()}.${extension}`;
}

export function speedsterRecaptureOriginalStorageKey(
  userId: string,
  sessionId: string,
  side: SpeedsterCardSide,
  attemptId: string,
  extension: "jpg" | "png" | "webp",
) {
  return `ai-grader-v2/${userId}/${sessionId}/original/recapture-${exactRecaptureAttemptId(attemptId)}/${side.toLowerCase()}.${extension}`;
}

export function speedsterPreparedStorageKeys(
  userId: string,
  sessionId: string,
  side: SpeedsterCardSide,
  storageGeneration?: string,
) {
  const base = `ai-grader-v2/${userId}/${sessionId}/prepared/${side.toLowerCase()}`;
  const prefix = storageGeneration
    ? `${base}/${exactPreparedStorageGeneration(storageGeneration)}`
    : base;
  return {
    RECTIFIED: `${prefix}/rectified.webp`,
    INSPECTION: `${prefix}/inspection.webp`,
    NORMALIZED: `${prefix}/normalized.webp`,
    MICRO_DEFECT: `${prefix}/micro_defect.webp`,
    DIRECTIONAL: `${prefix}/directional.webp`,
  } as const;
}

export function speedsterOriginalStorageGeneration(input: Readonly<{
  storageKey: string;
  userId: string;
  sessionId: string;
  side: SpeedsterCardSide;
}>): string | null | undefined {
  const prefix = `ai-grader-v2/${input.userId}/${input.sessionId}/original/`;
  if (!input.storageKey.startsWith(prefix)) return undefined;
  const suffix = input.storageKey.slice(prefix.length);
  const side = input.side.toLowerCase();
  if (new RegExp(`^${side}\\.(?:jpg|png|webp)$`).test(suffix)) return null;
  const versioned = new RegExp(`^(iphone-v[1-9][0-9]*-sha256-[a-f0-9]{64}|sha256-[a-f0-9]{64}|recapture-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})/${side}\\.(?:jpg|png|webp)$`, "i").exec(suffix);
  return versioned?.[1]?.toLowerCase();
}

export function speedsterPreparedStorageGenerationForRectified(input: Readonly<{
  storageKey: string;
  userId: string;
  sessionId: string;
  side: SpeedsterCardSide;
}>): string | null | undefined {
  const base = `ai-grader-v2/${input.userId}/${input.sessionId}/prepared/${input.side.toLowerCase()}`;
  if (!input.storageKey.startsWith(`${base}/`)) return undefined;
  const suffix = input.storageKey.slice(base.length + 1);
  if (suffix === "rectified.webp") return null;
  const versioned = /^(iphone-v[1-9][0-9]*-sha256-[a-f0-9]{64}|sha256-[a-f0-9]{64}|recapture-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/rectified\.webp$/i.exec(suffix);
  return versioned?.[1]?.toLowerCase();
}

export function isAuthorizedSpeedsterRectifiedStorageKey(input: Readonly<{
  storageKey: string;
  userId: string;
  sessionId: string;
  side: SpeedsterCardSide;
}>) {
  return speedsterPreparedStorageGenerationForRectified(input) !== undefined;
}

export function isAuthorizedSpeedsterInspectionStorageKey(input: Readonly<{
  storageKey: string;
  userId: string;
  sessionId: string;
  side: SpeedsterCardSide;
}>) {
  const base = `ai-grader-v2/${input.userId}/${input.sessionId}/prepared/${input.side.toLowerCase()}`;
  if (!input.storageKey.startsWith(`${base}/`)) return false;
  const suffix = input.storageKey.slice(base.length + 1);
  return /^(?:(?:iphone-v[1-9][0-9]*-sha256-[a-f0-9]{64}|sha256-[a-f0-9]{64}|recapture-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/)?inspection\.webp$/i.test(suffix);
}

export function speedsterPreparedStorageGenerationForInspection(input: Readonly<{
  storageKey: string;
  userId: string;
  sessionId: string;
  side: SpeedsterCardSide;
}>): string | null | undefined {
  const base = `ai-grader-v2/${input.userId}/${input.sessionId}/prepared/${input.side.toLowerCase()}`;
  if (!input.storageKey.startsWith(`${base}/`)) return undefined;
  const suffix = input.storageKey.slice(base.length + 1);
  if (suffix === "inspection.webp") return null;
  const versioned = /^(iphone-v[1-9][0-9]*-sha256-[a-f0-9]{64}|sha256-[a-f0-9]{64}|recapture-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/inspection\.webp$/i.exec(suffix);
  return versioned?.[1]?.toLowerCase();
}

export function isAuthorizedSpeedsterPreparedStorageKeys(input: Readonly<{
  userId: string;
  sessionId: string;
  side: SpeedsterCardSide;
  rectifiedStorageKey: string;
  inspectionStorageKey: string;
  viewStorageKeys: Readonly<Record<"NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
}>) {
  const base = `ai-grader-v2/${input.userId}/${input.sessionId}/prepared/${input.side.toLowerCase()}`;
  const suffix = input.rectifiedStorageKey.startsWith(`${base}/`)
    ? input.rectifiedStorageKey.slice(base.length + 1)
    : "";
  const match = /^(?:(iphone-v[1-9][0-9]*-sha256-[a-f0-9]{64}|sha256-[a-f0-9]{64}|recapture-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\/)?rectified\.webp$/i.exec(suffix);
  if (!match) return false;
  const prefix = match[1] ? `${base}/${match[1].toLowerCase()}` : base;
  return input.inspectionStorageKey === `${prefix}/inspection.webp`
    && input.viewStorageKeys.NORMALIZED === `${prefix}/normalized.webp`
    && input.viewStorageKeys.MICRO_DEFECT === `${prefix}/micro_defect.webp`
    && input.viewStorageKeys.DIRECTIONAL === `${prefix}/directional.webp`;
}

export function isAuthorizedSpeedsterOriginalStorageKey(input: Readonly<{
  storageKey: string;
  userId: string;
  sessionId: string;
  side: SpeedsterCardSide;
}>) {
  const prefix = `ai-grader-v2/${input.userId}/${input.sessionId}/original/`;
  if (!input.storageKey.startsWith(prefix)) return false;
  const suffix = input.storageKey.slice(prefix.length);
  const side = input.side.toLowerCase();
  return suffix === `${side}.jpg`
    || suffix === `${side}.png`
    || suffix === `${side}.webp`
    || new RegExp(`^iphone-v[1-9][0-9]*-sha256-[a-f0-9]{64}/${side}\\.jpg$`).test(suffix)
    || new RegExp(`^sha256-[a-f0-9]{64}/${side}\\.(?:jpg|png|webp)$`).test(suffix)
    || new RegExp(`^recapture-[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/${side}\\.(?:jpg|png|webp)$`, "i").test(suffix);
}

export function speedsterIphonePairingUrl(deviceId: string) {
  const name = encodeURIComponent(SPEEDSTER_IPHONE_SHORTCUT_NAME);
  const text = encodeURIComponent(deviceId);
  return `shortcuts://run-shortcut?name=${name}&input=text&text=${text}`;
}
