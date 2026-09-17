/** Dry-run is default. Execution needs a legitimately provisioned process
 * credential, one fixed cohort and a new output under a private directory. */
import { mkdir, open, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  PROVIDER_QUALIFICATION_PLAN, PROVIDER_QUALIFICATION_PLAN_HASH, PROVIDER_QUALIFICATION_COHORTS,
  qualifyStaffResearchProvider, type ProviderQualificationCohort,
} from '../lib/server/staffResearchProviderQualification';

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { process.stdout.write(JSON.stringify({ plan: PROVIDER_QUALIFICATION_PLAN, plan_sha256: PROVIDER_QUALIFICATION_PLAN_HASH }, null, 2) + '\n'); return; }
  if (args.length !== 5 || args[0] !== '--execute' || args[1] !== '--cohort' || args[3] !== '--output') throw Error('invalid_arguments');
  const cohort = args[2], output = args[4];
  if (!PROVIDER_QUALIFICATION_COHORTS.some(row => row.id === cohort) || !isAbsolute(output) || resolve(output) !== output || !process.env.SOLDCOMPS_API_KEY?.trim()) throw Error('invalid_execution');
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const parent = await lstat(dirname(output));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0) throw Error('private_directory_required');
  // Reserve the create-new output before incurring any provider work.
  const file = await open(output, 'wx', 0o600);
  try {
    const report = await qualifyStaffResearchProvider(cohort as ProviderQualificationCohort, { apiKey: process.env.SOLDCOMPS_API_KEY });
    await file.writeFile(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ output, request_counts: report.request_counts, search_status: report.search.status }) + '\n');
  } finally { await file.close(); }
}
void main().catch(() => { process.stderr.write('Provider check did not complete. No inventory was changed; do not automatically repeat an uncertain request.\n'); process.exitCode = 1; });
