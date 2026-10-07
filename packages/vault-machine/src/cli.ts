import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { VaultHttpService } from "./http-service";
import { RedactedJsonLogger } from "./logger";
import { VaultMachine } from "./machine";
import { createAdapterRuntime, type AdapterRuntime } from "./adapter-runtime";
import { VaultMaintenance } from "./maintenance";
import { VaultOperationsService } from "./operations";
import { VaultStore } from "./store";
import { systemClock } from "./types";
import { VaultCloudClient } from "./cloud-client";
import { VaultRuntime } from "./runtime";

async function main(): Promise<void> {
  if (!["20", "22"].includes(process.versions.node.split(".")[0]!)) throw new Error("Vault requires a supported packaged Node runtime (22 for Linux; 20 legacy compatibility)");
  const machineId = required("VAULT_MACHINE_ID"); const dataPath = required("VAULT_DATABASE_PATH"); const origin = required("VAULT_KIOSK_ORIGIN");
  if (!isAbsolute(dataPath)) throw new Error("Persistent absolute database path is required");
  const callbackToken = required("VAULT_ADAPTER_CALLBACK_TOKEN"); const publicKeyPath = required("VAULT_CONFIG_PUBLIC_KEY_PATH"); const keyId = required("VAULT_CONFIG_KEY_ID");
  const host = (process.env.VAULT_BIND_HOST ?? "127.0.0.1") as "127.0.0.1" | "::1"; const port = Number(process.env.VAULT_PORT ?? 47831);
  const appVersion = required("VAULT_APP_VERSION"); const sourceCommit = required("VAULT_SOURCE_COMMIT");
  const staticRoot = required("VAULT_KIOSK_STATIC_ROOT"); const cloudOrigin = required("VAULT_CLOUD_ORIGIN");
  required("VAULT_MACHINE_CREDENTIAL");
  const maintenanceToken = required("VAULT_MAINTENANCE_TOKEN");
  if (maintenanceToken.length < 32 || callbackToken.length < 32 || maintenanceToken === callbackToken) throw new Error("Distinct protected maintenance and callback tokens are required");
  const publicKey = readFileSync(publicKeyPath, "utf8");
  const cloud = new VaultCloudClient({ origin: cloudOrigin, machineId, credential: () => required("VAULT_MACHINE_CREDENTIAL") });
  if (!["127.0.0.1", "::1"].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid loopback listener configuration");
  const logger = new RedactedJsonLogger(process.env.VAULT_LOG_PATH);
  let store: VaultStore | undefined; let adapters: AdapterRuntime | undefined;
  let http: VaultHttpService | undefined; let runtime: VaultRuntime | undefined;
  const cleanup = async () => {
    try { await http?.pauseMutations(); await runtime?.stop(); }
    finally {
      try { if (http?.server.listening) await http.close(); }
      finally { try { await adapters?.close(); } finally { store?.close(); } }
    }
  };
  try {
    store = new VaultStore(dataPath, { machineId, appVersion, sourceCommit });
    let machine: VaultMachine | undefined;
    const sparkStage = process.env.VAULT_PAYMENT_ADAPTER === "NAYAX_SPARK_PRODUCTION" ? "PRODUCTION" : "SANDBOX";
    adapters = createAdapterRuntime(process.env, dataPath, machineId, {
      beforeProductionEffect: () => { if (!machine) throw new Error("SPARK_MACHINE_AUTHORITY_UNAVAILABLE"); return machine.requireProductionEffectAuthority(); },
      readSparkObservations: id => cloud.sparkObservations(id, sparkStage, adapters?.productionAuthority?.paymentBindingDigest), readSparkReceiptFeed: after => cloud.sparkReceipts(after, sparkStage, adapters?.productionAuthority?.paymentBindingDigest) });
    await adapters.initializeReadOnly();
    const { payment, controller } = adapters;
    machine = new VaultMachine(store, payment, controller, { productionAuthority: adapters.productionAuthority, pinnedConfigKeys: { [keyId]: publicKey }, appVersion, clock: systemClock, beforeCheckout: () => {
      if (!runtime) return Promise.reject(new Error("Cloud runtime is not initialized"));
      return runtime.proveCheckoutReachability();
    } });
    await machine.initialize();
    const operations = new VaultOperationsService(machine, systemClock);
    const maintenance = new VaultMaintenance(machine, {
      quiesce: async () => { await http!.pauseMutations(); await runtime!.pause(); await machine!.drainCommands(); },
      resume: async () => { http!.resumeMutations(); runtime!.resume(); },
    });
    http = new VaultHttpService(machine, operations, { origin, host, port, staticRoot, adapterCallbackToken: callbackToken, maintenanceToken, maintenance, clock: systemClock, logger });
    runtime = new VaultRuntime(machine, cloud, { clock: systemClock, broadcast: () => http!.broadcastState(), reportError: (code) => logger.log("WARN", "VAULT_RUNTIME_CYCLE_FAILED", { code }) });
    const address = await http.listen();
    logger.log("INFO", "VAULT_MACHINE_STARTED", { machineId, appVersion, ...address, adapterMode: (await payment.capabilities()).mode, controllerMode: (await controller.identity()).mode });
    runtime.start();
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return; stopping = true;
      try { logger.log("INFO", "VAULT_MACHINE_STOPPING", { machineId }); await cleanup(); }
      catch { process.stderr.write("Vault shutdown requires local support review\n"); process.exitCode = 1; }
    };
    process.once("SIGINT", () => void shutdown()); process.once("SIGTERM", () => void shutdown());
  } catch (error) { await cleanup(); throw error; }
}

function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`Missing required environment variable ${name}`); return value; }
void main().catch(() => { process.stderr.write("Vault machine failed to start; verify the local runtime configuration and recovery state\n"); process.exitCode = 1; });
