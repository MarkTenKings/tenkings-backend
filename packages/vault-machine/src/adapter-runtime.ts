import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { SIMULATOR_DOOR_MAPPING, VaultDoorMappingSchema, type ControllerAdapter, type PaymentAdapter } from "../../vault-contracts/dist";
import { createSparkProductionAuthority, type ProductionAuthority, type ProductionEffectContext } from "./spark-activation";
import { DurablePaymentMock } from "./durable-mock";
import { DeterministicControllerSimulator } from "./controller-simulator";
import { StripeTerminalTestAdapter } from "./stripe-terminal-test-adapter";
import { NayaxSparkTestAdapter, type NayaxSparkObservation } from "./nayax-spark-test-adapter";
import { WaveshareControllerAdapter, validateWaveshareConfig, waveshareBindingDigest } from "./waveshare-controller";
import { WaveshareCommandJournal } from "./waveshare-journal";
import { LinuxWaveshareSerialTransport } from "./waveshare-serial";

export interface AdapterRuntime {
  payment: PaymentAdapter;
  controller: ControllerAdapter;
  productionAuthority?: ProductionAuthority;
  initializeReadOnly(): Promise<void>;
  close(): Promise<void>;
}

/** Explicit composition: absent/misspelled selections never fall back to mocks.
 * Production requires an independently trusted activation and verified installed release. */
export interface AdapterRuntimeOptions {
  beforeProductionEffect?: () => ProductionEffectContext;
  readSparkReceiptFeed?: (after: string) => Promise<{ observations: NayaxSparkObservation[]; nextCursor: string; hasMore: boolean }>;
  readSparkObservations?: (sparkTransactionId: string) => Promise<NayaxSparkObservation[]>;
}

