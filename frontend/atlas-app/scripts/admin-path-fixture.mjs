import assert from 'node:assert/strict';

export async function adminPathScenarios(scenario) {
    await scenario('admin cutover preserves disabled legacy control and refuses old-origin activation', async context => {
        const signed = await context.login();
        const before = await context.admin.staffSession.findMany();
        await context.admin.staffControl.update({ where: { id: 'active' }, data: {
            mode: 'PRODUCTION', origin: 'https://app.atlasgrading.com', enabled: false,
            deploymentId: 'historical-fixture.vercel.app', releaseSha: 'e'.repeat(40), revision: { increment: 1 }
        } });
        const disabled = await context.admin.staffControl.findUnique({ where: { id: 'active' } });
        await assert.rejects(() => context.admin.staffControl.update({ where: { id: 'active' }, data: {
            enabled: true, revision: { increment: 1 }
        } }));
        assert.deepEqual(await context.admin.staffControl.findUnique({ where: { id: 'active' } }), disabled);
        assert.deepEqual(await context.admin.staffSession.findMany(), before);
        await assert.rejects(() => context.auth.authenticate(signed.cookie), { message: 'STAFF_ACCESS_NOT_ENABLED' });
        await context.admin.staffControl.update({ where: { id: 'active' }, data: {
            origin: 'https://atlasgrading.com', enabled: true, configHash: 'f'.repeat(64), revision: { increment: 1 }
        } });
        const active = await context.admin.staffControl.findUnique({ where: { id: 'active' } });
        assert.equal(active.origin, 'https://atlasgrading.com'); assert.equal(active.enabled, true);
        // A changed origin, release and config does not grant the old browser or
        // session new authority. Fresh exact activation/session binding is required.
        await assert.rejects(() => context.auth.authenticate(signed.cookie), { message: 'STAFF_ACCESS_NOT_ENABLED' });
        assert.deepEqual(await context.admin.staffSession.findMany(), before);
    });
    await scenario('admin cutover leaves production NFC disabled without changing signed history', async context => {
        const history = { jobs: await context.admin.staffNfcJob.count(), verifications: await context.admin.staffNfcVerification.count() };
        for (const origin of ['https://app.atlasgrading.com', 'https://atlasgrading.com']) {
            const existing = await context.admin.staffNfcControl.findUnique({ where: { id: 'active' } });
            const data = { mode: 'PRODUCTION', origin, enabled: false, deploymentId: 'historical-fixture.vercel.app',
                releaseSha: 'a'.repeat(40), configHash: 'b'.repeat(64), signingKeyHash: 'c'.repeat(64), trustHash: 'd'.repeat(64) };
            if (existing) await context.admin.staffNfcControl.update({ where: { id: 'active' }, data: { ...data, revision: { increment: 1 } } });
            else await context.admin.staffNfcControl.create({ data });
            const before = await context.admin.staffNfcControl.findUnique({ where: { id: 'active' } });
            await assert.rejects(() => context.admin.staffNfcControl.update({ where: { id: 'active' }, data: { enabled: true, revision: { increment: 1 } } }));
            assert.deepEqual(await context.admin.staffNfcControl.findUnique({ where: { id: 'active' } }), before);
        }
        assert.deepEqual({ jobs: await context.admin.staffNfcJob.count(), verifications: await context.admin.staffNfcVerification.count() }, history);
    });
}
