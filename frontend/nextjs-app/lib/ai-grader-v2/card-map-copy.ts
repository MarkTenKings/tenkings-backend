export function toCardMapOperatorMessage(message: string): string {
  return message.replace(/\btrain\b/gi, "CARD MAP");
}
