import { DurableStaffAuth } from './auth.mjs';
import { deny, hash } from '../policy.mjs';
import { STAFF_APPLICATION, STAFF_BASE_PATH } from '../../routes.mjs';
import { STAFF_ORIGIN } from './config.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const ROLE = /^[a-z][a-z0-9_]{0,62}$/;
const fail = (condition, code = 'OPERATIONS_DATABASE_ROLE_INVALID') => { if (!condition) deny(503, code); };
const date = value => value instanceof Date && Number.isFinite(+value);

// Separate credential from the serving app. No activation, grant provisioning,
// session issuance, public schema, grade execution, approval or learning writes.
// Explicit write columns also reject a privilege added by a future migration.
export const OPERATION_GRANTS = Object.freeze(Object.fromEntries(Object.entries({
    StaffControl: {}, StaffOperationsGrant: {}, StaffSession: {}, StaffBrowser: {}, StaffSourceAdmission: {},
    StaffIdentity: { UPDATE: ['role', 'accessVersion', 'revokedAt', 'certificationUntil', 'trustedLearningUntil'] },
    StaffAudit: { INSERT: ['id', 'event', 'subjectId', 'actorId', 'details', 'createdAt'] },
    StaffSpecimen: { INSERT: ['id', 'sourceType', 'sourceId', 'sourceOwnerId', 'title', 'subtitle', 'evidenceCanonical',
        'evidenceHash', 'evidenceRevision', 'draftRevision', 'analysisRevision', 'createdAt'] },
    StaffReviewRevision: { INSERT: ['specimenId', 'revision', 'evidenceRevision', 'evidenceHash', 'contentHash',
        'analysisRevision', 'canonical', 'savedById', 'savedAt'] },
    StaffAssignment: { INSERT: ['specimenId', 'identityId', 'fence', 'canReview', 'expiresAt', 'revokedAt'],
        UPDATE: ['fence', 'canReview', 'expiresAt', 'revokedAt'] },
    StaffGradingExecution: { UPDATE: ['actualMicroUsd', 'costEvidenceHash'] },
    StaffOperatorAttempt: { UPDATE: ['actualMicroUsd', 'costEvidenceHash'] },
    StaffGradingOperation: {}, StaffOperatorRun: {}, StaffMachineInitialization: {}, StaffAnalysisRevision: {},
    StaffWorkspaceSourceOperation: {}, StaffWorkspaceInfrastructureReservation: {},
    StaffOperationalResolution: { INSERT: ['id', 'kind', 'recordId', 'specimenId', 'pilotId', 'operationId', 'actorId',
        'sessionHash', 'accessVersion', 'controlRevision', 'operationsGrantId', 'inputHash', 'bindingHash',
        'sourceEvidenceHash', 'evidenceHash', 'reason', 'createdAt'] },
}).map(([table, grants]) => [table, Object.freeze(Object.fromEntries(Object.entries(grants)
    .map(([operation, columns]) => [operation, Object.freeze(columns)])))])));

const FUNCTIONS = Object.freeze(['lock_control()', 'lock_operations_grants(uuid)', 'lock_source_admissions(uuid, text, uuid, text, text, text)',
    'apply_operational_resolution(uuid)', 'customer_operations(text, text, text, jsonb, jsonb)']);

/** Offline reviewed provisioning helper only; the runtime never executes it. */
export function operationsGrantSQL(role) {
    fail(typeof role === 'string' && ROLE.test(role));
    const grantee = `"${role}"`;
    return [`GRANT USAGE ON SCHEMA atlas_staff TO ${grantee};`,
        ...Object.entries(OPERATION_GRANTS).flatMap(([table, grants]) => [
            `GRANT SELECT ON atlas_staff."${table}" TO ${grantee};`,
            ...Object.entries(grants).map(([operation, columns]) =>
                `GRANT ${operation} (${columns.map(column => `"${column}"`).join(',')}) ON atlas_staff."${table}" TO ${grantee};`),
        ]), ...FUNCTIONS.map(name => `GRANT EXECUTE ON FUNCTION atlas_staff.${name} TO ${grantee};`)].join('\n');
}

