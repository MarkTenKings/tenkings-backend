import type { ControllerAdapter, ControllerCommand, ControllerReceipt, VaultDoorId } from "../../vault-contracts/dist";
import { VaultDoorMappingSchema } from "../../vault-contracts/dist";
import { digest } from "./util";
import { WaveshareCommandJournal } from "./waveshare-journal";
import { boundedInteger, WaveshareError, waveshareRequest, waveshareResponse, type WaveshareAction } from "./waveshare-protocol";
import type { WaveshareTransport } from "./waveshare-serial";

export interface WaveshareControllerConfig {
  adapterId: "waveshare-modbus-rtu-relay-32ch-v2";
  mode: "OFFICIAL_TEST" | "LIVE";
  devicePath: string;
  serialFormat: "9600/8N1";
  endpoints: Array<{ endpointId: string; address: number; expectedFirmwareRegister: number }>;
  mapping: Array<{ doorId: VaultDoorId; controllerEndpointId: string; controllerChannel: number }>;
  mappingVersion: string;
  profileDigest: string;
  pulseMs: 100;
  offSettleMs: number;
  minimumOffMs: number;
  /** SHA256 of reviewed physical pulse/electrical/mapping qualification evidence.
   * Null permits read-only inspection; it never authorizes an output. */
  qualificationEvidenceDigest: string | null;
}

export function validateWaveshareConfig(value: WaveshareControllerConfig): WaveshareControllerConfig {
  const valueKeys = ["adapterId", "mode", "devicePath", "serialFormat", "endpoints", "mapping", "mappingVersion", "profileDigest", "pulseMs", "offSettleMs", "minimumOffMs", "qualificationEvidenceDigest"];
  if (!value || typeof value !== "object" || Object.keys(value).some(key => !valueKeys.includes(key))
    || value.adapterId !== "waveshare-modbus-rtu-relay-32ch-v2" || !["OFFICIAL_TEST", "LIVE"].includes(value.mode)
    || typeof value.devicePath !== "string" || !/^\/dev\/serial\/by-id\/[^/\u0000-\u0020]{1,240}$/.test(value.devicePath)
    || value.serialFormat !== "9600/8N1" || value.pulseMs !== 100
    || typeof value.mappingVersion !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value.mappingVersion)
    || !/^[a-f0-9]{64}$/.test(value.profileDigest)
    || (value.qualificationEvidenceDigest !== null && !/^[a-f0-9]{64}$/.test(value.qualificationEvidenceDigest))
    || !Array.isArray(value.endpoints) || value.endpoints.length < 1 || value.endpoints.length > 8) throw new WaveshareError("WAVESHARE_CONFIG_INVALID");
  boundedInteger(value.offSettleMs, 300, 5000); boundedInteger(value.minimumOffMs, 100, 60_000);
  const endpoints = new Set<string>(); const addresses = new Set<number>();
  for (const endpoint of value.endpoints) {
    if (!endpoint || Object.keys(endpoint).sort().join(",") !== "address,endpointId,expectedFirmwareRegister" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(endpoint.endpointId) || endpoints.has(endpoint.endpointId) || addresses.has(endpoint.address)) throw new WaveshareError("WAVESHARE_ENDPOINT_INVALID");
    boundedInteger(endpoint.address, 1, 247); boundedInteger(endpoint.expectedFirmwareRegister, 0, 65535);
    endpoints.add(endpoint.endpointId); addresses.add(endpoint.address);
  }
  if (!VaultDoorMappingSchema.safeParse(value.mapping).success || value.mapping.some(entry => !endpoints.has(entry.controllerEndpointId) || !Number.isInteger(entry.controllerChannel) || entry.controllerChannel < 1 || entry.controllerChannel > 32)) throw new WaveshareError("WAVESHARE_MAPPING_INVALID");
  return structuredClone(value);
}
export function waveshareBindingDigest(config: WaveshareControllerConfig): string { return digest(validateWaveshareConfig(config)); }

/** One adapter owns every board on one configured bus. Physical output is held
 * through the board timer, settle, all-board OFF readback, and minimum OFF gap.
 * Reported coils cannot attest contacts, coil current, release or a door opening. */
