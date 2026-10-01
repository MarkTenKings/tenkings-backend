import { inspectCommerceConfiguration } from '../src/readiness.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--channel' || !['ALL', 'MAIL_IN', 'KIOSK'].includes(args[1]))) {
    process.stderr.write('Usage: check-configuration.mjs [--channel ALL|MAIL_IN|KIOSK]\n');
    process.exitCode = 2;
} else {
    const result = inspectCommerceConfiguration(process.env, { channel: args[1] ?? 'ALL' });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === 'INCOMPLETE' || result.invalid.length > 0 ? 1 : 0;
}
