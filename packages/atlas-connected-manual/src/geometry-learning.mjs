import { learningRetrievalBindingFacts } from '../../atlas-defect-memory/src/binding-facts.mjs';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { PREPARATION_LOSSLESS_SETTINGS } from '@atlas/preparation-runtime';
import { ATLAS_FINAL_GRADE_POLICY } from '@atlas/grading-core/manual-report';
import { readRoleLearning, consumeGeometryLearning, geometryLearningConsumerFacts } from '@atlas/defect-memory';

/** Deployment-owned observer of actual native proposals. It is dormant unless
 * the active release contains a validated GEOMETRY scope. Advice is retained
 * separately from native geometry and cannot grant approval or replace a quad. */
export function createNativeGeometryLearning({ boundary, intakeRepository }) {
  return ({ input, targetFrameSha256, candidates }) => boundary.machineTransaction(null, async ({ tx }) => {
    const [active] = await tx.$queryRawUnsafe(`SELECT r.manifest::jsonb->'learningScopes'->'GEOMETRY' AS scope
      FROM atlas_manual.learning_control c JOIN atlas_manual.learning_release r ON r.id=c.active_release_id`);
    if (!active?.scope) return null;
    await intakeRepository.assertActiveInTransaction(tx, input.cardId);
    const uploads = await tx.$queryRawUnsafe(`SELECT u.id,u.side,u.plan::jsonb #>> '{expected,sha256}' AS original_hash,u.source
      FROM atlas_manual_intake.card c JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id IN(c.front_upload_id,c.back_upload_id)
      WHERE c.id=$1::uuid ORDER BY u.side`, input.cardId);
    const current = uploads.find(u => u.side === input.side);
    requireThat(current?.id === input.uploadId && canonical(JSON.parse(current.source)) === canonical(input.photoSource), 409, 'GEOMETRY_PHOTO_CHANGED');
    if (uploads.length !== 2) return { status: 'BASELINE', reason: 'PAIRED_SOURCE_IDENTITY_PENDING', requiresHumanConfirmation: true };
    const nativeEngineSha256 = digest(canonical(input.engine));
    const bindings = { modelPromptSha256: digest(canonical({ nativeEngineSha256, consumer: geometryLearningConsumerFacts(), retrieval: learningRetrievalBindingFacts() })),
      imagePolicySha256: digest(canonical(PREPARATION_LOSSLESS_SETTINGS)), scoringPolicySha256: digest(canonical(ATLAS_FINAL_GRADE_POLICY)) };
    const scope = await readRoleLearning(tx, { domain: 'GEOMETRY', bindings,
      target: { cardId: input.cardId, side: input.side, originalSha256: uploads.map(u => u.original_hash) } });
    requireThat(candidates.every(c => c.engineSha256 === nativeEngineSha256), 409, 'LEARNING_GEOMETRY_SOURCE_MISMATCH');
    const advice = consumeGeometryLearning({ ...scope, targetFrameSha256,
      candidates: candidates.map(c => ({ ...c, engineSha256: bindings.modelPromptSha256 })) });
    return { ...advice, nativeEngineSha256, target: scope.selection.target ?? null,
      nativeGeometry: candidates.length === 1 ? { physical: candidates[0].physical, printed: candidates[0].printed } : null,
      policySha256: scope.policy?.sha256 ?? null, releaseSha256: scope.release?.sha256 ?? null };
  });
}

export async function readNativeGeometryAdvice({ boundary, earlyGeometry, staff, cardId, now = Date.now() }) {
  // No scope preserves the baseline read path. Cached advice is useful only if
  // the same release, current sources and every selected lesson remain eligible.
  const enabled = await boundary.transaction(staff, async ({ tx }) => {
    const [row] = await tx.$queryRawUnsafe(`SELECT r.manifest::jsonb #>> '{learningScopes,GEOMETRY,policy,sha256}' AS policy_hash
      FROM atlas_manual.learning_control c JOIN atlas_manual.learning_release r ON r.id=c.active_release_id`);
    return Boolean(row?.policy_hash);
  });
  if (!enabled) return null;
  const sides = await earlyGeometry.status(staff, cardId);
  return boundary.transaction(staff, async ({ tx }) => {
    const uploads = await tx.$queryRawUnsafe(`SELECT u.side,u.plan::jsonb #>> '{expected,sha256}' AS original_hash
      FROM atlas_manual_intake.card c JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id IN(c.front_upload_id,c.back_upload_id)
      WHERE c.id=$1::uuid ORDER BY u.side`, cardId);
    if (uploads.length !== 2) return {};
    const advice = {};
    for (const side of ['FRONT', 'BACK']) {
      const saved = sides[side]?.learningAdvice;
      if (!['CANDIDATE', 'ABSTAIN'].includes(saved?.status) || saved.target?.cardId !== cardId
        || saved.target.side !== side || !saved.nativeGeometry) continue;
      const bindings = { modelPromptSha256: digest(canonical({ nativeEngineSha256: saved.nativeEngineSha256, consumer: geometryLearningConsumerFacts(), retrieval: learningRetrievalBindingFacts() })),
        imagePolicySha256: digest(canonical(PREPARATION_LOSSLESS_SETTINGS)), scoringPolicySha256: digest(canonical(ATLAS_FINAL_GRADE_POLICY)) };
      const scope = await readRoleLearning(tx, { domain: 'GEOMETRY', bindings, now,
        target: { cardId, side, originalSha256: uploads.map(u => u.original_hash) } });
      if (scope.selection.status === 'READY' && scope.policy?.sha256 === saved.policySha256
        && scope.release?.sha256 === saved.releaseSha256 && scope.selection.sha256 === saved.selectionSha256) advice[side] = {
        status: saved.status, frameSha256: saved.targetFrameSha256, nativeGeometry: saved.nativeGeometry, requiresHumanConfirmation: true };
    }
    return advice;
  });
}
