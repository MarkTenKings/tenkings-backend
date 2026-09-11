import { requireBridge as check } from './protocol.mjs';

// Pinned scalar columns: new schema fields never inherit access accidentally.
// The original adapters read full immutable rows, so those SELECT rosters are
// explicit. Mutations are separately enumerated; no wildcard rights or deletes.
const COLUMNS = {
    atlas_staff: {
        StaffOperatorImageControl: 'id enabled mode origin deploymentId releaseSha configHash clientKeyHash revision updatedAt'.split(' '),
        StaffControl: 'id enabled mode origin deploymentId releaseSha configHash gradingPolicyHash revision updatedAt'.split(' '),
        StaffWorkspaceControl: 'id enabled mode releaseSha configHash cohortId maxCards intakeEnabled claimsEnabled preparationEnabled astraEnabled processingLimit expiresAt revision updatedAt'.split(' '),
        StaffWorkspaceSourceControl: 'id enabled mode releaseSha configHash sourceConfigHash sourceDeploymentId sourceReleaseSha cohortId pilotId physicalReserveMicroUsd preparationReserveMicroUsd registrationReserveMicroUsd infrastructureReserveMicroUsd expiresAt revision updatedAt'.split(' '),
        StaffIdentity: 'id phoneHash name role accessVersion revokedAt certificationUntil trustedLearningUntil createdAt lastLoginAt'.split(' '),
        StaffWorkspaceCard: 'id creatorId cohortId revision state stage specimenId canonical contentHash createdAt updatedAt'.split(' '),
        StaffWorkspaceOperation: 'id actorId operationId cardId action inputHash canonical contentHash createdAt'.split(' '),
        StaffWorkspaceSourceAdmission: 'requestId cardId specimenId sourceType sourceId sourceOwnerId sourceRevision sourceHash evidenceCanonical evidenceHash admissionCanonical admissionHash sourceConfigHash actorKind actorId sessionHash accessVersion createdAt'.split(' '),
        StaffWorkspaceSourceActionPermit: 'requestId cardId runId runRevision runControlRevision claimFence captureHash selectionStepId selectionResultHash mode state createdAt finishedAt'.split(' '),
        StaffWorkspaceSourceOperation: 'id requestId cardId cohortId pilotId purpose side sourceConfigHash sourceControlRevision bindingCanonical bindingHash requestCanonical requestHash runId runControlRevision gradingExecutionId state reservedMicroUsd actualMicroUsd costEvidenceHash resultCanonical resultHash failureCode createdAt dispatchedAt finishedAt'.split(' '),
        StaffOperatorControl: 'id enabled mode releaseSha buildHash configHash providerBindingHash policyCanonical policyHash revision updatedAt'.split(' '),
        StaffGradingBridgeControl: 'id enabled mode origin deploymentId releaseSha configHash clientKeyHash gradingPolicyHash policyCanonical policyHash revision updatedAt'.split(' '),
        StaffOperatorRun: 'phase workspaceCardId captureRunId controlState controlRevision executionMode stepBudget initializationId id specimenId pilotId evidenceHash policyHash policyCanonical runtimeHash gradingPolicyHash manifestCanonical manifestHash expectedAnalysisRevision expectedReviewRevision revision state inputCanonical inputHash leaseOwner leaseFence leaseMode leaseExpiresAt summary failureCode deadlineAt createdAt updatedAt'.split(' '),
        StaffOperatorStep: 'id runId attemptId revision callId toolName requestCanonical requestHash resultCanonical resultHash nextInputHash createdAt'.split(' '),
        StaffOperatorAttempt: 'id runId ordinal runRevision leaseFence dispatchClaimId requestCanonical requestHash providerBindingHash reservedMicroUsd usageCeilingMicroUsd usageEnvelopeExceeded actualMicroUsd costEvidenceHash state resultReceiptId createdAt dispatchedAt finishedAt'.split(' '),
        StaffOperatorReceipt: 'id attemptId canonical hash createdAt'.split(' '),
        StaffOperatorRecovery: 'id runId attemptId receiptId commandId ordinal runRevision leaseFence canonical hash createdAt'.split(' '),
        StaffOperatorImage: 'imageId runId stepId canonical hash createdAt'.split(' '),
        StaffOperatorImageDelivery: 'attemptId imageId requestHash lineageHash createdAt'.split(' '),
        StaffMachineInitialization: 'workspaceSourceRequestId admissionKind id specimenId pilotId gradingOperationId runtimeHash evidenceHash operatorPolicyHash bridgePolicyHash gradingPolicyHash sourceHash sourceRevision expectedAnalysisRevision expectedReviewRevision controlRevision operatorRevision bridgeRevision admittedById admittedSessionHash admittedAccessVersion operationsGrantId admissionReason authorizationEvidenceHash deadlineAt createdAt dispatchedAt finishedAt state failureCode'.split(' '),
        StaffAnalysisRevision: 'identityCorrectionId operationId specimenId revision evidenceHash sourceCanonical sourceHash reportCanonical reportHash admissionCanonical admissionHash sourceRevision mode createdAt'.split(' '),
        StaffSession: 'tokenHash identityId browserHash challengeId controlRevision accessVersion createdAt expiresAt revokedAt'.split(' '),
        StaffBrowser: 'tokenHash controlRevision createdAt expiresAt'.split(' '),
        StaffSpecimen: 'id sourceType sourceId sourceOwnerId title subtitle evidenceCanonical evidenceHash evidenceRevision draftRevision analysisRevision createdAt'.split(' '),
        StaffGradingOperation: 'id specimenId operationId actorKind actorId sessionHash assignmentFence controlRevision evidenceHash expectedAnalysisRevision expectedReviewRevision requestCanonical inputHash state dispatchClaimId leaseFence leaseExpiresAt resultAnalysisRevision failureCode createdAt dispatchedAt finishedAt'.split(' '),
        StaffGradingExecution: 'operationId claimId pilotId bridgeRevision sourceRevision reservedMicroUsd actualMicroUsd costEvidenceHash state failureCode createdAt finishedAt'.split(' '),
        StaffReviewRevision: 'specimenId revision evidenceRevision evidenceHash contentHash analysisRevision canonical savedById savedAt'.split(' '),
        StaffAudit: 'id event subjectId actorId details createdAt'.split(' '),
    },
    public: {
        AiGraderV2Session: 'id createdByUserId cardProfile workflowState ruleVersion publicReportSlug identity capture reviewedDefects gradeReport slabFrontKey slabBackKey nfcDone compsDone inventoryDone mapRevisionId mapFilterPolicyVersion mapRegistration createdAt updatedAt'.split(' '),
        AiGraderV2PreparationHead: 'sessionId side sideRevision activeAttemptId adoptedManifestId'.split(' '),
        AiGraderV2PreparationAttempt: 'id sessionId createdByUserId side sideRevision idempotencyKey requestSha256 expectedSideRevision expectedAttemptId input inputCanonical dispatchClaimId dispatchClaimedAt terminalOutcome terminalDetails terminalAt createdAt'.split(' '),
        AiGraderV2PreparationManifest: 'id sessionId createdByUserId side sideRevision attemptId manifestSha256 body bodyCanonical createdAt'.split(' '),
        AiGraderV2ColorGeometryEvidence: 'id sessionId createdByUserId side mode matColor outcome engineVersion policyProvenance sourceImageStorageKey sourceImageSha256 proposal confirmedQuad diagnostics proposalChanged createdAt'.split(' '),
        AiGraderV2InstrumentationEvent: 'id eventKey sessionId cycleId createdByUserId category eventType findingId origin similarity generatingExemplar operatorAction clientStartedAt clientEndedAt durationMs details createdAt'.split(' '),
        AiGraderV2MapFilterDecision: 'id sessionId findingId side originalOrigin proposedDefectType confidence similarity generatingExemplar sourceViewId supportingViewIds cardIdentity findingSnapshot mapId mapRevisionId zoneId zoneType zoneOverlap filterPolicyVersion ruleId ruleInputs detectorVersion filteredAt'.split(' '),
        AiGraderV2CardTypeMap: 'id matchKeyHash cardProfile currentRevisionId createdAt'.split(' '),
        AiGraderV2CardTypeMapRevision: 'id mapId version matchKeyHash matchKey displayIdentity normalizedIdentity sourceSessionId authorAdminId frontMap backMap mapSchemaVersion filterPolicyVersion revisionHash supersedesRevisionId createdAt'.split(' '),
        AiGraderV2MapRegistrationLesson: 'id tenantId operatorAdminId mapRevisionId side evidenceSessionId currentInspectionKey currentInspectionSha256 currentPhysicalQuadSha256 originalExpectedAnchors automaticDiagnostics humanCorrectedAnchors validatedRegistration algorithmVersion policyVersion rescueAttemptId lessonHash createdAt'.split(' '),
        AiGraderV2LearningBank: 'id state updatedAt'.split(' '),
        HumanGradeLabel: 'id certificateSequence certificateNumber sheetId slot cardType playerName cardName year manufacturer productSet parallel insert cardNumber source sourceSessionId gradingFormulaVersion centeringGrade cornersGrade edgesGrade surfaceGrade grade createdByUserId createdAt updatedAt'.split(' '),
    },
};
const freeze = value => {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
    return value;
};
freeze(COLUMNS);
const select = (schema, tables) => Object.fromEntries(tables.map(name => [name, { SELECT: COLUMNS[schema][name] }]));
const common = ["StaffControl","StaffWorkspaceControl","StaffWorkspaceSourceControl","StaffIdentity","StaffWorkspaceCard","StaffWorkspaceOperation","StaffWorkspaceSourceAdmission","StaffWorkspaceSourceActionPermit","StaffWorkspaceSourceOperation","StaffOperatorControl","StaffGradingBridgeControl","StaffOperatorRun","StaffOperatorStep","StaffOperatorAttempt","StaffOperatorImage","StaffOperatorImageDelivery","StaffMachineInitialization","StaffAnalysisRevision","StaffOperatorRecovery"];
const source = {
    atlas_staff: select('atlas_staff', [...common, 'StaffOperatorImageControl', 'StaffOperatorReceipt', 'StaffSession', 'StaffBrowser', 'StaffSpecimen',
        'StaffGradingOperation', 'StaffGradingExecution', 'StaffReviewRevision']),
    public: select('public', ["AiGraderV2Session","AiGraderV2PreparationHead","AiGraderV2PreparationAttempt","AiGraderV2PreparationManifest","AiGraderV2ColorGeometryEvidence","AiGraderV2InstrumentationEvent","AiGraderV2CardTypeMap","AiGraderV2CardTypeMapRevision","AiGraderV2MapRegistrationLesson","AiGraderV2LearningBank"]),
};
Object.assign(source.atlas_staff, {
    StaffAudit: { INSERT: COLUMNS.atlas_staff.StaffAudit },
    StaffSpecimen: { ...source.atlas_staff.StaffSpecimen, UPDATE: ['analysisRevision', 'draftRevision'] },
    StaffGradingOperation: { ...source.atlas_staff.StaffGradingOperation,
        INSERT: ['id','specimenId','operationId','actorKind','actorId','sessionHash','assignmentFence','controlRevision','evidenceHash',
            'expectedAnalysisRevision','expectedReviewRevision','requestCanonical','inputHash','state','dispatchClaimId','leaseFence','leaseExpiresAt','createdAt','dispatchedAt'],
        UPDATE: ['state','dispatchedAt','finishedAt','resultAnalysisRevision','failureCode'] },
    StaffGradingExecution: { ...source.atlas_staff.StaffGradingExecution,
        INSERT: ['operationId','claimId','pilotId','bridgeRevision','sourceRevision','reservedMicroUsd','state','createdAt'],
        UPDATE: ['state','failureCode','finishedAt'] },
    StaffMachineInitialization: { ...source.atlas_staff.StaffMachineInitialization,
        INSERT: COLUMNS.atlas_staff.StaffMachineInitialization.filter(key => !['dispatchedAt','finishedAt','failureCode'].includes(key)),
        UPDATE: ['state','dispatchedAt','finishedAt','failureCode'] },
    StaffAnalysisRevision: { ...source.atlas_staff.StaffAnalysisRevision,
        INSERT: COLUMNS.atlas_staff.StaffAnalysisRevision.filter(key => key !== 'identityCorrectionId') },
    StaffReviewRevision: { ...source.atlas_staff.StaffReviewRevision, INSERT: COLUMNS.atlas_staff.StaffReviewRevision },
    StaffWorkspaceSourceOperation: { ...source.atlas_staff.StaffWorkspaceSourceOperation,
        INSERT: ['id','requestId','cardId','cohortId','pilotId','purpose','side','sourceConfigHash','sourceControlRevision','bindingCanonical','bindingHash',
            'requestCanonical','requestHash','runId','runControlRevision','state','reservedMicroUsd','createdAt'],
        UPDATE: ['state','gradingExecutionId','dispatchedAt','resultCanonical','resultHash','failureCode','finishedAt'] },
});
Object.assign(source.public, {
    AiGraderV2Session: { ...source.public.AiGraderV2Session,
        INSERT: ['id','createdByUserId','cardProfile','workflowState','ruleVersion','identity','capture','reviewedDefects','gradeReport','createdAt','updatedAt'],
        UPDATE: ['workflowState','capture','mapRevisionId','mapFilterPolicyVersion','mapRegistration','reviewedDefects','gradeReport','updatedAt'] },
    AiGraderV2PreparationHead: { ...source.public.AiGraderV2PreparationHead,
        INSERT: COLUMNS.public.AiGraderV2PreparationHead, UPDATE: COLUMNS.public.AiGraderV2PreparationHead },
    AiGraderV2PreparationAttempt: { ...source.public.AiGraderV2PreparationAttempt,
        INSERT: COLUMNS.public.AiGraderV2PreparationAttempt.filter(key => !['dispatchClaimId','dispatchClaimedAt','terminalOutcome','terminalDetails','terminalAt'].includes(key)),
        UPDATE: ['dispatchClaimId','dispatchClaimedAt','terminalOutcome','terminalDetails','terminalAt'] },
    AiGraderV2PreparationManifest: { ...source.public.AiGraderV2PreparationManifest, INSERT: COLUMNS.public.AiGraderV2PreparationManifest },
    AiGraderV2ColorGeometryEvidence: { ...source.public.AiGraderV2ColorGeometryEvidence, INSERT: COLUMNS.public.AiGraderV2ColorGeometryEvidence },
    AiGraderV2InstrumentationEvent: { ...source.public.AiGraderV2InstrumentationEvent, INSERT: COLUMNS.public.AiGraderV2InstrumentationEvent },
    AiGraderV2MapFilterDecision: { INSERT: COLUMNS.public.AiGraderV2MapFilterDecision },
    AiGraderV2LearningBank: { ...source.public.AiGraderV2LearningBank, UPDATE: ['state','updatedAt'] },
    // Original V2 derived-memory catch-up reads completion metadata only.
    // Prisma also selects the primary key for this explicit findMany projection.
    HumanGradeLabel: { SELECT: ['id','source','sourceSessionId','certificateSequence','createdAt'] },
});
const coordinator = { atlas_staff: select('atlas_staff', common) };
Object.assign(coordinator.atlas_staff, {
    StaffWorkspaceCard: { ...coordinator.atlas_staff.StaffWorkspaceCard,
        UPDATE: ['revision','state','stage','canonical','contentHash','updatedAt'] },
    StaffWorkspaceOperation: { ...coordinator.atlas_staff.StaffWorkspaceOperation, INSERT: COLUMNS.atlas_staff.StaffWorkspaceOperation },
    StaffOperatorRun: { ...coordinator.atlas_staff.StaffOperatorRun,
        INSERT: ['id','specimenId','pilotId','evidenceHash','policyHash','policyCanonical','runtimeHash','gradingPolicyHash',
            'manifestCanonical','manifestHash','expectedAnalysisRevision','expectedReviewRevision','inputCanonical','inputHash',
            'deadlineAt','createdAt','updatedAt','initializationId','workspaceCardId','captureRunId','controlState','executionMode','stepBudget'] },
});
export const WORKSPACE_GRANTS = freeze({ SOURCE: source, COORDINATOR: coordinator });
export const WORKSPACE_FUNCTIONS = freeze({
    SOURCE: ['claim_workspace_source_permit(uuid)','finish_workspace_source_permit(uuid, text)',
        'workspace_pilot_budget_usage(uuid, uuid)','admit_workspace_source(uuid, text, text)','operator_capture_current(uuid)',
        'operator_workspace_count(uuid)','workspace_pilot_subject(uuid, uuid)','lock_assignment(uuid, uuid)',
        'lock_operator_workspace(uuid, uuid)','lock_workspace_private_controls()','lock_workspace_private_actor(uuid, text)',
        'lock_workspace_private_card(uuid)','lock_workspace_private_run(uuid)','lock_workspace_private_permit(uuid)',
        'operator_attempt_fence_matches(uuid, uuid, integer)'],
    COORDINATOR: ['claim_workspace_source_permit(uuid)','finish_workspace_source_permit(uuid, text)',
        'workspace_pilot_budget_usage(uuid, uuid)','operator_workspace_count(uuid)','lock_control()','lock_operator_control()',
        'lock_operator_bridge_control()','lock_operator_specimen(uuid)','lock_operator_workspace(uuid, uuid)',
        'lock_workspace_private_controls()','lock_workspace_private_actor(uuid, text)','lock_workspace_private_card(uuid)',
        'lock_workspace_private_run(uuid)','lock_workspace_private_permit(uuid)'],
});
const kindOf = kind => { check(Object.hasOwn(WORKSPACE_GRANTS, kind), 'WORKSPACE_DATABASE_ROLE_INVALID'); return kind; };

