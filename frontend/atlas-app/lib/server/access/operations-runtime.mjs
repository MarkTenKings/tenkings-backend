import { makeIntakeConfig, intakeClient } from '@atlas/service-bridge/intake';
import { keyBytes } from '@atlas/service-bridge/protocol';
import { canonical } from '../review-contract.mjs';
import { deny, hash } from '../policy.mjs';
import { makeOperationsAuthorityConfig, StaffOperationsAuthority } from './operations-authority.mjs';
import { StaffOperations } from './operations.mjs';
import { receiptSourceValidation, withSourceIntake } from './intake.mjs';

/** Parse on every request so an old cached service cannot retain removed settings.
 * The source service uses its own deployment and release, independently of staff.
 */
export function operationsRuntimeSettings(env, staffConfig) {
    const local = staffConfig.mode === 'LOCAL_FIXTURE';
    if (local ? !staffConfig.operationsDatabaseUrl : env.ATLAS_OPERATIONS_ENABLED !== 'true') return null;
    if (!local && (staffConfig.mode !== 'PRODUCTION' || env.NODE_ENV !== 'production' || env.VERCEL_ENV !== 'production'
        || Object.keys(env).some(name => name.startsWith('ATLAS_LOCAL_')))) deny(503, 'OPERATIONS_CONFIGURATION_REQUIRED');
    const database = makeOperationsAuthorityConfig({ databaseUrl: local ? staffConfig.operationsDatabaseUrl
        : env.ATLAS_OPERATIONS_DATABASE_URL, staffConfig });
    let intake = null;
    if (!local && env.ATLAS_INTAKE_ENABLED === 'true') {
        const otherKeyHashes = [hash(staffConfig.sessionKey), hash(staffConfig.phoneKey),
            ...['ATLAS_GRADING_BRIDGE_KEY', 'ATLAS_OPERATOR_EVIDENCE_KEY', 'ATLAS_PUBLIC_MEDIA_KEY']
                .filter(name => env[name] !== undefined).map(name => hash(keyBytes(env[name])))];
        intake = makeIntakeConfig({ mode: 'PRODUCTION', origin: env.ATLAS_INTAKE_ORIGIN,
            deploymentId: env.ATLAS_INTAKE_DEPLOYMENT_ID, releaseSha: env.ATLAS_INTAKE_RELEASE_SHA,
            key: keyBytes(env.ATLAS_INTAKE_KEY), gradingPolicyHash: env.ATLAS_INTAKE_GRADING_POLICY_HASH,
            phoneAllowlistHash: hash(canonical([...staffConfig.phoneByHash.keys()].sort())), otherKeyHashes });
    }
    return Object.freeze({ database, intake, key: hash(canonical({ database: database.databaseBindingHash,
        intake: intake?.configHash ?? null })) });
}

export function createOperationsRuntime({ settings, auth, Client, fetchImpl }) {
    if (!settings) return null;
    const client = new Client({ datasources: { db: { url: settings.database.databaseUrl } }, errorFormat: 'minimal' });
    const admin = new StaffOperationsAuthority({ client, auth, config: settings.database });
    const sourceValidation = settings.intake ? receiptSourceValidation({ gradingPolicyHash: settings.intake.gradingPolicyHash,
        bridgeConfigHash: settings.intake.configHash }) : null;
    const operations = new StaffOperations({ admin, sourceValidation });
    return settings.intake ? withSourceIntake({ operations, admin, intake: intakeClient(settings.intake, fetchImpl) }) : operations;
}
