import type { SpeedsterCardSide } from "../ai-grader-v2/contracts";

export const SPEEDSTER_IPHONE_SHORTCUT_NAME = "Ten Kings Speedster Capture";
export const SPEEDSTER_IPHONE_CONTENT_TYPE = "image/jpeg";

export function speedsterIphoneStorageKey(
  userId: string,
  sessionId: string,
  side: SpeedsterCardSide,
) {
  return `ai-grader-v2/${userId}/${sessionId}/original/${side.toLowerCase()}.jpg`;
}

export function speedsterIphonePairingUrl(deviceId: string) {
  const name = encodeURIComponent(SPEEDSTER_IPHONE_SHORTCUT_NAME);
  const text = encodeURIComponent(deviceId);
  return `shortcuts://run-shortcut?name=${name}&input=text&text=${text}`;
}
