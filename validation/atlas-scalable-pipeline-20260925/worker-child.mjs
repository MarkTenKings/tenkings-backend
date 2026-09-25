// Disposable fixture only. Receives an ephemeral restricted DB credential over
// IPC; no HTTP, browser actor, production credential or provider port exists.
import { PrismaClient } from '../../frontend/atlas-app/.generated/staff-database/index.js';
import { createMachineStaffBoundary } from '../../packages/atlas-manual-service/src/machine-auth.mjs';
import { createIntakeRepository } from '../../packages/atlas-manual-intake/src/repository.mjs';
import { createBatchRepository } from '../../packages/atlas-batch-grading/src/repository.mjs';
import { createBatchWorker } from '../../packages/atlas-batch-grading/src/index.mjs';

let client, worker;
const gates = new Map();
const send = value => process.connected && process.send(value);
process.on('message', async message => {
  try {
    if (message.type === 'init') {
      client = new PrismaClient({ datasources: { db: { url: message.databaseUrl } } });
      const config = { ...message.binding, phoneByHash: new Map(message.phoneHashes.map(x => [x, true])) };
      const boundary = createMachineStaffBoundary({ manualClient: client, auth: { config },
        boundary: { transaction: () => { throw new Error('Browser actors are forbidden in this child'); } } });
      const intakeRepository = createIntakeRepository({ boundary, keyPrefix: 'fixture', maxOriginalBytes: 100000000 });
      const repository = createBatchRepository({ boundary, intakeRepository });
      worker = createBatchWorker({ repository, concurrency: 20, analysisConcurrency: 20,
        onError: error => send({ type: 'error', code: error.code ?? error.name }),
        prepare: { run: async (staff, job) => {
          if (job.stage === 'ANALYZE') {
            const gate = new Promise(resolve => gates.set(job.key, resolve));
            send({ type: 'claim', key: job.key, action: job.analysisActionId, attempts: job.attempts });
            const outcome = await gate;
            return outcome ?? { kind: 'CONTINUE', evidence: { fixtureAnalysis: true } };
          }
          if (job.stage === 'REPORT') return { kind: 'REVIEW', evidence: { reportHash: 'f'.repeat(64), manualRevision: 1, sourceHash: job.sourceHash, authority: 'MACHINE_PROPOSAL' } };
          return { kind: 'CONTINUE' };
        } } });
      send({ type: 'started' });
    } else if (message.type === 'release') {
      gates.get(message.key)?.(message.outcome); gates.delete(message.key);
    } else if (message.type === 'stop') {
      for (const resolve of gates.values()) resolve({ kind: 'WAIT', code: 'FIXTURE_STOP', retryAfterMs: 2000 });
      gates.clear(); await worker?.stop(); await client?.$disconnect(); send({ type: 'stopped' }); process.disconnect();
    }
  } catch (error) { send({ type: 'fatal', code: error.code ?? error.name }); process.exitCode = 1; }
});
