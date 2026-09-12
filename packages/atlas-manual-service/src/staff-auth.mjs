import { requireThat, immutable } from './contract.mjs';

/** Narrow bridge to the EXISTING DurableStaffAuth instance. A spread/copied
 * staff object fails its private WeakMap. Authentication uses ordinary cookies
 * and CSRF; no browser actor/HUMAN declaration enters this boundary.
 * manualClient is a separate, least-privilege Prisma-compatible DB client.
 */
export function createDurableStaffBoundary({ auth, manualClient }) {
  requireThat(auth?.actors instanceof WeakMap && typeof auth.authenticate === 'function'
    && typeof manualClient?.$transaction === 'function', 500, 'MANUAL_AUTH_ADAPTER_INVALID');
  const { mode, origin, deploymentId, releaseSha, configHash } = auth.config;
  const expected = JSON.stringify({ mode, origin, deploymentId, releaseSha, configHash });
  const phones = [...auth.config.phoneByHash.keys()];
  return Object.freeze({
    authenticate: (cookie, csrf) => auth.authenticate(cookie, csrf),
    async transaction(staff, work) {
      const handle = auth.actors.get(staff);
      requireThat(handle, 401, 'SIGN_IN_REQUIRED');
      return manualClient.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'");
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
        const [role] = await tx.$queryRawUnsafe(`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
          OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
          OR has_database_privilege(current_user,current_database(),'CREATE')
          OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
            AND has_schema_privilege(current_user,oid,'CREATE'))
          OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname IN ('atlas_manual','atlas_manual_intake','atlas_manual_connected') AND c.relowner=r.oid) AS unsafe
          FROM pg_roles r WHERE r.rolname=current_user`);
        requireThat(role && role.unsafe === false, 503, 'MANUAL_DATABASE_ROLE_INVALID');
        const refresh = async () => {
          const rows = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.authenticate($1,$2,$3::jsonb,$4::text[])',
            handle.sessionHash, handle.browserHash, expected, phones);
          requireThat(rows.length === 1, 401, 'SIGN_IN_REQUIRED');
          const found = rows[0];
          return { principal: immutable({ id: found.id, name: found.name, role: found.role, mode,
            accessVersion: found.access_version,
            canCertify: found.role === 'REVIEWER' && found.certification_until !== null
              && new Date(found.certification_until) > new Date(found.now_at) }), now: new Date(found.now_at) };
        };
        const current = await refresh();
        const result = await work({ tx, ...current, refresh });
        // Row locks prevent explicit revocation, but cannot stop wall-clock
        // expiry while a different card-row lock is being acquired.
        await refresh();
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        return result;
      }, { maxWait: 3000, timeout: 5000 });
    },
  });
}

/** The existing staff role is unchanged and retains its exact privilege check.
 * Apply these grants only to a separately reviewed manual-serving role.
 */
export function manualGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT USAGE ON SCHEMA atlas_manual TO "${role}";
GRANT EXECUTE ON FUNCTION atlas_manual.authenticate(text,text,jsonb,text[]) TO "${role}";
GRANT SELECT, INSERT ON atlas_manual.card TO "${role}";
GRANT UPDATE (revision,content,content_hash,updated_at) ON atlas_manual.card TO "${role}";
GRANT SELECT, INSERT ON atlas_manual.action, atlas_manual.approval TO "${role}";`;
}
