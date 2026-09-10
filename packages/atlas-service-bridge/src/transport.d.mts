import type { BridgeConfig, BridgeScope, BridgePayload } from './protocol.mjs';
export function boundedBytes(response: Response, limit: number): Promise<Buffer>;
export function bridgeClient(config: BridgeConfig, fetchImpl?: typeof fetch): {
    binding: { origin: string; clientKeyHash: string };
    call(scope: BridgeScope, payload: BridgePayload): Promise<unknown>;
};
export function boundedWorkerFetch(options: { serviceUrl: string; maxCalls: number; signal: AbortSignal; fetchImpl?: typeof fetch }): typeof fetch;
