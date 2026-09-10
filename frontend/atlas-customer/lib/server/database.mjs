import { deny } from './policy.mjs';

/** Offline provisioning text only. The application never executes grants. */
export function customerGrantSQL(role) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)) throw new Error('Invalid customer role');
    return `GRANT USAGE ON SCHEMA atlas_customer TO "${role}";\nGRANT EXECUTE ON FUNCTION atlas_customer.customer_call(text,jsonb,jsonb) TO "${role}";`;
}

export async function assertCustomerPrivileges(tx) {
    const [role] = await tx.$queryRaw`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
        OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
        OR has_database_privilege(current_user,current_database(),'CREATE') AS unsafe FROM pg_roles r WHERE r.rolname=current_user`;
    if (!role || role.unsafe) deny(503, 'CUSTOMER_DATABASE_ROLE_INVALID');
    const [access] = await tx.$queryRaw`SELECT
        EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' AND has_schema_privilege(current_user,oid,'CREATE')) AS schema_write,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
            WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
            AND (has_column_privilege(current_user,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER'))) AS table_access,
        EXISTS (WITH sequences AS MATERIALIZED (
            SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%'
        ) SELECT 1 FROM sequences WHERE has_sequence_privilege(current_user,oid,'USAGE,SELECT,UPDATE')) AS sequence_access`;
    if (!access || access.schema_write || access.table_access || access.sequence_access) deny(503, 'CUSTOMER_DATABASE_ROLE_INVALID');
    const functions = await tx.$queryRaw`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,p.prosecdef AS definer
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
            WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))
        AND p.prorettype<>'trigger'::regtype AND has_function_privilege(current_user,p.oid,'EXECUTE')`;
    if (functions.length !== 1 || functions[0].schema !== 'atlas_customer' || functions[0].name !== 'customer_call(text, jsonb, jsonb)'
        || !functions[0].definer) deny(503, 'CUSTOMER_DATABASE_ROLE_INVALID');
}

export class CustomerDatabase {
    constructor(client, config) { this.client = client; this.config = config; }
    async call(action, data) {
        const result = await this.client.$transaction(async tx => {
            await assertCustomerPrivileges(tx);
            const rows = await tx.$queryRaw`SELECT atlas_customer.customer_call(${action},${JSON.stringify(this.config.binding)}::jsonb,${JSON.stringify(data)}::jsonb) AS result`;
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            if (rows.length !== 1 || !rows[0].result || typeof rows[0].result !== 'object') deny(503, 'CUSTOMER_ACCESS_NOT_ENABLED');
            return rows[0].result;
        }, { maxWait: 5000, timeout: 10000 });
        // Denials that consume rates/challenges must commit before surfacing.
        if (result.error) deny(result.error.status, result.error.code);
        return result;
    }
}
