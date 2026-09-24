import { randomUUID } from 'node:crypto';
import { isBoundaryError, privateHeaders } from './policy.mjs';
import { staffContentSecurityPolicy } from '../content-security.mjs';

const boundaryCodes = new Set(['STAFF_ACCESS_NOT_ENABLED', 'ACCESS_CONFIGURATION_INVALID', 'MANUAL_CONFIGURATION_INVALID',
  'STAFF_DATABASE_ROLE_INVALID', 'HOST_NOT_ALLOWED', 'STAFF_COOKIE_REQUIRED', 'SIGN_IN_REQUIRED']);
const databaseCodes = new Set(['P1000', 'P1001', 'P1002', 'P1003', 'P1008', 'P1010', 'P1011', 'P1017', 'P2010', 'P2024', 'P2028', 'P2037']);
function diagnosis(error, stage, env) {
  const code = isBoundaryError(error) && boundaryCodes.has(error.code) ? error.code
    : databaseCodes.has(error?.code) ? error.code : databaseCodes.has(error?.errorCode) ? error.errorCode
      : stage === 'CONTENT_SECURITY_POLICY' ? 'CONTENT_SECURITY_POLICY_INVALID' : 'UNCLASSIFIED';
  const local = ['ATLAS_CONNECTED_LOCAL_FIXTURE', 'ATLAS_LOCAL_SYNTHETIC', 'ATLAS_LOCAL_POSTGRES'].some(key => env[key] === '1');
  // STAFF_ACCESS_NOT_ENABLED also covers a changed database control binding.
  // That code alone cannot establish that this deployment was disabled.
  const disabled = stage === 'RUNTIME' && code === 'STAFF_ACCESS_NOT_ENABLED' && !local
    && (env.ATLAS_STAFF_RUNTIME !== 'postgres' || env.NODE_ENV !== 'production' || env.VERCEL_ENV !== 'production');
  const configuration = stage === 'RUNTIME' && ['ACCESS_CONFIGURATION_INVALID', 'MANUAL_CONFIGURATION_INVALID'].includes(code);
  return { kind: disabled ? 'DISABLED' : configuration ? 'CONFIGURATION' : 'CHECK_FAILED', code };
}

/** Server-only injection keeps the real page gate testable without a DB or
 * credentials. A failed check never returns staff or enables a workspace. */
export function createPageAccess({ resolveRuntime, environment = () => process.env,
  log = entry => console.error(JSON.stringify(entry)), reference = randomUUID }) {
  return async function pageAccess(ctx, { authenticated = true } = {}) {
    privateHeaders(ctx.res);
    if (!['GET', 'HEAD'].includes(ctx.req.method)) {
      ctx.res.setHeader('Allow', 'GET, HEAD'); ctx.res.statusCode = 405;
      return { props: { unavailable: true, accessFailure: { kind: 'METHOD_NOT_ALLOWED' } } };
    }
    let stage = 'RUNTIME';
    const env = environment();
    try {
      const state = resolveRuntime(ctx.req);
      // Build-time headers cannot know a later private upload binding.
      stage = 'CONTENT_SECURITY_POLICY';
      if (state.connectedManual) ctx.res.setHeader('Content-Security-Policy', staffContentSecurityPolicy({ development: env.NODE_ENV === 'development',
        uploadOrigins: [env.ATLAS_WORKSPACE_UPLOAD_ORIGIN, state.connectedManual.uploadOrigin] }));
      stage = 'DATABASE_ACCESS';
      if (state.auth.database) await state.auth.database.transaction(() => undefined);
      if (!authenticated) return { props: { mode: state.mode ?? 'SYNTHETIC_LOCAL' } };
      stage = 'SESSION_ACCESS';
      const staff = await state.auth.maybeAuthenticate(ctx.req.headers.cookie);
      if (!staff) return { redirect: { destination: '/', permanent: false } };
      return { props: { staff, manualEnabled: Boolean(state.connectedManual) } };
    } catch (error) {
      const { kind, code } = diagnosis(error, stage, env), id = reference();
      // Only fixed categories, allowlisted codes and a fresh opaque reference
      // leave this catch. Never log the error/message/stack, request or env.
      try { log({ event: 'ATLAS_STAFF_PAGE_ACCESS_FAILED', reference: id, kind, stage, code, status: 503 }); } catch { /* Logging cannot open access or replace the safe response. */ }
      ctx.res.statusCode = 503;
      return { props: { unavailable: true, accessFailure: { kind, reference: id } } };
    }
  };
}
