import { timingSafeEqual } from "node:crypto";

export type ServerOperatorAuthorityConfig = Readonly<{
  operatorKey: string;
  operatorUserId: string;
  capabilities: readonly ServerOperatorCapability[];
}>;

export const SERVER_OPERATOR_CAPABILITIES = ["set-ops:batch-import"] as const;
export type ServerOperatorCapability = typeof SERVER_OPERATOR_CAPABILITIES[number];

type OperatorAuthorityEnvironment = Readonly<{
  [key: string]: string | undefined;
  OPERATOR_API_KEY?: string;
  OPERATOR_USER_ID?: string;
  OPERATOR_API_CAPABILITIES?: string;
}>;

export function resolveServerOperatorAuthority(
  environment: OperatorAuthorityEnvironment = process.env,
): ServerOperatorAuthorityConfig | null {
  const operatorKey = environment.OPERATOR_API_KEY?.trim() ?? "";
  const operatorUserId = environment.OPERATOR_USER_ID?.trim() ?? "";
  const requestedCapabilities = (environment.OPERATOR_API_CAPABILITIES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (operatorKey.length < 32 || operatorKey.length > 512) return null;
  if (!/^[a-zA-Z0-9_-]{3,128}$/.test(operatorUserId)) return null;
  if (requestedCapabilities.length < 1
    || new Set(requestedCapabilities).size !== requestedCapabilities.length
    || requestedCapabilities.some((value) => !SERVER_OPERATOR_CAPABILITIES.includes(value as ServerOperatorCapability))) {
    return null;
  }
  return {
    operatorKey,
    operatorUserId,
    capabilities: requestedCapabilities as ServerOperatorCapability[],
  };
}

export function matchesServerOperatorKey(presented: string, expected: string) {
  const presentedBytes = Buffer.from(presented, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return presentedBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(presentedBytes, expectedBytes);
}