/** Provision only a dedicated role. This adds the reviewed rights; it never
 * hides excessive ambient grants by revoking unrelated application authority.
 * SOURCE and COORDINATOR cannot be combined with the strict operator role. */
export function workspaceGrantSQL(role, kind = 'SOURCE') {
    check(typeof role === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(role), 'WORKSPACE_DATABASE_ROLE_INVALID');
    const grants = WORKSPACE_GRANTS[kindOf(kind)], target = '"' + role + '"';
    return [...Object.entries(grants).flatMap(([schema, tables]) => [
        'GRANT USAGE ON SCHEMA ' + schema + ' TO ' + target + ';',
        ...Object.entries(tables).flatMap(([table, operations]) => Object.entries(operations).map(([operation, columns]) =>
            'GRANT ' + operation + ' (' + columns.map(column => '"' + column + '"').join(',') + ') ON ' + schema + '."' + table + '" TO ' + target + ';')),
    ]), ...WORKSPACE_FUNCTIONS[kind].map(name => 'GRANT EXECUTE ON FUNCTION atlas_staff.' + name + ' TO ' + target + ';')].join('\n');
}

/** Exact effective rights, including PUBLIC and inherited grant paths. A role
 * with missing rights is unavailable just like a role with excessive rights.
 * This assertion is read-only and must run on the actual runtime connection.
 * Original-row ownership still comes from the private request authority; these
 * grants do not claim to be row-level security. The existing PUBLIC database
 * TEMPORARY and trusted non-definer uuid-ossp defaults are left unchanged.
 * The private runtime places pg_temp last in its fixed transaction search_path. */
