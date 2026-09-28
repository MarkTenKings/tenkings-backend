import { digest, immutable } from './contract.mjs';
import { BALANCED_DEFECT_POLICY, selectDefectLessons } from './retrieval-policy.mjs';
import { readActiveLearning } from './active-retrieval.mjs';
import { readRoleLearning } from './role-repository.mjs';
import { selectRoleLearning, validateLearningRegistry, validateReviewerQuality, validateLearningPolicy,
  normalizeLearningIdentity, consumeCleanLearning } from './role-learning.mjs';

/** Candidate qualification covers selection behavior as well as the prompt.
 * Function fingerprints include the legacy SQL ordering and active-domain
 * filtering; same-named policy code changes cannot silently reuse validation. */
export function learningRetrievalBindingFacts() {
  return immutable({ version: 'atlas-learning-retrieval-bindings-v1', balancedPolicy: BALANCED_DEFECT_POLICY,
    algorithms: Object.fromEntries(Object.entries({ selectDefectLessons, readActiveLearning, readRoleLearning,
      selectRoleLearning, validateLearningRegistry, validateReviewerQuality, validateLearningPolicy,
      normalizeLearningIdentity, consumeCleanLearning }).map(([name, fn]) => [name, digest(String(fn))])) });
}
