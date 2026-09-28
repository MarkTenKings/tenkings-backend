import { canonical, digest, immutable, requireThat, designKey, validateLesson } from './contract.mjs';
import { selectDefectLessons } from './retrieval-policy.mjs';
import { selectRoleLearning, roleLearningFallback } from './role-learning.mjs';

/** Only an explicitly selected immutable release can supply model examples.
 * Family-scoped indexes replace the old corpus-wide confirmation scan. A new
 * confirmation excludes that source's old lesson while unrelated eligible
 * examples remain usable. The existing discard command is deletion, not a
 * separately authorized archive operation; its exclusion remains in force. */
export async function readActiveLearning(tx, { cardId, design, originalSha256, side, limit, learningBindings }) {
  const { cardNumber, ...family } = design;
  const [snapshot] = await tx.$queryRawUnsafe(`WITH active AS MATERIALIZED (
    SELECT r.id,r.manifest_hash,r.manifest::jsonb->>'policy' AS policy,r.manifest::jsonb->'learningScopes'->'DEFECT' AS scope,r.manifest::jsonb #> '{learningMembership,DEFECT}' AS domain_membership,r.manifest::jsonb->>'kind' AS kind,r.manifest::jsonb->'qualification' AS qualification FROM atlas_manual.learning_control c
      JOIN atlas_manual.learning_release r ON r.id=c.active_release_id
  ), eligible AS MATERIALIZED (
    SELECT p.*,j.feedback_hash FROM atlas_manual.learning_publication p
    LEFT JOIN atlas_manual.learning_publication_job j ON j.card_id=p.card_id AND j.action_id=p.action_id
    JOIN atlas_manual.learning_release_member m ON m.publication_revision=p.revision
    JOIN active r ON r.id=m.release_id
    WHERE p.design_key=$2 AND p.card_id<>$1::uuid
      AND (r.domain_membership IS NULL OR p.revision IN(SELECT v::bigint FROM jsonb_array_elements_text(r.domain_membership) v))
      AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)
      AND NOT EXISTS(SELECT 1 FROM atlas_manual.learning_withdrawal w WHERE w.publication_revision=p.revision)
      AND NOT EXISTS(SELECT 1 FROM atlas_manual.action a WHERE a.card_id=p.card_id
        AND a.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS' AND a.result_revision>p.result_revision)
  ), pending AS MATERIALIZED (
    SELECT j.card_id,j.action_id,j.state FROM atlas_manual.learning_publication_job j
    JOIN atlas_manual.action a ON a.card_id=j.card_id AND a.action_id=j.action_id
    WHERE j.design_family=$3::jsonb AND j.card_id<>$1::uuid AND j.state<>'SUPERSEDED'
      AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)
      AND NOT EXISTS(SELECT 1 FROM atlas_manual.action n WHERE n.card_id=j.card_id
        AND n.request::jsonb #>> '{action,type}'='CONFIRM_FINDINGS' AND n.result_revision>a.result_revision)
      AND NOT EXISTS(SELECT 1 FROM eligible p WHERE p.card_id=j.card_id AND p.action_id=j.action_id)
  ), recent AS (
    SELECT * FROM eligible ORDER BY revision DESC LIMIT 256
  ), expanded AS (
    SELECT lesson,revision,card_id,feedback_hash FROM recent CROSS JOIN LATERAL jsonb_array_elements(document::jsonb->'lessons') lesson
    WHERE ($4::text IS NULL OR lesson->>'side'=$4)
      AND NOT (lesson #>> '{source,frame,originalSha256}'=ANY($5::text[]))
      AND (lesson->>'disposition'<>'REJECTED' OR ($6::text IS NOT NULL AND lesson #>> '{design,cardNumber}'=$6))
  ), diversified AS (
    SELECT lesson,revision,feedback_hash,row_number() OVER (PARTITION BY card_id,lesson->>'disposition' ORDER BY lesson->>'id' COLLATE "C") AS source_label_rank FROM expanded
  ), selected AS (
    SELECT lesson,revision,feedback_hash FROM diversified
    WHERE (SELECT policy FROM active)<>'balanced-defect-v1' OR source_label_rank<=2
    ORDER BY COALESCE(lesson #>> '{design,cardNumber}'=$6,false) DESC,revision DESC,lesson->>'id' COLLATE "C"
    LIMIT CASE WHEN (SELECT policy FROM active)='balanced-defect-v1' THEN 96 ELSE $7 END
  ) SELECT (SELECT id FROM active) AS release_id,(SELECT manifest_hash FROM active) AS release_hash,(SELECT policy FROM active) AS policy,(SELECT scope FROM active) AS scope,(SELECT kind FROM active) AS kind,(SELECT qualification FROM active) AS qualification,
    COALESCE((SELECT max(m.publication_revision) FROM atlas_manual.learning_release_member m JOIN active r ON r.id=m.release_id),0)::int AS generation,
    (SELECT count(*)::int FROM pending) AS unavailable_sources,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('cardId',card_id,'actionId',action_id,'state',state) ORDER BY card_id)
      FROM (SELECT * FROM pending ORDER BY card_id LIMIT 256) bounded_pending),'[]'::jsonb) AS pending,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('lesson',lesson,'generation',revision,'feedbackSha256',feedback_hash)
      ORDER BY COALESCE(lesson #>> '{design,cardNumber}'=$6,false) DESC,revision DESC,lesson->>'id' COLLATE "C") FROM selected),'[]'::jsonb) AS selected`,
  cardId, designKey(design), JSON.stringify(family), side, originalSha256, cardNumber, limit);
  requireThat(snapshot?.release_id && snapshot.release_hash, 503, 'MEMORY_ACTIVE_RELEASE_REQUIRED');
  requireThat(['legacy-defect-family-v1', 'balanced-defect-v1'].includes(snapshot.policy), 503, 'MEMORY_ACTIVE_POLICY_UNSUPPORTED');
  const valid = [], unavailableLessons = [];
  for (const entry of snapshot.selected) {
    try {
      const lesson = validateLesson(entry.lesson);
      requireThat(designKey(lesson.design) === designKey(design) && lesson.source.cardId !== cardId
        && !originalSha256.includes(lesson.source.frame.originalSha256) && (!side || lesson.side === side)
        && (lesson.disposition !== 'REJECTED' || cardNumber && lesson.design.cardNumber === cardNumber), 503, 'MEMORY_RETRIEVAL_INVALID');
      valid.push(entry);
    } catch (error) { if ([401, 403].includes(error?.status)) throw error;
      unavailableLessons.push({ id: /^[a-f0-9]{64}$/.test(entry.lesson?.id) ? entry.lesson.id : digest(`invalid-lesson-${unavailableLessons.length}`),
        reason: 'EXEMPLAR_UNVERIFIED' }); }
  }
  const checked = valid.map(e => e.lesson);
  const selection = snapshot.policy === 'balanced-defect-v1' ? selectDefectLessons({ candidates: valid,
    target: { cardId, design, originalSha256, side }, limit: Math.min(limit, 12) }) : null;
  let roleSelection = null;
  if (snapshot.scope) try { roleSelection = selectRoleLearning({ domain: 'DEFECT', ...snapshot.scope, bindings: learningBindings,
    target: { cardId, originalSha256, side }, candidates: valid.filter(e => e.feedbackSha256).map(e => ({ id: e.lesson.id,
      feedbackSha256: e.feedbackSha256, source: e.lesson.source, example: { kind: 'DEFECT', label: e.lesson.disposition,
        frame: e.lesson.source.frame, side: e.lesson.side } })) }); }
  catch (error) {
    if ([401, 403].includes(error?.status)) throw error;
    const fallback = roleLearningFallback({ domain: 'DEFECT', reason: error?.code === 'LEARNING_POLICY_EXPIRED' ? 'POLICY_EXPIRED'
      : error?.code === 'LEARNING_RUNTIME_POLICY_CHANGED' ? 'RUNTIME_POLICY_CHANGED' : 'POLICY_INVALID' });
    const validHash = value => /^[a-f0-9]{64}$/.test(value) ? value : digest('invalid-policy-binding');
    const { sha256: _oldHash, ...body } = fallback;
    const bound = { ...body, policySha256: validHash(snapshot.scope.policy?.sha256),
      registrySha256: validHash(snapshot.scope.registry?.sha256), reviewerQualitySha256: validHash(snapshot.scope.quality?.sha256) };
    roleSelection = { ...bound, sha256: digest(canonical(bound)) };
  }
  const roleIds = roleSelection ? new Set(roleSelection.examples.map(e => e.id)) : null;
  const qualification = !snapshot.scope && (snapshot.kind === 'EVALUATED_CANDIDATE' || snapshot.qualification)
    ? { bindingSha256: digest(canonical(snapshot.qualification ?? {})),
      status: snapshot.qualification?.bindings && learningBindings && canonical(snapshot.qualification.bindings) === canonical(learningBindings) ? 'QUALIFIED' : 'BASELINE' } : null;
  const lessons = qualification?.status === 'BASELINE' ? [] : (selection?.lessons ?? checked).filter(l => !roleIds || roleIds.has(l.id));
  const freshness = { version: 'atlas-learning-freshness-v1', activeReleaseId: snapshot.release_id,
    activeReleaseSha256: snapshot.release_hash, unavailableSources: snapshot.unavailable_sources,
    policy: snapshot.policy, role: 'DEFECT_PROPOSER', fallback: lessons.length ? 'ELIGIBLE_EXAMPLES' : 'BASELINE_WITHOUT_EXAMPLES',
    ...(selection ? { decisions: selection.decisions } : {}),
    ...(qualification ? { qualification: { ...qualification, reason: qualification.status === 'BASELINE' ? 'RUNTIME_POLICY_CHANGED' : null } } : {}),
    ...(unavailableLessons.length ? { unavailableLessons: unavailableLessons.slice(0, 32) } : {}),
    ...(roleSelection ? { roleSelection: { sha256: roleSelection.sha256, policySha256: roleSelection.policySha256,
      registrySha256: roleSelection.registrySha256, reviewerQualitySha256: roleSelection.reviewerQualitySha256,
      status: roleSelection.status, reason: roleSelection.reason ?? null } } : {}) };
  return immutable({ generation: snapshot.generation,
    revision: `m1:${snapshot.generation}:${digest(canonical({ freshness, pending: snapshot.pending, lessonIds: lessons.map(l => l.id) }))}`,
    pendingPublications: 0, freshness, lessons });
}
