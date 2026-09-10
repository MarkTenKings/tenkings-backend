import { requireBridge as check } from '@atlas/service-bridge/protocol';

// Separate machine credential. No human identity/session, authority, public
// approval, legacy business table, invoice settlement or intake write access.
export const OPERATOR_GRANTS = Object.freeze({
    StaffOperatorControl: {}, StaffGradingBridgeControl: {}, StaffControl: {}, StaffSpecimen: {}, StaffAnalysisRevision: {},
    StaffGradingOperation: {},
    StaffOperatorRun: { UPDATE: ['revision','state','inputCanonical','inputHash','leaseOwner','leaseFence','leaseMode','leaseExpiresAt','summary','failureCode','updatedAt',
        'controlState','controlRevision','stepBudget'] },
    StaffOperatorAttempt: { INSERT: ['id','runId','ordinal','runRevision','leaseFence','dispatchClaimId','requestCanonical','requestHash','providerBindingHash','reservedMicroUsd','state','createdAt'],
        UPDATE: ['state','usageCeilingMicroUsd','usageEnvelopeExceeded','resultReceiptId','dispatchedAt','finishedAt'] },
    StaffOperatorReceipt: { INSERT: '*' }, StaffOperatorStep: { INSERT: '*' },
    StaffOperatorImage: { INSERT: '*' }, StaffOperatorImageDelivery: { INSERT: '*' },
    StaffOperatorOutbox: { INSERT: '*', UPDATE: ['state','claimOwner','claimFence','claimUntil','deliveredAt'] },
});
const FUNCTIONS = new Set(['lock_control()', 'lock_operator_control()', 'lock_operator_bridge_control()',
    'lock_operator_specimen(uuid)', 'pilot_budget_usage(uuid, uuid)', 'operator_workspace_count(uuid)',
    'lock_operator_workspace(uuid, uuid)', 'workspace_pilot_budget_usage(uuid, uuid)']);
export function operatorGrantSQL(role) {
    check(/^[a-z][a-z0-9_]{0,62}$/.test(role), 'ASTRA_DATABASE_ROLE_INVALID');
    const grantee = `"${role}"`;
    return [`GRANT USAGE ON SCHEMA atlas_staff TO ${grantee};`,
        ...Object.entries(OPERATOR_GRANTS).flatMap(([table, operations]) => [`GRANT SELECT ON atlas_staff."${table}" TO ${grantee};`,
            ...Object.entries(operations).map(([op, columns]) => `GRANT ${op}${columns === '*' ? '' : ` (${columns.map(c => `"${c}"`).join(',')})`} ON atlas_staff."${table}" TO ${grantee};`)]),
        ...[...FUNCTIONS].map(name => `GRANT EXECUTE ON FUNCTION atlas_staff.${name} TO ${grantee};`)].join('\n');
}
export async function assertOperatorPrivileges(tx) {
    const [role] = await tx.$queryRaw`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
      OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
      OR has_database_privilege(current_user,current_database(),'CREATE') AS unsafe FROM pg_roles r WHERE r.rolname=current_user`;
    check(role && !role.unsafe, 'ASTRA_DATABASE_ROLE_INVALID');
    const schemas = await tx.$queryRaw`SELECT oid FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'
      AND has_schema_privilege(current_user,oid,'CREATE')`;
    check(schemas.length === 0, 'ASTRA_DATABASE_ROLE_INVALID');
    const columns = await tx.$queryRaw`SELECT n.nspname AS schema,c.relname AS name,a.attname AS column,
      has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS sel,
      has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AS ins,
      has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS upd,
      has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') AS refs,
      has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER') AS extra
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'`;
    const seen = new Set();
    for (const col of columns) {
        const allowed = col.schema === 'atlas_staff' && Object.hasOwn(OPERATOR_GRANTS,col.name), grant = allowed ? OPERATOR_GRANTS[col.name] : {};
        const permits = op => grant[op] === '*' || grant[op]?.includes(col.column) === true;
        check(col.sel === Boolean(allowed) && col.ins === permits('INSERT') && col.upd === permits('UPDATE') && !col.refs && !col.extra,
            'ASTRA_DATABASE_ROLE_INVALID');
        if (allowed) seen.add(col.name);
    }
    const sequences = await tx.$queryRaw`SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')`;
    const functions = await tx.$queryRaw`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
      AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
        WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))
      AND p.prorettype<>'trigger'::regtype AND has_function_privilege(current_user,p.oid,'EXECUTE')`;
    check(seen.size === Object.keys(OPERATOR_GRANTS).length && !sequences.length && functions.length === FUNCTIONS.size
        && functions.every(f => f.schema === 'atlas_staff' && FUNCTIONS.has(f.name)), 'ASTRA_DATABASE_ROLE_INVALID');
}
