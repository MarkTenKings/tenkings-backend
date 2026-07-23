export type AiGraderCalibrationAuthPromptClaim = {
  current: boolean;
};

export function claimAiGraderCalibrationAdminPrompt(
  claim: AiGraderCalibrationAuthPromptClaim,
  blocked = false,
): boolean {
  if (blocked || claim.current) {
    return false;
  }
  claim.current = true;
  return true;
}
