import { createHash } from 'node:crypto';
import { canonicalJson } from '@tenkings/card-catalog-evidence';
import type { StaffInventoryResearchRecoveryAssessment } from '@tenkings/shared';
import {
  STAFF_INVENTORY_IDENTIFICATION_FIELDS, StaffInventoryIdentificationRequestSchema,
  isStaffInventoryIdentificationResponse, type StaffInventoryIdentificationField,
  type StaffInventoryIdentificationRequest, type StaffInventoryIdentificationResponse,
} from '../staffInventoryIdentification';
import {
  STAFF_INVENTORY_RESEARCH_ENGINE_VERSION, StaffInventoryResearchInputSchema,
  StaffInventoryResearchReferenceSchema, StaffInventoryResearchCatalogContextSchema,
  type StaffInventoryResearchDescription, type StaffInventoryResearchInput,
  type StaffInventoryResearchReference, type StaffInventoryResearchCatalogContext,
} from '../staffInventoryResearch';
import { retainResearchCatalogScope, type ResearchCatalogSnapshot } from './staffInventoryResearchCatalog';
import { isExactStaffInventoryResearchReference } from './staffInventoryResearch';

export const STAFF_INVENTORY_RECOVERY_IDENTITY_VERSION = 'staff-inventory-recovery-identity-v1' as const;
export type StaffInventoryRecoveryIdentityNeed =
  | 'MISSING_ORIGINAL_PHOTOS' | 'MISSING_IDENTITY_FIELDS' | 'DESCRIPTION_CONFLICT'
  | 'RECOGNITION_UNAVAILABLE' | 'RECOGNITION_FAILED' | 'RECOGNITION_DEFERRED'
  | 'CATALOG_UNAVAILABLE' | 'MISSING_CATALOG_REFERENCE' | 'MISSING_DIAGNOSTIC_EVIDENCE'
  | 'AMBIGUOUS_CATALOG_IDENTITY' | 'UNSUPPORTED_CATEGORY';
export type StaffInventoryRecoveryIdentity = StaffInventoryResearchRecoveryAssessment;
export type StaffInventoryRecoveryIdentityDependencies = {
  /** One original-photo recognition call; the caller owns the durable paid-work allowance. */
  recognize?: (input: StaffInventoryIdentificationRequest, signal: AbortSignal) => Promise<StaffInventoryIdentificationResponse>;
  previousRecognition?: StaffInventoryIdentificationResponse | null;
  previousCatalogContext?: StaffInventoryResearchCatalogContext | null;
  allowRecognition?: boolean;
  /** These loaders are server-owned reviewed readers, never request-body reference data. */
  loadReferences?: (description: StaffInventoryResearchDescription, signal: AbortSignal) => Promise<StaffInventoryResearchReference[]>;
  loadCatalog?: (description: StaffInventoryResearchDescription, signal: AbortSignal) => Promise<ResearchCatalogSnapshot>;
  researchEngineVersion?: string;
};

const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const normalized = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const category = (value: string | null) => {
  const text = value?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return text === 'pokemon' ? 'POKEMON' : text === 'sports' || text === 'sports cards' ? 'SPORTS' : null;
};
const anchors = ['name', 'category', 'year', 'manufacturer', 'set_name', 'card_number'] as const;
function missing(description: StaffInventoryResearchDescription): StaffInventoryIdentificationField[] {
  // Publisher is optional for the reviewed Pokémon reader, but legacy lookup
  // requires it; recognizing a missing printed brand is still useful context.
  return anchors.filter(field => description[field] === null);
}
function agrees(field: StaffInventoryIdentificationField, saved: string, suggested: string) {
  if (field === 'category') return category(saved) !== null && category(saved) === category(suggested);
  if (field === 'name') return (` ${normalized(saved)} `).includes(` ${normalized(suggested)} `);
  // In particular retain season punctuation, number prefixes, denominators and
  // zeroes. Similarity is not authority to overwrite a staff-saved fact.
  return normalized(saved) === normalized(suggested);
}
function cancelled(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Inventory identity recovery cancelled.');
}

/** Propose private research context without editing inventory descriptions or
 * publishing catalog evidence. The scheduled caller persists this proposal and
 * reuses successful recognition before doing subsequent cheap catalog checks. */
