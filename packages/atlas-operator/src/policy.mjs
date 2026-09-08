import { z } from 'zod';
import { canonical, digest, requireBridge as check } from '@atlas/service-bridge/protocol';
import { operatorPolicySchema, toolDefinitions } from './responses.mjs';

export const controlPolicySchema = z.strictObject({ version: z.literal('atlas-operator-control-policy-v1'), pilotId: z.uuidv4(),
    expiresAt: z.iso.datetime(), prompt: z.string().min(1).max(12_000), astra: operatorPolicySchema,
    tools: z.array(z.string()).min(1).max(5), maxAttemptsPerCard: z.number().int().min(1).max(100),
    maxStepsPerRun: z.number().int().min(1).max(64), maxRunMs: z.number().int().min(60_000).max(3_600_000),
    leaseMs: z.number().int().min(10_000).max(60_000), concurrency: z.literal(1) });
export function parseControlPolicy(value) {
    const policy = controlPolicySchema.parse(value); toolDefinitions(policy.tools); return policy;
}
export function checked(text, hash) {
    check(typeof text === 'string' && digest(text) === hash, 'ASTRA_STORED_EVIDENCE_INVALID');
    const value = JSON.parse(text); check(canonical(value) === text, 'ASTRA_STORED_EVIDENCE_INVALID'); return value;
}
export function makeOperatorConfig({ databaseUrl, mode, releaseSha, buildHash, providerBindingHash }) {
    const url = new URL(databaseUrl);
    check(['postgres:', 'postgresql:'].includes(url.protocol) && url.username && url.password
        && url.searchParams.get('schema') === 'atlas_staff', 'ASTRA_DATABASE_CONFIGURATION_REQUIRED');
    check(['LOCAL_FIXTURE', 'PRODUCTION'].includes(mode) && /^[a-f0-9]{40}$/.test(releaseSha)
        && [buildHash, providerBindingHash].every(h => /^[a-f0-9]{64}$/.test(h)), 'ASTRA_CONFIGURATION_REQUIRED');
    if (mode === 'LOCAL_FIXTURE') check(url.hostname === '127.0.0.1' && releaseSha === '0'.repeat(40), 'ASTRA_FIXTURE_LOOPBACK_REQUIRED');
    else check(releaseSha !== '0'.repeat(40) && !['localhost','127.0.0.1','[::1]'].includes(url.hostname), 'ASTRA_PRODUCTION_CONFIGURATION_REQUIRED');
    return Object.freeze({ mode, releaseSha, buildHash, providerBindingHash,
        configHash: digest(canonical({ version: 'atlas-operator-runtime-v1', mode, releaseSha, buildHash,
            providerBindingHash, databaseBindingHash: digest(databaseUrl) })) });
}
