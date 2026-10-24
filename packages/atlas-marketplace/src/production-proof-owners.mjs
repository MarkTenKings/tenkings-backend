import { randomUUID } from 'node:crypto';
import { hash, requireValue } from './contract.mjs';
import { engineDataOptions } from './proof-decoder-engine-json.mjs';
import { decoderExact } from './proof-decoder-profile.mjs';
import { createProofDecoderLinuxObserver } from './proof-decoder-linux-observer.mjs';
import { createProofDecoderTargetBrokerClient, assertProofDecoderTargetBrokerClient } from './proof-decoder-target-broker.mjs';
import { openProofPublicationRetentionStore, assertProofPublicationLifecycleOwner } from './proof-publication-store.mjs';
import { publicationSessionBinding } from './proof-publication-lifecycle.mjs';
import { intakeProtectedInstallation } from './proof-intake-protected-protocol.mjs';
import { intakeAccountingInstallation } from './proof-intake-accounting.mjs';
import { createR1ProofIntakeAccountedPostgres, assertProofIntakeAccountedPostgres } from './proof-intake-protected-postgres.mjs';
import { createR1ProofRetentionIntakePostgresWriter, assertProofRetentionPostgresWriter } from './proof-retention-postgres-writer.mjs';

const check = (value, code = 'PRODUCTION_PROOF_OWNERS_REQUIRED') => requireValue(value, code);

/** Fixed production constructors. Protected data and inherited secret-FD bytes
 * are supplied by the launcher; no environment/module/credential discovery.
 * This opens an already migrated v4 ledger, never initializes, adopts, repairs
 * or resets one. The concrete modules retain their own brands and holds.
 */
export async function openProductionProofOwners(options = {}) {
    const { configuration, secrets } = engineDataOptions(options, ['configuration', 'secrets']);
    decoderExact(configuration, ['schema', 'decoder', 'publisher', 'intake', 'retention']);
    decoderExact(secrets, ['encryptionKeyBase64', 'intakePassword', 'retentionPassword']);
    check(configuration.schema === 'atlas-production-proof-owners-v1');
    check(process.platform === 'linux' && process.versions.node === '22.16.0'
        && process.getuid() === 65530 && process.geteuid() === 65530
        && process.getgid() === 65530 && process.getegid() === 65530
        && process.getgroups().every(group => group === 65530),
        'PRODUCTION_PROOF_ROLE_REQUIRED');
    const { decoder, publisher: publication, intake, retention } = configuration;
    decoderExact(decoder, ['plan', 'addonPath', 'addonSha256', 'expectedBootId', 'expectedEpoch', 'expectedBindingHash']);
    decoderExact(publication, ['descriptorPath', 'expectedLedgerId', 'sessionBinding']);
    decoderExact(intake, ['configuration', 'installation', 'accounting']);
    decoderExact(retention, ['configuration', 'maxOperations']);
    check(decoder.plan?.profile?.ipc?.clientUid === 65530 && decoder.plan.profile.ipc.clientGid === 65530);
    const installation = intakeProtectedInstallation(intake.installation);
    const accounting = intakeAccountingInstallation(intake.accounting, installation);
    const sessionBinding = publicationSessionBinding(publication.sessionBinding);
    check(installation.binding.environment === 'PRODUCTION'
        && sessionBinding.policyHash === installation.binding.policyHash
        && sessionBinding.intakeBindingHash === hash(installation.binding), 'PRODUCTION_PROOF_BINDING_REQUIRED');
    check(typeof secrets.encryptionKeyBase64 === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(secrets.encryptionKeyBase64));
    for (const [config, password] of [[intake.configuration, secrets.intakePassword], [retention.configuration, secrets.retentionPassword]]) {
        check(config && Object.getPrototypeOf(config) === Object.prototype && !Object.hasOwn(config, 'password')
            && typeof password === 'string' && password.length > 0, 'PRODUCTION_PROOF_SECRET_REQUIRED');
    }
    const key = Buffer.from(secrets.encryptionKeyBase64, 'base64');
    let observer, decoderClient, publisher, accountedIntake, retentionWriter, publisherSessionId;
    let closed = false, closing;
    const close = () => closing ??= (async () => {
        closed = true;
        let failure;
        // Stop new decoder use before closing its SQL owners. Publisher close
        // drains a clean session; uncertain work keeps the real writer lock.
        for (const owner of [decoderClient, accountedIntake, retentionWriter, publisher, observer]) {
            try { await owner?.close(); } catch (error) { failure ??= error; }
        }
        if (failure) throw failure;
    })();
    const assertReady = () => {
        check(!closed, 'PRODUCTION_PROOF_OWNERS_CLOSED');
        assertProofDecoderTargetBrokerClient(decoderClient);
        assertProofPublicationLifecycleOwner(publisher, { retention: true });
        assertProofIntakeAccountedPostgres(accountedIntake);
        assertProofRetentionPostgresWriter(retentionWriter);
        const d = decoderClient.status(), p = publisher.status();
        check(!d.closed && !d.quarantined && !p.closed && !p.poisoned
            && p.ledgerId === publication.expectedLedgerId && p.bootId === decoder.expectedBootId
            && p.latestSessionId === publisherSessionId, 'PRODUCTION_PROOF_OWNERS_UNAVAILABLE');
        return true;
    };
    try {
        check(key.length === 32 && key.toString('base64') === secrets.encryptionKeyBase64);
        observer = createProofDecoderLinuxObserver({ enabled: true, addonPath: decoder.addonPath, addonSha256: decoder.addonSha256 });
        decoderClient = createProofDecoderTargetBrokerClient({ enabled: true, plan: decoder.plan, observer,
            expectedBootId: decoder.expectedBootId, expectedEpoch: decoder.expectedEpoch, expectedBindingHash: decoder.expectedBindingHash });
        accountedIntake = createR1ProofIntakeAccountedPostgres({ enabled: true,
            configuration: { ...intake.configuration, password: secrets.intakePassword }, installation, accounting });
        retentionWriter = createR1ProofRetentionIntakePostgresWriter({ enabled: true,
            configuration: { ...retention.configuration, password: secrets.retentionPassword }, installation, maxOperations: retention.maxOperations });
        publisher = openProofPublicationRetentionStore({ enabled: true, descriptorPath: publication.descriptorPath,
            encryptionKey: key, linuxObserver: observer });
        check(hash(publisher.binding) === installation.binding.storageHash, 'PRODUCTION_PROOF_BINDING_REQUIRED');
        const prior = publisher.status();
        check(prior.ledgerId === publication.expectedLedgerId && prior.bootId === decoder.expectedBootId,
            'PRODUCTION_PROOF_BINDING_REQUIRED');
        const session = publisher.beginSession({ operationId: randomUUID(), expectedRevision: prior.revision,
            previousSessionId: prior.latestSessionId, previousCloseHash: prior.lastCloseHash, binding: sessionBinding });
        publisherSessionId = session.record.sessionId;
        assertReady();
        return Object.freeze({ decoderClient, publisher, accountedIntake, retentionWriter, sessionBinding, publisherSessionId,
            assertReady, close,
            status() { return Object.freeze({ schema: 'atlas-production-proof-owner-status-v1', closed,
                ledgerId: publication.expectedLedgerId, publisherSessionId, bootId: decoder.expectedBootId,
                storageHash: installation.binding.storageHash, customerPublicationAuthority: false }); } });
    } catch (error) {
        try { await close(); } catch {}
        throw error;
    } finally { key.fill(0); }
}
