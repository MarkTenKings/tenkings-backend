import type { SessionPayload } from "../hooks/useSession";
import {
  AiGraderCalibrationActivationTransportError,
  authorizeFreshAiGraderCalibrationActivationV1,
} from "./aiGraderCalibrationActivationClient";

export const AI_GRADER_CALIBRATION_FRESH_AUTH_MESSAGE =
  "Enter a fresh human-admin SMS code to activate this exact calibration.";

type EnsureSession = (
  options?: { force?: boolean; message?: string | null },
) => Promise<SessionPayload>;

export async function ensureFreshAiGraderCalibrationActivationSession(
  ensureSession: EnsureSession,
  authorize = authorizeFreshAiGraderCalibrationActivationV1,
): Promise<SessionPayload> {
  let activeSession = await ensureSession();
  try {
    await authorize({ token: activeSession.token });
    return activeSession;
  } catch (error) {
    if (
      !(error instanceof AiGraderCalibrationActivationTransportError) ||
      (error.status !== 401 && error.status !== 403)
    ) {
      throw error;
    }
  }

  activeSession = await ensureSession({
    force: true,
    message: AI_GRADER_CALIBRATION_FRESH_AUTH_MESSAGE,
  });
  await authorize({ token: activeSession.token });
  return activeSession;
}
