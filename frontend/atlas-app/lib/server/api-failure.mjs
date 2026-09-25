import { randomUUID } from 'node:crypto';

const contexts = new WeakMap();
const phases = new Set(['STAFF_BEGIN', 'STAFF_PRIVILEGES', 'STAFF_GLOBAL_LOCK', 'STAFF_CONTROL', 'STAFF_WORK', 'STAFF_COMMIT',
  'SESSION_LOOKUP', 'SESSION_RULES', 'IDENTITY_LOCK', 'IDENTITY_RULES']);
const databaseCodes = new Set(['P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1010', 'P1011', 'P1017', 'P2010', 'P2024', 'P2028', 'P2037']);
const sqlStates = new Set(['08000', '08003', '08006', '25006', '25P02', '40001', '40P01', '42501', '42703', '42809',
  '42883', '42P01', '53100', '53200', '53300', '53400', '55P03', '57014', '57P01', 'P0001']);
const names = new Set(['Error', 'TypeError', 'RangeError', 'AbortError', 'TimeoutError', 'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError', 'PrismaClientInitializationError', 'PrismaClientRustPanicError', 'PrismaClientValidationError']);

// Context stays server-side and never alters the original exception or its
// boundary classification. Only fixed phase names can reach a log entry.
export function markAccessFailure(error, phase) {
  if (error && (typeof error === 'object' || typeof error === 'function') && phases.has(phase)) {
    const prior = contexts.get(error) ?? [];
    if (!prior.includes(phase)) contexts.set(error, [...prior, phase].slice(0, 4));
  }
  return error;
}

export function apiRouteCategory(url) {
  const path = typeof url === 'string' ? url.split('?')[0].replace(/^\/admin(?=\/)/, '') : '';
  if (path === '/api/staff/session') return 'SESSION';
  if (/^\/api\/staff\/auth\/(request|verify|logout)$/.test(path)) return 'AUTH';
  if (/^\/api\/staff\/manual-intake\/cards(?:\/discard(?:-status)?)?$/.test(path)) return 'INTAKE_CARDS';
  if (/^\/api\/staff\/manual-intake\/cards\/[^/]+\/uploads\/[^/]+\/(sign|complete|prepare|source)$/.test(path))
    return `UPLOAD_${path.split('/').at(-1).toUpperCase()}`;
  if (path.startsWith('/api/staff/manual-intake/cards/')) return 'INTAKE_CARD';
  if (path.startsWith('/api/staff/manual-connected/batch')) return 'BATCH';
  if (path.startsWith('/api/staff/manual-connected/')) return 'CONNECTED';
  if (path.startsWith('/api/staff/manual/')) return 'MANUAL';
  return 'OTHER';
}

/** No messages, stacks, queries, cookies, URLs, bodies or environment objects.
 * Correlation is an opaque generated value, never an incoming header. */
export function recordApiFailure({ error, stage, req, elapsedMs, env = {}, log = entry => console.error(JSON.stringify(entry)), reference = randomUUID }) {
  const id = reference();
  const entry = { event: 'ATLAS_STAFF_API_FAILED', reference: id, status: 503,
    stage: ['RUNTIME', 'INGRESS', 'MANUAL_PROXY', 'ROUTE', 'SESSION', 'ACTION'].includes(stage) ? stage : 'UNKNOWN',
    route: apiRouteCategory(req?.url), method: ['GET', 'POST', 'HEAD'].includes(req?.method) ? req.method : 'OTHER',
    elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, Math.round(elapsedMs)) : null,
    errorClass: names.has(error?.name) ? error.name : 'UNCLASSIFIED',
    databaseCode: databaseCodes.has(error?.code) ? error.code : databaseCodes.has(error?.errorCode) ? error.errorCode : null,
    sqlState: sqlStates.has(error?.meta?.code) ? error.meta.code : null,
    phases: error && (typeof error === 'object' || typeof error === 'function') ? contexts.get(error) ?? [] : [],
    release: /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? '') ? env.VERCEL_GIT_COMMIT_SHA : null };
  try { log(entry); } catch { /* A logging failure cannot change the denial. */ }
  return id;
}