/** Check actual effective rights, including inheritance/PUBLIC grants, each time. */
export async function assertOperationsPrivileges(tx, config) {
    const [role] = await tx.$queryRaw`SELECT current_user::text AS role, current_database()::text AS database,
        r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
        OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
        OR has_database_privilege(current_user,current_database(),'CREATE') AS unsafe
        FROM pg_roles r WHERE r.rolname=current_user`;
    fail(role && !role.unsafe && role.role === config.roleName && role.database === config.databaseName);
    const schemas = await tx.$queryRaw`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%'
        AND nspname<>'information_schema' AND has_schema_privilege(current_user,oid,'CREATE')`;
    fail(schemas.length === 0);
    const columns = await tx.$queryRaw`SELECT n.nspname AS schema,c.relname AS name,a.attname AS column,
        has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS sel,
        has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AS ins,
        has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS upd,
        has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') AS refs,
        has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER') AS extra
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
        AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'`;
    const seen = new Set(), seenWrites = new Set();
    for (const column of columns) {
        const allowed = column.schema === 'atlas_staff' && Object.hasOwn(OPERATION_GRANTS, column.name);
        const grants = allowed ? OPERATION_GRANTS[column.name] : {};
        fail(column.sel === Boolean(allowed) && column.ins === (grants.INSERT?.includes(column.column) === true)
            && column.upd === (grants.UPDATE?.includes(column.column) === true) && !column.refs && !column.extra);
        if (allowed) seen.add(column.name);
        for (const operation of ['INSERT', 'UPDATE']) if (grants[operation]?.includes(column.column))
            seenWrites.add(`${column.name}:${operation}:${column.column}`);
    }
    fail(seen.size === Object.keys(OPERATION_GRANTS).length);
    fail(Object.values(OPERATION_GRANTS).reduce((count, grants) => count + (grants.INSERT?.length ?? 0) + (grants.UPDATE?.length ?? 0), 0) === seenWrites.size);
    const sequences = await tx.$queryRaw`SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%' AND has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE')`;
    const functions = await tx.$queryRaw`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,
        p.prosecdef AS definer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS (
            SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
            WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass
            AND d.deptype='e' AND e.extname='uuid-ossp'))
        AND p.prorettype<>'trigger'::regtype AND has_function_privilege(current_user,p.oid,'EXECUTE')`;
    fail(sequences.length === 0 && functions.length === FUNCTIONS.length && functions.every(row =>
        row.schema === 'atlas_staff' && row.definer === true && FUNCTIONS.includes(row.name)));
}

/** Explicit separate connection to the same database, never an owner fallback. */
export function makeOperationsAuthorityConfig({ databaseUrl, staffConfig }) {
    let operations, serving;
    try { operations = new URL(databaseUrl); serving = new URL(staffConfig.databaseUrl); }
    catch { fail(false, 'OPERATIONS_CONFIGURATION_REQUIRED'); }
    const port = url => url.port || '5432';
    const decode = value => { try { return decodeURIComponent(value); } catch { fail(false, 'OPERATIONS_CONFIGURATION_REQUIRED'); } };
    const roleName = decode(operations.username), databaseName = decode(operations.pathname.slice(1));
    const keys = [...operations.searchParams.keys()];
    fail(typeof databaseUrl === 'string' && ['postgres:', 'postgresql:'].includes(operations.protocol)
        && operations.hostname === serving.hostname && port(operations) === port(serving)
        && operations.pathname === serving.pathname && operations.pathname !== '/' && !operations.hash
        && operations.password && ROLE.test(roleName) && roleName !== decode(serving.username)
        && operations.searchParams.get('schema') === 'atlas_staff'
        && operations.searchParams.get('sslmode') === serving.searchParams.get('sslmode')
        && keys.length === new Set(keys).size
        && keys.every(key => ['schema', 'sslmode', 'connection_limit', 'pool_timeout', 'connect_timeout'].includes(key))
        && ['PRODUCTION', 'LOCAL_FIXTURE'].includes(staffConfig.mode)
        && staffConfig.application === STAFF_APPLICATION && staffConfig.basePath === STAFF_BASE_PATH
        && SHA.test(staffConfig.configHash ?? '') && /^[a-f0-9]{40}$/.test(staffConfig.releaseSha ?? ''),
    'OPERATIONS_CONFIGURATION_REQUIRED');
    if (staffConfig.mode === 'LOCAL_FIXTURE') fail(operations.hostname === '127.0.0.1'
        && staffConfig.releaseSha === '0'.repeat(40), 'OPERATIONS_CONFIGURATION_REQUIRED');
    else fail(operations.searchParams.get('sslmode') === 'require' && staffConfig.origin === STAFF_ORIGIN
        && staffConfig.releaseSha !== '0'.repeat(40) && !['localhost', '127.0.0.1', '[::1]'].includes(operations.hostname),
    'OPERATIONS_CONFIGURATION_REQUIRED');
    return Object.freeze({ databaseUrl: operations.href, roleName, databaseName, databaseBindingHash: hash(operations.href),
        mode: staffConfig.mode, origin: staffConfig.origin, deploymentId: staffConfig.deploymentId,
        releaseSha: staffConfig.releaseSha, configHash: staffConfig.configHash });
}

