import { canonical, digest, immutable, requireThat, hash } from './contract.mjs';
import { selectRoleLearning, validateLearningPolicy } from './role-learning.mjs';

const seal = value => immutable({ ...value, sha256: digest(canonical(value, { maxBytes: 16777216 })) });
const verify = value => { const { sha256, ...body } = value; hash(sha256);
  requireThat(digest(canonical(body, { maxBytes: 16777216 })) === sha256, 409, 'LEARNING_PROMOTION_HASH_MISMATCH'); return body; };
const sql = value => `'${String(value).replaceAll("'", "''")}'`;
const releaseId = value => requireThat(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value), 400, 'LEARNING_RELEASE_ID_INVALID');

/** Build a policy only from a passed, independently audited domain report and
 * explicit owner approval. Operators retain this exact object in an immutable
 * release. Merely saving human labels never constructs or activates a policy. */
export function validatedLearningPolicy({ settings, evaluation, registry, quality, ownerApproval, now = Date.now() }) {
  verify(evaluation);
  requireThat(evaluation.status === 'ELIGIBLE_FOR_OWNER_REVIEW' && evaluation.blockers.length === 0
    && (evaluation.domain ?? 'DEFECT') === settings.domain && evaluation.registrySha256 === registry.sha256
    && evaluation.reviewerQualitySha256 === quality.sha256 && evaluation.policySettingsSha256 === digest(canonical(settings))
    && canonical(evaluation.bindings) === canonical(settings.bindings), 409, 'LEARNING_VALIDATED_POLICY_REQUIRED');
  requireThat(ownerApproval?.evaluationSha256 === evaluation.sha256 && ownerApproval?.independentTruthAuditSha256,
    409, 'LEARNING_OWNER_POLICY_REQUIRED');
  const value = seal({ ...settings, version: 'atlas-validated-learning-policy-v1', status: 'VALIDATED',
    registrySha256: registry.sha256, reviewerQualitySha256: quality.sha256,
    evaluationSha256: evaluation.sha256, independentTruthAuditSha256: ownerApproval.independentTruthAuditSha256, ownerApproval });
  validateLearningPolicy(value, { domain: settings.domain, registry, quality, now }); return value;
}

/** Prepare a reviewable candidate under a validated policy without activation
 * SQL. Each exact candidate needs its own comparison and owner approval before
 * this offline tool can produce a privileged activation plan. Policy approval
 * is not approval of later publications; the operator verifies owner identity. */
