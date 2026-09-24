import { inspectCommerceConfiguration } from '../src/readiness.mjs';

const result = inspectCommerceConfiguration(process.env);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.status === 'INCOMPLETE' || result.invalid.length > 0 ? 1 : 0;
