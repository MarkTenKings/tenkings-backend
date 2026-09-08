import { unavailable } from './policy.mjs';
export const PUBLIC_READER_FUNCTION = 'read_approved_report(text, integer, text, text, text)';
export function publicGrantSQL(role) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)) unavailable();
    return `GRANT USAGE ON SCHEMA atlas_staff TO "${role}"; GRANT EXECUTE ON FUNCTION atlas_staff.${PUBLIC_READER_FUNCTION} TO "${role}";`;
}
export async function assertPublicPrivileges(tx) {
    const [role] = await tx.$queryRaw`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
      OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
      OR has_database_privilege(current_user,current_database(),'CREATE') AS unsafe FROM pg_roles r WHERE r.rolname=current_user`;
    if (!role || role.unsafe) unavailable();
    const schemas = await tx.$queryRaw`SELECT oid FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'
      AND has_schema_privilege(current_user,oid,'CREATE')`;
    const columns = await tx.$queryRaw`SELECT a.attrelid FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
      AND (has_column_privilege(current_user,c.oid,a.attnum,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER'))`;
    const sequences = await tx.$queryRaw`SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')`;
    const functions = await tx.$queryRaw`SELECT n.nspname AS schema, p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prorettype<>'trigger'::regtype
      AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
        WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))
      AND has_function_privilege(current_user,p.oid,'EXECUTE')`;
    if (schemas.length || columns.length || sequences.length || functions.length !== 1
        || functions[0].schema !== 'atlas_staff' || functions[0].name !== PUBLIC_READER_FUNCTION) unavailable();
}