/**
 * StaffOperations' admin.transaction port. This accepts only handles previously
 * registered by the exact DurableStaffAuth instance; it does not accept a role,
 * identity ID, cookie, authorization header or browser assertion as authority.
 * The separately supplied client must use config.databaseUrl. Never expose this
 * client or the callback transaction to HTTP callers.
 *
 * Lead-owned schema contract: StaffOperationsGrant has immutable id/identityId,
 * accessVersion/controlRevision, mode/origin/deploymentId/releaseSha/configHash,
 * authorizationEvidenceHash, createdAt/expiresAt, and nullable one-way revokedAt.
 * lock_operations_grants(identity uuid) returns that identity's rows FOR SHARE
 * as SECURITY DEFINER with fixed pg_catalog,atlas_staff search_path. Grant
 * creation/revocation is exclusively an explicit offline provisioning action.
 */
export class StaffOperationsAuthority {
    constructor({ client, auth, config }) {
        fail(auth instanceof DurableStaffAuth && auth.actors instanceof WeakMap && typeof client?.$transaction === 'function'
            && client !== auth.database?.client, 'OPERATIONS_CONFIGURATION_REQUIRED');
        const verified = makeOperationsAuthorityConfig({ databaseUrl: config?.databaseUrl, staffConfig: auth.config });
        fail(['roleName', 'databaseName', 'databaseBindingHash', 'mode', 'origin', 'deploymentId', 'releaseSha', 'configHash']
            .every(key => verified[key] === config[key]), 'OPERATIONS_CONFIGURATION_REQUIRED');
        this.client = client; this.auth = auth; this.config = verified;
    }
    assertControl(control) {
        fail(control?.enabled === true && ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash']
            .every(key => control[key] === this.config[key]) && Number.isSafeInteger(control.revision) && control.revision > 0,
        'STAFF_ACCESS_NOT_ENABLED');
    }
    async current(tx, control, now, handle) {
        const current = await this.auth.current({ tx, control, now }, handle.sessionHash, handle.browserHash);
        const session = current?.session, browser = session?.browser;
        if (!current || !date(now) || !date(session.createdAt) || session.createdAt > now || +now - +session.createdAt > 300_000
            || !date(session.expiresAt) || session.expiresAt <= now || !date(browser?.createdAt) || browser.createdAt > session.createdAt
            || !date(browser.expiresAt) || browser.expiresAt <= now || browser.tokenHash !== handle.browserHash
            || !UUID.test(current.identity.id) || session.tokenHash !== handle.sessionHash)
            deny(403, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        return current;
    }
    async grant(tx, control, current, now) {
        const rows = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_operations_grants(${current.identity.id}::uuid)`;
        const matches = rows.filter(row => row.identityId === current.identity.id && row.accessVersion === current.identity.accessVersion
            && row.controlRevision === control.revision && row.revokedAt === null
            && ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'].every(key => row[key] === this.config[key])
            && UUID.test(row.id ?? '') && SHA.test(row.authorizationEvidenceHash ?? '')
            && date(row.createdAt) && date(row.expiresAt) && row.createdAt <= now && row.expiresAt > now && row.expiresAt > row.createdAt);
        if (matches.length !== 1) deny(403, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
        return matches[0];
    }
    async transaction(staff, work) {
        const handle = this.auth.actors.get(staff);
        if (!handle || !SHA.test(handle.sessionHash ?? '') || !SHA.test(handle.browserHash ?? '')) deny(401, 'SIGN_IN_REQUIRED');
        // A nested auth.withStaff transaction would hold this same advisory lock
        // on a second connection and deadlock. Reuse auth.current inside ours.
        return this.client.$transaction(async tx => {
            await assertOperationsPrivileges(tx, this.config);
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
            const controls = await tx.$queryRaw`SELECT * FROM atlas_staff.lock_control()`;
            fail(controls.length === 1, 'STAFF_ACCESS_NOT_ENABLED');
            const control = controls[0]; this.assertControl(control);
            const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            const current = await this.current(tx, control, now, handle);
            const grant = await this.grant(tx, control, current, now);
            const result = await work({ tx, control, now, identity: current.identity, session: current.session,
                actorKind: 'HUMAN', capability: 'OPERATIONS', capabilityUntil: grant.expiresAt, operationsGrantId: grant.id });
            const [{ now: finishedAt }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
            const latest = await this.current(tx, control, finishedAt, handle);
            const finalGrant = await this.grant(tx, control, latest, finishedAt);
            if (finalGrant.id !== grant.id) deny(403, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
            // Prisma 5.22 can otherwise report a success after a deferred COMMIT
            // failure. No provider, storage or other external I/O runs in work.
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            return result;
        }, { maxWait: 5000, timeout: 10_000 });
    }
}