export function createAdapterRuntime(env: NodeJS.ProcessEnv, databasePath: string, machineId: string, options: AdapterRuntimeOptions = {}): AdapterRuntime {
  if (!["MOCK", "STRIPE_TEST", "NAYAX_SPARK_TEST", "NAYAX_SPARK_PRODUCTION"].includes(env.VAULT_PAYMENT_ADAPTER ?? "") || !["SIMULATOR", "WAVESHARE"].includes(env.VAULT_CONTROLLER_ADAPTER ?? "")) throw new Error("VAULT_ADAPTER_SELECTION_REQUIRED");
  if (["MOCK", "STRIPE_TEST", "NAYAX_SPARK_TEST"].includes(env.VAULT_PAYMENT_ADAPTER ?? "") && env.VAULT_CONTROLLER_ADAPTER === "WAVESHARE") throw new Error("TEST_PAYMENT_CANNOT_AUTHORIZE_PHYSICAL_CONTROLLER");
  const production = env.VAULT_PAYMENT_ADAPTER === "NAYAX_SPARK_PRODUCTION";
  if (production && (env.VAULT_CONTROLLER_ADAPTER !== "WAVESHARE" || !options.beforeProductionEffect)) throw new Error("SPARK_PRODUCTION_PHYSICAL_AUTHORITY_REQUIRED");
  const mappingPath = env.VAULT_SIMULATOR_MAPPING_PATH;
  const mapping = env.VAULT_CONTROLLER_ADAPTER === "SIMULATOR" ? (mappingPath ? VaultDoorMappingSchema.parse(readJson(mappingPath)) : [...SIMULATOR_DOOR_MAPPING]) : null;
  const config = env.VAULT_CONTROLLER_ADAPTER === "WAVESHARE" ? validateWaveshareConfig(readJson(required(env, "VAULT_WAVESHARE_CONFIG_PATH"))) : null;
  if (config && config.mode !== (production ? "LIVE" : "OFFICIAL_TEST")) throw new Error("CONTROLLER_STAGE_MISMATCH");
  const productionAuthority = production ? createSparkProductionAuthority(env, machineId, config!) : undefined;
  const beforeEffect = production ? () => productionAuthority!.assertAuthorized(options.beforeProductionEffect!()) : undefined;
  const spark = ["NAYAX_SPARK_TEST", "NAYAX_SPARK_PRODUCTION"].includes(env.VAULT_PAYMENT_ADAPTER ?? "") ? readJson(required(env, "VAULT_SPARK_CONFIG_PATH")) : null;
  if (spark && spark.environment !== (production ? "PRODUCTION" : "SANDBOX")) throw new Error("SPARK_RUNTIME_STAGE_MISMATCH");
  if (spark && (!options.readSparkObservations || !options.readSparkReceiptFeed)) throw new Error("SPARK_AUTHENTICATED_OBSERVATION_SOURCE_REQUIRED");
  let controller: ControllerAdapter;
  let physical: WaveshareControllerAdapter | undefined;
  if (config) {
    const journal = new WaveshareCommandJournal(production ? `${databasePath}.controller-production-${waveshareBindingDigest(config)}.sqlite` : `${databasePath}.controller.sqlite`, waveshareBindingDigest(config));
    try {
      physical = new WaveshareControllerAdapter(config, new LinuxWaveshareSerialTransport({ devicePath: config.devicePath, serialFormat: config.serialFormat, addresses: config.endpoints.map(endpoint => endpoint.address) }), journal, beforeEffect);
      controller = physical;
    } catch (error) { journal.close(); throw error; }
  } else controller = new DeterministicControllerSimulator(mapping!);
  let payment: PaymentAdapter & { close(): void };
  try {
    payment = env.VAULT_PAYMENT_ADAPTER === "MOCK"
      ? new DurablePaymentMock(`${databasePath}.mock-provider.sqlite`, machineId)
      : env.VAULT_PAYMENT_ADAPTER === "STRIPE_TEST"
        ? new StripeTerminalTestAdapter({ secretKey: required(env, "VAULT_STRIPE_TEST_SECRET_KEY"), machineId,
          readerId: required(env, "VAULT_STRIPE_TEST_READER_ID"), locationId: required(env, "VAULT_STRIPE_TEST_LOCATION_ID") })
        : ["NAYAX_SPARK_TEST", "NAYAX_SPARK_PRODUCTION"].includes(env.VAULT_PAYMENT_ADAPTER ?? "")
          ? new NayaxSparkTestAdapter({ machineId, terminalId: spark.terminalId, terminalIdType: spark.terminalIdType,
            nayaxMachineId: spark.nayaxMachineId, hwSerial: spark.hwSerial, siteId: spark.siteId,
            integratorId: spark.integratorId, tokenId: spark.tokenId, apiBase: spark.apiBase,
            environment: spark.environment, credentialGeneration: spark.credentialGeneration, sandboxConfirmed: spark.sandboxConfirmed, productionConfirmed: spark.productionConfirmed, beforeEffect, preSelectionConfirmed: spark.preSelectionConfirmed,
            currency: spark.currency, currencyConfirmed: spark.currencyConfirmed,
            signingProfile: spark.signingProfile, wireApiVersion: spark.wireApiVersion, vendorApprovalReference: spark.vendorApprovalReference,
            maxTotalCents: spark.maxTotalCents, callbackTerminalIdRepresentation: spark.callbackTerminalIdRepresentation,
            acquiringOnlyConfirmed: spark.acquiringOnlyConfirmed, cardUidPolicy: spark.cardUidPolicy,
            acquiringCardBrands: spark.acquiringCardBrands, unsupportedCardBrands: spark.unsupportedCardBrands,
            triggerReplayPolicy: spark.triggerReplayPolicy, cancelReplayPolicy: spark.cancelReplayPolicy,
            maxTriggerAttempts: spark.maxTriggerAttempts, maxCancelAttempts: spark.maxCancelAttempts,
            readReceiptFeed: options.readSparkReceiptFeed!,
            tokenSecret: required(env, production ? "VAULT_SPARK_PRODUCTION_TOKEN_SECRET" : "VAULT_SPARK_TOKEN_SECRET"), signKey: required(env, production ? "VAULT_SPARK_PRODUCTION_SIGN_KEY" : "VAULT_SPARK_SIGN_KEY"),
            journalPath: production ? `${databasePath}.spark-production-${productionAuthority!.bindingDigest}.sqlite` : `${databasePath}.spark-provider.sqlite`, readObservations: options.readSparkObservations! })
          : (() => { throw new Error("VAULT_PAYMENT_ADAPTER_UNSUPPORTED"); })();
  }
  catch (error) { void physical?.close(); throw error; }
  return { payment, controller, productionAuthority, initializeReadOnly: async () => { await physical?.initializeReadOnly(); }, close: async () => { try { await physical?.close(); } finally { payment.close(); } } };
}
function required(env: NodeJS.ProcessEnv, name: string): string { const value = env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
function readJson(path: string): any {
  if (!isAbsolute(path)) throw new Error("ADAPTER_CONFIGURATION_PATH_MUST_BE_ABSOLUTE");
  const bytes = readFileSync(path);
  if (bytes.length > 512 * 1024) throw new Error("ADAPTER_CONFIGURATION_TOO_LARGE");
  return JSON.parse(bytes.toString("utf8"));
}
