import { readFileSync } from "node:fs";
import { SIMULATOR_DOOR_MAPPING } from "../../vault-contracts/dist";
import { DeterministicControllerSimulator } from "./controller-simulator";
import { VaultHttpService } from "./http-service";
import { RedactedJsonLogger } from "./logger";
import { VaultMachine } from "./machine";
import { DeterministicNayaxMock } from "./mock-nayax";
import { VaultOperationsService } from "./operations";
import { VaultStore } from "./store";
import { systemClock } from "./types";

async function main(): Promise<void> {
  const machineId = required("VAULT_MACHINE_ID"); const dataPath = required("VAULT_DATABASE_PATH"); const origin = required("VAULT_KIOSK_ORIGIN");
  const callbackToken = required("VAULT_ADAPTER_CALLBACK_TOKEN"); const publicKeyPath = required("VAULT_CONFIG_PUBLIC_KEY_PATH"); const keyId = required("VAULT_CONFIG_KEY_ID");
  const host = (process.env.VAULT_BIND_HOST ?? "127.0.0.1") as "127.0.0.1" | "::1"; const port = Number(process.env.VAULT_PORT ?? 47831);
  const appVersion = required("VAULT_APP_VERSION"); const sourceCommit = required("VAULT_SOURCE_COMMIT");
  const store = new VaultStore(dataPath, { machineId, appVersion, sourceCommit });
  const payment = new DeterministicNayaxMock(); const controller = new DeterministicControllerSimulator([...SIMULATOR_DOOR_MAPPING]);
  const machine = new VaultMachine(store, payment, controller, { pinnedConfigKeys: { [keyId]: readFileSync(publicKeyPath, "utf8") }, appVersion, clock: systemClock });
  await machine.initialize();
  const operations = new VaultOperationsService(machine, systemClock); const logger = new RedactedJsonLogger(process.env.VAULT_LOG_PATH);
  const http = new VaultHttpService(machine, operations, { origin, host, port, staticRoot: process.env.VAULT_KIOSK_STATIC_ROOT, adapterCallbackToken: callbackToken, clock: systemClock, logger });
  const address = await http.listen(); logger.log("INFO", "VAULT_MACHINE_STARTED", { machineId, appVersion, ...address, adapterMode: "MOCK", controllerMode: "SIMULATOR" });
  const shutdown = async () => { logger.log("INFO", "VAULT_MACHINE_STOPPING", { machineId }); await http.close(); store.close(); process.exit(0); };
  process.once("SIGINT", () => void shutdown()); process.once("SIGTERM", () => void shutdown());
}

function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`Missing required environment variable ${name}`); return value; }
void main().catch((error) => { process.stderr.write(`Vault machine failed to start: ${error instanceof Error ? error.message : "unknown error"}\n`); process.exitCode = 1; });