export async function prepareStaffInventoryResearchRecoveryIdentity(
  input: StaffInventoryResearchInput,
  deps: StaffInventoryRecoveryIdentityDependencies = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<StaffInventoryRecoveryIdentity> {
  const source = StaffInventoryResearchInputSchema.parse(input);
  cancelled(signal);
  const previousScope = retainResearchCatalogScope(deps.previousCatalogContext, {
    ...(source.front_photo_key ? { front: { sha256: source.front_photo_key.slice(-68, -4) } } : {}),
    ...(source.back_photo_key ? { back: { sha256: source.back_photo_key.slice(-68, -4) } } : {}),
  });
  const output: StaffInventoryRecoveryIdentity = {
    schema_version: 1, resolver_version: STAFF_INVENTORY_RECOVERY_IDENTITY_VERSION,
    source_input_sha256: sha(source), description_event_id: source.description_event_id, description_hash: source.description_hash,
    proposed_description: { ...source.description }, added_fields: [], conflicts: [], missing_fields: [],
    recognition: { status: 'not_needed', evidence: null }, references: [],
    catalog_context: previousScope ? { schema_version: 1, status: 'not_consulted', publications: [], ...previousScope } : null,
    need_codes: [], evidence_sha256: null, ready_for_research: false,
  };
  const need = (code: StaffInventoryRecoveryIdentityNeed) => { if (!output.need_codes.includes(code)) output.need_codes.push(code); };
  const photos = StaffInventoryIdentificationRequestSchema.safeParse({ front_photo_key: source.front_photo_key, back_photo_key: source.back_photo_key });
  if (!photos.success || source.front_photo_key?.slice(-68) === source.back_photo_key?.slice(-68)) need('MISSING_ORIGINAL_PHOTOS');

  if (missing(source.description).length) {
    if (photos.success && !output.need_codes.includes('MISSING_ORIGINAL_PHOTOS')) {
      if (deps.previousRecognition) {
        if (isStaffInventoryIdentificationResponse(deps.previousRecognition, photos.data)) {
          output.recognition = { status: 'completed', evidence: deps.previousRecognition };
        } else {
          // A malformed or foreign persisted receipt cannot trigger another
          // paid request implicitly, or substitute a different card's facts.
          output.recognition.status = 'failed'; need('RECOGNITION_FAILED');
        }
      } else if (deps.allowRecognition === false) {
        output.recognition.status = 'deferred'; need('RECOGNITION_DEFERRED');
      } else {
        try {
          const recognize = deps.recognize ?? (async (request, recognitionSignal) =>
            (await import('./staffInventoryIdentification')).identifyStaffInventoryCard(request, {}, recognitionSignal));
          const result = await recognize(photos.data, signal);
          cancelled(signal);
          if (!isStaffInventoryIdentificationResponse(result, photos.data)) throw new Error('Invalid original-photo recognition.');
          output.recognition = { status: 'completed', evidence: result };
        } catch (error) {
          cancelled(signal);
          const unavailable = error !== null && typeof error === 'object' && 'code' in error && error.code === 'unavailable';
          output.recognition.status = unavailable ? 'unavailable' : 'failed';
          need(unavailable ? 'RECOGNITION_UNAVAILABLE' : 'RECOGNITION_FAILED');
        }
      }
    }
    if (output.recognition.evidence) {
      for (const field of STAFF_INVENTORY_IDENTIFICATION_FIELDS) {
        const saved = source.description[field], suggestion = output.recognition.evidence.suggestions[field];
        if (suggestion.confidence !== 'high' || suggestion.value === null || suggestion.evidence === null) continue;
        if (saved !== null && !agrees(field, saved, suggestion.value)) {
          output.conflicts.push({ field, saved_value: saved, suggested_value: suggestion.value, evidence: suggestion.evidence });
        } else if (saved === null && anchors.some(anchor => anchor === field)) {
          output.proposed_description[field] = suggestion.value; output.added_fields.push(field);
        }
      }
    }
  }
  output.missing_fields = missing(output.proposed_description);
  if (output.missing_fields.length) need('MISSING_IDENTITY_FIELDS');
  if (output.conflicts.length) need('DESCRIPTION_CONFLICT');
  if (!category(output.proposed_description.category)) need('UNSUPPORTED_CATEGORY');
  // No expensive listing/model research or catalog scope model is useful until
  // the original pair and exact descriptive anchors are available.
  if (output.need_codes.length) return output;

  try {
    if (deps.loadCatalog) {
      const snapshot = await deps.loadCatalog(output.proposed_description, signal);
      cancelled(signal);
      output.catalog_context = StaffInventoryResearchCatalogContextSchema.parse(snapshot.context);
      if (!output.catalog_context.scope_receipt && previousScope) {
        output.catalog_context.scope_evidence = previousScope.scope_evidence;
        output.catalog_context.scope_receipt = previousScope.scope_receipt;
      }
      if (output.catalog_context.status === 'unavailable') { need('CATALOG_UNAVAILABLE'); return output; }
      const records = snapshot.references.map(reference => StaffInventoryResearchReferenceSchema.parse(reference));
      if (records.length > 24 || new Set(records.map(reference => reference.id)).size !== records.length) throw new Error('Invalid catalog records.');
      for (const reference of records) {
        const binding = reference.catalog_binding;
        const publication = binding && output.catalog_context.publications.find(entry => canonicalJson(entry.publication) === canonicalJson(binding.publication));
        if (output.catalog_context.status !== 'current' || !binding || !publication || publication.truncated
          || publication.coverage.text === 'truncated' || publication.coverage.applicability === 'truncated'
          || category(reference.identity.category) !== category(output.proposed_description.category)
          || normalized(reference.identity.year ?? '') !== normalized(output.proposed_description.year!)
          || normalized(reference.identity.manufacturer ?? '') !== normalized(output.proposed_description.manufacturer!)) throw new Error('Unbound catalog records.');
      }
      output.references = records;
      // Multiple printings are expected and resolved by photographed diagnostic
      // evidence in research. Different cards/programs require staff resolution.
      if (new Set(records.map(reference => canonicalJson([reference.catalog_binding!.publication.setId, reference.catalog_binding!.card_id]))).size > 1) need('AMBIGUOUS_CATALOG_IDENTITY');
    } else {
      const load = deps.loadReferences ?? (async (description, referenceSignal) =>
        (await import('./staffInventoryResearchReferences')).loadStaffInventoryResearchReferences(description, referenceSignal));
      const records = (await load(output.proposed_description, signal)).map(reference => StaffInventoryResearchReferenceSchema.parse(reference));
      cancelled(signal);
      if (records.length > 24 || new Set(records.map(reference => reference.id)).size !== records.length
        || records.some(reference => reference.catalog_binding || !isExactStaffInventoryResearchReference(output.proposed_description, reference))) throw new Error('Invalid legacy records.');
      output.references = records;
    }
  } catch {
    cancelled(signal); output.references = [];
    // Never retain stale publication authority as a side effect of retaining an
    // already-paid observation; every later reference is read and checked anew.
    output.catalog_context = previousScope ? { schema_version: 1, status: 'unavailable', publications: [], ...previousScope } : null;
    need('CATALOG_UNAVAILABLE'); return output;
  }
  const catalogReferences = output.references.filter(reference => reference.kind === 'catalog');
  if (!catalogReferences.length) need('MISSING_CATALOG_REFERENCE');
  else if (!catalogReferences.some(reference => reference.distinguishing_features.length)) need('MISSING_DIAGNOSTIC_EVIDENCE');
  output.ready_for_research = output.need_codes.length === 0;
  if (output.ready_for_research) {
    // Stable under receipt timestamps, provider wording and query row ordering.
    // A new reviewed manifest/row, photo, recovered fact or engine is material.
    const evidence = output.references.map(({ captured_at: _captured, ...reference }) => reference)
      .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b), 'en'));
    output.evidence_sha256 = sha({ resolver_version: output.resolver_version,
      research_engine_version: deps.researchEngineVersion ?? STAFF_INVENTORY_RESEARCH_ENGINE_VERSION,
      source_input_sha256: output.source_input_sha256, description: output.proposed_description, references: evidence });
  }
  return output;
}
