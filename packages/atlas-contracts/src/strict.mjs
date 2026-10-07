import { createHash } from 'node:crypto';

export class ContractError extends Error {
  constructor(code) { super(code); this.name = 'ContractError'; this.code = code; }
}
export function requireThat(condition, code) { if (!condition) throw new ContractError(code); }
export const object = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const text = (maxLength = 160) => ({ type: 'string', minLength: 1, maxLength });
export const enumeration = (...values) => ({ type: 'string', enum: values });
export const integer = (minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
export const list = (items, maxItems = 64, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
export const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
export const id = { ...text(96), pattern: '^[A-Za-z][A-Za-z0-9_-]*$' };
export const digest = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' };

// A deliberately small validator for the schema subset emitted by this package.
// Unsupported keywords fail during schema checking, rather than silently being ignored.
export function checkSchema(schema) {
  const allowed = ['type', 'properties', 'required', 'additionalProperties', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'items', 'minItems', 'maxItems', 'anyOf'];
  requireThat(Object.keys(schema).every(k => allowed.includes(k)), 'UNSUPPORTED_SCHEMA');
  if (schema.anyOf) return schema.anyOf.forEach(checkSchema);
  requireThat(['object', 'array', 'integer', 'number', 'string', 'boolean', 'null'].includes(schema.type), 'UNSUPPORTED_SCHEMA');
  if (schema.type === 'object') {
    requireThat(schema.additionalProperties === false && JSON.stringify(Object.keys(schema.properties).sort()) === JSON.stringify([...schema.required].sort()), 'NON_STRICT_SCHEMA');
    Object.values(schema.properties).forEach(checkSchema);
  }
  if (schema.type === 'array') checkSchema(schema.items);
}
export function validate(schema, value) {
  if (schema.anyOf) {
    requireThat(schema.anyOf.some(option => { try { validate(option, value); return true; } catch { return false; } }), 'SCHEMA_UNION');
    return value;
  }
  if (schema.enum) requireThat(schema.enum.includes(value), 'SCHEMA_ENUM');
  switch (schema.type) {
    case 'null': requireThat(value === null, 'SCHEMA_NULL'); break;
    case 'boolean': requireThat(typeof value === 'boolean', 'SCHEMA_BOOLEAN'); break;
    case 'integer':
    case 'number':
      requireThat(typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)), 'SCHEMA_NUMBER');
      requireThat(value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity), 'SCHEMA_NUMBER_BOUNDS');
      break;
    case 'string':
      requireThat(typeof value === 'string', 'SCHEMA_STRING');
      requireThat(value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? 100000), 'SCHEMA_STRING_BOUNDS');
      if (schema.pattern) requireThat(new RegExp(schema.pattern).test(value), 'SCHEMA_PATTERN');
      break;
    case 'array':
      requireThat(Array.isArray(value) && value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? 100000), 'SCHEMA_ARRAY');
      for (const entry of value) validate(schema.items, entry);
      break;
    case 'object':
      requireThat(value !== null && !Array.isArray(value) && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'SCHEMA_OBJECT');
      requireThat(Object.keys(value).length === schema.required.length && schema.required.every(k => Object.hasOwn(value, k)), 'SCHEMA_KEYS');
      for (const [k, child] of Object.entries(schema.properties)) validate(child, value[k]);
      break;
    default: throw new ContractError('UNSUPPORTED_SCHEMA');
  }
  return value;
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { requireThat(Number.isFinite(value), 'NON_JSON_NUMBER'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  requireThat(value && Object.getPrototypeOf(value) === Object.prototype, 'NON_JSON_OBJECT');
  requireThat(Object.keys(value).every(k => !['__proto__', 'constructor', 'prototype'].includes(k)), 'UNSAFE_JSON_KEY');
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}
export const hash = value => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
export const hashBytes = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export function parseBounded(json, schema, maxBytes = 65536) {
  requireThat(typeof json === 'string' && Buffer.byteLength(json) <= maxBytes, 'JSON_BYTE_CAP');
  let value;
  try { value = JSON.parse(json); } catch { throw new ContractError('INVALID_JSON'); }
  canonical(value);
  return validate(schema, value);
}
export function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