export async function assertWorkspacePrivileges(tx, kind = 'SOURCE') {
    const grants = WORKSPACE_GRANTS[kindOf(kind)], functionsAllowed = new Set(WORKSPACE_FUNCTIONS[kind]);
    const [role] = await tx.$queryRaw`SELECT r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
        OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
        OR has_database_privilege(current_user,current_database(),'CREATE')
        OR EXISTS(SELECT 1 FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid AND d.deptype='o'
            AND (d.dbid=0 OR d.dbid=(SELECT oid FROM pg_database WHERE datname=current_database())))
        OR EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a
            WHERE d.datname=current_database() AND a.grantee IN (0,r.oid) AND a.is_grantable) AS unsafe
        FROM pg_roles r WHERE r.rolname=current_user`;
    check(role && role.unsafe === false, 'WORKSPACE_DATABASE_ROLE_INVALID');
    const schemas = await tx.$queryRaw`SELECT n.nspname AS name,
        has_schema_privilege(current_user,n.oid,'CREATE') AS creates,
        has_schema_privilege(current_user,n.oid,'USAGE') AS uses,
        EXISTS(SELECT 1 FROM aclexplode(n.nspacl) a WHERE a.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname=current_user))
            AND a.is_grantable) AS grants
        FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'`;
    check(schemas.every(row => !row.creates && !row.grants && (!row.uses || ['public','atlas_staff'].includes(row.name)))
        && Object.keys(grants).every(schema => schemas.some(row => row.name === schema && row.uses)), 'WORKSPACE_DATABASE_ROLE_INVALID');
    const columns = await tx.$queryRaw`SELECT n.nspname AS schema,c.relname AS name,a.attname AS column,
        has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS sel,
        has_column_privilege(current_user,c.oid,a.attnum,'INSERT') AS ins,
        has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS upd,
        has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') AS refs,
        has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER') AS extra,
        EXISTS(SELECT 1 FROM aclexplode(c.relacl) p WHERE p.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname=current_user))
            AND (p.is_grantable OR p.privilege_type NOT IN ('SELECT','INSERT','UPDATE','REFERENCES'))) OR
        EXISTS(SELECT 1 FROM aclexplode(a.attacl) p WHERE p.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname=current_user))
            AND p.is_grantable) AS grants
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
            AND n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'`;
    const seen = new Map();
    for (const row of columns) {
        const grant = grants[row.schema]?.[row.name], allows = operation => grant?.[operation]?.includes(row.column) === true;
        check(row.sel === allows('SELECT') && row.ins === allows('INSERT') && row.upd === allows('UPDATE')
            && !row.refs && !row.extra && !row.grants, 'WORKSPACE_DATABASE_ROLE_INVALID');
        if (grant) {
            const key = row.schema + '.' + row.name;
            check(COLUMNS[row.schema]?.[row.name]?.includes(row.column), 'WORKSPACE_DATABASE_ROLE_INVALID');
            if (!seen.has(key)) seen.set(key, new Set());
            check(!seen.get(key).has(row.column), 'WORKSPACE_DATABASE_ROLE_INVALID'); seen.get(key).add(row.column);
        }
    }
    for (const [schema, tables] of Object.entries(grants)) for (const name of Object.keys(tables))
        check(seen.get(schema + '.' + name)?.size === COLUMNS[schema][name].length, 'WORKSPACE_DATABASE_ROLE_INVALID');
    const sequences = await tx.$queryRaw`WITH sequences AS MATERIALIZED (
        SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind='S' AND n.nspname NOT LIKE 'pg_%'
    ) SELECT oid FROM sequences WHERE has_sequence_privilege(current_user,oid,'USAGE,SELECT,UPDATE')`;
    const functions = await tx.$queryRaw`SELECT n.nspname AS schema,p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,
        p.prosecdef AS definer, EXISTS(SELECT 1 FROM aclexplode(p.proacl) a
            WHERE a.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname=current_user)) AND a.is_grantable) AS grants
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        AND NOT (NOT p.prosecdef AND p.probin='$libdir/uuid-ossp' AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid
            WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='uuid-ossp'))
        AND p.prorettype<>'trigger'::regtype AND has_function_privilege(current_user,p.oid,'EXECUTE')`;
    check(sequences.length === 0 && functions.length === functionsAllowed.size && functions.every(row =>
        row.schema === 'atlas_staff' && functionsAllowed.has(row.name) && row.definer && !row.grants), 'WORKSPACE_DATABASE_ROLE_INVALID');
}
