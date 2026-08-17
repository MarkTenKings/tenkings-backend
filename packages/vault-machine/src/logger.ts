import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redactVaultValue } from "../../vault-contracts/dist";
import { iso } from "./util";

export class RedactedJsonLogger {
  constructor(private readonly path?: string) { if (path) mkdirSync(dirname(path), { recursive: true }); }
  log(level: "INFO" | "WARN" | "ERROR", event: string, context: Record<string, unknown> = {}): void {
    const record = JSON.stringify(redactVaultValue({ timestamp: iso(), level, event, ...context })) + "\n";
    if (this.path) appendFileSync(this.path, record, { encoding: "utf8", mode: 0o600 });
  }
}
