import { canonical, digest, requireThat, validateFrame } from './contract.mjs';
import { selectRoleLearning, roleLearningFallback } from './role-learning.mjs';

/** Uses only active immutable release membership. Scope config is privileged
 * release data; no public request can supply a policy, reviewer score or alias.
 * No scope in the frozen baseline means no new behavior and no candidate scan. */
export async function readRoleLearning(tx, { domain, target, bindings, now = Date.now() }) {
  const [release] = await tx.$queryRawUnsafe(`SELECT r.id,r.manifest,r.manifest_hash FROM atlas_manual.learning_control c
    JOIN atlas_manual.learning_release r ON r.id=c.active_release_id`);
  requireThat(release && digest(release.manifest) === release.manifest_hash, 503, 'MEMORY_ACTIVE_RELEASE_REQUIRED');
  const manifest = JSON.parse(release.manifest), scope = manifest.learningScopes?.[domain];
  const domainMembers = manifest.learningMembership ? manifest.learningMembership[domain] ?? [] : null;
  requireThat(domainMembers === null || Array.isArray(domainMembers) && domainMembers.every(v => Number.isSafeInteger(v) && v > 0),
    503, 'MEMORY_ACTIVE_MEMBERSHIP_INVALID');
  if (!scope) return { selection: selectRoleLearning({ domain, policy: null }), policy: null };
  try { selectRoleLearning({ domain, ...scope, bindings, target, candidates: [], now }); }
  catch (error) {
    if ([401, 403].includes(error?.status) || error?.code === 'LEARNING_TARGET_INVALID') throw error;
    return { selection: roleLearningFallback({ domain, reason: error?.code === 'LEARNING_POLICY_EXPIRED' ? 'POLICY_EXPIRED'
      : error?.code === 'LEARNING_RUNTIME_POLICY_CHANGED' ? 'RUNTIME_POLICY_CHANGED' : 'POLICY_INVALID',
    policySha256: /^[a-f0-9]{64}$/.test(scope.policy?.sha256) ? scope.policy.sha256 : digest('invalid-role-policy') }), policy: null };
  }
  const own = scope.registry.cards.find(c => c.cardId === target.cardId && target.originalSha256.every(h => c.originalSha256.includes(h)));
  const cardIds = own ? scope.registry.cards.filter(c => c.familyId === own.familyId && c.specimenId !== own.specimenId)
    .map(c => c.cardId).sort().slice(0, 512) : [];
  const rows = cardIds.length ? await tx.$queryRawUnsafe(`SELECT p.card_id,p.action_id,p.revision,j.feedback,j.feedback_hash
    FROM atlas_manual.learning_publication p JOIN atlas_manual.learning_release_member m ON m.publication_revision=p.revision
    JOIN atlas_manual.learning_publication_job j ON j.card_id=p.card_id AND j.action_id=p.action_id
    WHERE m.release_id=$1 AND p.card_id=ANY($2::uuid[]) AND ($3::bigint[] IS NULL OR p.revision=ANY($3::bigint[])) AND j.state='PREPARED' AND j.feedback IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM atlas_manual.learning_withdrawal w WHERE w.publication_revision=p.revision)
      AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)
      AND NOT EXISTS(SELECT 1 FROM atlas_manual.action a WHERE a.card_id=p.card_id
        AND a.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS' AND a.result_revision>p.result_revision)
    ORDER BY p.revision DESC LIMIT 256`, release.id, cardIds, domainMembers) : [];
  const candidates = [], unavailable = [];
  for (const row of rows) {
    try {
    requireThat(digest(row.feedback) === row.feedback_hash, 503, 'MEMORY_FEEDBACK_INVALID');
    const feedback = JSON.parse(row.feedback);
    requireThat(feedback.source.cardId === row.card_id && feedback.source.actionId === row.action_id, 503, 'MEMORY_FEEDBACK_INVALID');
    // Limit before full selection, with at most two references from one source
    // and stable IDs. Subsequent specimen/quality quotas remain authoritative.
    for (const [index, example] of feedback.examples.entries()) if (example.kind === (domain === 'CLEAN' ? 'CLEAN_SIDE' : domain)) {
      validateFrame(example.frame);
      candidates.push({ id: digest(`${row.feedback_hash}:${index}`), feedbackSha256: row.feedback_hash, source: feedback.source, example });
      if (candidates.filter(c => c.source.cardId === row.card_id).length >= 2) break;
    }
    if (candidates.length >= 256) break;
    } catch (error) { if ([401, 403].includes(error?.status)) throw error;
      unavailable.push({ id: digest(`${row.card_id}:${row.action_id}:${row.revision}`), reason: 'FEEDBACK_INVALID' }); }
  }
  const chosen = selectRoleLearning({ domain, ...scope, target, bindings, candidates: candidates.slice(0, 256), now });
  const { sha256: _sha, ...body } = chosen;
  const evidence = { ...body, unavailable };
  const selection = { ...evidence, sha256: digest(canonical(evidence, { maxBytes: 16777216 })) };
  return { selection, policy: scope.policy, release: { id: release.id, sha256: release.manifest_hash },
    bindingSha256: digest(canonical({ selectionSha256: selection.sha256, releaseSha256: release.manifest_hash })) };
}