export function learningPromotionPlan({ id, active, domain, policy, registry, quality, targetScope, candidates,
  monitoring, evaluation = null, ownerApproval = null, verifiedArtifactHashes = [], now = Date.now() }) {
  releaseId(id); releaseId(active.id); hash(active.manifestSha256);
  requireThat(digest(canonical(active.manifest, { maxBytes: 16777216 })) === active.manifestSha256,
    409, 'LEARNING_ACTIVE_RELEASE_MISMATCH');
  validateLearningPolicy(policy, { domain, registry, quality, now });
  const p = policy.promotion;
  requireThat(p?.enabled === true && Number.isInteger(p.maximumNewPublications) && p.maximumNewPublications > 0
    && p.maximumNewPublications <= 100 && Number.isInteger(p.maximumActivePublications) && p.maximumActivePublications > 0
    && Number.isInteger(p.minimumIndependentAudits) && p.minimumIndependentAudits >= 1
    && Number.isInteger(p.sampleEvery) && p.sampleEvery >= 1 && p.sampleEvery <= 100
    && Number.isFinite(p.monitoringMaximumAgeHours) && p.monitoringMaximumAgeHours > 0
    && Array.isArray(p.allowedLabels) && p.allowedLabels.length > 0
    && Array.isArray(p.familyIds) && p.familyIds.includes(targetScope.familyId)
    && Number.isInteger(p.minimumMonitoredCases) && p.minimumMonitoredCases > 0, 409, 'LEARNING_PROMOTION_NOT_APPROVED');
  verify(monitoring); const verified = new Set(verifiedArtifactHashes);
  requireThat(verified.has(monitoring.sha256) && monitoring.policySha256 === policy.sha256
    && monitoring.activeReleaseSha256 === active.manifestSha256 && monitoring.status === 'PASS'
    && monitoring.cases >= p.minimumMonitoredCases && Date.parse(monitoring.measuredAt) <= now
    && now - Date.parse(monitoring.measuredAt) <= p.monitoringMaximumAgeHours * 3600000,
  409, 'LEARNING_PROMOTION_MONITORING_REQUIRED');
  requireThat(Array.isArray(candidates) && candidates.length <= 256, 400, 'LEARNING_CANDIDATE_LIMIT');
  const decisions = [], accepted = new Map();
  for (const candidate of candidates) {
    const { publication, feedback, audit } = candidate;
    hash(publication.sha256); hash(feedback.sha256);
    requireThat(Number.isSafeInteger(publication.revision) && publication.revision > 0
      && digest(canonical(feedback.document, { maxBytes: 4194304 })) === feedback.sha256, 409, 'LEARNING_PROMOTION_HASH_MISMATCH');
    const source = feedback.document.source, card = registry.cards.find(c => c.cardId === source.cardId);
    const examples = feedback.document.examples.filter(e => e.kind === (domain === 'CLEAN' ? 'CLEAN_SIDE' : domain));
    const audited = audit && verified.has(audit.sha256) && verify(audit)
      && audit.feedbackSha256 === feedback.sha256 && audit.publicationSha256 === publication.sha256
      && audit.status === 'PASS' && Array.isArray(audit.reviewers)
      && new Set(audit.reviewers.filter(actor => actor !== source.actorId)).size >= p.minimumIndependentAudits;
    let reason = !card || card.familyId !== targetScope.familyId ? 'OUTSIDE_APPROVED_FAMILY'
      : !examples.length || examples.some(e => !p.allowedLabels.includes(e.label)) ? 'LABEL_REQUIRES_NEW_EVALUATION'
      : !audited ? 'INDEPENDENT_PUBLICATION_AUDIT_REQUIRED' : null;
    if (!reason) {
      // Select against a separate known target specimen to apply identical
      // identity, source, quality, exact-negative and role rules as serving.
      const selection = selectRoleLearning({ domain, policy, registry, quality, bindings: policy.bindings, target: targetScope,
        candidates: examples.map((example, i) => ({ id: digest(`${feedback.sha256}:${i}`), feedbackSha256: feedback.sha256, source, example })), now });
      if (!selection.examples.length) reason = 'SERVING_ELIGIBILITY_FAILED';
    }
    if (!reason && !accepted.has(publication.revision) && accepted.size >= p.maximumNewPublications) reason = 'PROMOTION_BATCH_LIMIT';
    decisions.push({ revision: publication.revision, admitted: !reason, reason: reason ?? 'APPROVED_POLICY_ADMISSION' });
    if (!reason) accepted.set(publication.revision, { ...publication, cardId: source.cardId, actionId: source.actionId,
      feedbackSha256: feedback.sha256, auditSha256: audit.sha256 });
  }
  requireThat(accepted.size > 0, 409, 'LEARNING_PROMOTION_EMPTY');
  const members = new Map(active.manifest.publications.map(p => [p.revision, p]));
  for (const p of accepted.values()) { requireThat(!members.has(p.revision) || members.get(p.revision).sha256 === p.sha256, 409, 'LEARNING_RELEASE_CORPUS_MISMATCH');
    members.set(p.revision, { revision: p.revision, sha256: p.sha256 }); }
  requireThat(members.size <= p.maximumActivePublications, 409, 'LEARNING_PROMOTION_CAPACITY');
  const publications = [...members.values()].sort((a, b) => a.revision - b.revision);
  // A confirmation can contain defect, clean and geometry examples together.
  // Publication identity is shared; authority to serve each domain is not.
  const learningMembership = Object.fromEntries(['DEFECT', 'CLEAN', 'GEOMETRY'].map(role => [role,
    active.manifest.learningMembership?.[role] ?? (role === 'DEFECT' || active.manifest.learningScopes?.[role]
      ? active.manifest.publications.map(p => p.revision) : [])]));
  learningMembership[domain] = [...new Set([...learningMembership[domain], ...accepted.keys()])].sort((a, b) => a - b);
  const candidateManifest = { version: 'atlas-learning-release-v1', kind: 'VALIDATED_POLICY_PROMOTION',
    policy: active.manifest.policy, publications, learningMembership,
    ...(active.manifest.qualification ? { qualification: active.manifest.qualification } : {}), parent: { id: active.id, sha256: active.manifestSha256 },
    learningScopes: { ...active.manifest.learningScopes, [domain]: { policy, registry, quality } },
    promotion: { policySha256: policy.sha256, monitoringSha256: monitoring.sha256, decisions,
      admissions: [...accepted.values()], sampleRequired: [...accepted.values()].filter(e => Number.parseInt(e.sha256.slice(0, 8), 16) % p.sampleEvery === 0)
        .map(e => e.revision) } };
  const review = seal({ version: 'atlas-learning-promotion-review-v1', status: 'REQUIRES_OWNER_REVIEW', id, domain,
    activeRelease: { id: active.id, sha256: active.manifestSha256 },
    candidateManifest, candidateManifestSha256: digest(canonical(candidateManifest, { maxBytes: 16777216 })),
    candidateCorpusSha256: digest(canonical(publications, { maxBytes: 16777216 })),
    changesMade: false, requiresOwnerApproval: true });
  // Drafting and evaluation must remain possible before anyone approves a
  // release. No SQL or implied approval is returned on this path.
  if (ownerApproval === null) return review;
  requireThat(evaluation, 409, 'LEARNING_PROMOTION_EVALUATION_REQUIRED'); verify(evaluation);
  const settings = Object.fromEntries(['id', 'domain', 'selection', 'geometry', 'promotion', 'bindings', 'validFrom', 'validUntil']
    .map(key => [key, policy[key]]));
  requireThat(['atlas-learning-evaluation-v1', 'atlas-domain-learning-evaluation-v1'].includes(evaluation.version)
    && evaluation.status === 'ELIGIBLE_FOR_OWNER_REVIEW' && evaluation.blockers.length === 0
    && (evaluation.domain ?? 'DEFECT') === domain && evaluation.baselineReleaseSha256 === active.manifestSha256
    && evaluation.candidateCorpusSha256 === review.candidateCorpusSha256
    && evaluation.policySettingsSha256 === digest(canonical(settings))
    && evaluation.registrySha256 === registry.sha256 && evaluation.reviewerQualitySha256 === quality.sha256
    && canonical(evaluation.bindings) === canonical(policy.bindings)
    && verified.has(digest(`${JSON.stringify(evaluation, null, 2)}\n`)),
  409, 'LEARNING_PROMOTION_EVALUATION_REQUIRED');
  requireThat(ownerApproval.purpose === 'PROMOTE_LEARNING_RELEASE' && ownerApproval.reviewSha256 === review.sha256
    && ownerApproval.evaluationSha256 === evaluation.sha256 && typeof ownerApproval.approvedBy === 'string'
    && ownerApproval.approvedBy.trim().length > 0 && ownerApproval.approvedBy.length <= 512
    && Number.isFinite(Date.parse(ownerApproval.approvedAt)) && Date.parse(ownerApproval.approvedAt) <= now,
  409, 'LEARNING_PROMOTION_OWNER_APPROVAL_REQUIRED');
  hash(ownerApproval.independentTruthAuditSha256);
  requireThat(verified.has(ownerApproval.independentTruthAuditSha256), 409, 'LEARNING_PROMOTION_TRUTH_AUDIT_REQUIRED');
  const manifest = { ...candidateManifest, promotion: { ...candidateManifest.promotion,
    reviewSha256: review.sha256, evaluationSha256: evaluation.sha256, ownerApproval } };
  const document = canonical(manifest, { maxBytes: 16777216 }), manifestSha256 = digest(document);
  // Only numeric revisions and validated hashes enter the procedural dollar
  // body; arbitrary metadata stays in ordinarily quoted manifest literals.
  const admission = canonical([...accepted.values()].map(e => ({ revision: e.revision, sha256: e.sha256, feedbackSha256: e.feedbackSha256 })));
  const result = { version: 'atlas-learning-promotion-plan-v1', status: 'OWNER_APPROVED_REQUIRES_PRIVILEGED_EXECUTION', id,
    manifest, manifestSha256, changesMade: false, requiresPrivilegedExecution: true,
    sql: `BEGIN;\nSELECT set_config('atlas.learning_change_reason',${sql(`Validated policy ${policy.id}; promotion ${id}`)},true);\nDO $atlas$ BEGIN\n IF NOT EXISTS(SELECT 1 FROM atlas_manual.learning_control c JOIN atlas_manual.learning_release r ON r.id=c.active_release_id WHERE r.id=${sql(active.id)} AND r.manifest_hash=${sql(active.manifestSha256)} FOR UPDATE OF c) THEN RAISE EXCEPTION 'Active learning release changed'; END IF;\n IF EXISTS(SELECT 1 FROM jsonb_array_elements(${sql(admission)}::jsonb) e WHERE NOT EXISTS(SELECT 1 FROM atlas_manual.learning_publication p JOIN atlas_manual.learning_publication_job j ON j.card_id=p.card_id AND j.action_id=p.action_id WHERE p.revision=(e->>'revision')::bigint AND p.document_hash=e->>'sha256' AND j.feedback_hash=e->>'feedbackSha256' AND j.state='PREPARED' AND NOT EXISTS(SELECT 1 FROM atlas_manual.learning_withdrawal w WHERE w.publication_revision=p.revision) AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id) AND NOT EXISTS(SELECT 1 FROM atlas_manual.action a WHERE a.card_id=p.card_id AND a.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS' AND a.result_revision>p.result_revision))) THEN RAISE EXCEPTION 'Promotion source changed'; END IF;\nEND $atlas$;\nINSERT INTO atlas_manual.learning_release(id,manifest,manifest_hash) VALUES(${sql(id)},${sql(document)},${sql(manifestSha256)});\nINSERT INTO atlas_manual.learning_release_member(release_id,publication_revision) SELECT ${sql(id)},(p->>'revision')::bigint FROM jsonb_array_elements(${sql(document)}::jsonb->'publications') p;\nUPDATE atlas_manual.learning_control SET active_release_id=${sql(id)} WHERE singleton;\nCOMMIT;\n` };
  const { sql: statement, ...receipt } = result;
  return { ...seal({ ...receipt, sqlSha256: digest(statement) }), sql: statement };
}
