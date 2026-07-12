export function canConfirmAiGraderCardManually(input: {
  reportReady: boolean;
  identityComplete: boolean;
  linkedCardReady: boolean;
  confirmationPending: boolean;
}) {
  return input.reportReady && input.identityComplete && !input.linkedCardReady && !input.confirmationPending;
}
