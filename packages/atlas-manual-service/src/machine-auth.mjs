import { immutable, requireThat, uuid } from './contract.mjs';

/** Private-host continuation of work already admitted by staff. These opaque
 * handles cannot be supplied by HTTP or turned into a browser/human actor.
 * Every short transaction checks the live deployment and owner's access version;
 * browser/session expiry is deliberately not part of server-job authorization. */
export function createMachineStaffBoundary({ boundary, auth, manualClient }) {
  requireThat(typeof boundary?.transaction === 'function' && auth?.config
    && typeof manualClient?.$transaction === 'function', 500, 'MANUAL_MACHINE_CONFIG_INVALID');
  const handles = new WeakMap();
  const { mode, origin, deploymentId, releaseSha, configHash } = auth.config;
  const expected = JSON.stringify({ mode, origin, deploymentId, releaseSha, configHash });
  const phones = [...auth.config.phoneByHash.keys()];

  async function machineTransaction(staff, work) {
    const handle = staff === null ? null : handles.get(staff);
    requireThat(staff === null || handle, 403, 'MANUAL_MACHINE_AUTH_REQUIRED');
    return manualClient.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '3000ms'");
      const [role] = await tx.$queryRawUnsafe(`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
        OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
        OR has_database_privilege(current_user,current_database(),'CREATE')
        OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
          AND has_schema_privilege(current_user,oid,'CREATE'))
        OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN ('atlas_manual','atlas_manual_intake','atlas_manual_connected','atlas_defect_analysis') AND c.relowner=r.oid) AS unsafe
        FROM pg_roles r WHERE r.rolname=current_user`);
      requireThat(role?.unsafe === false, 503, 'MANUAL_DATABASE_ROLE_INVALID');
      const refresh = async () => {
        const rows = await tx.$queryRawUnsafe('SELECT * FROM atlas_manual.authenticate_machine($1::uuid,$2::integer,$3::jsonb,$4::text[])',
          handle?.ownerId ?? null, handle?.accessVersion ?? null, expected, phones);
        requireThat(rows.length === 1, 403, 'MANUAL_MACHINE_ACCESS_REVOKED');
        const found = rows[0];
        return { principal: immutable({ id: found.id, name: found.name, role: found.role, mode,
          accessVersion: found.access_version, actorKind: 'MACHINE', canCertify: false }), now: new Date(found.now_at) };
      };
      const current = await refresh();
      const result = await work({ tx, ...current, refresh });
      await refresh();
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      return result;
    }, { maxWait: 3000, timeout: 5000 });
  }

  return Object.freeze({
    ...boundary,
    machineOwner({ ownerId, accessVersion }) {
      uuid(ownerId);
      requireThat(Number.isSafeInteger(accessVersion) && accessVersion >= 1, 403, 'MANUAL_MACHINE_AUTH_REQUIRED');
      const staff = Object.freeze({ id: ownerId, role: 'REVIEWER', mode, actorKind: 'MACHINE' });
      handles.set(staff, { ownerId, accessVersion });
      return staff;
    },
    machineTransaction,
    transaction(staff, work) {
      return handles.has(staff) ? machineTransaction(staff, work) : boundary.transaction(staff, work);
    },
  });
}

export function machineGrantSQL(role) {
  requireThat(/^[a-z][a-z0-9_]{0,62}$/.test(role));
  return `GRANT EXECUTE ON FUNCTION atlas_manual.authenticate_machine(uuid,integer,jsonb,text[]) TO "${role}";`;
}
