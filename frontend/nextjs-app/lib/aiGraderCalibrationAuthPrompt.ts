export type AiGraderCalibrationAuthPromptClaim = {
  current: boolean;
};

export function claimAiGraderCalibrationAdminPrompt(
  claim: AiGraderCalibrationAuthPromptClaim,
): boolean {
  if (claim.current) {
    return false;
  }
  claim.current = true;
  return true;
}
