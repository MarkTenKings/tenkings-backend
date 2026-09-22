import { createHash } from 'node:crypto';
import { canonicalJson } from '@tenkings/card-catalog-evidence';
import { StaffInventoryResearchRecoveryAssessmentSchema, type StaffInventoryResearchInput } from '@tenkings/shared';
import { isStaffInventoryIdentificationResponse } from '../staffInventoryIdentification';

/** Private enrichment keeps the original job/description/photo identity intact.
 * Only receipt-bound, high-confidence absent anchors may enter model context. */
export function applyStaffInventoryResearchRecoveryContext(input: StaffInventoryResearchInput, value: unknown): StaffInventoryResearchInput {
  const assessment = StaffInventoryResearchRecoveryAssessmentSchema.parse(value);
  const hash = createHash('sha256').update(canonicalJson(input)).digest('hex');
  if (!assessment.ready_for_research || assessment.source_input_sha256 !== hash || assessment.description_event_id !== input.description_event_id || assessment.description_hash !== input.description_hash) {
    throw new Error('Recovery context does not authorize this exact input.');
  }
  const additions: string[] = [];
  for (const field of Object.keys(input.description) as (keyof typeof input.description)[]) {
    const original = input.description[field], proposed = assessment.proposed_description[field];
    if (original !== null && proposed !== original) throw new Error('Recovery cannot replace a saved description.');
    if (original === null && proposed !== null) {
      if (field === 'variant' || field === 'card_type') throw new Error('Recovery cannot infer an optional treatment.');
      additions.push(field);
      const receipt = assessment.recognition.evidence, suggestion = receipt?.suggestions[field];
      if (!receipt || !isStaffInventoryIdentificationResponse(receipt, { front_photo_key: input.front_photo_key!, back_photo_key: input.back_photo_key! })
          || suggestion?.value !== proposed || suggestion.confidence !== 'high' || !suggestion.evidence) throw new Error('Recovery addition lacks exact original-photo evidence.');
    }
  }
  if (canonicalJson(additions.sort()) !== canonicalJson([...assessment.added_fields].sort())) throw new Error('Recovery additions do not match the recorded proposal.');
  return { ...input, description: { ...assessment.proposed_description } };
}
