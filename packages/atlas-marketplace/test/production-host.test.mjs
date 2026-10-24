import test from 'node:test';
import assert from 'node:assert/strict';
import { startProductionMarketplaceHost } from '../src/production-host.mjs';

test('production startup refuses missing owners before constructing clients or listeners', async () => {
    await assert.rejects(startProductionMarketplaceHost(), { code: 'PRODUCTION_RUNTIME_OWNERS_REQUIRED' });
});

test('fixture environment or supplied auth states cannot replace production canonical construction', async () => {
    for (const input of [
        { manifest: { environment: 'PROVIDER_SANDBOX' } },
        { manifest: { environment: 'PRODUCTION' }, host: { config: { environment: 'PRODUCTION', proofAuthority: { enabled: true } }, proofAuthority: {},
            r1: { admitRequest() {}, admitPublicRequest() {}, staffState: {} } } },
    ]) await assert.rejects(startProductionMarketplaceHost(input), { code: 'PRODUCTION_RUNTIME_OWNERS_REQUIRED' });
});
