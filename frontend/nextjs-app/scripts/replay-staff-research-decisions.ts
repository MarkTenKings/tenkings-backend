/** All reads are local; no application database/provider credential is used. */
import { readFile, mkdir, open, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadResearchReplayVersions, replaySyntheticResearch, replayHistoricalResearch, replayHash } from './lib/staffResearchReplay';

async function main() {
  const args = process.argv.slice(2), outputIndex = args.indexOf('--output'), snapshotIndex = args.indexOf('--snapshot');
  if (outputIndex !== 0 || ![2, 4].includes(args.length) || args.length === 4 && snapshotIndex !== 2) throw Error('Use --output /private/new-report.json [--snapshot /private/snapshot.json]');
  const output = args[1], snapshotPath = snapshotIndex >= 0 ? args[snapshotIndex + 1] : null;
  if (!isAbsolute(output) || resolve(output) !== output || snapshotPath && !isAbsolute(snapshotPath)) throw Error('Absolute paths are required');
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const parent = await lstat(dirname(output));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.mode & 0o077) throw Error('Private output directory required');
  const reportFile = await open(output, 'wx', 0o600);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  let versions: Awaited<ReturnType<typeof loadResearchReplayVersions>> | undefined;
  try {
    versions = await loadResearchReplayVersions(root);
    const synthetic = await replaySyntheticResearch(versions);
    const snapshotBytes = snapshotPath ? await readFile(snapshotPath) : null;
    if (snapshotBytes && snapshotBytes.length > 64 * 1024 * 1024) throw Error('Snapshot exceeds bounded input');
    const historical = snapshotBytes ? replayHistoricalResearch(JSON.parse(snapshotBytes.toString('utf8')), versions) : null;
    const report = { schema_version: 1, generated_at: new Date().toISOString(), baseline_commit: versions.baselineCommit, candidate_base_commit: versions.candidateCommit,
      source_sha256: versions.hashes, full_resolution_images: false, source_and_model_requests: 'injected fixture transport only',
      synthetic, historical, snapshot_sha256: snapshotBytes ? replayHash(snapshotBytes) : null,
      limitations: ['Synthetic model proposals test mechanisms and rejection controls, not recognition accuracy.', 'Historical snapshots omit raw provider/model payloads; terminal evidence rechecks cannot establish realized prices or replay full original decisions.', 'No paid provider, inventory, database, catalog publication, Atlas or saved result mutation occurred.'] };
    await reportFile.writeFile(JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ output, synthetic_passed: synthetic.passed, synthetic_cases: synthetic.cases.length, historical_candidates: historical?.candidate_count ?? null }) + '\n');
    if (!synthetic.passed) process.exitCode = 1;
  } finally { await reportFile.close(); await versions?.close(); }
}
void main().catch(error => { process.stderr.write(`Offline research replay failed: ${error instanceof Error ? error.message : 'unknown failure'}\n`); process.exitCode = 1; });
