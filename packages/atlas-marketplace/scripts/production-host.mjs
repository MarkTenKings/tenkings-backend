import { loadProductionProcessInputs, productionProcessArguments } from '../src/production-inputs.mjs';
import { openProductionMarketplaceProcess } from '../src/production-runtime.mjs';

// No dotenv, provider discovery, dynamic module, automatic restart or retry.
// The inherited FD is the only secret input; stdout is bounded status metadata.
process.umask(0o077);
let owner, stopping = false, closePromise;
const report = value => process.stdout.write(JSON.stringify(value) + '\n');
const failure = error => ({ status: 'ATLAS_MARKETPLACE_PROCESS_STOPPED',
    errorCode: /^[A-Z0-9_]{1,100}$/.test(error?.code ?? '') ? error.code : 'PRODUCTION_PROCESS_FAILED',
    errorClass: /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error?.name ?? '') ? error.name : 'Error' });
const close = () => closePromise ??= (async () => { stopping = true; await owner?.close(); })();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void close().catch(error => { process.exitCode = 1; report(failure(error)); }); });
for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, error => {
    process.exitCode = 1; report(failure(error)); void close().catch(stopError => report(failure(stopError)));
});
try {
    const inputs = await loadProductionProcessInputs(productionProcessArguments(process.argv.slice(2)));
    if (stopping) throw Object.assign(new Error(), { code: 'PRODUCTION_PROCESS_STOPPED' });
    owner = await openProductionMarketplaceProcess(inputs);
    if (stopping) { await owner.close(); } else { report(owner.status()); report(await owner.start()); }
} catch (error) {
    process.exitCode = 1; report(failure(error));
    try { await owner?.close(); } catch (stopError) { report(failure(stopError)); }
}
