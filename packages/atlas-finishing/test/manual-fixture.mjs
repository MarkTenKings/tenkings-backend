import { createHash } from 'node:crypto';
import { createManualFinishingPlan } from '../src/manual.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function samplePlan({ mode = 'PRODUCTION', version = 3, identity = null } = {}) {
  const packet = { version: 'atlas-public-manual-report-v2', mode, reportHash: 'b'.repeat(64), publicToken: `ar_${'A'.repeat(24)}`,
    reportNumber: 'ATLAS-0123456789AB', approvalVersion: version, report: { version: 'atlas-manual-draft-report-v2', cardProfile: 'SPORTS',
      identity: identity ?? { playerName: 'Example Player', year: '2024', manufacturer: 'Panini', productSet: 'Prizm', parallel: 'Silver', insert: null, cardNumber: '24' },
      grade: { overall: { rawGrade: 9.7 } }, finalGrade: 9.5, finalGradePolicy: 'atlas-final-half-point-v1' } };
  return createManualFinishingPlan({ cardId: '00112233-4455-4677-8899-aabbccddeeff', approvalActionId: 'ffeeddcc-bbaa-4998-8766-554433221100',
    sourceRevision: 12, sourceHash: 'c'.repeat(64), packet, publicHash: sha(JSON.stringify(packet)) });
}
