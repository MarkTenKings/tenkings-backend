import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/contract.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cli = fileURLToPath(new URL('../scripts/evaluate.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });

test('baseline CLI records existing source bytes in a private new file and refuses overwrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-learning-evaluation-'));
  try {
    const inputPath = join(directory, 'input.json'), outputPath = join(directory, 'baseline.json');
    const input = { activeRelease: { id: 'synthetic-empty-baseline', publications: [] } };
    await writeFile(inputPath, JSON.stringify(input));
    const result = run('baseline', inputPath, outputPath);
    assert.equal(result.status, 0, result.stderr);
    const original = await readFile(outputPath), output = JSON.parse(original);
    assert.deepEqual(output.activeCorpus, input.activeRelease);
    assert.equal(JSON.parse(result.stdout).changesMade, false);
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert(output.sourceFiles.some(file => file.path === 'packages/atlas-defect-memory/scripts/evaluate.mjs'));
    for (const file of output.sourceFiles) assert.equal(digest(await readFile(join(root, file.path))), file.sha256);
    const repeated = run('baseline', inputPath, outputPath);
    assert.notEqual(repeated.status, 0);
    assert.match(repeated.stderr, /EEXIST/);
    assert.deepEqual(await readFile(outputPath), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('retired activation commands are rejected before reading input or producing an artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-learning-evaluation-'));
  try {
    for (const command of ['policy', 'promote-plan', 'release-plan', 'rollback-plan']) {
      const outputPath = join(directory, `${command}.json`);
      const result = run(command, join(directory, 'absent-input.json'), outputPath);
      assert.notEqual(result.status, 0, command);
      assert.match(result.stderr, /LEARNING_TOOL_USAGE/, command);
      assert.equal(result.stdout, '', command);
      await assert.rejects(stat(outputPath), { code: 'ENOENT' });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
