import { hasAdminAccess, hasAdminPhoneAccess } from "../constants/admin";
import type { AiGraderAdminApiStatus } from "./aiGraderAdminClient";

export type AiGraderAdminSessionLike = {
  token?: string | null;
  user?: {
    id?: string | null;
    phone?: string | null;
  } | null;
} | null;

export type AiGraderAdminGateState = "loading" | "signed_out" | "forbidden" | "ready";

export function hasAiGraderAdminAccess(
  session: AiGraderAdminSessionLike,
  accessors = {
    hasAdminAccess,
    hasAdminPhoneAccess,
  }
) {
  return accessors.hasAdminAccess(session?.user?.id) || accessors.hasAdminPhoneAccess(session?.user?.phone);
}

export function resolveAiGraderAdminGateState(input: {
  loading: boolean;
  session: AiGraderAdminSessionLike;
  isAdmin: boolean;
}): AiGraderAdminGateState {
  if (input.loading) return "loading";
  if (!input.session) return "signed_out";
  if (!input.isAdmin) return "forbidden";
  return "ready";
}

export function canSubmitAiGraderOperation(status: AiGraderAdminApiStatus | null) {
  return status?.enabled === true;
}

export function canRunAiGraderSimulator(status: AiGraderAdminApiStatus | null) {
  return status?.enabled === true && status.simulator?.enabled === true;
}

export function canRunAiGraderHelperBridge(status: AiGraderAdminApiStatus | null) {
  return status?.enabled === true && status.helperBridge?.enabled === true && status.helperBridge.configured === true;
}
