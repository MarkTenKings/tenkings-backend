// Offline ATLAS-owned tooling. No network, database, provider, or deployment
// client is imported. Output files are private and never overwrite an artifact.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { canonical, digest, requireThat } from '../src/contract.mjs';
import { compareLearningEvaluation, shadowCollectionPlan } from '../src/evaluation.mjs';
import { learningReleasePlan, learningRollbackPlan } from '../src/release-plan.mjs';
import { compareCleanLearningEvaluation, compareGeometryLearningEvaluation } from '../src/domain-evaluation.mjs';
import { learningRetrievalBindingFacts } from '../src/binding-facts.mjs';
import { geometryLearningConsumerFacts } from '../src/role-learning.mjs';
import { validatedLearningPolicy, learningPromotionPlan } from '../src/promotion.mjs';
import { defectAnalysisBaselineFacts, cleanLearningConsumerFacts } from '../../atlas-defect-analysis/src/index.mjs';

const [command, inputPath, outputPath] = process.argv.slice(2);
requireThat(['baseline', 'shadow', 'compare', 'release-plan', 'rollback-plan', 'compare-clean', 'compare-geometry', 'policy', 'promote-plan'].includes(command) && inputPath && outputPath
  && process.argv.length === 5, 400, 'LEARNING_TOOL_USAGE');
const input = JSON.parse(await readFile(resolve(inputPath), 'utf8'));
async function verifiedArtifacts(artifacts) {
  requireThat(Array.isArray(artifacts) && artifacts.length <= 50000, 400, 'LEARNING_EVAL_ARTIFACTS_REQUIRED');
  const hashes = new Set();
  for (const artifact of artifacts) {
    const bytes = await readFile(resolve(artifact.path));
    requireThat(bytes.length <= 64 * 1024 * 1024 && digest(bytes) === artifact.sha256, 409, 'LEARNING_EVAL_ARTIFACT_HASH_MISMATCH');
    hashes.add(artifact.sha256);
  }
  return hashes;
}
let output;
if (command === 'baseline') {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const files = ['packages/atlas-defect-analysis/src/index.mjs', 'packages/atlas-defect-memory/src/active-retrieval.mjs',
    'packages/atlas-defect-memory/src/retrieval-policy.mjs', 'packages/atlas-defect-memory/src/evaluation.mjs',
    'packages/atlas-defect-memory/src/release-plan.mjs', 'packages/atlas-defect-memory/src/role-learning.mjs',
    'packages/atlas-defect-memory/src/role-repository.mjs', 'packages/atlas-defect-memory/src/binding-facts.mjs', 'packages/atlas-defect-memory/src/domain-evaluation.mjs',
    'packages/atlas-defect-memory/src/promotion.mjs', 'packages/atlas-connected-manual/src/geometry-learning.mjs',
    'packages/atlas-grading-core/src/scoring.ts'];
  const sources = [];
  for (const path of files) sources.push({ path, sha256: digest(await readFile(resolve(root, path))) });
  output = { version: 'atlas-learning-baseline-facts-v1', capturedAt: new Date().toISOString(),
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    analysis: defectAnalysisBaselineFacts(), cleanConsumer: cleanLearningConsumerFacts(), geometryConsumer: geometryLearningConsumerFacts(), retrieval: learningRetrievalBindingFacts(), sourceFiles: sources,
    suppliedRuntimeEvidence: input, activeCorpus: input.activeRelease ?? null,
    limitations: ['Local facts do not prove deployed configuration; supplied runtime evidence requires an independent read-only capture.',
      'The provider model alias can change. Retain actual response model, prompt and request hashes on every comparison.'] };
} else if (command === 'shadow') output = shadowCollectionPlan(input.corpus, input.protocol);
else if (['compare', 'compare-clean', 'compare-geometry'].includes(command)) {
  const verifiedArtifactHashes = await verifiedArtifacts(input.artifacts);
  const compare = command === 'compare-clean' ? compareCleanLearningEvaluation
    : command === 'compare-geometry' ? compareGeometryLearningEvaluation : compareLearningEvaluation;
  output = compare(input, { verifiedArtifactHashes });
} else if (command === 'policy') output = validatedLearningPolicy(input);
else if (command === 'promote-plan') output = learningPromotionPlan({ ...input, verifiedArtifactHashes: [...await verifiedArtifacts(input.artifacts)] });
else if (command === 'release-plan') output = learningReleasePlan(input);
else output = learningRollbackPlan(input);
await writeFile(resolve(outputPath), `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
process.stdout.write(`${JSON.stringify({ command, outputPath: resolve(outputPath), status: output.status ?? 'PREPARED_OFFLINE', changesMade: false })}\n`);
