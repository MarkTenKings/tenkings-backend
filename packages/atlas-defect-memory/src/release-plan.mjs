import { canonical, digest, requireThat, hash } from './contract.mjs';

const sql = value => `'${String(value).replaceAll("'", "''")}'`;
const releaseId = value => requireThat(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value), 400, 'LEARNING_RELEASE_ID_INVALID');

/** Produces reviewable SQL, never executes it. Serving processes have no
 * activation privilege. Even a passing comparison needs an independent truth
 * audit and explicit owner authorization tied to the exact report digest. */
export function learningReleasePlan({ id, expectedActiveReleaseId, publications, evaluation, ownerApproval }) {
  releaseId(id); releaseId(expectedActiveReleaseId);
  const { sha256, ...body } = evaluation;
  requireThat(sha256 === digest(canonical(body, { maxBytes: 16777216 })) && evaluation.status === 'ELIGIBLE_FOR_OWNER_REVIEW'
    && evaluation.blockers.length === 0, 409, 'LEARNING_RELEASE_EVALUATION_REQUIRED');
  requireThat(ownerApproval?.evaluationSha256 === sha256 && typeof ownerApproval.approvedBy === 'string'
    && ownerApproval.approvedBy.trim().length > 0 && Number.isFinite(Date.parse(ownerApproval.approvedAt)), 409, 'LEARNING_RELEASE_OWNER_APPROVAL_REQUIRED');
  hash(ownerApproval.independentTruthAuditSha256);
  requireThat((evaluation.domain ?? 'DEFECT') === 'DEFECT', 409, 'LEARNING_RELEASE_DOMAIN_INVALID');
  hash(evaluation.policySettingsSha256);
  for (const key of ['modelPromptSha256', 'imagePolicySha256', 'scoringPolicySha256']) hash(evaluation.bindings?.[key]);
  requireThat(Array.isArray(publications) && publications.length <= 100000, 400, 'LEARNING_RELEASE_PUBLICATIONS_INVALID');
  const members = publications.map(p => { hash(p.sha256); requireThat(Number.isSafeInteger(p.revision) && p.revision > 0); return { revision: p.revision, sha256: p.sha256 }; })
    .sort((a, b) => a.revision - b.revision);
  requireThat(new Set(members.map(p => p.revision)).size === members.length
    && digest(canonical(members, { maxBytes: 16777216 })) === evaluation.candidateCorpusSha256, 409, 'LEARNING_RELEASE_CORPUS_MISMATCH');
  const manifest = canonical({ version: 'atlas-learning-release-v1', kind: 'EVALUATED_CANDIDATE', policy: evaluation.candidatePolicy,
    evaluation: { sha256, protocolSha256: evaluation.protocolSha256, corpusSha256: evaluation.corpusSha256 },
    qualification: { bindings: evaluation.bindings, policySettingsSha256: evaluation.policySettingsSha256 },
    learningMembership: { DEFECT: members.map(p => p.revision), CLEAN: [], GEOMETRY: [] }, ownerApproval, publications: members }, { maxBytes: 16777216 });
  return { version: 'atlas-learning-release-plan-v1', id, manifest, manifestSha256: digest(manifest),
    requiresPrivilegedExecution: true, changesMade: false,
    sql: `BEGIN;\nSELECT set_config('atlas.learning_change_reason',${sql(`Owner-approved evaluated release ${id}; evaluation ${sha256}`)},true);\nDO $atlas$ BEGIN\n IF (SELECT active_release_id FROM atlas_manual.learning_control WHERE singleton FOR UPDATE) IS DISTINCT FROM ${sql(expectedActiveReleaseId)} THEN RAISE EXCEPTION 'Active learning release changed'; END IF;\nEND $atlas$;\nINSERT INTO atlas_manual.learning_release(id,manifest,manifest_hash) VALUES(${sql(id)},${sql(manifest)},${sql(digest(manifest))});\nINSERT INTO atlas_manual.learning_release_member(release_id,publication_revision)\n SELECT ${sql(id)},(p->>'revision')::bigint FROM jsonb_array_elements(${sql(manifest)}::jsonb->'publications') p;\nUPDATE atlas_manual.learning_control SET active_release_id=${sql(id)} WHERE singleton;\nCOMMIT;\n` };
}

export function learningRollbackPlan({ expectedActiveReleaseId, restoreReleaseId, reason }) {
  releaseId(expectedActiveReleaseId); releaseId(restoreReleaseId);
  requireThat(typeof reason === 'string' && reason.trim().length > 0 && reason.length <= 2000, 400, 'LEARNING_ROLLBACK_REASON_REQUIRED');
  return { version: 'atlas-learning-rollback-plan-v1', requiresPrivilegedExecution: true, changesMade: false,
    sql: `BEGIN;\nSELECT set_config('atlas.learning_change_reason',${sql(reason)},true);\nDO $atlas$ BEGIN\n IF (SELECT active_release_id FROM atlas_manual.learning_control WHERE singleton FOR UPDATE) IS DISTINCT FROM ${sql(expectedActiveReleaseId)} THEN RAISE EXCEPTION 'Active learning release changed'; END IF;\nEND $atlas$;\nUPDATE atlas_manual.learning_control SET active_release_id=${sql(restoreReleaseId)} WHERE singleton;\nCOMMIT;\n` };
}
