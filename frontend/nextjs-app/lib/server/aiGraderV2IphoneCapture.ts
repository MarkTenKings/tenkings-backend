import type { SpeedsterCardSide } from "../ai-grader-v2/contracts";

export const SPEEDSTER_IPHONE_SHORTCUT_NAME = "Ten Kings Speedster Capture";
export const SPEEDSTER_IPHONE_CONTENT_TYPE = "image/jpeg";

export function speedsterIphoneStorageKey(
  userId: string,
  sessionId: string,
  side: SpeedsterCardSide,
  uploadVersion: number,
) {
  if (!Number.isSafeInteger(uploadVersion) || uploadVersion < 1) {
    throw new Error("Speedster iPhone upload version must be a positive integer.");
  }
  return `ai-grader-v2/${userId}/${sessionId}/original/iphone-v${uploadVersion}/${side.toLowerCase()}.jpg`;
}

export function legacySpeedsterOriginalStorageKey(
  userId: string,
  sessionId: string,
  side: SpeedsterCardSide,
  extension: "jpg" | "png" | "webp" = "jpg",
) {
  return `ai-grader-v2/${userId}/${sessionId}/original/${side.toLowerCase()}.${extension}`;
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
    || new RegExp(`^iphone-v[1-9][0-9]*/${side}\\.jpg$`).test(suffix);
}

export function speedsterIphonePairingUrl(deviceId: string) {
  const name = encodeURIComponent(SPEEDSTER_IPHONE_SHORTCUT_NAME);
  const text = encodeURIComponent(deviceId);
  return `shortcuts://run-shortcut?name=${name}&input=text&text=${text}`;
}
