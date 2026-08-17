import {
  VAULT_DOOR_COUNT,
  VAULT_DOOR_MAP,
  type VaultDoorId,
} from "../../vault-contracts/dist";
import type {
  ControllerAdapter,
  ControllerCommand,
  ControllerReceipt,
} from "../../vault-contracts/dist";
import { digest } from "./util";

export type ControllerFault = "ACK" | "NAK" | "TIMEOUT" | "DISCONNECT" | "WRONG_DOOR";
export interface ControllerSimulatorStep { fault: ControllerFault; observedDoorId?: VaultDoorId; delayMs?: number }
type DoorMapping = Array<{ doorId: VaultDoorId; controllerChannel: number }>;

const CANONICAL_DOORS = new Set<VaultDoorId>(VAULT_DOOR_MAP.map(({ doorId }) => doorId));
const AUTHORITIES = new Set<ControllerCommand["authority"]>(["PAID_SALE", "RESTOCK", "CERTIFICATION"]);

function uniqueErrors(errors: string[]): string[] { return [...new Set(errors)]; }

function mappingErrors(mapping: DoorMapping): string[] {
  const errors: string[] = [];
  const doorIds = mapping.map((entry) => entry.doorId);
  const channels = mapping.map((entry) => entry.controllerChannel);
  if (mapping.length !== VAULT_DOOR_COUNT) errors.push("MAPPING_COUNT");
  if (new Set(doorIds).size !== doorIds.length) errors.push("DUPLICATE_DOOR");
  if (new Set(channels).size !== channels.length) errors.push("DUPLICATE_CHANNEL");
  if (doorIds.some((doorId) => !CANONICAL_DOORS.has(doorId))) errors.push("NON_CANONICAL_DOOR");
  if (VAULT_DOOR_MAP.some(({ doorId }) => !doorIds.includes(doorId))) errors.push("CANONICAL_DOOR_MISSING");
  if (channels.some((channel) => !Number.isInteger(channel))) errors.push("CHANNEL_INTEGER");
  if (channels.some((channel) => !Number.isInteger(channel) || channel < 1 || channel > VAULT_DOOR_COUNT)) errors.push("CHANNEL_RANGE");
  return uniqueErrors(errors);
}

/** Deterministic G-02-safe simulator. It never opens or addresses physical hardware. */
export class DeterministicControllerSimulator implements ControllerAdapter {
  private steps: ControllerSimulatorStep[] = [];
  private sequence = 0;
  private inFlight = 0;
  private highestConcurrency = 0;
  private readonly mapping: DoorMapping;
  private readonly configuredMappingErrors: string[];
  private readonly channelByDoor: Map<VaultDoorId, number>;
  private readonly doorByChannel: Map<number, VaultDoorId>;
  readonly receipts: ControllerReceipt[] = [];

  constructor(mapping: DoorMapping, private connected = true) {
    this.mapping = mapping.map((entry) => ({ ...entry }));
    this.configuredMappingErrors = mappingErrors(this.mapping);
    this.channelByDoor = new Map(this.mapping.map(({ doorId, controllerChannel }) => [doorId, controllerChannel]));
    this.doorByChannel = new Map(this.mapping.map(({ doorId, controllerChannel }) => [controllerChannel, doorId]));
  }
  script(...steps: ControllerSimulatorStep[]): this { this.steps.push(...steps); return this; }
  setConnected(connected: boolean): void { this.connected = connected; }

  async identity(): Promise<{ adapter: string; firmware: string | null; mappingDigest: string; ready: boolean }> {
    return { adapter: "ten-kings-deterministic-controller-simulator", firmware: "SIM-1", mappingDigest: digest(this.mapping), ready: this.connected && this.configuredMappingErrors.length === 0 };
  }

  async validateMapping(mapping: DoorMapping): Promise<{ valid: boolean; errors: string[] }> {
    const errors = mappingErrors(mapping);
    if (this.configuredMappingErrors.length) errors.push("SIMULATOR_MAPPING_INVALID");
    if (errors.length === 0) {
      for (const { doorId, controllerChannel } of mapping) {
        if (this.channelByDoor.get(doorId) !== controllerChannel) errors.push("DOOR_TO_CHANNEL_MISMATCH");
        if (this.doorByChannel.get(controllerChannel) !== doorId) errors.push("CHANNEL_TO_DOOR_MISMATCH");
      }
    }
    const unique = uniqueErrors(errors);
    return { valid: unique.length === 0, errors: unique };
  }

  async sendOpenCommand(command: ControllerCommand): Promise<ControllerReceipt> {
    this.inFlight += 1; this.highestConcurrency = Math.max(this.highestConcurrency, this.inFlight);
    try {
      if (!AUTHORITIES.has(command.authority)) return this.record(command, "REJECTED", undefined, "AUTHORITY_INVALID");
      if (command.attempt !== 1 && command.attempt !== 2) return this.record(command, "REJECTED", undefined, "ATTEMPT_INVALID");
      if (command.authority !== "PAID_SALE" && command.attempt !== 1) return this.record(command, "REJECTED", undefined, "AUTHORITY_ATTEMPT_MISMATCH");
      if (
        this.configuredMappingErrors.length
        || this.channelByDoor.get(command.doorId) !== command.controllerChannel
        || this.doorByChannel.get(command.controllerChannel) !== command.doorId
      ) return this.record(command, "REJECTED", undefined, "MAPPING_MISMATCH");
      const step = this.steps.shift() ?? { fault: "ACK" as const };
      if (step.delayMs) await new Promise<void>((resolve) => setTimeout(resolve, step.delayMs));
      if (!this.connected || step.fault === "DISCONNECT") return this.record(command, "SENT_UNKNOWN", undefined, "TRANSPORT_DISCONNECTED");
      switch (step.fault) {
        case "ACK": return this.record(command, "ACCEPTED");
        case "NAK": return this.record(command, "REJECTED", undefined, "SIMULATED_NAK");
        case "TIMEOUT": return this.record(command, "TIMEOUT", undefined, "SIMULATED_TIMEOUT");
        case "WRONG_DOOR": {
          const scriptedDoor = step.observedDoorId && step.observedDoorId !== command.doorId && this.channelByDoor.has(step.observedDoorId)
            ? step.observedDoorId
            : undefined;
          const observedDoorId = scriptedDoor ?? this.mapping.find((entry) => entry.doorId !== command.doorId)!.doorId;
          return this.record(command, "ACCEPTED", observedDoorId, "WRONG_DOOR");
        }
      }
    } finally { this.inFlight -= 1; }
  }

  maxObservedConcurrency(): number { return this.highestConcurrency; }

  private record(command: ControllerCommand, outcome: ControllerReceipt["outcome"], observedDoorId?: VaultDoorId, evidenceCode?: string): ControllerReceipt {
    const receipt: ControllerReceipt = { commandId: command.commandId, outcome, controllerSequence: ++this.sequence, ...(observedDoorId ? { observedDoorId } : {}), ...(evidenceCode ? { evidenceCode } : {}) };
    this.receipts.push(receipt);
    return receipt;
  }
}
