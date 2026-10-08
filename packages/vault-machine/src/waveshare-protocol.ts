/** Reviewed subset of Waveshare's 32CH Development Protocol V2. No persistent ON,
 * bulk output, toggle, broadcast, address change, or host-timed pulse is exposed. */
export type WaveshareAction = "address" | "firmware" | "coils" | "pulse100ms";
export class WaveshareError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function boundedInteger(value: unknown, min: number, max: number, code = "WAVESHARE_CONFIG_INVALID"): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new WaveshareError(code);
}
export function modbusCrc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xa001 : 0);
  }
  return crc;
}
export function withModbusCrc(payload: Uint8Array): Buffer {
  const frame = Buffer.alloc(payload.length + 2); frame.set(payload);
  frame.writeUInt16LE(modbusCrc16(payload), payload.length); return frame;
}
export function waveshareRequest(action: WaveshareAction, address: number, channel?: number): Buffer {
  boundedInteger(address, 1, 247, "WAVESHARE_ADDRESS_INVALID");
  let fn: number; let register: number; let value = 1;
  switch (action) {
    case "address": fn = 3; register = 0x4000; break;
    case "firmware": fn = 3; register = 0x8000; break;
    case "coils": fn = 1; register = 0; value = 32; break;
    case "pulse100ms": boundedInteger(channel, 1, 32, "WAVESHARE_CHANNEL_INVALID"); fn = 5; register = 0x0200 + channel - 1; break;
    default: throw new WaveshareError("WAVESHARE_COMMAND_BLOCKED");
  }
  const payload = Buffer.alloc(6); payload[0] = address; payload[1] = fn;
  payload.writeUInt16BE(register, 2); payload.writeUInt16BE(value, 4); return withModbusCrc(payload);
}
export function waveshareResponse(request: Buffer, response: Buffer): number | boolean[] | null {
  if (response.length < 5 || response.length > 9 || modbusCrc16(response.subarray(0, -2)) !== response.readUInt16LE(response.length - 2)) throw new WaveshareError("WAVESHARE_RESPONSE_CRC");
  if (response[0] !== request[0]) throw new WaveshareError("WAVESHARE_RESPONSE_ADDRESS");
  if (response[1] === (request[1]! | 0x80) && response.length === 5) throw new WaveshareError("WAVESHARE_MODBUS_EXCEPTION");
  if (response[1] !== request[1]) throw new WaveshareError("WAVESHARE_RESPONSE_FUNCTION");
  if (request[1] === 5) {
    if (!response.equals(request)) throw new WaveshareError("WAVESHARE_RESPONSE_ECHO");
    return null;
  }
  if (request[1] === 3 && response.length === 7 && response[2] === 2) return response.readUInt16BE(3);
  if (request[1] === 1 && response.length === 9 && response[2] === 4) return Array.from({ length: 32 }, (_, bit) => Boolean(response[3 + Math.floor(bit / 8)]! & (1 << (bit % 8))));
  throw new WaveshareError("WAVESHARE_RESPONSE_LENGTH");
}
