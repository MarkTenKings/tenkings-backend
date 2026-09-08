import { deny } from '../policy.mjs';

// Serving credentials cannot activate a deployment, train a reviewer, assign a
// card, change evidence or reach the legacy card/financial schema.
export const STAFF_GRANTS = Object.freeze({
    StaffControl: {},
    StaffGradingBridgeControl: {},
    StaffIdentity: { INSERT: ['id', 'phoneHash', 'lastLoginAt'], UPDATE: ['name', 'lastLoginAt'] },
    StaffBrowser: { INSERT: '*' },
    StaffChallenge: { INSERT: '*', UPDATE: ['state', 'verificationSid', 'attempts', 'checkClaimId', 'replayHash', 'replayUntil', 'consumedAt'] },
    StaffSession: { INSERT: '*', UPDATE: ['revokedAt'] },
    StaffRateBucket: { INSERT: '*', UPDATE: '*' },
    StaffAudit: { INSERT: '*' },
    StaffSpecimen: { UPDATE: ['draftRevision'] },
    StaffAssignment: {},
    StaffReviewRevision: { INSERT: '*' },
    StaffOperation: { INSERT: '*' },
    StaffAnalysisRevision: {},
    StaffGradingOperation: { INSERT: '*', UPDATE: ['state', 'dispatchedAt', 'finishedAt', 'resultAnalysisRevision', 'failureCode'] },
    StaffReportApproval: { INSERT: '*' },
    StaffPublicReport: { INSERT: '*', UPDATE: ['currentApprovalId'] },
});
const FUNCTIONS = new Set(['lock_control()', 'lock_assignment(uuid, uuid)']);

export function staffGrantSQL(role) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)) throw new Error('Invalid staff role name');
    const grantee = `"${role}"`;
    return [`GRANT USAGE ON SCHEMA atlas_staff TO ${grantee};`,
        ...Object.entries(STAFF_GRANTS).flatMap(([table, operations]) => [
            `GRANT SELECT ON atlas_staff."${table}" TO ${grantee};`,
            ...Object.entries(operations).map(([op, columns]) => `GRANT ${op}${columns === '*' ? '' : ` (${columns.map(c => `"${c}"`).join(',')})`} ON atlas_staff."${table}" TO ${grantee};`),
        ]), ...[...FUNCTIONS].map(name => `GRANT EXECUTE ON FUNCTION atlas_staff.${name} TO ${grantee};`)].join('\n');
}

export async function assertStaffPrivileges(tx) {
    const [role] = await tx.$queryRaw`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
      OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid)
      OR has_database_privilege(current_user, current_database(), 'CREATE') AS unsafe
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (!role || role.unsafe) deny(503, 'STAFF_DATABASE_ROLE_INVALID');
    const schemas = await tx.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%'
      AND nspname <> 'information_schema' AND has_schema_privilege(current_user, oid, 'CREATE')`;
    if (schemas.length) deny(503, 'STAFF_DATABASE_ROLE_INVALID');
    const columns = await tx.$queryRaw`SELECT n.nspname AS schema, c.relname AS name, a.attname AS column,
      has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS sel,
      has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AS ins,
      has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS upd,
      has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') AS refs,
      has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER') AS extra
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
      AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'`;
    const seen = new Set();
    for (const column of columns) {
        const allowed = column.schema === 'atlas_staff' && Object.hasOwn(STAFF_GRANTS, column.name);
        const grant = allowed ? STAFF_GRANTS[column.name] : {};
        const permits = op => grant[op] === '*' || grant[op]?.includes(column.column) === true;
        if (column.sel !== Boolean(allowed) || column.ins !== permits('INSERT') || column.upd !== permits('UPDATE') || column.refs || column.extra)
            deny(503, 'STAFF_DATABASE_ROLE_INVALID');
        if (allowed) seen.add(column.name);
    }
    if (seen.size !== Object.keys(STAFF_GRANTS).length) deny(503, 'STAFF_DATABASE_ROLE_INVALID');
    const sequences = await tx.$queryRaw`SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')`;
    const functions = await tx.$queryRaw`SELECT n.nspname AS schema, p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND NOT (NOT p.prosecdef AND p.probin = '$libdir/uuid-ossp' AND EXISTS (
        SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
        WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass
        AND d.deptype='e' AND e.extname='uuid-ossp'))
      AND p.prorettype <> 'trigger'::regtype AND has_function_privilege(current_user,p.oid,'EXECUTE')`;
    if (sequences.length || functions.length !== FUNCTIONS.size || functions.some(f => f.schema !== 'atlas_staff' || !FUNCTIONS.has(f.name)))
        deny(503, 'STAFF_DATABASE_ROLE_INVALID');
}