export class WaveshareControllerAdapter implements ControllerAdapter {
  private readonly config: WaveshareControllerConfig;
  private tail: Promise<void> = Promise.resolve();
  private initialized = false;
  private outputState: "OFF_VERIFIED" | "UNCERTAIN" | "NOT_SENT" = "UNCERTAIN";
  private busy = false;
  private closed = false;
  private closing = false;
  constructor(config: WaveshareControllerConfig, private readonly transport: WaveshareTransport, private readonly journal: WaveshareCommandJournal, private readonly beforeEffect?: () => void) {
    this.config = validateWaveshareConfig(config);
    if (this.config.mode === "LIVE" && !beforeEffect) throw new WaveshareError("WAVESHARE_PRODUCTION_AUTHORITY_REQUIRED");
    if (journal.bindingDigest !== waveshareBindingDigest(this.config)) throw new WaveshareError("WAVESHARE_JOURNAL_BINDING_MISMATCH");
    if (transport.kind === "REAL_LINUX_SERIAL" && !journal.durable) throw new WaveshareError("WAVESHARE_DURABLE_JOURNAL_REQUIRED");
    if (transport.kind === "REAL_LINUX_SERIAL" && (transport.configuredDevicePath !== this.config.devicePath
      || digest([...(transport.configuredAddresses ?? [])].sort((a, b) => a - b)) !== digest(this.config.endpoints.map(endpoint => endpoint.address).sort((a, b) => a - b)))) throw new WaveshareError("WAVESHARE_TRANSPORT_BINDING_MISMATCH");
  }
  async identity() {
    if (this.initialized && !this.closed && !this.closing && this.transport.kind === "REAL_LINUX_SERIAL" && this.transport.healthy !== true) this.halt("WAVESHARE_TRANSPORT_LOST_WHILE_IDLE");
    return { adapter: this.config.adapterId, mode: this.config.mode, ...(this.config.mode === "LIVE" ? { productionConfirmed: true as const, bindingDigest: waveshareBindingDigest(this.config) } : {}), firmware: this.initialized ? this.config.endpoints.map(endpoint => `${endpoint.endpointId}:V${(endpoint.expectedFirmwareRegister / 100).toFixed(2)}`).join(",") : null,
      mappingDigest: digest(this.config.mapping), ready: this.initialized && !this.busy && !this.closed && !this.closing && !this.journal.state().halted && this.config.qualificationEvidenceDigest !== null,
      outputState: this.outputState };
  }
  async validateMapping(mapping: WaveshareControllerConfig["mapping"]) {
    const errors = digest(mapping) === digest(this.config.mapping) ? [] : ["WAVESHARE_MAPPING_MISMATCH"];
    return { valid: errors.length === 0, errors };
  }
  /** Startup has only identity/status reads. A pre-existing durable halt survives. */
  initializeReadOnly(): Promise<void> { return this.enqueue(async () => { await this.inspectReadOnly(); }); }
  /** Explicit staff recovery AFTER physical setup inspection. Does not retry or
   * modify old commands. The caller owns staff authorization and machine halt. */
  recoverReadOnly(evidenceRef: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(evidenceRef)) return Promise.reject(new WaveshareError("WAVESHARE_RECOVERY_EVIDENCE_REQUIRED"));
    return this.enqueue(async () => {
      this.initialized = false;
      await this.transport.close();
      await this.inspectReadOnly();
      this.journal.recover(evidenceRef);
      this.outputState = "OFF_VERIFIED";
    });
  }
  sendOpenCommand(command: ControllerCommand): Promise<ControllerReceipt> {
    // Freeze before queuing: a caller cannot change the pending physical address.
    const frozen = structuredClone(command);
    return this.enqueue(() => this.dispatch(frozen));
  }
  async close(): Promise<void> {
    this.closing = true;
    await this.tail;
    this.closed = true; this.initialized = false;
    await this.transport.close();
    this.journal.close();
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.closing) return Promise.reject(new WaveshareError("WAVESHARE_CLOSED"));
    const next = this.tail.then(async () => { this.busy = true; try { return await operation(); } finally { this.busy = false; } });
    this.tail = next.then(() => undefined, () => undefined); return next;
  }
  private async inspectReadOnly(): Promise<void> {
    try {
      await this.transport.open();
      // Wait beyond the only allowed board timer before accepting startup idle.
      await sleep(this.config.pulseMs + this.config.offSettleMs);
      await this.assertBoardIdentity();
      await this.assertAllOff();
      this.initialized = true;
      this.outputState = this.journal.state().halted ? "UNCERTAIN" : "OFF_VERIFIED";
    } catch (error) { this.halt(code(error)); throw error; }
  }
  private async dispatch(command: ControllerCommand): Promise<ControllerReceipt> {
    const rejected = (evidenceCode: string, outputState: ControllerReceipt["outputState"] = "NOT_SENT"): ControllerReceipt => ({ commandId: command.commandId, controllerSequence: this.journal.nextSequence(), outcome: "REJECTED", outputState, evidenceCode });
    const mapping = this.config.mapping.find(entry => entry.doorId === command.doorId);
    if (typeof command.commandId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(command.commandId) || !mapping || command.controllerEndpointId !== mapping.controllerEndpointId || command.controllerChannel !== mapping.controllerChannel
      || command.mappingVersion !== this.config.mappingVersion || command.profileDigest !== this.config.profileDigest) return rejected("WAVESHARE_COMMAND_MAPPING_INVALID");
    if (!["PAID_SALE", "RESTOCK", "CERTIFICATION"].includes(command.authority) || ![1, 2].includes(command.attempt) || (command.authority !== "PAID_SALE" && command.attempt !== 1)) return rejected("WAVESHARE_COMMAND_AUTHORITY_INVALID");
    if (!this.initialized || this.journal.state().halted || !this.config.qualificationEvidenceDigest) return rejected("WAVESHARE_OUTPUT_NOT_READY", this.outputState);
    const requestDigest = digest(command);
    let previous: ControllerReceipt | null;
    try { previous = this.journal.lookup(command.commandId, requestDigest); }
    catch (error) { this.halt(code(error)); return rejected(code(error), "UNCERTAIN"); }
    if (previous) {
      if (previous.outcome !== "ACCEPTED" || previous.outputState !== "OFF_VERIFIED") this.halt("WAVESHARE_PREVIOUS_COMMAND_UNCERTAIN");
      return previous;
    }
    let sequence: number;
    try {
      await this.assertBoardIdentity();
      await this.assertAllOff();
    } catch (error) { this.halt(code(error)); return rejected(code(error), "UNCERTAIN"); }
    // Inspection established OFF and no pulse was attempted. A revoked lease
    // is a proven refusal, not invented physical uncertainty or a safety halt.
    try {
      const checked: unknown = this.beforeEffect?.();
      if (checked !== undefined) { if (checked && typeof (checked as Promise<unknown>).then === "function") void Promise.resolve(checked).catch(() => {}); throw new Error("Synchronous authority required"); }
    } catch { return rejected("WAVESHARE_PRODUCTION_AUTHORITY_UNAVAILABLE", "OFF_VERIFIED"); }
    try { sequence = this.journal.begin(command.commandId, requestDigest); }
    catch (error) { this.halt(code(error)); return rejected(code(error), "UNCERTAIN"); }
    this.outputState = "UNCERTAIN";
    try {
      const endpoint = this.config.endpoints.find(entry => entry.endpointId === mapping.controllerEndpointId)!;
      // No authority check follows the pulse: OFF inspection/cleanup must finish
      // even if the approval expires or is revoked while the output is active.
      await this.request("pulse100ms", endpoint.address, mapping.controllerChannel);
      await sleep(this.config.pulseMs + this.config.offSettleMs);
      await this.assertAllOff();
      await sleep(this.config.minimumOffMs);
      // The helper owns the physical bus through the OFF interval. Its death
      // after readback must not turn into a success or clear an independently
      // latched fault merely because no further exchange was necessary.
      if (this.transport.kind === "REAL_LINUX_SERIAL" && this.transport.healthy !== true) throw new WaveshareError("WAVESHARE_TRANSPORT_LOST_BEFORE_COMPLETION");
      const state = this.journal.state();
      if (!this.initialized || !state.halted || state.reason !== "WAVESHARE_COMMAND_IN_FLIGHT") throw new WaveshareError("WAVESHARE_COMPLETION_AUTHORITY_LOST");
      const receipt: ControllerReceipt = { commandId: command.commandId, outcome: "ACCEPTED", controllerSequence: sequence, outputState: "OFF_VERIFIED", evidenceCode: "WAVESHARE_TIMED_ACK_ALL_OUTPUTS_REPORTED_OFF" };
      this.journal.complete(receipt);
      this.outputState = "OFF_VERIFIED";
      return receipt;
    } catch (error) {
      this.halt(code(error));
      const receipt: ControllerReceipt = { commandId: command.commandId, outcome: "SENT_UNKNOWN", controllerSequence: sequence, outputState: "UNCERTAIN", evidenceCode: code(error) };
      try { this.journal.complete(receipt); } catch { /* durable pre-write halt and pending row remain authoritative */ }
      try { await this.transport.close(); } catch { /* queue stays halted; termination is not presumed */ }
      return receipt;
    }
  }
  private async request(action: WaveshareAction, address: number, channel?: number): Promise<number | boolean[] | null> {
    return waveshareResponse(waveshareRequest(action, address, channel), await this.transport.exchange(action, address, channel));
  }
  private async assertAllOff(): Promise<void> {
    for (const endpoint of this.config.endpoints) {
      const coils = await this.request("coils", endpoint.address);
      if (!Array.isArray(coils) || coils.length !== 32 || coils.some(Boolean)) throw new WaveshareError("WAVESHARE_OUTPUTS_NOT_OFF");
    }
  }
  private async assertBoardIdentity(): Promise<void> {
    for (const endpoint of this.config.endpoints) {
      if (await this.request("address", endpoint.address) !== endpoint.address) throw new WaveshareError("WAVESHARE_ADDRESS_MISMATCH");
      if (await this.request("firmware", endpoint.address) !== endpoint.expectedFirmwareRegister) throw new WaveshareError("WAVESHARE_FIRMWARE_MISMATCH");
    }
  }
  private halt(reason: string): void { this.outputState = "UNCERTAIN"; this.initialized = false; this.journal.halt(reason); }
}
function sleep(ms: number): Promise<void> {
  const deadline = performance.now() + ms;
  return new Promise(resolve => { const wait = () => { const remaining = deadline - performance.now(); if (remaining <= 0) resolve(); else setTimeout(wait, Math.ceil(remaining)); }; wait(); });
}
function code(error: unknown): string { return error instanceof WaveshareError ? error.code : "WAVESHARE_IO_OR_PERSISTENCE_FAILED"; }
