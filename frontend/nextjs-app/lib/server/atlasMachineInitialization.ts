import type { Prisma, PrismaClient } from '@prisma/client';
import { MachineInitializationBridge, enqueueMachineInitialization, type MachineInitializationAdmission } from '@atlas/service-bridge/machine-initialize';
import { makeMachineInitializationTransportConfig, verifyMachineInitializationAdmission, verifyMachineInitializationExecution } from '@atlas/service-bridge/machine-initialize-transport';
import { requireBridge, digest, keyBytes, SHA } from '@atlas/service-bridge/protocol';
import { enqueueOperatorRun } from '@atlas/operator/ledger';
import { atlasGradingBridgeConfig, createAtlasGradingPorts } from './atlasGradingBridge';
import { atlasIntakeConfig, createAtlasIntake } from './atlasIntake';

export function atlasMachineInitializationConfig(env: NodeJS.ProcessEnv = process.env) {
    requireBridge(env.ATLAS_MACHINE_INITIALIZATION_ENABLED === 'true' && SHA.test(env.ATLAS_OPERATOR_RUNTIME_HASH ?? '')
        && !Object.keys(env).some(name => name.startsWith('ATLAS_LOCAL_')),
        'MACHINE_INITIALIZATION_NOT_ENABLED');
    const bridge = atlasGradingBridgeConfig(env);
    const otherKeyHashes = ['ATLAS_GRADING_BRIDGE_KEY','ATLAS_INTAKE_KEY','ATLAS_OPERATOR_EVIDENCE_KEY','ATLAS_PUBLIC_MEDIA_KEY','ATLAS_TRUSTED_LEARNING_KEY']
        .filter(name => env[name] !== undefined).map(name => digest(keyBytes(env[name])));
    const transport = makeMachineInitializationTransportConfig({ mode: 'PRODUCTION', origin: bridge.origin,
        runtimeHash: env.ATLAS_OPERATOR_RUNTIME_HASH!, admissionKey: keyBytes(env.ATLAS_MACHINE_ADMISSION_KEY),
        executionKey: keyBytes(env.ATLAS_MACHINE_EXECUTION_KEY), otherKeyHashes });
    return { bridge, transport, runtimeHash: transport.runtimeHash, origin: bridge.origin };
}

export function createAtlasMachineInitialization(client: PrismaClient, settings: ReturnType<typeof atlasMachineInitializationConfig>) {
    const config = { ...settings.bridge, runtimeHash: settings.runtimeHash }, ports = createAtlasGradingPorts(client, settings.bridge);
    const machine = new MachineInitializationBridge({ client, config, ports });
    return {
        async admit(body: string, signature: string, intakeSettings: ReturnType<typeof atlasIntakeConfig>) {
            const packet = verifyMachineInitializationAdmission(settings.transport, body, signature);
            requireBridge(intakeSettings.gradingPolicyHash === config.gradingPolicyHash, 'MACHINE_ADMISSION_REQUIRED');
            const intake = createAtlasIntake(client, intakeSettings);
            const admin = { async transaction<T>(principal: unknown, work: (context: MachineInitializationAdmission<Prisma.TransactionClient>) => Promise<T>) {
                requireBridge(principal === packet, 'MACHINE_ADMISSION_REQUIRED');
                return client.$transaction(async tx => {
                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('atlas-staff-access-v1',0))`;
                    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
                    verifyMachineInitializationAdmission(settings.transport, body, signature, +now);
                    const current = await intake.authorize(tx, packet, now);
                    const result = await work({ tx, control: current.control, identity: current.identity, session: current.session,
                        actorKind: 'HUMAN', capability: 'OPERATIONS', capabilityUntil: current.grant.expiresAt, operationsGrantId: current.grant.id });
                    const [{ now: finishedAt }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
                    verifyMachineInitializationAdmission(settings.transport, body, signature, +finishedAt);
                    await intake.authorize(tx, packet, finishedAt);
                    await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`; return result;
                }, { maxWait: 5000, timeout: 10_000 });
            } };
            const { runtimeHash: _runtimeHash, ...input } = packet.input;
            const job = await enqueueMachineInitialization({ admin, staff: packet, config, ports }, input);
            return { jobId: job.id, specimenId: job.specimenId, pilotId: job.pilotId, gradingOperationId: job.gradingOperationId,
                runtimeHash: job.runtimeHash, state: job.state, deadlineAt: job.deadlineAt.toISOString() };
        },
        async execute(body: string, signature: string, signal?: AbortSignal) {
            const packet = verifyMachineInitializationExecution(settings.transport, body, signature);
            const result = await machine.run(packet.input, { signal });
            requireBridge(['SUCCEEDED','UNKNOWN','FAILED'].includes(result.state), 'MACHINE_INITIALIZATION_OUTCOME_UNCONFIRMED');
            let operatorRunId: string | undefined;
            if (result.state === 'SUCCEEDED') {
                // A separate transaction can only enqueue the exact COMMITTED
                // analysis. Its unique initialization ID makes lost replies safe.
                // A failed enqueue never repeats the original worker execution.
                try {
                    const [job] = await client.$queryRaw<Array<{ specimenId: string }>>`SELECT "specimenId" FROM atlas_staff."StaffMachineInitialization"
                        WHERE id=${packet.input.jobId}::uuid AND state='SUCCEEDED' AND "runtimeHash"=${settings.runtimeHash}`;
                    const [operator] = await client.$queryRaw<Array<{ mode: string; releaseSha: string; buildHash: string; configHash: string; providerBindingHash: string }>>`
                        SELECT mode,"releaseSha","buildHash","configHash","providerBindingHash" FROM atlas_staff."StaffOperatorControl"
                        WHERE id='active' AND enabled AND "configHash"=${settings.runtimeHash}`;
                    requireBridge(job && operator, 'ASTRA_INITIALIZATION_NOT_CURRENT');
                    const run = await enqueueOperatorRun(client, operator, job.specimenId, { machineInitializationId: packet.input.jobId });
                    operatorRunId = run.id;
                } catch { /* No run is reported unless its durable queue row is confirmed. */ }
            }
            return { jobId: packet.input.jobId, runtimeHash: settings.runtimeHash, state: result.state,
                ...(result.state === 'SUCCEEDED' ? { analysisRevision: result.analysisRevision } : {}), ...(operatorRunId ? { operatorRunId } : {}) };
        },
    };
}
