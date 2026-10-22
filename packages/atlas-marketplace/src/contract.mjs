import { createHash } from 'node:crypto';

export class MarketplaceError extends Error {
  constructor(code, message = code) { super(message); this.name = 'MarketplaceError'; this.code = code; }
}
export function fail(code, message = code) { throw new MarketplaceError(code, message); }
export function requireValue(condition, code, message = code) { if (!condition) fail(code, message); }
export function cents(value, { positive = false } = {}) {
  requireValue(Number.isSafeInteger(value) && value >= (positive ? 1 : 0), 'INVALID_CENTS');
  return value;
}
export function sumCents(...values) {
  const result = values.reduce((total, value) => total + BigInt(cents(value)), 0n);
  requireValue(result <= BigInt(Number.MAX_SAFE_INTEGER), 'CENTS_OVERFLOW');
  return Number(result);
}
export function canonicalJSON(value) {
  const visit = (input) => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') { requireValue(Number.isFinite(input), 'INVALID_JSON'); return input; }
    if (Array.isArray(input)) return input.map(visit);
    requireValue(input && typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype, 'INVALID_JSON');
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, visit(input[key])]));
  };
  return JSON.stringify(visit(value));
}
export function hash(value) { return createHash('sha256').update(canonicalJSON(value)).digest('hex'); }
export function clone(value) { return structuredClone(value); }
export function isoTime(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  requireValue(Number.isSafeInteger(time) && time >= 0, 'INVALID_TIME');
  return new Date(time).toISOString();
}
export function nonempty(value, label = 'value') {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= 2048, 'INVALID_TEXT', `Invalid ${label}`);
  return value;
}
