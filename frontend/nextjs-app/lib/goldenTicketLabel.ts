export function formatGoldenTicketLabel(ticketNumber: number) {
  return `#${String(ticketNumber).padStart(4, "0")}`;
}
